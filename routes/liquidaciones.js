const express = require('express');
const router = express.Router();
const Liquidacion = require('../models/liquidacion');
const Order = require('../models/order');
const Expense = require('../models/Expense');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');

// Obtener la última liquidación del restaurante
router.get('/ultima', protect, async (req, res) => {
  try {
    const liquidaciones = await Liquidacion.find({
      userId: { $in: req.userIdsRestaurante },
      cerrada: true
    })
      .sort({ fecha: -1 })
      .limit(10)
      .lean();

    const liquidacionValida = liquidaciones.find(lq => {
      const tieneIngresos = lq.ingresos?.totalPedidos > 0;
      const tieneEgresos = lq.egresos?.totalGastos > 0;
      const tieneMovimientos = lq.movimientosCaja && lq.movimientosCaja.length > 0;
      const tieneCajaInicial = lq.cajaInicial > 0;
      const tieneCajaFinal = lq.cajaFinal > 0;

      return tieneIngresos || tieneEgresos || tieneMovimientos || tieneCajaInicial || tieneCajaFinal;
    });

    res.json({
      success: true,
      data: liquidacionValida || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener la última liquidación',
      error: error.message
    });
  }
});

// Obtener datos pendientes de liquidación
router.get('/pendientes', protect, async (req, res) => {
  try {
    const pedidos = await Order.find({
      userId: { $in: req.userIdsRestaurante },
      estado: 'entregado',
      reciboDia: false
    })
      .populate('items.producto', 'nombre precio')
      .sort({ createdAt: -1 });

    const gastos = await Expense.find({
      userId: { $in: req.userIdsRestaurante },
      reciboDia: false
    }).sort({ fecha: -1 });

    const totalPedidos = pedidos.reduce((sum, pedido) => sum + pedido.total, 0);
    const totalGastos = gastos.reduce((sum, gasto) => sum + gasto.total, 0);

    res.json({
      success: true,
      data: {
        pedidos,
        gastos,
        totalPedidos,
        totalGastos
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos pendientes',
      error: error.message
    });
  }
});

router.get('/stats/resumen', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const pipeline = [
      { $match: query },

      // Lookup pedidos para calcular transferencias reales
      {
        $lookup: {
          from: 'orders',
          localField: 'ingresos.pedidos',
          foreignField: '_id',
          as: 'pedidosPopulados'
        }
      },

      // Lookup gastos para calcular gastos efectivo/transferencia reales
      {
        $lookup: {
          from: 'expenses',
          localField: 'egresos.gastos',
          foreignField: '_id',
          as: 'gastosPopulados'
        }
      },

      {
        $addFields: {
          // Transferencias de ingresos (soporta pagos mixtos)
          totalTransferenciasIngresos: {
            $sum: {
              $map: {
                input: '$pedidosPopulados',
                as: 'p',
                in: {
                  $cond: [
                    // Si tiene pagos parciales (array pagos), sumar solo los de transferencia
                    { $and: [{ $isArray: '$$p.pagos' }, { $gt: [{ $size: '$$p.pagos' }, 0] }] },
                    {
                      $sum: {
                        $map: {
                          input: '$$p.pagos',
                          as: 'pago',
                          in: {
                            $cond: [{ $eq: ['$$pago.metodo', 'transferencia'] }, '$$pago.monto', 0]
                          }
                        }
                      }
                    },
                    // Fallback: si no tiene pagos parciales, usar metodoPago clásico
                    { $cond: [{ $eq: ['$$p.metodoPago', 'transferencia'] }, '$$p.total', 0] }
                  ]
                }
              }
            }
          },

          // Gastos por transferencia
          totalTransferenciasGastos: {
            $sum: {
              $map: {
                input: '$gastosPopulados',
                as: 'g',
                in: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ['$$g.gastos', []] },
                      as: 'item',
                      in: {
                        $cond: [{ $eq: ['$$item.metodoPago', 'transferencia'] }, '$$item.monto', 0]
                      }
                    }
                  }
                }
              }
            }
          },

          // Gastos en efectivo
          totalGastosEfectivo: {
            $sum: {
              $map: {
                input: '$gastosPopulados',
                as: 'g',
                in: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ['$$g.gastos', []] },
                      as: 'item',
                      in: {
                        $cond: [{ $ne: ['$$item.metodoPago', 'transferencia'] }, '$$item.monto', 0]
                      }
                    }
                  }
                }
              }
            }
          },

          // Aportes (ingresos a caja)
          totalAportes: {
            $sum: {
              $map: {
                input: '$movimientosCaja',
                as: 'm',
                in: {
                  $cond: [{ $eq: ['$$m.tipo', 'ingreso'] }, '$$m.monto', 0]
                }
              }
            }
          },

          // Retiros de caja
          totalRetiros: {
            $sum: {
              $map: {
                input: '$movimientosCaja',
                as: 'm',
                in: {
                  $cond: [{ $eq: ['$$m.tipo', 'retiro'] }, '$$m.monto', 0]
                }
              }
            }
          }
        }
      },

      {
        $group: {
          _id: null,
          totalLiquidaciones: { $sum: 1 },
          totalIngresos: { $sum: '$ingresos.totalPedidos' },
          totalEgresos: { $sum: '$egresos.totalGastos' },
          totalGastosEfectivo: { $sum: '$totalGastosEfectivo' },
          totalAportes: { $sum: '$totalAportes' },
          totalRetiros: { $sum: '$totalRetiros' },
          totalTransferenciasIngresos: { $sum: '$totalTransferenciasIngresos' },
          totalTransferenciasGastos: { $sum: '$totalTransferenciasGastos' }
        }
      }
    ];

    const [stats] = await Liquidacion.aggregate(pipeline);

    if (!stats) {
      return res.json({
        success: true,
        data: {
          totalLiquidaciones: 0,
          totalIngresos: 0,
          totalEgresos: 0,
          totalGastosEfectivo: 0,
          totalAportes: 0,
          totalRetiros: 0,
          totalTransferenciasIngresos: 0,
          totalTransferenciasGastos: 0,
          cajaTransferencias: 0,
          cajaFinalTotal: 0,
          promedioIngresosPorDia: 0,
          promedioEgresosPorDia: 0
        }
      });
    }

    const totalMovimientos = stats.totalAportes - stats.totalRetiros;
    const cajaTransferencias = stats.totalTransferenciasIngresos - stats.totalTransferenciasGastos;

    // Obtener el cajaFinal de la última liquidación (la más reciente)
    // Este valor ya incluye el arrastre de saldo (cajaInicial) correctamente
    const ultimaLiquidacion = await Liquidacion.findOne(query)
      .sort({ fecha: -1 })
      .select('cajaFinal')
      .lean();

    const cajaFinalTotal = ultimaLiquidacion ? ultimaLiquidacion.cajaFinal : 0;

    res.json({
      success: true,
      data: {
        ...stats,
        cajaTransferencias,
        cajaFinalTotal,
        totalMovimientos,
        promedioIngresosPorDia: stats.totalLiquidaciones > 0
          ? stats.totalIngresos / stats.totalLiquidaciones
          : 0,
        promedioEgresosPorDia: stats.totalLiquidaciones > 0
          ? stats.totalEgresos / stats.totalLiquidaciones
          : 0
      }
    });

  } catch (error) {
    console.error('❌ Error al obtener estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas',
      error: error.message
    });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { cajaInicial, valorBase, ingresos, egresos, movimientosCaja, observaciones, cajaFinal } = req.body;

    // Usar datos enviados desde el frontend
    const totalPedidos = ingresos?.totalPedidos || 0;
    const totalGastos = egresos?.totalGastos || 0;
    const movimientos = movimientosCaja || [];
    const totalMovimientos = movimientos.length > 0
      ? movimientos.reduce((sum, mov) => mov.tipo === 'ingreso' ? sum + mov.monto : sum - mov.monto, 0)
      : 0;

    // Calcular cajaFinal si no viene del frontend
    const cajaInicialTotal = (cajaInicial || 0) + (valorBase || 0);
    const cajaFinalCalculada = cajaFinal !== undefined 
      ? cajaFinal 
      : cajaInicialTotal + totalPedidos - totalGastos + totalMovimientos;

    const liquidacion = await Liquidacion.create({
      fecha: new Date(),
      cajaInicial: cajaInicialTotal,
      valorBase: valorBase || 0,
      ingresos: {
        totalPedidos,
        pedidos: (ingresos?.pedidos || []).map(p => p._id || p)
      },
      egresos: {
        totalGastos,
        gastos: (egresos?.gastos || []).map(g => g._id || g)
      },
      movimientosCaja: movimientos,
      observaciones,
      userId: req.user._id,
      cajaFinal: cajaFinalCalculada,
      cerrada: true
    });

    // Marcar pedidos como liquidados
    const pedidosIds = (ingresos?.pedidos || []).map(p => p._id || p).filter(Boolean);
    if (pedidosIds.length > 0) {
      await Order.updateMany(
        { _id: { $in: pedidosIds } },
        { $set: { reciboDia: true } }
      );
    }

    // Marcar gastos como liquidados
    const gastosIds = (egresos?.gastos || []).map(g => g._id || g).filter(Boolean);
    if (gastosIds.length > 0) {
      await Expense.updateMany(
        { _id: { $in: gastosIds } },
        { $set: { reciboDia: true } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Liquidación creada exitosamente',
      data: liquidacion
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al crear la liquidación',
      error: error.message
    });
  }
});

