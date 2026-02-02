// Firebase Messaging Service Worker
// JC Restaurant - Push Notifications

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

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('📬 Push recibido en background:', payload);

    const notificationTitle = payload.notification?.title || '🍽️ JC Restaurant';
    const notificationOptions = {
        body: payload.notification?.body || 'Tu pedido ha sido actualizado',
        icon: '/icon-192.png',
        badge: '/icon-badge.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: 'order-update',
        renotify: true,
        requireInteraction: true,
        data: payload.data,
        actions: [
            { action: 'view', title: '👀 Ver pedido' },
            { action: 'close', title: '✕ Cerrar' }
        ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    console.log('🖱️ Click en notificación');
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes('seguimiento.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow('/seguimiento.html');
                }
            })
        );
    }
});

// Cache name for offline support
const CACHE_NAME = 'jc-restaurant-v1';

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
