const mysql = require('mysql2/promise');

let pools = {};

function getPool(database) {
  if (!pools[database]) {
    pools[database] = mysql.createPool({
      host: process.env.MANGOS_DB_HOST,
      port: parseInt(process.env.MANGOS_DB_PORT),
      user: process.env.MANGOS_DB_USER,
      password: process.env.MANGOS_DB_PASS,
      database,
      waitForConnections: true,
      connectionLimit: 5,
    });
  }
  return pools[database];
}

const realmd = () => getPool('realmd');
const mangos = () => getPool('mangos');
const characters = () => getPool('characters');

// Get next available account ID
async function getNextAccountId() {
  const [rows] = await realmd().query('SELECT MAX(id) as maxId FROM account');
  return (rows[0].maxId || 0) + 1;
}

// Get next available character GUID
async function getNextCharGuid() {
  const [rows] = await characters().query('SELECT MAX(guid) as maxGuid FROM characters');
  return (rows[0].maxGuid || 0) + 1;
}

// Check if a grudge ID already has a MaNGOS account
async function findAccountByGrudgeId(grudgeId) {
  const [rows] = await realmd().query(
    'SELECT id, username FROM account WHERE email = ?',
    [`grudge:${grudgeId}`]
  );
  return rows[0] || null;
}

// Get all premade spec templates for a class
async function getPremadeSpecs(classId) {
  const [rows] = await mangos().query(
    'SELECT entry, name, role FROM player_premade_spell_template WHERE class = ? ORDER BY entry',
    [classId]
  );
  return rows;
}

// Get all premade gear templates for a class
async function getPremadeGear(classId) {
  const [rows] = await mangos().query(
    'SELECT entry, name, role FROM player_premade_item_template WHERE class = ? ORDER BY entry',
    [classId]
  );
  return rows;
}

// Get premade spells for a spec template
async function getPremadeSpells(templateEntry) {
  const [rows] = await mangos().query(
    'SELECT spell FROM player_premade_spell WHERE entry = ?',
    [templateEntry]
  );
  return rows.map(r => r.spell);
}

// Get premade items for a gear template
async function getPremadeItems(templateEntry) {
  const [rows] = await mangos().query(
    'SELECT item, enchant, team FROM player_premade_item WHERE entry = ?',
    [templateEntry]
  );
  return rows;
}

// Get valid race/class combos
async function getRaceClassCombos() {
  const [rows] = await mangos().query(
    'SELECT race, class, map, zone, position_x, position_y, position_z, orientation FROM playercreateinfo'
  );
  return rows;
}

// Get character list for an account
async function getCharacters(accountId) {
  const [rows] = await characters().query(
    `SELECT guid, name, race, class, level, 
            (SELECT COUNT(*) FROM character_battleground_data WHERE guid = characters.guid) as bg_count
     FROM characters WHERE account = ?`,
    [accountId]
  );
  return rows;
}

module.exports = {
  realmd, mangos, characters,
  getNextAccountId, getNextCharGuid,
  findAccountByGrudgeId,
  getPremadeSpecs, getPremadeGear,
  getPremadeSpells, getPremadeItems,
  getRaceClassCombos, getCharacters,
};
