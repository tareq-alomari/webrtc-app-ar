/**
 * =================================================================
 * Main Application Entry Point (نقطة دخول التطبيق الرئيسية)
 * =================================================================
 * * تهيئة التطبيق وإدارة دورة الحياة
 */

class WebrtcApp {
    constructor() {
        this.sessionManager = null;
        this.isInitialized = false;
    }

    /**
     * تهيئة التطبيق
     */
    init() {
        if (this.isInitialized) {
            console.warn('⚠️ Application already initialized');
            return;
        }

        console.log('🚀 Starting WebRTC Application...');
        
        try {
            // فحص دعم المتصفح
            if (!this.checkBrowserSupport()) {
                return;
            }

            // إنشاء وإدارة الجلسة
            this.sessionManager = new SessionManager();
            this.sessionManager.init();
            
            this.isInitialized = true;
            console.log('✅ WebRTC Application initialized successfully');
            
            // إظهار رسالة ترحيب
            this.showWelcomeMessage();
            
        } catch (error) {
            console.error('❌ Failed to initialize application:', error);
            this.showError('فشل في تهيئة التطبيق: ' + error.message);
        }
    }

    /**
     * فحص دعم المتصفح للميزات المطلوبة
     */
    /**
 * فحص دعم المتصفح للميزات المطلوبة
 */
checkBrowserSupport() {
    const requiredFeatures = {
        'WebRTC': !!window.RTCPeerConnection,
        'WebSocket': !!window.WebSocket,
        'MediaDevices': !!navigator.mediaDevices,
        'GetUserMedia': !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        'Promise': !!window.Promise,
        'JSON': !!window.JSON
    };

    // حل بديل للمتصفحات القديمة
    if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
    }

    if (!navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia = function(constraints) {
            const legacyGetUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
            if (!legacyGetUserMedia) {
                return Promise.reject(new Error('getUserMedia is not supported'));
            }
            return new Promise(function(resolve, reject) {
                legacyGetUserMedia.call(navigator, constraints, resolve, reject);
            });
        };
    }

    const missingFeatures = Object.keys(requiredFeatures).filter(feature => !requiredFeatures[feature]);

    if (missingFeatures.length > 0) {
        const errorMessage = `
            المتصفح الحالي لا يدعم بعض الميزات المطلوبة:
            ${missingFeatures.join(', ')}
            
            يرجى استخدام متصفح حديث مثل:
            • Chrome 60+
            • Firefox 55+  
            • Edge 79+
            • Safari 11+
        `;
        
        this.showError(errorMessage);
        return false;
    }

    console.log('✅ All required features are supported');
    return true;
}

    /**
     * إظهار رسالة ترحيب
     */
    showWelcomeMessage() {
        console.log(`
            🎉 Welcome to WebRTC Video Conference!
            
            Features:
            • Multi-user video calls
            • Real-time chat
            • Host controls
            • Mobile responsive
            • Auto-reconnection
            
            Developed by: علي القواس, حازم العمري, طارق العمري
            Supervised by: الدكتور إياد المخلافي
        `);
    }

    /**
     * إظهار خطأ للمستخدم
     */
    showError(message) {
        const errorHtml = `
            <div class="alert alert-danger text-center">
                <h4>⚠️ خطأ في التطبيق</h4>
                <p>${message}</p>
                <hr>
                <p class="mb-0">يرجى تحديث الصفحة أو استخدام متصفح مختلف.</p>
            </div>
        `;
        
        document.body.innerHTML = errorHtml;
    }

    /**
     * إعادة تحميل التطبيق
     */
    reload() {
        if (this.sessionManager) {
            this.sessionManager.leaveCall();
        }
        window.location.reload();
    }

    /**
     * تدمير التطبيق
     */
    destroy() {
        if (this.sessionManager) {
            this.sessionManager.leaveCall();
            this.sessionManager = null;
        }
        this.isInitialized = false;
        console.log('🧹 Application destroyed');
    }
}

// تهيئة التطبيق عند تحميل الصفحة بالكامل
window.addEventListener('load', function() {
    // إضافة شاشة التحميل
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex; justify-content: center; align-items: center;
        z-index: 9999; color: white; transition: opacity 0.5s ease;
    `;
    loadingOverlay.innerHTML = `
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .loading-spinner {
                width: 50px; height: 50px;
                border: 5px solid rgba(255,255,255,0.3);
                border-top: 5px solid white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
        </style>
        <div class="text-center">
            <div class="loading-spinner mb-3"></div>
            <h4>جاري تحميل التطبيق...</h4>
            <p>مكالمات الفيديو الجماعية</p>
        </div>
    `;
    document.body.appendChild(loadingOverlay);
    
    // تأخير بسيط لإظهار شاشة التحميل ثم بدء التطبيق
    setTimeout(() => {
        const app = new WebrtcApp();
        app.init();
        
        // إخفاء شاشة التحميل بسلاسة
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.remove(), 500);
        
        window.webrtcApp = app; // للتصحيح فقط
    }, 500); // تأخير بسيط لتحسين التجربة
});

// معالجة الأخطاء العالمية
window.addEventListener('error', function(event) {
    console.error('🌍 Global error:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('🌍 Unhandled promise rejection:', event.reason);
});