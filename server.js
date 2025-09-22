/**
 * =================================================================
 * WebRTC Signaling Server (الخادم الوسيط لـ WebRTC) - النسخة النهائية
 * =================================================================
 * * هذا الخادم يدير اتصالات WebSocket لتسهيل التواصل بين الأطراف (Peers) في WebRTC.
 * وظيفته هي تنسيق الاتصالات وتمرير الرسائل فقط، ولا يتعامل مع أي وسائط (صوت أو فيديو).
 * * * Responsibilities (المسؤوليات):
 * 1.  تقديم ملفات الواجهة الأمامية الثابتة (HTML, JS, CSS).
 * 2.  إدارة اتصالات العملاء وتعيين مُعرّفات فريدة لهم.
 * 3.  تعيين أول عميل يتصل كـ "مضيف" (Host) بشكل موثوق.
 * 4.  إدارة قائمة انتظار طلبات الانضمام وإرسالها للمضيف.
 * 5.  تمرير رسائل WebRTC (offer, answer, ice-candidate) بين العملاء.
 * 6.  بث رسائل الدردشة لجميع المشاركين.
 * 7.  إدارة عمليات قطع الاتصال وإعلام المشاركين الآخرين.
 * 8.  تمكين المضيف من طرد (kick) وكتم صوت (mute) أي مشارك.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// تقديم الملفات الثابتة من مجلد 'public'
app.use(express.static(path.join(__dirname, 'public')));

// إدارة حالة التطبيق في الذاكرة
let hostId = null; // مُعرّف العميل المضيف الحالي
const clients = new Map(); // يخزن اتصالات WebSocket: Map<clientId, WebSocket>
const clientInfo = new Map(); // يخزن معلومات العملاء (الاسم): Map<clientId, { name: string }>
const pendingJoins = new Set(); // يخزن مُعرّفات الضيوف الذين ينتظرون الموافقة

// --- معالجة اتصالات WebSocket ---
wss.on('connection', (ws) => {
    // 1. تعيين مُعرّف فريد للعميل الجديد وتخزين الاتصال
    const clientId = uuidv4();
    clients.set(clientId, ws);
    console.log(`[Connection] Client ${clientId.substring(0, 8)} connected.`);

    // 2. إبلاغ العميل بالمُعرّف الخاص به
    ws.send(JSON.stringify({ type: 'assign-id', id: clientId }));

    // --- معالجة الرسائل الواردة من العميل ---
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
            // العميل يريد أن يبدأ مكالمة جديدة (يصبح المضيف)
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

            // ضيف يريد الانضمام للمكالمة
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

            // المضيف وافق على طلب انضمام
            case 'approve-join':
                if (clientId !== hostId) return; // الحماية: فقط المضيف يمكنه الموافقة
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

            // المضيف رفض طلب انضمام
            case 'reject-join':
                if (clientId !== hostId) return; // الحماية: فقط المضيف يمكنه الرفض
                const rejectedId = data.guestId;
                pendingJoins.delete(rejectedId);
                const rejectedSocket = clients.get(rejectedId);
                if (rejectedSocket && rejectedSocket.readyState === WebSocket.OPEN) {
                    rejectedSocket.send(JSON.stringify({ type: 'join-rejected', reason: 'Host rejected the request.' }));
                }
                break;

            // المضيف يريد طرد مستخدم
            case 'kick-user':
                if (clientId !== hostId) return; // الحماية: فقط المضيف يمكنه الطرد
                const userToKickId = data.kickId;
                const kickedSocket = clients.get(userToKickId);
                if (kickedSocket && kickedSocket.readyState === WebSocket.OPEN) {
                    kickedSocket.send(JSON.stringify({ type: 'you-were-kicked' }));
                    kickedSocket.close();
                }
                break;

            // المضيف يريد كتم صوت مستخدم آخر
            case 'remote-mute':
                if (clientId !== hostId) return; // الحماية: فقط المضيف يمكنه الكتم
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

            // تمرير رسائل WebRTC
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                const targetSocket = clients.get(data.to);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    const message = { ...data, from: clientId, fromName: clientInfo.get(clientId)?.name };
                    targetSocket.send(JSON.stringify(message));
                }
                break;

            // رسالة دردشة
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

    // --- معالجة قطع اتصال العميل ---
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
    console.log(`Server is listening on port ${PORT}`);
});