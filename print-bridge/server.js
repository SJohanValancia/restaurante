const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
// Usamos process.pkg para detectar si estamos en el ejecutable o en desarrollo
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(baseDir, 'config.json');
const PRINTED_PATH = path.join(baseDir, 'printed.json');
const API_BASE = 'https://restaurante-co77.onrender.com/api';

let config = {
    userId: '',
    token: '',
    printer: {
        tipo: 'epson',
        conexion: 'sistema',
        interface: ''
    },
    active: false
};

// Cargar configuración inicial
if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Cargar IDs ya impresos
let printedIds = [];
if (fs.existsSync(PRINTED_PATH)) {
    printedIds = JSON.parse(fs.readFileSync(PRINTED_PATH, 'utf8'));
}

/**
 * Función para inicializar la impresora
 */
function initPrinter(pConfig) {
    const isNetwork = pConfig.conexion === 'red';
    const printerInterface = isNetwork ? `tcp://${pConfig.interface}` : `printer:${pConfig.interface}`;

    let driver = null;
    if (!isNetwork) {
        try {
            driver = require('printer');
        } catch (e) {
            // DRIVER UNIVERSAL (Fallback para cuando no hay módulos nativos)
            driver = {
                getPrinters: () => [],
                getPrinter: (name) => ({ name, status: [] }),
                printDirect: (options) => {
                    const { spawnSync } = require('child_process');
                    try {
                        if (process.platform === 'darwin' || process.platform === 'linux') {
                            // MacOS / Linux: Usar comando lp
                            const result = spawnSync('lp', ['-d', options.printer, '-o', 'raw'], { input: options.data });
                            if (result.status === 0) options.success?.("ok");
                            else options.error?.(result.stderr.toString());
                        } 
                        else if (process.platform === 'win32') {
                            // Windows: Usar PowerShell para enviar datos RAW (Sin compartir impresora)
                            const base64Data = options.data.toString('base64');
                            const psCommand = `
                                $data = [System.Convert]::FromBase64String('${base64Data}');
                                $printer = '${options.printer}';
                                $code = @"
                                using System;
                                using System.Runtime.InteropServices;
                                public class RawPrint {
                                    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
                                    public class DOCINFOA {
                                        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
                                        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
                                        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
                                    }
                                    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
                                    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
                                    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
                                    public static extern bool ClosePrinter(IntPtr hPrinter);
                                    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
                                    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
                                    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
                                    public static extern bool EndDocPrinter(IntPtr hPrinter);
                                    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
                                    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
                                    public static void Send(string szPrinterName, byte[] pBytes) {
                                        IntPtr hPrinter = new IntPtr(0);
                                        DOCINFOA di = new DOCINFOA();
                                        di.pDocName = "JC-RT Print"; di.pDataType = "RAW";
                                        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                                            if (StartDocPrinter(hPrinter, 1, di)) {
                                                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length);
                                                Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
                                                Int32 dwWritten = 0;
                                                WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
                                                EndDocPrinter(hPrinter);
                                                Marshal.FreeCoTaskMem(pUnmanagedBytes);
                                            }
                                            ClosePrinter(hPrinter);
                                        }
                                    }
                                }
"@
                                Add-Type -TypeDefinition $code;
                                [RawPrint]::Send($printer, $data);
                            `;
                            const result = spawnSync('powershell', ['-Command', psCommand]);
                            if (result.status === 0) options.success?.("ok");
                            else options.error?.(result.stderr.toString());
                        }
                    } catch (err) {
                        options.error?.(err.message);
                    }
                }
            };
            console.log(`ℹ️ Driver Universal activado (${process.platform})`);
        }
    }

    try {
        return new ThermalPrinter({
            type: pConfig.tipo === 'epson' ? PrinterTypes.EPSON : PrinterTypes.STAR,
            interface: printerInterface,
            driver: driver,
            characterSet: 'PC850',
            removeSpecialCharacters: false,
            options: { timeout: 5000 }
        });
    } catch (error) {
        if (error.message.includes("No driver set") && !isNetwork) {
            throw new Error("No hay driver compatible para impresión USB. Verifica el nombre de la impresora.");
        }
        throw error;
    }
}

/**
 * BUCLE DE VIGILANCIA (POLLING)
 */
