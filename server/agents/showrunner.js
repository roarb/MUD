// ============================================================
// AGENT 3: SYSTEM SHOWRUNNER — The DCC AI
// Generates flavor text, commentary, and achievements
// ============================================================
const { callLLM } = require('./llmClient');

const FLAVOR_SYSTEM_PROMPT = `You are the System — a highly advanced, slightly unhinged, dramatically sarcastic alien AI running a televised death game called "The Dungeon" for a galactic audience of billions. Earth has been collapsed into a dungeon and humans are the contestants.

You will receive event logs of what a player (called a "crawler") has just done.

YOUR JOBS:
A) FLAVOR TEXT: When a crawler kills a mob, finds an item, takes damage, or does something notable, generate a short (1-2 sentence) piece of flavor text. Be condescending, darkly funny, or disturbingly specific. Channel the energy of a bored reality TV host who finds human suffering mildly entertaining.

B) ITEM DESCRIPTIONS: When a new or notable item is found, you may enhance its description with your trademark wit.

RULES:
- Keep it SHORT. 1-2 sentences max.
- Be entertaining, not mean-spirited. Dark humor, not cruelty.
- Reference the galactic audience occasionally, randomizing their location each time (e.g., "The viewers from Andromeda", "The Sirius B crowd", "Fans in the Orion Nebula", "The Zenith broadcast").
- Never break character. You ARE the System.
- Don't give gameplay advice. You're a host, not a helper.
- Return ONLY the flavor text. No labels, no JSON.`;

const ACHIEVEMENT_SYSTEM_PROMPT = `You are the System — a highly advanced, dramatically sarcastic alien AI running a televised death game for a galactic audience. You award achievements to crawlers who do something highly irregular, stupid, brave, or hilariously violent.

You will receive the complete event log of what just happened. Decide if an achievement should be awarded.

IF an achievement is warranted, return EXACTLY this JSON format:
{"awarded": true, "title": "<Achievement Title>", "description": "<Mocking 1-sentence description>", "tier": "<iron|bronze|silver|gold>"}

IF no achievement is warranted, return EXACTLY:
{"awarded": false}

ACHIEVEMENT CRITERIA:
- First kill of any type → Achievement (iron)
- Killing something with bare fists → Achievement (bronze)
- Taking massive damage and surviving → Achievement (bronze)
- Dying in a stupid way → Achievement (iron)
- Finding a rare item → Achievement (bronze)
- Doing something the System finds genuinely impressive → Achievement (silver/gold)
- Creative or bizarre actions → Achievement (bronze+)

REPEATING ACHIEVEMENTS (BASE-10 RULE):
You will be provided with the crawler's "statistics" object (e.g. lootboxesOpened, entitiesKilled). 
If giving an achievement for a repeating action (like opening a lootbox or killing an entity), you MUST strictly adhere to base-10 milestones (1, 10, 100, 1000).
- If \`lootboxesOpened\` is 2, DO NOT award an achievement.
- If \`lootboxesOpened\` is 10, award an achievement (bronze).
- If \`lootboxesOpened\` is 100, award an achievement (silver or gold).
- NEVER award incremental achievements (like 2.0, 3.0) unless the statistic exactly matches a base-10 threshold!

RULES:
- Titles should be punchy and memorable (e.g., "Look Out Below!", "Anger Management Issues", "Pennies From Hell").
- Return ONLY valid JSON. No explanation.`;

const INSPECT_SYSTEM_PROMPT = `You are the System — a highly advanced alien AI analyzing an item that a human crawler has just inspected. 

You will receive the raw JSON data of the item.

YOUR JOB: Generate a detailed inspection report. 
Format your response exactly with these three headings (do not use markdown bolding or headers, just the text on a new line):
[OVERVIEW]
(1-2 sentences summarizing what the item is in your sarcastic, condescending tone)

[PHYSICAL DESCRIPTION]
(2-3 sentences describing how the item looks, feels, smells, or hums with energy)

[COMMON USES]
(1-2 sentences explaining what crawlers usually do with this, or what horrible fate awaits if used incorrectly)

RULES:
- Maintain your persona as the bored, sadistic System host.
- Do NOT return JSON. Return only the formatted text block.`;

/**
 * Generate flavor text for game events.
 */
async function generateFlavorText(events) {
    // Filter to interesting events
    const interesting = events.filter(e =>
        ['player_attack', 'entity_killed', 'entity_attack', 'player_death',
            'loot_dropped', 'item_pickup', 'lootbox_opened', 'hazard_damage',
            'level_up', 'item_used', 'item_equipped', 'unknown_action'].includes(e.type)
    );

    if (interesting.length === 0) return '';

    const response = await callLLM(FLAVOR_SYSTEM_PROMPT, JSON.stringify(interesting), {
        temperature: 0.9,
        maxTokens: 150,
    });

    return response;
}

