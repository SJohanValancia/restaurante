const express = require('express');
const router = express.Router();
const Mesa = require('../models/Mesa');
const Order = require('../models/order');

// GET /api/mesas - Obtener todas las mesas del restaurante
router.get('/', async (req, res) => {
  try {
    const mesas = await Mesa.find({
      userId: { $in: req.userIdsRestaurante },
      activa: true
    }).sort({ nombre: 1 }).lean();

    // ✅ DEDUPLICACIÓN: Si hay mesas con el mismo nombre (por IDs distintos), unificarlas
    const mesasUnicas = [];
    const nombresVistos = new Set();
    
    for (const mesa of mesas) {
      const nombreNorm = mesa.nombre.trim().toLowerCase();
      if (!nombresVistos.has(nombreNorm)) {
        mesasUnicas.push(mesa);
        nombresVistos.add(nombreNorm);
      }
    }

    res.json({
      success: true,
      data: mesasUnicas
    });
  } catch (error) {
    console.error('❌ Error al obtener mesas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las mesas',
      error: error.message
    });
  }
});

// POST /api/mesas - Crear una nueva mesa
router.post('/', async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({
        success: false,
        message: 'El nombre de la mesa es obligatorio'
      });
    }

    // Verificar si ya existe una mesa con ese nombre para este RESTAURANTE (usando mainAdminId)
    const existing = await Mesa.findOne({
      userId: req.mainAdminId,
      nombre: nombre.trim()
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe una mesa con ese nombre en el restaurante'
      });
    }

    const mesa = await Mesa.create({
      nombre: nombre.trim(),
      userId: req.mainAdminId
    });

    res.status(201).json({
      success: true,
      data: mesa,
      message: 'Mesa creada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error al crear mesa:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe una mesa con ese nombre'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear la mesa',
      error: error.message
    });
  }
});

// POST /api/mesas/bulk - Crear múltiples mesas (ej: Mesa 1 a Mesa 10)
router.post('/bulk', async (req, res) => {
  try {
    const { cantidad, prefijo = 'Mesa' } = req.body;

    if (!cantidad || cantidad < 1 || cantidad > 50) {
      return res.status(400).json({
        success: false,
        message: 'La cantidad debe ser entre 1 y 50'
      });
    }

    const mesasCreadas = [];
    const errores = [];

    for (let i = 1; i <= cantidad; i++) {
      const nombre = `${prefijo} ${i}`;
      try {
        const mesa = await Mesa.create({
          nombre,
          userId: req.mainAdminId
        });
        mesasCreadas.push(mesa);
      } catch (err) {
        if (err.code === 11000) {
          errores.push(`"${nombre}" ya existe`);
        }
      }
    }

    res.status(201).json({
      success: true,
      data: mesasCreadas,
      errores,
      message: `${mesasCreadas.length} mesas creadas${errores.length > 0 ? `, ${errores.length} ya existían` : ''}`
    });
  } catch (error) {
    console.error('❌ Error al crear mesas en bloque:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear las mesas',
      error: error.message
    });
  }
});

// DELETE /api/mesas/:id - Eliminar una mesa
router.delete('/:id', async (req, res) => {
  try {
    const mesa = await Mesa.findOneAndDelete({
      _id: req.params.id,
      userId: { $in: req.userIdsRestaurante }
    });

    if (!mesa) {
      return res.status(404).json({
        success: false,
        message: 'Mesa no encontrada'
      });
    }

    res.json({
      success: true,
      message: 'Mesa eliminada exitosamente'
    });
  } catch (error) {
    console.error('❌ Error al eliminar mesa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar la mesa',
      error: error.message
    });
  }
});

// POST /api/mesas/seed - Importar mesas de pedidos existentes
router.post('/seed', async (req, res) => {
  try {
    // Obtener todos los nombres de mesa únicos de los pedidos del restaurante
    const mesasUnicas = await Order.distinct('mesa', {
      userId: { $in: req.userIdsRestaurante },
      mesa: { $ne: null, $ne: '' }
    });

    let creadas = 0;
    let yaExistian = 0;

    for (const nombreMesa of mesasUnicas) {
      const nombre = nombreMesa.toString().trim();
      if (!nombre) continue;

      try {
        await Mesa.findOneAndUpdate(
          { userId: req.mainAdminId, nombre },
          { userId: req.mainAdminId, nombre, activa: true },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        creadas++;
      } catch (err) {
        if (err.code === 11000) {
          yaExistian++;
        }
      }
    }

    res.json({
      success: true,
      message: `${creadas} mesas importadas de pedidos existentes${yaExistian > 0 ? ` (${yaExistian} ya existían)` : ''}`,
      total: creadas
    });
  } catch (error) {
    console.error('❌ Error al importar mesas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al importar mesas',
      error: error.message
    });
  }
});

module.exports = router;
