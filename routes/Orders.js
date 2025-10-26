const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const User = require('../models/User');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

// Rutas protegidas
router.get('/', protect, checkPermission('verPedidos'), async (req, res) => {
  try {
    const { estado, mesa, fecha } = req.query;
    
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (estado) query.estado = estado;
    if (mesa) query.numeroMesa = parseInt(mesa);
    
    if (fecha === 'hoy') {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: hoy };
    } else if (fecha === 'semana') {
      const semana = new Date();
      semana.setDate(semana.getDate() - 7);
      query.createdAt = { $gte: semana };
    } else if (fecha === 'mes') {
      const mes = new Date();
      mes.setMonth(mes.getMonth() - 1);
      query.createdAt = { $gte: mes };
    }

    const orders = await Order.find(query)
      .populate('items.producto', 'nombre categoria precio')
      .sort({ createdAt: -1 });

    const ordersNormalizados = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.items = orderObj.items.map(item => {
        if (item.producto) {
          return {
            ...item,
            producto: {
              _id: item.producto._id,
              nombre: item.producto.nombre,
              categoria: item.producto.categoria,
              precio: item.producto.precio
            }
          };
        } else {
          return {
            ...item,
            producto: {
              nombre: item.nombreProducto || 'Producto eliminado',
              categoria: item.categoriaProducto || 'Sin categoría',
              precio: item.precio
            }
          };
        }
      });
      return orderObj;
    });

    res.json({
      success: true,
      count: ordersNormalizados.length,
      data: ordersNormalizados
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener los pedidos',
      error: error.message
    });
  }
});

// RUTA PÚBLICA para seguimiento de pedidos (sin autenticación)
router.get('/mesa/:numeroMesa', async (req, res) => {
  try {
    const { numeroMesa } = req.params;
    const { restaurante, sede } = req.query;

    console.log('🔍 Buscando pedido para:', { numeroMesa, restaurante, sede });

    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del restaurante es obligatorio'
      });
    }

    // Buscar el usuario del restaurante
    const query = { nombreRestaurante: restaurante };
    if (sede) {
      query.sede = sede;
    }

    const usuario = await User.findOne(query);

    if (!usuario) {
      console.log('❌ Restaurante no encontrado:', restaurante);
      return res.status(404).json({
        success: false,
        message: 'Restaurante no encontrado'
      });
    }

    console.log('✅ Restaurante encontrado:', usuario.nombreRestaurante);

    // Buscar pedido activo primero
    const orderQuery = {
      numeroMesa: parseInt(numeroMesa),
      userId: usuario._id,
      estado: { $in: ['pendiente', 'preparando', 'listo'] }
    };

    console.log('🔍 Query de búsqueda:', orderQuery);

    let order = await Order.findOne(orderQuery)
      .populate('items.producto', 'nombre categoria precio')
      .sort({ createdAt: -1 });

    // Si no hay pedido activo, buscar el más reciente
    if (!order) {
      console.log('⚠️ No hay pedidos activos, buscando el más reciente...');
      order = await Order.findOne({ 
        numeroMesa: parseInt(numeroMesa),
        userId: usuario._id
      })
        .populate('items.producto', 'nombre categoria precio')
        .sort({ createdAt: -1 });

      if (!order) {
        console.log('❌ No se encontraron pedidos para la mesa', numeroMesa);
        return res.status(404).json({
          success: false,
          message: 'No se encontraron pedidos para esta mesa'
        });
      }
    }

    console.log('✅ Pedido encontrado:', order._id, 'Estado:', order.estado);

    // Normalizar datos para manejar productos eliminados
    const orderObj = order.toObject();
    orderObj.items = orderObj.items.map(item => {
      if (item.producto) {
        return {
          cantidad: item.cantidad,
          precio: item.precio,
          producto: {
            _id: item.producto._id,
            nombre: item.producto.nombre,
            categoria: item.producto.categoria,
            precio: item.producto.precio
          },
          _id: item._id
        };
      } else {
        return {
          cantidad: item.cantidad,
          precio: item.precio,
          producto: {
            nombre: item.nombreProducto || 'Producto eliminado',
            categoria: item.categoriaProducto || 'Sin categoría',
            precio: item.precio
          },
          _id: item._id
        };
      }
    });

    // Agregar información del restaurante al response
    orderObj.nombreRestaurante = usuario.nombreRestaurante;
    if (usuario.sede) {
      orderObj.sede = usuario.sede;
    }

    res.json({
      success: true,
      data: orderObj
    });
  } catch (error) {
    console.error('❌ Error al obtener el pedido:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el pedido',
      error: error.message
    });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.producto', 'nombre categoria precio')
      .populate('userId', 'nombre email');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    const orderObj = order.toObject();
    orderObj.items = orderObj.items.map(item => {
      if (item.producto) {
        return {
          ...item,
          producto: {
            _id: item.producto._id,
            nombre: item.producto.nombre,
            categoria: item.producto.categoria,
            precio: item.producto.precio
          }
        };
      } else {
        return {
          ...item,
          producto: {
            nombre: item.nombreProducto || 'Producto eliminado',
            categoria: item.categoriaProducto || 'Sin categoría',
            precio: item.precio
          }
        };
      }
    });

    res.json({
      success: true,
      data: orderObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el pedido',
      error: error.message
    });
  }
});

