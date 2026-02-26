// ============================================================
// AGENT PIPELINE — Orchestrator
// Runs: Input → Parser → Engine → [WorldBuilder, Showrunner] → GameMaster → Output
// ============================================================
const fs = require('fs');
const path = require('path');
const { parseInput } = require('./inputParser');
const { describeRoom } = require('./worldBuilder');
const { generateFlavorText, checkAchievement, evaluateBonusXp, generateItemInspection } = require('./showrunner');
const { compileFinalOutput, compileFallbackOutput } = require('./gameMaster');
const { processAction, checkLevelUp } = require('../engine/gameEngine');
const { getDoc } = require('../firebase');
const playerState = require('../engine/playerState');
const { generateImage } = require('./llmClient');

// Ensure generated images directory exists
const IMAGES_DIR = path.join(__dirname, '..', 'generated_images');
if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

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
        const inspectEvent = events.find(e => e.type === 'item_inspected');

        let worldDescription = '';
        let flavorText = '';
        let inspectionText = '';
        let achievement = null;
        let bonusXp = null;
        let imageUrl = null;

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

            // Showrunner — Generate Item Inspection AI if requested
            if (inspectEvent && inspectEvent.item) {
                promises.push(
                    generateItemInspection(inspectEvent.item).then(text => { inspectionText = text; })
                );
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

            // --- Image Generation (runs after text agents complete) ---
            try {
                let imagePrompt = null;

                if (hasRoomEvent && roomEvent) {
                    // Build a scene prompt from room data
                    const entityNames = (roomEvent.entities || []).map(e => e.name).join(', ');
                    const itemNames = (roomEvent.items || []).map(i => i.name).join(', ');
                    imagePrompt = `A ${roomEvent.zoneType || 'dungeon'} room: ${roomEvent.baseDescription || ''}.`;
                    if (entityNames) imagePrompt += ` Creatures present: ${entityNames}.`;
                    if (itemNames) imagePrompt += ` Items on the ground: ${itemNames}.`;
                    imagePrompt += ' Post-apocalyptic dungeon crawler setting, dark and atmospheric.';
                } else if (inspectEvent && inspectEvent.item) {
                    // Build an item close-up prompt
                    const item = inspectEvent.item;
                    imagePrompt = `Close-up view of a ${item.tier || ''} ${item.type || 'item'} called "${item.name}". ${item.description || ''}. Fantasy dungeon crawler item, detailed and atmospheric.`;
                }

                if (imagePrompt) {
                    const b64Data = await generateImage(imagePrompt);
                    if (b64Data) {
                        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
                        const filepath = path.join(IMAGES_DIR, filename);
                        fs.writeFileSync(filepath, Buffer.from(b64Data, 'base64'));
                        imageUrl = `/images/${filename}`;
                        console.log('[Pipeline] Image saved:', imageUrl);
                    }
                }
            } catch (imgErr) {
                console.error('[Pipeline] Image generation error (non-fatal):', imgErr.message);
            }

            // Save achievement to player if awarded
            if (achievement) {
                updatedPlayer.achievements = updatedPlayer.achievements || [];
                updatedPlayer.achievements.push(achievement);

                if (achievement.tier) {
                    const boxId = `${achievement.tier.toLowerCase()}_lootbox`;
                    const boxItem = await getDoc('items', boxId);
                    if (boxItem) {
                        updatedPlayer.inventory = updatedPlayer.inventory || [];
                        updatedPlayer.inventory.push({ ...boxItem });
                        events.push({
                            type: 'item_pickup',
                            itemId: boxItem.itemId,
                            itemName: boxItem.name,
                            itemType: boxItem.type,
                            itemTier: boxItem.tier,
                        });
                    }
                }
            }

            // Apply bonus XP if awarded
            if (bonusXp) {
                updatedPlayer.xp += bonusXp.amount;
                events.push({ type: 'bonus_xp', amount: bonusXp.amount, reason: bonusXp.reason, totalXp: updatedPlayer.xp });

                const levelUpEvents = checkLevelUp(updatedPlayer);
                events.push(...levelUpEvents);
            }

            // check for map
            const mapEvent = events.find(e => e.type === 'map_display');

            // Persist player if achievement or bonus XP changed state
            if (achievement || bonusXp) {
                await playerState.savePlayer(updatedPlayer);
            }

            // --- 5. Agent 4: Game Master compiles final output ---
            const finalText = await compileFinalOutput(events, worldDescription, flavorText, inspectionText, achievement, updatedPlayer);
            return { text: finalText, events, achievement, player: updatedPlayer, mapString: mapEvent?.mapString, imageUrl };
        } else {
            // check for map
            const mapEvent = events.find(e => e.type === 'map_display');

            // Fallback mode — no LLM, use template formatting
            const finalText = compileFallbackOutput(events, null, null, null, null, updatedPlayer);
            return { text: finalText, events, achievement: null, player: updatedPlayer, mapString: mapEvent?.mapString, imageUrl: null };
        }

    } catch (err) {
        console.error('[Pipeline] Error:', err);
        return { text: `❌ An error occurred: ${err.message}`, events: [], achievement: null, player: null };
    }
}

module.exports = { runPipeline };
