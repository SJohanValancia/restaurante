/* 
   RESTAURANT SWITCHER MODULE
   Handles quick switch between different sedes/locations.
   NOTE: Keyboard shortcut (Cmd/Ctrl+J+C) and shake detection 
   have been removed — that combo is now used for the Table View toggle.
   The switchRestaurant function remains available for programmatic use.
*/

(function () {
    const API_BASE = 'https://restaurante-co77.onrender.com/api/auth';
    let isFetching = false;

    // switchRestaurant stays available globally for any UI that needs it
    window.switchRestaurant = async function(targetUserId) {
        const token = localStorage.getItem('token');
        
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
                localStorage.setItem('token', result.token);
                localStorage.setItem('usuario', JSON.stringify(result.usuario));
                
                item.innerHTML = '✅ LISTO';
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            } else {
                alert('Error al cambiar: ' + result.message);
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            }
        } catch (error) {
            alert('Error de conexión');
            item.style.opacity = '1';
            item.style.pointerEvents = 'auto';
        }
    };
})();
