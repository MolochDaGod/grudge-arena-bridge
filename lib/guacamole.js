const http = require('http');
const https = require('https');

const GUAC_URL = process.env.GUAC_URL || `http://${process.env.GUAC_HOST || 'localhost'}:${process.env.GUAC_PORT || '8080'}/guacamole`;
const GUAC_ADMIN_USER = process.env.GUAC_ADMIN_USER || 'guacadmin';
const GUAC_ADMIN_PASS = process.env.GUAC_ADMIN_PASS || 'guacadmin';
const RDP_HOST = process.env.RDP_HOST || 'host.docker.internal';
const RDP_USER = process.env.RDP_USER || 'arena';
const RDP_PASS = process.env.RDP_PASS || 'arena';
const WOW_PATH = process.env.WOW_PATH || 'C:\\WoW\\WoW.exe';
const WOW_LAUNCHER_PATH = process.env.WOW_LAUNCHER_PATH || 'C:\\WoW\\wow-launcher.ps1';

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5');
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Active game sessions: accountId -> { connectionId, guacToken, createdAt }
const gameSessions = new Map();

// ── HTTP helper ──────────────────────────────────
function guacFetch(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, GUAC_URL);
    if (token) url.searchParams.set('token', token);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Auth ──────────────────────────────────────────
async function getAdminToken() {
  const body = `username=${encodeURIComponent(GUAC_ADMIN_USER)}&password=${encodeURIComponent(GUAC_ADMIN_PASS)}`;
  const url = new URL('/guacamole/api/tokens', GUAC_URL);

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.authToken);
        } catch (e) {
          reject(new Error(`Guacamole auth failed: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Connection Management ────────────────────────
async function createConnection(accountId, mangosUsername, mangosPassword) {
  const token = await getAdminToken();

  // Build the initial-program command that launches WoW with auto-login
  const launcherCmd = mangosUsername && mangosPassword
    ? `powershell -ExecutionPolicy Bypass -File "${WOW_LAUNCHER_PATH}" -Username "${mangosUsername}" -Password "${mangosPassword}" -WoWPath "${WOW_PATH}"`
    : WOW_PATH;

  // Create an RDP connection for this player (unique name per attempt)
  const connData = {
    parentIdentifier: 'ROOT',
    name: `arena-${accountId}-${Date.now()}`,
    protocol: 'rdp',
    parameters: {
      hostname: RDP_HOST,
      port: '3389',
      username: RDP_USER,
      password: RDP_PASS,
      security: 'any',
      'ignore-cert': 'true',
      'disable-auth': 'false',
      width: '1280',
      height: '720',
      'color-depth': '24',
      'resize-method': 'display-update',
      'enable-wallpaper': 'false',
      'enable-theming': 'false',
      'enable-font-smoothing': 'false',
      'enable-full-window-drag': 'false',
      'enable-desktop-composition': 'false',
      'enable-menu-animations': 'false',
      'disable-audio': 'false',
      'initial-program': launcherCmd,
    },
    attributes: {
      'max-connections': '1',
      'max-connections-per-user': '1',
    },
  };

  const res = await guacFetch(
    'POST',
    '/guacamole/api/session/data/mysql/connections',
    connData,
    token
  );

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Failed to create Guacamole connection: ${JSON.stringify(res.data)}`);
  }

  const connectionId = res.data.identifier;

  return { connectionId, guacToken: token };
}

async function deleteConnection(connectionId) {
  try {
    const token = await getAdminToken();
    await guacFetch(
      'DELETE',
      `/guacamole/api/session/data/mysql/connections/${connectionId}`,
      null,
      token
    );
  } catch (e) {
    console.error(`Failed to delete Guacamole connection ${connectionId}:`, e.message);
  }
}

// ── Session API (called by server.js) ────────────

/**
 * Get or create a game session for a player.
 * Returns { connectionId, guacToken, wsUrl, isNew }
 */
async function getOrCreateSession(accountId, mangosUsername, mangosPassword) {
  // Check existing session
  const existing = gameSessions.get(accountId);
  if (existing && (Date.now() - existing.createdAt) < SESSION_TIMEOUT_MS) {
    return {
      connectionId: existing.connectionId,
      guacToken: existing.guacToken,
      wsUrl: buildWsUrl(existing.connectionId, existing.guacToken),
      isNew: false,
    };
  }

  // Clean up expired session if any
  if (existing) {
    await deleteConnection(existing.connectionId);
    gameSessions.delete(accountId);
  }

  // Check capacity
  if (gameSessions.size >= MAX_SESSIONS) {
    throw new Error(`Server full — max ${MAX_SESSIONS} concurrent players. Try again shortly.`);
  }

  // Create new session
  const { connectionId, guacToken } = await createConnection(accountId, mangosUsername, mangosPassword);

  gameSessions.set(accountId, {
    connectionId,
    guacToken,
    createdAt: Date.now(),
  });

  return {
    connectionId,
    guacToken,
    wsUrl: buildWsUrl(connectionId, guacToken),
    isNew: true,
  };
}

function buildWsUrl(connectionId, token) {
  // If GUAC_WS_URL is set (e.g. Cloudflare Tunnel), use it directly
  if (process.env.GUAC_WS_URL) {
    return `${process.env.GUAC_WS_URL}/guacamole/websocket-tunnel?token=${token}&GUAC_DATA_SOURCE=mysql&GUAC_ID=${connectionId}&GUAC_TYPE=c&GUAC_WIDTH=1280&GUAC_HEIGHT=720&GUAC_DPI=96`;
  }
  const domain = process.env.DOMAIN || 'localhost';
  const proto = domain === 'localhost' ? 'ws' : 'wss';
  return `${proto}://${domain}/guacamole/websocket-tunnel?token=${token}&GUAC_DATA_SOURCE=mysql&GUAC_ID=${connectionId}&GUAC_TYPE=c&GUAC_WIDTH=1280&GUAC_HEIGHT=720&GUAC_DPI=96`;
}

/**
 * Disconnect a player's session and clean up the Guacamole connection.
 */
async function destroySession(accountId) {
  const session = gameSessions.get(accountId);
  if (!session) return false;

  await deleteConnection(session.connectionId);
  gameSessions.delete(accountId);
  return true;
}

/**
 * Clean up all expired sessions. Call this on a timer.
 */
async function cleanupExpiredSessions() {
  const now = Date.now();
  const expired = [];

  for (const [accountId, session] of gameSessions) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS) {
      expired.push(accountId);
    }
  }

  for (const accountId of expired) {
    await destroySession(accountId);
  }

  return { cleaned: expired.length };
}

/**
 * Get current session stats.
 */
function getStats() {
  return {
    activeSessions: gameSessions.size,
    maxSessions: MAX_SESSIONS,
    sessions: Array.from(gameSessions.entries()).map(([id, s]) => ({
      accountId: id,
      connectionId: s.connectionId,
      age: Math.floor((Date.now() - s.createdAt) / 1000),
    })),
  };
}

module.exports = {
  getOrCreateSession,
  destroySession,
  cleanupExpiredSessions,
  getStats,
};
