// ============================================================
// AGENT 4: GAME MASTER — The Arbiter
// Compiles numerical outcomes + AI text into final output
// ============================================================
const { callLLM } = require('./llmClient');

const SYSTEM_PROMPT = `You are the Game Master of a text-based dungeon crawler. You compile the final text output that the player sees.

You will receive:
1. GAME EVENTS: Structured data about what happened (damage numbers, HP changes, items found, etc.)
2. WORLD DESCRIPTION: An atmospheric description of the room (from the World Builder)
3. FLAVOR TEXT: Optional sarcastic commentary from the System AI
4. ACHIEVEMENT: Optional achievement notification

YOUR JOB: Combine all of this into a cohesive, well-formatted text block. Follow this structure:

1. Start with the WORLD DESCRIPTION if a new room is being shown.
2. Present GAME EVENTS clearly — damage dealt, damage taken, XP gained, items found. Use specific numbers.
3. Weave in the FLAVOR TEXT naturally after the relevant event.
4. If there's a BONUS XP award (type: bonus_xp), present the System's reason and XP amount with flair.
5. If there's a LOOTBOX XP award (type: lootbox_xp), mention the XP gained from the loot box.
6. If there's an ACHIEVEMENT, present it as an eye-catching notification at the end.
7. End with a brief status line showing HP and location if combat occurred.

FORMATTING RULES:
- Use line breaks to separate sections.
- Mechanical info (damage, HP) should be clear and scannable, not buried in prose.
- Keep the total output under 6-8 sentences.
- Don't add events or information that wasn't in the input.
- Return ONLY the compiled text. No JSON. No labels.`;

/**
 * Compile all agent outputs into the final player-facing text.
 */
async function compileFinalOutput(gameEvents, worldDescription, flavorText, achievement, player) {
    const payload = {
        gameEvents,
        worldDescription: worldDescription || null,
        flavorText: flavorText || null,
        achievement: achievement || null,
        playerStatus: {
            hp: player.hp,
            maxHp: player.maxHp,
            level: player.level,
            location: player.location,
            alive: player.alive,
        },
    };

    const response = await callLLM(SYSTEM_PROMPT, JSON.stringify(payload), {
        temperature: 0.6,
        maxTokens: 400,
    });

    return response;
}

/**
 * Fallback compiler when LLM is not available.
 * Formats game events directly into readable text.
 */
