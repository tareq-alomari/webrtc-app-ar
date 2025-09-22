/**
 * WebRTC Signaling Server
 * 
 * This server manages WebSocket connections to facilitate WebRTC peer-to-peer communication.
 * It does NOT handle any media streams; it only coordinates connections and relays messages.
 * 
 * Responsibilities:
 * 1. Serve the static frontend files (HTML, JS, CSS).
 * 2. Manage client connections and assign unique IDs and names.
 * 3. Designate the first connected client as the "Host".
 * 4. Handle the "request-to-join" flow, where guests ask the host for permission.
 * 5. Relay WebRTC signaling messages (offer, answer, ice-candidate) between specific clients.
 * 6. Broadcast chat messages to all participants.
 * 7. Manage client disconnections and notify other participants.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state management
let hostId = null; // The clientId of the current host
const clients = new Map(); // Stores WebSocket instances: Map<clientId, WebSocket>
const clientNames = new Map(); // Stores user-friendly names: Map<clientId, name>

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    // 1. Assign a unique ID to the new client
    const clientId = uuidv4();
    clients.set(clientId, ws);

    console.log(`Client ${clientId} connected`);

    // 2. Inform the client of its assigned ID. The client will send its name later.
    ws.send(JSON.stringify({ type: 'assign-id', id: clientId }));

    // --- Message Handling for each Client ---
    ws.on('message', (rawMessage) => {
        let data;
        try {
            data = JSON.parse(rawMessage);
        } catch (error) {
            console.error("Failed to parse message:", rawMessage);
            return;
        }
        
        const senderName = clientNames.get(clientId) || `User-${clientId.substring(0,4)}`;
        console.log(`Message from ${senderName}:`, data.type);

        switch (data.type) {
            // A client wants to start a call, becoming the host.
            case 'start-call':
                // Only allow a new host if one doesn't already exist.
                if (!hostId) {
                    hostId = clientId;
                    clientNames.set(clientId, data.name);
                    console.log(`${data.name} (${clientId}) is the host.`);
                    ws.send(JSON.stringify({ type: 'set-host' }));
                }
                // If a host already exists, this request is ignored to prevent multiple hosts.
                break;

            // A guest wants to join the call
            case 'request-to-join':
                clientNames.set(clientId, data.name);
                const hostSocket = clients.get(hostId);
                if (hostSocket && hostSocket.readyState === WebSocket.OPEN) {
                    // Forward the request to the host for approval
                    hostSocket.send(JSON.stringify({
                        type: 'request-to-join',
                        guestId: clientId,
                        guestName: data.name
                    }));
                } else {
                    // If there's no host, reject the join request.
                    ws.send(JSON.stringify({ type: 'join-rejected', reason: 'No host is available.' }));
                }
                break;

            // The host approved a guest's request
            case 'approve-join':
                const guestSocket = clients.get(data.guestId);
                if (guestSocket && guestSocket.readyState === WebSocket.OPEN) {
                    // Get info of all other clients already in the call (including host)
                    const peers = Array.from(clients.keys())
                        .filter(id => id !== data.guestId && clients.get(id).readyState === WebSocket.OPEN)
                        .map(id => ({ id, name: clientNames.get(id) }));

                    // Notify the guest that they are approved and send them the list of current participants
                    guestSocket.send(JSON.stringify({ 
                        type: 'join-approved', 
                        hostId: hostId,
                        hostName: clientNames.get(hostId),
                        peers: peers 
                    }));

                    // Notify all *other* clients about the new peer who just joined
                    const newPeerName = clientNames.get(data.guestId);
                    clients.forEach((socket, id) => {
                        if (id !== data.guestId && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'peer-joined', peerId: data.guestId, peerName: newPeerName }));
                        }
                    });
                }
                break;

            // The host rejected a guest's request
            case 'reject-join':
                const rejectedSocket = clients.get(data.guestId);
                if (rejectedSocket && rejectedSocket.readyState === WebSocket.OPEN) {
                    // Inform the guest that their request was rejected
                    rejectedSocket.send(JSON.stringify({ type: 'join-rejected', reason: 'Host rejected the request.' }));
                }
                break;

            // Relay WebRTC signaling messages to the intended target client
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                const targetSocket = clients.get(data.to);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    // Forward the message, adding the sender's ID and name
                    const message = {
                        type: data.type,
                        from: clientId,
                        fromName: clientNames.get(clientId)
                    };
                    // Add the specific payload for each message type
                    if (data.offer) message.offer = data.offer;
                    if (data.answer) message.answer = data.answer;
                    if (data.candidate) message.candidate = data.candidate;
                    
                    targetSocket.send(JSON.stringify(message));
                }
                break;

            // A client sent a chat message
            case 'chat-message':
                // Broadcast the chat message to every connected client
                clients.forEach((socket, id) => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'chat-message',
                            fromId: clientId,
                            fromName: clientNames.get(clientId),
                            message: data.message
                        }));
                    }
                });
                break;
            
            // A client is leaving the call
            case 'leave-call':
                // This is handled by the 'close' event handler
                ws.close();
                break;
        }
    });

    // --- Client Disconnection Handling ---
    ws.on('close', () => {
        const disconnectedClientName = clientNames.get(clientId) || `Client ${clientId.substring(0,4)}`;
        console.log(`${disconnectedClientName} disconnected`);
        
        // Clean up disconnected client's data
        clients.delete(clientId);
        clientNames.delete(clientId);

        // If the host disconnected, assign a new host or end the call
        if (clientId === hostId) {
            const remainingClients = Array.from(clients.keys());
            hostId = remainingClients.length > 0 ? remainingClients[0] : null; // Naive new host assignment
            if (hostId) {
                const newHostSocket = clients.get(hostId);
                if (newHostSocket) {
                    newHostSocket.send(JSON.stringify({ type: 'set-host' }));
                    console.log(`${clientNames.get(hostId)} is the new host.`);
                }
            } else {
                console.log("Last client left. No host.");
            }
        }

        // Notify all remaining clients that a peer has disconnected
        clients.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'peer-disconnected', peerId: clientId, peerName: disconnectedClientName }));
            }
        });
    });
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});