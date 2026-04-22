/**
 * JC-RT Global Print Monitor
 * Este script se encarga de vigilar pedidos nuevos y enviarlos a la impresora
 * si la computadora está configurada como una Estación de Impresión.
 * Funciona en cualquier página del sistema donde se incluya.
 */

(function() {
    console.log("🛠️ JC-RT Print Monitor inicializado.");

    // Configuración Base (Sync con el sistema actual)
    const API_URL_MONITOR = 'https://restaurante-co77.onrender.com/api';
    let monitorInterval = null;

    // 1. Inyectar Estilos de Impresión Térmica
    const printStyles = `
    @media print {
        #comandaPrintContainer,
        #comandaPrintContainer * {
            visibility: visible !important;
            display: block !important;
        }
        #comandaPrintContainer {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm;
            color: #000;
            background: #fff;
            padding: 5px;
            font-family: 'Courier New', Courier, monospace;
            z-index: 99999;
        }
        body > *:not(#comandaPrintContainer) {
            display: none !important;
        }
        .comanda-header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 5px; margin-bottom: 10px; }
        .comanda-header h1 { font-size: 18pt; margin: 5px 0; }
        .comanda-mesa { font-size: 24pt; font-weight: bold; text-align: center; margin: 10px 0; border: 2px solid #000; padding: 4px; }
        .comanda-body { font-size: 13pt; }
        .comanda-item { display: flex; flex-direction: column; margin-bottom: 10px; border-bottom: 1px dotted #ccc; padding-bottom: 4px; }
        .item-main { display: flex; justify-content: space-between; font-weight: bold; }
        .item-notes { font-size: 11pt; font-style: italic; margin-top: 3px; padding-left: 15px; }
        .comanda-footer { margin-top: 15px; text-align: center; font-size: 9pt; border-top: 1px dashed #000; padding-top: 8px; }
    }
    #comandaPrintContainer { display: none; }
    
    /* Indicador Visual del Monitor */
    #print-monitor-indicator {
        position: fixed;
        bottom: 10px;
        left: 10px;
        background: rgba(16, 185, 129, 0.9);
        color: white;
        padding: 5px 10px;
        border-radius: 20px;
        font-size: 10px;
        font-weight: 700;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 5px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 0.3s;
    }
    #print-monitor-indicator:hover { opacity: 1; }
    .status-dot { width: 6px; height: 6px; background: white; border-radius: 50%; animation: pulse-green 2s infinite; }
    @keyframes pulse-green { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = printStyles;
    document.head.appendChild(styleSheet);

    // 2. Crear Contenedores
    window.addEventListener('DOMContentLoaded', () => {
        const printContainer = document.createElement('div');
        printContainer.id = 'comandaPrintContainer';
        document.body.appendChild(printContainer);

        const isPrintStation = localStorage.getItem('autoPrintComanda') === 'true';
        if (isPrintStation) {
            const indicator = document.createElement('div');
            indicator.id = 'print-monitor-indicator';
            indicator.innerHTML = '<div class="status-dot"></div> Estación de Impresión COCINA';
            indicator.title = "Haz clic para ver guía de impresión";
            indicator.onclick = () => window.location.href = 'ajustes.html';
            document.body.appendChild(indicator);
            
            iniciarMonitoreo();
        }
    });

    function iniciarMonitoreo() {
        console.log("🛰️ Iniciando vigilancia de pedidos...");
        // Revisar cada 10 segundos (para no saturar el servidor, ya que pedidos.html hace cada 3)
        // Pero si es una página estática como Reportes, 10 segundos está bien.
        monitorInterval = setInterval(checkNewOrders, 5000);
    }

    async function checkNewOrders() {
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('usuario') || '{}');

        if (!token || !user._id) return;

        try {
            // Buscamos pedidos pendientes o preparando
            const response = await fetch(`${API_URL_MONITOR}/orders?userId=${user._id}&estado=pendiente`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
            });
            const data = await response.json();

            if (data.success && data.data.length > 0) {
                const newOrders = data.data;
                let printedIds = JSON.parse(localStorage.getItem('printedOrderIds') || '[]');
                const ordersToPrint = newOrders.filter(o => !printedIds.includes(o._id));

                if (ordersToPrint.length > 0) {
                    for (const order of ordersToPrint) {
                        ejecutarImpresion(order);
                        printedIds.push(order._id);
                    }
                    if (printedIds.length > 500) printedIds = printedIds.slice(-200);
                    localStorage.setItem('printedOrderIds', JSON.stringify(printedIds));
                }
            }
            
            // También revisar los que ya están en preparación
            const responsePrep = await fetch(`${API_URL_MONITOR}/orders?userId=${user._id}&estado=preparando`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
            });
            const dataPrep = await responsePrep.json();
            if (dataPrep.success && dataPrep.data.length > 0) {
                const preppingOrders = dataPrep.data;
                let printedIds = JSON.parse(localStorage.getItem('printedOrderIds') || '[]');
                const ordersToPrintPrep = preppingOrders.filter(o => !printedIds.includes(o._id));

                if (ordersToPrintPrep.length > 0) {
                    for (const order of ordersToPrintPrep) {
                        ejecutarImpresion(order);
                        printedIds.push(order._id);
                    }
                    if (printedIds.length > 500) printedIds = printedIds.slice(-200);
                    localStorage.setItem('printedOrderIds', JSON.stringify(printedIds));
                }
            }

        } catch (error) {
            console.error("❌ Error en monitor:", error);
        }
    }

    function ejecutarImpresion(order) {
        console.log(`🖨️ Imprimiendo comanda centralizada para: ${order.mesa}`);
        const printContainer = document.getElementById('comandaPrintContainer');
        const now = new Date();
        const fechaStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();

        let itemsHtml = order.items.map(item => {
            const nombre = item.productoInfo ? item.productoInfo.nombre : (item.nombreProducto || 'Producto');
            const nota = item.notas || "";
            return `
                <div class="comanda-item">
                    <div class="item-main">
                        <span>${item.cantidad}x ${nombre}</span>
                    </div>
                    ${nota ? `<div class="item-notes">📝 ${nota}</div>` : ''}
                </div>
            `;
        }).join('');

        printContainer.innerHTML = `
            <div class="comanda-header">
                <p>JC-RT Restaurante</p>
                <h1>COMANDA</h1>
                <p>${fechaStr}</p>
            </div>
            <div class="comanda-mesa">MESA: ${order.mesa}</div>
            <div class="comanda-body">${itemsHtml}</div>
            <div class="comanda-footer"><p>¡Buen provecho!</p></div>
        `;

        setTimeout(() => window.print(), 800);
    }
})();
