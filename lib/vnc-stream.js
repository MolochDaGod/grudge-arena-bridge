// ═══════════════════════════════════════════════
// VNC Stream Manager (replaces guacamole.js)
// Tracks the active VNC viewer session and
// launches WoW on the local desktop for the
// remote player.
// ═══════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const VNC_HOST = process.env.VNC_HOST || '127.0.0.1';
const VNC_PORT = parseInt(process.env.VNC_PORT || '5900');
const WOW_PATH = process.env.WOW_PATH || 'D:\\Vanilla bropack v23\\MaNGOS\\patches\\wow 1.7.1\\WoW.exe';
const WOW_LAUNCHER_PATH = process.env.WOW_LAUNCHER_PATH || path.join(__dirname, '..', 'wow-launcher.ps1');
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '1');

// Single active session tracker
let activeSession = null;
// { accountId, connectedAt, wowPid }

// ── VNC health check ─────────────────────────────
function isVncReady() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(2000);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(VNC_PORT, VNC_HOST);
  });
}

// ── Launch WoW on the VNC desktop ────────────────
function launchWoW(username, password) {
  return new Promise((resolve, reject) => {
    const args = [
      '-ExecutionPolicy', 'Bypass',
      '-File', WOW_LAUNCHER_PATH,
    ];
    if (username) args.push('-Username', username);
    if (password) args.push('-Password', password);
    args.push('-WoWPath', WOW_PATH);

    const child = spawn('powershell', args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false, // needs to be visible on the VNC desktop
    });

    child.unref();

    // Give it a moment to start
    setTimeout(() => {
      resolve({ pid: child.pid });
    }, 1000);

    child.on('error', (err) => {
      reject(new Error(`Failed to launch WoW: ${err.message}`));
    });
  });
}

// ── Session API (called by server.js) ────────────

/**
 * Get or create a play session.
 * Returns { wsUrl, status, isNew }
 */
async function getOrCreateSession(accountId, username, password) {
  // Check VNC server is alive
  const ready = await isVncReady();
  if (!ready) {
    throw new Error('VNC server is not running on port ' + VNC_PORT + '. Install and start TightVNC first.');
  }

  // Reuse existing session
  if (activeSession && activeSession.accountId === accountId) {
    return {
      wsUrl: buildWsUrl(),
      status: 'ready',
      isNew: false,
    };
  }

  // Check capacity (single player for local VNC)
  if (activeSession && activeSession.accountId !== accountId) {
    throw new Error('Another player is currently using the game stream. Only 1 browser session at a time on this machine.');
  }

  // Launch WoW for the remote player
  let wowPid = null;
  try {
    const result = await launchWoW(username, password);
    wowPid = result.pid;
  } catch (e) {
    console.error('WoW launch warning:', e.message);
    // Non-fatal — VNC still works, player just needs to launch WoW manually
  }

  activeSession = {
    accountId,
    connectedAt: Date.now(),
    wowPid,
  };

  return {
    wsUrl: buildWsUrl(),
    status: 'ready',
    isNew: true,
  };
}

function buildWsUrl() {
  const domain = process.env.DOMAIN || 'localhost';
  if (domain === 'localhost') {
    return `ws://localhost:${process.env.PORT || 3001}/vnc`;
  }
  return `wss://${domain}/vnc`;
}

/**
 * Disconnect the active session.
 */
async function destroySession(accountId) {
  if (!activeSession) return false;
  if (accountId && activeSession.accountId !== accountId) return false;

  // Try to kill the WoW process we launched
  if (activeSession.wowPid) {
    try {
      process.kill(activeSession.wowPid);
    } catch {
      // Already exited, that's fine
    }
  }

  activeSession = null;
  return true;
}

/**
 * Get current session stats.
 */
function getStats() {
  return {
    activeSessions: activeSession ? 1 : 0,
    maxSessions: MAX_SESSIONS,
    vncHost: VNC_HOST,
    vncPort: VNC_PORT,
    session: activeSession ? {
      accountId: activeSession.accountId,
      age: Math.floor((Date.now() - activeSession.connectedAt) / 1000),
      wowPid: activeSession.wowPid,
    } : null,
  };
}

/**
 * Clean up expired sessions (> 30 min with no activity).
 */
async function cleanupExpiredSessions() {
  if (!activeSession) return { cleaned: 0 };
  const age = Date.now() - activeSession.connectedAt;
  if (age > 30 * 60 * 1000) {
    await destroySession(activeSession.accountId);
    return { cleaned: 1 };
  }
  return { cleaned: 0 };
}

module.exports = {
  getOrCreateSession,
  destroySession,
  cleanupExpiredSessions,
  getStats,
  isVncReady,
};
