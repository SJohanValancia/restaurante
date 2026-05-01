// Registro del Service Worker para la PWA de Mandao
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('✅ Mandao PWA: Service Worker registrado con éxito:', registration.scope);
            })
            .catch(error => {
                console.error('❌ Mandao PWA: Error al registrar el Service Worker:', error);
            });
    });
}
