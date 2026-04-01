const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://soporte:1vJc4xIuGg4J1aIf@cluster0.b7wpe.mongodb.net/johan-restaurante?retryWrites=true&w=majority')
.then(async () => {
    const Order = require('./models/Order');
    const User = require('./models/User');
    
    const local1 = await User.findOne({ nombre: 'local 1' });
    if (!local1) return console.log('Local 1 not found');
    console.log('Local 1 ID:', local1._id);
    
    const stats = await Order.aggregate([
      { $match: { userId: local1._id, estado: { $ne: 'cancelado' } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.producto', cantidadTotal: { $sum: '$items.cantidad' }, ingresosTotales: { $sum: { $multiply: ['$items.cantidad', '$items.precio'] } } } },
      { $sort: { cantidadTotal: -1 } },
      { $limit: 3 }
    ]);
    
    console.log('Top for local 1:', JSON.stringify(stats, null, 2));
    process.exit();
});
