(function() {
    console.log("🛠️ JC-RT Print Monitor PRO inicializado.");

    const API_URL_MONITOR = 'https://restaurante-co77.onrender.com/api';
    const BRIDGE_URL = 'http://127.0.0.1:3001';
    let monitorInterval = null;

    // 1. Crear Indicador Visual del Monitor Pro
    const indicatorStyles = `
    #print-monitor-indicator {
        position: fixed;
        bottom: 10px;
        left: 10px;
        background: rgba(16, 185, 129, 0.9);
        color: white;
        padding: 5px 12px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        cursor: pointer;
        opacity: 0.8;
        transition: all 0.3s;
    }
    #print-monitor-indicator:hover { opacity: 1; transform: scale(1.05); }
    .status-dot { width: 8px; height: 8px; background: white; border-radius: 50%; animation: pulse-green 2s infinite; }
    @keyframes pulse-green { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } 100% { transform: scale(1); opacity: 1; } }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = indicatorStyles;
    document.head.appendChild(styleSheet);

    window.addEventListener('DOMContentLoaded', () => {
        const isPrintStation = localStorage.getItem('autoPrintComanda') === 'true';
        if (isPrintStation) {
            const indicator = document.createElement('div');
            indicator.id = 'print-monitor-indicator';
            indicator.innerHTML = '<div class="status-dot"></div> Estación de Impresión PRO';
            indicator.title = "Haz clic para configurar la impresora";
            indicator.onclick = () => window.location.href = 'ajustes.html';
            document.body.appendChild(indicator);
            
            iniciarMonitoreo();
        }
    });

    function iniciarMonitoreo() {
        console.log("🛰️ Vigilando pedidos nuevos (Modo PRO)...");
        monitorInterval = setInterval(checkNewOrders, 5000);
    }

    async function checkNewOrders() {
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('usuario') || '{}');

        if (!token || !user._id) return;

        try {
            const activationTimeStr = localStorage.getItem('printActivationTime');
            const activationTime = activationTimeStr ? new Date(activationTimeStr) : null;
            
            const estados = ['pendiente', 'preparando'];
            
            for (const estado of estados) {
                const response = await fetch(`${API_URL_MONITOR}/orders?userId=${user._id}&estado=${estado}`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
                });
                const data = await response.json();

                if (data.success && data.data.length > 0) {
                    let printedIds = JSON.parse(localStorage.getItem('printedOrderIds') || '[]');
                    const ordersToPrint = data.data.filter(o => {
                        const isNewId = !printedIds.includes(o._id);
                        const isAfterActivation = activationTime ? (new Date(o.createdAt) >= activationTime) : true;
                        return isNewId && isAfterActivation;
                    });

                    if (ordersToPrint.length > 0) {
                        for (const order of ordersToPrint) {
                            await enviarAlBridge(order);
                            printedIds.push(order._id);
                        }
                        if (printedIds.length > 500) printedIds = printedIds.slice(-200);
                        localStorage.setItem('printedOrderIds', JSON.stringify(printedIds));
                    }
                }
            }

        } catch (error) {
            console.error("❌ Error en monitor:", error);
        }
    }

    async function enviarAlBridge(order) {
        console.log(`🚀 Enviando pedido ${order.mesa} al Print Bridge local...`);
        
        const config = {
            tipo: localStorage.getItem('printerModel') || 'epson',
            conexion: localStorage.getItem('printerConnType') || 'sistema',
            interface: localStorage.getItem('printerConnType') === 'sistema' ? 
                       localStorage.getItem('printerInterfaceSistema') : 
                       localStorage.getItem('printerInterfaceRed')
        };

        try {
            const response = await fetch(`${BRIDGE_URL}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, order })
            });
            const resData = await response.json();
            if (!resData.success) throw new Error(resData.message);
            console.log("✅ Comanda impresa correctamente.");
        } catch (error) {
            console.error("❌ Fallo de conexión con el Print Bridge:", error);
            // Opcional: Mostrar una notificación sutil al usuario (Toast)
            if (typeof mostrarNotificacionError === 'function') {
                mostrarNotificacionError('Error: Print Bridge desconectado.');
            }
        }
    }
})();
