/* 
   RESTAURANT SWITCHER MODULE
   Handles:
   1. Shake detection (Mobile)
   2. Win/Cmd + J + C Shortcut (Desktop)
   3. Quick switch between different sedes/locations
*/

(function () {
    const API_BASE = 'https://restaurante-co77.onrender.com/api/auth';
    let switcherModal = null;
    let isFetching = false;

    // --- STYLES ---
    const styles = `
        .rs-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 99999;
            display: flex;
            align-items: flex-end; /* Bottom sheet by default */
            justify-content: center;
            opacity: 0;
            visibility: hidden;
            transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
        }

        .rs-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        .rs-sheet {
            background: #ffffff;
            width: 100%;
            max-width: 500px;
            border-radius: 24px 24px 0 0;
            padding: 24px;
            transform: translateY(100%);
            transition: transform 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);
            box-shadow: 0 -10px 40px rgba(0,0,0,0.2);
        }

        @media (min-width: 768px) {
            .rs-overlay {
                align-items: center;
            }
            .rs-sheet {
                border-radius: 24px;
                transform: scale(0.9);
            }
            .rs-overlay.active .rs-sheet {
                transform: scale(1);
            }
        }

        .rs-overlay.active .rs-sheet {
            transform: translateY(0);
        }

        .rs-header {
            text-align: center;
            margin-bottom: 24px;
        }

        .rs-header h2 {
            margin: 0;
            font-size: 20px;
            color: #1a202c;
            font-weight: 800;
        }

        .rs-header p {
            margin: 4px 0 0;
            font-size: 14px;
            color: #718096;
        }

        .rs-list {
            display: grid;
            gap: 12px;
            max-height: 400px;
            overflow-y: auto;
            padding: 4px;
        }

        .rs-item {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px;
            background: #f7fafc;
            border-radius: 16px;
            cursor: pointer;
            transition: all 0.2s;
            border: 2px solid transparent;
        }

        .rs-item:hover {
            background: #edf2f7;
            border-color: #4299e1;
            transform: translateY(-2px);
        }

        .rs-item.active {
            background: #ebf8ff;
            border-color: #4299e1;
            cursor: default;
        }

        .rs-icon {
            font-size: 24px;
            width: 48px;
            height: 48px;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }

        .rs-info {
            flex: 1;
        }

        .rs-sede-name {
            font-weight: 700;
            color: #2d3748;
            font-size: 16px;
            display: block;
        }

        .rs-user-email {
            font-size: 12px;
            color: #a0aec0;
        }

        .rs-badge {
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 800;
            padding: 4px 8px;
            background: #e2e8f0;
            border-radius: 6px;
            color: #4a5568;
        }

        .rs-close {
            margin-top: 24px;
            width: 100%;
            padding: 14px;
            background: #f7fafc;
            border: none;
            border-radius: 12px;
            font-weight: 700;
            color: #718096;
            cursor: pointer;
        }
        
        /* Animation keyframes */
        @keyframes rs-spin {
            to { transform: rotate(360deg); }
        }
    `;

    // --- LOGIC ---

    function init() {
        // Inject styles
        const styleSheet = document.createElement("style");
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);

        // Listen for keys
        window.addEventListener('keydown', handleKeyCombination);

        // Listen for shake
        if (window.DeviceMotionEvent) {
            // Check if we need permission (iOS 13+)
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                // We'll need a user gesture to ask permission. 
                // We can't do it blindly. We'll ask when they click anywhere the first time.
                document.addEventListener('click', requestShakePermission, { once: true });
            } else {
                window.addEventListener('devicemotion', handleMotion);
            }
        }
    }

    function requestShakePermission() {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        window.addEventListener('devicemotion', handleMotion);
                    }
                })
                .catch(console.error);
        }
    }

    // Shake Detection
    let lastX, lastY, lastZ;
    let moveCounter = 0;
    function handleMotion(event) {
        const acc = event.accelerationIncludingGravity;
        if (!acc.x) return;

        const deltaX = Math.abs(lastX - acc.x);
        const deltaY = Math.abs(lastY - acc.y);
        const deltaZ = Math.abs(lastZ - acc.z);

        if (deltaX > 25 || deltaY > 25 || deltaZ > 25) {
            moveCounter++;
            if (moveCounter > 2) {
                openSwitcher();
                moveCounter = 0;
            }
        } else {
            // Slow down counter
            if (moveCounter > 0) moveCounter -= 0.1;
        }

        lastX = acc.x;
        lastY = acc.y;
        lastZ = acc.z;
    }

    // Keyboard Combination: Cmd/Win + J + C
    let keysPressed = {};
    function handleKeyCombination(e) {
        keysPressed[e.key.toLowerCase()] = true;
        
        const isMeta = e.metaKey || e.ctrlKey || keysPressed['meta'] || keysPressed['control'];
        
        if (isMeta && keysPressed['j'] && keysPressed['c']) {
            e.preventDefault();
            openSwitcher();
            keysPressed = {}; // Reset
        }
    }

    window.addEventListener('keyup', (e) => {
        delete keysPressed[e.key.toLowerCase()];
    });

    async function openSwitcher() {
        if (switcherModal && switcherModal.classList.contains('active')) return;
        
        if (!switcherModal) {
            createModal();
        }

        switcherModal.classList.add('active');
        loadSedes();
    }

    function createModal() {
        switcherModal = document.createElement('div');
        switcherModal.className = 'rs-overlay';
        switcherModal.innerHTML = `
            <div class="rs-sheet">
                <div class="rs-header">
                    <h2>Cambiar de Sede</h2>
                    <p>Sucursales detectadas de tu restaurante</p>
                </div>
                <div class="rs-list" id="rsList">
                    <div style="text-align:center; padding: 20px;">Cargando sedes...</div>
                </div>
                <button class="rs-close" onclick="document.querySelector('.rs-overlay').classList.remove('active')">Cerrar</button>
            </div>
        `;
        document.body.appendChild(switcherModal);

        // Close on overlay click
        switcherModal.addEventListener('click', (e) => {
            if (e.target === switcherModal) switcherModal.classList.remove('active');
        });
    }

    async function loadSedes() {
        if (isFetching) return;
        isFetching = true;

        const listContainer = document.getElementById('rsList');
        const token = localStorage.getItem('token');
        const currentUser = JSON.parse(localStorage.getItem('usuario') || '{}');

        try {
            const response = await fetch(`${API_BASE}/sedes-relacionadas`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();

            if (result.success) {
                const sedes = result.data;
                if (sedes.length === 0) {
                    listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: #718096;">No se encontraron sucursales vinculadas.</div>';
                } else {
                    listContainer.innerHTML = sedes.map(s => {
                        const isCurrent = s._id === currentUser.id || s._id === currentUser._id;
                        const sedeLabel = s.sede || 'Sede Principal';
                        
                        return `
                            <div class="rs-item ${isCurrent ? 'active' : ''}" 
                                 onclick="${isCurrent ? '' : `window.switchRestaurant('${s._id}')`}">
                                <div class="rs-icon">${isCurrent ? '📍' : '🏪'}</div>
                                <div class="rs-info">
                                    <span class="rs-sede-name">${sedeLabel} ${isCurrent ? '<span style="color: #4299e1; font-size: 10px; margin-left: 5px;">(ACTUAL)</span>' : ''}</span>
                                    <span class="rs-user-email">${s.email}</span>
                                </div>
                                <span class="rs-badge">${s.rol}</span>
                            </div>
                        `;
                    }).join('');
                }
            } else {
                listContainer.innerHTML = `<div style="color:red; text-align:center;">Error: ${result.message}</div>`;
            }
        } catch (error) {
            listContainer.innerHTML = `<div style="color:red; text-align:center;">Error de conexión</div>`;
        } finally {
            isFetching = false;
        }
    }

    window.switchRestaurant = async function(targetUserId) {
        const token = localStorage.getItem('token');
        
        // Show loading state
        const item = event.currentTarget;
        item.style.opacity = '0.5';
        item.style.pointerEvents = 'none';
        item.innerHTML = '<div style="margin: auto; width: 20px; height: 20px; border: 2px solid #4299e1; border-top-color: transparent; border-radius: 50%; animation: rs-spin 0.8s linear infinite;"></div>';

        try {
            const response = await fetch(`${API_BASE}/switch-account`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetUserId })
            });
            const result = await response.json();

            if (result.success) {
                // Guardar nueva sesión
                localStorage.setItem('token', result.token);
                localStorage.setItem('usuario', JSON.stringify(result.usuario));
                
                // Efecto de éxito y recarga
                item.innerHTML = '✅ LISTO';
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            } else {
                alert('Error al cambiar: ' + result.message);
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
                loadSedes(); // Re-render
            }
        } catch (error) {
            alert('Error de conexión');
            item.style.opacity = '1';
            item.style.pointerEvents = 'auto';
        }
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
