const crypto = require('crypto');
const db = require('./mangos-db');
const soap = require('./mangos-soap');

// Valid race/class combos in vanilla WoW
const RACE_NAMES = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf',
  5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll',
};
const CLASS_NAMES = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue',
  5: 'Priest', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid',
};
const FACTION = {
  1: 'Alliance', 2: 'Horde', 3: 'Alliance', 4: 'Alliance',
  5: 'Horde', 6: 'Horde', 7: 'Alliance', 8: 'Horde',
};

// Username = account number, password = fixed simple string
function generateUsername(grudgeId) {
  const hash = crypto.createHash('md5').update(grudgeId).digest('hex').substring(0, 8);
  return 'GA' + hash;
}

function generatePassword() {
  return 'admin123';
}

// Login or create account from Grudge ID
async function loginOrCreate(grudgeId) {
  // Check if this grudge ID already has an account
  let account = await db.findAccountByGrudgeId(grudgeId);

  if (account) {
    // Existing account — get their characters
    const chars = await db.getCharacters(account.id);
    return {
      accountId: account.id,
      username: account.username,
      characters: chars,
      isNew: false,
    };
  }

  // Create new MaNGOS account via SOAP (handles SRP6 password hashing)
  const username = generateUsername(grudgeId);
  const password = generatePassword();

  try {
    await soap.createAccount(username, password);
  } catch (e) {
    // Ignore "already exist" — could be a retry
    if (!e.message.includes('already exist')) throw e;
  }

  // SOAP inserts async — poll until the account appears (up to 3s)
  let accountRow = null;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    const [rows] = await db.realmd().query(
      'SELECT id, username FROM account WHERE username = ?',
      [username.toUpperCase()]
    );
    if (rows.length) { accountRow = rows[0]; break; }
  }

  if (!accountRow) {
    throw new Error('Account creation timed out — try again');
  }

  // Tag the account with the grudge ID in the email field
  await db.realmd().query(
    'UPDATE account SET email = ? WHERE id = ?',
    [`grudge:${grudgeId}`, accountRow.id]
  );

  return {
    accountId: accountRow.id,
    username: accountRow.username,
    password, // Only returned on first creation so client can auto-fill realmlist login
    characters: [],
    isNew: true,
  };
}

// Create a level 60 premade character
async function createCharacter(accountId, name, race, classId, specEntry, gearEntry) {
  // Validate race/class
  if (!RACE_NAMES[race] || !CLASS_NAMES[classId]) {
    throw new Error('Invalid race or class');
  }

  // Get spawn location from playercreateinfo (should be GM Island)
  const [spawnRows] = await db.mangos().query(
    'SELECT map, zone, position_x, position_y, position_z, orientation FROM playercreateinfo WHERE race = ? AND class = ? LIMIT 1',
    [race, classId]
  );
  if (!spawnRows.length) throw new Error('Invalid race/class combo for this patch');
  const spawn = spawnRows[0];

  // Check name is available
  const [existing] = await db.characters().query(
    'SELECT guid FROM characters WHERE name = ?', [name]
  );
  if (existing.length) throw new Error('Name already taken');

  const guid = await db.getNextCharGuid();

  // Insert character at level 60 on GM Island
  await db.characters().query(`
    INSERT INTO characters (
      guid, account, name, race, class, position_x, position_y, position_z,
      map, zone, orientation, level, xp, money, online,
      totaltime, leveltime, rest_bonus,
      explored_zones, equipmentCache, knownTitles,
      at_login
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 60, 0, 100000000, 0,
      0, 0, 0,
      '', '', '',
      0
    )
  `, [
    guid, accountId, name, race, classId,
    spawn.position_x, spawn.position_y, spawn.position_z,
    spawn.map, spawn.zone, spawn.orientation,
  ]);

  // Apply premade spec (spells + talents)
  if (specEntry) {
    const spells = await db.getPremadeSpells(specEntry);
    if (spells.length) {
      const values = spells.map(spellId =>
        `(${guid}, ${spellId}, 1, 0)`
      ).join(',');
      await db.characters().query(`
        INSERT IGNORE INTO character_spell (guid, spell, active, disabled) VALUES ${values}
      `);
    }
  }

  // Apply premade gear (items)
  if (gearEntry) {
    const items = await db.getPremadeItems(gearEntry);
    const faction = FACTION[race];
    let slot = 23; // Start in inventory bag slots

    for (const item of items) {
      // Skip faction-specific items for wrong faction
      if (item.team && ((item.team === 469 && faction === 'Horde') ||
                         (item.team === 67 && faction === 'Alliance'))) {
        continue;
      }

      await db.characters().query(`
        INSERT INTO character_inventory (guid, bag, slot, item_template, item)
        VALUES (?, 0, ?, ?, ?)
      `, [guid, slot, item.item, guid * 1000 + slot]);

      // Also insert into item_instance
      await db.characters().query(`
        INSERT INTO item_instance (guid, owner_guid, itemEntry, enchantments)
        VALUES (?, ?, ?, ?)
      `, [guid * 1000 + slot, guid, item.item, item.enchant || '']);

      slot++;
    }
  }

  return {
    guid,
    name,
    race,
    class: classId,
    raceName: RACE_NAMES[race],
    className: CLASS_NAMES[classId],
    faction: FACTION[race],
    level: 60,
  };
}

// Get available specs/gear for a class
async function getClassOptions(classId) {
  const specs = await db.getPremadeSpecs(classId);
  const gear = await db.getPremadeGear(classId);
  return { specs, gear };
}

module.exports = {
  loginOrCreate,
  createCharacter,
  getClassOptions,
  RACE_NAMES,
  CLASS_NAMES,
  FACTION,
};
