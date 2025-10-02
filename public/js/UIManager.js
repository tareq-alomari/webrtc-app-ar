/**
 * =================================================================
 * UIManager (مدير واجهة المستخدم) - النسخة المحسنة
 * =================================================================
 * * مسؤول عن جميع التفاعلات مع DOM وإدارة الواجهة
 * * التحديثات: تحسينات الوصول، إدارة الحالة، تجربة مستخدم محسنة
 */

class UIManager {
    constructor(onAction) {
        this.onAction = onAction;
        this.createPollModal = null;
        this.waitingModal = null;
        this.isChatOpen = false;
        this.isRequestsOpen = false;
        this.privateChatTarget = null;
        this.currentView = 'lobby';
        this.init();
    }

    /**
     * تهيئة مدير الواجهة
     */
    init() {
        this.initializePollModal();
        this.initializeModal();
        this.bindEvents();
        this.initializeTooltips();
    }

    /**
     * تهيئة النافذة المنبثقة
     */
    initializeModal() {
        const modalElement = document.getElementById('waitingModal');
        if (modalElement) {
            this.waitingModal = new bootstrap.Modal(modalElement);
        }
    }
    initializePollModal() {
        const modalElement = document.getElementById('createPollModal');
        if (modalElement) {
            this.createPollModal = new bootstrap.Modal(modalElement);
        }
    }

