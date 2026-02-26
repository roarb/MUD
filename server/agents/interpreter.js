// ============================================================
// AGENT: THE INTERPRETER — Character Description Parser
// Takes natural-language character descriptions and maps them
// to structured game data (stats, skills, inventory).
// ============================================================
const { callLLM } = require('./llmClient');

// Valid starting skills the AI can assign
const VALID_SKILLS = [
    'Sprint', 'Endurance', 'First Aid', 'Stealth', 'Lockpicking',
    'Bartering', 'Intimidation', 'Scavenging', 'Cooking', 'Crafting',
    'Combat Training', 'Acrobatics', 'Hacking', 'Perception', 'Survival',
    'Heavy Lifting', 'Quick Reflexes', 'Iron Stomach', 'Silver Tongue', 'Dead Eye',
];

const STAT_TOTAL = 63;  // Base 60 (6*10) + 3 bonus from background
const STAT_MIN = 7;
const STAT_MAX = 13;
const STAT_NAMES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const INTERPRETER_SYSTEM_PROMPT = `You are The Interpreter — a silent backend agent for a dungeon crawler MUD game. You do NOT talk to the player. You ONLY output JSON.

Your job: take a player's free-text character description and map it to game variables.

STAT RULES:
- There are 6 stats: str, dex, con, int, wis, cha
- Base value for each stat is 10
- You may adjust each stat by -3 to +3 based on the player's description
- TOTAL stat points MUST equal exactly ${STAT_TOTAL}
- No stat may go below ${STAT_MIN} or above ${STAT_MAX}

KEYWORD MAPPING GUIDELINES:
- Mentions of strength, size, muscle, heavy, big → boost str
- Mentions of speed, agility, running, quick, nimble → boost dex
- Mentions of endurance, stamina, tough, resilient, athletic → boost con
- Mentions of smart, educated, engineer, doctor, scientist → boost int
- Mentions of perceptive, aware, spiritual, experienced → boost wis
- Mentions of charming, leader, performer, social, charismatic → boost cha
- Physical jobs (construction, military, athlete) → str/con up, possibly int/cha down
- Mental jobs (programmer, teacher, doctor) → int/wis up, possibly str down
- Social jobs (salesperson, politician, performer) → cha up

SKILLS:
- Assign 1-2 starting skills from this list: ${VALID_SKILLS.join(', ')}
- Pick skills that match the player's background and description
- If no clear match, default to "Survival"

INVENTORY:
- Assign 1-2 starting inventory items based on what the player describes wearing/carrying
- Keep items mundane and balanced (no weapons beyond "improvised" tier)
- Name them flavorfully (e.g., "Salt-Stained Running Shorts" not "shorts")

VISUALS:
- Write a short (under 20 words) physical description string for the database

OUTPUT FORMAT — Return ONLY this JSON, nothing else:
{
  "name": "<extracted name or 'Unknown Crawler'>",
  "gender": "<Male/Female/Non-binary/Unknown>",
  "stats": { "str": N, "dex": N, "con": N, "int": N, "wis": N, "cha": N },
  "visuals": "<short physical description>",
  "startingSkills": ["<skill1>"],
  "startingInventory": [
    { "name": "<item name>", "type": "<armor/consumable/misc>", "slot": "<head/chest/feet/null>" }
  ]
}`;

/**
 * Parse a player's character description into structured game data.
 * @param {string} description - The player's free-text character description
 * @returns {object} Parsed character data
 */
async function interpretCharacter(description) {
    const response = await callLLM(INTERPRETER_SYSTEM_PROMPT, description, {
        temperature: 0.6,
        maxTokens: 500,
    });

    try {
        // Strip markdown code fences if present
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return validateCharacterPayload(parsed);
    } catch (err) {
        console.error('[Interpreter] Failed to parse LLM response:', err.message);
        console.error('[Interpreter] Raw response:', response);
        return getDefaultCharacter(description);
    }
}

/**
 * Validate and enforce constraints on the character payload.
 * Clamps stats, enforces total, validates skills list.
 */
function validateCharacterPayload(data) {
    const result = {
        name: (data.name && typeof data.name === 'string') ? data.name.trim().substring(0, 30) : 'Unknown Crawler',
        gender: ['Male', 'Female', 'Non-binary', 'Unknown'].includes(data.gender) ? data.gender : 'Unknown',
        stats: {},
        visuals: (data.visuals && typeof data.visuals === 'string') ? data.visuals.substring(0, 100) : 'A weary-looking survivor.',
        startingSkills: [],
        startingInventory: [],
    };

    // --- Validate stats ---
    for (const stat of STAT_NAMES) {
        let val = data.stats?.[stat];
        if (typeof val !== 'number' || isNaN(val)) val = 10;
        result.stats[stat] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(val)));
    }

    // Enforce total = STAT_TOTAL via proportional adjustment
    let currentTotal = Object.values(result.stats).reduce((s, v) => s + v, 0);
    if (currentTotal !== STAT_TOTAL) {
        const diff = STAT_TOTAL - currentTotal;
        // Distribute difference across stats that have room
        const adjustable = STAT_NAMES.filter(s =>
            diff > 0 ? result.stats[s] < STAT_MAX : result.stats[s] > STAT_MIN
        );
        let remaining = Math.abs(diff);
        const direction = diff > 0 ? 1 : -1;
        for (let i = 0; remaining > 0 && i < adjustable.length; i++) {
            result.stats[adjustable[i]] += direction;
            remaining--;
        }
    }

    // --- Validate skills ---
    if (Array.isArray(data.startingSkills)) {
        for (const skill of data.startingSkills.slice(0, 2)) {
            if (typeof skill === 'string') {
                // Find best match from valid skills
                const match = VALID_SKILLS.find(s => s.toLowerCase() === skill.toLowerCase());
                if (match) result.startingSkills.push(match);
            }
        }
    }
    if (result.startingSkills.length === 0) {
        result.startingSkills.push('Survival');
    }

    // --- Validate inventory ---
    if (Array.isArray(data.startingInventory)) {
        for (const item of data.startingInventory.slice(0, 3)) {
            if (item && typeof item.name === 'string') {
                result.startingInventory.push({
                    name: item.name.substring(0, 50),
                    type: ['armor', 'consumable', 'misc'].includes(item.type) ? item.type : 'misc',
                    slot: ['head', 'chest', 'feet'].includes(item.slot) ? item.slot : null,
                });
            }
        }
    }

    return result;
}

/**
 * Fallback character when LLM parsing fails.
 */
function getDefaultCharacter(description) {
    // Try to extract a name from the first sentence
    let name = 'Unknown Crawler';
    const nameMatch = description.match(/(?:my name is|i'm|i am|call me|name's)\s+([A-Z][a-z]+)/i);
    if (nameMatch) name = nameMatch[1];

    return {
        name,
        gender: 'Unknown',
        stats: { str: 10, dex: 11, con: 11, int: 10, wis: 11, cha: 10 },
        visuals: 'A nondescript survivor in tattered clothes.',
        startingSkills: ['Survival'],
        startingInventory: [
            { name: 'Tattered Backpack', type: 'misc', slot: null },
        ],
    };
}

module.exports = { interpretCharacter, validateCharacterPayload, VALID_SKILLS };
