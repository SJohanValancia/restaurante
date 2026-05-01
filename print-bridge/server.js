const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(baseDir, 'config.json');
const PRINTED_PATH = path.join(baseDir, 'printed.json');
const API_BASE = 'https://restaurante-co77.onrender.com/api';

let config = {
    userId: '',
    token: '',
    imprimirClon: false,
    printer: {
        tipo: 'epson',
        conexion: 'sistema',
        interface: ''
    },
    active: false
};

// Cargar configuración
if (fs.existsSync(CONFIG_PATH)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
}

let printedIds = [];
if (fs.existsSync(PRINTED_PATH)) {
    try { printedIds = JSON.parse(fs.readFileSync(PRINTED_PATH, 'utf8')); } catch (e) {}
}

function initPrinter(pConfig) {
    const isNetwork = pConfig.conexion === 'red';
    const printerInterface = isNetwork ? `tcp://${pConfig.interface}` : `printer:${pConfig.interface}`;
    let driver = null;
    if (!isNetwork) {
        try { driver = require('printer'); } catch (e) {
            driver = {
                getPrinters: () => [],
                getPrinter: (name) => ({ name, status: [] }),
                printDirect: (options) => {
                    const { spawnSync } = require('child_process');
                    try {
                        if (process.platform === 'darwin' || process.platform === 'linux') {
                            const result = spawnSync('lp', ['-d', options.printer, '-o', 'raw'], { input: options.data });
                            if (result.status === 0) options.success?.("ok");
                            else options.error?.(result.stderr.toString());
                        } 
                        else if (process.platform === 'win32') {
                            const base64Data = options.data.toString('base64');
                            const psCommand = `
                                $data = [System.Convert]::FromBase64String('${base64Data}');
                                $printer = '${options.printer}';
                                $code = @"
                                using System;
                                using System.Runtime.InteropServices;
                                public class RawPrint {
                                    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
                                    public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
                                    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
                                    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
                                    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
                                    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
                                    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
                                    public static void Send(string szPrinterName, byte[] pBytes) {
                                        IntPtr hPrinter = new IntPtr(0); DOCINFOA di = new DOCINFOA(); di.pDocName = "JC-RT Print"; di.pDataType = "RAW";
                                        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
                                            if (StartDocPrinter(hPrinter, 1, di)) {
                                                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length); Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
                                                Int32 dwWritten = 0; WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
                                                EndDocPrinter(hPrinter); Marshal.FreeCoTaskMem(pUnmanagedBytes);
                                            }
                                            ClosePrinter(hPrinter);
                                        }
                                    }
                                }
"@
                                Add-Type -TypeDefinition $code; [RawPrint]::Send($printer, $data);
                            `;
                            const result = spawnSync('powershell', ['-Command', psCommand]);
                            if (result.status === 0) options.success?.("ok");
                            else options.error?.(result.stderr.toString());
                        }
                    } catch (err) { options.error?.(err.message); }
                }
            };
        }
    }
    return new ThermalPrinter({
        type: pConfig.tipo === 'epson' ? PrinterTypes.EPSON : PrinterTypes.STAR,
        interface: printerInterface,
        driver: driver,
        characterSet: 'PC437_USA',
        removeSpecialCharacters: false,
        options: { timeout: 5000 }
    });
}

async function startPolling() {
    setInterval(async () => {
        if (!config.active || !config.userId || !config.token) return;
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
                        if (config.imprimirClon) {
                            console.log("📄 Imprimiendo CLON...");
                            await imprimirPedido(order, true);
                        }
                        printedIds.push(order._id);
                    }
                    if (toPrint.length > 0) {
                        if (printedIds.length > 1000) printedIds = printedIds.slice(-500);
                        fs.writeFileSync(PRINTED_PATH, JSON.stringify(printedIds));
                    }
                }
            }
        } catch (error) { console.error("❌ Error en polling:", error.message); }
    }, 5000);
}

async function imprimirPedido(order, isClon = false) {
    const printer = initPrinter(config.printer);
    try {
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(isClon ? "--- CLON (COCINA) ---" : "JC-RT RESTAURANTE");
        printer.setTextSize(0, 0);
        printer.println("--------------------------------");
        printer.bold(true);
        printer.println(`COMANDA - MESA: ${order.mesa}`);
        printer.bold(false);
        printer.println(`Fecha: ${new Date().toLocaleString()}`);
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
    } catch (e) { console.error("❌ Error físico:", e.message); return false; }
}

