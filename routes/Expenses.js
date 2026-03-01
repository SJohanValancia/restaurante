const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');


// Obtener todos los gastos del restaurante
router.get('/', protect, checkPermission('verGastos'), async (req, res) => {
  try {
    const { month, page = 1, limit = 50 } = req.query;
    
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const skip = (pageNum - 1) * limitNum;

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

    const [expenses, total] = await Promise.all([
      Expense.find(query).sort({ fecha: -1 }).skip(skip).limit(limitNum).lean(),
      Expense.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      count: expenses.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
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
// Crear un nuevo registro de gastos
router.post('/', protect, checkPermission('crearGastos'), async (req, res) => {
  try {
    // Parsear la fecha correctamente sin afectar la zona horaria
    const fechaParts = req.body.fecha.split('-');
    const fecha = new Date(fechaParts[0], fechaParts[1] - 1, fechaParts[2], 12, 0, 0);
    
    const expenseData = {
      ...req.body,
      fecha: fecha,
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
// Actualizar un registro de gastos
router.put('/:id', protect, checkPermission('editarGastos'), async (req, res) => {
  try {
    // Parsear la fecha correctamente sin afectar la zona horaria
    let updateData = { ...req.body };
    
    if (req.body.fecha) {
      const fechaParts = req.body.fecha.split('-');
      updateData.fecha = new Date(fechaParts[0], fechaParts[1] - 1, fechaParts[2], 12, 0, 0);
    }
    
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      updateData,
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
router.delete('/:id', protect, checkPermission('eliminarGastos'), async (req, res) => {
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

    const result = await Expense.aggregate([
      { $match: query },
      { $unwind: '$gastos' },
      {
        $group: {
          _id: null,
          totalGastos: { $sum: '$gastos.monto' },
          cantidadRegistros: { $addToSet: '$_id' },
          cantidadGastos: { $sum: 1 }
        }
      }
    ]);

    const data = result[0] || { totalGastos: 0, cantidadRegistros: [], cantidadGastos: 0 };
    
    res.json({
      success: true,
      data: {
        totalGastos: data.totalGastos,
        cantidadRegistros: data.cantidadRegistros.length,
        cantidadGastos: data.cantidadGastos,
        promedioporRegistro: data.cantidadRegistros.length > 0 ? data.totalGastos / data.cantidadRegistros.length : 0
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