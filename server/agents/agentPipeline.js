// ============================================================
// AGENT PIPELINE — Orchestrator
// Runs: Input → Parser → Engine → [WorldBuilder, Showrunner] → GameMaster → Output
// ============================================================
const { parseInput } = require('./inputParser');
const { describeRoom } = require('./worldBuilder');
const { generateFlavorText, checkAchievement, evaluateBonusXp } = require('./showrunner');
const { compileFinalOutput, compileFallbackOutput } = require('./gameMaster');
const { processAction, checkLevelUp } = require('../engine/gameEngine');
const { getDoc } = require('../firebase');
const playerState = require('../engine/playerState');

const LLM_API_KEY = process.env.LLM_API_KEY;
const USE_LLM = LLM_API_KEY && LLM_API_KEY !== 'your_api_key_here';

/**
 * Full pipeline: raw user text → final game output text.
 * @param {string} playerId
 * @param {string} userInput
 * @returns {object} { text, events, achievement, player }
 */
async function runPipeline(playerId, userInput) {
    try {
        // --- 1. Load current state for context ---
        const player = await playerState.loadPlayer(playerId);
        if (!player) {
            return { text: '❌ Player not found. Something went wrong.', events: [], achievement: null, player: null };
        }

        const currentNode = await getDoc('nodes', player.location);
        const context = {
            entities: (currentNode?.entities || []),
            items: (currentNode?.items || []),
            exits: currentNode ? Object.entries(currentNode.connections).filter(([, v]) => v).map(([k]) => k) : [],
        };

        // --- 2. Agent 1: Parse Input ---
        const intent = await parseInput(userInput, context);
        console.log('[Pipeline] Parsed intent:', JSON.stringify(intent));

        // --- 3. Game Engine: Process Action ---
        const result = await processAction(playerId, intent);
        const { events, player: updatedPlayer } = result;
        console.log('[Pipeline] Engine events:', events.map(e => e.type).join(', '));

        // --- 4. Agents 2 & 3 in parallel ---
        const hasRoomEvent = events.some(e => e.type === 'room_description');
        const roomEvent = events.find(e => e.type === 'room_description');

        let worldDescription = '';
        let flavorText = '';
        let achievement = null;
        let bonusXp = null;

        if (USE_LLM) {
            const promises = [];

            // World Builder — only if there's a room to describe
            if (hasRoomEvent && roomEvent) {
                promises.push(
                    describeRoom(roomEvent).then(desc => { worldDescription = desc; })
                );
            } else {
                promises.push(Promise.resolve());
            }

            // Showrunner — flavor text for interesting events
            promises.push(
                generateFlavorText(events).then(text => { flavorText = text; })
            );

            // Showrunner — achievement check
            promises.push(
                checkAchievement(events, updatedPlayer).then(ach => { achievement = ach; })
            );

            // Showrunner — bonus XP for creative actions
            promises.push(
                evaluateBonusXp(userInput, events, updatedPlayer).then(bxp => { bonusXp = bxp; })
            );

            await Promise.all(promises);

            // Save achievement to player if awarded
            if (achievement) {
                updatedPlayer.achievements = updatedPlayer.achievements || [];
                updatedPlayer.achievements.push(achievement);
            }

            // Apply bonus XP if awarded
            if (bonusXp) {
                updatedPlayer.xp += bonusXp.amount;
                events.push({ type: 'bonus_xp', amount: bonusXp.amount, reason: bonusXp.reason, totalXp: updatedPlayer.xp });

                const levelUpEvents = checkLevelUp(updatedPlayer);
                events.push(...levelUpEvents);
            }

            // Persist player if achievement or bonus XP changed state
            if (achievement || bonusXp) {
                await playerState.savePlayer(updatedPlayer);
            }

            // --- 5. Agent 4: Game Master compiles final output ---
            const finalText = await compileFinalOutput(events, worldDescription, flavorText, achievement, updatedPlayer);
            return { text: finalText, events, achievement, player: updatedPlayer };
        } else {
            // Fallback mode — no LLM, use template formatting
            const finalText = compileFallbackOutput(events, null, null, null, updatedPlayer);
            return { text: finalText, events, achievement: null, player: updatedPlayer };
        }

    } catch (err) {
        console.error('[Pipeline] Error:', err);
        return { text: `❌ An error occurred: ${err.message}`, events: [], achievement: null, player: null };
    }
}

module.exports = { runPipeline };
