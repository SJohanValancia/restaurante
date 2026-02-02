// Service Worker para notificaciones push
// JC Restaurant - Push Notifications

const CACHE_NAME = 'jc-restaurant-v1';

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker instalado');
    self.skipWaiting();
});

// Activación
self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activado');
    event.waitUntil(clients.claim());
});

// Manejo de notificaciones push
self.addEventListener('push', (event) => {
    console.log('📬 Push recibido');

    const options = {
        body: event.data ? event.data.text() : 'Tu pedido ha sido actualizado',
        icon: '/icon-192.png',
        badge: '/icon-badge.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: 'order-update',
        renotify: true,
        requireInteraction: true,
        actions: [
            { action: 'view', title: '👀 Ver pedido' },
            { action: 'close', title: '✕ Cerrar' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('🍽️ JC Restaurant', options)
    );
});

// Click en la notificación
self.addEventListener('notificationclick', (event) => {
    console.log('🖱️ Click en notificación');
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then((clientList) => {
                // Si ya hay una ventana abierta, enfócala
                for (const client of clientList) {
                    if (client.url.includes('seguimiento.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Si no, abre una nueva
                if (clients.openWindow) {
                    return clients.openWindow('/seguimiento.html');
                }
            })
        );
    }
});

// Cierre de notificación
self.addEventListener('notificationclose', (event) => {
    console.log('❌ Notificación cerrada');
});
