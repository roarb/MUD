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

// --- RNG item spawning by rarity ---
function rollRandomItemByRarity(items) {
    if (!items || items.length === 0) return null;

    // Total weight is the sum of all item rarities
    const totalRarity = items.reduce((sum, item) => sum + (item.rarity || 0.1), 0);
    let roll = Math.random() * totalRarity;

    for (const item of items) {
        roll -= (item.rarity || 0.1);
        if (roll <= 0) {
            return item.itemId;
        }
    }

    return items[items.length - 1].itemId; // fallback
}

// --- Loot box XP rewards by tier ---
const LOOTBOX_XP = { iron: 10, bronze: 25, silver: 50, gold: 100 };

function lootboxXpReward(tier) {
    return LOOTBOX_XP[tier] || 10;
}

// ============================================================
// SKILLS SYSTEM — Universal crawler skills & probability engine
// ============================================================

// Full skill definitions: name, category, governing stat, description
const SKILLS_LIST = {
    // --- Survival & Recovery ---
    firstAid: { category: 'survival', stat: 'int', label: 'First Aid', description: 'Stabilize wounds and stop bleeding with improvised materials.' },
    scavenge: { category: 'survival', stat: 'wis', label: 'Scavenge', description: 'Find utility in trash. Better loot from searching.' },
    improvise: { category: 'survival', stat: 'dex', label: 'Improvise', description: 'Use non-weapon items in combat. Offsets the "Improper Tool" penalty.' },

    // --- Athleticism & Movement ---
    dodge: { category: 'athleticism', stat: 'dex', label: 'Dodge', description: 'Avoid incoming attacks — melee or ranged.' },
    sprint: { category: 'athleticism', stat: 'con', label: 'Sprint', description: 'Burst of speed. Move under fire or close distance.' },
    flee: { category: 'athleticism', stat: 'dex', label: 'Flee', description: 'Desperate attempt to break combat and exit.' },
    climb: { category: 'athleticism', stat: 'str', label: 'Climb', description: 'Navigate vertical or cluttered terrain for tactical advantage.' },

    // --- Perception & Tactical ---
    inspect: { category: 'perception', stat: 'wis', label: 'Inspect', description: 'Reveal hidden stats, trap triggers, and weaknesses.' },
    senseDanger: { category: 'perception', stat: 'wis', label: 'Sense Danger', description: 'Passive intuition — warnings before entering danger.' },
    sneak: { category: 'perception', stat: 'dex', label: 'Sneak', description: 'Reduce presence footprint. Enables surprise attacks.' },

    // --- Showmanship (The System) ---
    taunt: { category: 'showmanship', stat: 'cha', label: 'Taunt', description: 'Draw aggro with style. Creative taunts may earn Fan Favor.' },
    flair: { category: 'showmanship', stat: 'cha', label: 'Flair', description: 'Perform actions with unnecessary style for Entertainment Value.' },
};

const SKILL_NAMES = Object.keys(SKILLS_LIST);
const MAX_SKILL_LEVEL = 10;

/**
 * Create the default skills object — all skills at level 1.
 * @returns {object} { firstAid: 1, dodge: 1, ... }
 */
function createStartingSkills() {
    const skills = {};
    for (const name of SKILL_NAMES) {
        skills[name] = 1;
    }
    return skills;
}

/**
 * Roll a skill check against a base difficulty.
 * @param {number} skillLevel - The player's level in this skill (1-10)
 * @param {number} statValue - The governing stat value (e.g., player.stats.dex)
 * @param {number} baseDifficulty - Base difficulty (1-100, higher = harder)
 * @returns {object} { success, roll, threshold, margin, skillName? }
 */
function rollSkillCheck(skillLevel, statValue, baseDifficulty) {
    const statMod = getModifier(statValue);        // (stat - 10) / 2
    const skillBonus = skillLevel * 5;              // +5% per skill level
    const statBonus = statMod * 3;                  // +3% per stat modifier point
    const threshold = Math.max(5, Math.min(95, baseDifficulty - skillBonus - statBonus));
    const roll = Math.floor(Math.random() * 100) + 1;  // 1-100

    return {
        success: roll >= threshold,
        roll,
        threshold,
        margin: roll - threshold,   // positive = succeeded by this much
    };
}

/**
 * Check if a skill should level up after a successful use.
 * Chance decreases as skill level increases.
 * @param {number} currentLevel - Current skill level (1-10)
 * @returns {boolean}
 */
function checkSkillLevelUp(currentLevel) {
    if (currentLevel >= MAX_SKILL_LEVEL) return false;
    // 15% at level 1, decreasing ~2% per level
    const chance = Math.max(0.02, 0.15 - (currentLevel - 1) * 0.02);
    return Math.random() < chance;
}

module.exports = {
    BASE_STAT,
    STAT_POINTS_PER_LEVEL,
    BASE_HP,
    BASE_INVENTORY_SLOTS,
    STATS,
    SKILLS_LIST,
    SKILL_NAMES,
    MAX_SKILL_LEVEL,
    getModifier,
    calculateMaxHp,
    calculateDamage,
    xpToNextLevel,
    calculateInventorySlots,
    calculateHazardDamage,
    createStartingStats,
    createStartingSkills,
    rollSkillCheck,
    checkSkillLevelUp,
    allocateStatPoint,
    rollLoot,
    rollRandomItemByRarity,
    lootboxXpReward,
};
