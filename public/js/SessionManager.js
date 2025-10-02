/**
 * =================================================================
 * SessionManager (مدير الجلسة) - النسخة الكاملة والمصححة
 * =================================================================
 */

class SessionManager {
    constructor() {
        this.myId = null;
        this.callId = null;
        this.myName = '';
        this.isHost = false;
        this.myHandRaised = false;
        this.localStream = null;
        this.peerConnections = new Map();
        this.activePoll = null;
        this.connectionStates = new Map();
        this.queuedIceCandidates = new Map();
        this.reconnectionAttempts = new Map();

        this.mediaConstraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        this.uiManager = new UIManager(this.handleUserAction.bind(this));
        this.networkClient = new NetworkClient(this.handleNetworkMessage.bind(this));
        
        this.reconnectionTimeout = null;
        this.isLeaving = false;
    }

    /**
     * تهيئة التطبيق
     */
    init() {
        console.log('🚀 تهيئة مدير الجلسة...');
        this.networkClient.connect();
        this.setupBeforeUnload();
    }

    /**
     * إعداد حدث قبل إغلاق الصفحة
     */
    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            if (this.localStream || this.peerConnections.size > 0) {
                this.leaveCall();
            }
        });
    }

    /**
     * معالجة رسائل الشبكة
     */
    async handleNetworkMessage(data) {
        console.log('📨 Received from server:', data);
        
        try {
            switch (data.type) {
                case 'assign-id':
                    this.myId = data.id;
                    this.networkClient.setClientId(data.id);
                    console.log(`🆔 Assigned client ID: ${this.myId}`);
                    break;

                case 'set-host':
                    this.isHost = true;
                    this.callId = data.callId;
                    this.uiManager.showStatusAlert('أنت الآن المضيف في المكالمة', 'success');
                    console.log('👑 This client is now the host');
                    break;
                
                case 'new-poll':
                    this.activePoll = data.poll;
                    this.uiManager.displayPoll(data.poll, this.isHost);
                    break;
                
                case 'poll-update':
                    this.uiManager.updatePollResults(data.poll);
                    break;
                case 'poll-ended':
                    this.uiManager.endPoll(data.poll);
                    break;

                case 'host-changed':
                    this.uiManager.showStatusAlert(`أصبح ${data.newHostName} المضيف الجديد`, 'info');
                    break;

                case 'request-to-join':
                    if (this.isHost) {
                        this.uiManager.addJoinRequest(data.guestId, data.guestName);
                    }
                    break;

                case 'join-approved':
                    await this.handleJoinApproved(data);
                    break;

                case 'join-rejected':
                    this.handleJoinRejected(data);
                    break;

                case 'peer-joined':
                    await this.handlePeerJoined(data);
                    break;

                case 'peer-disconnected':
                    this.handlePeerDisconnected(data);
                    break;

                case 'you-were-kicked':
                    this.handleKicked();
                    break;

                case 'you-were-muted':
                    this.handleRemoteMute();
                    break;

                case 'you-were-unmuted':
                    this.handleRemoteUnmute();
                    break;

                case 'peer-hand-state':
                    this.uiManager.toggleHandState(data.peerId, data.raised);
                    break;

                case 'peer-muted':
                    this.handlePeerMuted(data);
                    break;

                case 'peer-unmuted':
                    this.handlePeerUnmuted(data);
                    break;

                case 'offer':
                    await this.handleOffer(data.from, data.fromName, data.offer);
                    break;

                case 'answer':
                    await this.handleAnswer(data.from, data.answer);
                    break;

                case 'ice-candidate':
                    await this.handleIceCandidate(data.from, data.candidate);
                    break;

                case 'chat-message':
                    this.uiManager.addChatMessage(data.fromName, data.message, data.fromId === this.myId, data.timestamp, false);
                    break;
                
                case 'private-message':
                    this.uiManager.addChatMessage(data.fromName, data.message, data.fromId === this.myId, data.timestamp, true);
                    break;

                case 'connection-closed':
                    this.handleConnectionClosed(data);
                    break;

                case 'connection-error':
                    this.handleConnectionError(data);
                    break;

                case 'reconnecting':
                    this.handleReconnecting(data);
                    break;

                case 'error':
                    this.uiManager.showStatusAlert(data.message, 'danger');
                    break;

                default:
                    console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling network message:', error);
            this.uiManager.showStatusAlert('حدث خطأ في معالجة الرسالة', 'danger');
        }
    }

    /**
     * معالجة إجراءات المستخدم
     */
    async handleUserAction(action, payload) {
        console.log(`🎯 User action: ${action}`, payload);
        if (action === 'is-host') {
            return this.isHost;
        }

        try {
            switch (action) {
                case 'start-call':
                case 'join-call':
                    await this.handleCallAction(action);
                    break;

                case 'approve-join':
                    this.networkClient.send({ type: 'approve-join', guestId: payload });
                    this.uiManager.removeJoinRequest(payload);
                    break;

                case 'reject-join':
                    this.networkClient.send({ type: 'reject-join', guestId: payload });
                    this.uiManager.removeJoinRequest(payload);
                    break;

                case 'kick-user':
                    if (this.isHost) {
                        this.networkClient.send({ type: 'kick-user', kickId: payload });
                    }
                    break;

                case 'remote-mute':
                    if (this.isHost) {
                        this.networkClient.send({ type: 'toggle-remote-mute', muteId: payload.peerId, shouldMute: payload.shouldMute });
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

                case 'toggle-hand':
                    this.myHandRaised = !this.myHandRaised;
                    this.networkClient.send({ type: 'hand-state', raised: this.myHandRaised });
                    this.uiManager.toggleHandState('local', this.myHandRaised);
                    break;
                
                case 'start-poll':
                    if (this.isHost) {
                        this.networkClient.send({ type: 'create-poll', poll: payload });
                    }
                    break;
                case 'submit-vote':
                    this.networkClient.send({ type: 'submit-vote', vote: payload });
                    break;
                
                case 'end-poll':
                    if (this.isHost && this.activePoll) {
                        this.networkClient.send({ type: 'end-poll', pollId: this.activePoll.id });
                    }
                    break;
                case 'send-chat':
                    this.networkClient.send({ type: 'chat-message', message: payload });
                    break;
                
                case 'send-private-chat':
                    this.networkClient.send({ type: 'private-message', to: payload.to, message: payload.message });
                    break;

                case 'copy-invite-link':
                    if (this.isHost && this.callId) {
                        const inviteLink = `${window.location.origin}?callId=${this.callId}`;
                        navigator.clipboard.writeText(inviteLink)
                            .then(() => this.uiManager.showStatusAlert('تم نسخ رابط الدعوة بنجاح!', 'success'));
                    }
                    break;
                default:
                    console.warn('Unknown user action:', action);
            }
        } catch (error) {
            console.error('Error handling user action:', error);
            this.uiManager.showStatusAlert('حدث خطأ في تنفيذ الإجراء', 'danger');
        }
    }

    /**
     * معالجة بدء أو انضمام مكالمة
     */
    async handleCallAction(action) {
        this.myName = this.uiManager.getUserName();
        
        if (!this.myName) {
            this.uiManager.showStatusAlert('الرجاء إدخال اسمك أولاً', 'warning');
            return;
        }

        if (this.myName.length < 2) {
            this.uiManager.showStatusAlert('الاسم يجب أن يكون على الأقل حرفين', 'warning');
            return;
        }

        const streamStarted = await this.startLocalStream();
        if (!streamStarted) {
            return;
        }

        this.uiManager.showCallView();
        
        if (action === 'start-call') {
            this.networkClient.send({ type: 'start-call', name: this.myName });
            this.uiManager.showStatusAlert('تم بدء المكالمة بنجاح', 'success');
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            const callIdFromUrl = urlParams.get('callId');
            this.networkClient.send({ 
                type: 'request-to-join', 
                name: this.myName,
                callId: callIdFromUrl // قد تكون القيمة null
            });
            this.uiManager.showWaitingModal();
        }
    }

    /**
     * بدء تدفق الوسائط المحلي
     */
    async startLocalStream() {
        try {
            console.log('🎥 Requesting media devices with HTTPS...');
            
            const constraints = {
                video: {
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 30, max: 60 },
                    facingMode: 'user'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 2
                }
            };
            
            console.log('📋 Using constraints:', constraints);
            
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            console.log('✅ Media stream obtained successfully!', {
                videoTracks: this.localStream.getVideoTracks().length,
                audioTracks: this.localStream.getAudioTracks().length,
                videoSettings: this.localStream.getVideoTracks()[0]?.getSettings(),
                audioSettings: this.localStream.getAudioTracks()[0]?.getSettings()
            });

            this.uiManager.setLocalStream(this.localStream);
            this.uiManager.showStatusAlert('تم تفعيل الكاميرا والميكروفون بنجاح!', 'success');
            
            return true;

        } catch (error) {
            console.error('❌ Error accessing media devices:', error);
            
            let errorMessage = 'لا يمكن الوصول للكاميرا والميكروفون. ';
            let errorType = 'danger';
            
            switch (error.name) {
                case 'NotAllowedError':
                case 'PermissionDeniedError':
                    errorMessage = 'تم رفض الإذن للوصول إلى الكاميرا والميكروفون. ';
                    errorMessage += 'يرجى منح الصلاحيات في المتصفح وإعادة تحميل الصفحة.';
                    errorType = 'warning';
                    break;
                    
                case 'NotFoundError':
                case 'DevicesNotFoundError':
                    errorMessage = 'لم يتم العثور على كاميرا أو ميكروفون. ';
                    errorMessage += 'تأكد من توصيل الجهاز وإعادة تحميل الصفحة.';
                    break;
                    
                case 'NotReadableError':
                case 'TrackStartError':
                    errorMessage = 'الكاميرا أو الميكروفون مستخدمة من قبل تطبيق آخر. ';
                    errorMessage += 'أغبق التطبيقات الأخرى وأعد تحميل الصفحة.';
                    break;
                    
                case 'OverconstrainedError':
                case 'ConstraintNotSatisfiedError':
                    errorMessage = 'لا تدعم الكاميرا المتطلبات المطلوبة. ';
                    errorMessage += 'جاري استخدام إعدادات بديلة...';
                    errorType = 'warning';
                    
                    try {
                        const fallbackConstraints = { video: true, audio: true };
                        this.localStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
                        this.uiManager.setLocalStream(this.localStream);
                        this.uiManager.showStatusAlert('تم تفعيل الكاميرا بإعدادات بديلة', 'success');
                        return true;
                    } catch (fallbackError) {
                        errorMessage = 'فشل استخدام الإعدادات البديلة أيضاً.';
                    }
                    break;
                    
                default:
                    errorMessage += `خطأ: ${error.message}`;
            }
            
            this.uiManager.showStatusAlert(errorMessage, errorType);
            return false;
        }
    }

   /**
 * الحصول على اتصال نظير موجود أو إنشاء جديد
 */
getOrCreatePeerConnection(peerId, peerName) {
    if (this.peerConnections.has(peerId)) {
        const existingPc = this.peerConnections.get(peerId);
        const state = this.connectionStates.get(peerId);
        
        // كن أكثر تساهلاً في إعادة استخدام الاتصالات
        const isReusable = state && 
                          (state.iceState === 'connected' || state.iceState === 'completed' || 
                           state.signalingState === 'stable' || state.signalingState === 'have-local-offer');
        
        if (isReusable) {
            console.log(`✅ Reusing connection for ${peerName} (${state.iceState}/${state.signalingState})`);
            return existingPc;
        } else {
            console.log(`🔄 Existing connection for ${peerName} is not reusable: ${state?.iceState}/${state?.signalingState}, recreating...`);
            this.closePeerConnection(peerId);
        }
    }
    
    return this.createPeerConnection(peerId, peerName);
}

  /**
 * إنشاء اتصال نظير جديد
 */
createPeerConnection(peerId, peerName) {
    // إغلاق الاتصال الحالي إذا موجود
    if (this.peerConnections.has(peerId)) {
        console.log(`🔄 Closing existing connection for ${peerName}`);
        this.closePeerConnection(peerId);
    }

    console.log(`🔗 Creating new peer connection for ${peerName}`);
    
    try {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 5,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });
        
        // تتبع حالة الاتصال
        this.connectionStates.set(peerId, {
            iceState: 'new',
            signalingState: 'stable',
            connectionState: 'new',
            createdAt: Date.now()
        });

        // إعداد معالج الأحداث
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const candidateType = this.getCandidateType(event.candidate.candidate);
                console.log(`🧊 Outgoing ICE candidate for ${peerName}: ${candidateType}`);
                this.networkClient.send({ 
                    type: 'ice-candidate', 
                    to: peerId, 
                    candidate: event.candidate 
                });
            } else {
                console.log(`✅ All ICE candidates gathered for ${peerName}`);
            }
        };

        pc.ontrack = (event) => {
            console.log(`📹 Received remote ${event.track.kind} track from ${peerName}`, event.streams);
            if (event.streams && event.streams[0]) {
                this.uiManager.addRemoteStream(event.streams[0], peerId, peerName, this.isHost);
                console.log(`✅ Remote stream added to UI for ${peerName}`);
            }
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            console.log(`🔗 ICE connection state for ${peerName}: ${state}`);
            
            this.connectionStates.get(peerId).iceState = state;
            
            if (state === 'connected' || state === 'completed') {
                console.log(`🎉 ICE connection established with ${peerName}`);
                this.uiManager.showStatusAlert(`الاتصال مع ${peerName} مكتمل!`, 'success', 3000);
            } else if (state === 'disconnected' || state === 'failed') {
                console.warn(`⚠️ Connection issue with ${peerName}: ${state}`);
                this.uiManager.showStatusAlert(`مشكلة في الاتصال مع ${peerName}`, 'warning');
            }
        };

        pc.onsignalingstatechange = () => {
            console.log(`📡 Signaling state for ${peerName}: ${pc.signalingState}`);
            this.connectionStates.get(peerId).signalingState = pc.signalingState;
        };

        // إضافة المسارات المحلية للاتصال
        if (this.localStream) {
            console.log(`🎯 Adding local tracks to ${peerName}`);
            this.localStream.getTracks().forEach(track => {
                try {
                    pc.addTrack(track, this.localStream);
                    console.log(`➕ Added ${track.kind} track to ${peerName}`);
                } catch (error) {
                    console.error(`❌ Failed to add ${track.kind} track:`, error);
                }
            });
        }

        this.peerConnections.set(peerId, pc);

        // معالجة المرشحات المعلقة عند اكتمال الاتصال
