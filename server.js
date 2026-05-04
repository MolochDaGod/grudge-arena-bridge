require('dotenv').config();
const express = require('express');
const cors = require('cors');
const character = require('./lib/character');
const queue = require('./lib/queue');
const soap = require('./lib/mangos-soap');
const db = require('./lib/mangos-db');

const path = require('path');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// AUTH — Grudge ID → MaNGOS account
// ──────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { grudgeId } = req.body;
    if (!grudgeId) return res.status(400).json({ error: 'grudgeId required' });

    const account = await character.loginOrCreate(grudgeId);
    res.json(account);
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: e.message });
  }
});

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
// PLAY — Launch Guacamole WoW session
// ──────────────────────────────────────────────
app.post('/api/play/session', async (req, res) => {
  try {
    const { accountId, username, password } = req.body;

    // Generate a Guacamole connection URL for this player
    // The Guacamole server runs the WoW client with their credentials
    const guacHost = process.env.GUAC_HOST || 'localhost';
    const guacPort = process.env.GUAC_PORT || '8080';

    // Connection params — Guacamole will RDP/VNC into a session running WoW
    const sessionUrl = `http://${guacHost}:${guacPort}/guacamole/#/client/` +
      Buffer.from(`arena-${accountId}\0c\0default`).toString('base64');

    res.json({
      sessionUrl,
      instructions: {
        step1: 'Click the session URL to open WoW in your browser',
        step2: `Login: ${username} / (your password)`,
        step3: 'Your level 60 character is ready on GM Island',
        step4: 'Talk to Premade NPCs for gear, then queue WSG',
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    const [rows] = await db.realmd().query('SELECT 1');
    const soapOk = await soap.raw('server info').then(() => true).catch(() => false);
    res.json({
      status: 'ok',
      database: true,
      soap: soapOk,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ status: 'error', database: false, error: e.message });
  }
});

// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Grudge Arena Bridge running on port ${PORT}`);
  console.log(`  Auth:      POST /api/auth/login`);
  console.log(`  Character: POST /api/character/create`);
  console.log(`  Queue:     POST /api/queue/join`);
  console.log(`  Play:      POST /api/play/session`);
  console.log(`  Health:    GET  /api/health`);
});
