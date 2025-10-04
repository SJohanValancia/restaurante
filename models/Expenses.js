const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: [true, 'La fecha es obligatoria']
  },
  gastos: [{
    descripcion: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: [200, 'La descripción no puede exceder 200 caracteres']
    },
    monto: {
      type: Number,
      required: [true, 'El monto es obligatorio'],
      min: [0, 'El monto no puede ser negativo']
    }
  }],
  total: {
    type: Number,
    default: 0
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  versionKey: false
});

expenseSchema.pre('save', function(next) {
  this.total = this.gastos.reduce((sum, gasto) => sum + gasto.monto, 0);
  next();
});

expenseSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update.gastos) {
    update.total = update.gastos.reduce((sum, gasto) => sum + gasto.monto, 0);
  }
  next();
});

expenseSchema.index({ fecha: -1 });
expenseSchema.index({ userId: 1 });

module.exports = mongoose.model('Expense', expenseSchema);