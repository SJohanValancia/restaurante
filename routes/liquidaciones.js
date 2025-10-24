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
    const ultimaLiquidacion = await Liquidacion.findOne({ 
      userId: { $in: req.userIdsRestaurante },
      cerrada: true 
    })
      .sort({ fecha: -1 })
      .limit(1);

    res.json({
      success: true,
      data: ultimaLiquidacion
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

    const liquidaciones = await Liquidacion.find(query)
      .populate('ingresos.pedidos')
      .populate('egresos.gastos');

    // Calcular transferencias para cada liquidación
    let totalTransferenciasIngresos = 0;
    let totalTransferenciasGastos = 0;

    liquidaciones.forEach(liq => {
      // Transferencias de pedidos
      if (liq.ingresos && liq.ingresos.pedidos) {
        liq.ingresos.pedidos.forEach(pedido => {
          if (pedido && pedido.metodoPago === 'transferencia') {
            totalTransferenciasIngresos += pedido.total;
          }
        });
      }

      // Transferencias de gastos
      if (liq.egresos && liq.egresos.gastos) {
        liq.egresos.gastos.forEach(registro => {
          if (registro && registro.gastos) {
            registro.gastos.forEach(gasto => {
              if (gasto.metodoPago === 'transferencia') {
                totalTransferenciasGastos += gasto.monto;
              }
            });
          }
        });
      }
    });

    const stats = {
      totalLiquidaciones: liquidaciones.length,
      totalIngresos: liquidaciones.reduce((sum, l) => sum + (l.ingresos?.totalPedidos || 0), 0),
      totalEgresos: liquidaciones.reduce((sum, l) => sum + (l.egresos?.totalGastos || 0), 0),
      totalMovimientos: liquidaciones.reduce((sum, l) => sum + (l.totalMovimientos || 0), 0),
      totalTransferenciasIngresos,
      totalTransferenciasGastos,
      cajaTransferencias: totalTransferenciasIngresos - totalTransferenciasGastos,
      promedioIngresosPorDia: liquidaciones.length > 0 
        ? liquidaciones.reduce((sum, l) => sum + (l.ingresos?.totalPedidos || 0), 0) / liquidaciones.length 
        : 0,
      promedioEgresosPorDia: liquidaciones.length > 0 
        ? liquidaciones.reduce((sum, l) => sum + (l.egresos?.totalGastos || 0), 0) / liquidaciones.length 
        : 0
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
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
    const { startDate, endDate } = req.query;

    let query = { userId: { $in: req.userIdsRestaurante } };

    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const liquidaciones = await Liquidacion.find(query)
      .populate('ingresos.pedidos', 'mesa total createdAt estado')
      .populate('egresos.gastos', 'fecha total gastos')
      .sort({ fecha: -1 })
      .lean();

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
      data: liquidaciones
    });
  } catch (error) {
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
      .populate('ingresos.pedidos')
      .populate('egresos.gastos')
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
    console.error('Error al obtener liquidación:', error);
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