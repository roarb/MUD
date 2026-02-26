// ============================================================
// PLAYER STATE — Player CRUD against Firestore
// ============================================================
const { v4: uuidv4 } = require('uuid');
const { getDoc, setDoc, updateDoc } = require('../firebase');
const rules = require('../data/rules');

const PLAYERS_COLLECTION = 'players';
const STARTING_NODE = 'entrance_plaza';

// --- Create a new player ---
async function createPlayer(name) {
    const stats = rules.createStartingStats();
    const maxHp = rules.calculateMaxHp(1, stats.con);

    const player = {
        id: uuidv4(),
        name: name || 'Unnamed Crawler',
        level: 1,
        xp: 0,
        stats,
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

module.exports = {
    createPlayer,
    loadPlayer,
    savePlayer,
    updatePlayer,
    addEvent,
    getPlayerAttack,
    getPlayerDefense,
    getInventoryCapacity,
};
