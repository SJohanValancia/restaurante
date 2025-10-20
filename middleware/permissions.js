const AdminMesero = require('../models/AdminMesero');

exports.checkPermission = (permiso) => {
  return async (req, res, next) => {
    try {
      // Si es admin, siempre tiene todos los permisos
      if (req.user.rol === 'admin') {
        return next();
      }

      // Buscar la relación admin-mesero
      const relacion = await AdminMesero.findOne({
        meseroId: req.user._id,
        activo: true
      });

      if (!relacion) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permisos asignados'
        });
      }

      // Verificar si tiene el permiso específico
      if (!relacion.permisos[permiso]) {
        return res.status(403).json({
          success: false,
          message: `No tienes permiso para: ${permiso}`
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error al verificar permisos',
        error: error.message
      });
    }
  };
};