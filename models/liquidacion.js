const mongoose = require('mongoose');

const liquidacionSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: true,
    default: Date.now
  },
  cajaInicial: {
    type: Number,
    required: true,
    default: 0
  },
  ingresos: {
    totalPedidos: {
      type: Number,
      default: 0
    },
    pedidos: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    }]
  },
  egresos: {
    totalGastos: {
      type: Number,
      default: 0
    },
    gastos: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense'
    }]
  },
  movimientosCaja: [{
    tipo: {
      type: String,
      enum: ['ingreso', 'retiro'],
      required: true
    },
    monto: {
      type: Number,
      required: true
    },
    motivo: {
      type: String,
      required: true,
      trim: true
    },
    fecha: {
      type: Date,
      default: Date.now
    }
  }],
  totalMovimientos: {
    type: Number,
    default: 0
  },
  cajaFinal: {
    type: Number,
    required: true
  },
  observaciones: {
    type: String,
    trim: true,
    maxlength: [1000, 'Las observaciones no pueden exceder 1000 caracteres']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cerrada: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índices
liquidacionSchema.index({ fecha: -1 });
liquidacionSchema.index({ userId: 1 });
liquidacionSchema.index({ cerrada: 1 });

// Calcular totales antes de guardar
liquidacionSchema.pre('save', function(next) {
  // Calcular total de movimientos
  this.totalMovimientos = this.movimientosCaja.reduce((sum, mov) => {
    if (mov.tipo === 'ingreso') {
      return sum + mov.monto;
    } else {
      return sum - mov.monto;
    }
  }, 0);


  
  next();
});

module.exports = mongoose.model('Liquidacion', liquidacionSchema);