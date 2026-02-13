const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware para proteger rutas
exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No autorizado - Token no proporcionado'
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secreto-super-seguro-cambiar-en-produccion'
    );

    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    if (!req.user.activo) {
      return res.status(401).json({
        success: false,
        message: 'Usuario inactivo'
      });
    }

    // AGREGAR DATOS DEL RESTAURANTE AL REQUEST
    req.nombreRestaurante = req.user.nombreRestaurante;
    req.sede = req.user.sede;

    // BUSCAR TODOS LOS USUARIOS DEL MISMO RESTAURANTE
    const query = { nombreRestaurante: req.nombreRestaurante };
    if (req.sede) {
      query.sede = req.sede;
    }

    const usuariosRestaurante = await User.find(query).select('_id');
    req.userIdsRestaurante = usuariosRestaurante.map(u => u._id);

    next();
  } catch (error) {
    console.error('❌ Error de verificación JWT:', error.message);
    if (error.name === 'TokenExpiredError') {
      console.error('⏰ El token ha expirado. Fecha de expiración:', error.expiredAt);
    } else if (error.name === 'JsonWebTokenError') {
      console.error('🚫 Token malformado o secreto inválido.');
    }

    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `El rol ${req.user.rol} no tiene permiso para acceder a esta ruta`
      });
    }
    next();
  };
};