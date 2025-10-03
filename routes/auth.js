const express = require('express');
const router = express.Router();
const User = require('../models/user');
const jwt = require('jsonwebtoken');

// Generar JWT Token
const generarToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion',
    { expiresIn: '7d' }
  );
};

// Registro de usuario
router.post('/register', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;

    // Validar que todos los campos estén presentes
    if (!nombre || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor complete todos los campos obligatorios'
      });
    }

    // Verificar si el email ya existe
    const usuarioExistente = await User.findOne({ email });
    if (usuarioExistente) {
      return res.status(400).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }

    // Crear nuevo usuario
    const usuario = await User.create({
      nombre,
      email,
      password,
      rol: rol || 'mesero'
    });

    // Generar token
    const token = generarToken(usuario._id);

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      usuario: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error al registrar usuario',
      error: error.message
    });
  }
});

// Login de usuario
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validar campos
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor ingrese email y contraseña'
      });
    }

    // Buscar usuario e incluir password
    const usuario = await User.findOne({ email }).select('+password');
    
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Verificar si el usuario está activo
    if (!usuario.activo) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inactivo. Contacte al administrador'
      });
    }

    // Verificar password
    const passwordCorrecto = await usuario.compararPassword(password);
    
    if (!passwordCorrecto) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Actualizar último acceso
    usuario.ultimoAcceso = new Date();
    await usuario.save();

    // Generar token
    const token = generarToken(usuario._id);

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      usuario: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error al iniciar sesión',
      error: error.message
    });
  }
});

// Verificar token (middleware para otras rutas)
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuario = await User.findById(decoded.id);

    if (!usuario || !usuario.activo) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido o usuario inactivo'
      });
    }

    res.json({
      success: true,
      usuario: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
});

// Obtener perfil del usuario actual
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    const usuario = await User.findById(decoded.id);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: usuario.obtenerDatosPublicos()
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
});

module.exports = router;