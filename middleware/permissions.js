const AdminMesero = require('../models/AdminMesero');

exports.checkPermission = (permiso) => {
  return async (req, res, next) => {
    try {
      // Si es admin, siempre tiene todos los permisos
      if (req.user.rol === 'admin') {
        return next();
      }

      // Buscar TODAS las relaciones admin-mesero (soporta multi-local hub)
      const relaciones = await AdminMesero.find({
        meseroId: req.user._id,
        activo: true
      });

      if (!relaciones || relaciones.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permisos asignados'
        });
      }

      // Verificar si ALGUNA relación tiene el permiso específico
      const tienePermisoEnAlguna = relaciones.some(rel => rel.permisos[permiso]);

      if (!tienePermisoEnAlguna) {
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