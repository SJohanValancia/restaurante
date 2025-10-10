const express = require('express');
const router = express.Router();
const Liquidacion = require('../models/liquidacion');
const Order = require('../models/order');
const Expense = require('../models/Expense');
const mongoose = require('mongoose');

// Obtener la última liquidación de un usuario
router.get('/ultima', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido'
      });
    }

    const ultimaLiquidacion = await Liquidacion.findOne({ 
      userId,
      cerrada: true 
    })
      .sort({ fecha: -1 })
      .limit(1);

    res.json({
      success: true,
      data: ultimaLiquidacion
    });
  } catch (error) {
    console.error('Error al obtener última liquidación:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener la última liquidación',
      error: error.message
    });
  }
});

// Obtener datos pendientes de liquidación (pedidos y gastos sin liquidar)
router.get('/pendientes', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido'
      });
    }

    // Buscar pedidos entregados que NO han sido liquidados
    const pedidos = await Order.find({
      userId,
      estado: 'entregado',
      reciboDia: false
    })
      .populate('items.producto', 'nombre precio')
      .sort({ createdAt: -1 });

    // Buscar gastos que NO han sido liquidados
    const gastos = await Expense.find({
      userId,
      reciboDia: false
    }).sort({ fecha: -1 });

    // Calcular totales
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
    console.error('Error al obtener datos pendientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos pendientes',
      error: error.message
    });
  }
});

// Crear nueva liquidación
router.post('/', async (req, res) => {
  try {
    const { userId, cajaInicial, movimientosCaja, observaciones } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido'
      });
    }

    // Obtener pedidos entregados NO liquidados
    const pedidos = await Order.find({
      userId,
      estado: 'entregado',
      reciboDia: false
    });

    // Obtener gastos NO liquidados
    const gastos = await Expense.find({
      userId,
      reciboDia: false
    });

    // Calcular totales
    const totalPedidos = pedidos.reduce((sum, pedido) => sum + pedido.total, 0);
    const totalGastos = gastos.reduce((sum, gasto) => sum + gasto.total, 0);

    // Crear liquidación
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
      userId,
      cerrada: true
    });

    // Marcar pedidos como liquidados
    await Order.updateMany(
      { _id: { $in: pedidos.map(p => p._id) } },
      { $set: { reciboDia: true } }
    );

    // Marcar gastos como liquidados
    await Expense.updateMany(
      { _id: { $in: gastos.map(g => g._id) } },
      { $set: { reciboDia: true } }
    );

    res.status(201).json({
      success: true,
      message: 'Liquidación creada exitosamente',
      data: liquidacion
    });
  } catch (error) {
    console.error('Error al crear liquidación:', error);
    res.status(400).json({
      success: false,
      message: 'Error al crear la liquidación',
      error: error.message
    });
  }
});

// Obtener todas las liquidaciones de un usuario
router.get('/', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido'
      });
    }

    let query = { userId };

    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const liquidaciones = await Liquidacion.find(query)
      .populate('ingresos.pedidos', 'mesa total createdAt')
      .populate('egresos.gastos', 'fecha total')
      .sort({ fecha: -1 });

    res.json({
      success: true,
      count: liquidaciones.length,
      data: liquidaciones
    });
  } catch (error) {
    console.error('Error al obtener liquidaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las liquidaciones',
      error: error.message
    });
  }
});

// Obtener una liquidación por ID
router.get('/:id', async (req, res) => {
  try {
    const liquidacion = await Liquidacion.findById(req.params.id)
      .populate('ingresos.pedidos')
      .populate('egresos.gastos')
      .populate('userId', 'nombre email');

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: 'Liquidación no encontrada'
      });
    }

    res.json({
      success: true,
      data: liquidacion
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener la liquidación',
      error: error.message
    });
  }
});

// Actualizar una liquidación
router.put('/:id', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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

// Obtener estadísticas de liquidaciones
router.get('/stats/resumen', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido'
      });
    }

    let query = { userId };

    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const liquidaciones = await Liquidacion.find(query);

    const stats = {
      totalLiquidaciones: liquidaciones.length,
      totalIngresos: liquidaciones.reduce((sum, l) => sum + l.ingresos.totalPedidos, 0),
      totalEgresos: liquidaciones.reduce((sum, l) => sum + l.egresos.totalGastos, 0),
      totalMovimientos: liquidaciones.reduce((sum, l) => sum + l.totalMovimientos, 0),
      promedioIngresosporDia: liquidaciones.length > 0 
        ? liquidaciones.reduce((sum, l) => sum + l.ingresos.totalPedidos, 0) / liquidaciones.length 
        : 0,
      promedioEgresosporDia: liquidaciones.length > 0 
        ? liquidaciones.reduce((sum, l) => sum + l.egresos.totalGastos, 0) / liquidaciones.length 
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

module.exports = router;