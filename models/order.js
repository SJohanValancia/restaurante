const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  mesa: {
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

// Índices para mejorar el rendimiento
orderSchema.index({ mesa: 1 });
orderSchema.index({ estado: 1 });
orderSchema.index({ userId: 1 });
orderSchema.index({ createdAt: -1 });

// Calcular total antes de guardar
orderSchema.pre('save', function(next) {
  if (this.items && this.items.length > 0) {
    this.total = this.items.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);
  }
  next();
});

// Virtual para obtener el total formateado
orderSchema.virtual('totalFormateado').get(function() {
  return `$${this.total.toLocaleString('es-CO')}`;
});

// Virtual para obtener el número de items
orderSchema.virtual('totalItems').get(function() {
  return this.items.reduce((sum, item) => sum + item.cantidad, 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);