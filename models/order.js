const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  mesa: {
    type: String,
    required: [true, 'El número de mesa es obligatorio'],
    trim: true,
    maxlength: [20, 'El nombre de mesa no puede exceder 20 caracteres']
  },
  mesaNormalizada: {
    type: String,
    lowercase: true,
    trim: true
  },
  items: [{
    producto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false // Permitir null para pedidos externos como Mandao
    },
    origenPedido: {
      type: String,
      enum: ['mesero', 'cliente'],
      default: 'mesero'
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
    }],
    // ✅ MULTI-LOCAL HUB: Dueño del producto (local)
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // ✅ Alimentos excluidos (no descontar del inventario)
    alimentosExcluidos: [{
      alimentoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Alimento'
      },
      nombre: String
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
    enum: ['efectivo', 'transferencia', 'mixto'],
    default: null
  },
  // ✅ PAGOS PARCIALES/MIXTOS
  pagos: [{
    metodo: {
      type: String,
      enum: ['efectivo', 'transferencia'],
      required: true
    },
    monto: {
      type: Number,
      required: true,
      min: [0, 'El monto no puede ser negativo']
    },
    fecha: {
      type: Date,
      default: Date.now
    }
  }],
  totalPagado: {
    type: Number,
    default: 0,
    min: 0
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
    default: function () {
      return this.userId ? 'Usuario' : 'Desconocido';
    }
  },
  mandaoOrderId: {
    type: String,
    default: null
  },
  source: {
    type: String,
    enum: ['local', 'mandao'],
    default: 'local'
  },
  clienteNombre: {
    type: String,
    trim: true,
    default: ''
  },
  clienteCcNit: {
    type: String,
    trim: true,
    default: ''
  },
  // ✅ MULTI-LOCAL HUB: Mesero que creó el pedido (cuando es hub)
  meseroHubId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // ✅ MULTI-LOCAL HUB: Grupo de órdenes divididas (mismo pedido original)
  hubOrderGroup: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false
});

orderSchema.index({ mesaNormalizada: 1, userId: 1 });
orderSchema.index({ userId: 1, estado: 1, createdAt: -1 });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ estado: 1, createdAt: -1 });
orderSchema.index({ source: 1, createdAt: -1 });
orderSchema.index({ mandaoOrderId: 1 });

// ✅ FUNCIÓN PARA NORMALIZAR TEXTO (QUITAR TILDES)
function normalizeText(text) {
  if (!text) return '';
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ✅ MIDDLEWARE PARA INICIALIZAR ESTADOS INDIVIDUALES Y NORMALIZAR MESA
orderSchema.pre('save', function (next) {
  // Normalizar mesa
  if (this.mesa) {
    this.mesaNormalizada = normalizeText(this.mesa);
  }

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

orderSchema.virtual('totalFormateado').get(function () {
  return `$${this.total.toLocaleString('es-CO')}`;
});

orderSchema.virtual('totalItems').get(function () {
  return this.items.reduce((sum, item) => sum + item.cantidad, 0);
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);