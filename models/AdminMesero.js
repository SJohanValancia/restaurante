const mongoose = require('mongoose');

const adminMeseroSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  meseroId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  permisos: {
    verProductos: { type: Boolean, default: true },
    crearProductos: { type: Boolean, default: false },
    editarProductos: { type: Boolean, default: false },
    eliminarProductos: { type: Boolean, default: false },
    verPedidos: { type: Boolean, default: true },
    crearPedidos: { type: Boolean, default: true },
    editarPedidos: { type: Boolean, default: false },
    cancelarPedidos: { type: Boolean, default: false },
    verGastos: { type: Boolean, default: true },
    crearGastos: { type: Boolean, default: true },
    editarGastos: { type: Boolean, default: false },     // NUEVO
    eliminarGastos: { type: Boolean, default: false },   // NUEVO
    verReportes: { type: Boolean, default: false },
    verLiquidaciones: { type: Boolean, default: false }
  },
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  versionKey: false
});

adminMeseroSchema.index({ adminId: 1, meseroId: 1 }, { unique: true });

module.exports = mongoose.model('AdminMesero', adminMeseroSchema);