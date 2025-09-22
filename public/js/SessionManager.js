/**
 * SessionManager
 * 
 * This is the core class for the client-side application logic. It acts as
 * the "Controller" in a Model-View-Controller-like pattern. It orchestrates
 * the UIManager and the NetworkClient to manage the user's session, from
 * joining a call to handling all WebRTC signaling and media streams.
 */
class SessionManager {
    constructor() {
        // The local user's unique ID, assigned by the server.
        this.myId = null;
        // The local user's chosen name.
        this.myName = '';
        // The ID of the user who is the host of the call.
        this.hostId = null;
        // The local user's audio/video stream.
        this.localStream = null;
        // A map to store all active RTCPeerConnection objects, keyed by peer ID.
        this.peerConnections = new Map();
        // A flag to track if the local user is the host.
        this.isHost = false;
        // The ID of a guest whose join request is currently being shown to the host.
        this.pendingGuestId = null;

        // Configuration for STUN servers, used to discover the public IP address.
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Instantiate the UI and Network managers.
        // Pass `handleUserAction` as a callback to UIManager to receive UI events.
        this.uiManager = new UIManager(this.handleUserAction.bind(this));
        // Pass `handleNetworkMessage` as a callback to NetworkClient to receive server messages.
        this.networkClient = new NetworkClient(this.handleNetworkMessage.bind(this));
    }

    /**
     * Initializes the application by connecting to the signaling server.
     */
    async init() {
        this.networkClient.connect();
    }

    /**
     * Handles all incoming messages from the signaling server. This function
     * acts as a state machine, processing messages based on their type.
     * @param {object} data - The parsed JSON data from the server.
     */
    async handleNetworkMessage(data) {
        console.log('Received from server:', data);
        switch (data.type) {
            // Server assigns a unique ID and confirms connection.
            case 'assign-id':
                this.myId = data.id;
                console.log(`Assigned ID: ${this.myId}`);
                break;

            // Server designates this client as the host.
            case 'set-host':
                this.isHost = true;
                this.hostId = this.myId;
                console.log('أنت المضيف.');
                break;

            // A new guest has requested to join the call. (Host only)
            case 'request-to-join':
                if (this.isHost) {
                    this.pendingGuestId = data.guestId;
                    this.uiManager.showApprovalModal(data.guestId, data.guestName);
                }
                break;

            // The join request was approved by the host. (Guest only)
            case 'join-approved':
                this.hostId = data.hostId;
                this.uiManager.hideWaitingModal();
                this.uiManager.showStatusAlert('تمت الموافقة على طلبك للانضمام!', 'success');
                
                // The `peers` array contains everyone already in the call.
                // We need to create a connection for each of them.
                if (data.peers) {
                    data.peers.forEach(peer => {
                        this.createAndSendOffer(peer.id, peer.name);
                    });
                }
                break;

            // The join request was rejected by the host. (Guest only)
            case 'join-rejected':
                this.uiManager.hideWaitingModal();
                this.uiManager.showStatusAlert(`تم رفض طلبك للانضمام. السبب: ${data.reason}`, 'danger');
                // Reset state to allow trying again.
                this.leaveCall();
                break;

            // A new peer has joined the call, and we need to establish a connection.
            case 'peer-joined':
                // This is received by existing clients when a new peer is approved.
                // The new peer will initiate the connection with an offer, so we just wait.
                this.uiManager.showStatusAlert(`${data.peerName} انضم إلى المكالمة.`, 'info');
                break;

            // A peer has left the call.
            case 'peer-disconnected':
                this.uiManager.showStatusAlert(`${data.peerName} غادر المكالمة.`, 'warning');
                this.closePeerConnection(data.peerId);
                break;

            // Received a WebRTC offer from a peer.
            case 'offer':
                await this.handleOffer(data.from, data.fromName, data.offer);
                break;

            // Received a WebRTC answer from a peer.
            case 'answer':
                await this.handleAnswer(data.from, data.answer);
                break;

            // Received an ICE candidate from a peer.
            case 'ice-candidate':
                await this.handleIceCandidate(data.from, data.candidate);
                break;
            
            // Received a chat message from a peer.
            case 'chat-message':
                this.uiManager.addChatMessage(data.fromName, data.message, false);
                break;
        }
    }

    /**
     * Handles all actions initiated by the user from the UI.
     * @param {string} action - The type of action (e.g., 'start-call', 'toggle-mic').
     * @param {*} payload - Any data associated with the action (e.g., chat message).
     */
    async handleUserAction(action, payload) {
        switch (action) {
            case 'start-call': {
                this.myName = document.getElementById('name-input').value.trim() || 'User-' + Date.now().toString().slice(-4);
                // Start the stream first, and only proceed if successful.
                const streamStarted = await this.startLocalStream();
                if (streamStarted) {
                    this.isHost = true;
                        this.uiManager.showCallView();
                    // Notify server that we are starting a call as host
                    this.networkClient.send({ type: 'start-call', name: this.myName });
                }
                break;
            }

            case 'join-call': {
                this.myName = document.getElementById('name-input').value.trim() || 'User-' + Date.now().toString().slice(-4);
                const streamStarted = await this.startLocalStream();
                if (streamStarted) {
                    this.uiManager.showCallView();
                    this.uiManager.showWaitingModal();
                    // Request to join the call
                    this.networkClient.send({ type: 'request-to-join', name: this.myName });
                }
                break;
            }

            case 'approve-join':
                if (this.isHost && this.pendingGuestId) {
                    this.networkClient.send({ type: 'approve-join', guestId: this.pendingGuestId });
                    this.uiManager.hideApprovalModal();
                    this.pendingGuestId = null;
                }
                break;

            case 'reject-join':
                if (this.isHost && this.pendingGuestId) {
                    this.networkClient.send({ type: 'reject-join', guestId: this.pendingGuestId });
                    this.uiManager.hideApprovalModal();
                    this.pendingGuestId = null;
                }
                break;

            case 'leave-call':
                this.leaveCall();
                break;

            case 'toggle-mic':
                this.toggleMic();
                break;


            case 'toggle-video':
                this.toggleVideo();
                break;

            case 'toggle-chat':
                this.uiManager.toggleChat();
                break;

            case 'send-chat':
                this.uiManager.addChatMessage(this.myName, payload, true);
                this.networkClient.send({ type: 'chat-message', message: payload });
                break;
        }
    }

