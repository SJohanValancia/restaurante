const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware para verificar el token
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No se proporcionó token de autenticación'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Usuario no encontrado'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Token inválido o expirado'
        });
    }
};

// Endpoint para obtener datos del usuario autenticado
router.get('/me', verifyToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                _id: req.user._id,
                id: req.user._id,
                nombre: req.user.nombre,
                email: req.user.email
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al obtener datos del usuario'
        });
    }
});


// Obtener todos los productos
// Obtener todos los productos (filtrar por userId)
router.get('/', async (req, res) => {
  try {
    const { categoria, disponible, search, userId } = req.query;
    let query = { userId }; // Filtrar por usuario

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
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
  try {
    const product = await Product.create(req.body);
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
router.put('/:id', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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
router.patch('/:id/disponibilidad', async (req, res) => {
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