async function startPolling() {
    setInterval(async () => {
        if (!config.active || !config.userId || !config.token) return;

        console.log(`🔍 [${new Date().toLocaleTimeString()}] Buscando pedidos nuevos...`);
        
        try {
            const states = ['pendiente', 'preparando'];
            for (const estado of states) {
                const response = await fetch(`${API_BASE}/orders?userId=${config.userId}&estado=${estado}`, {
                    headers: { 'Authorization': `Bearer ${config.token}` }
                });
                const data = await response.json();

                if (data.success && data.data.length > 0) {
                    const toPrint = data.data.filter(o => !printedIds.includes(o._id));
                    
                    for (const order of toPrint) {
                        await imprimirPedido(order);
                        printedIds.push(order._id);
                    }

                    if (toPrint.length > 0) {
                        // Persistir IDs impresos
                        if (printedIds.length > 1000) printedIds = printedIds.slice(-500);
                        fs.writeFileSync(PRINTED_PATH, JSON.stringify(printedIds));
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error en polling:", error.message);
        }
    }, 5000);
}

async function imprimirPedido(order) {
    console.log(`🖨️ Imprimiendo Pedido: Mesa ${order.mesa}`);
    const printer = initPrinter(config.printer);
    
    try {
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println("JC-RT RESTAURANTE");
        printer.setTextSize(0, 0);
        printer.println("--------------------------------");
        printer.bold(true);
        printer.println(`COMANDA - MESA: ${order.mesa}`);
        printer.bold(false);
        printer.println(`Fecha: ${new Date(order.createdAt).toLocaleString()}`);
        printer.println("--------------------------------");
        
        printer.alignLeft();
        order.items.forEach(item => {
            const nombre = item.productoInfo ? item.productoInfo.nombre : (item.nombreProducto || 'Producto');
            printer.bold(true);
            printer.println(`${item.cantidad}x ${nombre}`);
            printer.bold(false);
            if (item.notas) printer.println(`  Nota: ${item.notas}`);
            printer.println(""); 
        });

        printer.println("--------------------------------");
        printer.cut();
        await printer.execute();
        return true;
    } catch (e) {
        console.error("❌ Error físico de impresora:", e.message);
        return false;
    }
}

/**
 * RUTAS DE CONFIGURACIÓN (Panel Local)
 */

// Página de Control Local
app.get('/', (req, res) => {
    res.send(`
    <html>
        <head>
            <title>JC-RT Print Bridge Control</title>
            <style>
                body { font-family: sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); width: 400px; }
                h2 { color: #1e293b; margin-top: 0; }
                .status { padding: 8px; border-radius: 6px; margin-bottom: 1rem; font-weight: bold; text-align: center; }
                .active { background: #dcfce7; color: #166534; }
                .inactive { background: #fee2e2; color: #991b1b; }
                textarea { width: 100%; height: 100px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; box-sizing: border-box; }
                button { width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 10px; font-weight: bold; }
                button:hover { background: #2563eb; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🛰️ JC-RT Print Bridge</h2>
                <div class="status ${config.active ? 'active' : 'inactive'}">
                    Estado: ${config.active ? 'VIGILANDO PEDIDOS' : 'PAUSADO / SIN VINCULAR'}
                </div>
                <p style="font-size: 13px; color: #64748b;">Pega aquí el código de vinculación de tu aplicación:</p>
                <textarea id="code" placeholder="Pega el código aquí..."></textarea>
                <button onclick="save()">Vincular y Activar</button>
                <div id="msg" style="margin-top: 10px; font-size: 12px; text-align: center;"></div>
            </div>
            <script>
                async function save() {
                    const code = document.getElementById('code').value;
                    const res = await fetch('/save-config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code })
                    });
                    const data = await res.json();
                    document.getElementById('msg').innerText = data.message;
                    if(data.success) setTimeout(() => location.reload(), 1500);
                }
            </script>
        </body>
    </html>
    `);
});

app.post('/save-config', (req, res) => {
    try {
        const rawCode = req.body.code.trim();
        const decodedStr = Buffer.from(rawCode, 'base64').toString('utf8');
        const decoded = JSON.parse(decodedStr);
        
        config.userId = decoded.userId;
        config.token = decoded.token;
        config.printer = decoded.printer;
        config.active = true;
        
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
        console.log("✅ Configuración guardada correctamente.");
        res.json({ success: true, message: "Vinculación exitosa. Iniciando vigilancia..." });
    } catch (e) {
        console.error("❌ Error al decodificar código:", e.message);
        res.status(400).json({ success: false, message: "Código inválido. Asegúrate de copiarlo completo y sin espacios extra." });
    }
});

// Endpoint para test rápido desde la web (si el usuario desbloquea el candado)
app.post('/test', async (req, res) => {
    // Implementación similar a la anterior para pruebas rápidas
    const printer = initPrinter(req.body);
    try {
        printer.println("Prueba de conexión JC-RT");
        printer.cut();
        await printer.execute();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 JC-RT Print Bridge en http://localhost:${PORT}`);
    startPolling();
});
