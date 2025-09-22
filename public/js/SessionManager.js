/**
 * =================================================================
 * SessionManager (مدير الجلسة) - النسخة النهائية
 * =================================================================
 * * هذا هو الكلاس الأساسي لمنطق التطبيق من جهة العميل (Controller).
 * * التحديثات:
 * - إضافة منطق لإرسال طلب كتم الصوت للمستخدمين الآخرين.
 * - استقبال أمر الكتم من الخادم وتنفيذه محليًا.
 * - استقبال إشعار بكتم صوت مشارك آخر وتحديث واجهة المستخدم.
 * - دمج جميع التحسينات السابقة.
 */
class SessionManager {
    constructor() {
        this.myId = null;
        this.myName = '';
        this.isHost = false;
        this.localStream = null;
        this.peerConnections = new Map();

        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.uiManager = new UIManager(this.handleUserAction.bind(this));
        this.networkClient = new NetworkClient(this.handleNetworkMessage.bind(this));
    }

    init() {
        this.networkClient.connect();
    }

    async handleNetworkMessage(data) {
        console.log('Received from server:', data);
        switch (data.type) {
            case 'assign-id': this.myId = data.id; break;
            case 'set-host': this.isHost = true; break;
            case 'request-to-join': if (this.isHost) this.uiManager.addJoinRequest(data.guestId, data.guestName); break;
            case 'join-approved':
                this.uiManager.hideWaitingModal();
                this.uiManager.showStatusAlert('تمت الموافقة على انضمامك!', 'success');
                data.peers.forEach(peer => this.createAndSendOffer(peer.id, peer.name));
                break;
            case 'join-rejected':
                this.uiManager.hideWaitingModal();
                this.uiManager.showStatusAlert(`تم رفض طلبك: ${data.reason}`, 'danger');
                this.leaveCall();
                break;
            case 'peer-joined': this.uiManager.showStatusAlert(`${data.peerName} انضم للمكالمة.`, 'info'); break;
            case 'peer-disconnected':
                this.uiManager.showStatusAlert(`${data.peerName} غادر المكالمة.`, 'warning');
                this.closePeerConnection(data.peerId);
                break;
            case 'you-were-kicked':
                this.uiManager.showStatusAlert('لقد تم طردك من قبل المضيف.', 'danger');
                this.leaveCall();
                break;
            case 'you-were-muted':
                this.uiManager.showStatusAlert('لقد قام المضيف بكتم صوتك.', 'warning');
                this.toggleMic(true); // فرض الكتم
                break;
            case 'peer-muted':
                this.uiManager.showStatusAlert(`قام المضيف بكتم صوت ${data.peerName}.`, 'info');
                this.uiManager.updateRemoteMuteButton(data.peerId, true);
                break;
            case 'offer': await this.handleOffer(data.from, data.fromName, data.offer); break;
            case 'answer': await this.handleAnswer(data.from, data.answer); break;
            case 'ice-candidate': await this.handleIceCandidate(data.from, data.candidate); break;
            case 'chat-message': this.uiManager.addChatMessage(data.fromName, data.message, data.fromId === this.myId); break;
        }
    }

    async handleUserAction(action, payload) {
        switch (action) {
            case 'start-call':
            case 'join-call': {
                this.myName = document.getElementById('name-input').value.trim();
                if (!this.myName) {
                    this.uiManager.showStatusAlert('الرجاء إدخال اسمك أولاً.', 'warning');
                    return;
                }
                const streamStarted = await this.startLocalStream();
                if (streamStarted) {
                    this.uiManager.showCallView();
                    const type = action === 'start-call' ? 'start-call' : 'request-to-join';
                    if (type === 'request-to-join') this.uiManager.showWaitingModal();
                    this.networkClient.send({ type, name: this.myName });
                }
                break;
            }
            case 'approve-join':
                this.networkClient.send({ type: 'approve-join', guestId: payload });
                this.uiManager.removeJoinRequest(payload);
                break;
            case 'reject-join':
                this.networkClient.send({ type: 'reject-join', guestId: payload });
                this.uiManager.removeJoinRequest(payload);
                break;
            case 'kick-user':
                if (this.isHost) this.networkClient.send({type: 'kick-user', kickId: payload});
                break;
            case 'remote-mute':
                if (this.isHost) {
                    this.networkClient.send({ type: 'remote-mute', muteId: payload });
                }
                break;
            case 'leave-call': this.leaveCall(); break;
            case 'toggle-mic': this.toggleMic(); break;
            case 'toggle-video': this.toggleVideo(); break;
            case 'send-chat':
                this.networkClient.send({ type: 'chat-message', message: payload });
                this.uiManager.addChatMessage('You', payload, true);
                break;
        }
    }
    
    async startLocalStream() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.uiManager.setLocalStream(this.localStream);
            return true;
        } catch (error) {
            console.error('Error accessing media devices.', error);
            this.uiManager.showStatusAlert('لا يمكن الوصول للكاميرا والميكروفون. تأكد من منح الأذونات.', 'danger');
            return false;
        }
    }

    createPeerConnection(peerId, peerName) {
        if (this.peerConnections.has(peerId)) {
            this.closePeerConnection(peerId);
        }

        const pc = new RTCPeerConnection(this.iceServers);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.networkClient.send({ type: 'ice-candidate', to: peerId, candidate: event.candidate });
            }
        };

        pc.ontrack = (event) => {
            this.uiManager.addRemoteStream(event.streams[0], peerId, peerName, this.isHost);
        };

        pc.onconnectionstatechange = () => {
            if (['disconnected', 'closed', 'failed'].includes(pc.connectionState)) {
                this.closePeerConnection(peerId);
            }
        };

        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });

        this.peerConnections.set(peerId, pc);
        return pc;
    }

    async createAndSendOffer(peerId, peerName) {
        const pc = this.createPeerConnection(peerId, peerName);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.networkClient.send({ type: 'offer', to: peerId, offer });
    }

    async handleOffer(peerId, peerName, offer) {
        const pc = this.createPeerConnection(peerId, peerName);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.networkClient.send({ type: 'answer', to: peerId, answer });
    }

    async handleAnswer(peerId, answer) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    async handleIceCandidate(peerId, candidate) {
        const pc = this.peerConnections.get(peerId);
        if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    closePeerConnection(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
            this.uiManager.removeRemoteVideo(peerId);
        }
    }

    leaveCall() {
        this.networkClient.send({ type: 'leave-call' });
        
        this.peerConnections.forEach((pc, peerId) => this.closePeerConnection(peerId));

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.isHost = false;
        this.myName = '';
        this.myId = null;
        
        this.uiManager.showLobbyView();
    }

    toggleMic(forceMute) {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                // إذا كان forceMute هو true، قم بالكتم. وإلا، قم بتبديل الحالة.
                const shouldMute = forceMute === true ? true : !audioTrack.enabled;
                audioTrack.enabled = !shouldMute;
                this.uiManager.toggleMicButton(shouldMute);
            }
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            videoTrack.enabled = !videoTrack.enabled;
            this.uiManager.toggleVideoButton(!videoTrack.enabled);
        }
    }
}