    /**
 * ربط أحداث العناصر
 */
bindEvents() {
    console.log('🔗 Binding UI events...');

    // استخدام event delegation لتحسين الأداء والموثوقية
    document.body.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        if (!action) return;

        event.preventDefault();

        switch (action) {
            case 'start-call':
            case 'join-call':
            case 'toggle-mic':
            case 'toggle-video':
            case 'leave-call':
            case 'toggle-hand':
            case 'end-poll':
            case 'copy-invite-link':
                console.log(`🎬 Action: ${action}`);
                this.onAction(action);
                break;

            case 'toggle-emoji':
                console.log('😀 Toggle emoji picker');
                this.toggleEmojiPicker();
                break;

            case 'create-poll':
                console.log('📊 Create poll button clicked');
                this.showCreatePollModal();
                break;

            case 'toggle-chat':
                console.log('💬 Toggle chat');
                this.toggleChat();
                break;

            case 'send-chat':
                console.log('📤 Send chat');
                this.sendChatMessage();
                break;

            case 'close-chat':
                console.log('❌ Close chat');
                this.toggleChat(false);
                break;

            case 'cancel-join':
                console.log('🚫 Cancel join');
                this.hideWaitingModal();
                this.onAction('leave-call');
                break;

            case 'cancel-private-chat':
                console.log('🚫 Cancel private chat');
                this.setPrivateChatTarget(null);
                break;

            case 'start-poll':
                this.handleStartPoll();
                break;

            case 'submit-vote': {
                const pollId = button.dataset.pollId;
                const optionIndex = button.dataset.optionIndex;
                if (pollId && optionIndex) {
                    console.log(`🗳️ Submitting vote for poll ${pollId}, option ${optionIndex}`);
                    this.onAction('submit-vote', { pollId, optionIndex });
                }
                break;
            }

            case 'close-poll': {
                const pollContainer = document.getElementById('poll-container');
                if (pollContainer) {
                    pollContainer.classList.add('d-none');
                }
                break;
            }

            case 'approve-join':
            case 'reject-join': {
                const item = button.closest('.join-request-item');
                if (item) {
                    const guestId = item.dataset.guestId;
                    console.log(`🚦 Join action: ${action} for ${guestId}`);
                    this.onAction(action, guestId);
                }
                break;
            }

            case 'remote-mute':
            case 'kick-user':
            case 'initiate-private-chat': {
                const wrapper = button.closest('.video-wrapper');
                if (wrapper) {
                    const peerId = wrapper.dataset.peerId;
                    if (action === 'initiate-private-chat') {
                        const peerName = wrapper.querySelector('.user-name')?.textContent || 'مشارك';
                        this.setPrivateChatTarget({ id: peerId, name: peerName });
                    } else {
                        console.log(`🕹️ Remote action: ${action} for ${peerId}`);
                        if (action === 'remote-mute') {
                            // تحديد الحالة الحالية للزر وإرسالها مع الإجراء
                            const isMuted = button.querySelector('i')?.classList.contains('bi-mic-mute-fill');
                            this.onAction(action, { peerId, shouldMute: !isMuted });
                        } else {
                            this.onAction(action, peerId);
                        }
                    }
                }
                break;
            }
        }
    });

    // إدخال الدردشة
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                console.log('↩️ Enter pressed in chat');
                event.preventDefault();
                this.sendChatMessage();
            }
        });
    }

    // التحقق من اسم المستخدم
    const nameInput = document.getElementById('name-input');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            this.validateNameInput(nameInput.value);
        });
        // التحقق عند التحميل الأولي
        this.validateNameInput(nameInput.value);
    }

    // ربط حدث اختيار الرمز التعبيري
    const emojiPicker = document.querySelector('emoji-picker');
    if (emojiPicker) {
        emojiPicker.addEventListener('emoji-click', event => {
            const chatInput = document.getElementById('chat-input');
            chatInput.value += event.detail.unicode;
            chatInput.focus();
        });
    }

    // إخفاء منتقي الرموز عند النقر في أي مكان آخر
    document.body.addEventListener('click', (event) => {
        if (!event.target.closest('emoji-picker') && !event.target.closest('#emoji-btn')) {
            this.toggleEmojiPicker(false);
        }
    }, true); // Use capture phase to catch clicks early

    console.log('✅ All UI events bound successfully');
}

    /**
     * تهيئة تلميحات الأدوات
     */
    initializeTooltips() {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }

    /**
     * التحقق من صحة إدخال الاسم
     */
    validateNameInput(value) {
        const startBtn = document.getElementById('start-call-btn');
        const joinBtn = document.getElementById('join-call-btn');
        const isValid = value.trim().length >= 2 && value.trim().length <= 20;
        
        if (startBtn) startBtn.disabled = !isValid;
        if (joinBtn) joinBtn.disabled = !isValid;

        return isValid;
    }

    /**
     * الحصول على اسم المستخدم
     */
    getUserName() {
        const input = document.getElementById('name-input');
        return input ? input.value.trim() : '';
    }

    /**
     * إرسال رسالة دردشة
     */
    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (message) {
            if (this.privateChatTarget) {
                this.onAction('send-private-chat', { to: this.privateChatTarget.id, message });
                this.setPrivateChatTarget(null); // Reset after sending
            } else {
                this.onAction('send-chat', message);
            }
            input.value = '';
            input.focus();
        }
    }

    setPrivateChatTarget(target) {
        this.privateChatTarget = target;
        const indicator = document.getElementById('private-chat-indicator');
        const input = document.getElementById('chat-input');
        if (target) {
            indicator.querySelector('span').textContent = `رسالة خاصة إلى ${this.escapeHtml(target.name)}`;
            indicator.classList.remove('d-none');
            input.placeholder = `اكتب رسالتك الخاصة...`;
        } else {
            indicator.classList.add('d-none');
            input.placeholder = `اكتب رسالتك... (اضغط Enter للإرسال)`;
        }
    }

    /**
     * تبديل حالة منتقي الرموز التعبيرية
     */
    toggleEmojiPicker(forceState) {
        const picker = document.querySelector('emoji-picker');
        if (!picker) return;

        const shouldOpen = typeof forceState === 'boolean' ? forceState : picker.classList.contains('d-none');
        
        picker.classList.toggle('d-none', !shouldOpen);
    }

    /**
     * إظهار نافذة إنشاء استطلاع
     */
    showCreatePollModal() {
        if (this.createPollModal) {
            this.createPollModal.show();
        }
    }

    /**
     * معالجة بدء الاستطلاع
     */
    handleStartPoll() {
        const question = document.getElementById('poll-question').value.trim();
        const option1 = document.getElementById('poll-option1').value.trim();
        const option2 = document.getElementById('poll-option2').value.trim();

        if (question && option1 && option2) {
            this.onAction('start-poll', { question, options: [option1, option2] });
            this.createPollModal.hide();
        } else {
            this.showStatusAlert('يرجى ملء جميع حقول الاستطلاع', 'warning');
        }
    }

    /**
     * تبديل حالة الدردشة
     */
    toggleChat(forceState) {
        const sidebar = document.getElementById('chat-sidebar');
        const isOpen = typeof forceState === 'boolean' ? forceState : !this.isChatOpen;
        
        sidebar.classList.toggle('open', isOpen);
        this.isChatOpen = isOpen;

        if (isOpen) {
            document.getElementById('chat-input').focus();
        }
    }

    /**
     * تبديل حالة طلبات الانضمام
     */
    toggleJoinRequests(forceState) {
        const sidebar = document.getElementById('join-requests-sidebar');
        const isOpen = typeof forceState === 'boolean' ? forceState : !this.isRequestsOpen;
        
        sidebar.style.display = isOpen ? 'block' : 'none';
        this.isRequestsOpen = isOpen;
    }

    /**
     * عرض واجهة المكالمة
     */
    showCallView() {
        document.getElementById('initial-view').classList.add('d-none');
        document.getElementById('call-view').classList.remove('d-none');
        this.currentView = 'call';

        // إظهار زر الاستطلاع للمضيف فقط
        const pollBtn = document.getElementById('poll-btn');
        if (pollBtn && this.onAction('is-host')) {
            pollBtn.classList.remove('d-none');
        }

        // إظهار زر الدعوة للمضيف
        const inviteBtn = document.getElementById('invite-btn');
        if (inviteBtn && this.onAction('is-host')) {
            inviteBtn.classList.remove('d-none');
        }
        
        // إعادة تعيين حالة الأزرار
        this.toggleMicButton(false);
        this.toggleVideoButton(false);
    }

    /**
     * عرض واجهة البداية
     */
    showLobbyView() {
        document.getElementById('call-view').classList.add('d-none');
        document.getElementById('initial-view').classList.remove('d-none');
        this.currentView = 'lobby';
        
        this.removeAllRemoteVideos();
        this.clearJoinRequests();
        this.toggleChat(false);
        this.toggleJoinRequests(false);
        document.getElementById('poll-container').classList.add('d-none');
        
        // إعادة تعيين حاوية الدردشة
        document.getElementById('chat-messages').innerHTML = '';
    }

    /**
     * تعيين تدفق الفيديو المحلي
     */
    setLocalStream(stream) {
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = stream;
        }
    }

    /**
 * إضافة تدفق فيديو بعيد
 */
