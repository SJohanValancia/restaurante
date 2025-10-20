const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');


// Obtener todos los gastos del restaurante
router.get('/', protect, checkPermission('verGastos'), async (req, res) => {
  try {
    const { month } = req.query;
    let query = { userId: { $in: req.userIdsRestaurante } };

    if (month) {
      const [year, monthNum] = month.split('-');
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0, 23, 59, 59);
      
      query.fecha = {
        $gte: startDate,
        $lte: endDate
      };
    }

    const expenses = await Expense.find(query).sort({ fecha: -1 });
    
    res.json({
      success: true,
      count: expenses.length,
      data: expenses
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener los gastos',
      error: error.message
    });
  }
});

// Obtener un gasto por ID
router.get('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Gasto no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el gasto',
      error: error.message
    });
  }
});

// Crear un nuevo registro de gastos
router.post('/', protect, checkPermission('crearGastos'), async (req, res) => {
  try {
    const expenseData = {
      ...req.body,
      userId: req.user._id
    };
    
    const expense = await Expense.create(expenseData);
    
    res.status(201).json({
      success: true,
      message: 'Gastos registrados exitosamente',
      data: expense
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al crear el registro de gastos',
      error: error.message
    });
  }
});


// Actualizar un registro de gastos
router.put('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Gasto no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Gastos actualizados exitosamente',
      data: expense
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error al actualizar los gastos',
      error: error.message
    });
  }
});

// Eliminar un registro de gastos
router.delete('/:id', protect, async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Gasto no encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Gastos eliminados exitosamente',
      data: expense
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al eliminar los gastos',
      error: error.message
    });
  }
});

router.get('/stats/summary', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = { userId: { $in: req.userIdsRestaurante } };
    
    if (startDate && endDate) {
      query.fecha = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const expenses = await Expense.find(query);
    
    const totalGastos = expenses.reduce((sum, exp) => sum + exp.total, 0);
    const cantidadRegistros = expenses.length;
    const cantidadGastos = expenses.reduce((sum, exp) => sum + exp.gastos.length, 0);

    res.json({
      success: true,
      data: {
        totalGastos,
        cantidadRegistros,
        cantidadGastos,
        promedioporRegistro: cantidadRegistros > 0 ? totalGastos / cantidadRegistros : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener el resumen',
      error: error.message
    });
  }
});

module.exports = router;