/**
 * Check if events warrant an achievement.
 */
async function checkAchievement(events, player) {
    const interesting = events.filter(e =>
        ['entity_killed', 'player_death', 'lootbox_opened', 'hazard_damage',
            'level_up', 'item_pickup'].includes(e.type)
    );

    if (interesting.length === 0) return null;

    const payload = {
        events: interesting,
        playerLevel: player.level,
        statistics: player.statistics || {},
        achievementCount: (player.achievements || []).length,
        existingAchievements: (player.achievements || []).map(a => a.title),
    };

    const response = await callLLM(ACHIEVEMENT_SYSTEM_PROMPT, JSON.stringify(payload), {
        temperature: 0.8,
        maxTokens: 200,
    });

    try {
        const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const result = JSON.parse(cleaned);
        if (result.awarded) {
            return {
                title: result.title,
                description: result.description,
                tier: result.tier || 'iron',
                timestamp: Date.now(),
            };
        }
    } catch (err) {
        console.warn('[Showrunner] Failed to parse achievement response:', response);
    }

    return null;
}

// ============================================================
// BONUS XP EVALUATION — Reward creative / out-of-the-ordinary play
// ============================================================
const BONUS_XP_SYSTEM_PROMPT = `You are the System — the alien AI running a televised death game. You can award BONUS XP to crawlers who do something creative, crazy, unexpected, or genuinely impressive.

You will receive:
1. RAW_INPUT: The exact text the player typed.
2. EVENTS: The game events that resulted from the action.
3. PLAYER_LEVEL: The player's current level.

DECIDE if the player's action deserves bonus XP. Award XP for things like:
- Creative problem-solving or unusual approaches
- Trying something wild, risky, or entertainingly stupid
- Actions that would excite the galactic audience
- Clever use of the environment or items
- Hilarious roleplay or dramatic flair

DO NOT award XP for routine actions like: basic movement, looking around, checking stats/inventory, standard attacks with no flair, or picking up items normally.

IF bonus XP is warranted, return EXACTLY this JSON:
{"award": true, "amount": <10-50>, "reason": "<sarcastic 1-sentence reason>"}

IF no bonus XP is warranted, return EXACTLY:
{"award": false}

AMOUNT GUIDELINES:
- 10-15 XP: Mildly creative or amusing
- 20-30 XP: Genuinely clever or entertainingly reckless
- 35-50 XP: Absolutely unhinged brilliance that has the galactic audience on their feet

RULES:
- Be selective. Not every action deserves a bonus. Maybe 1 in 5 creative attempts.
- Return ONLY valid JSON. No explanation.`;

/**
 * Evaluate whether the player's action deserves bonus XP.
 * @param {string} rawInput - The player's raw text input
 * @param {Array} events - Game events that resulted
 * @param {object} player - Current player state
 * @returns {object|null} { amount, reason } or null
 */
async function evaluateBonusXp(rawInput, events, player) {
    // Skip evaluation for mundane actions
    const mundaneActions = ['look', 'inventory', 'stats'];
    const isOnlyMundane = events.every(e =>
        ['room_description', 'inventory_list', 'stats_display', 'error'].includes(e.type)
    );
    if (isOnlyMundane) return null;

    const payload = {
        rawInput,
        events: events.filter(e => e.type !== 'error'),
        playerLevel: player.level,
    };

    const response = await callLLM(BONUS_XP_SYSTEM_PROMPT, JSON.stringify(payload), {
        temperature: 0.7,
        maxTokens: 150,
    });

    try {
        const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const result = JSON.parse(cleaned);
        if (result.award && result.amount > 0) {
            return {
                amount: Math.min(50, Math.max(1, result.amount)),
                reason: result.reason || 'The System is mildly impressed.',
            };
        }
    } catch (err) {
        console.warn('[Showrunner] Failed to parse bonus XP response:', response);
    }

    return null;
}

/**
 * Generate a detailed inspection report for an item.
 */
async function generateItemInspection(itemData) {
    if (!itemData) return '';

    const payload = {
        name: itemData.name,
        type: itemData.type,
        tier: itemData.tier,
        stats: itemData.stats || {},
        baseValue: itemData.baseValue || 0,
        description: itemData.description || 'No description available.',
    };

    const response = await callLLM(INSPECT_SYSTEM_PROMPT, JSON.stringify(payload), {
        temperature: 0.8,
        maxTokens: 300,
    });

    return response;
}

module.exports = {
    generateFlavorText,
    checkAchievement,
    evaluateBonusXp,
    generateItemInspection,
};