    /**
     * Requests access to the user's camera and microphone and displays the stream.
     */
    async startLocalStream() {
        // Wrap getUserMedia with a timeout to fail fast if camera initialization stalls
        const getUserMediaWithTimeout = (constraints, timeoutMs = 8000) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout starting video source')), timeoutMs);
                navigator.mediaDevices.getUserMedia(constraints)
                    .then(stream => {
                        clearTimeout(timer);
                        resolve(stream);
                    })
                    .catch(err => {
                        clearTimeout(timer);
                        reject(err);
                    });
            });
        };

        try {
            this.localStream = await getUserMediaWithTimeout({ video: true, audio: true }, 8000);
            this.uiManager.setLocalStream(this.localStream);
            return true; // Indicate success
        } catch (error) {
            console.error('Error accessing media devices.', error);
            this.uiManager.showStatusAlert('تعذر الوصول إلى الكاميرا والميكروفون. تأكد من أن التطبيق الآخر لا يستخدم الكاميرا وحاول مرة أخرى.', 'danger');
            return false; // Indicate failure
        }
    }

    /**
     * Creates an RTCPeerConnection for a given peer.
     * @param {string} peerId - The ID of the peer to connect to.
     * @param {string} peerName - The name of the peer, used for UI display.
     * @returns {RTCPeerConnection} The newly created peer connection.
     */
    createPeerConnection(peerId, peerName) {
        // If a connection already exists, close it before creating a new one.
        if (this.peerConnections.has(peerId)) {
            console.warn(`Closing existing peer connection for ${peerId} before creating new one.`);
            this.closePeerConnection(peerId);
        }

        const pc = new RTCPeerConnection(this.iceServers);

        // Set up event handlers for the peer connection.
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.networkClient.send({
                    type: 'ice-candidate',
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`Track received from ${peerId}`);
            // When a track is received, add the remote stream to the UI.
            this.uiManager.addRemoteStream(event.streams[0], peerId, peerName);
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                this.closePeerConnection(peerId);
            }
        };

        // Add local stream tracks to the connection so they are sent to the peer.
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        this.peerConnections.set(peerId, pc);
        return pc;
    }

    /**
     * Creates a WebRTC offer and sends it to a peer.
     * @param {string} peerId - The ID of the peer to send the offer to.
     * @param {string} peerName - The name of the peer.
     */
    async createAndSendOffer(peerId, peerName) {
        // Create a visible placeholder slot for the remote peer immediately
        this.uiManager.addRemoteStream(null, peerId, peerName);

        const pc = this.createPeerConnection(peerId, peerName);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.networkClient.send({ type: 'offer', to: peerId, offer: offer });
    }

    /**
     * Handles an incoming offer from a peer, creates an answer, and sends it back.
     * @param {string} peerId - The ID of the peer who sent the offer.
     * @param {string} peerName - The name of the peer.
     * @param {RTCSessionDescriptionInit} offer - The offer object.
     */
    async handleOffer(peerId, peerName, offer) {
        const pc = this.createPeerConnection(peerId, peerName);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.networkClient.send({ type: 'answer', to: peerId, answer: answer });
    }

    /**
     * Handles an incoming answer from a peer.
     * @param {string} peerId - The ID of the peer who sent the answer.
     * @param {RTCSessionDescriptionInit} answer - The answer object.
     */
    async handleAnswer(peerId, answer) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`Connection established with ${peerId}`);
        }
    }

    /**
     * Handles an incoming ICE candidate from a peer.
     * @param {string} peerId - The ID of the peer who sent the candidate.
     * @param {RTCIceCandidateInit} candidate - The ICE candidate object.
     */
    async handleIceCandidate(peerId, candidate) {
        const pc = this.peerConnections.get(peerId);
        if (pc && pc.remoteDescription && candidate) { // Only add candidate if remote description is set
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding received ICE candidate', error);
            }
        }
    }

    /**
     * Closes the peer connection and removes the video feed for a specific peer.
     * @param {string} peerId - The ID of the peer to disconnect from.
     */
    closePeerConnection(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
            this.uiManager.removeRemoteVideo(peerId);
            console.log(`Closed peer connection with ${peerId}`);
        }
    }

    /**
     * Handles the process of leaving the call.
     */
    leaveCall() {
        // Close all peer connections
        this.peerConnections.forEach((pc, peerId) => {
            this.closePeerConnection(peerId);
        });

        // Stop local media tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Reset state
        this.isHost = false;
        this.hostId = null;
        this.myName = '';
        
        // Notify the server
        this.networkClient.send({ type: 'leave-call' });

        // Reset the UI
        this.uiManager.showLobbyView();
    }

    /**
     * Toggles the enabled state of the local audio track.
     */
    toggleMic() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.uiManager.toggleMicButton(!audioTrack.enabled);
            }
        }
    }

    /**
     * Toggles the enabled state of the local video track.
     */
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.uiManager.toggleVideoButton(!videoTrack.enabled);
            }
        }
    }
}