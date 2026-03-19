const API_URL = 'https://restaurante-co77.onrender.com/api/auth';

async function verificarSesion() {
    const token = localStorage.getItem('token');
    const usuarioGuardado = localStorage.getItem('usuario');

    if (!token || !usuarioGuardado) {
        redireccionarLogin();
        return null;
    }

    try {
        const response = await fetch(`${API_URL}/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.usuario) {
            localStorage.setItem('usuario', JSON.stringify(data.usuario));
            return data.usuario;
        } else {
            cerrarSesion();
            return null;
        }
    } catch (error) {
        console.error('Error verificando sesión:', error);
        return null;
    }
}

function redireccionarLogin() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = 'index.html';
}

function cerrarSesion() {
    const token = localStorage.getItem('token');
    if (token) {
        fetch(`${API_URL}/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }).catch(() => {});
    }
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    redireccionarLogin();
}

function getUsuario() {
    const usuarioStr = localStorage.getItem('usuario');
    return usuarioStr ? JSON.parse(usuarioStr) : null;
}

function getToken() {
    return localStorage.getItem('token');
}

function getHeaders() {
    const token = getToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

async function fetchAPI(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
            ...getHeaders(),
            ...options.headers
        }
    });
    return response.json();
}