router.post('/', protect, checkPermission('crearPedidos'), async (req, res) => {
  try {
    const { numeroMesa, items, notas } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    // Obtener información completa de los productos
    const itemsConInfo = await Promise.all(items.map(async (item) => {
      const producto = await Product.findById(item.producto);
      if (!producto) {
        throw new Error(`Producto ${item.producto} no encontrado`);
      }
      return {
        producto: item.producto,
        nombreProducto: producto.nombre,
        categoriaProducto: producto.categoria,
        cantidad: item.cantidad,
        precio: item.precio
      };
    }));

    const total = itemsConInfo.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);

    const orderData = {
      numeroMesa,
      items: itemsConInfo,
      total,
      notas,
      userId: req.user._id,
      nombreRestaurante: req.user.nombreRestaurante,
      sede: req.user.sede || null,
      estado: 'pendiente'
    };

    const order = await Order.create(orderData);
    await order.populate('items.producto', 'nombre categoria precio');

    res.status(201).json({
      success: true,
      message: 'Pedido creado exitosamente',
      data: order
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al crear el pedido',
      error: error.message
    });
  }
});

router.patch('/:id/estado', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { estado, metodoPago } = req.body;
    
    const estadosValidos = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }

    const updateData = { estado };
    
    if (estado === 'entregado' && metodoPago) {
      updateData.metodoPago = metodoPago;
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('items.producto', 'nombre categoria precio');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    console.log('✅ Estado actualizado:', order._id, '→', estado);

    res.json({
      success: true,
      message: `Pedido actualizado a estado: ${estado}`,
      data: order
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el estado',
      error: error.message
    });
  }
});

router.put('/:id', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { items, notas } = req.body;

    let updateData = { notas };
    
    if (items && items.length > 0) {
      const total = items.reduce((sum, item) => {
        return sum + (item.precio * item.cantidad);
      }, 0);
      updateData.items = items;
      updateData.total = total;
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('items.producto', 'nombre categoria precio');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Pedido actualizado exitosamente',
      data: order
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el pedido',
      error: error.message
    });
  }
});

router.delete('/:id', protect, checkPermission('cancelarPedidos'), async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Pedido eliminado exitosamente',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el pedido',
      error: error.message
    });
  }
});

router.get('/stats/resumen', protect, async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const stats = await Order.aggregate([
      { 
        $match: { 
          userId: { $in: req.userIdsRestaurante.map(id => mongoose.Types.ObjectId(id)) },
          createdAt: { $gte: hoy } 
        } 
      },
      {
        $group: {
          _id: '$estado',
          count: { $sum: 1 },
          total: { $sum: '$total' }
        }
      }
    ]);

    const totalPedidos = await Order.countDocuments({ 
      userId: { $in: req.userIdsRestaurante }, 
      createdAt: { $gte: hoy } 
    });
    
    const totalVentas = await Order.aggregate([
      { 
        $match: { 
          userId: { $in: req.userIdsRestaurante.map(id => mongoose.Types.ObjectId(id)) },
          createdAt: { $gte: hoy }, 
          estado: { $ne: 'cancelado' } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    res.json({
      success: true,
      data: {
        pedidosHoy: totalPedidos,
        ventasHoy: totalVentas[0]?.total || 0,
        porEstado: stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas',
      error: error.message
    });
  }
});

module.exports = router;