const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const User = require('../models/User');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');
const { notifyOrderStatusChange } = require('../services/pushNotification'); // ✅ Push notifications
const { notifyMandaoStatusChange } = require('../services/mandaoIntegration'); // ✅ Integración Mandao

// ✅ FUNCIÓN PARA DESCONTAR STOCK DE ALIMENTOS
async function descontarStockAlimentos(items, userId, ignorarStock = false) {
  const Alimento = require('../models/Alimento');

  try {
    const productoIds = [...new Set(items.map(item => item.producto))];
    
    const alimentos = await Alimento.find({
      'productos.productoId': { $in: productoIds },
      userId: userId
    }).lean();

    const operaciones = [];

    for (const item of items) {
      const productoId = item.producto;
      const cantidadPedida = item.cantidad;

      for (const alimento of alimentos) {
        const productoConfig = alimento.productos.find(
          p => p.productoId && p.productoId.toString() === productoId.toString()
        );

        if (productoConfig) {
          const cantidadADescontar = productoConfig.cantidadRequerida * cantidadPedida;

          if (ignorarStock) {
            if (alimento.stock > 0) {
              const descontado = Math.min(alimento.stock, cantidadADescontar);
              operaciones.push({
                updateOne: {
                  filter: { _id: alimento._id },
                  update: { $inc: { stock: -descontado } }
                }
              });
            }
          } else {
            if (alimento.stock < cantidadADescontar) {
              throw new Error(
                `Stock insuficiente de "${alimento.nombre}". ` +
                `Disponible: ${alimento.stock}, Requerido: ${cantidadADescontar}`
              );
            }
            operaciones.push({
              updateOne: {
                filter: { _id: alimento._id },
                update: { $inc: { stock: -cantidadADescontar } }
              }
            });
          }
        }
      }
    }

    if (operaciones.length > 0) {
      await Alimento.bulkWrite(operaciones);
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error al descontar stock:', error);
    throw error;
  }
}

// ✅ FUNCIÓN PARA NORMALIZAR TEXTO (QUITAR TILDES)
function normalizeText(text) {
  if (!text) return '';
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// ⭐ RUTA PÚBLICA - Sin protect
router.get('/mesa/:numeroMesa', async (req, res) => {
  try {
    const { numeroMesa } = req.params;
    const { restaurante, sede } = req.query;

    console.log('🔍 Solicitud recibida - Mesa:', numeroMesa, 'Restaurante:', restaurante, 'Sede:', sede);

    if (!restaurante) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del restaurante es obligatorio'
      });
    }

    // Buscar usuario del restaurante
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

    console.log('✅ Usuario encontrado:', usuario._id);

    const mesaNorm = normalizeText(numeroMesa);

    // Buscar pedido activo primero (estados activos)
    const orderQuery = {
      mesaNormalizada: mesaNorm,
      userId: usuario._id,
      estado: { $in: ['pendiente', 'preparando', 'listo'] }
    };

    console.log('🔍 Buscando con query:', JSON.stringify(orderQuery));

    let order = await Order.findOne(orderQuery)
      .populate('items.producto', 'nombre categoria precio')
      .populate('userId', 'nombre')
      .sort({ createdAt: -1 })
      .limit(1);

    console.log('🔍 Pedido activo encontrado:', order ? 'Sí' : 'No');

    // Si no hay pedido activo, buscar el último pedido (cualquier estado)
    if (!order) {
      console.log('🔍 Buscando último pedido de la mesa...');
      order = await Order.findOne({
        mesaNormalizada: mesaNorm,
        userId: usuario._id
      })
        .populate('items.producto', 'nombre categoria precio')
        .populate('userId', 'nombre')
        .sort({ createdAt: -1 })
        .limit(1);

      console.log('🔍 Último pedido encontrado:', order ? 'Sí' : 'No');
    }

    if (!order) {
      console.log('❌ No se encontró ningún pedido para mesa:', numeroMesa);
      return res.status(404).json({
        success: false,
        message: 'No se encontraron pedidos para esta mesa'
      });
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
            categoria: item.categoriaProducto || 'Sin categoría',
            precio: item.precio
          }
        };
      }
    });

    console.log('✅ Pedido encontrado y enviado');

    res.json({
      success: true,
      data: orderObj
    });
  } catch (error) {
    console.error('❌ Error en /mesa:', error);
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
    const { estado, mesa, fecha, page = 1, limit = 50 } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const skip = (pageNum - 1) * limitNum;

    let query = { userId: { $in: req.userIdsRestaurante } };

    if (estado) query.estado = estado;
    if (mesa) {
      const mesaNorm = normalizeText(mesa);
      query.mesaNormalizada = { $regex: mesaNorm, $options: 'i' };
    }

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

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('items.producto', 'nombre categoria precio')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(query)
    ]);

    const ordersNormalizados = orders.map(order => {
      const orderObj = { ...order };
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
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
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

    const matchStage = {
      userId: { $in: req.userIdsRestaurante.map(id => mongoose.Types.ObjectId(id)) },
      createdAt: { $gte: hoy }
    };

    const [stats, totalPedidos] = await Promise.all([
      Order.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$estado',
            count: { $sum: 1 },
            total: { $sum: '$total' }
          }
        }
      ]),
      Order.countDocuments(matchStage)
    ]);

    const ventasHoy = stats
      .filter(s => s._id !== 'cancelado')
      .reduce((sum, s) => sum + s.total, 0);

    res.json({
      success: true,
      data: {
        pedidosHoy: totalPedidos,
        ventasHoy,
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

// ⭐ NUEVA RUTA: Productos más vendidos del restaurante
router.get('/stats/productos-mas-vendidos', protect, async (req, res) => {
  try {
    const { limit = 3 } = req.query;
    const limitNum = parseInt(limit) || 3;

    if (!req.userIdsRestaurante || req.userIdsRestaurante.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No se encontraron usuarios para el restaurante'
      });
    }

    const objectIds = req.userIdsRestaurante.map(id => {
      try {
        return mongoose.Types.ObjectId(id);
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null);

    if (objectIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'IDs de usuario inválidos'
      });
    }

    const productosMasVendidos = await Order.aggregate([
      { $match: { userId: { $in: objectIds }, estado: { $ne: 'cancelado' } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.producto', cantidadTotal: { $sum: '$items.cantidad' }, ingresosTotales: { $sum: { $multiply: ['$items.cantidad', '$items.precio'] } } } },
      { $sort: { cantidadTotal: -1 } },
      { $limit: limitNum }
    ]);

    const productosConInfo = await Promise.all(productosMasVendidos.map(async (prod) => {
      let nombre = 'Producto eliminado';
      let categoria = 'Sin categoría';
      
      if (prod._id) {
        try {
          const producto = await require('../models/Product').findById(prod._id).lean();
          if (producto) {
            nombre = producto.nombre;
            categoria = producto.categoria;
          }
        } catch (e) {
          console.log('Producto no encontrado:', prod._id);
        }
      }

      return {
        productoId: prod._id,
        nombre,
        categoria,
        cantidadTotal: prod.cantidadTotal,
        ingresosTotales: prod.ingresosTotales
      };
    }));

    res.json({
      success: true,
      data: productosConInfo
    });
  } catch (error) {
    console.error('❌ Error en productos-mas-vendidos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener productos más vendidos',
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
    const { mesa, items, notas, ignorarStockAlimentos } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    // ✅ VALIDAR Y DESCONTAR STOCK ANTES DE CREAR EL PEDIDO
    try {
      await descontarStockAlimentos(items, req.user._id, ignorarStockAlimentos);
    } catch (error) {
      // Solo retornar error si NO se debe ignorar el stock
      if (!ignorarStockAlimentos) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
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

// RUTA PÚBLICA PARA CREAR PEDIDOS DESDE EL CLIENTE
router.post('/public', async (req, res) => {
  try {
    const { mesa, items, notas, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'ID de usuario es requerido'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El pedido debe tener al menos un producto'
      });
    }

    // Obtener información completa de los productos
    const Product = require('../models/Product');
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
        precio: producto.precio
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
      userId: userId,
      estado: 'pendiente',
      origenPedido: 'cliente' // Marca para identificar pedidos hechos por el cliente
    };

    const order = await Order.create(orderData);
    await order.populate('items.producto', 'nombre categoria precio');

    res.status(201).json({
      success: true,
      message: 'Pedido creado exitosamente',
      data: order
    });
  } catch (error) {
    console.error('Error al crear pedido público:', error);
    res.status(400).json({
      success: false,
      message: 'Error al crear el pedido',
      error: error.message
    });
  }
});

router.patch('/:id/estado', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { estado, metodoPago, actualizarTodosLosProductos } = req.body;

    const estadosValidos = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido'
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    // ✅ SI SE SOLICITA ACTUALIZAR TODOS LOS PRODUCTOS
    if (actualizarTodosLosProductos) {
      order.items.forEach(item => {
        item.estadosIndividuales = [{
          cantidad: item.cantidad,
          estado: estado
        }];
      });
    }

    // Actualizar el estado general del pedido
    order.estado = estado;

    // Si es entregado y hay método de pago, guardarlo
    if (estado === 'entregado') {
      if (metodoPago) order.metodoPago = metodoPago;
      if (req.body.clienteNombre) order.clienteNombre = req.body.clienteNombre;
      if (req.body.clienteCcNit) order.clienteCcNit = req.body.clienteCcNit;
    }

    await order.save();
    await order.populate('items.producto', 'nombre categoria precio');

    console.log('✅ Estado actualizado:', order._id, '→', estado);
    if (actualizarTodosLosProductos) {
      console.log('✅ Todos los productos actualizados a:', estado);
    }

    // ✅ ENVIAR PUSH NOTIFICATION AL CLIENTE
    try {
      const user = await User.findById(order.userId);
      if (user && user.nombreRestaurante) {
        await notifyOrderStatusChange(order.mesa, user.nombreRestaurante, estado);
      }
    } catch (pushError) {
      console.error('⚠️ Error enviando push notification:', pushError);
      // No fallar la request por error de push
    }

    // ✅ NOTIFICAR A MANDAO SI ES UN PEDIDO EXTERNO
    if (order.source === 'mandao' && order.mandaoOrderId) {
      notifyMandaoStatusChange(order.mandaoOrderId, estado).catch(console.error);
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
      // No cambiar automáticamente, solo notificar
      await order.save();

      // ✅ ENVIAR PUSH NOTIFICATION
      try {
        const user = await User.findById(order.userId);
        if (user && user.nombreRestaurante) {
          await notifyOrderStatusChange(order.mesa, user.nombreRestaurante, nuevoEstado);
        }
      } catch (pushError) {
        console.error('⚠️ Error enviando push:', pushError);
      }

      return res.json({
        success: true,
        message: 'Estado del producto actualizado',
        data: order,
        todosEntregados: true
      });
    }

    await order.save();

    // ✅ ENVIAR PUSH NOTIFICATION
    try {
      const user = await User.findById(order.userId);
      if (user && user.nombreRestaurante) {
        await notifyOrderStatusChange(order.mesa, user.nombreRestaurante, nuevoEstado);
      }
    } catch (pushError) {
      console.error('⚠️ Error enviando push:', pushError);
    }

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

    // ✅ CALCULAR DIFERENCIA DE PRODUCTOS PARA DESCONTAR STOCK
    if (items && items.length > 0) {
      // Crear un mapa de productos originales con sus cantidades
      const productosOriginales = new Map();
      order.items.forEach(item => {
        const prodId = item.producto.toString();
        productosOriginales.set(prodId, item.cantidad);
      });

      // Crear un mapa de productos nuevos con sus cantidades
      const productosNuevos = new Map();
      items.forEach(item => {
        const prodId = item.producto.toString();
        productosNuevos.set(prodId, item.cantidad);
      });

      // Calcular diferencias (solo productos agregados o aumentados)
      const productosParaDescontar = [];

      productosNuevos.forEach((cantidadNueva, prodId) => {
        const cantidadOriginal = productosOriginales.get(prodId) || 0;
        const diferencia = cantidadNueva - cantidadOriginal;

        // Si la diferencia es positiva, significa que se agregaron más unidades
        if (diferencia > 0) {
          productosParaDescontar.push({
            producto: prodId,
            cantidad: diferencia
          });
        }
      });

      // ✅ DESCONTAR STOCK SOLO DE LOS PRODUCTOS NUEVOS O AUMENTADOS
      if (productosParaDescontar.length > 0) {
        try {
          await descontarStockAlimentos(productosParaDescontar, req.user._id);
          console.log('✅ Stock descontado por edición de pedido:', productosParaDescontar);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: error.message
          });
        }
      }
    }

    // Actualizar campos básicos
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
        // ✅ INICIALIZAR ESTADOS INDIVIDUALES CORRECTAMENTE
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
            categoria: item.categoriaProducto || 'Sin categoría',
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