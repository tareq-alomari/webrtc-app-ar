/**
 * Hotfix for Immediate Issues - إصلاح فوري للمشاكل
 */

// إصلاح شامل للمتصفح
function applyBrowserCompatibilityFixes() {
    console.log('🔧 Applying comprehensive fixes...');
    
    // إصلاح mediaDevices
    if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
    }
    
    // إصلاح getUserMedia
    if (!navigator.mediaDevices.getUserMedia) {
        const legacyAPI = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        if (legacyAPI) {
            navigator.mediaDevices.getUserMedia = (constraints) => 
                new Promise((resolve, reject) => legacyAPI.call(navigator, constraints, resolve, reject));
        }
    }
    
    // إصلاح الفيديو
    document.querySelectorAll('video').forEach(video => {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
    });
    
    console.log('✅ Comprehensive fixes applied');
}

// تطبيق الإصلاحات عند التحميل
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Applying browser compatibility fixes...');
    applyBrowserCompatibilityFixes();
    // تم تعطيل rebindAllEvents لأنها تسبب مشاكل وتتعارض مع event delegation
    // setTimeout(rebindAllEvents, 1000); 
});

// تم تعطيل تعديل RTCPeerConnection العام.
// من الأفضل تمرير الإعدادات مباشرة عند إنشاء الكائن.
// if (window.RTCPeerConnection) { ... }