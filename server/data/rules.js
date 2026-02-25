// ============================================================
// RULES ENGINE — The Character Sheet
// Deterministic formulas for stats, combat, leveling, inventory
// ============================================================

// Base stat value for new characters
const BASE_STAT = 10;
const STAT_POINTS_PER_LEVEL = 2;
const BASE_HP = 50;
const BASE_INVENTORY_SLOTS = 10;

// Stat names
const STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// --- Stat Modifier (D&D-style: (stat - 10) / 2) ---
function getModifier(statValue) {
    return Math.floor((statValue - 10) / 2);
}

// --- HP Calculation ---
function calculateMaxHp(level, con) {
    return BASE_HP + (con * 2) + (level * 5);
}

// --- Damage Calculation ---
// Returns minimum 1 damage
function calculateDamage(weaponAttack, attackerStr, targetDefense) {
    const strMod = getModifier(attackerStr);
    const raw = weaponAttack + strMod - targetDefense;
    return Math.max(1, raw);
}

// --- XP to reach next level ---
function xpToNextLevel(currentLevel) {
    return currentLevel * 100;
}

// --- Inventory slot count ---
function calculateInventorySlots(str) {
    return BASE_INVENTORY_SLOTS + getModifier(str);
}

// --- Hazard damage (hazardLevel * 1d6) ---
function calculateHazardDamage(hazardLevel) {
    if (hazardLevel <= 0) return 0;
    const d6 = Math.floor(Math.random() * 6) + 1;
    return hazardLevel * d6;
}

// --- Create starting stats object ---
function createStartingStats() {
    const stats = {};
    for (const stat of STATS) {
        stats[stat] = BASE_STAT;
    }
    return stats;
}

// --- Apply a stat point allocation ---
function allocateStatPoint(stats, statName) {
    if (!STATS.includes(statName)) {
        return { success: false, error: `Invalid stat: ${statName}. Valid: ${STATS.join(', ')}` };
    }
    const newStats = { ...stats };
    newStats[statName] += 1;
    return { success: true, stats: newStats };
}

// --- Roll loot from a loot table (weighted random) ---
function rollLoot(lootTable) {
    const entries = lootTable.items;
    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of entries) {
        roll -= entry.weight;
        if (roll <= 0) {
            return entry.itemId;
        }
    }
    return entries[entries.length - 1].itemId; // fallback
}

module.exports = {
    BASE_STAT,
    STAT_POINTS_PER_LEVEL,
    BASE_HP,
    BASE_INVENTORY_SLOTS,
    STATS,
    getModifier,
    calculateMaxHp,
    calculateDamage,
    xpToNextLevel,
    calculateInventorySlots,
    calculateHazardDamage,
    createStartingStats,
    allocateStatPoint,
    rollLoot,
};
