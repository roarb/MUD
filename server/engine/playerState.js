// ============================================================
// PLAYER STATE — Player CRUD against Firestore
// ============================================================
const { v4: uuidv4 } = require('uuid');
const { getDoc, setDoc, updateDoc } = require('../firebase');
const rules = require('../data/rules');

const PLAYERS_COLLECTION = 'players';
const STARTING_NODE = 'entrance_plaza';

// --- Create a new player ---
// @param {string} name - Player name
// @param {object} [characterData] - Optional parsed data from the Interpreter agent
async function createPlayer(name, characterData) {
    const stats = characterData?.stats || rules.createStartingStats();
    const maxHp = rules.calculateMaxHp(1, stats.con);

    const player = {
        id: uuidv4(),
        name: characterData?.name || name || 'Unnamed Crawler',
        gender: characterData?.gender || 'Unknown',
        visuals: characterData?.visuals || 'A nondescript survivor.',
        startingSkills: characterData?.startingSkills || [],
        level: 1,
        xp: 0,
        stats,
        skills: buildPlayerSkills(characterData?.startingSkills),
        hp: maxHp,
        maxHp,
        location: STARTING_NODE,
        inventory: [],       // Array of { itemId, name, type, stats, tier, slot? }
        equipment: {         // Equipped slots
            weapon: null,
            head: null,
            chest: null,
            feet: null,
        },
        eventLog: [],        // Recent game events for AI context
        achievements: [],    // Earned achievements
        statPointsAvailable: 0,
        alive: true,
        explored: [STARTING_NODE], // Track visited locations
        statistics: {              // Track continuous metrics
            lootboxesOpened: 0,
            entitiesKilled: 0,
        },
    };

    // Add starting inventory items from the Interpreter
    if (characterData?.startingInventory) {
        for (const item of characterData.startingInventory) {
            player.inventory.push({
                itemId: `starting_${item.name.toLowerCase().replace(/\s+/g, '_')}`,
                name: item.name,
                type: item.type || 'misc',
                tier: 'iron',
                stats: item.slot ? { defense: 1 } : {},
                description: `Starting gear of ${player.name}.`,
                slot: item.slot || null,
            });
        }
    }

    await setDoc(PLAYERS_COLLECTION, player.id, player);
    return player;
}

// --- Load player from Firestore ---
async function loadPlayer(playerId) {
    return await getDoc(PLAYERS_COLLECTION, playerId);
}

// --- Save full player state ---
async function savePlayer(player) {
    await setDoc(PLAYERS_COLLECTION, player.id, player);
    return player;
}

// --- Update partial player fields ---
async function updatePlayer(playerId, partial) {
    return await updateDoc(PLAYERS_COLLECTION, playerId, partial);
}

// --- Add event to player's log (keep last 20) ---
function addEvent(player, event) {
    player.eventLog.push({
        ...event,
        timestamp: Date.now(),
    });
    if (player.eventLog.length > 20) {
        player.eventLog = player.eventLog.slice(-20);
    }
}

// --- Get total attack including equipped weapon ---
function getPlayerAttack(player) {
    let attack = 0;
    if (player.equipment.weapon) {
        attack += player.equipment.weapon.stats.attack || 0;
    }
    return attack;
}

// --- Get total defense from all equipped armor ---
function getPlayerDefense(player) {
    let defense = 0;
    for (const slot of ['head', 'chest', 'feet']) {
        if (player.equipment[slot]) {
            defense += player.equipment[slot].stats.defense || 0;
        }
    }
    return defense;
}

// --- Calculate inventory capacity ---
function getInventoryCapacity(player) {
    return rules.calculateInventorySlots(player.stats.str);
}

// --- Get a skill level (with fallback for legacy players) ---
function getSkillLevel(player, skillName) {
    if (!player.skills) return 1;  // Legacy player fallback
    return player.skills[skillName] || 1;
}

// --- Build skills map: base 1 for all, boost from Interpreter ---
function buildPlayerSkills(interpreterSkills) {
    const skills = rules.createStartingSkills();
    if (Array.isArray(interpreterSkills)) {
        // Interpreter passes skill names as strings; boost matched to 2-3
        for (const skillName of interpreterSkills) {
            const key = normalizeSkillName(skillName);
            if (key && skills[key] !== undefined) {
                skills[key] = Math.min(3, skills[key] + 1);
            }
        }
    }
    return skills;
}

// Map label names (from Interpreter) to our skill keys
function normalizeSkillName(name) {
    if (!name) return null;
    const lower = name.toLowerCase().replace(/\s+/g, '');
    const map = {
        'firstaid': 'firstAid', 'medicine': 'firstAid',
        'scavenge': 'scavenge', 'scavenging': 'scavenge',
        'improvise': 'improvise',
        'dodge': 'dodge',
        'sprint': 'sprint', 'endurance': 'sprint',
        'flee': 'flee',
        'climb': 'climb', 'vault': 'climb', 'climbing': 'climb',
        'inspect': 'inspect', 'perception': 'inspect',
        'sensedanger': 'senseDanger', 'intuition': 'senseDanger',
        'sneak': 'sneak', 'stealth': 'sneak',
        'taunt': 'taunt', 'intimidation': 'taunt',
        'flair': 'flair', 'showmanship': 'flair',
        // Aliases from old VALID_SKILLS list in interpreter
        'survival': 'scavenge', 'cooking': 'scavenge', 'crafting': 'improvise',
        'lockpicking': 'sneak', 'bartering': 'taunt',
        'combattraining': 'dodge', 'acrobatics': 'dodge',
        'hacking': 'inspect', 'quickreflexes': 'dodge',
        'ironstomach': 'sprint', 'silvertongue': 'taunt', 'deadeye': 'inspect',
        'heavylifting': 'climb', 'marathoner\'sgrit': 'sprint',
    };
    return map[lower] || null;
}

module.exports = {
    createPlayer,
    loadPlayer,
    savePlayer,
    updatePlayer,
    addEvent,
    getPlayerAttack,
    getPlayerDefense,
    getInventoryCapacity,
    getSkillLevel,
};
