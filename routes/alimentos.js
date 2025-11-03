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
    .populate('productos.productoId', 'nombre categoria precio')
    .sort({ nombre: 1 });

    const alimentosLimpios = alimentos.map(alimento => {
      const obj = alimento.toObject();
      obj.stock = obj.stock || 0;
      obj.valor = obj.valor || 0;
      return obj;
    });

    res.json({
      success: true,
      count: alimentosLimpios.length,
      data: alimentosLimpios
    });
  } catch (error) {
    console.error('❌ Error al obtener alimentos:', error);
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
      .populate('productos.productoId', 'nombre categoria');
    
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
router.post('/', protect, async (req, res) => {
  try {
    const { nombre, stock, valor, productos } = req.body;

    // Validar campos obligatorios
    if (!nombre || stock === undefined || valor === undefined || !productos || productos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios. Debe incluir al menos un producto.'
      });
    }

    // Validar que todos los productos existan
    for (const prod of productos) {
      const producto = await Product.findById(prod.productoId);
      if (!producto) {
        return res.status(404).json({
          success: false,
          message: `Producto no encontrado con ID: ${prod.productoId}`
        });
      }
    }

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
      productos: productos.map(p => ({
        productoId: p.productoId,
        cantidadRequerida: Number(p.cantidadRequerida)
      })),
      userId: req.user._id
    };

    const alimento = await Alimento.create(alimentoData);
    
    const alimentoCompleto = await Alimento.findById(alimento._id)
      .populate('productos.productoId', 'nombre categoria');

    res.status(201).json({
      success: true,
      message: 'Alimento creado exitosamente',
      data: alimentoCompleto
    });
  } catch (error) {
    console.error('❌ Error completo al crear alimento:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear el alimento',
      error: error.message
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
    ).populate('productos.productoId', 'nombre categoria');

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