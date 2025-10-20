const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const User = require('../models/User');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');


router.get('/', protect, checkPermission('verPedidos'), async (req, res) => {
  try {
    const { estado, mesa, fecha } = req.query;
    
    // Filtrar por todos los usuarios del mismo restaurante
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (estado) query.estado = estado;
    if (mesa) query.mesa = parseInt(mesa);
    
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

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener los pedidos',
      error: error.message
    });
  }
});

// Obtener el pedido más reciente de una mesa específica (para seguimiento público)
router.get('/mesa/:numeroMesa', async (req, res) => {
  try {
    const { numeroMesa } = req.params;
    const { restaurante, sede } = req.query;

    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del restaurante es obligatorio'
      });
    }

    // Buscar el usuario que corresponde a este restaurante y sede
    const query = { nombreRestaurante: restaurante };
    if (sede) {
      query.sede = sede;
    }

    const usuario = await User.findOne(query);

    if (!usuario) {
      return res.status(404).json({
        success: false,
        message: 'Restaurante no encontrado'
      });
    }

    // Buscar el pedido más reciente de esta mesa para este usuario/restaurante
    const orderQuery = {
      mesa: parseInt(numeroMesa),
      userId: usuario._id,
      estado: { $in: ['pendiente', 'preparando', 'listo'] }
    };

    const order = await Order.findOne(orderQuery)
      .populate('items.producto', 'nombre categoria precio')
      .populate('userId', 'nombre')
      .sort({ createdAt: -1 })
      .limit(1);

    // Si no hay pedidos activos, buscar el último entregado
    if (!order) {
      const lastOrder = await Order.findOne({ 
        mesa: parseInt(numeroMesa),
        userId: usuario._id
      })
        .populate('items.producto', 'nombre categoria precio')
        .populate('userId', 'nombre')
        .sort({ createdAt: -1 })
        .limit(1);

      if (!lastOrder) {
        return res.status(404).json({
          success: false,
          message: 'No se encontraron pedidos para esta mesa'
        });
      }

      return res.json({
        success: true,
        data: lastOrder
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el pedido',
      error: error.message
    });
  }
});


// Obtener un pedido por ID
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

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el pedido',
      error: error.message
    });
  }
});

// Crear un nuevo pedido
router.post('/', protect, checkPermission('crearPedidos'), async (req, res) => {
  try {
    const { mesa, items, notas } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    const total = items.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);

    const orderData = {
      mesa,
      items,
      total,
      notas,
      userId: req.user._id, // Usar el usuario actual
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


// Actualizar el estado de un pedido
router.patch('/:id/estado', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { estado } = req.body;
    
    const estadosValidos = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { estado },
      { new: true }
    ).populate('items.producto', 'nombre categoria precio');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    console.log('✅ Estado actualizado:', order._id, '→', estado); // Debug

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

// Actualizar un pedido completo
router.put('/:id', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { items, notas } = req.body;

    // Si se actualizan los items, recalcular el total
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

// Eliminar un pedido
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

    // Filtrar por todos los usuarios del restaurante
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
