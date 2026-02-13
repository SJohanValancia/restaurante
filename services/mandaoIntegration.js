// URL del servidor de Mandao (ajustar según entorno)
const MANDAO_API_URL = 'https://mandao-server.onrender.com/api';

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

        const data = await response.json();
        if (response.ok && data.success) {
            console.log(`✅ Mandao notificado correctamente.`);
        } else {
            console.error(`⚠️ Error al notificar a Mandao:`, data.message || response.statusText);
        }
    } catch (error) {
        console.error('❌ Error de conexión al notificar a Mandao:', error.message);
    }
}

module.exports = {
    notifyMandaoStatusChange
};