const checkAndProcessQueued = () => {
    if (pc.remoteDescription && this.queuedIceCandidates && this.queuedIceCandidates.has(peerId)) {
        this.processQueuedIceCandidates(peerId);
    }
};

pc.onsignalingstatechange = () => {
    const state = pc.signalingState;
    console.log(`📡 Signaling state for ${peerName}: ${state}`);
    this.connectionStates.get(peerId).signalingState = state;
    
    // معالجة المرشحات المعلقة عند تغيير الحالة
    if (state === 'stable') {
        setTimeout(checkAndProcessQueued, 100);
    }
};
        return pc;
        
    } catch (error) {
        console.error(`❌ Failed to create peer connection for ${peerName}:`, error);
        return null;
    }
}

    /**
     * إعادة تشغيل اتصال نظير بذكاء
     */
    async restartPeerConnection(peerId, peerName) {
        console.log(`🔄 Intelligently restarting peer connection for ${peerName}`);
        
        const connectionState = this.connectionStates.get(peerId);
        const connectionAge = Date.now() - (connectionState?.createdAt || 0);
        
        if (connectionAge > 30000) {
            console.log(`🔄 Connection is old (${connectionAge}ms), creating fresh connection`);
            this.closePeerConnection(peerId);
            
            if (this.isHost) {
                await this.createAndSendOffer(peerId, peerName);
            }
            return;
        }
        
        if (this.isHost) {
            console.log(`🔄 Host is re-offering to ${peerName}`);
            await this.createAndSendOffer(peerId, peerName);
        } else {
            console.log(`🔄 Guest waiting for new offer from ${peerName}`);
        }
    }


    /**
 * تسجيل إحصائيات الاتصال
 */
