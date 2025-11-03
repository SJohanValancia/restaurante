const mongoose = require('mongoose');

const alimentoSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre del alimento es obligatorio'],
    trim: true,
    maxlength: [100, 'El nombre no puede exceder 100 caracteres']
  },
  stock: {
    type: Number,
    required: [true, 'El stock es obligatorio'],
    min: [0, 'El stock no puede ser negativo'],
    default: 0
  },
  valor: {
    type: Number,
    required: [true, 'El valor es obligatorio'],
    min: [0, 'El valor no puede ser negativo']
  },
  // ✅ CAMBIO: Ahora es un array de productos
  productos: [{
    productoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    cantidadRequerida: {
      type: Number,
      required: [true, 'La cantidad requerida es obligatoria'],
      min: [1, 'La cantidad debe ser al menos 1']
    }
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índices
alimentoSchema.index({ nombre: 1 });
alimentoSchema.index({ 'productos.productoId': 1 });
alimentoSchema.index({ userId: 1 });

module.exports = mongoose.model('Alimento', alimentoSchema);