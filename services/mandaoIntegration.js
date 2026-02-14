// URL del servidor de Mandao (ajustar según entorno)
const MANDAO_API_URL = 'https://mandao.onrender.com/api';

/**
 * Inicia sesión en Mandao para verificar credenciales
 * @param {String} email 
 * @param {String} password 
 * @returns {Object} { success, token, user }
 */
async function loginToMandao(email, password) {
    try {
        console.log(`🔌 Conectando con Mandao para login: ${email}`);

        const response = await fetch(`${MANDAO_API_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`❌ Mandao Error ${response.status}:`, JSON.stringify(data));
            throw new Error(data.message || `Error al iniciar sesión en Mandao (Status: ${response.status})`);
        }

        return data; // Esperamos { success: true, token, usuario: {...} }

    } catch (error) {
        console.error('❌ Error login en Mandao (Detalle):', error);
        throw error;
    }
}

/**
 * Obtiene los productos del usuario desde Mandao
 * @param {String} token Token de autenticación de Mandao
 * @returns {Array} Lista de productos
 */
async function getMandaoProducts(token) {
    try {
        const response = await fetch(`${MANDAO_API_URL}/products`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Error obteniendo productos de Mandao');

        const data = await response.json();
        return data.products || [];

    } catch (error) {
        console.error('❌ Error obteniendo productos Mandao:', error.message);
        return [];
    }
}

/**
 * Obtiene los ingredientes/alimentos del usuario desde Mandao
 * @param {String} token Token de autenticación de Mandao
 * @returns {Array} Lista de alimentos
 */
async function getMandaoAlimentos(token) {
    try {
        const response = await fetch(`${MANDAO_API_URL}/alimentos`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) throw new Error('Error obteniendo alimentos de Mandao');

        const data = await response.json();
        return data.alimentos || []; // Ajustar según la estructura de respuesta de Mandao

    } catch (error) {
        console.error('❌ Error obteniendo alimentos Mandao:', error.message);
        return [];
    }
}

/**
 * Notifica a Mandao que el estado de un pedido ha cambiado en JC-RT
 * @param {String} mandaoOrderId ID del pedido en Mandao
 * @param {String} status Nuevo estado (pendiente, preparando, listo, entregado, cancelado)
 */
async function notifyMandaoStatusChange(mandaoOrderId, status) {
    if (!mandaoOrderId) return;

    try {
        console.log(`📤 Notificando a Mandao cambio de estado: ${mandaoOrderId} -> ${status}`);

        const response = await fetch(`${MANDAO_API_URL}/jcrt/status-update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mandaoOrderId,
                status,
                secret: 'webhook-secret' // Debería coincidir con lo esperado en Mandao
            })
        });

        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
            if (response.ok && data.success) {
                console.log(`✅ Mandao notificado correctamente.`);
            } else {
                console.error(`⚠️ Error al notificar a Mandao (JSON):`, data.message || response.statusText);
            }
        } else {
            const text = await response.text();
            console.error(`⚠️ Mandao respondió con formato no JSON (${response.status} ${response.statusText}):`, text.substring(0, 100));
        }
    } catch (error) {
        console.error('❌ Error de conexión al notificar a Mandao:', error.message);
    }
}

module.exports = {
    loginToMandao,
    getMandaoProducts,
    getMandaoAlimentos,
    notifyMandaoStatusChange
};