addRemoteStream(stream, peerId, peerName, isHostView) {
    const videoTracks = stream.getVideoTracks();
    console.log(`🎬 Adding remote stream for ${peerName} (${peerId}) with ${videoTracks.length} video tracks.`);
    
    const videosContainer = document.getElementById('videos-container');
    let videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
    this.updateGridLayout();
    const hasVideo = videoTracks.length > 0 && videoTracks[0].enabled;

    if (!videoWrapper) {
        videoWrapper = this.createVideoWrapper(peerId, peerName, isHostView);
        videosContainer.appendChild(videoWrapper);
    }
    
    const videoElement = videoWrapper.querySelector('video');
    if (videoElement) {
        videoElement.srcObject = hasVideo ? stream : null;
        console.log(`✅ Video element updated for ${peerName}`);
        
        // إضافة معالج للأخطاء
        videoElement.onloadedmetadata = () => {
            console.log(`📹 Video metadata loaded for ${peerName}`);
            videoElement.play().catch(e => console.warn(`⚠️ Auto-play prevented for ${peerName}:`, e));
        };
        
        videoElement.onerror = (error) => {
            console.error(`❌ Video error for ${peerName}:`, error);
        };
    }

    this.updateUserAvatar(peerId, peerName, !hasVideo);
}

    /**
     * إنشاء عنصر فيديو جديد
     */
    createVideoWrapper(peerId, peerName, isHostView) {
        const videoWrapper = document.createElement('div');
        videoWrapper.id = `video-wrapper-${peerId}`;
        videoWrapper.className = 'video-wrapper remote';
        videoWrapper.setAttribute('data-peer-id', peerId);

        videoWrapper.innerHTML = `
            <video autoplay playsinline></video>
            <div class="user-name">${this.escapeHtml(peerName)}</div>
            <div class="connection-status">
                <span class="badge bg-success">متصل</span>
            </div>
            <i class="bi bi-hand-index-thumb-fill hand-raised-icon d-none"></i>
            <div class="remote-controls"></div>
            <div class="no-video d-none">
                <div class="user-avatar">${this.getInitials(peerName)}</div>
                <div>${this.escapeHtml(peerName)}</div>
            </div>
        `;

        // إضافة عناصر التحكم لجميع المستخدمين
        this.addPeerControls(videoWrapper, peerId, isHostView);

        return videoWrapper;
    }

    /**
     * إضافة عناصر تحكم المضيف
     */
    addPeerControls(videoWrapper, peerId, isHostView) {
        const controlsContainer = videoWrapper.querySelector('.remote-controls');
        
        if (isHostView) {
            // أزرار خاصة بالمضيف
            // زر كتم الصوت
            const muteBtn = document.createElement('button');
            muteBtn.className = 'btn btn-sm btn-outline-light remote-mute-btn';
            muteBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
            muteBtn.dataset.action = 'remote-mute';
            muteBtn.setAttribute('data-bs-toggle', 'tooltip');
            muteBtn.setAttribute('title', 'كتم صوت المشارك');
            controlsContainer.appendChild(muteBtn);
            new bootstrap.Tooltip(muteBtn);

            // زر طرد المشارك
            const kickBtn = document.createElement('button');
            kickBtn.dataset.action = 'kick-user';
            kickBtn.className = 'btn btn-sm btn-outline-danger kick-btn';
            kickBtn.innerHTML = '<i class="bi bi-person-dash-fill"></i>';
            kickBtn.setAttribute('data-bs-toggle', 'tooltip');
            kickBtn.setAttribute('title', 'طرد المشارك');
            controlsContainer.appendChild(kickBtn);
            new bootstrap.Tooltip(kickBtn);
        }

        // زر رسالة خاصة
        const privateMsgBtn = document.createElement('button');
        privateMsgBtn.dataset.action = 'initiate-private-chat';
        privateMsgBtn.className = 'btn btn-sm btn-outline-info';
        privateMsgBtn.innerHTML = '<i class="bi bi-send"></i>';
        privateMsgBtn.setAttribute('data-bs-toggle', 'tooltip');
        privateMsgBtn.setAttribute('title', 'إرسال رسالة خاصة');
        controlsContainer.appendChild(privateMsgBtn);
        new bootstrap.Tooltip(privateMsgBtn);
    }

    /**
     * تحديث زر كتم الصوت للمشارك البعيد
     */
    updateRemoteMuteButton(peerId, isMuted) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) {
            const muteBtn = videoWrapper.querySelector('.remote-mute-btn');
            const muteIcon = muteBtn?.querySelector('i');
            
            if (muteIcon) {
                muteIcon.className = isMuted ? 'bi bi-mic-mute-fill text-warning' : 'bi bi-mic-fill';
                this.updateTooltip(muteBtn, isMuted ? 'إلغاء كتم المشارك' : 'كتم صوت المشارك');
            }
        }
    }

    /**
     * تحديث صورة المستخدم البديلة
     */
    updateUserAvatar(peerId, peerName, isVideoOff, isMuted) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (!videoWrapper) return;

        const noVideoElement = videoWrapper.querySelector('.no-video');
        const videoElement = videoWrapper.querySelector('video');
        const avatarMuteIcon = videoWrapper.querySelector('.avatar-mute-icon');

        if (isVideoOff) {
            // إظهار الصورة الرمزية وإخفاء الفيديو
            noVideoElement.classList.remove('d-none');
            videoElement.style.display = 'none';

            // تحديث الأحرف الأولى من الاسم
            const avatarElement = noVideoElement.querySelector('.user-avatar');
            if (avatarElement) {
                avatarElement.textContent = this.getInitials(peerName);
            }

            // إظهار أو إخفاء أيقونة الكتم فوق الصورة الرمزية
            if (avatarMuteIcon) {
                avatarMuteIcon.classList.toggle('d-none', !isMuted);
            }
        } else {
            // إظهار الفيديو وإخفاء الصورة الرمزية
            noVideoElement.classList.add('d-none');
            videoElement.style.display = 'block';

            // إخفاء أيقونة الكتم فوق الصورة الرمزية دائماً عند تشغيل الفيديو
            if (avatarMuteIcon) {
                avatarMuteIcon.classList.add('d-none');
            }
        }
    }

    /**
     * إزالة فيديو بعيد
     */
    removeRemoteVideo(peerId) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) {
            videoWrapper.style.transform = 'scale(0)';
            videoWrapper.remove();
        }
    }

    /**
     * إزالة جميع مقاطع الفيديو البعيدة
     */
    removeAllRemoteVideos() {
        const remoteVideos = document.querySelectorAll('.video-wrapper.remote');
        remoteVideos.forEach(video => video.remove());
    }

    /**
     * إضافة طلب انضمام
     */
    addJoinRequest(guestId, guestName) {
        this.toggleJoinRequests(true);
        
        const list = document.getElementById('join-requests-list');
        const item = document.createElement('li');
        item.className = 'list-group-item join-request-item';
        item.dataset.guestId = guestId;
        
        item.innerHTML = `
            <span>${this.escapeHtml(guestName)}</span>
            <div>
                <button class="btn btn-sm btn-outline-success approve-btn" data-action="approve-join" data-bs-toggle="tooltip" title="قبول">
                    <i class="bi bi-check-lg"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger reject-btn" data-action="reject-join" data-bs-toggle="tooltip" title="رفض">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
        `;

        list.appendChild(item);
        this.updatePendingRequestsCount();
        
        // تهيئة تلميحات الأدوات
        new bootstrap.Tooltip(item.querySelector('.approve-btn'));
        new bootstrap.Tooltip(item.querySelector('.reject-btn'));
    }

    /**
     * إزالة طلب انضمام
     */
    removeJoinRequest(guestId) {
        const item = document.querySelector(`.join-request-item[data-guest-id="${guestId}"]`);
        if (item) {
            item.remove();
            this.updatePendingRequestsCount();
        }

        const list = document.getElementById('join-requests-list');
        if (list.children.length === 0) {
            this.toggleJoinRequests(false);
        }
    }

    /**
     * تحديث تخطيط شبكة الفيديو
     */
    updateGridLayout() {
        const container = document.getElementById('videos-container');
        if (!container) return;

        const count = container.children.length;
        container.classList.remove('layout-1', 'layout-2', 'layout-3-4');

        if (count === 1) {
            container.classList.add('layout-1');
        } else if (count === 2) {
            container.classList.add('layout-2');
        }
    }

    /**
     * مسح جميع طلبات الانضمام
     */
    clearJoinRequests() {
        document.getElementById('join-requests-list').innerHTML = '';
        this.updatePendingRequestsCount();
    }

    /**
     * تحديث عدد الطلبات المعلقة
     */
    updatePendingRequestsCount() {
        const countElement = document.getElementById('pending-requests-count');
        const list = document.getElementById('join-requests-list');
        const count = list.children.length;
        
        if (countElement) {
            countElement.textContent = count;
            countElement.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }

    /**
     * عرض الاستطلاع للمستخدمين
     */
    displayPoll(pollData, isHost) {
        const pollContainer = document.getElementById('poll-container');
        pollContainer.classList.remove('d-none');
        pollContainer.dataset.pollId = pollData.id;

        let optionsHtml = '';
        if (isHost) {
            // المضيف يرى النتائج مباشرة
            optionsHtml = this.getPollResultsHtml(pollData);
        } else {
            // المشاركون يرون أزرار التصويت
            pollData.options.forEach((option, index) => {
                optionsHtml += `
                    <button class="btn btn-outline-primary" data-action="submit-vote" data-poll-id="${pollData.id}" data-option-index="${index}">
                        ${this.escapeHtml(option.text)}
                    </button>
                `;
            });
        }

        pollContainer.innerHTML = `
            <div class="poll-header">
                <h6><i class="bi bi-bar-chart-fill me-2"></i>استطلاع مباشر</h6>
                ${isHost ? '<button class="btn btn-sm btn-danger" data-action="end-poll">إنهاء</button>' : ''}
            </div>
            <p class="poll-question">${this.escapeHtml(pollData.question)}</p>
            <div class="poll-options">${optionsHtml}</div>
        `;
    }

    /**
     * تحديث نتائج الاستطلاع
     */
    updatePollResults(pollData) {
        const pollContainer = document.getElementById('poll-container');
        if (pollContainer && pollContainer.dataset.pollId === pollData.id) {
            const optionsContainer = pollContainer.querySelector('.poll-options');
            optionsContainer.innerHTML = this.getPollResultsHtml(pollData);
        }
    }

    /**
     * عرض النتائج النهائية للاستطلاع
     */
    endPoll(pollData) {
        const pollContainer = document.getElementById('poll-container');
        if (pollContainer && pollContainer.dataset.pollId === pollData.id) {
            pollContainer.innerHTML = `
                <div class="poll-header">
                    <h6><i class="bi bi-check-circle-fill me-2"></i>نتائج الاستطلاع النهائية</h6>
                    <button class="btn-close" data-action="close-poll"></button>
                </div>
                <p class="poll-question">${this.escapeHtml(pollData.question)}</p>
                <div class="poll-options">${this.getPollResultsHtml(pollData)}</div>
            `;
        }
    }

    getPollResultsHtml(pollData) {
        const totalVotes = pollData.options.reduce((sum, opt) => sum + opt.votes, 0);
        return pollData.options.map(option => {
            const percentage = totalVotes > 0 ? ((option.votes / totalVotes) * 100).toFixed(0) : 0;
            return `
                <div class="poll-result">
                    <div class="option-text">
                        <span>${this.escapeHtml(option.text)}</span>
                        <strong>${percentage}%</strong>
                    </div>
                    <div class="progress">
                        <div class="progress-bar" role="progressbar" style="width: ${percentage}%" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100">${option.votes}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * إظهار نافذة الانتظار
     */
    showWaitingModal() {
        if (this.waitingModal) {
            this.waitingModal.show();
        }
    }

    /**
     * إخفاء نافذة الانتظار
     */
    hideWaitingModal() {
        if (this.waitingModal) {
            this.waitingModal.hide();
        }
    }

    /**
     * عرض تنبيه حالة
     */
    showStatusAlert(message, type = 'info', duration = 5000) {
        const statusContainer = document.getElementById('status-container');
        const alertId = 'alert-' + Date.now();
        
        const alertDiv = document.createElement('div');
        alertDiv.id = alertId;
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.role = 'alert';
        alertDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="bi ${this.getAlertIcon(type)} me-2"></i>
                <div>${this.escapeHtml(message)}</div>
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
            </div>
        `;

        statusContainer.appendChild(alertDiv);

        // إغلاق التنبيه تلقائياً بعد المدة المحددة
        if (duration > 0) {
            setTimeout(() => {
                this.removeAlert(alertId);
            }, duration);
        }

        return alertId;
    }

    /**
     * إزالة تنبيه
     */
    removeAlert(alertId) {
        const alert = document.getElementById(alertId);
        if (alert) {
            const bsAlert = new bootstrap.Alert(alert);
            bsAlert.close();
        }
    }

    /**
     * تبديل زر الميكروفون
     */
    toggleMicButton(isMuted) {
        const micBtn = document.getElementById('mic-btn');
        if (micBtn) {
            micBtn.innerHTML = isMuted ? '<i class="bi bi-mic-mute-fill"></i>' : '<i class="bi bi-mic-fill"></i>';
            micBtn.classList.toggle('btn-danger', isMuted);
            micBtn.classList.toggle('btn-secondary', !isMuted);

            // تحديث التلميح (Tooltip) بشكل موثوق
            const newTitle = isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت';
            this.updateTooltip(micBtn, newTitle);

            // تحديث الصورة الرمزية للمستخدم المحلي
            const localVideoWrapper = document.getElementById('local-video-wrapper');
            if (localVideoWrapper && document.getElementById('local-video')?.srcObject) {
                const videoTrack = document.getElementById('local-video').srcObject.getVideoTracks()[0];
                this.updateUserAvatar('local', 'أنت', !videoTrack.enabled, isMuted);
            }
        }
    }

    /**
     * تبديل زر الكاميرا
     */
    toggleVideoButton(isVideoOff) {
        const videoBtn = document.getElementById('video-btn');
        if (videoBtn) {
            videoBtn.innerHTML = isVideoOff ? '<i class="bi bi-camera-video-off-fill"></i>' : '<i class="bi bi-camera-video-fill"></i>';
            videoBtn.classList.toggle('btn-danger', isVideoOff);
            videoBtn.classList.toggle('btn-secondary', !isVideoOff);

            // تحديث التلميح (Tooltip) بشكل موثوق
            const newTitle = isVideoOff ? 'تشغيل الكاميرا' : 'إيقاف الكاميرا';
            this.updateTooltip(videoBtn, newTitle);
            
            // تحديث الفيديو المحلي
            const localVideo = document.getElementById('local-video');
            if (localVideo && localVideo.srcObject) {
                this.updateUserAvatar('local', 'أنت', isVideoOff, !localVideo.srcObject.getAudioTracks()[0].enabled);
            }
        }
    }

    /**
     * تحديث التلميح بشكل آمن لتجنب بقائه معلقاً
     */
    updateTooltip(element, newTitle) {
        if (!element) return;
        const tooltipInstance = bootstrap.Tooltip.getInstance(element);
        if (tooltipInstance) {
            tooltipInstance.hide();
            tooltipInstance.dispose();
        }
        element.setAttribute('title', newTitle);
        element.setAttribute('data-bs-original-title', newTitle);
        new bootstrap.Tooltip(element);
    }

    /**
     * تبديل زر رفع اليد
     */
    toggleHandButton(isRaised) {
        const handBtn = document.getElementById('hand-btn');
        if (handBtn) {
            handBtn.innerHTML = isRaised ? '<i class="bi bi-hand-index-thumb-fill"></i>' : '<i class="bi bi-hand-index-thumb"></i>';
            handBtn.classList.toggle('btn-warning', isRaised);
            handBtn.classList.toggle('btn-secondary', !isRaised);
            const newTitle = isRaised ? 'خفض اليد' : 'رفع اليد';
            this.updateTooltip(handBtn, newTitle);
        }
    }

    /**
     * تبديل حالة رفع اليد للمشارك
     */
    toggleHandState(peerId, isRaised) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) {
            const icon = videoWrapper.querySelector('.hand-raised-icon');
            if (icon) {
                icon.classList.toggle('d-none', !isRaised);
            }
        }
        if (peerId === 'local') {
            this.toggleHandButton(isRaised);
        }
    }

    /**
     * إضافة رسالة دردشة
     */
    addChatMessage(senderName, message, isLocal, timestamp = null, isPrivate = false) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', isLocal ? 'local' : 'remote');
        if (isPrivate) {
            messageElement.classList.add('private');
        }
        
        const senderDisplayName = isLocal ? 'أنت' : this.escapeHtml(senderName);
        const time = timestamp ? new Date(timestamp).toLocaleTimeString('ar-EG', { 
            hour: '2-digit', 
            minute: '2-digit' 
        }) : new Date().toLocaleTimeString('ar-EG', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        messageElement.innerHTML = `
            <div class="sender">${senderDisplayName} <small class="text-muted">${time}</small></div>
            <div class="text">${this.escapeHtml(message)}</div>
        `;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // إظهار الدردشة تلقائياً عند استلام رسالة جديدة
        const chatToggleBtn = document.getElementById('chat-toggle-btn');
        if (!isLocal && !this.isChatOpen && chatToggleBtn) {
            chatToggleBtn.classList.add('new-message');
        }

        // إظهار الدردشة تلقائياً عند استلام رسالة جديدة
        if (!isLocal && !this.isChatOpen) {
            this.toggleChat(true);
        }
    }

    /**
     * الحصول على أيقونة التنبيه
     */
    getAlertIcon(type) {
        const icons = {
            'success': 'bi-check-circle-fill',
            'danger': 'bi-exclamation-triangle-fill',
            'warning': 'bi-exclamation-circle-fill',
            'info': 'bi-info-circle-fill'
        };
        return icons[type] || 'bi-info-circle-fill';
    }

    /**
     * الحصول على الأحرف الأولى من الاسم
     */
    getInitials(name) {
        return name.split(' ').map(word => word[0]).join('').toUpperCase().substring(0, 2);
    }

    /**
     * تجنب أحرف HTML
     */
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}