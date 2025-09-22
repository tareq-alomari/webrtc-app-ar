/**
 * UIManager (User Interface Manager)
 * 
 * This class is responsible for all direct manipulation of the DOM.
 * It acts as the "View" in a Model-View-Controller-like pattern. It takes
 * user input (like button clicks) and forwards it to the SessionManager.
 * It also receives commands from the SessionManager to update the UI (e.g.,
 * show a video, display a message).
 */
class UIManager {
    /**
     * @param {function(string, any)} onAction - A callback function to notify the controller (SessionManager) of user actions.
     */
    constructor(onAction) {
        this.onAction = onAction;
        this.approvalModal = new bootstrap.Modal(document.getElementById('approvalModal'));
        this.waitingModal = new bootstrap.Modal(document.getElementById('waitingModal'));
        this.init();
    }

    /**
     * Initializes all event listeners for UI elements.
     */
    init() {
        // Lobby screen buttons
        document.getElementById('start-call-btn').addEventListener('click', () => this.onAction('start-call'));
        document.getElementById('join-call-btn').addEventListener('click', () => this.onAction('join-call'));
        
        // Host approval modal buttons
        document.getElementById('approve-btn').addEventListener('click', () => this.onAction('approve-join'));
        document.getElementById('reject-btn').addEventListener('click', () => this.onAction('reject-join'));
        
        // In-call control buttons
        document.getElementById('mic-btn').addEventListener('click', () => this.onAction('toggle-mic'));
        document.getElementById('video-btn').addEventListener('click', () => this.onAction('toggle-video'));
        document.getElementById('leave-btn').addEventListener('click', () => this.onAction('leave-call'));
        
        // Chat controls
        document.getElementById('chat-toggle-btn').addEventListener('click', () => this.onAction('toggle-chat'));
        document.getElementById('send-chat-btn').addEventListener('click', () => {
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (message) {
                this.onAction('send-chat', message);
                input.value = '';
            }
        });
        // Allow sending chat message with Enter key
        document.getElementById('chat-input').addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                document.getElementById('send-chat-btn').click();
            }
        });
    }

    /**
     * Switches the view from the initial lobby to the main call interface.
     */
    showCallView() {
        document.getElementById('initial-view').classList.add('d-none');
        document.getElementById('call-view').classList.remove('d-none');
    }

    /**
     * Switches the view from the call interface back to the initial lobby.
     */
    showLobbyView() {
        document.getElementById('initial-view').classList.remove('d-none');
        document.getElementById('call-view').classList.add('d-none');
        this.removeAllRemoteVideos();
        document.getElementById('chat-sidebar').classList.remove('open'); // Close chat on leave
    }

    /**
     * Sets the local user's video stream to the 'local-video' element.
     * @param {MediaStream} stream - The local media stream.
     */
    setLocalStream(stream) {
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = stream;
    }

    /**
     * Creates and adds a video element for a remote peer.
     * @param {MediaStream} stream - The remote peer's media stream.
     * @param {string} peerId - The unique ID of the peer.
     * @param {string} peerName - The display name of the peer.
     */
    addRemoteStream(stream, peerId, peerName) {
        const videosContainer = document.getElementById('videos-container');
        const existingWrapper = document.getElementById(`video-wrapper-${peerId}`);

        if (existingWrapper) {
            // Update the existing video element's stream (replace placeholder)
            const existingVideo = existingWrapper.querySelector('video');
            if (existingVideo) {
                existingVideo.srcObject = stream || null;
            }
            // Remove placeholder overlay if real stream arrived
            const placeholder = existingWrapper.querySelector('.video-placeholder');
            if (placeholder && stream) placeholder.remove();
            // Also update the displayed name in case it was a placeholder
            const nameEl = existingWrapper.querySelector('.user-name');
            if (nameEl) nameEl.textContent = peerName;
            return;
        }

        // Create a new video wrapper for this peer
        const videoWrapper = document.createElement('div');
        videoWrapper.id = `video-wrapper-${peerId}`;
        videoWrapper.className = 'video-wrapper';

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        // Only set srcObject if a real stream was provided
        if (stream) video.srcObject = stream;

        const userName = document.createElement('div');
        userName.className = 'user-name';
        userName.textContent = peerName;

        videoWrapper.appendChild(video);

        // If no stream yet, add a visual placeholder overlay
        if (!stream) {
            const placeholder = document.createElement('div');
            placeholder.className = 'video-placeholder';
            placeholder.style.position = 'absolute';
            placeholder.style.inset = '0';
            placeholder.style.display = 'flex';
            placeholder.style.flexDirection = 'column';
            placeholder.style.alignItems = 'center';
            placeholder.style.justifyContent = 'center';
            placeholder.style.background = 'linear-gradient(180deg, #00000055, #00000088)';
            placeholder.style.color = 'white';

            // Create initials avatar
            const initials = (peerName || '').split(' ').map(s => s[0]).join('').substring(0,2).toUpperCase() || '?';
            const avatar = document.createElement('div');
            avatar.style.width = '64px';
            avatar.style.height = '64px';
            avatar.style.borderRadius = '50%';
            avatar.style.background = '#6c757d';
            avatar.style.display = 'flex';
            avatar.style.alignItems = 'center';
            avatar.style.justifyContent = 'center';
            avatar.style.fontSize = '24px';
            avatar.style.fontWeight = '700';
            avatar.style.marginBottom = '8px';
            avatar.textContent = initials;

            const label = document.createElement('div');
            label.style.fontSize = '0.95rem';
            label.style.opacity = '0.95';
            label.textContent = peerName || 'جارٍ انتظار الفيديو...';

            placeholder.appendChild(avatar);
            placeholder.appendChild(label);
            videoWrapper.appendChild(placeholder);
        }

        videoWrapper.appendChild(userName);
        videosContainer.appendChild(videoWrapper);
    }

    /**
     * Removes a peer's video element from the UI.
     * @param {string} peerId - The ID of the peer to remove.
     */
    removeRemoteVideo(peerId) {
        const videoWrapper = document.getElementById(`video-wrapper-${peerId}`);
        if (videoWrapper) {
            videoWrapper.remove();
        }
    }

    /**
     * Clears all remote video elements, typically used when a call ends.
     */
    removeAllRemoteVideos() {
        const videosContainer = document.getElementById('videos-container');
        const remoteVideos = videosContainer.querySelectorAll('.video-wrapper:not(#local-video-wrapper)');
        remoteVideos.forEach(video => video.remove());
    }

    /**
     * Shows the modal for the host to approve or reject a join request.
     * @param {string} guestId - The ID of the guest requesting to join.
     * @param {string} guestName - The name of the guest.
     */
    showApprovalModal(guestId, guestName) {
        document.getElementById('guest-id-placeholder').textContent = `${guestName} (${guestId.substring(0, 8)})`;
        this.approvalModal.show();
    }

    /**
     * Hides the host's approval modal.
     */
    hideApprovalModal() {
        this.approvalModal.hide();
    }

    /**
     * Shows the modal for guests, indicating they are waiting for host approval.
     */
    showWaitingModal() {
        this.waitingModal.show();
    }

    /**
     * Hides the guest's waiting modal.
     */
    hideWaitingModal() {
        this.waitingModal.hide();
    }

    /**
     * Displays a temporary, dismissible alert at the top of the screen.
     * @param {string} message - The message to display.
     * @param {string} type - The Bootstrap alert type (e.g., 'success', 'danger', 'info').
     */
    showStatusAlert(message, type = 'info') {
        const statusContainer = document.getElementById('status-container');
        const alert = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        statusContainer.innerHTML = alert;
    }

    /**
     * Updates the text and style of the microphone button.
     * @param {boolean} isMuted - Whether the microphone is currently muted.
     */
    toggleMicButton(isMuted) {
        const micBtn = document.getElementById('mic-btn');
        micBtn.textContent = isMuted ? 'إلغاء الكتم' : 'كتم';
        micBtn.classList.toggle('btn-danger', isMuted);
        micBtn.classList.toggle('btn-secondary', !isMuted);
    }

    /**
     * Updates the text and style of the video button.
     * @param {boolean} isVideoOff - Whether the video is currently off.
     */
    toggleVideoButton(isVideoOff) {
        const videoBtn = document.getElementById('video-btn');
        videoBtn.textContent = isVideoOff ? 'تشغيل الفيديو' : 'إيقاف الفيديو';
        videoBtn.classList.toggle('btn-danger', isVideoOff);
        videoBtn.classList.toggle('btn-secondary', !isVideoOff);
    }

    /**
     * Toggles the visibility of the chat sidebar.
     */
    toggleChat() {
        document.getElementById('chat-sidebar').classList.toggle('open');
    }

    /**
     * Adds a new chat message to the chat display area.
     * @param {string} senderName - The name of the message sender.
     * @param {string} message - The content of the message.
     * @param {boolean} isLocal - True if the message was sent by the current user.
     */
    addChatMessage(senderName, message, isLocal) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message');
        
    const senderDisplayName = isLocal ? 'أنت' : senderName;

        messageElement.innerHTML = `
            <div class="sender">${senderDisplayName}</div>
            <div class="text">${message}</div>
        `;
        
        chatMessages.appendChild(messageElement);
        // Scroll to the bottom to show the latest message
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}