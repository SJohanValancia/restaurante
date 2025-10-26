const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  numeroMesa: {  // ← CAMBIAR DE "mesa" A "numeroMesa"
    type: Number,
    required: [true, 'El número de mesa es obligatorio'],
    min: [1, 'El número de mesa debe ser mayor a 0']
  },
  items: [{
    producto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    nombreProducto: {
      type: String,
      required: true
    },
    categoriaProducto: {
      type: String,
      default: 'Sin categoría'
    },
    cantidad: {
      type: Number,
      required: true,
      min: [1, 'La cantidad debe ser mayor a 0']
    },
    precio: {
      type: Number,
      required: true,
      min: [0, 'El precio no puede ser negativo']
    }
  }],
  total: {
    type: Number,
    required: true,
    min: [0, 'El total no puede ser negativo']
  },
  estado: {
    type: String,
    enum: ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'],
    default: 'pendiente'
  },
  metodoPago: {
    type: String,
    enum: ['efectivo', 'transferencia'],
    default: null
  },
  reciboDia: {
    type: Boolean,
    default: false
  },
  notas: {
    type: String,
    trim: true,
    maxlength: [500, 'Las notas no pueden exceder 500 caracteres']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // AGREGAR ESTOS CAMPOS NUEVOS para el seguimiento público
  nombreRestaurante: {
    type: String,
    required: true
  },
  sede: {
    type: String,
    default: null
  },
  mesero: {
    type: String,
    default: function() {
      return this.userId ? 'Usuario' : 'Desconocido';
    }
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índices
orderSchema.index({ numeroMesa: 1 });  // ← CAMBIAR
orderSchema.index({ estado: 1 });
orderSchema.index({ userId: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ reciboDia: 1 });
orderSchema.index({ nombreRestaurante: 1, numeroMesa: 1 });  // ← NUEVO índice compuesto

orderSchema.pre('save', function(next) {
  if (this.items && this.items.length > 0) {
    this.total = this.items.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);
  }
  next();
});

orderSchema.virtual('totalFormateado').get(function() {
  return `$${this.total.toLocaleString('es-CO')}`;
});

orderSchema.virtual('totalItems').get(function() {
  return this.items.reduce((sum, item) => sum + item.cantidad, 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);