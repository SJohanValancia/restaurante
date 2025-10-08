const express = require('express');
const router = express.Router();
const Order = require('../models/order');

// Obtener todos los pedidos (con filtros)
router.get('/', async (req, res) => {
  try {
    const { estado, mesa, userId, fecha } = req.query;
    let query = { userId };

    if (estado) query.estado = estado;
    if (mesa) query.mesa = parseInt(mesa);
    
    // Filtrar por fecha (hoy, última semana, último mes)
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

// Obtener un pedido por ID
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
  try {
    const { mesa, items, notas, userId } = req.body;

    // Validar que hay items
    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    // Calcular el total
    const total = items.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);

    const orderData = {
      mesa,
      items,
      total,
      notas,
      userId,
      estado: 'pendiente'
    };

    const order = await Order.create(orderData);
    
    // Poblar los datos del producto
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
router.patch('/:id/estado', async (req, res) => {
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
router.put('/:id', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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

// Obtener estadísticas de pedidos
router.get('/stats/resumen', async (req, res) => {
  try {
    const { userId } = req.query;
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const stats = await Order.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId), createdAt: { $gte: hoy } } },
      {
        $group: {
          _id: '$estado',
          count: { $sum: 1 },
          total: { $sum: '$total' }
        }
      }
    ]);

    const totalPedidos = await Order.countDocuments({ userId, createdAt: { $gte: hoy } });
    const totalVentas = await Order.aggregate([
      { $match: { userId: mongoose.Types.ObjectId(userId), createdAt: { $gte: hoy }, estado: { $ne: 'cancelado' } } },
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

// Agregar esta ruta ANTES de la ruta '/:id' en Orders.js

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

    // Buscar el pedido más reciente para esta mesa
    // Nota: Esto busca entre TODOS los usuarios, por lo que necesitamos
    // una forma de filtrar por restaurante. Puedes agregar un campo
    // "restaurante" y "sede" al modelo Order, o usar el nombre del usuario.
    
    // Por ahora, buscaremos el pedido más reciente de cualquier usuario
    // que coincida con el número de mesa y esté activo (no entregado/cancelado)
    const query = {
      mesa: parseInt(numeroMesa),
      estado: { $in: ['pendiente', 'preparando', 'listo'] }
    };

    const order = await Order.findOne(query)
      .populate('items.producto', 'nombre categoria precio')
      .populate('userId', 'nombre')
      .sort({ createdAt: -1 })
      .limit(1);

    // Si no hay pedidos activos, buscar el último entregado
    if (!order) {
      const lastOrder = await Order.findOne({ mesa: parseInt(numeroMesa) })
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

module.exports = router;