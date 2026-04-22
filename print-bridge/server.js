const express = require('express');
const cors = require('cors');
const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

/**
 * Función para inicializar la impresora según la configuración
 */
function initPrinter(config) {
    const { tipo, conexion, interface: printerInterface } = config;
    
    return new ThermalPrinter({
        type: tipo === 'epson' ? PrinterTypes.EPSON : PrinterTypes.STAR,
        interface: conexion === 'red' ? `tcp://${printerInterface}` : `printer:${printerInterface}`,
        driver: require('node-thermal-printer').driver, // Necesario para impresoras del sistema
        characterSet: 'PC850', // Soporte para caracteres latinos
        removeSpecialCharacters: false,
        options: {
            timeout: 5000
        }
    });
}

// Endpoint de prueba
app.post('/test', async (req, res) => {
    console.log("🧪 Recibida petición de prueba de impresión...");
    const printer = initPrinter(req.body);
    
    try {
        const isConnected = await printer.isPrinterConnected();
        if (!isConnected && req.body.conexion === 'red') {
            return res.status(500).json({ success: false, message: "No se pudo conectar a la IP especificada." });
        }

        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println("prueba de impresion JC-RT");
        printer.bold(false);
        printer.setTextSize(0, 0);
        printer.println("\nConexión establecida correctamente.");
        printer.println(new Date().toLocaleString());
        printer.cut();
        
        await printer.execute();
        res.json({ success: true, message: "Impresión de prueba enviada." });
    } catch (error) {
        console.error("❌ Error en test:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint principal de impresión
app.post('/print', async (req, res) => {
    const { config, order } = req.body;
    console.log(`🖨️ Procesando pedido: MESA ${order.mesa}`);
    
    const printer = initPrinter(config);

    try {
        // Cabecera
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println("JC-RT RESTAURANTE");
        printer.setTextSize(0, 0);
        printer.println("--------------------------------");
        printer.bold(true);
        printer.println(`COMANDA - MESA: ${order.mesa}`);
        printer.bold(false);
        printer.println(`Fecha: ${new Date().toLocaleString()}`);
        printer.println("--------------------------------");
        
        // Items
        printer.alignLeft();
        order.items.forEach(item => {
            const nombre = item.productoInfo ? item.productoInfo.nombre : (item.nombreProducto || 'Producto');
            printer.bold(true);
            printer.println(`${item.cantidad}x ${nombre}`);
            printer.bold(false);
            if (item.notas) {
                printer.println(`  Nota: ${item.notas}`);
            }
            printer.println(""); // Espacio entre items
        });

        printer.println("--------------------------------");
        printer.alignCenter();
        printer.println("¡A COCINAR!");
        printer.newLine();
        
        // Corte y Ejecución
        printer.cut();
        await printer.execute();
        
        res.json({ success: true, message: "Comanda enviada a la impresora." });
    } catch (error) {
        console.error("❌ Error al imprimir pedido:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 JC-RT Print Bridge corriendo en http://localhost:${PORT}`);
    console.log(`📡 Esperando peticiones de impresión...`);
});
