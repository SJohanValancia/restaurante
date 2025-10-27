const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  mesa: {
    type: String,
    required: [true, 'El número de mesa es obligatorio'],
    trim: true,
    maxlength: [20, 'El nombre de mesa no puede exceder 20 caracteres']
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
    },
    // ✅ NUEVOS CAMPOS PARA ESTADOS INDIVIDUALES
    estadosIndividuales: [{
      cantidad: {
        type: Number,
        required: true,
        min: 1
      },
      estado: {
        type: String,
        enum: ['pendiente', 'preparando', 'listo', 'entregado'],
        default: 'pendiente'
      }
    }]
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

orderSchema.index({ mesa: 1 });
orderSchema.index({ estado: 1 });
orderSchema.index({ userId: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ reciboDia: 1 });

// ✅ MIDDLEWARE PARA INICIALIZAR ESTADOS INDIVIDUALES
orderSchema.pre('save', function(next) {
  // Inicializar estadosIndividuales si no existen
  this.items.forEach(item => {
    if (!item.estadosIndividuales || item.estadosIndividuales.length === 0) {
      item.estadosIndividuales = [{
        cantidad: item.cantidad,
        estado: 'pendiente'
      }];
    }
  });
  
  // Calcular total
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