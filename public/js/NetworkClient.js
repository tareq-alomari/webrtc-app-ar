class NetworkClient {
    constructor(onMessage) {
        this.socket = null;
        this.onMessage = onMessage;
        this.clientId = null;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.socket = new WebSocket(`${protocol}//${window.location.host}`);

        this.socket.addEventListener('open', () => {
            console.log('تم إنشاء اتصال WebSocket');
        });

        this.socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'host' || message.type === 'guest') {
                // The server doesn't assign an ID, so we'll let the SessionManager do it.
                // This is a simplification. In a real app, the server would provide a unique ID.
            }
            this.onMessage(message);
        });

        this.socket.addEventListener('close', () => {
            console.log('انقطع اتصال WebSocket');
            this.onMessage({ type: 'connection-closed' });
        });

        this.socket.addEventListener('error', (error) => {
            console.error('خطأ في WebSocket:', error);
            this.onMessage({ type: 'connection-error' });
        });
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
        } else {
            console.error('WebSocket غير متصل.');
        }
    }

    close() {
        if (this.socket) {
            this.socket.close();
        }
    }
}