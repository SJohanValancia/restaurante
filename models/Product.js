const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre del producto es obligatorio'],
    trim: true,
    maxlength: [100, 'El nombre no puede exceder 100 caracteres']
  },
  precio: {
    type: Number,
    required: [true, 'El precio es obligatorio'],
    min: [0, 'El precio no puede ser negativo']
  },
  categoria: {
    type: String,
    required: [true, 'La categoría es obligatoria'],
    enum: ['Comidas', 'Bebidas', 'Postres', 'Entradas', 'Otros'],
    default: 'Otros'
  },
  descripcion: {
    type: String,
    trim: true,
    maxlength: [500, 'La descripción no puede exceder 500 caracteres']
  },
  disponible: {
    type: Boolean,
    default: true
  },
  imagen: {
    type: String,
    default: null
  },
  stock: {
    type: Number,
    default: 0,
    min: [0, 'El stock no puede ser negativo']
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índices para mejorar las búsquedas
productSchema.index({ nombre: 1 });
productSchema.index({ categoria: 1 });
productSchema.index({ disponible: 1 });

// Método virtual para formatear el precio
productSchema.virtual('precioFormateado').get(function() {
  return `$${this.precio.toLocaleString('es-CO')}`;
});

// Configurar para incluir virtuals en JSON
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);