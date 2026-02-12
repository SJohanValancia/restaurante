const admin = require('firebase-admin');

// Inicializar Firebase Admin (solo una vez)
let firebaseInitialized = false;

function initializeFirebase() {
    if (firebaseInitialized) return;

    try {
        // 1️⃣ Intentar cargar desde archivo JSON (más fácil)
        try {
            const serviceAccount = require('../service-account.json');
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            firebaseInitialized = true;
            console.log('✅ Firebase Admin inicializado desde service-account.json');
            return;
        } catch (e) {
            console.log('ℹ️ No se encontró service-account.json, intentando variables de entorno...');
        }

        // 2️⃣ Intentar cargar desde variables de entorno
        if (process.env.FIREBASE_PRIVATE_KEY) {
            let privateKey = process.env.FIREBASE_PRIVATE_KEY;

            // 🛠️ 1. Reemplazar \n literales por saltos de línea reales
            privateKey = privateKey.replace(/\\n/g, '\n');

            // 🛠️ 2. Eliminar comillas dobles al inicio y final (común en Render/enviromments)
            if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
                privateKey = privateKey.slice(1, -1);
            }

            // 🛠️ 3. Eliminar comillas simples
            if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
                privateKey = privateKey.slice(1, -1);
            }

            const serviceAccount = {
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey
            };

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });

            firebaseInitialized = true;
            console.log('✅ Firebase Admin inicializado desde .env');
        } else {
            console.error('❌ No se encontraron credenciales de Firebase (ni JSON ni .env)');
        }
    } catch (error) {
        console.error('❌ Error inicializando Firebase Admin:', error);
    }
}

/**
 * Envía una notificación push a un token específico
 * ✅ Usa DATA-ONLY messages para máxima compatibilidad con Android heads-up
 * @param {string} token - Token FCM del dispositivo
 * @param {string} titulo - Título de la notificación
 * @param {string} mensaje - Cuerpo de la notificación
 * @param {object} data - Datos adicionales
 */
async function sendPushNotification(token, titulo, mensaje, data = {}) {
    if (!firebaseInitialized) {
        initializeFirebase();
    }

    if (!token) {
        console.log('⚠️ No hay token para enviar notificación');
        return { success: false, error: 'No token provided' };
    }

    // ✅ DATA-ONLY MESSAGE - El service worker siempre lo maneja
    // Esto permite control total sobre la notificación y funciona mejor para heads-up
    const message = {
        token: token,
        // ✅ NO usamos 'notification' - usamos solo 'data'
        data: {
            title: titulo,
            body: mensaje,
            emoji: data.emoji || '📋',
            estado: data.estado || '',
            mesa: data.mesa || '',
            restaurante: data.restaurante || '',
            timestamp: Date.now().toString(),
            click_action: '/seguimiento.html'
        },
        // ✅ Android: Máxima prioridad para heads-up
        android: {
            priority: 'high',
            ttl: 60 * 1000, // 1 minuto TTL
            // Sin notification aquí - todo a través de data
        },
        // ✅ APNs (iOS): Alta prioridad
        apns: {
            payload: {
                aps: {
                    'content-available': 1,
                    sound: 'default'
                }
            },
            headers: {
                'apns-priority': '10',
                'apns-push-type': 'background'
            }
        },
        // ✅ Web Push: Configuración de urgencia
        webpush: {
            headers: {
                'Urgency': 'high',
                'TTL': '60'
            },
            fcmOptions: {
                link: '/seguimiento.html'
            }
        }
    };

    try {
        const response = await admin.messaging().send(message);
        console.log('✅ Push DATA-ONLY enviado:', response);
        return { success: true, messageId: response };
    } catch (error) {
        console.error('❌ Error enviando push:', error);

        // Si el token es inválido, marcarlo como inactivo
        if (error.code === 'messaging/registration-token-not-registered' ||
            error.code === 'messaging/invalid-registration-token') {
            const PushToken = require('../models/PushToken');
            await PushToken.findOneAndUpdate({ token }, { active: false });
            console.log('🗑️ Token inválido marcado como inactivo');
        }

        return { success: false, error: error.message };
    }
}

/**
 * Envía notificación a todos los dispositivos de una mesa
 * @param {string} mesa - Número de mesa
 * @param {string} restaurante - Nombre del restaurante
 * @param {string} estado - Nuevo estado del pedido
 */
async function notifyOrderStatusChange(mesa, restaurante, estado) {
    const PushToken = require('../models/PushToken');

    // Normalizar mesa para búsqueda
    const mesaNormalizada = mesa
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    // Buscar tokens activos para esta mesa y restaurante
    const tokens = await PushToken.find({
        mesaNormalizada: mesaNormalizada,
        restaurante: restaurante,
        active: true
    });

    if (tokens.length === 0) {
        console.log('⚠️ No hay tokens registrados para mesa:', mesa, 'restaurante:', restaurante);
        return { success: true, sent: 0 };
    }

    // Mapeo de estados a mensajes con emoji
    const estadoInfo = {
        'pendiente': { emoji: '⏳', titulo: 'Pedido Recibido', mensaje: 'Tu pedido ha sido recibido y será procesado pronto' },
        'preparando': { emoji: '👨‍🍳', titulo: '¡Preparando tu Pedido!', mensaje: 'Nuestro chef está preparando tu orden con mucho cariño' },
        'listo': { emoji: '✅', titulo: '¡Pedido Listo!', mensaje: '¡Tu pedido está listo para ser servido!' },
        'entregado': { emoji: '🎉', titulo: '¡Buen Provecho!', mensaje: 'Disfruta tu comida. ¡Gracias por preferirnos!' }
    };

    const info = estadoInfo[estado] || { emoji: '📋', titulo: 'Actualización', mensaje: `Estado: ${estado}` };

    // Enviar a todos los tokens
    let sent = 0;
    for (const tokenDoc of tokens) {
        const result = await sendPushNotification(
            tokenDoc.token,
            info.titulo,
            info.mensaje,
            { estado, mesa, restaurante, emoji: info.emoji }
        );

        if (result.success) sent++;

        // Actualizar última vez usado
        tokenDoc.lastUsed = new Date();
        await tokenDoc.save();
    }

    console.log(`✅ Notificaciones DATA-ONLY enviadas: ${sent}/${tokens.length} para mesa ${mesa}`);
    return { success: true, sent, total: tokens.length };
}

module.exports = {
    initializeFirebase,
    sendPushNotification,
    notifyOrderStatusChange
};
