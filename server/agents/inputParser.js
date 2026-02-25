// ============================================================
// AGENT 1: INPUT PARSER — The Translator
// Translates natural language into strict JSON intent payloads
// ============================================================
const { callLLM } = require('./llmClient');

const SYSTEM_PROMPT = `You are the translator between human text and a deterministic game engine for a text-based dungeon crawler (MUD).

The user will type a natural language action. You must parse this into a strict JSON intent payload. 

VALID ACTIONS AND THEIR REQUIRED FIELDS:
- {"action": "move", "direction": "<n|s|e|w|down|up>", "context": "<optional flavor>"}
- {"action": "look"}
- {"action": "attack", "target": "<entity_name_or_partial>"}
- {"action": "pickup", "target": "<item_name_or_partial>"}
- {"action": "use", "target": "<item_name_or_partial>"}
- {"action": "equip", "target": "<item_name_or_partial>"}
- {"action": "inventory"}
- {"action": "stats"}
- {"action": "allocate", "target": "<stat_name: str|dex|con|int|wis|cha>"}
- {"action": "open", "target": "<lootbox_name_or_partial>"}
- {"action": "talk", "target": "<npc_name_or_partial>"}

RULES:
1. ONLY return valid JSON. No explanation. No story text. No markdown.
2. Match the user's intent to the closest valid action.
3. For direction aliases: "north"→"n", "south"→"s", "east"→"e", "west"→"w".
4. If intent is ambiguous, prefer "look" as the default.
5. For targets, extract the key noun (e.g., "the goblin" → "goblin", "rusty pipe on the ground" → "rusty pipe").
6. If the user describes a creative action, map it to the closest game mechanic.

CONTEXT (current game state will be provided to help disambiguate):`;

/**
 * Parse user input into a JSON intent.
 * @param {string} userInput - Raw text from the player
 * @param {object} context - Current game state for disambiguation
 * @returns {object} Parsed intent
 */
async function parseInput(userInput, context = {}) {
    const contextStr = context ? `\nCurrent room entities: ${JSON.stringify(context.entities || [])}\nCurrent room items: ${JSON.stringify(context.items || [])}\nAvailable exits: ${JSON.stringify(context.exits || [])}` : '';

    const fullPrompt = SYSTEM_PROMPT + contextStr;
    const response = await callLLM(fullPrompt, userInput, { temperature: 0.1, maxTokens: 150 });

    try {
        // Strip any markdown code fences the LLM might add
        const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const intent = JSON.parse(cleaned);

        // Validate required fields
        if (!intent.action) {
            return { action: 'look' };
        }

        return intent;
    } catch (err) {
        console.warn('[InputParser] Failed to parse LLM response as JSON:', response);
        // Last resort: try basic parsing
        return { action: 'look' };
    }
}

module.exports = { parseInput };
