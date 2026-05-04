const soap = require('./mangos-soap');
const db = require('./mangos-db');

// Active matches tracked in memory
const activeMatches = new Map();

// Queue for a 2v2 or 5v5 WSG match
async function queueMatch(accountId, mode = '2v2') {
  const botsPerSide = mode === '5v5' ? 5 : mode === '3v3' ? 3 : 2;

  // Spawn bots for both sides
  // Player is on one side, bots fill the rest + all of enemy team
  const playerFaction = await getPlayerFaction(accountId);
  const enemyFaction = playerFaction === 'Alliance' ? 'horde' : 'alliance';

  const botPromises = [];

  // Fill player's team (botsPerSide - 1 allies)
  for (let i = 0; i < botsPerSide - 1; i++) {
    botPromises.push(soap.addBattleBot(playerFaction.toLowerCase()));
  }

  // Fill enemy team (botsPerSide enemies)
  for (let i = 0; i < botsPerSide; i++) {
    botPromises.push(soap.addBattleBot(enemyFaction));
  }

  const results = await Promise.allSettled(botPromises);
  const added = results.filter(r => r.status === 'fulfilled').length;

  // Track the match
  const matchId = Date.now().toString(36);
  activeMatches.set(matchId, {
    accountId,
    mode,
    startTime: Date.now(),
    botsAdded: added,
    status: 'queued',
  });

  return {
    matchId,
    mode,
    botsAdded: added,
    message: `Queued ${mode} WSG — ${added} bots spawned. Queue WSG in-game to enter.`,
  };
}

// Get the faction of the player's first character
async function getPlayerFaction(accountId) {
  const [rows] = await db.characters().query(
    'SELECT race FROM characters WHERE account = ? LIMIT 1',
    [accountId]
  );
  if (!rows.length) return 'Alliance';
  const allianceRaces = [1, 3, 4, 7]; // Human, Dwarf, NE, Gnome
  return allianceRaces.includes(rows[0].race) ? 'Alliance' : 'Horde';
}

// Check match status by reading BG log
async function getMatchStatus(matchId) {
  const match = activeMatches.get(matchId);
  if (!match) return { status: 'not_found' };

  // Check if any BG is currently running via DB
  // The battleground_log or Bg.log file would have results
  return {
    matchId,
    status: match.status,
    mode: match.mode,
    elapsed: Math.floor((Date.now() - match.startTime) / 1000),
  };
}

// Get W/L record for an account
async function getRecord(accountId) {
  // We store records in a simple table
  // First ensure the table exists
  try {
    await db.characters().query(`
      CREATE TABLE IF NOT EXISTS arena_record (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        char_guid INT NOT NULL,
        match_mode VARCHAR(8) NOT NULL,
        result ENUM('win', 'loss') NOT NULL,
        damage_done INT DEFAULT 0,
        killing_blows INT DEFAULT 0,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX(account_id)
      )
    `);
  } catch (e) {
    // Table might already exist
  }

  const [rows] = await db.characters().query(`
    SELECT 
      match_mode,
      SUM(result = 'win') as wins,
      SUM(result = 'loss') as losses,
      SUM(damage_done) as total_damage,
      SUM(killing_blows) as total_kills,
      COUNT(*) as total_games
    FROM arena_record 
    WHERE account_id = ?
    GROUP BY match_mode
  `, [accountId]);

  return rows;
}

// Record a match result
async function recordResult(accountId, charGuid, mode, result, damageDone = 0, killingBlows = 0) {
  await db.characters().query(`
    INSERT INTO arena_record (account_id, char_guid, match_mode, result, damage_done, killing_blows)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [accountId, charGuid, mode, result, damageDone, killingBlows]);
}

// Clean up bots after match
async function cleanup() {
  try {
    await soap.removeBots();
    return { cleaned: true };
  } catch (e) {
    return { cleaned: false, error: e.message };
  }
}

module.exports = {
  queueMatch,
  getMatchStatus,
  getRecord,
  recordResult,
  cleanup,
};
