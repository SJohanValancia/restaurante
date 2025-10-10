
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AdminMesero = require('../models/AdminMesero');
const mongoose = require('mongoose');

// Buscar y agregar mesero
router.post('/agregar', async (req, res) => {
  try {
    const { adminId, meseroId } = req.body;

    if (!adminId || !meseroId) {
      return res.status(400).json({
        success: false,
        message: 'adminId y meseroId son requeridos'
      });
    }

    // Validar que el meseroId sea un ObjectId válido
    if (!mongoose.Types.ObjectId.isValid(meseroId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de mesero inválido'
      });
    }

    // Verificar que el admin existe
    const admin = await User.findById(adminId);
    if (!admin || admin.rol !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'No tiene permisos de administrador'
      });
    }

    // Verificar que el mesero existe
    const mesero = await User.findById(meseroId);
    if (!mesero) {
      return res.status(404).json({
        success: false,
        message: 'Mesero no encontrado'
      });
    }

    // No permitir que se agregue a sí mismo
    if (adminId === meseroId) {
      return res.status(400).json({
        success: false,
        message: 'No puedes agregarte a ti mismo'
      });
    }

    // Verificar si ya existe la relación
    let relacion = await AdminMesero.findOne({ adminId, meseroId });

    if (relacion) {
      // Si existe pero está inactiva, reactivarla
      if (!relacion.activo) {
        relacion.activo = true;
        await relacion.save();
        return res.json({
          success: true,
          message: 'Mesero reactivado exitosamente',
          data: relacion
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Este mesero ya está agregado'
      });
    }

    // Crear nueva relación
    relacion = await AdminMesero.create({
      adminId,
      meseroId
    });

    res.status(201).json({
      success: true,
      message: 'Mesero agregado exitosamente',
      data: relacion
    });

  } catch (error) {
    console.error('Error al agregar mesero:', error);
    res.status(500).json({
      success: false,
      message: 'Error al agregar mesero',
      error: error.message
    });
  }
});

// Obtener meseros de un admin
router.get('/meseros/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;

    const relaciones = await AdminMesero.find({ 
      adminId,
      activo: true 
    }).populate('meseroId', 'nombre email rol nombreRestaurante sede createdAt');

    const meseros = relaciones.map(rel => ({
      relacionId: rel._id,
      mesero: rel.meseroId,
      permisos: rel.permisos,
      agregadoEl: rel.createdAt
    }));

    res.json({
      success: true,
      count: meseros.length,
      data: meseros
    });

  } catch (error) {
    console.error('Error al obtener meseros:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener meseros',
      error: error.message
    });
  }
});

// Buscar usuario por ID
router.get('/buscar/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'ID inválido'
      });
    }

    const usuario = await User.findById(userId).select('-password');

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: usuario
    });

  } catch (error) {
    console.error('Error al buscar usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar usuario',
      error: error.message
    });
  }
});

// Actualizar permisos
router.put('/permisos/:relacionId', async (req, res) => {
  try {
    const { relacionId } = req.params;
    const { permisos } = req.body;

    const relacion = await AdminMesero.findById(relacionId);

    if (!relacion) {
      return res.status(404).json({
        success: false,
        message: 'Relación no encontrada'
      });
    }

    relacion.permisos = { ...relacion.permisos, ...permisos };
    await relacion.save();

    res.json({
      success: true,
      message: 'Permisos actualizados exitosamente',
      data: relacion
    });

  } catch (error) {
    console.error('Error al actualizar permisos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar permisos',
      error: error.message
    });
  }
});

// Eliminar mesero (desactivar)
router.delete('/:relacionId', async (req, res) => {
  try {
    const { relacionId } = req.params;

    const relacion = await AdminMesero.findById(relacionId);

    if (!relacion) {
      return res.status(404).json({
        success: false,
        message: 'Relación no encontrada'
      });
    }

    relacion.activo = false;
    await relacion.save();

    res.json({
      success: true,
      message: 'Mesero eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error al eliminar mesero:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar mesero',
      error: error.message
    });
  }
});

module.exports = router;