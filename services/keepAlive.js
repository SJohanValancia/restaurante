const https = require('https');
const http = require('http');

const RENDER_URLS = [
  'https://jv-nhzs.onrender.com',
  'https://mandao.onrender.com',
  'https://pipe-h8d4.onrender.com'
];

const PING_INTERVAL = 10 * 60 * 1000;
const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL = 60 * 1000;

const activeSessions = new Map();
let inactivityChecker = null;

function pingUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, { timeout: 10000 }, (res) => {
      console.log(`[KeepAlive] Ping a ${url}: Estado ${res.statusCode}`);
      resolve(res.statusCode);
    });

    req.on('error', (err) => {
      console.log(`[KeepAlive] Error ping a ${url}: ${err.message}`);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`[KeepAlive] Timeout ping a ${url}`);
      resolve(null);
    });
  });
}

async function wakeUpAll() {
  console.log('[KeepAlive] 🔔 Despertando todos los renders...');
  const promises = RENDER_URLS.map(url => pingUrl(url));
  await Promise.all(promises);
  console.log('[KeepAlive] ✅ Todos los renders despiertos');
}

async function pingAll() {
  console.log('[KeepAlive] 🔄 Manteniendo vivos los renders...');
  const promises = RENDER_URLS.map(url => pingUrl(url));
  await Promise.all(promises);
}

function checkInactivity() {
  const now = Date.now();
  const sessionsToEnd = [];

  for (const [userId, session] of activeSessions.entries()) {
    const inactiveTime = now - session.lastActivity;
    if (inactiveTime > INACTIVITY_TIMEOUT) {
      sessionsToEnd.push(userId);
    }
  }

  sessionsToEnd.forEach(userId => {
    console.log(`[KeepAlive] ⏰ Usuario ${userId} inactivo por ${INACTIVITY_TIMEOUT / 60000} minutos. Cerrando sesión.`);
    endSession(userId);
  });
}

function startInactivityChecker() {
  if (inactivityChecker) return;
  inactivityChecker = setInterval(checkInactivity, INACTIVITY_CHECK_INTERVAL);
}

function stopInactivityChecker() {
  if (inactivityChecker) {
    clearInterval(inactivityChecker);
    inactivityChecker = null;
  }
}

function startSession(userId) {
  startInactivityChecker();

  if (activeSessions.has(userId)) {
    activeSessions.get(userId).lastActivity = Date.now();
    return;
  }

  console.log(`[KeepAlive] 🚀 Iniciando sesión de keep-alive para usuario ${userId}`);

  wakeUpAll();

  const intervalId = setInterval(() => {
    pingAll();
  }, PING_INTERVAL);

  activeSessions.set(userId, { intervalId, lastActivity: Date.now() });
}

function endSession(userId) {
  const session = activeSessions.get(userId);
  if (session) {
    console.log(`[KeepAlive] 🛑 Deteniendo sesión de keep-alive para usuario ${userId}`);
    clearInterval(session.intervalId);
    activeSessions.delete(userId);
  }

  if (activeSessions.size === 0) {
    stopInactivityChecker();
  }
}

function updateActivity(userId) {
  const session = activeSessions.get(userId);
  if (session) {
    session.lastActivity = Date.now();
    console.log(`[KeepAlive] ✅ Actividad registrada para usuario ${userId}`);
  }
}

function getActiveSessionCount() {
  return activeSessions.size;
}

module.exports = {
  startSession,
  endSession,
  updateActivity,
  wakeUpAll,
  pingAll,
  getActiveSessionCount
};
