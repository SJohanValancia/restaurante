(function() {
    console.log("🛠️ JC-RT Print Monitor PRO (Independent Mode) inicializado.");

    // Estilos del Indicador
    const indicatorStyles = `
    #print-monitor-indicator {
        position: fixed;
        bottom: 10px;
        left: 10px;
        background: rgba(30, 41, 59, 0.9);
        color: white;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
        transition: all 0.3s;
        border: 1px solid rgba(255,255,255,0.1);
    }
    #print-monitor-indicator:hover { transform: translateY(-2px); background: #334155; }
    .status-dot-pro { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = indicatorStyles;
    document.head.appendChild(styleSheet);

    window.addEventListener('DOMContentLoaded', () => {
        const isPrintStation = localStorage.getItem('autoPrintComanda') === 'true';
        if (isPrintStation) {
            const indicator = document.createElement('div');
            indicator.id = 'print-monitor-indicator';
            indicator.innerHTML = '<div class="status-dot-pro"></div> Estación de Impresión PRO Activa';
            indicator.title = "La impresión es automática desde el Bridge local.";
            indicator.onclick = () => window.open('http://127.0.0.1:3001', '_blank');
            document.body.appendChild(indicator);
        }
    });

    // LA LÓGICA DE IMPRESIÓN AHORA VIVE EN EL SERVER.JS DEL BRIDGE (PC LOCAL)
    // ESTE SCRIPT YA NO CONSUME RECURSOS DE RED NI BATERÍA.
})();
