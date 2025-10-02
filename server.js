/**
 * =================================================================
 * WebRTC Signaling Server مع دعم HTTPS
 * =================================================================
 */

const express = require('express');
const https = require('https');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const os = require('os');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// محاولة إنشاء شهادات SSL تلقائياً للتطوير
function setupSSL() {
    try {
        // في production، استخدم شهادات حقيقية
        if (process.env.NODE_ENV === 'production') {
            return {
                key: fs.readFileSync(process.env.SSL_KEY_PATH),
                cert: fs.readFileSync(process.env.SSL_CERT_PATH)
            };
        }

        // للتطوير، أنشئ شهادات self-signed تلقائياً
        const keyPath = path.join(__dirname, 'key.pem');
        const certPath = path.join(__dirname, 'cert.pem');

        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            console.log('🔐 Using existing SSL certificates');
            return {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath)
            };
        } else {
            console.log('⚠️  No SSL certificates found. Using HTTP only.');
            console.log('💡 For HTTPS, run: npm run generate-ssl');
            return null;
        }
    } catch (error) {
        console.log('⚠️  SSL setup failed, using HTTP:', error.message);
        return null;
    }
}

const sslConfig = setupSSL();
let server;
let wss;

if (sslConfig) {
    // استخدام HTTPS إذا كانت الشهادات متوفرة
    server = https.createServer(sslConfig, app);
    console.log('🔐 HTTPS server enabled');
} else {
    // استخدام HTTP كبديل
    server = http.createServer(app);
    console.log('🌐 HTTP server enabled (HTTPS recommended for WebRTC)');
}

wss = new WebSocket.Server({ server });

// إعداد الجلسات
const sessionParser = session({
    secret: 'your-super-secret-key-change-it', // يجب تغيير هذا المفتاح
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
});
app.use(sessionParser);

// تقديم الملفات الثابتة من مجلد 'public'
app.use(express.static(path.join(__dirname, 'public')));

// حماية صفحة المكالمة
app.get('/', (req, res) => {
    if (!req.session.user) {
        res.redirect('/login.html');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// إدارة حالة التطبيق في الذاكرة
let hostId = null;
const clients = new Map();
const clientInfo = new Map();
const pendingJoins = new Set();
const callIdToHostId = new Map();
let activePoll = null;
const USERS_FILE = path.join(__dirname, 'users.json');

function readUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        return {};
    }
    const data = fs.readFileSync(USERS_FILE);
    return JSON.parse(data);
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}


/**
 * بث رسالة لجميع العملاء المتصلين
 */
function broadcastToAll(excludeClientId, message) {
    clients.forEach((ws, clientId) => {
        if (clientId !== excludeClientId && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`Error sending to client ${clientId}:`, error);
            }
        }
    });
}

/**
 * معالجة انقطاع اتصال العميل
 */
function handleClientDisconnection(clientId) {
    const disconnectedClientName = clientInfo.get(clientId)?.name || `User-${clientId.substring(0, 4)}`;
    
    console.log(`[Disconnection] ${disconnectedClientName} disconnected. Cleaning up...`);
    
    clients.delete(clientId);
    pendingJoins.delete(clientId);

    if (clientInfo.has(clientId)) {
        clientInfo.delete(clientId);

        // إذا كان المضيف هو الذي انقطع، نعين مضيف جديد
        if (clientId === hostId) {
            const remainingCallMembers = Array.from(clientInfo.keys());
            hostId = remainingCallMembers.length > 0 ? remainingCallMembers[0] : null;
            
            if (hostId) {
                const newHostSocket = clients.get(hostId);
                if (newHostSocket) {
                    newHostSocket.send(JSON.stringify({ type: 'set-host' }));
                    console.log(`[Host Migration] ${clientInfo.get(hostId).name} is the new host.`);
                    
                    // إعلام الجميع بتغيير المضيف
                    broadcastToAll(hostId, {
                        type: 'host-changed',
                        newHostName: clientInfo.get(hostId).name
                    });
                }
            } else {
                console.log("[Host Migration] Last member left. No more host.");
            }
        }

        // إعلام جميع العملاء بانقطاع العضو
        broadcastToAll(null, { 
            type: 'peer-disconnected', 
            peerId: clientId, 
            peerName: disconnectedClientName 
        });
    }
}

