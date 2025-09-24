/**
 * =================================================================
 * WebRTC Signaling Server (الخادم الوسيط لـ WebRTC) - النسخة النهائية
 * =================================================================
 */

const express = require('express');
// const http = require('http'); // ❌ تم إزالته
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ⬇️ التعديلات اللازمة لدعم HTTPS ⬇️
const fs = require('fs');
const https = require('https'); 

// 1. قراءة ملفات الشهادة والمفتاح التي أنشأتها باستخدام OpenSSL
const privateKey = fs.readFileSync('key.pem', 'utf8');
const certificate = fs.readFileSync('cert.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

const app = express();
// 2. استخدام https.createServer بدلاً من http.createServer
const server = https.createServer(credentials, app);
const wss = new WebSocket.Server({ server });
// ⬆️ نهاية التعديلات ⬆️


// تقديم الملفات الثابتة من مجلد 'public'
app.use(express.static(path.join(__dirname, 'public')));

// إدارة حالة التطبيق في الذاكرة
let hostId = null; 
const clients = new Map(); 
const clientInfo = new Map(); 
const pendingJoins = new Set(); 

// --- معالجة اتصالات WebSocket ---
wss.on('connection', (ws) => {
    // ... (بقية كود معالجة الاتصال والرسائل تبقى كما هي دون تغيير) ...
    // Note: The rest of the code is the same as the original provided code.

    // 1. تعيين مُعرّف فريد للعميل الجديد وتخزين الاتصال
    const clientId = uuidv4();
    clients.set(clientId, ws);
    console.log(`[Connection] Client ${clientId.substring(0, 8)} connected.`);

    // 2. إبلاغ العميل بالمُعرّف الخاص به
    ws.send(JSON.stringify({ type: 'assign-id', id: clientId }));

    // --- معالجة الرسائل الواردة من العميل (محتوى طويل لم يتم تغييره) ---
    ws.on('message', (rawMessage) => {
        let data;
        try {
            data = JSON.parse(rawMessage);
        } catch (error) {
            console.error(`[Error] Failed to parse message:`, rawMessage);
            return;
        }
        
        const senderName = clientInfo.get(clientId)?.name || `User-${clientId.substring(0, 4)}`;
        console.log(`[Message] From ${senderName} (${data.type})`);

        switch (data.type) {
            case 'start-call':
                if (hostId) {
                    console.warn(`[Logic Warning] A host already exists. Ignoring 'start-call' from ${senderName}.`);
                    return;
                }
                hostId = clientId;
                clientInfo.set(clientId, { name: data.name });
                console.log(`[Host Set] ${data.name} (${clientId.substring(0, 8)}) is now the host.`);
                ws.send(JSON.stringify({ type: 'set-host' }));
                break;

            case 'request-to-join':
                clientInfo.set(clientId, { name: data.name });
                const hostSocket = clients.get(hostId);
                
                if (!hostId || !hostSocket || hostSocket.readyState !== WebSocket.OPEN) {
                    console.log(`[Join Reject] No host available for ${senderName}.`);
                    ws.send(JSON.stringify({ type: 'join-rejected', reason: 'No host is available.' }));
                    return;
                }

                if (pendingJoins.has(clientId)) {
                    console.log(`[Join Info] Duplicate join request from ${senderName}. Ignoring.`);
                    return;
                }

                console.log(`[Join Request] Forwarding request from ${senderName} to host.`);
                pendingJoins.add(clientId);
                hostSocket.send(JSON.stringify({
                    type: 'request-to-join',
                    guestId: clientId,
                    guestName: data.name
                }));
                break;

            case 'approve-join':
                if (clientId !== hostId) return; 
                const guestId = data.guestId;
                pendingJoins.delete(guestId); 
                const guestSocket = clients.get(guestId);
                
                if (guestSocket && guestSocket.readyState === WebSocket.OPEN) {
                    console.log(`[Join Approve] Host approved ${clientInfo.get(guestId)?.name}.`);
                    const peers = Array.from(clientInfo.keys())
                        .filter(id => id !== guestId && clients.has(id))
                        .map(id => ({ id, name: clientInfo.get(id).name }));

                    guestSocket.send(JSON.stringify({ type: 'join-approved', peers }));

                    const newPeerName = clientInfo.get(guestId).name;
                    clientInfo.forEach((info, id) => {
                        const socket = clients.get(id);
                        if (id !== guestId && socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'peer-joined', peerId: guestId, peerName: newPeerName }));
                        }
                    });
                }
                break;

            case 'reject-join':
                if (clientId !== hostId) return; 
                const rejectedId = data.guestId;
                pendingJoins.delete(rejectedId);
                const rejectedSocket = clients.get(rejectedId);
                if (rejectedSocket && rejectedSocket.readyState === WebSocket.OPEN) {
                    rejectedSocket.send(JSON.stringify({ type: 'join-rejected', reason: 'Host rejected the request.' }));
                }
                break;

            case 'kick-user':
                if (clientId !== hostId) return; 
                const userToKickId = data.kickId;
                const kickedSocket = clients.get(userToKickId);
                if (kickedSocket && kickedSocket.readyState === WebSocket.OPEN) {
                    kickedSocket.send(JSON.stringify({ type: 'you-were-kicked' }));
                    kickedSocket.close();
                }
                break;

            case 'remote-mute':
                if (clientId !== hostId) return; 
                const userToMuteId = data.muteId;
                const targetSocketToMute = clients.get(userToMuteId);
                if (targetSocketToMute && targetSocketToMute.readyState === WebSocket.OPEN) {
                    console.log(`[Remote Mute] Host is muting ${clientInfo.get(userToMuteId)?.name}.`);
                    targetSocketToMute.send(JSON.stringify({ type: 'you-were-muted' }));
                    
                    clientInfo.forEach((info, id) => {
                        const socket = clients.get(id);
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({
                                type: 'peer-muted',
                                peerId: userToMuteId,
                                peerName: clientInfo.get(userToMuteId)?.name
                            }));
                        }
                    });
                }
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                const targetSocket = clients.get(data.to);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    const message = { ...data, from: clientId, fromName: clientInfo.get(clientId)?.name };
                    targetSocket.send(JSON.stringify(message));
                }
                break;

            case 'chat-message':
                clientInfo.forEach((info, id) => {
                    const socket = clients.get(id);
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'chat-message',
                            fromId: clientId,
                            fromName: senderName,
                            message: data.message
                        }));
                    }
                });
                break;
        }
    });

    // --- معالجة قطع اتصال العميل (محتوى طويل لم يتم تغييره) ---
    ws.on('close', () => {
        const disconnectedClientName = clientInfo.get(clientId)?.name || `User-${clientId.substring(0, 4)}`;
        console.log(`[Disconnection] ${disconnectedClientName} disconnected.`);
        
        clients.delete(clientId);
        pendingJoins.delete(clientId);

        if (clientInfo.has(clientId)) {
            clientInfo.delete(clientId);

            if (clientId === hostId) {
                const remainingCallMembers = Array.from(clientInfo.keys());
                hostId = remainingCallMembers.length > 0 ? remainingCallMembers[0] : null;
                
                if (hostId) {
                    const newHostSocket = clients.get(hostId);
                    if (newHostSocket) {
                        newHostSocket.send(JSON.stringify({ type: 'set-host' }));
                        console.log(`[Host Migration] ${clientInfo.get(hostId).name} is the new host.`);
                    }
                } else {
                    console.log("[Host Migration] Last member left. No more host.");
                }
            }

            clientInfo.forEach((info, id) => {
                const socket = clients.get(id);
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'peer-disconnected', peerId: clientId, peerName: disconnectedClientName }));
                }
            });
        }
    });
});

// --- بدء تشغيل الخادم ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    // ⬇️ تغيير الرسالة للتأكيد على استخدام HTTPS ⬇️
    console.log(`Server is listening on https://localhost:${PORT}`);
});