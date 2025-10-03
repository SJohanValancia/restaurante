const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
    trim: true,
    minlength: [2, 'El nombre debe tener al menos 2 caracteres'],
    maxlength: [50, 'El nombre no puede exceder 50 caracteres']
  },
  email: {
    type: String,
    required: [true, 'El usuario/email es obligatorio'],
    unique: true,
    lowercase: true,
    trim: true,
    // CAMBIO: Removida la validación de formato de email
    minlength: [3, 'El usuario debe tener al menos 3 caracteres']
  },
  password: {
    type: String,
    required: [true, 'La contraseña es obligatoria'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
    select: false // No incluir password por defecto en las consultas
  },
  rol: {
    type: String,
    enum: ['admin', 'mesero', 'cajero'],
    default: 'mesero'
  },
  activo: {
    type: Boolean,
    default: true
  },
  ultimoAcceso: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false
});

// Índices
userSchema.index({ email: 1 });
userSchema.index({ activo: 1 });

// Encriptar password antes de guardar
userSchema.pre('save', async function(next) {
  // Solo encriptar si el password fue modificado
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar passwords
userSchema.methods.compararPassword = async function(passwordIngresado) {
  return await bcrypt.compare(passwordIngresado, this.password);
};

// Método para obtener datos públicos del usuario
userSchema.methods.obtenerDatosPublicos = function() {
  return {
    id: this._id,
    nombre: this.nombre,
    email: this.email,
    rol: this.rol,
    activo: this.activo,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);