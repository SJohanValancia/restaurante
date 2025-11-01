const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const User = require('../models/User');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

// â­ RUTA PÃšBLICA - Sin protect
router.get('/mesa/:numeroMesa', async (req, res) => {
  try {
    const { numeroMesa } = req.params;
    const { restaurante, sede } = req.query;

    console.log('ðŸ“ Solicitud recibida - Mesa:', numeroMesa, 'Restaurante:', restaurante, 'Sede:', sede);

    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del restaurante es obligatorio'
      });
    }

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

    const orderQuery = {
      mesa: (numeroMesa),
      userId: usuario._id,
      estado: { $in: ['pendiente', 'preparando', 'listo'] }
    };

    let order = await Order.findOne(orderQuery)
      .populate('items.producto', 'nombre categoria precio')
      .populate('userId', 'nombre')
      .sort({ createdAt: -1 })
      .limit(1);

    if (!order) {
      order = await Order.findOne({ 
        mesa: (numeroMesa),
        userId: usuario._id
      })
        .populate('items.producto', 'nombre categoria precio')
        .populate('userId', 'nombre')
        .sort({ createdAt: -1 })
        .limit(1);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'No se encontraron pedidos para esta mesa'
        });
      }
    }

    // Normalizar datos
    const orderObj = order.toObject();
    orderObj.items = orderObj.items.map(item => {
      if (item.producto) {
        return {
          ...item,
          productoInfo: {
            nombre: item.producto.nombre,
            categoria: item.producto.categoria,
            precio: item.producto.precio
          }
        };
      } else {
        return {
          ...item,
          productoInfo: {
            nombre: item.nombreProducto || 'Producto eliminado',
            categoria: item.categoriaProducto || 'Sin categorÃ­a',
            precio: item.precio
          }
        };
      }
    });

    console.log('âœ… Pedido encontrado y enviado');

    res.json({
      success: true,
      data: orderObj
    });
  } catch (error) {
    console.error('âŒ Error en /mesa:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener el pedido',
      error: error.message
    });
  }
});

// â­ RUTAS PROTEGIDAS - Con protect
router.get('/', protect, checkPermission('verPedidos'), async (req, res) => {
  try {
    const { estado, mesa, fecha } = req.query;
    
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (estado) query.estado = estado;
    if (mesa) query.mesa = (mesa);
    
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
            productoInfo: {
              nombre: item.producto.nombre,
              categoria: item.producto.categoria,
              precio: item.producto.precio
            }
          };
        } else {
          return {
            ...item,
            productoInfo: {
              nombre: item.nombreProducto || 'Producto eliminado',
              categoria: item.categoriaProducto || 'Sin categorÃ­a',
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
      message: 'Error al obtener estadÃ­sticas',
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
          productoInfo: {
            nombre: item.producto.nombre,
            categoria: item.producto.categoria,
            precio: item.producto.precio
          }
        };
      } else {
        return {
          ...item,
          productoInfo: {
            nombre: item.nombreProducto || 'Producto eliminado',
            categoria: item.categoriaProducto || 'Sin categorÃ­a',
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
    const { mesa, items, notas } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    const itemsConInfo = await Promise.all(items.map(async (item) => {
      const producto = await Product.findById(item.producto);
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
      mesa,
      items: itemsConInfo,
      total,
      notas,
      userId: req.user._id,
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
        message: 'Estado no vÃ¡lido'
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

    console.log('âœ… Estado actualizado:', order._id, 'â†’', estado);

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

// âœ… NUEVA RUTA: Actualizar estado individual de un producto
router.patch('/:id/item/:itemIndex/estado', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { itemIndex } = req.params;
    const { cantidadCambiar, nuevoEstado } = req.body;
    
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    const item = order.items[itemIndex];
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado'
      });
    }

    // Buscar si ya existe un grupo con el estado actual
    const grupoExistente = item.estadosIndividuales.find(e => e.estado === nuevoEstado);
    
    if (grupoExistente) {
      // Agregar al grupo existente
      grupoExistente.cantidad += cantidadCambiar;
    } else {
      // Crear nuevo grupo
      item.estadosIndividuales.push({
        cantidad: cantidadCambiar,
        estado: nuevoEstado
      });
    }

    // Reducir del grupo "pendiente" u otro estado actual
    const grupoActual = item.estadosIndividuales.find(e => e.estado !== nuevoEstado);
    if (grupoActual) {
      grupoActual.cantidad -= cantidadCambiar;
      
      // Eliminar si llega a 0
      if (grupoActual.cantidad <= 0) {
        item.estadosIndividuales = item.estadosIndividuales.filter(e => e.cantidad > 0);
      }
    }

    // Verificar si todos los items estÃ¡n entregados
    const todosEntregados = order.items.every(item => 
      item.estadosIndividuales.every(grupo => grupo.estado === 'entregado')
    );

    if (todosEntregados && order.estado !== 'entregado') {
      // No cambiar automÃ¡ticamente, solo notificar
      await order.save();
      return res.json({
        success: true,
        message: 'Estado del producto actualizado',
        data: order,
        todosEntregados: true
      });
    }

    await order.save();
    
    res.json({
      success: true,
      message: 'Estado del producto actualizado',
      data: order
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar el estado del producto',
      error: error.message
    });
  }
});

router.put('/:id', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { mesa, items, notas } = req.body;
    
    // Obtener el pedido actual
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    // Actualizar campos bÃ¡sicos
    order.mesa = mesa;
    order.notas = notas;
    
    // Si hay items, actualizarlos con estadosIndividuales inicializados
    if (items && items.length > 0) {
      order.items = items.map(item => ({
        producto: item.producto,
        nombreProducto: item.nombreProducto,
        categoriaProducto: item.categoriaProducto,
        cantidad: item.cantidad,
        precio: item.precio,
        // âœ… INICIALIZAR ESTADOS INDIVIDUALES CORRECTAMENTE
        estadosIndividuales: [{
          cantidad: item.cantidad,
          estado: 'pendiente'
        }]
      }));
      
      // Recalcular total
      order.total = items.reduce((sum, item) => {
        return sum + (item.precio * item.cantidad);
      }, 0);
    }

    // Guardar con el middleware pre-save
    await order.save();
    
    // Populate para la respuesta
    await order.populate('items.producto', 'nombre categoria precio');
    
    // Normalizar la respuesta
    const orderObj = order.toObject();
    orderObj.items = orderObj.items.map(item => {
      if (item.producto) {
        return {
          ...item,
          productoInfo: {
            nombre: item.producto.nombre,
            categoria: item.producto.categoria,
            precio: item.producto.precio
          }
        };
      } else {
        return {
          ...item,
          productoInfo: {
            nombre: item.nombreProducto || 'Producto eliminado',
            categoria: item.categoriaProducto || 'Sin categorÃ­a',
            precio: item.precio
          }
        };
      }
    });

    res.json({
      success: true,
      message: 'Pedido actualizado exitosamente',
      data: orderObj
    });
  } catch (error) {
    console.error('Error al actualizar pedido:', error);
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

module.exports = router;