const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');

// Registrar token push (ruta pública para clientes)
router.post('/register', async (req, res) => {
    try {
        const { token, mesa, restaurante, sede } = req.body;

        if (!token || !mesa || !restaurante) {
            return res.status(400).json({
                success: false,
                message: 'Token, mesa y restaurante son requeridos'
            });
        }

        // Buscar si el token ya existe
        let pushToken = await PushToken.findOne({ token });

        if (pushToken) {
            // Actualizar información existente
            pushToken.mesa = mesa;
            pushToken.restaurante = restaurante;
            pushToken.sede = sede || null;
            pushToken.active = true;
            pushToken.lastUsed = new Date();
            await pushToken.save();

            console.log('✅ Token actualizado para mesa:', mesa);
        } else {
            // Crear nuevo registro
            pushToken = await PushToken.create({
                token,
                mesa,
                restaurante,
                sede: sede || null
            });

            console.log('✅ Nuevo token registrado para mesa:', mesa);
        }

        res.json({
            success: true,
            message: 'Token registrado exitosamente',
            data: {
                id: pushToken._id,
                mesa: pushToken.mesa,
                restaurante: pushToken.restaurante
            }
        });
    } catch (error) {
        console.error('❌ Error registrando token:', error);
        res.status(500).json({
            success: false,
            message: 'Error al registrar token',
            error: error.message
        });
    }
});

// Prueba de notificación (para verificar que llegan)
router.post('/test', async (req, res) => {
    try {
        const { token } = req.body;
        const { sendPushNotification } = require('../services/pushNotification');

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token es requerido'
            });
        }

        const result = await sendPushNotification(
            token,
            '🔔 Prueba de Notificación',
            'Si ves esto, las notificaciones funcionan correctamente.',
            { emoji: '🚀' }
        );

        res.json({
            success: result.success,
            message: result.success ? 'Notificación de prueba enviada' : 'Error enviando notificación',
            details: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error en prueba de notificación',
            error: error.message
        });
    }
});

// Eliminar token (cuando el usuario revoca permisos)
router.delete('/unregister', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token es requerido'
            });
        }

        await PushToken.findOneAndUpdate(
            { token },
            { active: false }
        );

        res.json({
            success: true,
            message: 'Token desregistrado exitosamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al desregistrar token',
            error: error.message
        });
    }
});

module.exports = router;
