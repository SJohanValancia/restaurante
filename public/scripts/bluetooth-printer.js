/**
 * JC-RT Bluetooth Printer Module
 * Módulo compartido para impresión Bluetooth directa a impresoras térmicas ESC/POS.
 * Extraído y refactorizado desde bridge-android.html.
 * 
 * Uso:
 *   await BluetoothPrinter.connect();
 *   await BluetoothPrinter.printComanda(orderData);
 *   BluetoothPrinter.isConnected();
 *   BluetoothPrinter.disconnect();
 */

(function() {
    'use strict';

    // ============================================================
    //  STATE
    // ============================================================
    let bluetoothDevice = null;
    let bluetoothCharacteristic = null;
    const STORAGE_KEY = 'jcrt-bt-printer';

    // ============================================================
    //  ESC/POS CONSTANTS
    // ============================================================
    const ESC_INIT       = new Uint8Array([0x1B, 0x40]);
    const ESC_CENTER     = new Uint8Array([0x1B, 0x61, 0x01]);
    const ESC_LEFT       = new Uint8Array([0x1B, 0x61, 0x00]);
    const ESC_BOLD_ON    = new Uint8Array([0x1B, 0x45, 0x01]);
    const ESC_BOLD_OFF   = new Uint8Array([0x1B, 0x45, 0x00]);
    const ESC_DOUBLE_ON  = new Uint8Array([0x1D, 0x21, 0x11]);
    const ESC_DOUBLE_OFF = new Uint8Array([0x1D, 0x21, 0x00]);
    const ESC_FEED_12    = new Uint8Array([0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A]);
    const ESC_CUT        = new Uint8Array([0x1D, 0x56, 0x00]);
    const NL             = new Uint8Array([0x0A]);
    const NL2            = new Uint8Array([0x0A, 0x0A]);

    // ============================================================
    //  HELPERS
    // ============================================================
    function buildEscPosBytes(parts) {
        const encoder = new TextEncoder();
        const arrays = parts.map(p => typeof p === 'string' ? encoder.encode(p) : p);
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        arrays.forEach(a => { result.set(a, offset); offset += a.length; });
        return result;
    }

    // ============================================================
    //  BLUETOOTH SERVICE UUIDs
    // ============================================================
    const SERVICE_UUIDS = [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000fee7-0000-1000-8000-00805f9b34fb',
        '00001101-0000-1000-8000-00805f9b34fb',
    ];

    // ============================================================
    //  CONNECT
    // ============================================================
    async function connect() {
        try {
            bluetoothDevice = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
                    { services: ['0000fee7-0000-1000-8000-00805f9b34fb'] },
                    { namePrefix: 'POS' },
                    { namePrefix: 'TP' },
                    { namePrefix: 'BT' },
                    { namePrefix: ' printer' },
                    { namePrefix: 'MTP' },
                    { namePrefix: 'Xprinter' },
                    { namePrefix: 'EPSON' },
                ],
                optionalServices: SERVICE_UUIDS
            });

            bluetoothDevice.addEventListener('gattserverdisconnected', () => {
                console.log('[BT-Printer] Impresora desconectada');
                bluetoothCharacteristic = null;
                _dispatchEvent('disconnected');
            });

            const server = await bluetoothDevice.gatt.connect();

            let service = null;
            for (const uuid of SERVICE_UUIDS) {
                try {
                    service = await server.getPrimaryService(uuid);
                    if (service) break;
                } catch (e) {}
            }

            if (!service) {
                throw new Error('Servicio de impresión no encontrado en el dispositivo');
            }

            const chars = await service.getCharacteristics();
            bluetoothCharacteristic = null;

            for (const char of chars) {
                const props = char.properties;
                if (props.write || props.writeWithoutResponse) {
                    bluetoothCharacteristic = char;
                    break;
                }
            }

            if (!bluetoothCharacteristic) {
                throw new Error('Característica de escritura no encontrada');
            }

            // Persistir nombre para reconexión y UI
            const name = bluetoothDevice.name || 'Impresora BT';
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: name, connected: true }));

            console.log(`[BT-Printer] ✅ Conectada: ${name}`);
            _dispatchEvent('connected', { name: name });

            return { success: true, name: name };

        } catch (error) {
            if (error.name === 'NotFoundError') {
                console.log('[BT-Printer] Búsqueda cancelada por el usuario');
                return { success: false, cancelled: true };
            }
            console.error('[BT-Printer] Error:', error.message);
            bluetoothDevice = null;
            bluetoothCharacteristic = null;
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    //  AUTO-RECONNECT
    // ============================================================
    async function tryAutoReconnect() {
        if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return false;

        const saved = _getSavedPrinter();
        if (!saved || !saved.name) return false;

        try {
            const devices = await navigator.bluetooth.getDevices();
            const lastDevice = devices.find(d => d.name === saved.name);

            if (!lastDevice || !lastDevice.gatt) return false;

            console.log(`[BT-Printer] Reconectando a ${lastDevice.name}...`);
            bluetoothDevice = lastDevice;

            bluetoothDevice.addEventListener('gattserverdisconnected', () => {
                console.log('[BT-Printer] Impresora desconectada');
                bluetoothCharacteristic = null;
                _dispatchEvent('disconnected');
            });

            const server = await lastDevice.gatt.connect();

            let service = null;
            for (const uuid of SERVICE_UUIDS) {
                try { service = await server.getPrimaryService(uuid); if (service) break; } catch (e) {}
            }

            if (service) {
                const chars = await service.getCharacteristics();
                for (const char of chars) {
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        bluetoothCharacteristic = char;
                        break;
                    }
                }
            }

            if (bluetoothCharacteristic) {
                console.log(`[BT-Printer] ✅ Reconectada: ${lastDevice.name}`);
                _dispatchEvent('connected', { name: lastDevice.name });
                return true;
            }
        } catch (e) {
            console.log('[BT-Printer] Auto-reconexión fallida:', e.message);
        }

        return false;
    }

    // ============================================================
    //  DISCONNECT
    // ============================================================
    function disconnect() {
        try {
            if (bluetoothDevice && bluetoothDevice.gatt.connected) {
                bluetoothDevice.gatt.disconnect();
            }
        } catch (e) {}

        bluetoothDevice = null;
        bluetoothCharacteristic = null;
        localStorage.removeItem(STORAGE_KEY);
        _dispatchEvent('disconnected');
    }

    // ============================================================
    //  SEND DATA
    // ============================================================
    async function _sendData(data) {
        if (!bluetoothCharacteristic) throw new Error('No hay impresora Bluetooth conectada');

        // Chunk pequeño (128 bytes) + pausa larga (100ms) para evitar
        // desbordamiento del buffer Bluetooth de la impresora térmica.
        // Con 512/10ms solo se imprimía el primer plato porque el buffer
        // se saturaba y se perdían los bytes intermedios.
        const CHUNK_SIZE = 128;
        const DELAY_MS = 100;
        const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
        console.log(`[BT-Printer] Enviando ${data.length} bytes en ${totalChunks} chunks de ${CHUNK_SIZE}...`);

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, i + CHUNK_SIZE);
            const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
            try {
                await bluetoothCharacteristic.writeValueWithoutResponse(chunk);
            } catch (e) {
                try {
                    await bluetoothCharacteristic.writeValueWithResponse(chunk);
                } catch (e2) {
                    console.error(`[BT-Printer] Error en chunk ${chunkNum}/${totalChunks}: ${e2.message}`);
                    throw new Error(`Error enviando datos (chunk ${chunkNum}): ${e2.message}`);
                }
            }
            // Pausa obligatoria entre cada chunk para que la impresora procese
            if (i + CHUNK_SIZE < data.length) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }
        }
        console.log(`[BT-Printer] ✅ ${data.length} bytes enviados completos (${totalChunks} chunks)`);
    }

    // ============================================================
    //  GENERATE COMANDA BYTES
    // ============================================================
    function _generateComandaBytes(order) {
        const W = 32; // 32 chars = 58mm

        function sep(c) { return c.repeat(W); }
        function wrapText(text, maxW) {
            const words = String(text).split(' ');
            const lines = [];
            let current = '';
            let iterations = 0;
            words.forEach(word => {
                if (iterations++ > 1000) return; // Safety limit
                if ((current + (current ? ' ' : '') + word).length <= maxW) {
                    current += (current ? ' ' : '') + word;
                } else {
                    if (current) lines.push(current);
                    while (word.length > maxW) {
                        lines.push(word.slice(0, maxW));
                        word = word.slice(maxW);
                    }
                    current = word;
                }
            });
            if (current) lines.push(current);
            return lines;
        }

        const enc = new TextEncoder();
        const parts = [];
        const add = (str) => { parts.push(enc.encode(str)); };
        const addRaw = (bytes) => { parts.push(bytes); };
        const nl = () => addRaw(NL);
        const nl2 = () => addRaw(NL2);

        // DEBUG: Log items received
        console.log('[BT-Printer] Items received:', JSON.stringify(order.items));
        console.log('[BT-Printer] Items count:', order.items ? order.items.length : 0);

        // Init
        addRaw(ESC_INIT);

        // Encabezado
        addRaw(ESC_CENTER);
        addRaw(ESC_BOLD_ON);
        addRaw(ESC_DOUBLE_ON);
        add('JC-RT RESTAURANTE');
        nl();
        addRaw(ESC_DOUBLE_OFF);
        addRaw(ESC_BOLD_OFF);
        add(sep('-'));
        nl();

        // Mesa y fecha
        addRaw(ESC_LEFT);
        addRaw(ESC_BOLD_ON);
        add(`COMANDA - MESA: ${order.mesa}`);
        nl();
        addRaw(ESC_BOLD_OFF);

        if (order.meseroNombre) {
            add(`Mesero: ${order.meseroNombre}`);
            nl();
        }

        add(`Fecha: ${new Date().toLocaleString('es-CO')}`);
        nl();
        add(sep('-'));
        nl();

        // Ítems
        addRaw(ESC_LEFT);

        if (!order.items || order.items.length === 0) {
            add('(Sin productos)');
            nl();
        } else {
            for (let idx = 0; idx < order.items.length; idx++) {
                const item = order.items[idx];
                try {
                    console.log(`[BT-Printer] Raw item ${idx}:`, JSON.stringify(item));
                    
                    const nombre = item.productoInfo
                        ? item.productoInfo.nombre
                        : (item.nombreProducto || item.nombre || 'Producto');
                    const cantidad = item.cantidad || 1;

                    console.log(`[BT-Printer] Processing item ${idx}:`, nombre, 'cantidad:', cantidad);

                    addRaw(ESC_BOLD_ON);
                    const linNombre = `${cantidad}x ${nombre}`;
                    const nombreWrapped = wrapText(linNombre, W);
                    console.log(`[BT-Printer] Wrapped lines for item ${idx}:`, nombreWrapped);
                    nombreWrapped.forEach(l => { add(l); nl(); });
                    addRaw(ESC_BOLD_OFF);

                    // Notas del ítem
                    const nota = item.notas || item.nota || '';
                    if (nota && nota.trim()) {
                        const notaLines = wrapText(`  >> ${nota.trim()}`, W);
                        notaLines.forEach(l => { add(l); nl(); });
                    }

                    if (idx < order.items.length - 1) {
                        add(sep('.'));
                        nl();
                    }
                } catch (itemError) {
                    console.error(`[BT-Printer] Error processing item ${idx}:`, itemError);
                }
            }
            console.log('[BT-Printer] Loop completed, total items processed:', order.items.length);
        }
        nl();

        // Nota general del pedido
        if (order.notas && order.notas.trim()) {
            add(sep('-'));
            nl();
            addRaw(ESC_BOLD_ON);
            add('NOTA DEL PEDIDO:');
            nl();
            addRaw(ESC_BOLD_OFF);
            const pedidoNotaLines = wrapText(order.notas.trim(), W);
            pedidoNotaLines.forEach(l => { add(l); nl(); });
        }

        // Footer
        add(sep('='));
        nl();
        addRaw(ESC_CENTER);

        let footerText = '-- COMANDA --';
        if (order.meseroNombre && order.meseroNombre.trim() !== '') {
            footerText = `-- ${order.meseroNombre.toUpperCase()} --`;
        }
        add(footerText);
        nl2();

        // Avance y corte
        addRaw(ESC_FEED_12);
        addRaw(ESC_CUT);

        const finalBytes = buildEscPosBytes(parts);
        console.log(`[BT-Printer] Total bytes generados: ${finalBytes.length}`);
        return finalBytes;
    }

    // ============================================================
    //  PRINT COMANDA
    // ============================================================
    async function printComanda(orderData) {
        if (!bluetoothCharacteristic) {
            throw new Error('Impresora Bluetooth no conectada');
        }

        try {
            const bytes = _generateComandaBytes(orderData);
            await _sendData(bytes);
            console.log(`[BT-Printer] ✅ Comanda impresa: Mesa ${orderData.mesa}`);
            return true;
        } catch (e) {
            console.error('[BT-Printer] Error in printComanda:', e);
            throw e;
        }
    }

    // ============================================================
    //  STATUS
    // ============================================================
    function isConnected() {
        return !!bluetoothCharacteristic;
    }

    function getPrinterName() {
        if (bluetoothDevice && bluetoothDevice.name) return bluetoothDevice.name;
        const saved = _getSavedPrinter();
        return saved ? saved.name : null;
    }

    function isSupported() {
        return !!navigator.bluetooth;
    }

    // ============================================================
    //  INTERNAL HELPERS
    // ============================================================
    function _getSavedPrinter() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) { return null; }
    }

    function _dispatchEvent(type, detail) {
        window.dispatchEvent(new CustomEvent('bt-printer-' + type, { detail: detail || {} }));
    }

    // ============================================================
    //  PUBLIC API
    // ============================================================
    window.BluetoothPrinter = {
        connect: connect,
        disconnect: disconnect,
        tryAutoReconnect: tryAutoReconnect,
        printComanda: printComanda,
        isConnected: isConnected,
        isSupported: isSupported,
        getPrinterName: getPrinterName
    };

})();
