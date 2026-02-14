const User = require('../models/User');

/**
 * Inicia las tareas programadas (Cron Jobs)
 * Se ejecuta periódicamente para mantenimiento del sistema.
 */
function startCronJobs() {
    console.log('⏰ Servicio de Cron Jobs iniciado.');

    // Ejecutar verificación cada hora (3600000 ms)
    setInterval(checkExpiredSubscriptions, 3600000);

    // Ejecutar una vez al inicio para asegurar estado consistente
    checkExpiredSubscriptions();
}

/**
 * Verifica suscripciones vencidas y boquea restaurantes
 */
async function checkExpiredSubscriptions() {
    try {
        console.log('🔍 Verificando suscripciones vencidas...');
        const now = new Date();

        // 1. Buscar administradores con fecha de pago vencida y que NO estén bloqueados aún
        const expiredAdmins = await User.find({
            rol: 'admin',
            fechaPago: { $lt: now },
            bloqueado: { $ne: true } // Solo los que no estan bloqueados
        });

        if (expiredAdmins.length === 0) {
            console.log('✅ No hay suscripciones nuevas por vencer.');
            return;
        }

        console.log(`⚠️ Encontrados ${expiredAdmins.length} restaurantes vencidos. Procesando bloqueos...`);

        let count = 0;
        for (const admin of expiredAdmins) {
            if (!admin.nombreRestaurante) continue;

            const motivo = 'Su plan ha vencido. Por favor realice el pago para continuar disfrutando del servicio.';

            // Bloquear al admin y a TODOS los usuarios de ese restaurante
            const result = await User.updateMany(
                { nombreRestaurante: admin.nombreRestaurante, bloqueado: { $ne: true } },
                {
                    bloqueado: true,
                    motivoBloqueo: motivo,
                    fechaBloqueo: now
                }
            );

            console.log(`🔒 Restaurante "${admin.nombreRestaurante}" bloqueado. (${result.modifiedCount} usuarios afectados)`);
            count++;
        }

        console.log(`🏁 Proceso finalizado. ${count} restaurantes bloqueados.`);

    } catch (error) {
        console.error('❌ Error en cron job de suscripciones:', error);
    }
}

module.exports = { startCronJobs };
