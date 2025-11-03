const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const expensesRoutes = require('./routes/Expenses');
const liquidacionesRoutes = require('./routes/liquidaciones');
const adminMeserosRoutes = require('./routes/adminMeseros');
const ordersRoutes = require('./routes/Orders'); // IMPORTAR EXPLÍCITAMENTE
const alimentosRoutes = require('./routes/alimentos');
const { protect } = require('./middleware/auth');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error de conexión a MongoDB:', err.message));

// ⭐ IMPORTANTE: Rutas públicas de orders DEBEN IR PRIMERO
// Esta ruta NO tiene el middleware protect
app.use('/api/orders', ordersRoutes);

// Rutas públicas (sin autenticación)
app.use('/api/auth', require('./routes/auth'));

// Rutas protegidas (requieren autenticación)
app.use('/api/products', protect, require('./routes/Products'));
app.use('/api/expenses', protect, expensesRoutes);
app.use('/api/liquidaciones', protect, liquidacionesRoutes);
app.use('/api/admin-meseros', protect, adminMeserosRoutes);
app.use('/api/alimentos', alimentosRoutes);

// Ruta principal (sirve index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Ruta no encontrada'
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: err.message
  });
});

// Puerto dinámico
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});