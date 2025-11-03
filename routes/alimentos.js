const express = require('express');
const router = express.Router();
const Alimento = require('../models/Alimento');
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');

// Obtener todos los alimentos del restaurante
router.get('/', protect, async (req, res) => {
  try {
    const alimentos = await Alimento.find({ 
      userId: { $in: req.userIdsRestaurante } 
    })
    .populate('productoId', 'nombre categoria')
    .sort({ nombre: 1 });

    res.json({
      success: true,
      count: alimentos.length,
      data: alimentos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener los alimentos',
      error: error.message
    });
  }
});

// Obtener un alimento por ID
router.get('/:id', protect, async (req, res) => {
  try {
    const alimento = await Alimento.findById(req.params.id)
      .populate('productoId', 'nombre categoria');
    
    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    res.json({
      success: true,
      data: alimento
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el alimento',
      error: error.message
    });
  }
});

// Crear un nuevo alimento
// Crear un nuevo alimento
router.post('/', protect, async (req, res) => {
  try {
    const { nombre, stock, valor, productoId, cantidadRequerida } = req.body;

    // Log para debug
    console.log('📥 Datos recibidos:', req.body);
    console.log('👤 Usuario actual:', req.user);

    // Validar campos obligatorios
    if (!nombre || stock === undefined || valor === undefined || !productoId || !cantidadRequerida) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios',
        recibido: { nombre, stock, valor, productoId, cantidadRequerida }
      });
    }

    // Validar que el producto existe
    const producto = await Product.findById(productoId);
    if (!producto) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado con ID: ' + productoId
      });
    }

    console.log('✅ Producto encontrado:', producto.nombre);

    // Validar que req.user._id existe
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado correctamente'
      });
    }

    const alimentoData = {
      nombre: nombre.trim(),
      stock: Number(stock),
      valor: Number(valor),
      productoId: productoId,
      cantidadRequerida: Number(cantidadRequerida),
      userId: req.user._id
    };

    console.log('💾 Guardando alimento con datos:', alimentoData);

    const alimento = await Alimento.create(alimentoData);
    
    console.log('✅ Alimento creado con ID:', alimento._id);

    const alimentoCompleto = await Alimento.findById(alimento._id)
      .populate('productoId', 'nombre categoria');

    res.status(201).json({
      success: true,
      message: 'Alimento creado exitosamente',
      data: alimentoCompleto
    });
  } catch (error) {
    console.error('❌ Error completo al crear alimento:', error);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Error al crear el alimento',
      error: error.message,
      tipo: error.name
    });
  }
});

// Actualizar un alimento
router.put('/:id', protect, async (req, res) => {
  try {
    const alimento = await Alimento.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('productoId', 'nombre categoria');

    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Alimento actualizado exitosamente',
      data: alimento
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el alimento',
      error: error.message
    });
  }
});

// Eliminar un alimento
router.delete('/:id', protect, async (req, res) => {
  try {
    const alimento = await Alimento.findByIdAndDelete(req.params.id);

    if (!alimento) {
      return res.status(404).json({
        success: false,
        message: 'Alimento no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Alimento eliminado exitosamente',
      data: alimento
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el alimento',
      error: error.message
    });
  }
});

module.exports = router;