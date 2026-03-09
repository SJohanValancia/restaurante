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

    // ✅ OPTIMIZACIÓN: Usar agregación para cálculos complejos
    const pipeline = [
      { $match: query },
      {
        $addFields: {
          totalTransferenciasIngresos: { $sum: '$ingresos.pedidos.total' },
          totalTransferenciasGastos: { $sum: '$egresos.gastos.monto' },
          totalGastosEfectivo: { $sum: '$egresos.gastos.monto' },
          totalAportes: { $sum: '$movimientosCaja.monto' },
          totalRetiros: { $sum: '$movimientosCaja.monto' }
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
    const cajaFinalTotal = stats.totalIngresos - stats.totalEgresos + totalMovimientos;

    res.json({
      success: true,
      data: {
        ...stats,
        cajaTransferencias,
        cajaFinalTotal,
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
    const { cajaInicial, movimientosCaja, observaciones } = req.body;

    const pedidos = await Order.find({
      userId: { $in: req.userIdsRestaurante },
      estado: 'entregado',
      reciboDia: false
    });

    const gastos = await Expense.find({
      userId: { $in: req.userIdsRestaurante },
      reciboDia: false
    });

    const totalPedidos = pedidos.reduce((sum, pedido) => sum + pedido.total, 0);
    const totalGastos = gastos.reduce((sum, gasto) => sum + gasto.total, 0);
    const totalMovimientos = movimientosCaja && movimientosCaja.length > 0
      ? movimientosCaja.reduce((sum, mov) => sum + mov.monto, 0)
      : 0;

    const tieneDatosReales = totalPedidos > 0 || totalGastos > 0 || totalMovimientos > 0;
    if (!tieneDatosReales) {
      return res.status(400).json({
        success: false,
        message: 'No hay pedidos, gastos o movimientos para liquidar. La liquidación debe contener al menos un elemento con valor.'
      });
    }

    const liquidacion = await Liquidacion.create({
      fecha: new Date(),
      cajaInicial: cajaInicial || 0,
      ingresos: {
        totalPedidos,
        pedidos: pedidos.map(p => p._id)
      },
      egresos: {
        totalGastos,
        gastos: gastos.map(g => g._id)
      },
      movimientosCaja: movimientosCaja || [],
      observaciones,
      userId: req.user._id,
      cerrada: true
    });

    if (pedidos.length > 0) {
      await Order.updateMany(
        { _id: { $in: pedidos.map(p => p._id) } },
        { $set: { reciboDia: true } }
      );
    }

    if (gastos.length > 0) {
      await Expense.updateMany(
        { _id: { $in: gastos.map(g => g._id) } },
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
          select: 'mesa total createdAt estado metodoPago'
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
        select: 'mesa total createdAt estado metodoPago items'
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