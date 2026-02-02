const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema({
    // Token FCM del dispositivo
    token: {
        type: String,
        required: true,
        unique: true
    },
    // Mesa asociada (normalizada para búsqueda)
    mesa: {
        type: String,
        required: true
    },
    mesaNormalizada: {
        type: String,
        lowercase: true,
        trim: true
    },
    // Restaurante/Usuario al que pertenece
    restaurante: {
        type: String,
        required: true
    },
    // Sede (opcional)
    sede: {
        type: String,
        default: null
    },
    // Última vez que se usó (para limpieza)
    lastUsed: {
        type: Date,
        default: Date.now
    },
    // Estado activo
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Índices para búsqueda rápida
pushTokenSchema.index({ mesaNormalizada: 1, restaurante: 1 });
pushTokenSchema.index({ token: 1 });
pushTokenSchema.index({ lastUsed: 1 });

// Normalizar mesa antes de guardar
pushTokenSchema.pre('save', function (next) {
    if (this.mesa) {
        this.mesaNormalizada = this.mesa
            .toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }
    next();
});

module.exports = mongoose.model('PushToken', pushTokenSchema);
