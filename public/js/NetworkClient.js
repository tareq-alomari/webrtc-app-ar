/**
 * =================================================================
 * NetworkClient (عميل الشبكة) - النسخة المحسنة
 * =================================================================
 * * مسؤول عن اتصالات WebSocket وإدارة الاتصال بالخادم
 * * التحديثات: إعادة الاتصال التلقائي، إدارة الأخطاء المحسنة
 */

class NetworkClient {
    constructor(onMessage) {
        this.socket = null;
        this.onMessage = onMessage;
        this.clientId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 2000;
        this.isConnected = false;
        this.pendingMessages = [];
    }

    /**
     * إنشاء اتصال WebSocket بالخادم
     */
    connect() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.socket = new WebSocket(`${protocol}//${window.location.host}`);
            
            this.setupEventListeners();
        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.handleConnectionError('فشل في إنشاء اتصال بالخادم');
        }
    }

    /**
     * إعداد مستمعي الأحداث لـ WebSocket
     */
    setupEventListeners() {
        this.socket.addEventListener('open', () => {
            console.log('✅ تم إنشاء اتصال WebSocket بنجاح');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.flushPendingMessages();
        });

        this.socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                this.onMessage(message);
            } catch (error) {
                console.error('❌ Failed to parse message:', error, event.data);
            }
        });

        this.socket.addEventListener('close', (event) => {
            console.log(`🔌 انقطع اتصال WebSocket (كود: ${event.code}, سبب: ${event.reason})`);
            this.isConnected = false;
            this.handleDisconnection(event);
        });

        this.socket.addEventListener('error', (error) => {
            console.error('❌ خطأ في WebSocket:', error);
            this.handleConnectionError('خطأ في الاتصال بالخادم');
        });
    }

    /**
     * معالجة انقطاع الاتصال
     */
    handleDisconnection(event) {
        // إرسال رسالة انقطاع اتصال للـ UI
        this.onMessage({ type: 'connection-closed', code: event.code, reason: event.reason });

        // محاولة إعادة الاتصال إذا لم يكن إغلاق متعمد
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
        }
    }

    /**
     * محاولة إعادة الاتصال التلقائي
     */
    attemptReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);
        
        console.log(`🔄 محاولة إعادة الاتصال ${this.reconnectAttempts} بعد ${delay}ms`);
        
        this.onMessage({ 
            type: 'reconnecting', 
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });

        setTimeout(() => {
            if (!this.isConnected) {
                this.connect();
            }
        }, delay);
    }

    /**
     * معالجة أخطاء الاتصال
     */
    handleConnectionError(message) {
        this.onMessage({ 
            type: 'connection-error', 
            message: message 
        });
    }

    /**
     * إرسال رسالة للخادم
     */
    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('❌ Failed to send message:', error);
                return false;
            }
        } else {
            console.warn('⚠️ WebSocket غير متصل. تخزين الرسالة في قائمة الانتظار.');
            this.pendingMessages.push(data);
            return false;
        }
    }

    /**
     * إرسال جميع الرسائل المعلقة
     */
    flushPendingMessages() {
        while (this.pendingMessages.length > 0) {
            const message = this.pendingMessages.shift();
            if (!this.send(message)) {
                // إذا فشل الإرسال، إعادة الرسالة للقائمة
                this.pendingMessages.unshift(message);
                break;
            }
        }
    }

    /**
     * إغلاق الاتصال
     */
    close() {
        if (this.socket) {
            this.socket.close(1000, 'إغلاق من قبل المستخدم');
        }
        this.isConnected = false;
        this.reconnectAttempts = this.maxReconnectAttempts; // منع إعادة الاتصال
    }

    /**
     * الحصول على حالة الاتصال
     */
    getConnectionState() {
        if (!this.socket) return 'disconnected';
        
        switch (this.socket.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting';
            case WebSocket.OPEN:
                return 'connected';
            case WebSocket.CLOSING:
                return 'closing';
            case WebSocket.CLOSED:
                return 'disconnected';
            default:
                return 'unknown';
        }
    }

    /**
     * تعيين معرّف العميل
     */
    setClientId(id) {
        this.clientId = id;
    }

    /**
     * الحصول على معرّف العميل
     */
    getClientId() {
        return this.clientId;
    }
}