/**
 * =================================================================
 * UIManager (مدير واجهة المستخدم) - النسخة النهائية
 * =================================================================
 * * هذا الكلاس مسؤول عن جميع التعديلات المباشرة على DOM.
 * * التحديثات:
 * - إضافة زر كتم الصوت للمشاركين عن بعد (يظهر للمضيف فقط).
 * - دالة `updateRemoteMuteButton` لتحديث أيقونة زر الكتم.
 * - دمج جميع التحسينات السابقة.
 */
class UIManager {
    constructor(onAction) {
        this.onAction = onAction;
        this.waitingModal = new bootstrap.Modal(document.getElementById('waitingModal'));
        this.init();
    }

    init() {
        document.getElementById('start-call-btn').addEventListener('click', () => this.onAction('start-call'));
        document.getElementById('join-call-btn').addEventListener('click', () => this.onAction('join-call'));
        document.getElementById('mic-btn').addEventListener('click', () => this.onAction('toggle-mic'));
        document.getElementById('video-btn').addEventListener('click', () => this.onAction('toggle-video'));
        document.getElementById('leave-btn').addEventListener('click', () => this.onAction('leave-call'));
        document.getElementById('chat-toggle-btn').addEventListener('click', () => this.toggleChat());
        document.getElementById('close-chat-btn').addEventListener('click', () => this.toggleChat(false));
        document.getElementById('send-chat-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keyup', (event) => {
            if (event.key === 'Enter') this.sendChatMessage();
        });

        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }

    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (message) {
            this.onAction('send-chat', message);
            input.value = '';
        }
    }

    showCallView() {
        document.getElementById('initial-view').classList.add('d-none');
        document.getElementById('call-view').classList.remove('d-none');
    }

    showLobbyView() {
        document.getElementById('initial-view').classList.remove('d-none');
        document.getElementById('call-view').classList.add('d-none');
        this.removeAllRemoteVideos();
        this.clearJoinRequests();
        document.getElementById('join-requests-sidebar').style.display = 'none';
        this.toggleChat(false);
    }

    setLocalStream(stream) {
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = stream;
    }

    addRemoteStream(stream, peerId, peerName, isHostView) {
        const videosContainer = document.getElementById('videos-container');
        let videoWrapper = document.getElementById(`video-wrapper-${peerId}`);

        if (!videoWrapper) {
            videoWrapper = document.createElement('div');
            videoWrapper.id = `video-wrapper-${peerId}`;
            videoWrapper.className = 'video-wrapper';

            videoWrapper.innerHTML = `
                <video autoplay playsinline></video>
                <div class="user-name"></div>
                <div class="remote-controls"></div>
            `;
            
            videosContainer.appendChild(videoWrapper);
            
            if (isHostView) {
                const controlsContainer = videoWrapper.querySelector('.remote-controls');
                
                const muteBtn = document.createElement('button');
                muteBtn.className = 'btn btn-sm btn-outline-light remote-mute-btn';
                muteBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
                muteBtn.onclick = () => this.onAction('remote-mute', peerId);
                controlsContainer.appendChild(muteBtn);

                const kickBtn = document.createElement('button');
                kickBtn.className = 'btn btn-sm btn-outline-danger kick-btn';
                kickBtn.innerHTML = '<i class="bi bi-x-circle-fill"></i>';
                kickBtn.onclick = () => this.onAction('kick-user', peerId);
                controlsContainer.appendChild(kickBtn);
            }
        }
        
        videoWrapper.querySelector('video').srcObject = stream;
        videoWrapper.querySelector('.user-name').textContent = peerName;
    }
    
    updateRemoteMuteButton(peerId, isMuted) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) {
            const muteBtnIcon = videoWrapper.querySelector('.remote-mute-btn i');
            if (muteBtnIcon) {
                muteBtnIcon.className = isMuted ? 'bi bi-mic-mute-fill text-warning' : 'bi bi-mic-fill';
            }
        }
    }

    removeRemoteVideo(peerId) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) videoWrapper.remove();
    }

    removeAllRemoteVideos() {
        const remoteVideos = document.querySelectorAll('.video-wrapper:not(.local)');
        remoteVideos.forEach(video => video.remove());
    }

    addJoinRequest(guestId, guestName) {
        document.getElementById('join-requests-sidebar').style.display = 'block';
        const list = document.getElementById('join-requests-list');
        
        const item = document.createElement('li');
        item.className = 'list-group-item join-request-item';
        item.id = `request-${guestId}`;
        item.innerHTML = `
            <span>${guestName}</span>
            <div>
                <button class="btn btn-sm btn-outline-success approve-btn"><i class="bi bi-check-lg"></i></button>
                <button class="btn btn-sm btn-outline-danger reject-btn"><i class="bi bi-x-lg"></i></button>
            </div>
        `;

        item.querySelector('.approve-btn').onclick = () => this.onAction('approve-join', guestId);
        item.querySelector('.reject-btn').onclick = () => this.onAction('reject-join', guestId);
        
        list.appendChild(item);
    }
    
    removeJoinRequest(guestId) {
        const item = document.getElementById(`request-${guestId}`);
        if (item) item.remove();

        const list = document.getElementById('join-requests-list');
        if (list.children.length === 0) {
            document.getElementById('join-requests-sidebar').style.display = 'none';
        }
    }

    clearJoinRequests() {
        document.getElementById('join-requests-list').innerHTML = '';
    }

    showWaitingModal() { this.waitingModal.show(); }
    hideWaitingModal() { this.waitingModal.hide(); }
    
    showStatusAlert(message, type = 'info') {
        const statusContainer = document.getElementById('status-container');
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.role = 'alert';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        statusContainer.appendChild(alertDiv);
        setTimeout(() => {
            const bsAlert = new bootstrap.Alert(alertDiv);
            bsAlert.close();
        }, 5000);
    }

    toggleMicButton(isMuted) {
        const micBtn = document.getElementById('mic-btn');
        micBtn.innerHTML = isMuted ? '<i class="bi bi-mic-mute-fill"></i>' : '<i class="bi bi-mic-fill"></i>';
        micBtn.classList.toggle('btn-danger', isMuted);
        micBtn.classList.toggle('btn-secondary', !isMuted);
    }

    toggleVideoButton(isVideoOff) {
        const videoBtn = document.getElementById('video-btn');
        videoBtn.innerHTML = isVideoOff ? '<i class="bi bi-camera-video-off-fill"></i>' : '<i class="bi bi-camera-video-fill"></i>';
        videoBtn.classList.toggle('btn-danger', isVideoOff);
        videoBtn.classList.toggle('btn-secondary', !isVideoOff);
    }

    toggleChat(forceState) {
        const sidebar = document.getElementById('chat-sidebar');
        if (typeof forceState === 'boolean') {
            sidebar.classList.toggle('open', forceState);
        } else {
            sidebar.classList.toggle('open');
        }
    }

    addChatMessage(senderName, message, isLocal) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', isLocal ? 'local' : 'remote');
        
        const senderDisplayName = isLocal ? 'أنت' : senderName;

        messageElement.innerHTML = `
            <div class="sender">${senderDisplayName}</div>
            <div class="text">${message}</div>
        `;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}