async logConnectionStats(peerId, peerName) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    try {
        const stats = await pc.getStats();
        let audioStats = { inbound: 0, outbound: 0 };
        let videoStats = { inbound: 0, outbound: 0 };

        stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                audioStats.inbound = report.bytesReceived || 0;
            }
            if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                audioStats.outbound = report.bytesSent || 0;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                videoStats.inbound = report.bytesReceived || 0;
            }
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                videoStats.outbound = report.bytesSent || 0;
            }
        });

        console.log(`📊 Connection stats for ${peerName}:`, {
            audio: audioStats,
            video: videoStats,
            iceState: pc.iceConnectionState,
            signalingState: pc.signalingState
        });
    } catch (error) {
        console.warn(`⚠️ Could not get stats for ${peerName}:`, error);
    }
}

    /**
     * إنشاء اتصال نظير وإرسال عرض
     */
    async createAndSendOffer(peerId, peerName) {
        try {
            console.log(`🤝 Creating peer connection and offer for ${peerName}`);
            
            const pc = this.getOrCreatePeerConnection(peerId, peerName);
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            };
            
            const offer = await pc.createOffer(offerOptions);
            console.log(`✅ Offer created for ${peerName}`);
            
            await pc.setLocalDescription(offer);
            console.log(`✅ Local description set for ${peerName}`);
            
            this.networkClient.send({ 
                type: 'offer', 
                to: peerId, 
                offer 
            });
            
            console.log(`✅ Offer sent to ${peerName}`);
        } catch (error) {
            console.error(`❌ Error creating offer for ${peerName}:`, error);
            this.uiManager.showStatusAlert(`فشل في الاتصال بـ ${peerName}`, 'danger');
        }
    }

    /**
 * معالجة عرض اتصال وارد
 */