// NUEVO ENDPOINT PARA FACTURAS (Arregla el problema de la "tinta")
app.post('/print-factura', async (req, res) => {
    const order = req.body;
    const printer = initPrinter(config.printer);
    try {
        printer.alignCenter();
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(order.restauranteNombre || "FACTURA DE VENTA");
        printer.setTextSize(0, 0);
        printer.bold(false);
        printer.println("--------------------------------");
        printer.println(`Fecha: ${new Date().toLocaleDateString()}`);
        printer.println(`Hora: ${new Date().toLocaleTimeString()}`);
        printer.println(`Mesa: ${order.mesa}`);
        printer.println(`Pedido: #${order._id.slice(-6).toUpperCase()}`);
        printer.println("--------------------------------");
        printer.tableCustom([
            { text: "Producto", align: "LEFT", width: 0.5, bold: true },
            { text: "Cant", align: "CENTER", width: 0.2, bold: true },
            { text: "Total", align: "RIGHT", width: 0.3, bold: true }
        ]);
        order.items.forEach(item => {
            const nombre = item.productoInfo ? item.productoInfo.nombre : (item.nombreProducto || 'Producto');
            printer.tableCustom([
                { text: nombre, align: "LEFT", width: 0.5 },
                { text: item.cantidad.toString(), align: "CENTER", width: 0.2 },
                { text: `$${(item.precio * item.cantidad).toLocaleString()}`, align: "RIGHT", width: 0.3 }
            ]);
        });
        printer.println("--------------------------------");
        printer.bold(true);
        printer.setTextSize(1, 1);
        printer.println(`TOTAL: $${order.total.toLocaleString()}`);
        printer.setTextSize(0, 0);
        printer.bold(false);
        printer.println("--------------------------------");
        printer.println("¡Gracias por su compra!");
        printer.println("Vuelva pronto");
        printer.cut();
        await printer.execute();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/', (req, res) => {
    res.send(`
    <html>
        <head>
            <title>JC-RT Print Bridge</title>
            <style>
                body { font-family: sans-serif; background: #0f172a; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 400px; border: 1px solid #334155; }
                .status { padding: 10px; border-radius: 6px; margin-bottom: 1rem; font-weight: bold; text-align: center; }
                .active { background: #064e3b; color: #34d399; }
                .inactive { background: #7f1d1d; color: #f87171; }
                textarea { width: 100%; height: 80px; background: #0f172a; color: #38bdf8; border: 1px solid #334155; border-radius: 6px; padding: 10px; box-sizing: border-box; font-family: monospace; font-size: 11px; }
                button { width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; margin-top: 10px; font-weight: bold; }
                #list { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; margin-bottom: 10px; max-height: 100px; overflow-y: auto; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2 style="margin-top:0">🛰️ Print Bridge</h2>
                <div class="status ${config.active ? 'active' : 'inactive'}">
                    ${config.active ? '🟢 VIGILANDO PEDIDOS' : '🔴 SIN VINCULAR'}
                </div>
                <div id="printers">
                    <p style="font-size:11px; color:#94a3b8; margin:0 0 5px 0">🖨️ Impresoras detectadas:</p>
                    <div id="list" style="font-size:10px; color:#38bdf8">Cargando...</div>
                </div>
                <textarea id="code" placeholder="Pega el código de vinculación aquí..."></textarea>
                <button onclick="save()">Vincular y Activar</button>
                <div id="msg" style="margin-top:10px; font-size:12px; text-align:center; color:#94a3b8"></div>
            </div>
            <script>
                async function load() {
                    const res = await fetch('/printers');
                    const data = await res.json();
                    document.getElementById('list').innerHTML = data.printers.map(p => '• '+p).join('<br>') || 'Ninguna';
                }
                load();
                async function save() {
                    const res = await fetch('/save-config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:document.getElementById('code').value}) });
                    const data = await res.json();
                    document.getElementById('msg').innerText = data.message;
                    if(data.success) setTimeout(()=>location.reload(), 1500);
                }
            </script>
        </body>
    </html>
    `);
});

app.get('/printers', async (req, res) => {
    const { execSync } = require('child_process');
    let printers = [];
    try {
        if (process.platform === 'darwin') printers = execSync('lpstat -e').toString().split('\n').filter(p => p.trim());
        else if (process.platform === 'win32') printers = execSync('powershell "Get-Printer | Select-Object -ExpandProperty Name"').toString().split('\r\n').map(p => p.trim()).filter(p => p);
        res.json({ success: true, printers });
    } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/save-config', (req, res) => {
    try {
        const decoded = JSON.parse(Buffer.from(req.body.code.trim(), 'base64').toString('utf8'));
        config.userId = decoded.userId; config.token = decoded.token; config.printer = decoded.printer;
        config.imprimirClon = decoded.imprimirClon || false;
        config.active = true;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
        res.json({ success: true, message: "Vinculación exitosa." });
    } catch (e) { res.status(400).json({ success: false, message: "Código inválido." }); }
});

app.listen(PORT, () => { console.log(`🚀 Bridge en http://localhost:${PORT}`); startPolling(); });
