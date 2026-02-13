const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Product = require('../models/Product');
const Alimento = require('../models/Alimento');

// ✅ FUNCIÓN REUTILIZADA DE JC-RT PARA DESCONTAR STOCK
async function descontarStockAlimentos(items, userId) {
    try {
        console.log(`📦 Iniciando descuento de stock para ${items.length} items. User: ${userId}`);
        for (const item of items) {
            const productoId = item.producto;
            const cantidadPedida = item.cantidad;

            const alimentos = await Alimento.find({
                'productos.productoId': productoId,
                userId: userId
            });

            console.log(`   🔍 Producto ${item.nombreProducto} (${productoId}): Encontrados ${alimentos.length} alimentos vinculados.`);

            for (const alimento of alimentos) {
                const productoConfig = alimento.productos.find(
                    p => p.productoId.toString() === productoId.toString()
                );

                if (productoConfig) {
                    const cantidadADescontar = productoConfig.cantidadRequerida * cantidadPedida;
                    console.log(`   📉 Alimento: ${alimento.nombre} | Stock anterior: ${alimento.stock} | Descontando: ${cantidadADescontar}`);
                    alimento.stock -= cantidadADescontar;
                    if (alimento.stock < 0) alimento.stock = 0;
                    await alimento.save();
                    console.log(`      ✅ Nuevo stock: ${alimento.stock}`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Error al descontar stock en integración:', error);
    }
}

/**
 * POST /api/mandao/order
 * Recibe un pedido desde Mandao
 */
router.post('/order', async (req, res) => {
    try {
        const { mandaoOrderId, items, total, metodoPago, direccion, notas } = req.body;

        if (!mandaoOrderId || !items) {
            return res.status(400).json({ success: false, message: 'Datos incompletos' });
        }

        // 1. Mapear productos de Mandao a JC-RT
        const itemsJC = await Promise.all(items.map(async (item) => {
            const nombreLimpio = item.nombre.trim();
            const product = await Product.findOne({
                userId: req.user._id,
                nombre: { $regex: new RegExp(`^\\s*${nombreLimpio}\\s*$`, 'i') }
            });

            return {
                producto: product ? product._id : null,
                nombreProducto: nombreLimpio,
                categoriaProducto: product ? product.categoria : 'Mandao',
                cantidad: item.cantidad,
                precio: item.precio,
                estadosIndividuales: [{
                    cantidad: item.cantidad,
                    estado: 'pendiente'
                }]
            };
        }));

        // 2. Crear pedido en JC-RT
        const orderData = {
            mesa: 'MANDAO',
            items: itemsJC,
            total: total,
            notas: `${notas} | ID Mandao: ${mandaoOrderId}`,
            userId: req.user._id,
            estado: 'pendiente',
            mandaoOrderId: mandaoOrderId,
            source: 'mandao',
            metodoPago: metodoPago === 'Transferencia' ? 'transferencia' : 'efectivo'
        };

        const order = await Order.create(orderData);

        // 3. Descontar stock
        const itemsConProducto = itemsJC.filter(i => i.producto);
        if (itemsConProducto.length > 0) {
            await descontarStockAlimentos(itemsConProducto, req.user._id);
        }

        // 4. Emitir evento vía Socket.io
        if (global.io) {
            global.io.emit('newMandaoOrder', {
                orderId: order._id,
                mesa: 'MANDAO',
                total: total
            });
        }

        res.status(201).json({
            success: true,
            message: 'Pedido de Mandao sincronizado en JC-RT',
            orderId: order._id
        });

    } catch (error) {
        console.error('❌ Error sincronizando pedido Mandao:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/mandao/products
 * Devuelve la lista de productos con su disponibilidad real basada en stock de alimentos
 */
router.get('/products', async (req, res) => {
    try {
        const userId = req.user._id;
        const products = await Product.find({ userId });
        const alimentos = await Alimento.find({ userId });

        const results = products.map(product => {
            // 1. Buscar alimentos vinculados a este producto
            const alimentosVinculados = alimentos.filter(a =>
                a.productos && a.productos.some(p => p.productoId.toString() === product._id.toString())
            );

            let disponiblePorStock = true;

            if (alimentosVinculados.length > 0) {
                // Producto compuesto: Verificar stock de todos sus ingredientes
                disponiblePorStock = alimentosVinculados.every(alimento => {
                    const config = alimento.productos.find(p => p.productoId.toString() === product._id.toString());
                    return alimento.stock >= (config.cantidadRequerida || 1);
                });
            } else {
                // Producto simple: Usar campo disponible del modelo Product
                disponiblePorStock = product.disponible;
            }

            return {
                jcrtId: product._id,
                nombre: product.nombre,
                precio: product.precio,
                disponible: disponiblePorStock && product.disponible // Combinar ambos estados
            };
        });

        res.json({
            success: true,
            products: results
        });

    } catch (error) {
        console.error('❌ Error obteniendo disponibilidad para Mandao:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
