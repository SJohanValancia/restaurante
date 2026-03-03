const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const expensesRoutes = require('./routes/Expenses');
const liquidacionesRoutes = require('./routes/liquidaciones');
const adminMeserosRoutes = require('./routes/adminMeseros');
const ordersRoutes = require('./routes/Orders');
const alimentosRoutes = require('./routes/alimentos');
const productsRoutes = require('./routes/Products');
const mandaoRoutes = require('./routes/mandao'); // ✅ Integración Mandao
const pushRoutes = require('./routes/push'); // ✅ Push notifications
const { protect } = require('./middleware/auth');
require('dotenv').config();

// ✅ Inicializar Firebase Admin
const { initializeFirebase } = require('./services/pushNotification');
initializeFirebase();

// ✅ Inicializar Cron Jobs (Bloqueo automático)
const { startCronJobs } = require('./services/cronJobs');
startCronJobs();

// ✅ MONITOREO DE RENDIMIENTO
const performance = require('perf_hooks').performance;
const consoleTime = console.time;
const consoleTimeEnd = console.timeEnd;

// Reemplazar console.time con medición de rendimiento
console.time = function(label) {
  performance.mark(`start-${label}`);
};

console.timeEnd = function(label) {
  performance.mark(`end-${label}`);
  performance.measure(label, `start-${label}`, `end-${label}`);
  const measure = performance.getEntriesByName(label)[0];
  console.log(`⏱ ${label}: ${measure.duration.toFixed(2)}ms`);
  performance.clearMarks();
  performance.clearMeasures();
};

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

// ⭐ RUTAS PÚBLICAS PRIMERO (SIN protect)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/mandao', protect, mandaoRoutes); // ✅ Integración Mandao
app.use('/api/push', pushRoutes); // ✅ Notificaciones push (público)

// ⭐ RUTAS PROTEGIDAS (CON protect)
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