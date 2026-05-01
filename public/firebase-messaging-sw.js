// Firebase Messaging Service Worker
// JC Restaurant - Push Notifications (Data-Only Messages)

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

// Firebase configuration
firebase.initializeApp({
    apiKey: "AIzaSyDoGAGH3G0ZXbQ0C2oAVu5VVKWhLAjNj10",
    authDomain: "restaurante-24114.firebaseapp.com",
    projectId: "restaurante-24114",
    storageBucket: "restaurante-24114.firebasestorage.app",
    messagingSenderId: "475296003209",
    appId: "1:475296003209:web:31e470e3559f4ccb540258"
});

const messaging = firebase.messaging();

// ✅ Handle data-only messages in background
messaging.onBackgroundMessage((payload) => {
    console.log('📬 Push recibido en background:', payload);

    // Extract data from payload (data-only message)
    const data = payload.data || {};
    const title = data.title || '🍽️ JC Restaurant';
    const body = data.body || 'Tu pedido ha sido actualizado';
    const emoji = data.emoji || '📋';

    const notificationOptions = {
        body: body,
        icon: '/icon-192.png',
        badge: '/icon-badge.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: 'order-update-' + Date.now(),
        renotify: true,
        requireInteraction: true,
        silent: false,
        data: data,
        actions: [
            { action: 'view', title: '👀 Ver pedido' },
            { action: 'close', title: '✕ Cerrar' }
        ]
    };

    return self.registration.showNotification(`${emoji} ${title}`, notificationOptions);
});

// ✅ Fallback: Handle raw push events (for maximum compatibility)
self.addEventListener('push', (event) => {
    console.log('📬 Push event recibido:', event);

    // Check if this is already handled by Firebase
    if (event.data) {
        try {
            const payload = event.data.json();
            
            // If it has notification field, Firebase SDK may handle it
            if (payload.notification) {
                console.log('📬 Push con notification payload, delegando a Firebase SDK');
                return;
            }

            // Handle data-only message
            const data = payload.data || payload;
            const title = data.title || '🍽️ JC Restaurant';
            const body = data.body || 'Tu pedido ha sido actualizado';
            const emoji = data.emoji || '📋';

            const notificationOptions = {
                body: body,
                icon: '/icon-192.png',
                badge: '/icon-badge.png',
                vibrate: [200, 100, 200, 100, 200],
                tag: 'order-update-' + Date.now(),
                renotify: true,
                requireInteraction: true,
                silent: false,
                data: data
            };

            event.waitUntil(
                self.registration.showNotification(`${emoji} ${title}`, notificationOptions)
            );
        } catch (e) {
            console.log('📬 Push con texto plano:', event.data.text());
            event.waitUntil(
                self.registration.showNotification('🍽️ JC Restaurant', {
                    body: event.data.text(),
                    icon: '/icon-192.png',
                    vibrate: [200, 100, 200]
                })
            );
        }
    }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('🖱️ Click en notificación');
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
                // Find existing window
                for (const client of clientList) {
                    if (client.url.includes('seguimiento.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Open new window
                if (clients.openWindow) {
                    return clients.openWindow('/seguimiento.html');
                }
            })
        );
    }
});

// Install event
self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker instalado');
    self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activado');
    event.waitUntil(clients.claim());
});
