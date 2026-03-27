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

    // --- MULTI-LOCAL HUB: Si es mesero, expandir vista con todos los admins vinculados ---
    req.isHubMesero = false;
    req.linkedAdminIds = [];

    if (['mesero', 'cajero'].includes(req.user.rol)) {
      const AdminMesero = require('../models/AdminMesero');
      const relaciones = await AdminMesero.find({
        meseroId: req.user._id,
        activo: true
      }).select('adminId');

      if (relaciones.length > 0) {
        const adminIds = relaciones.map(r => r.adminId);
        req.linkedAdminIds = adminIds;

        // Si está vinculado a admins de OTROS restaurantes, es un Hub Mesero
        const adminsExternos = await User.find({
          _id: { $in: adminIds },
          nombreRestaurante: { $ne: req.user.nombreRestaurante }
        }).select('_id');

        if (adminsExternos.length > 0) {
          req.isHubMesero = true;
          // Agregar TODOS los adminIds a userIdsRestaurante para ver sus productos/pedidos
          const allAdminIds = adminIds.map(id => id.toString());
          const existingIds = req.userIdsRestaurante.map(id => id.toString());
          
          for (const adminId of allAdminIds) {
            if (!existingIds.includes(adminId)) {
              req.userIdsRestaurante.push(adminId);
            }
          }
        }
      }
    }

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