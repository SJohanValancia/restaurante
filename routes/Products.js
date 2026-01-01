const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

// ✅ RUTA PÚBLICA PRIMERO - Obtener productos por nombre de restaurante (para clientes)
router.get('/public/restaurante', async (req, res) => {
  try {
    const { restaurante, sede } = req.query;
    
    console.log('📥 Endpoint público llamado:', { restaurante, sede });
    
    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'Nombre del restaurante es requerido'
      });
    }

    // Buscar usuario del restaurante
    const User = require('../models/User');
    const query = { nombreRestaurante: restaurante };
    if (sede) query.sede = sede;

    console.log('🔍 Query de búsqueda:', query);

    const usuario = await User.findOne(query);

    if (!usuario) {
      console.log('❌ Restaurante no encontrado');
      return res.status(404).json({
        success: false,
        message: 'Restaurante no encontrado'
      });
    }

    console.log('✅ Usuario encontrado:', usuario._id, usuario.nombreRestaurante);

    // Obtener productos disponibles
    const products = await Product.find({ 
      userId: usuario._id,
      disponible: true 
    }).sort({ nombre: 1 });
    
    console.log('✅ Productos encontrados:', products.length);
    
    res.json({
      success: true,
      count: products.length,
      data: products,
      userId: usuario._id
    });
  } catch (error) {
    console.error('❌ Error al obtener productos públicos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener productos',
      error: error.message
    });
  }
});

// ⭐ RUTAS PROTEGIDAS

// Obtener todos los productos del restaurante
router.get('/', protect, checkPermission('verProductos'), async (req, res) => {
  try {
    const { categoria, disponible, search } = req.query;
    
    // Filtrar por todos los usuarios del mismo restaurante
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (categoria) query.categoria = categoria;
    if (disponible !== undefined) query.disponible = disponible === 'true';
    if (search) {
      query.nombre = { $regex: search, $options: 'i' };
    }

    const products = await Product.find(query).sort({ nombre: 1 });
    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener los productos',
      error: error.message
    });
  }
});

// Obtener un producto por ID
router.get('/:id', protect, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }
    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el producto',
      error: error.message
    });
  }
});

// Crear un nuevo producto
router.post('/', protect, checkPermission('crearProductos'), async (req, res) => {
  try {
    // Asignar el userId del usuario actual
    const productData = {
      ...req.body,
      userId: req.user._id
    };
    
    const product = await Product.create(productData);
    res.status(201).json({
      success: true,
      message: 'Producto creado exitosamente',
      data: product
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al crear el producto',
      error: error.message
    });
  }
});

// Actualizar un producto
router.put('/:id', protect, checkPermission('editarProductos'), async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Producto actualizado exitosamente',
      data: product
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el producto',
      error: error.message
    });
  }
});

// Eliminar un producto
router.delete('/:id', protect, checkPermission('eliminarProductos'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Producto eliminado exitosamente',
      data: product
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el producto',
      error: error.message
    });
  }
});

// Actualizar disponibilidad de un producto
router.patch('/:id/disponibilidad', protect, checkPermission('editarProductos'), async (req, res) => {
  try {
    const { disponible } = req.body;
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { disponible },
      { new: true }
    );
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    res.json({
      success: true,
      message: `Producto ${disponible ? 'activado' : 'desactivado'} exitosamente`,
      data: product
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar disponibilidad',
      error: error.message
    });
  }
});

module.exports = router;