// --- Routes for Authentication ---
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 6) {
        return res.status(400).send('اسم المستخدم أو كلمة المرور غير صالحة.');
    }

    const users = readUsers();
    if (users[username]) {
        return res.status(409).send('اسم المستخدم موجود بالفعل.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = { password: hashedPassword };
    writeUsers(users);

    console.log(`[Auth] New user registered: ${username}`);
    res.redirect('/login.html');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users[username];

    if (!user) {
        return res.status(401).send('اسم المستخدم أو كلمة المرور غير صحيحة.');
    }

    const match = await bcrypt.compare(password, user.password);
    if (match) {
        req.session.user = { username };
        console.log(`[Auth] User logged in: ${username}`);
        res.redirect('/');
    } else {
        res.status(401).send('اسم المستخدم أو كلمة المرور غير صحيحة.');
    }
});

app.get('/logout', (req, res) => {
    const username = req.session.user?.username;
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('فشل في تسجيل الخروج.');
        }
        if (username) {
            console.log(`[Auth] User logged out: ${username}`);
        }
        res.redirect('/login.html');
    });
});

// --- معالجة اتصالات WebSocket ---
wss.on('connection', (ws) => {
    // 1. تعيين مُعرّف فريد للعميل الجديد وتخزين الاتصال
    const clientId = uuidv4();
    clients.set(clientId, ws);
    console.log(`[Connection] Client ${clientId.substring(0, 8)} connected. Total clients: ${clients.size}`);

    // 2. إبلاغ العميل بالمُعرّف الخاص به
    ws.send(JSON.stringify({ type: 'assign-id', id: clientId }));

    // --- معالجة الرسائل الواردة من العميل ---
    ws.on('message', (rawMessage) => {
        let data;
        try {
            data = JSON.parse(rawMessage);
        } catch (error) {
            console.error(`[Error] Failed to parse message from ${clientId.substring(0, 8)}:`, rawMessage);
            return;
        }
        
        const senderName = clientInfo.get(clientId)?.name || `User-${clientId.substring(0, 4)}`;
        console.log(`[Message] From ${senderName} (${data.type})`);

        switch (data.type) {
            case 'start-call': {
                if (hostId) {
                    console.warn(`[Logic Warning] A host already exists. Ignoring 'start-call' from ${senderName}.`);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'يوجد مضيف بالفعل في المكالمة.' 
                    }));
                    break;
                }
                const callId = uuidv4().substring(0, 8);
                hostId = clientId;
                callIdToHostId.set(callId, clientId);
                clientInfo.set(clientId, { name: data.name });
                console.log(`[Host Set] ${data.name} (${clientId.substring(0, 8)}) is now the host for call ${callId}.`);
                ws.send(JSON.stringify({ type: 'set-host', callId }));
                break;
            }

            case 'request-to-join': {
                if (!data.name || data.name.trim() === '') {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'الرجاء إدخال اسم صحيح.' 
                    }));
                    break;
                }

                clientInfo.set(clientId, { name: data.name });

                // البحث عن المضيف إما عن طريق الرابط أو المضيف العام
                let targetHostId = hostId;
                if (data.callId && callIdToHostId.has(data.callId)) {
                    targetHostId = callIdToHostId.get(data.callId);
                }

                const hostSocket = clients.get(targetHostId);
                
                if (!hostId || !hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
                    console.log(`[Join Reject] No host available for ${senderName}.`);
                    ws.send(JSON.stringify({ 
                        type: 'join-rejected', 
                        reason: 'لا توجد مكالمة نشطة للانضمام إليها.' 
                    }));
                    break;
                }

                if (pendingJoins.has(clientId)) {
                    console.log(`[Join Info] Duplicate join request from ${senderName}. Ignoring.`);
                    break;
                }

                console.log(`[Join Request] Forwarding request from ${senderName} to host.`);
                pendingJoins.add(clientId);
                hostSocket.send(JSON.stringify({
                    type: 'request-to-join',
                    guestId: clientId,
                    guestName: data.name
                }));
                break;
            }

            case 'approve-join': {
                if (clientId !== hostId) {
                    console.warn(`[Security] Non-host client ${clientId.substring(0, 8)} tried to approve join.`);
                    break;
                }
                
                const guestId = data.guestId;
                if (!pendingJoins.has(guestId)) {
                    console.warn(`[Logic] No pending join request for guest ${guestId}`);
                    break;
                }
                
                pendingJoins.delete(guestId);
                const guestSocket = clients.get(guestId);
                
                if (guestSocket && guestSocket.readyState === WebSocket.OPEN) {
                    console.log(`[Join Approve] Host approved ${clientInfo.get(guestId)?.name}.`);
                    
                    // إرسال قائمة المشاركين الحاليين للضيف
                    const peers = Array.from(clientInfo.keys())
                        .filter(id => id !== guestId && clients.has(id))
                        .map(id => ({ 
                            id, 
                            name: clientInfo.get(id).name,
                            handRaised: clientInfo.get(id).handRaised || false
                        }));

                    guestSocket.send(JSON.stringify({ 
                        type: 'join-approved', 
                        peers 
                    }));

                    // إعلام جميع المشاركين بانضمام عضو جديد
                    const newPeerName = clientInfo.get(guestId).name;
                    broadcastToAll(guestId, {
                        type: 'peer-joined', 
                        peerId: guestId, 
                        peerName: newPeerName 
                    });
                }
                break;
            }

            case 'reject-join': {
                if (clientId !== hostId) {
                    console.warn(`[Security] Non-host client ${clientId.substring(0, 8)} tried to reject join.`);
                    break;
                }
                
                const rejectedId = data.guestId;
                pendingJoins.delete(rejectedId);
                const rejectedSocket = clients.get(rejectedId);
                if (rejectedSocket && rejectedSocket.readyState === WebSocket.OPEN) {
                    rejectedSocket.send(JSON.stringify({ 
                        type: 'join-rejected', 
                        reason: 'رفض المضيف طلب الانضمام.' 
                    }));
                }
                break;
            }

            case 'kick-user': {
                if (clientId !== hostId) {
                    console.warn(`[Security] Non-host client ${clientId.substring(0, 8)} tried to kick user.`);
                    break;
                }
                
                const userToKickId = data.kickId;
                const kickedSocket = clients.get(userToKickId);
                if (kickedSocket && kickedSocket.readyState === WebSocket.OPEN) {
                    console.log(`[Kick] Host kicked ${clientInfo.get(userToKickId)?.name}`);
                    kickedSocket.send(JSON.stringify({ type: 'you-were-kicked' }));
                    kickedSocket.close();
                }
                break;
            }

            case 'toggle-remote-mute': {
                if (clientId !== hostId) {
                    console.warn(`[Security] Non-host client ${clientId.substring(0, 8)} tried to remote mute.`);
                    break;
                }
                
                const { muteId, shouldMute } = data;
                const targetSocket = clients.get(muteId);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    const peerName = clientInfo.get(muteId)?.name;
                    if (shouldMute) {
                        console.log(`[Remote Mute] Host is muting ${peerName}.`);
                        targetSocket.send(JSON.stringify({ type: 'you-were-muted' }));
                        broadcastToAll(null, { type: 'peer-muted', peerId: muteId, peerName });
                    } else {
                        console.log(`[Remote Unmute] Host is unmuting ${peerName}.`);
                        targetSocket.send(JSON.stringify({ type: 'you-were-unmuted' }));
                        broadcastToAll(null, { type: 'peer-unmuted', peerId: muteId, peerName });
                    }
                }
                break;
            }

            case 'create-poll': {
                if (clientId !== hostId) break;
                if (activePoll) {
                    ws.send(JSON.stringify({ type: 'error', message: 'يوجد استطلاع نشط بالفعل.' }));
                    break;
                }
                activePoll = {
                    id: uuidv4(),
                    question: data.poll.question,
                    options: data.poll.options.map(opt => ({ text: opt, votes: 0 })),
                    voters: new Set()
                };
                console.log(`[Poll] Host created a new poll: "${activePoll.question}"`);
                broadcastToAll(null, { type: 'new-poll', poll: activePoll });
                break;
            }

            case 'submit-vote': {
                if (!activePoll || activePoll.voters.has(clientId)) {
                    break; // لا تصويت أو صوت بالفعل
                }
                const vote = data.vote;
                if (vote.pollId === activePoll.id && activePoll.options[vote.optionIndex]) {
                    activePoll.options[vote.optionIndex].votes++;
                    activePoll.voters.add(clientId);
                    console.log(`[Poll] Vote received for "${activePoll.options[vote.optionIndex].text}"`);
                    broadcastToAll(null, { type: 'poll-update', poll: activePoll });
                }
                break;
            }

            case 'end-poll': {
                if (clientId !== hostId || !activePoll) break;

                console.log(`[Poll] Host ended poll: "${activePoll.question}"`);
                broadcastToAll(null, { type: 'poll-ended', poll: activePoll });
                activePoll = null;
                break;
            }
            
            case 'hand-state': {
                const client = clientInfo.get(clientId);
                if (client) {
                    client.handRaised = data.raised;
                    broadcastToAll(clientId, {
                        type: 'peer-hand-state',
                        peerId: clientId,
                        raised: data.raised
                    });
                }
                break;
            }

            case 'offer':
            case 'answer':
            case 'ice-candidate': {
                const targetSocket = clients.get(data.to);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    const message = { 
                        ...data, 
                        from: clientId, 
                        fromName: clientInfo.get(clientId)?.name 
                    };
                    targetSocket.send(JSON.stringify(message));
                } else {
                    console.warn(`[WebRTC] Target client ${data.to} not found for ${data.type}`);
                }
                break;
            }

            case 'chat-message': {
                if (!data.message || data.message.trim() === '') {
                    break;
                }
                
                broadcastToAll(null, {
                    type: 'chat-message',
                    fromId: clientId,
                    fromName: clientInfo.get(clientId)?.name || senderName,
                    message: data.message.trim(),
                    timestamp: new Date().toISOString()
                });
                break;
            }

            case 'private-message': {
                const recipientId = data.to;
                const recipientSocket = clients.get(recipientId);

                if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
                    const privateMessage = {
                        type: 'private-message',
                        fromId: clientId,
                        fromName: senderName,
                        message: data.message.trim(),
                        timestamp: new Date().toISOString()
                    };
                    // Send to recipient
                    recipientSocket.send(JSON.stringify(privateMessage));
                    // Send back to sender for their own chat history
                    ws.send(JSON.stringify(privateMessage));
                } else {
                    console.warn(`[Private Message] Recipient ${recipientId} not found or not connected.`);
                }
                break;
            }

            case 'leave-call': {
                console.log(`[Leave] ${senderName} is leaving the call`);
                handleClientDisconnection(clientId);
                break;
            }

            default:
                console.warn(`[Unknown Message] Unknown message type: ${data.type}`);
        }
    });

    // --- معالجة قطع اتصال العميل ---
    ws.on('close', () => {
        console.log(`[Disconnection] Client ${clientId.substring(0, 8)} disconnected.`);
        handleClientDisconnection(clientId);
    });

    ws.on('error', (error) => {
        console.error(`[WebSocket Error] Client ${clientId.substring(0, 8)}:`, error);
        handleClientDisconnection(clientId);
    });
});

// --- بدء تشغيل الخادم ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    const protocol = sslConfig ? 'https' : 'http';
    console.log(`✅ Server is running on ${protocol}://localhost:${PORT}`);
    console.log(`📞 WebRTC Signaling Server ready`);
    console.log(`👥 Waiting for connections...`);
    
    if (!sslConfig) {
        console.log('\n⚠️  IMPORTANT: WebRTC works best with HTTPS');
        console.log('💡 For better experience, consider:');
        console.log('   1. Using local-ssl-proxy');
        console.log('   2. Setting up SSL certificates');
        console.log('   3. Using ngrok for public testing\n');
    }
});

// معالجة الأخطاء غير المعالجة
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});