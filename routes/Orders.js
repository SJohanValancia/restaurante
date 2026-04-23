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
const Mesa = require('../models/Mesa'); // ✅ Auto-crear mesas

// ✅ FUNCIÓN PARA DESCONTAR STOCK DE ALIMENTOS
async function descontarStockAlimentos(items, userId, ignorarStock = false) {
  const Alimento = require('../models/Alimento');

  try {
    // ✅ FIX: Convertir IDs a ObjectId para que el aggregation pipeline funcione
    const productoIds = [...new Set(items.map(item => {
      try {
        return new mongoose.Types.ObjectId(item.producto.toString());
      } catch (e) {
        return item.producto;
      }
    }))];

    const userObjectId = new mongoose.Types.ObjectId(userId.toString());

    console.log('🔍 Descontando stock - ProductoIds:', productoIds.length, 'UserId:', userObjectId);

    // ✅ OPTIMIZACIÓN: Usar aggregation pipeline para evitar doble bucle
    const alimentos = await Alimento.aggregate([
      {
        $match: {
          'productos.productoId': { $in: productoIds },
          userId: userObjectId
        }
      },
      { $unwind: '$productos' },
      { $match: { 'productos.productoId': { $in: productoIds } } }
    ]);

    console.log('🔍 Alimentos encontrados para descontar:', alimentos.length);

    // Crear mapa de alimentos por productoId
    const alimentosMap = new Map();
    alimentos.forEach(alimento => {
      const productoId = alimento.productos.productoId.toString();
      if (!alimentosMap.has(productoId)) {
        alimentosMap.set(productoId, []);
      }
      alimentosMap.get(productoId).push({
        _id: alimento._id,
        stock: alimento.stock,
        nombre: alimento.nombre,
        cantidadRequerida: alimento.productos.cantidadRequerida
      });
    });

    const operaciones = [];

    for (const item of items) {
      const productoId = item.producto.toString();
      const cantidadPedida = item.cantidad;

      // ✅ Obtener IDs de alimentos excluidos para este item
      const excluidos = new Set(
        (item.alimentosExcluidos || []).map(e => (e.alimentoId || e).toString())
      );

      // ✅ Obtener ajustes de alimentos para este item
      const ajustesMap = new Map();
      (item.alimentosAjustados || []).forEach(a => {
        const id = (a.alimentoId || a._id || a).toString();
        ajustesMap.set(id, Number(a.cantidadAjuste) || 0);
      });

      if (alimentosMap.has(productoId)) {
        const alimentosDelProducto = alimentosMap.get(productoId);

        for (const alimentoData of alimentosDelProducto) {
          const alimentoIdStr = alimentoData._id.toString();

          // ✅ Si el alimento está excluido, no descontar
          if (excluidos.has(alimentoIdStr)) {
            console.log(`⏭️ Alimento "${alimentoData.nombre}" excluido del descuento para este item`);
            continue;
          }

          // ✅ Calcular deducción: (base * cantidad) + ajuste
          const ajuste = ajustesMap.get(alimentoIdStr) || 0;
          let cantidadADescontar = (alimentoData.cantidadRequerida * cantidadPedida) + ajuste;

          // No permitir deducciones negativas
          if (cantidadADescontar < 0) cantidadADescontar = 0;

          if (ajuste !== 0) {
            console.log(`⚖️ Ajuste de ${ajuste} aplicado a "${alimentoData.nombre}". Deducción total: ${cantidadADescontar}`);
          }

          if (ignorarStock) {
            if (alimentoData.stock > 0) {
              const descontado = Math.min(alimentoData.stock, cantidadADescontar);
              operaciones.push({
                updateOne: {
                  filter: { _id: alimentoData._id },
                  update: { $inc: { stock: -descontado } }
                }
              });
              console.log(`📦 Descontando ${descontado} de "${alimentoData.nombre}" (ignorar stock)`);
            }
          } else {
            if (alimentoData.stock < cantidadADescontar) {
              throw new Error(
                `Stock insuficiente de "${alimentoData.nombre}". ` +
                `Disponible: ${alimentoData.stock}, Requerido: ${cantidadADescontar}`
              );
            }
            operaciones.push({
              updateOne: {
                filter: { _id: alimentoData._id },
                update: { $inc: { stock: -cantidadADescontar } }
              }
            });
            console.log(`📦 Descontando ${cantidadADescontar} de "${alimentoData.nombre}"`);
          }
        }
      }
    }

    if (operaciones.length > 0) {
      const result = await Alimento.bulkWrite(operaciones);
      console.log('✅ Stock descontado exitosamente:', result.modifiedCount, 'alimentos actualizados');
    } else {
      console.log('⚠️ No se encontraron alimentos vinculados a los productos del pedido');
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error al descontar stock:', error);
    throw error;
  }
}

// ✅ FUNCIÓN PARA DEVOLVER STOCK DE ALIMENTOS (al cancelar/eliminar pedido)
async function revertirStockAlimentos(items, userId) {
  const Alimento = require('../models/Alimento');

  try {
    const productoIds = [...new Set(items.map(item => {
      try {
        return new mongoose.Types.ObjectId(item.producto.toString());
      } catch (e) {
        return item.producto;
      }
    }))];

    const userObjectId = new mongoose.Types.ObjectId(userId.toString());

    console.log('🔄 Revirtiendo stock - ProductoIds:', productoIds.length, 'UserId:', userObjectId);

    const alimentos = await Alimento.aggregate([
      {
        $match: {
          'productos.productoId': { $in: productoIds },
          userId: userObjectId
        }
      },
      { $unwind: '$productos' },
      { $match: { 'productos.productoId': { $in: productoIds } } }
    ]);

    console.log('🔄 Alimentos encontrados para revertir:', alimentos.length);

    const alimentosMap = new Map();
    alimentos.forEach(alimento => {
      const productoId = alimento.productos.productoId.toString();
      if (!alimentosMap.has(productoId)) {
        alimentosMap.set(productoId, {
          _id: alimento._id,
          nombre: alimento.nombre,
          productos: [alimento.productos]
        });
      } else {
        alimentosMap.get(productoId).productos.push(alimento.productos);
      }
    });

    const operaciones = [];

    for (const item of items) {
      const productoId = item.producto.toString();
      const cantidadPedida = item.cantidad;

      if (alimentosMap.has(productoId)) {
        const alimentoData = alimentosMap.get(productoId);
        let cantidadADevolver = 0;

        alimentoData.productos.forEach(config => {
          cantidadADevolver += config.cantidadRequerida * cantidadPedida;
        });

        operaciones.push({
          updateOne: {
            filter: { _id: alimentoData._id },
            update: { $inc: { stock: cantidadADevolver } }
          }
        });
        console.log(`📦 Devolviendo ${cantidadADevolver} a "${alimentoData.nombre}"`);
      }
    }

    if (operaciones.length > 0) {
      const result = await Alimento.bulkWrite(operaciones);
      console.log('✅ Stock revertido exitosamente:', result.modifiedCount, 'alimentos actualizados');
    } else {
      console.log('⚠️ No se encontraron alimentos para revertir');
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error al revertir stock:', error);
    // No lanzar error para no bloquear la cancelación
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

    // Buscar usuarios del restaurante (incluye meseros hub con ese nombreRestaurante)
    const query = { nombreRestaurante: restaurante };
    if (sede) {
      query.sede = sede;
    }

    const usuarios = await User.find(query).select('_id');

    if (!usuarios || usuarios.length === 0) {
      console.log('❌ Restaurante no encontrado:', restaurante);
      return res.status(404).json({
        success: false,
        message: 'Restaurante no encontrado'
      });
    }

    const userIds = usuarios.map(u => u._id);

    console.log('✅ Usuarios encontrados:', userIds.length);

    const mesaNorm = normalizeText(numeroMesa);

    // Buscar pedido activo primero (estados activos)
    // Incluye órdenes de los locales Y las del mesero hub (via meseroHubId)
    const orderQuery = {
      mesaNormalizada: mesaNorm,
      $or: [
        { userId: { $in: userIds } },
        { meseroHubId: { $in: userIds } }
      ],
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
        $or: [
          { userId: { $in: userIds } },
          { meseroHubId: { $in: userIds } }
        ]
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

    let finalOrderObj = null;

    // ✅ MULTI-LOCAL HUB: Unificar todas las órdenes del mismo grupo si pertenece a un Hub
    if (order.hubOrderGroup) {
      console.log('🔗 Hub Order de Seguimiento detectado (Grupo ID):', order.hubOrderGroup);
      const groupOrders = await Order.find({ hubOrderGroup: order.hubOrderGroup })
        .populate('items.producto', 'nombre categoria precio')
        .populate('userId', 'nombre');

      if (groupOrders.length > 0) {
        // Crear orden unificada
        const merged = groupOrders[0].toObject();
        merged.items = groupOrders.flatMap(o => o.toObject().items);
        merged.total = groupOrders.reduce((sum, o) => sum + o.total, 0);
        merged._subOrderIds = groupOrders.map(o => o._id);
        merged._isUnified = true;
        merged._subOrderCount = groupOrders.length;

        // Estado: el más bajo del grupo
        const estadoPrioridad = { pendiente: 0, preparando: 1, listo: 2, entregado: 3, cancelado: 4 };
        merged.estado = groupOrders.reduce((minEstado, o) => {
          return (estadoPrioridad[o.estado] || 0) < (estadoPrioridad[minEstado] || 0) ? o.estado : minEstado;
        }, groupOrders[0].estado);

        // Mantener métodos de pago
        merged.metodoPago = groupOrders.find(o => o.metodoPago)?.metodoPago || null;

        finalOrderObj = merged;
      } else {
        finalOrderObj = order.toObject();
      }
    } else {
      finalOrderObj = order.toObject();
    }

    // Normalizar datos
    finalOrderObj.items = finalOrderObj.items.map(item => {
      if (item.producto) {
        // En Mongoose toObject() preserva la población
        return {
          ...item,
          productoInfo: {
            nombre: item.producto.nombre || item.nombreProducto,
            categoria: item.producto.categoria || item.categoriaProducto,
            precio: item.producto.precio || item.precio
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

    console.log('✅ Pedido unificado/encontrado y enviado, items formados:', finalOrderObj.items.length);

    res.json({
      success: true,
      data: finalOrderObj
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
    const { estado, mesa, fecha, page = 1, limit = 30, search } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 30, 100); // Límite máximo de 100
    const skip = (pageNum - 1) * limitNum;

    let query = { userId: { $in: req.userIdsRestaurante } };

    if (estado) query.estado = estado;
    if (mesa) {
      const mesaNorm = normalizeText(mesa);
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { mesaNormalizada: { $regex: mesaNorm, $options: 'i' } },
          { mesa: { $regex: mesa, $options: 'i' } }
        ]
      });
    }

    if (search) {
      query.$or = [
        { notas: { $regex: search, $options: 'i' } },
        { mesa: { $regex: search, $options: 'i' } }
      ];
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

    // ✅ OPTIMIZACIÓN: Usar proyección en lugar de populate
    let ordersQuery = Order.find(query, {
      items: 1,
      total: 1,
      estado: 1,
      mesa: 1,
      createdAt: 1,
      userId: 1,
      notas: 1,
      source: 1,
      metodoPago: 1,
      pagos: 1,
      totalPagado: 1,
      mandaoOrderId: 1,
      clienteNombre: 1,
      clienteCcNit: 1,
      hubOrderGroup: 1,
      meseroHubId: 1
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const [orders, total] = await Promise.all([
      ordersQuery,
      Order.countDocuments(query)
    ]);

    // ✅ BÚSQUEDA: Si hay búsqueda por producto, filtrar después de obtener pedidos
    let filteredOrders = orders;
    let searchTotal = total;
    if (search) {
      // Obtener todos los productos que coincidan con la búsqueda
      const matchingProducts = await Product.find({
        nombre: { $regex: search, $options: 'i' },
        userId: { $in: req.userIdsRestaurante }
      }).select('_id').lean();
      const matchingProductIds = new Set(matchingProducts.map(p => p._id.toString()));

      // Filtrar pedidos que contengan productos coincidentes o notas coincidentes
      filteredOrders = orders.filter(order => {
        // Buscar en notas
        if (order.notas && order.notas.toLowerCase().includes(search.toLowerCase())) return true;
        // Buscar en mesa
        if (order.mesa && order.mesa.toString().toLowerCase().includes(search.toLowerCase())) return true;
        // Buscar en productos
        return order.items.some(item => item.producto && matchingProductIds.has(item.producto.toString()));
      });

      // Contar total de pedidos que coinciden con la búsqueda (sin paginación)
      const countQuery = { ...query };
      delete countQuery.$or;
      const allOrdersForCount = await Order.find(countQuery, { notas: 1, items: 1, mesa: 1 }).lean();
      searchTotal = allOrdersForCount.filter(order => {
        if (order.notas && order.notas.toLowerCase().includes(search.toLowerCase())) return true;
        if (order.mesa && order.mesa.toString().toLowerCase().includes(search.toLowerCase())) return true;
        return order.items.some(item => item.producto && matchingProductIds.has(item.producto.toString()));
      }).length;
    }

    // ✅ OPTIMIZACIÓN: Procesar items en lote
    const productIds = new Set();
    filteredOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.producto) productIds.add(item.producto);
      });
    });

    const productsMap = new Map();
    if (productIds.size > 0) {
      const products = await Product.find({
        _id: { $in: Array.from(productIds) }
      }, 'nombre categoria precio');
      products.forEach(p => productsMap.set(p._id.toString(), p));
    }

    let ordersNormalizados = filteredOrders.map(order => {
      const orderObj = { ...order };
      orderObj.items = orderObj.items.map(item => {
        if (item.producto) {
          const product = productsMap.get(item.producto.toString());
          return {
            ...item,
            productoInfo: {
              nombre: product ? product.nombre : 'Producto eliminado',
              categoria: product ? product.categoria : 'Sin categoría',
              precio: product ? product.precio : item.precio
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

    // ✅ MULTI-LOCAL HUB: Agrupar pedidos por hubOrderGroup para hub mesero
    if (req.isHubMesero) {
      const groupMap = new Map();
      const ungrouped = [];

      ordersNormalizados.forEach(order => {
        if (order.hubOrderGroup && order.meseroHubId && order.meseroHubId.toString() === req.user._id.toString()) {
          if (!groupMap.has(order.hubOrderGroup)) {
            groupMap.set(order.hubOrderGroup, []);
          }
          groupMap.get(order.hubOrderGroup).push(order);
        } else {
          ungrouped.push(order);
        }
      });

      const mergedOrders = [];
      const estadoPrioridad = { pendiente: 0, preparando: 1, listo: 2, entregado: 3, cancelado: 4 };

      groupMap.forEach((group, groupId) => {
        if (group.length <= 1) {
          // Si solo hay 1 orden en el grupo, no unificar
          mergedOrders.push(...group);
          return;
        }

        // Crear orden unificada
        const merged = { ...group[0] };
        merged.items = group.flatMap(o => o.items);
        merged.total = group.reduce((sum, o) => sum + o.total, 0);
        merged._subOrderIds = group.map(o => o._id);
        merged._isUnified = true;
        merged._subOrderCount = group.length;
        // Estado: el más bajo del grupo (si uno está pendiente, el grupo es pendiente)
        merged.estado = group.reduce((minEstado, o) => {
          return (estadoPrioridad[o.estado] || 0) < (estadoPrioridad[minEstado] || 0) ? o.estado : minEstado;
        }, group[0].estado);
        // Método de pago: usar el que tenga alguno
        merged.metodoPago = group.find(o => o.metodoPago)?.metodoPago || null;
        mergedOrders.push(merged);
      });

      ordersNormalizados = [...mergedOrders, ...ungrouped];
      // Re-ordenar por fecha descendente
      ordersNormalizados.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    res.json({
      success: true,
      count: ordersNormalizados.length,
      total: search ? searchTotal : total,
      page: pageNum,
      pages: Math.ceil((search ? searchTotal : total) / limitNum),
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
      userId: { $in: req.userIdsRestaurante.map(id => new mongoose.Types.ObjectId(id)) },
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

    console.log('🔍 userIdsRestaurante:', req.userIdsRestaurante);
    console.log('🔍 user:', req.user);

    if (!req.userIdsRestaurante || req.userIdsRestaurante.length === 0) {
      console.log('❌ userIdsRestaurante vacío');
      return res.status(400).json({
        success: false,
        message: 'No se encontraron usuarios para el restaurante'
      });
    }

    const objectIds = req.userIdsRestaurante.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
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
      // Ignorar órdenes canceladas siempre
      { $match: { estado: { $ne: 'cancelado' } } },
      { $unwind: '$items' },
      // Traer la información del producto asociado para poder validar su dueño
      {
        $lookup: {
          from: 'products',
          localField: 'items.producto',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      // Filtrar items sin producto equivalente en la DB
      { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: false } },
      // ⭐ CLAVE: El verdadero filtro para que CADA LOCAL VEA SOLO LO SUYO
      // Revisamos que el ID del DUEÑO del producto esté dentro de mis objectIds permitidos
      { $match: { 'productInfo.userId': { $in: objectIds } } },
      // Agrupar y procesar resultado final
      {
        $group: {
          _id: '$items.producto',
          nombre: { $first: '$productInfo.nombre' },
          categoria: { $first: '$productInfo.categoria' },
          cantidadTotal: { $sum: '$items.cantidad' },
          ingresosTotales: { $sum: { $multiply: ['$items.cantidad', '$items.precio'] } }
        }
      },
      { $sort: { cantidadTotal: -1 } },
      { $limit: limitNum }
    ]);

    // Opcional: Estandarizar el esquema de la respuesta con productoId
    const dataResponse = productosMasVendidos.map(prod => ({
      productoId: prod._id,
      nombre: prod.nombre,
      categoria: prod.categoria,
      cantidadTotal: prod.cantidadTotal,
      ingresosTotales: prod.ingresosTotales
    }));

    res.json({
      success: true,
      data: dataResponse
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

    // ✅ Obtener info completa de cada product (incluyendo userId = dueño)
    const itemsConInfo = await Promise.all(items.map(async (item) => {
      const producto = await Product.findById(item.producto);
      if (!producto) throw new Error(`Producto no encontrado: ${item.producto}`);
      return {
        producto: item.producto,
        nombreProducto: producto.nombre,
        categoriaProducto: producto.categoria,
        cantidad: item.cantidad,
        precio: item.precio,
        ownerUserId: producto.userId, // Dueño del producto (local)
        alimentosExcluidos: item.alimentosExcluidos || [], // ✅ Alimentos excluidos del descuento
        alimentosAjustados: item.alimentosAjustados || [], // ✅ Ajustes personalizados (más/menos)
        nota: item.nota || '' // ✅ Nota por plato
      };
    }));

    // ✅ VALIDAR Y DESCONTAR STOCK (siempre usar ownerUserId del producto)
    // Los alimentos pertenecen al admin (dueño del producto), no al mesero
    const itemsPorOwner = {};
    for (const item of itemsConInfo) {
      const ownerId = item.ownerUserId.toString();
      if (!itemsPorOwner[ownerId]) itemsPorOwner[ownerId] = [];
      itemsPorOwner[ownerId].push(item);
    }
    for (const [ownerId, ownerItems] of Object.entries(itemsPorOwner)) {
      try {
        await descontarStockAlimentos(ownerItems, ownerId, ignorarStockAlimentos);
      } catch (error) {
        if (!ignorarStockAlimentos) {
          return res.status(400).json({ success: false, message: error.message });
        }
      }
    }

    // --- MULTI-LOCAL HUB: Decidir si dividir o crear normalmente ---
    if (req.isHubMesero) {
      // AGRUPAR ITEMS POR DUEÑO (ownerUserId)
      const itemsPorLocal = {};
      for (const item of itemsConInfo) {
        const ownerId = item.ownerUserId.toString();
        if (!itemsPorLocal[ownerId]) {
          itemsPorLocal[ownerId] = [];
        }
        itemsPorLocal[ownerId].push(item);
      }

      const ownerIds = Object.keys(itemsPorLocal);
      const hubGroupId = new mongoose.Types.ObjectId().toString(); // ID de grupo compartido
      const ordersCreadas = [];

      for (const ownerId of ownerIds) {
        const localItems = itemsPorLocal[ownerId];
        const localTotal = localItems.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);

        const orderData = {
          mesa,
          items: localItems,
          total: localTotal,
          notas,
          userId: ownerId, // El dueño del local recibe la orden
          meseroHubId: req.user._id, // Quién la creó (el mesero hub)
          hubOrderGroup: hubGroupId,
          mesero: req.user.nombre || 'Mesero',
          estado: 'pendiente'
        };

        const order = await Order.create(orderData);
        ordersCreadas.push(order);

        // Notificar al local (push notification)
        try {
          await notifyOrderStatusChange(order, 'creado');
        } catch (e) {
          console.error('Error notificando local:', e.message);
        }
      }

      // Responder con todas las órdenes creadas

      // ✅ AUTO-CREAR MESA si no existe (para hub mesero)
      if (mesa && mesa.trim()) {
        try {
          await Mesa.findOneAndUpdate(
            { userId: req.user._id, nombre: mesa.trim() },
            { userId: req.user._id, nombre: mesa.trim(), activa: true },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (e) { /* Ignorar errores */ }
      }

      res.status(201).json({
        success: true,
        message: `Pedido dividido en ${ordersCreadas.length} órdenes para cada local`,
        hubGroupId,
        data: ordersCreadas
      });

    } else {
      // FLUJO NORMAL (no es hub mesero)
      const total = itemsConInfo.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);

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

      // ✅ AUTO-CREAR MESA si no existe
      if (mesa && mesa.trim()) {
        try {
          await Mesa.findOneAndUpdate(
            { userId: req.user._id, nombre: mesa.trim() },
            { userId: req.user._id, nombre: mesa.trim(), activa: true },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (e) { /* Ignorar errores de mesa duplicada */ }
      }

      res.status(201).json({
        success: true,
        message: 'Pedido creado exitosamente',
        data: order
      });
    }
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
        precio: producto.precio,
        alimentosExcluidos: item.alimentosExcluidos || [],
        alimentosAjustados: item.alimentosAjustados || [],
        nota: item.nota || ''
      };
    }));

    const total = itemsConInfo.reduce((sum, item) => {
      return sum + (item.precio * item.cantidad);
    }, 0);

    // ✅ DESCONTAR STOCK DE ALIMENTOS (pedidos de clientes también)
    try {
      await descontarStockAlimentos(items, userId, true); // ignorarStock=true para no bloquear al cliente
    } catch (error) {
      console.error('⚠️ Error descontando stock en pedido público:', error.message);
    }

    const orderData = {
      mesa,
      items: itemsConInfo,
      total,
      notas,
      userId: userId,
      estado: 'pendiente',
      origenPedido: 'cliente'
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

    // ✅ MULTI-LOCAL HUB: Si es hub mesero y la orden tiene grupo, propagar a todas
    let ordersToUpdate = [order];
    if (req.isHubMesero && order.hubOrderGroup) {
      const groupOrders = await Order.find({
        hubOrderGroup: order.hubOrderGroup,
        _id: { $ne: order._id }
      });
      ordersToUpdate = [order, ...groupOrders];
      console.log(`🔗 Hub mesero: Propagando estado '${estado}' a ${ordersToUpdate.length} órdenes del grupo ${order.hubOrderGroup}`);
    }

    for (const currentOrder of ordersToUpdate) {
      // ✅ SI SE CANCELA: Devolver stock de alimentos
      if (estado === 'cancelado' && currentOrder.estado !== 'cancelado') {
        try {
          await revertirStockAlimentos(currentOrder.items, currentOrder.userId);
          console.log('✅ Stock revertido por cancelación del pedido:', currentOrder._id);
        } catch (revertError) {
          console.error('⚠️ Error revirtiendo stock:', revertError.message);
        }
      }

      // ✅ SI SE SOLICITA ACTUALIZAR TODOS LOS PRODUCTOS
      if (actualizarTodosLosProductos) {
        currentOrder.items.forEach(item => {
          item.estadosIndividuales = [{
            cantidad: item.cantidad,
            estado: estado
          }];
        });
      }

      // Actualizar el estado general del pedido
      currentOrder.estado = estado;

      // Si es entregado y hay método de pago, guardarlo
      if (estado === 'entregado') {
        if (metodoPago) currentOrder.metodoPago = metodoPago;
        if (req.body.clienteNombre) currentOrder.clienteNombre = req.body.clienteNombre;
        if (req.body.clienteCcNit) currentOrder.clienteCcNit = req.body.clienteCcNit;
      }

      await currentOrder.save();

      // ✅ ENVIAR PUSH NOTIFICATION AL LOCAL
      try {
        const user = await User.findById(currentOrder.userId);
        if (user && user.nombreRestaurante) {
          await notifyOrderStatusChange(currentOrder.mesa, user.nombreRestaurante, estado);
        }
      } catch (pushError) {
        console.error('⚠️ Error enviando push notification:', pushError);
      }

      // ✅ NOTIFICAR A MANDAO SI ES UN PEDIDO EXTERNO
      if (currentOrder.source === 'mandao' && currentOrder.mandaoOrderId) {
        notifyMandaoStatusChange(currentOrder.mandaoOrderId, estado).catch(console.error);
      }
    }

    await order.populate('items.producto', 'nombre categoria precio');

    console.log('✅ Estado actualizado:', order._id, '→', estado);
    if (actualizarTodosLosProductos) {
      console.log('✅ Todos los productos actualizados a:', estado);
    }

    res.json({
      success: true,
      message: `Pedido actualizado a estado: ${estado}${ordersToUpdate.length > 1 ? ` (${ordersToUpdate.length} órdenes del grupo)` : ''}`,
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

// ✅ NUEVA RUTA: Registrar pago parcial/completo
router.post('/:id/pago-parcial', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { metodo, monto, clienteNombre, clienteCcNit } = req.body;
    const validMethods = ['efectivo', 'transferencia'];

    if (!metodo || !validMethods.includes(metodo)) {
      return res.status(400).json({
        success: false,
        message: 'Método de pago inválido. Debe ser "efectivo" o "transferencia"'
      });
    }

    if (!monto || monto <= 0) {
      return res.status(400).json({
        success: false,
        message: 'El monto debe ser mayor a 0'
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    if (order.estado === 'entregado') {
      return res.status(400).json({
        success: false,
        message: 'Este pedido ya está completamente pagado'
      });
    }

    if (order.estado === 'cancelado') {
      return res.status(400).json({
        success: false,
        message: 'No se puede pagar un pedido cancelado'
      });
    }

    const saldoRestante = order.total - (order.totalPagado || 0);

    if (monto > saldoRestante + 1) {
      return res.status(400).json({
        success: false,
        message: `El monto ($${monto.toLocaleString('es-CO')}) excede el saldo restante ($${saldoRestante.toLocaleString('es-CO')})`
      });
    }

    // Registrar el pago
    if (!order.pagos) order.pagos = [];
    order.pagos.push({
      metodo,
      monto: Math.min(monto, saldoRestante),
      fecha: new Date()
    });

    order.totalPagado = (order.totalPagado || 0) + Math.min(monto, saldoRestante);

    const estaPagadoCompleto = order.totalPagado >= order.total;

    if (estaPagadoCompleto) {
      const metodos = [...new Set(order.pagos.map(p => p.metodo))];
      if (metodos.length === 1) {
        order.metodoPago = metodos[0];
      } else {
        order.metodoPago = 'mixto';
      }

      order.estado = 'entregado';

      order.items.forEach(item => {
        item.estadosIndividuales = [{
          cantidad: item.cantidad,
          estado: 'entregado'
        }];
      });

      if (clienteNombre) order.clienteNombre = clienteNombre;
      if (clienteCcNit) order.clienteCcNit = clienteCcNit;
    }

    // MULTI-LOCAL HUB: Propagar si es hub mesero
    if (req.isHubMesero && order.hubOrderGroup && estaPagadoCompleto) {
      const groupOrders = await Order.find({
        hubOrderGroup: order.hubOrderGroup,
        _id: { $ne: order._id }
      });

      for (const siblingOrder of groupOrders) {
        siblingOrder.estado = 'entregado';
        siblingOrder.metodoPago = order.metodoPago;
        siblingOrder.pagos = order.pagos;
        siblingOrder.totalPagado = siblingOrder.total;
        siblingOrder.items.forEach(item => {
          item.estadosIndividuales = [{
            cantidad: item.cantidad,
            estado: 'entregado'
          }];
        });
        if (clienteNombre) siblingOrder.clienteNombre = clienteNombre;
        if (clienteCcNit) siblingOrder.clienteCcNit = clienteCcNit;
        await siblingOrder.save();
      }
    }

    await order.save();
    await order.populate('items.producto', 'nombre categoria precio');

    console.log(`✅ Pago registrado: $${monto} (${metodo}) en pedido ${order._id}. Total pagado: $${order.totalPagado}/${order.total}`);

    res.json({
      success: true,
      message: estaPagadoCompleto
        ? 'Pedido pagado completamente'
        : `Pago parcial registrado. Saldo restante: $${(order.total - order.totalPagado).toLocaleString('es-CO')}`,
      data: order,
      pagadoCompleto: estaPagadoCompleto,
      saldoRestante: order.total - order.totalPagado
    });
  } catch (error) {
    console.error('Error al registrar pago parcial:', error);
    res.status(400).json({
      success: false,
      message: 'Error al registrar el pago',
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

// NUEVA RUTA: Cambiar método de pago
router.patch('/:id/metodo-pago', protect, checkPermission('editarPedidos'), async (req, res) => {
  try {
    const { metodoPago, montoParcial, pagoIndex } = req.body;
    const validMethods = ['efectivo', 'transferencia'];

    if (!metodoPago || !validMethods.includes(metodoPago)) {
      return res.status(400).json({
        success: false,
        message: 'Método de pago inválido'
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    // Verificar que el pedido esté pagado (entregado)
    if (order.estado !== 'entregado') {
      return res.status(400).json({
        success: false,
        message: 'Solo se puede cambiar el método de pago de pedidos pagados'
      });
    }

    // Verificar que no haya sido liquidado
    if (order.reciboDia === true) {
      return res.status(400).json({
        success: false,
        message: 'No se puede cambiar el método de pago de un pedido ya liquidado'
      });
    }

    // Asegurar que el array pagos exista (retrocompatibilidad)
    if (!order.pagos || order.pagos.length === 0) {
      order.pagos = [{ metodo: order.metodoPago || 'efectivo', monto: order.total }];
    }

    const isParcial = montoParcial !== undefined && montoParcial !== null && montoParcial > 0;
    const targetIndex = pagoIndex !== undefined ? parseInt(pagoIndex) : 0;

    if (targetIndex < 0 || targetIndex >= order.pagos.length) {
      return res.status(400).json({ success: false, message: 'Índice de pago inválido' });
    }

    const targetPago = order.pagos[targetIndex];

    if (isParcial) {
      if (montoParcial > targetPago.monto) {
        return res.status(400).json({ success: false, message: 'El monto a cambiar excede el pago actual' });
      }
      if (montoParcial === targetPago.monto) {
        targetPago.metodo = metodoPago;
      } else {
        targetPago.monto -= montoParcial;
        order.pagos.push({ metodo: metodoPago, monto: montoParcial });
      }
    } else {
      targetPago.metodo = metodoPago;
    }

    // Consolidar pagos del mismo método
    const mergedPagos = [];
    order.pagos.forEach(p => {
      const existing = mergedPagos.find(mp => mp.metodo === p.metodo);
      if (existing) {
        existing.monto += p.monto;
      } else {
        mergedPagos.push({ metodo: p.metodo, monto: p.monto });
      }
    });

    order.pagos = mergedPagos.filter(p => p.monto > 0);

    // Actualizar el campo legacy 'metodoPago'
    if (order.pagos.length > 1) {
      order.metodoPago = 'mixto';
    } else if (order.pagos.length === 1) {
      order.metodoPago = order.pagos[0].metodo;
    }

    await order.save();

    console.log('✅ Método de pago actualizado:', order._id, '→', order.metodoPago);

    res.json({
      success: true,
      message: `Método de pago actualizado a ${order.metodoPago}`,
      data: order
    });
  } catch (error) {
    console.error('Error al cambiar método de pago:', error);
    res.status(400).json({
      success: false,
      message: 'Error al cambiar el método de pago',
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

    // Si hay items, actualizarlos preservando estadosIndividuales y notas existentes
    if (items && items.length > 0) {
      // Construir mapa de items originales para preservar estadosIndividuales existentes
      const itemsOriginalesMap = new Map();
      order.items.forEach(existingItem => {
        const key = existingItem.producto ? existingItem.producto.toString() : existingItem.nombreProducto;
        itemsOriginalesMap.set(key, existingItem);
      });

      order.items = items.map(item => {
        const key = item.producto ? item.producto.toString() : item.nombreProducto;
        const itemOriginal = itemsOriginalesMap.get(key);

        // Preservar estadosIndividuales si el item ya existía y la cantidad no cambió
        let estadosIndividuales;
        if (itemOriginal && itemOriginal.estadosIndividuales && itemOriginal.estadosIndividuales.length > 0) {
          const cantidadOriginalTotal = itemOriginal.estadosIndividuales.reduce((s, e) => s + e.cantidad, 0);
          if (cantidadOriginalTotal === item.cantidad) {
            // Misma cantidad: preservar estados existentes
            estadosIndividuales = itemOriginal.estadosIndividuales;
          } else {
            // Cantidad cambió: reiniciar a pendiente con nueva cantidad
            estadosIndividuales = [{ cantidad: item.cantidad, estado: 'pendiente' }];
          }
        } else {
          estadosIndividuales = [{ cantidad: item.cantidad, estado: 'pendiente' }];
        }

        return {
          producto: item.producto,
          nombreProducto: item.nombreProducto,
          categoriaProducto: item.categoriaProducto,
          cantidad: item.cantidad,
          precio: item.precio,
          alimentosExcluidos: item.alimentosExcluidos || [],
          alimentosAjustados: item.alimentosAjustados || [],
          nota: item.nota !== undefined ? item.nota : (itemOriginal ? itemOriginal.nota || '' : ''),
          estadosIndividuales
        };
      });

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
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Pedido no encontrado'
      });
    }

    // ✅ MULTI-LOCAL HUB: Si es hub mesero y la orden tiene grupo, eliminar todas
    let ordersToDelete = [order];
    if (req.isHubMesero && order.hubOrderGroup) {
      const groupOrders = await Order.find({
        hubOrderGroup: order.hubOrderGroup,
        _id: { $ne: order._id }
      });
      ordersToDelete = [order, ...groupOrders];
      console.log(`🔗 Hub mesero: Eliminando ${ordersToDelete.length} órdenes del grupo ${order.hubOrderGroup}`);
    }

    for (const currentOrder of ordersToDelete) {
      // ✅ DEVOLVER STOCK antes de eliminar (si no estaba cancelado ya)
      if (currentOrder.estado !== 'cancelado') {
        try {
          await revertirStockAlimentos(currentOrder.items, currentOrder.userId);
          console.log('✅ Stock revertido por eliminación del pedido:', currentOrder._id);
        } catch (revertError) {
          console.error('⚠️ Error revirtiendo stock al eliminar:', revertError.message);
        }
      }

      await Order.findByIdAndDelete(currentOrder._id);
    }

    res.json({
      success: true,
      message: `Pedido${ordersToDelete.length > 1 ? 's' : ''} eliminado${ordersToDelete.length > 1 ? 's' : ''} exitosamente`,
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