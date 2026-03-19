const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const userSchema = new mongoose.Schema({
  nombre: String,
  email: String,
  password: String,
  nombreRestaurante: String,
  rol: String,
  activo: Boolean,
  bloqueado: Boolean
});

const User = mongoose.model('User', userSchema);

async function resetPassword(email, nuevaPassword) {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    const usuario = await User.findOne({ email: email.toLowerCase() });
    
    if (!usuario) {
      console.log('❌ Usuario no encontrado:', email);
      process.exit(1);
    }

    console.log('👤 Usuario encontrado:', usuario.nombre);
    console.log('   Rol:', usuario.rol);
    console.log('   Restaurant:', usuario.nombreRestaurante);
    console.log('   Bloqueado:', usuario.bloqueado);

    usuario.password = nuevaPassword;
    usuario.bloqueado = false;
    usuario.motivoBloqueo = '';
    await usuario.save();

    console.log('✅ Contraseña reseteada exitosamente');
    console.log('   Email:', email);
    console.log('   Nueva password:', nuevaPassword);

    await mongoose.disconnect();
    console.log('🔌 Desconectado');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Uso: node reset-password.js <email> <nueva_password>');
  console.log('Ejemplo: node reset-password.js cajero3 cajero1');
  process.exit(1);
}

resetPassword(email, password);