router.get('/', protect, async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 30 } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 30, 100);
    const skip = (pageNum - 1) * limitNum;

    let query = { userId: { $in: req.userIdsRestaurante } };

    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const [liquidaciones, total] = await Promise.all([
      Liquidacion.find(query)
        .populate({
          path: 'ingresos.pedidos',
          select: 'mesa total createdAt estado metodoPago pagos totalPagado'
        })
        .populate({
          path: 'egresos.gastos',
          select: 'fecha total gastos'
        })
        .sort({ fecha: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Liquidacion.countDocuments(query)
    ]);

    liquidaciones.forEach(liq => {
      if (liq.ingresos && Array.isArray(liq.ingresos.pedidos)) {
        liq.ingresos.pedidos = liq.ingresos.pedidos.filter(p => p !== null);
      }

      if (liq.egresos && Array.isArray(liq.egresos.gastos)) {
        liq.egresos.gastos = liq.egresos.gastos.filter(g => g !== null);
      }
    });

    res.json({
      success: true,
      count: liquidaciones.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: liquidaciones
    });
  } catch (error) {
    console.error('❌ Error al obtener liquidaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las liquidaciones',
      error: error.message
    });
  }
});

// Obtener una liquidación por ID
router.get('/:id', protect, async (req, res) => {
  try {
    const liquidacion = await Liquidacion.findById(req.params.id)
      .populate({
        path: 'ingresos.pedidos',
        select: 'mesa total createdAt estado metodoPago pagos totalPagado items'
      })
      .populate({
        path: 'egresos.gastos',
        select: 'fecha total gastos'
      })
      .populate('userId', 'nombre email')
      .lean();

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: 'Liquidación no encontrada'
      });
    }

    // Limpiar referencias rotas
    if (liquidacion.ingresos && Array.isArray(liquidacion.ingresos.pedidos)) {
      liquidacion.ingresos.pedidos = liquidacion.ingresos.pedidos.filter(p => p !== null);
    }

    if (liquidacion.egresos && Array.isArray(liquidacion.egresos.gastos)) {
      liquidacion.egresos.gastos = liquidacion.egresos.gastos.filter(g => g !== null);
    }

    res.json({
      success: true,
      data: liquidacion
    });
  } catch (error) {
    console.error('❌ Error al obtener liquidación:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la liquidación',
      error: error.message
    });
  }
});

// Actualizar una liquidación
router.put('/:id', protect, async (req, res) => {
  try {
    const liquidacion = await Liquidacion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: 'Liquidación no encontrada'
      });
    }

    res.json({
      success: true,
      message: 'Liquidación actualizada exitosamente',
      data: liquidacion
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar la liquidación',
      error: error.message
    });
  }
});

// Eliminar una liquidación
router.delete('/:id', protect, async (req, res) => {
  try {
    const liquidacion = await Liquidacion.findByIdAndDelete(req.params.id);

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: 'Liquidación no encontrada'
      });
    }

    res.json({
      success: true,
      message: 'Liquidación eliminada exitosamente',
      data: liquidacion
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar la liquidación',
      error: error.message
    });
  }
});

module.exports = router;