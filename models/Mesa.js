const mongoose = require('mongoose');

const mesaSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre de la mesa es obligatorio'],
    trim: true,
    maxlength: [30, 'El nombre de la mesa no puede exceder 30 caracteres']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  activa: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índice compuesto para búsquedas rápidas y unicidad por usuario
mesaSchema.index({ userId: 1, nombre: 1 }, { unique: true });
mesaSchema.index({ userId: 1, activa: 1 });

module.exports = mongoose.model('Mesa', mesaSchema);