async handleOffer(peerId, peerName, offer) {
    try {
        console.log(`📥 Handling offer from ${peerName}`);
        
        const pc = this.getOrCreatePeerConnection(peerId, peerName);
        if (!pc) {
            console.error(`❌ Failed to create peer connection for ${peerName}`);
            return;
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description set for ${peerName}`);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`✅ Local description set for ${peerName}`);
        
        this.networkClient.send({ 
            type: 'answer', 
            to: peerId, 
            answer 
        });
        
        console.log(`✅ Answer created and sent to ${peerName}`);
        
        // معالجة المرشحات المعلقة بعد إعداد الاتصال
        setTimeout(() => this.processQueuedIceCandidates(peerId), 200);
        
    } catch (error) {
        console.error(`❌ Error handling offer from ${peerName}:`, error);
        this.uiManager.showStatusAlert(`فشل في معالجة اتصال من ${peerName}`, 'danger');
    }
}

  /**
 * معالجة إجابة اتصال وارد
 */
async handleAnswer(peerId, answer) {
    try {
        const pc = this.peerConnections.get(peerId);
        if (!pc) {
            console.error(`❌ No peer connection found for ${peerId} when handling answer`);
            return;
        }

        const currentState = pc.signalingState;
        console.log(`📡 Current signaling state for ${peerId}: ${currentState}`);

        // نعالج الإجابة في جميع الحالات ما عدا إذا كنا في حالة 'stable' نهائية
        if (currentState === 'have-local-offer') {
            // الحالة المثالية - نعالج الإجابة مباشرة
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`✅ Answer processed for ${peerId}, new state: ${pc.signalingState}`);
        } else if (currentState === 'stable') {
            // إذا كنا بالفعل في حالة مستقرة، فهذا يعني أن الاتصال قد تم أو في طريقه للاكتمال.
            // تجاهل هذه الإجابة الإضافية لتجنب حالة السباق (glare).
            console.warn(`⚠️ Received answer for ${peerId} while in 'stable' state. Ignoring to prevent glare.`);
        } else {
            // أي حالة أخرى - نحاول معالجة الإجابة
            console.warn(`⚠️ Unexpected state for ${peerId}: ${currentState}, attempting to process answer anyway`);
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log(`✅ Answer processed in unexpected state for ${peerId}`);
            } catch (error) {
                console.error(`❌ Failed to process answer in state ${currentState}:`, error);
            }
        }
        
        // معالجة المرشحات المعلقة في جميع الحالات
        this.processQueuedIceCandidates(peerId);

    } catch (error) {
        console.error(`❌ Error handling answer from ${peerId}:`, error);
    }
}

 /**
 * معالجة مرشح ICE وارد
 */
async handleIceCandidate(peerId, candidate) {
    try {
        const pc = this.peerConnections.get(peerId);
        if (!pc) {
            console.warn(`⚠️ No peer connection for ${peerId}, queuing ICE candidate`);
            // تخزين المرشح مؤقتاً
            if (!this.queuedIceCandidates) this.queuedIceCandidates = new Map();
            if (!this.queuedIceCandidates.has(peerId)) this.queuedIceCandidates.set(peerId, []);
            this.queuedIceCandidates.get(peerId).push(candidate);
            return;
        }

        // تجاهل المرشح الفارغ (نهاية الجمع)
        if (!candidate.candidate) {
            console.log(`✅ End of ICE candidates for ${peerId}`);
            return;
        }

        // إضافة المرشح مباشرة
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`✅ ICE candidate added for ${peerId}`);

    } catch (error) {
        console.warn(`⚠️ Failed to add ICE candidate for ${peerId}:`, error.message);
    }
}

/**
 * الحصول على نوع ICE candidate من النص
 */
getCandidateType(candidateString) {
    if (!candidateString) return 'unknown';
    
    if (candidateString.includes('typ host')) return 'host';
    if (candidateString.includes('typ srflx')) return 'srflx';
    if (candidateString.includes('typ relay')) return 'relay';
    if (candidateString.includes('typ prflx')) return 'prflx';
    
    return 'unknown';
}


/**
 * مراقبة تقدم اتصال WebRTC
 */
monitorConnectionProgress(peerId, peerName) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    let checkInterval = setInterval(() => {
        const iceState = pc.iceConnectionState;
        const signalingState = pc.signalingState;
        const connectionState = pc.connectionState;
        
        console.log(`📊 Connection progress for ${peerName}:`, {
            ice: iceState,
            signaling: signalingState,
            connection: connectionState
        });

        // إذا اكتمل الاتصال أو فشل، توقف عن المراقبة
        if (iceState === 'connected' || iceState === 'completed' || iceState === 'failed') {
            clearInterval(checkInterval);
            console.log(`🎯 Connection monitoring stopped for ${peerName}: ${iceState}`);
        }
    }, 1000); // التحقق كل ثانية

    // توقف تلقائي بعد 30 ثانية
    setTimeout(() => {
        clearInterval(checkInterval);
        console.log(`⏰ Connection monitoring timeout for ${peerName}`);
    }, 30000);
}

  /**
 * معالجة المرشحات ICE المعلقة
 */
processQueuedIceCandidates(peerId) {
    if (this.queuedIceCandidates && this.queuedIceCandidates.has(peerId)) {
        const pc = this.peerConnections.get(peerId);
        const candidates = this.queuedIceCandidates.get(peerId);
        
        if (pc && candidates.length > 0) {
            console.log(`🔄 Processing ${candidates.length} queued ICE candidates for ${peerId}`);
            
            let processed = 0;
            const processNext = async () => {
                if (candidates.length === 0) {
                    console.log(`✅ Finished processing queued ICE candidates for ${peerId}`);
                    this.queuedIceCandidates.delete(peerId);
                    return;
                }
                
                const candidate = candidates.shift();
                try {
                    // انتظر حتى يكون remoteDescription جاهزاً
                    if (!pc.remoteDescription) {
                        console.log(`⏳ Waiting for remote description to process ICE candidate for ${peerId}`);
                        candidates.unshift(candidate); // إعادة المرشح للقائمة
                        setTimeout(processNext, 100);
                        return;
                    }
                    
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    processed++;
                    console.log(`✅ Added queued ICE candidate ${processed} for ${peerId}`);
                    processNext();
                } catch (error) {
                    console.warn(`⚠️ Failed to add queued ICE candidate for ${peerId}:`, error.message);
                    processNext(); // استمر مع الباقي
                }
            };
            
            processNext();
        }
    }
}

    /**
     * إغلاق اتصال نظير
     */
    closePeerConnection(peerId) {
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
            this.connectionStates.delete(peerId);
            this.uiManager.removeRemoteVideo(peerId);
            console.log(`🔚 Closed peer connection: ${peerId}`);
        }
    }

    // باقي الدوال المساعدة (handleJoinApproved, handlePeerJoined, etc.)
    // ... [يجب إضافة باقي الدوال من الكود السابق]

    /**
     * معالجة الموافقة على الانضمام
     */
    async handleJoinApproved(data) {
        this.uiManager.hideWaitingModal();
        this.uiManager.showStatusAlert('تمت الموافقة على انضمامك! جاري الاتصال...', 'success');

        // تم تغيير المنطق هنا.
        // المشارك الجديد لن يبدأ بإرسال offer.
        // بدلاً من ذلك، سينتظر بصمت وصول offer من المضيف أو المشاركين الآخرين.
        // هذا يمنع حالة السباق (glare) حيث يحاول الطرفان بدء الاتصال في نفس الوقت.
        console.log('✅ Join approved. Waiting for offers from existing peers.');

        // عند الموافقة على الانضمام، استقبل حالة رفع اليد من الآخرين
        for (const peer of data.peers) {
            if (peer.handRaised) {
                this.uiManager.toggleHandState(peer.id, true);
            }
        }
    }

    /**
     * معالجة رفض الانضمام
     */
    handleJoinRejected(data) {
        this.uiManager.hideWaitingModal();
        this.uiManager.showStatusAlert(`تم رفض طلبك: ${data.reason}`, 'danger');
        this.leaveCall();
    }

    /**
     * معالجة انضمام مشارك جديد
     */
    async handlePeerJoined(data) {
        this.uiManager.showStatusAlert(`${data.peerName} انضم للمكالمة`, 'info');
        
        if (this.isHost) {
            await this.createAndSendOffer(data.peerId, data.peerName);
        }
    }

    /**
     * معالجة انقطاع مشارك
     */
    handlePeerDisconnected(data) {
        this.uiManager.showStatusAlert(`${data.peerName} غادر المكالمة`, 'warning');
        this.closePeerConnection(data.peerId);
    }

    /**
     * معالجة الطرد
     */
    handleKicked() {
        this.uiManager.showStatusAlert('لقد تم طردك من قبل المضيف', 'danger');
        this.leaveCall();
    }

    /**
     * معالجة الكتم عن بعد
     */
    handleRemoteMute() {
        this.uiManager.showStatusAlert('لقد قام المضيف بكتم صوتك', 'warning');
        this.toggleMic(true);
    }

    /**
     * معالجة فك الكتم عن بعد
     */
    handleRemoteUnmute() {
        this.uiManager.showStatusAlert('لقد قام المضيف بفك كتم صوتك', 'info');
        this.toggleMic(false);
    }

    /**
     * معالجة كتم مشارك آخر
     */
    handlePeerMuted(data) {
        this.uiManager.showStatusAlert(`قام المضيف بكتم صوت ${data.peerName}`, 'info');
        this.uiManager.updateRemoteMuteButton(data.peerId, true);
    }

    /**
     * معالجة فك كتم مشارك آخر
     */
    handlePeerUnmuted(data) {
        this.uiManager.showStatusAlert(`قام المضيف بفك كتم صوت ${data.peerName}`, 'info');
        this.uiManager.updateRemoteMuteButton(data.peerId, false);
    }

    /**
     * معالجة انقطاع الاتصال
     */
    handleConnectionClosed(data) {
        if (!this.isLeaving) {
            this.uiManager.showStatusAlert('انقطع الاتصال بالخادم', 'warning');
        }
    }

    /**
     * معالجة خطأ الاتصال
     */
    handleConnectionError(data) {
        this.uiManager.showStatusAlert(`خطأ في الاتصال: ${data.message}`, 'danger');
    }

    /**
     * معالجة إعادة الاتصال
     */
    handleReconnecting(data) {
        this.uiManager.showStatusAlert(
            `محاولة إعادة الاتصال... (${data.attempt}/${data.maxAttempts})`, 
            'warning', 
            3000
        );
    }

    /**
     * مغادرة المكالمة
     */
    leaveCall() {
        console.log('🚪 Leaving call...');
        this.isLeaving = true;

        this.networkClient.send({ type: 'leave-call' });
        
        this.peerConnections.forEach((pc, peerId) => {
            this.closePeerConnection(peerId);
        });

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.localStream = null;
        }

        this.isHost = false;
        this.myName = '';
        this.peerConnections.clear();
        this.connectionStates.clear();
        this.queuedIceCandidates.clear();
        
        this.uiManager.showLobbyView();
        
        this.isLeaving = false;
        console.log('✅ Call left successfully');
    }

    /**
     * تبديل حالة الميكروفون
     */
    toggleMic(forceMute = null) {
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                const shouldMute = forceMute !== null ? forceMute : !audioTracks[0].enabled;
                audioTracks[0].enabled = !shouldMute;
                this.uiManager.toggleMicButton(shouldMute);
                this.uiManager.updateUserAvatar('local', this.myName, !this.localStream.getVideoTracks()[0].enabled, shouldMute);
                console.log(`🎤 Microphone ${shouldMute ? 'muted' : 'unmuted'}`);
            }
        }
    }

    /**
     * تبديل حالة الكاميرا
     */
    toggleVideo() {
        if (this.localStream) {
            const videoTracks = this.localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                const isVideoOff = !videoTracks[0].enabled;
                videoTracks[0].enabled = !isVideoOff;
                this.uiManager.toggleVideoButton(isVideoOff);
                this.uiManager.updateUserAvatar('local', this.myName, isVideoOff, !this.localStream.getAudioTracks()[0].enabled);
                console.log(`📹 Camera ${isVideoOff ? 'turned off' : 'turned on'}`);
            }
        }
    }
}