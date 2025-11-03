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
      // ✅ ASEGURAR que stock y valor siempre existan
      obj.stock = typeof obj.stock === 'number' ? obj.stock : 0;
      obj.valor = typeof obj.valor === 'number' ? obj.valor : 0;
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

    // ✅ ASEGURAR que stock y valor existan
    const alimentoObj = alimento.toObject();
    alimentoObj.stock = typeof alimentoObj.stock === 'number' ? alimentoObj.stock : 0;
    alimentoObj.valor = typeof alimentoObj.valor === 'number' ? alimentoObj.valor : 0;

    res.json({
      success: true,
      data: alimentoObj
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

    // ✅ VALIDAR que stock y valor sean números válidos
    const stockNumero = Number(stock);
    const valorNumero = Number(valor);

    if (isNaN(stockNumero) || isNaN(valorNumero)) {
      return res.status(400).json({
        success: false,
        message: 'Stock y valor deben ser números válidos'
      });
    }

    // Validar campos obligatorios
    if (!nombre || !productos || productos.length === 0) {
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
      stock: stockNumero,  // ✅ Usar el número validado
      valor: valorNumero,   // ✅ Usar el número validado
      productos: productos.map(p => ({
        productoId: p.productoId,
        cantidadRequerida: Number(p.cantidadRequerida)
      })),
      userId: req.user._id
    };

    console.log('✅ Datos a guardar:', alimentoData);

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
    const { nombre, stock, valor, productos } = req.body;

    // ✅ VALIDAR números si vienen en el body
    const updateData = {
      nombre: nombre ? nombre.trim() : undefined,
      stock: stock !== undefined ? Number(stock) : undefined,
      valor: valor !== undefined ? Number(valor) : undefined,
      productos: productos ? productos.map(p => ({
        productoId: p.productoId,
        cantidadRequerida: Number(p.cantidadRequerida)
      })) : undefined
    };

    // Remover undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const alimento = await Alimento.findByIdAndUpdate(
      req.params.id,
      updateData,
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
    console.error('❌ Error al actualizar:', error);
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