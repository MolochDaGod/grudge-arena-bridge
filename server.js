require('dotenv').config();
const express = require('express');
const cors = require('cors');
const character = require('./lib/character');
const queue = require('./lib/queue');
const soap = require('./lib/mangos-soap');
const db = require('./lib/mangos-db');
const vnc = require('./lib/vnc-stream');

const path = require('path');

const app = express();
app.use(cors({
  origin: [
    'https://grudge-arena-frontend.pages.dev',
    'https://wow.grudge-studio.com',
    'http://localhost:3000',
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []),
  ],
  credentials: true,
}));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://js.puter.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com 'unsafe-inline'; " +
    "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api.puter.com wss:; " +
    "media-src 'self'; " +
    "frame-src https://puter.com;"
  );
  next();
});

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// AUTH — Grudge ID → MaNGOS account
// ──────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    // Accept puterUuid (from Puter SDK auth) or legacy grudgeId
    const grudgeId = req.body.puterUuid || req.body.grudgeId;
    if (!grudgeId) return res.status(400).json({ error: 'Authentication required' });

    const account = await character.loginOrCreate(grudgeId);

    // Track session
    if (req.body.puterToken) {
      activeSessions.set(account.accountId, {
        puterUuid: grudgeId,
        puterUsername: req.body.puterUsername || null,
        connectedAt: Date.now(),
      });
    }

    res.json(account);
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Active player sessions
const activeSessions = new Map();

// ──────────────────────────────────────────────
// CHARACTER — Create premade level 60
// ──────────────────────────────────────────────

// Get available race/class combos
app.get('/api/character/options', async (req, res) => {
  try {
    const combos = await db.getRaceClassCombos();
    res.json({
      races: character.RACE_NAMES,
      classes: character.CLASS_NAMES,
      factions: character.FACTION,
      combos: combos.map(c => ({ race: c.race, class: c.class })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get premade specs/gear for a class
app.get('/api/character/class/:classId', async (req, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const options = await character.getClassOptions(classId);
    res.json(options);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a character
app.post('/api/character/create', async (req, res) => {
  try {
    const { accountId, name, race, classId, specEntry, gearEntry } = req.body;
    if (!accountId || !name || !race || !classId) {
      return res.status(400).json({ error: 'accountId, name, race, classId required' });
    }

    const char = await character.createCharacter(
      accountId, name, parseInt(race), parseInt(classId),
      specEntry ? parseInt(specEntry) : null,
      gearEntry ? parseInt(gearEntry) : null
    );
    res.json(char);
  } catch (e) {
    console.error('Character create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// QUEUE — WSG 2v2 / 5v5 with bots
// ──────────────────────────────────────────────
app.post('/api/queue/join', async (req, res) => {
  try {
    const { accountId, mode } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    const match = await queue.queueMatch(accountId, mode || '2v2');
    res.json(match);
  } catch (e) {
    console.error('Queue error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/queue/status/:matchId', async (req, res) => {
  try {
    const status = await queue.getMatchStatus(req.params.matchId);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// RECORD — W/L history
// ──────────────────────────────────────────────
app.get('/api/record/:accountId', async (req, res) => {
  try {
    const record = await queue.getRecord(parseInt(req.params.accountId));
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// PLAY — Launch VNC WoW session
// ──────────────────────────────────────────────
app.post('/api/play/session', async (req, res) => {
  try {
    const { accountId, username } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId required' });

    // Create or reuse a VNC session for this player
    const session = await vnc.getOrCreateSession(accountId, username, req.body.password);

    res.json({
      wsUrl: session.wsUrl,
      status: session.status,
      isNew: session.isNew,
      username: username || 'arena',
    });
  } catch (e) {
    console.error('Play session error:', e);
    if (e.message.includes('VNC server is not running')) {
      return res.status(503).json({
        error: 'Game streaming is starting up — try again in a few minutes.',
        detail: 'VNC server is not available yet. Start TightVNC.',
      });
    }
    if (e.message.includes('Another player')) {
      return res.status(503).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

// Disconnect a game session
app.post('/api/play/disconnect', async (req, res) => {
  try {
    const { accountId } = req.body;
    const result = await vnc.destroySession(accountId);
    res.json({ disconnected: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get game session stats
app.get('/api/play/stats', async (req, res) => {
  res.json(vnc.getStats());
});

// ──────────────────────────────────────────────
// ADMIN — Server management
// ──────────────────────────────────────────────
app.post('/api/admin/soap', async (req, res) => {
  try {
    const { command } = req.body;
    const result = await soap.raw(command);
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/cleanup', async (req, res) => {
  const result = await queue.cleanup();
  res.json(result);
});

// ──────────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const dbOk = await Promise.race([
      db.realmd().query('SELECT 1').then(() => true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 5000)),
    ]);
    const soapOk = await soap.raw('server info').then(() => true).catch(() => false);
    res.json({
      status: 'ok',
      database: dbOk,
      soap: soapOk,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ status: 'error', database: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Grudge Arena Bridge running on port ${PORT}`);
  console.log(`  Auth:      POST /api/auth/login`);
  console.log(`  Character: POST /api/character/create`);
  console.log(`  Queue:     POST /api/queue/join`);
  console.log(`  Play:      POST /api/play/session`);
  console.log(`  Health:    GET  /api/health`);

  // Cleanup expired game sessions every 5 minutes
  setInterval(async () => {
    const result = await vnc.cleanupExpiredSessions();
    if (result.cleaned > 0) {
      console.log(`Cleaned up ${result.cleaned} expired game session(s)`);
    }
  }, 5 * 60 * 1000);

  // WebSocket proxy: forward /vnc to TightVNC via websockify
  const WebSocket = require('ws');
  const net = require('net');
  const vncHost = process.env.VNC_HOST || '127.0.0.1';
  const vncPort = parseInt(process.env.VNC_PORT || '5900');

  const vncWss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/vnc') return socket.destroy();

    vncWss.handleUpgrade(req, socket, head, (ws) => {
      // Open TCP connection to TightVNC
      const tcp = net.createConnection(vncPort, vncHost, () => {
        console.log('[websockify] VNC TCP connected');
      });

      // VNC server → browser (binary frames)
      tcp.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Browser → VNC server
      ws.on('message', (data) => {
        if (!tcp.destroyed) {
          tcp.write(Buffer.from(data));
        }
      });

      tcp.on('end', () => ws.close());
      tcp.on('error', (err) => {
        console.error('[websockify] VNC TCP error:', err.message);
        ws.close();
      });

      ws.on('close', () => {
        tcp.destroy();
        console.log('[websockify] Browser disconnected');
      });
      ws.on('error', () => tcp.destroy());
    });
  });
});