function compileFallbackOutput(gameEvents, worldDescription, flavorText, achievement, player) {
    const lines = [];

    for (const event of gameEvents) {
        switch (event.type) {
            case 'room_description':
                if (worldDescription) {
                    lines.push(worldDescription);
                } else {
                    lines.push(event.baseDescription);
                }
                if (event.entities.length > 0) {
                    lines.push(`Creatures here: ${event.entities.map(e => e.name).join(', ')}`);
                }
                if (event.items.length > 0) {
                    lines.push(`Items on the ground: ${event.items.map(i => i.name).join(', ')}`);
                }
                lines.push(`Exits: ${event.exits.join(', ')}`);
                break;

            case 'move':
                lines.push(`You move ${event.direction.toUpperCase()} to ${event.to}.`);
                break;

            case 'hazard_damage':
                lines.push(`⚠ Environmental hazard! You take ${event.damage} damage. [HP: ${event.playerHp}/${event.playerMaxHp}]`);
                break;

            case 'player_attack':
                lines.push(`You attack ${event.targetName} with ${event.weaponUsed} for ${event.damage} damage! [${event.targetName} HP: ${event.targetHp}/${event.targetMaxHp}]`);
                break;

            case 'entity_attack':
                lines.push(`${event.attackerName} retaliates for ${event.damage} damage! [Your HP: ${event.playerHp}/${event.playerMaxHp}]`);
                break;

            case 'entity_killed':
                lines.push(`☠ ${event.entityName} has been slain!`);
                break;

            case 'xp_gained':
                lines.push(`✦ +${event.amount} XP [Total: ${event.totalXp}]`);
                break;

            case 'level_up':
                lines.push(`⬆ LEVEL UP! You are now level ${event.newLevel}! Max HP: ${event.newMaxHp}. Stat points available: ${event.statPointsAvailable}.`);
                break;

            case 'loot_dropped':
                lines.push(`💎 ${event.itemName} (${event.itemTier}) dropped!`);
                break;

            case 'item_pickup':
                lines.push(`📦 Picked up: ${event.itemName} (${event.itemType}, ${event.itemTier})`);
                break;

            case 'item_used':
                lines.push(`🧪 Used ${event.itemName}: +${event.amount} HP [HP: ${event.playerHp}/${event.playerMaxHp}]`);
                break;

            case 'item_equipped':
                lines.push(`🛡 Equipped: ${event.itemName} → ${event.slot} [${Object.entries(event.stats).map(([k, v]) => `+${v} ${k}`).join(', ')}]`);
                break;

            case 'item_unequipped':
                lines.push(`Unequipped: ${event.itemName} from ${event.slot}`);
                break;

            case 'lootbox_opened':
                lines.push(`🎁 Opened ${event.boxName} (${event.boxTier}) → ${event.receivedItem} (${event.receivedTier})!`);
                break;

            case 'lootbox_xp':
                lines.push(`✦ +${event.amount} XP from ${event.tier} loot box [Total: ${event.totalXp}]`);
                break;

            case 'bonus_xp':
                lines.push(`⚡ BONUS XP: +${event.amount} — ${event.reason}`);
                break;

            case 'inventory_list':
                lines.push(`=== INVENTORY (${event.used}/${event.capacity}) ===`);
                if (event.inventory.length === 0) {
                    lines.push('  (empty)');
                } else {
                    event.inventory.forEach(i => lines.push(`  • ${i.name} [${i.type}, ${i.tier}]`));
                }
                lines.push(`=== EQUIPPED ===`);
                lines.push(`  Weapon: ${event.equipment.weapon}`);
                lines.push(`  Head: ${event.equipment.head}`);
                lines.push(`  Chest: ${event.equipment.chest}`);
                lines.push(`  Feet: ${event.equipment.feet}`);
                break;

            case 'stats_display':
                lines.push(`=== ${event.name} — Level ${event.level} ===`);
                lines.push(`HP: ${event.hp}/${event.maxHp} | XP: ${event.xp}/${event.xpToNext}`);
                lines.push(`STR: ${event.stats.str} | DEX: ${event.stats.dex} | CON: ${event.stats.con}`);
                lines.push(`INT: ${event.stats.int} | WIS: ${event.stats.wis} | CHA: ${event.stats.cha}`);
                lines.push(`Attack: ${event.attack} | Defense: ${event.defense}`);
                if (event.statPointsAvailable > 0) {
                    lines.push(`★ ${event.statPointsAvailable} stat point(s) available! Use "allocate <stat>".`);
                }
                break;

            case 'stat_allocated':
                lines.push(`✦ ${event.stat.toUpperCase()} increased to ${event.newValue}. ${event.statPointsRemaining} points remaining.`);
                break;

            case 'talk':
                lines.push(`${event.entityName}: "${event.message}"`);
                break;

            case 'player_death':
                lines.push(`\n💀 YOU DIED. Killed by ${event.killedBy}.`);
                lines.push(`The System notes your demise with mild amusement.`);
                break;

            case 'error':
                lines.push(`❌ ${event.message}`);
                break;
        }
    }

    // Add flavor text
    if (flavorText) {
        lines.push(`\n[System]: ${flavorText}`);
    }

    // Add achievement
    if (achievement) {
        lines.push('');
        lines.push(`🏆 NEW ACHIEVEMENT: ${achievement.title}`);
        lines.push(`   "${achievement.description}"`);
        lines.push(`   Reward: ${achievement.tier.charAt(0).toUpperCase() + achievement.tier.slice(1)} Loot Box`);
    }

    return lines.join('\n');
}

module.exports = { compileFinalOutput, compileFallbackOutput };
