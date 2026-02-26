// ============================================================
// GAME ENGINE — Core game loop orchestrator
// All methods are async (Firestore reads/writes)
// ============================================================
const { getDoc, setDoc, updateDoc: updateFirestoreDoc, queryCollection } = require('../firebase');
const { resolveCombat, resolveEnemyAttack } = require('./combat');
const playerState = require('./playerState');
const rules = require('../data/rules');

/**
 * Process a parsed action intent and return game events.
 * @param {string} playerId
 * @param {object} intent - { action, target?, direction?, weapon?, context? }
 * @returns {object} { events: [], player, nodeData? }
 */
async function processAction(playerId, intent) {
    const player = await playerState.loadPlayer(playerId);
    if (!player) {
        return { events: [{ type: 'error', message: 'Player not found.' }], player: null };
    }
    if (!player.alive) {
        return { events: [{ type: 'error', message: 'You are dead. Your journey has ended.' }], player };
    }

    // Initialize missing statistics for legacy players
    if (!player.statistics) {
        player.statistics = { lootboxesOpened: 0, entitiesKilled: 0 };
    }
    // Initialize skills for legacy players
    if (!player.skills) {
        player.skills = rules.createStartingSkills();
    }

    let result = null;

    switch (intent.action) {
        case 'move':
            result = await handleMove(player, intent);
            break;
        case 'look':
            result = await handleLook(player);
            break;
        case 'attack':
            result = await handleAttack(player, intent);
            break;
        case 'pickup':
            result = await handlePickup(player, intent);
            break;
        case 'use':
            result = await handleUse(player, intent);
            break;
        case 'equip':
            result = await handleEquip(player, intent);
            break;
        case 'inventory':
            result = await handleInventory(player);
            break;
        case 'stats':
            result = await handleStats(player);
            break;
        case 'map':
            result = await handleMap(player);
            break;
        case 'allocate':
            result = await handleAllocateStat(player, intent);
            break;
        case 'open':
            result = await handleOpenLootbox(player, intent);
            break;
        case 'inspect':
            result = await handleInspect(player, intent);
            break;
        case 'talk':
            result = await handleTalk(player, intent);
            break;
        case 'flee':
            result = await handleFlee(player);
            break;
        case 'unknown':
            result = {
                events: [{ type: 'unknown_action', text: intent.text }],
                player,
            };
            break;
        default:
            result = {
                events: [{ type: 'error', message: `Unknown action: "${intent.action}". Try: move, look, attack, pickup, use, equip, inventory, stats, map, talk.` }],
                player,
            };
            break;
    }

    // == MOB AGGRO TICK ==
    // If the player is still alive, let hostile entities in the same room attack them.
    if (result.player && result.player.alive && intent.action !== 'move') {
        const currentNode = await getDoc('nodes', result.player.location);
        if (currentNode && currentNode.entities && currentNode.entities.length > 0) {

            // Check if player attacked a specific target this turn, they shouldn't attack twice
            const combatEvent = result.events.find(e => e.type === 'player_attack');
            const targetedEntityId = combatEvent ? combatEvent.targetId : null;

            let playerWasAttacked = false;

            for (const entityId of currentNode.entities) {
                // Don't process the entity the player just attacked (combat.js already handled retaliation)
                if (entityId === targetedEntityId) continue;

                const entity = await getDoc('entities', entityId);
                if (!entity || entity.hp <= 0) continue;

                // Only aggressive entities attack. Hardcode merchants/guides to ignore player.
                if (entity.entityClass === 'Merchant' || entity.entityClass === 'TutorialGuide') continue;

                // Entity attacks the player
                const aggroResult = resolveEnemyAttack(result.player, entity);
                result.events.push(...aggroResult.events);
                playerWasAttacked = true;

                if (aggroResult.playerDead) {
                    result.player.alive = false;
                    break; // Stop processing further attacks if dead
                }
            }

            if (playerWasAttacked) {
                await playerState.savePlayer(result.player);
            }
        }
    }

    return result;
}

// --- MOVEMENT ---
async function handleMove(player, intent) {
    const events = [];
    const currentNode = await getDoc('nodes', player.location);

    if (!currentNode) {
        events.push({ type: 'error', message: 'Current location not found in database.' });
        return { events, player };
    }

    const direction = intent.direction;
    if (!direction || !currentNode.connections[direction]) {
        const exits = Object.entries(currentNode.connections)
            .filter(([, v]) => v !== null)
            .map(([k]) => k.toUpperCase())
            .join(', ');
        events.push({ type: 'error', message: `You can't go ${direction || 'that way'}. Exits: ${exits}` });
        return { events, player };
    }

    const newNodeId = currentNode.connections[direction];
    const newNode = await getDoc('nodes', newNodeId);

    if (!newNode) {
        events.push({ type: 'error', message: 'Destination node not found.' });
        return { events, player };
    }

    // Update player location
    player.location = newNodeId;
    if (!player.explored) player.explored = [currentNode.nodeId];
    if (!player.explored.includes(newNodeId)) {
        player.explored.push(newNodeId);
    }

    // Apply hazard damage (Traps)
    // 15% chance per hazard level to trigger a trap upon entry
    if (newNode.hazardLevel > 0) {
        // --- Sense Danger skill check ---
        const senseDangerLevel = playerState.getSkillLevel(player, 'senseDanger');
        const dangerCheck = rules.rollSkillCheck(senseDangerLevel, player.stats.wis, 55 + newNode.hazardLevel * 10);

        if (dangerCheck.success) {
            events.push({
                type: 'skill_check',
                skillName: 'Sense Danger',
                result: 'success',
                roll: dangerCheck.roll,
                threshold: dangerCheck.threshold,
                detail: 'Something feels wrong about this place...',
            });
            // Skill level-up check
            if (rules.checkSkillLevelUp(senseDangerLevel)) {
                player.skills.senseDanger = (player.skills.senseDanger || 1) + 1;
                events.push({ type: 'skill_level_up', skillName: 'Sense Danger', newLevel: player.skills.senseDanger });
            }
        }

        const trapChance = newNode.hazardLevel * 0.15;
        if (Math.random() < trapChance) {
            const hazardDmg = rules.calculateHazardDamage(newNode.hazardLevel);
            player.hp = Math.max(0, player.hp - hazardDmg);
            events.push({
                type: 'hazard_damage',
                damage: hazardDmg,
                hazardLevel: newNode.hazardLevel,
                playerHp: player.hp,
                playerMaxHp: player.maxHp,
            });

            if (player.hp <= 0) {
                player.alive = false;
                events.push({ type: 'player_death', killedBy: 'a hidden trap' });
            }
        }
    }

    // RNG Item Spawning (The "Scavenge" System)
    // Base 25% chance, boosted by scavenge skill (+2% per level)
    if (player.alive) {
        const scavengeLevel = playerState.getSkillLevel(player, 'scavenge');
        const spawnChance = 0.25 + (scavengeLevel * 0.02);
        if (Math.random() < spawnChance) {
            const allItems = await queryCollection('items');
            if (allItems && allItems.length > 0) {
                const spawnableItems = allItems.filter(i => !i.isCustom);
                if (spawnableItems.length > 0) {
                    const newItemId = rules.rollRandomItemByRarity(spawnableItems);
                    if (newItemId) {
                        if (!newNode.items) newNode.items = [];
                        newNode.items.push(newItemId);
                        // Commit the node update early since we modified items
                        await setDoc('nodes', newNode.nodeId, newNode);

                        const spawnedItem = spawnableItems.find(i => i.itemId === newItemId);
                        events.push({
                            type: 'item_spawn',
                            itemName: spawnedItem.name,
                            itemType: spawnedItem.type,
                            itemTier: spawnedItem.tier
                        });

                        // Skill level-up check for scavenge
                        if (rules.checkSkillLevelUp(scavengeLevel)) {
                            player.skills.scavenge = (player.skills.scavenge || 1) + 1;
                            events.push({ type: 'skill_level_up', skillName: 'Scavenge', newLevel: player.skills.scavenge });
                        }
                    }
                }
            }
        }
    }

    events.push({
        type: 'move',
        from: currentNode.nodeId,
        to: newNode.nodeId,
        direction,
        context: intent.context || null,
    });

    // Add the look event for the new room
    const lookEvents = await buildLookEvents(newNode);
    events.push(...lookEvents);

    playerState.addEvent(player, { type: 'move', to: newNodeId });
    await playerState.savePlayer(player);

    return { events, player, nodeData: newNode };
}

// --- LOOK ---
async function handleLook(player) {
    const node = await getDoc('nodes', player.location);
    if (!node) {
        return { events: [{ type: 'error', message: 'Location data missing.' }], player };
    }
    const events = await buildLookEvents(node);
    return { events, player, nodeData: node };
}

async function buildLookEvents(node) {
    const events = [];

    // Resolve entity names
    const entitiesPresent = [];
    for (const entityId of (node.entities || [])) {
        const entity = await getDoc('entities', entityId);
        if (entity && entity.hp > 0) {
            entitiesPresent.push({ entityId: entity.entityId, name: entity.name, entityClass: entity.entityClass, actionTags: entity.actionTags });
        }
    }

    // Resolve item names
    const itemsPresent = [];
    for (const itemId of (node.items || [])) {
        const item = await getDoc('items', itemId);
        if (item) {
            itemsPresent.push({ itemId: item.itemId, name: item.name, type: item.type, tier: item.tier });
        }
    }

    const exits = Object.entries(node.connections)
        .filter(([, v]) => v !== null)
        .map(([k]) => k.toUpperCase());

    events.push({
        type: 'room_description',
        nodeId: node.nodeId,
        zoneType: node.zoneType,
        baseDescription: node.baseDescription,
        hazardLevel: node.hazardLevel,
        entities: entitiesPresent,
        items: itemsPresent,
        exits,
    });

    return events;
}

// --- ATTACK ---
async function handleAttack(player, intent) {
    const events = [];
    const node = await getDoc('nodes', player.location);

    // Find target entity in current node
    const targetId = intent.target;
    let targetEntityId = null;

    // Try exact match first, then partial name match
    for (const eid of (node.entities || [])) {
        if (eid === targetId) {
            targetEntityId = eid;
            break;
        }
    }

    // If no exact match, search by partial name
    if (!targetEntityId) {
        for (const eid of (node.entities || [])) {
            const entity = await getDoc('entities', eid);
            if (entity && entity.name.toLowerCase().includes((targetId || '').toLowerCase())) {
                targetEntityId = eid;
                break;
            }
        }
    }

    if (!targetEntityId) {
        events.push({ type: 'error', message: `No target "${targetId}" found here.` });
        return { events, player };
    }

    const entity = await getDoc('entities', targetEntityId);
    if (!entity || entity.hp <= 0) {
        events.push({ type: 'error', message: `${targetId} is already dead.` });
        return { events, player };
    }

    // Resolve combat
    const result = resolveCombat(player, entity);
    events.push(...result.events);

    // If entity died, award XP and roll loot
    if (result.entityDead) {
        player.statistics.entitiesKilled = (player.statistics.entitiesKilled || 0) + 1;
        const xpGained = entity.xpReward || 0;
        player.xp += xpGained;
        events.push({ type: 'xp_gained', amount: xpGained, totalXp: player.xp });

        // Check level up
        const levelUpEvents = checkLevelUp(player);
        events.push(...levelUpEvents);

        // Roll loot
        if (entity.lootTableId) {
            const lootTable = await getDoc('lootTables', entity.lootTableId);
            if (lootTable) {
                const lootItemId = rules.rollLoot(lootTable);
                const lootItem = await getDoc('items', lootItemId);
                if (lootItem) {
                    // Add to room items
                    node.items = node.items || [];
                    node.items.push(lootItemId);
                    await setDoc('nodes', node.nodeId, node);
                    events.push({
                        type: 'loot_dropped',
                        itemId: lootItem.itemId,
                        itemName: lootItem.name,
                        itemTier: lootItem.tier,
                    });
                }
            }
        }

        // Remove entity from node if it doesn't respawn
        if (!entity.respawns) {
            node.entities = (node.entities || []).filter(e => e !== targetEntityId);
            await setDoc('nodes', node.nodeId, node);
        }

        // Persist entity death
        await setDoc('entities', entity.entityId, entity);
    } else {
        // Persist entity health reduction when they survive an attack
        await setDoc('entities', entity.entityId, entity);
    }

    if (result.playerDead) {
        player.alive = false;
    }

    playerState.addEvent(player, { type: 'combat', target: entity.name, result: result.entityDead ? 'kill' : 'hit' });
    await playerState.savePlayer(player);

    return { events, player };
}

// --- PICKUP ---
async function handlePickup(player, intent) {
    const events = [];
    const node = await getDoc('nodes', player.location);
    const capacity = playerState.getInventoryCapacity(player);

    if (player.inventory.length >= capacity) {
        events.push({ type: 'error', message: `Inventory full (${capacity} slots). Drop or use something first.` });
        return { events, player };
    }

    // Find item in room
    const targetItemId = intent.target;
    let foundIndex = -1;

    for (let i = 0; i < (node.items || []).length; i++) {
        if (node.items[i] === targetItemId) {
            foundIndex = i;
            break;
        }
        // Partial name or ID match
        const item = await getDoc('items', node.items[i]);
        if (item) {
            const searchStr = (targetItemId || '').toLowerCase().replace(/[\s_]/g, '');
            const objName = item.name.toLowerCase().replace(/[\s_]/g, '');
            const objId = item.itemId.toLowerCase().replace(/[\s_]/g, '');
            if (objName.includes(searchStr) || objId.includes(searchStr)) {
                foundIndex = i;
                break;
            }
        }
    }

    if (foundIndex === -1) {
        events.push({ type: 'error', message: `No item "${targetItemId}" found here.` });
        return { events, player };
    }

    const itemId = node.items[foundIndex];
    const item = await getDoc('items', itemId);

    // Remove from room, add to inventory
    node.items.splice(foundIndex, 1);
    await setDoc('nodes', node.nodeId, node);

    player.inventory.push({ ...item });

    events.push({
        type: 'item_pickup',
        itemId: item.itemId,
        itemName: item.name,
        itemType: item.type,
        itemTier: item.tier,
    });

    playerState.addEvent(player, { type: 'pickup', item: item.name });
    await playerState.savePlayer(player);

    return { events, player };
}

// --- USE (consumables) ---
async function handleUse(player, intent) {
    const events = [];
    const targetItemId = intent.target;

    const searchStr = (targetItemId || '').toLowerCase().replace(/[\s_]/g, '');
    const idx = player.inventory.findIndex(i => {
        const objName = i.name.toLowerCase().replace(/[\s_]/g, '');
        const objId = i.itemId.toLowerCase().replace(/[\s_]/g, '');
        return objName.includes(searchStr) || objId.includes(searchStr);
    });

    if (idx === -1) {
        events.push({ type: 'error', message: `You don't have "${targetItemId}" in your inventory.` });
        return { events, player };
    }

    const item = player.inventory[idx];
    if (item.type !== 'consumable') {
        events.push({ type: 'error', message: `${item.name} is not consumable. Try "equip" for gear.` });
        return { events, player };
    }

    // Apply consumable effect
    if (item.stats.healAmount) {
        const healAmount = Math.min(item.stats.healAmount, player.maxHp - player.hp);
        player.hp += healAmount;
        events.push({
            type: 'item_used',
            itemName: item.name,
            effect: 'heal',
            amount: healAmount,
            playerHp: player.hp,
            playerMaxHp: player.maxHp,
        });
    }

    // Remove from inventory
    player.inventory.splice(idx, 1);

    playerState.addEvent(player, { type: 'use', item: item.name });
    await playerState.savePlayer(player);

    return { events, player };
}

// --- EQUIP ---
async function handleEquip(player, intent) {
    const events = [];
    const targetItemId = intent.target;

    const searchStr = (targetItemId || '').toLowerCase().replace(/[\s_]/g, '');
    const idx = player.inventory.findIndex(i => {
        const objName = i.name.toLowerCase().replace(/[\s_]/g, '');
        const objId = i.itemId.toLowerCase().replace(/[\s_]/g, '');
        return objName.includes(searchStr) || objId.includes(searchStr);
    });

    if (idx === -1) {
        events.push({ type: 'error', message: `You don't have "${targetItemId}" in your inventory.` });
        return { events, player };
    }

    const item = player.inventory[idx];
    if (!item.slot && item.type === 'weapon') item.slot = 'weapon';
    if (!item.slot) {
        events.push({ type: 'error', message: `${item.name} cannot be equipped.` });
        return { events, player };
    }

    // Unequip current item in that slot -> inventory
    const currentEquipped = player.equipment[item.slot];
    if (currentEquipped) {
        player.inventory.push(currentEquipped);
        events.push({ type: 'item_unequipped', itemName: currentEquipped.name, slot: item.slot });
    }

    // Equip new item
    player.equipment[item.slot] = item;
    player.inventory.splice(idx, 1);

    // Recalculate maxHp if CON-related equipment (future-proof)
    player.maxHp = rules.calculateMaxHp(player.level, player.stats.con);

    events.push({
        type: 'item_equipped',
        itemName: item.name,
        itemType: item.type,
        slot: item.slot,
        stats: item.stats,
    });

    playerState.addEvent(player, { type: 'equip', item: item.name });
    await playerState.savePlayer(player);

    return { events, player };
}

// --- INVENTORY ---
async function handleInventory(player) {
    const capacity = playerState.getInventoryCapacity(player);
    return {
        events: [{
            type: 'inventory_list',
            inventory: player.inventory.map(i => ({ name: i.name, type: i.type, tier: i.tier })),
            equipment: {
                weapon: player.equipment.weapon ? player.equipment.weapon.name : 'None',
                head: player.equipment.head ? player.equipment.head.name : 'None',
                chest: player.equipment.chest ? player.equipment.chest.name : 'None',
                feet: player.equipment.feet ? player.equipment.feet.name : 'None',
            },
            used: player.inventory.length,
            capacity,
        }],
        player,
    };
}

// --- STATS ---
async function handleStats(player) {
    return {
        events: [{
            type: 'stats_display',
            name: player.name,
            level: player.level,
            xp: player.xp,
            xpToNext: rules.xpToNextLevel(player.level),
            hp: player.hp,
            maxHp: player.maxHp,
            stats: player.stats,
            skills: player.skills || rules.createStartingSkills(),
            attack: playerState.getPlayerAttack(player),
            defense: playerState.getPlayerDefense(player),
            statPointsAvailable: player.statPointsAvailable || 0,
        }],
        player,
    };
}

// --- MAP ---
async function handleMap(player) {
    if (!player.explored) {
        player.explored = [player.location];
        await playerState.savePlayer(player);
    }
    const explored = player.explored;

    // Helper to format a room name or hide it if unexplored
    const getRoomName = (nodeId) => {
        if (!nodeId) return '      ';
        if (nodeId === player.location) return '[*YOU*]';
        if (explored.includes(nodeId)) {
            // Abbreviate known room names to fit in a small box
            let name = nodeId.replace(/_/g, ' ');
            if (name.length > 7) name = name.substring(0, 7);
            return `[${name.padEnd(7)}]`;
        }
        return ' [???] ';
    };

    // Very simple localized ASCII rendering of the known layout.
    // We'll hardcode the grid layout based on seedData for now as a minimap.

    // Y coords: Higher is North
    // X coords: Higher is East
    // Grid structure from seedData:
    // (0, 3)                         [Server]
    //                                   |
    // (0, 2)     [Janitor] - [Ruined Mkt] - [Corridor N] - [Safe Room]
    //                                   |                      |
    // (0, 1) [Parking] - [Entrance Plaza] - [Coll Al] - [Stairwell E]
    //            |                                              |
    // (0, 0) [Subway Ent] - [Subway Plat]              [Maint Tunnel]

    // We'll just build an ASCII string for it that reveals explored nodes.
    const mapRows = [
        "       " + getRoomName('server_room'),
        "          | ",
        getRoomName('janitor_closet') + "-" + getRoomName('corridor_north') + "-" + getRoomName('safe_room_01'),
        "          |        | ",
        getRoomName('parking_garage') + "-" + getRoomName('entrance_plaza') + "-" + getRoomName('collapsed_alley') + "-" + getRoomName('stairwell_east'),
        "   |                       | ",
        getRoomName('subway_entrance') + "-" + getRoomName('subway_platform') + "       " + getRoomName('maintenance_tunnel')
    ];

    // Note: The grid isn't a perfect 2D map based on the seed data connections since 
    // it's a graph that doesn't strictly align, but this represents the basic topological layout.
    // For example ruined_market is North of entrance_plaza, and corridor_north is north of ruined_market.

    const trueMapRows = [
        "            " + getRoomName('server_room'),
        "               | ",
        getRoomName('janitor_closet') + " - " + getRoomName('corridor_north') + " - " + getRoomName('safe_room_01'),
        "               |              | ",
        "            " + getRoomName('ruined_market') + " - - - - - +",
        "               |              | ",
        getRoomName('parking_garage') + " - " + getRoomName('entrance_plaza') + " - " + getRoomName('collapsed_alley') + " -" + getRoomName('stairwell_east'),
        "   |                                  | ",
        getRoomName('subway_entrance') + " - " + getRoomName('subway_platform') + "          " + getRoomName('maintenance_tunnel')
    ];

    return {
        events: [{
            type: 'map_display',
            mapString: '\n' + trueMapRows.join('\n'),
        }],
        player,
    };
}

// --- ALLOCATE STAT ---
async function handleAllocateStat(player, intent) {
    const events = [];
    if (!player.statPointsAvailable || player.statPointsAvailable <= 0) {
        events.push({ type: 'error', message: 'No stat points available.' });
        return { events, player };
    }

    const result = rules.allocateStatPoint(player.stats, intent.target);
    if (!result.success) {
        events.push({ type: 'error', message: result.error });
        return { events, player };
    }

    player.stats = result.stats;
    player.statPointsAvailable -= 1;
    player.maxHp = rules.calculateMaxHp(player.level, player.stats.con);

    events.push({
        type: 'stat_allocated',
        stat: intent.target,
        newValue: player.stats[intent.target],
        statPointsRemaining: player.statPointsAvailable,
    });

    await playerState.savePlayer(player);
    return { events, player };
}

// --- OPEN LOOTBOX ---
async function handleOpenLootbox(player, intent) {
    const events = [];
    const targetItemId = intent.target;

    const searchStr = (targetItemId || '').toLowerCase().replace(/[\s_]/g, '');
    const idx = player.inventory.findIndex(i => {
        if (i.type !== 'lootbox') return false;
        const objName = i.name.toLowerCase().replace(/[\s_]/g, '');
        const objId = i.itemId.toLowerCase().replace(/[\s_]/g, '');
        return objName.includes(searchStr) || objId.includes(searchStr);
    });

    if (idx === -1) {
        events.push({ type: 'error', message: `No loot box "${targetItemId}" in inventory.` });
        return { events, player };
    }

    const box = player.inventory[idx];
    const lootTableId = `lootbox_${box.tier}`;
    const lootTable = await getDoc('lootTables', lootTableId);

    if (!lootTable) {
        events.push({ type: 'error', message: `Loot table for ${box.tier} not found.` });
        return { events, player };
    }

    // Roll loot
    const lootItemId = rules.rollLoot(lootTable);
    const lootItem = await getDoc('items', lootItemId);

    // Remove lootbox from inventory
    player.inventory.splice(idx, 1);

    if (lootItem) {
        player.inventory.push({ ...lootItem });
        events.push({
            type: 'lootbox_opened',
            boxName: box.name,
            boxTier: box.tier,
            receivedItem: lootItem.name,
            receivedTier: lootItem.tier,
            receivedType: lootItem.type,
        });
    }

    // Award XP for opening the loot box
    player.statistics.lootboxesOpened = (player.statistics.lootboxesOpened || 0) + 1;
    const lootboxXp = rules.lootboxXpReward(box.tier);
    player.xp += lootboxXp;
    events.push({ type: 'lootbox_xp', amount: lootboxXp, tier: box.tier, totalXp: player.xp });

    // Check for level-up from lootbox XP
    const levelUpEvents = checkLevelUp(player);
    events.push(...levelUpEvents);

    playerState.addEvent(player, { type: 'open_lootbox', box: box.name, received: lootItem ? lootItem.name : 'nothing' });
    await playerState.savePlayer(player);

    return { events, player };
}

// --- TALK ---
async function handleTalk(player, intent) {
    const events = [];
    const node = await getDoc('nodes', player.location);
    const targetId = intent.target;

    let targetEntity = null;
    for (const eid of (node.entities || [])) {
        const entity = await getDoc('entities', eid);
        if (entity && (eid === targetId || entity.name.toLowerCase().includes((targetId || '').toLowerCase()))) {
            targetEntity = entity;
            break;
        }
    }

    if (!targetEntity) {
        events.push({ type: 'error', message: `Nobody named "${targetId}" here to talk to.` });
        return { events, player };
    }

    if (!targetEntity.dialogue || targetEntity.dialogue.length === 0) {
        events.push({
            type: 'talk',
            entityName: targetEntity.name,
            message: `${targetEntity.name} stares at you blankly.It doesn't seem interested in conversation.`,
        });
    } else {
        const line = targetEntity.dialogue[Math.floor(Math.random() * targetEntity.dialogue.length)];
        events.push({
            type: 'talk',
            entityName: targetEntity.name,
            entityClass: targetEntity.entityClass,
            message: line,
            actionTags: targetEntity.actionTags,
        });
    }

    return { events, player };
}

// --- INSPECT ---
async function handleInspect(player, intent) {
    const events = [];
    const targetId = intent.target;

    if (!targetId) {
        events.push({ type: 'error', message: 'Inspect what?' });
        return { events, player };
    }

    const searchStr = targetId.toLowerCase().replace(/[\s_]/g, '');
    let foundItem = null;

    // 1. Check inventory
    const inventoryItem = player.inventory.find(i => {
        const objName = i.name.toLowerCase().replace(/[\s_]/g, '');
        const objId = i.itemId.toLowerCase().replace(/[\s_]/g, '');
        return objName.includes(searchStr) || objId.includes(searchStr);
    });

    if (inventoryItem) {
        foundItem = inventoryItem;
    } else {
        // 2. Check room
        const node = await getDoc('nodes', player.location);
        for (const itemId of (node.items || [])) {
            const roomItem = await getDoc('items', itemId);
            if (roomItem) {
                const objName = roomItem.name.toLowerCase().replace(/[\s_]/g, '');
                const objId = roomItem.itemId.toLowerCase().replace(/[\s_]/g, '');
                if (objName.includes(searchStr) || objId.includes(searchStr)) {
                    foundItem = roomItem;
                    break;
                }
            }
        }
    }

    if (!foundItem) {
        events.push({ type: 'error', message: `No item matching "${targetId}" found in inventory or room.` });
        return { events, player };
    }

    // Fire the inspection event
    events.push({
        type: 'item_inspected',
        item: foundItem
    });

    return { events, player };
}

// --- FLEE (skill-checked combat escape) ---
async function handleFlee(player) {
    const events = [];
    const node = await getDoc('nodes', player.location);

    // Check if there are hostile entities to flee from
    const hostileEntities = [];
    for (const eid of (node.entities || [])) {
        const entity = await getDoc('entities', eid);
        if (entity && entity.hp > 0 && entity.entityClass !== 'Merchant' && entity.entityClass !== 'TutorialGuide') {
            hostileEntities.push(entity);
        }
    }

    if (hostileEntities.length === 0) {
        events.push({ type: 'error', message: 'Nothing to flee from. You can just walk out.' });
        return { events, player };
    }

    // Get available exits
    const exits = Object.entries(node.connections).filter(([, v]) => v !== null);
    if (exits.length === 0) {
        events.push({ type: 'error', message: 'No exits! You\'re trapped.' });
        return { events, player };
    }

    // Roll flee skill check — base difficulty 70 (hard!)
    const fleeLevel = playerState.getSkillLevel(player, 'flee');
    const check = rules.rollSkillCheck(fleeLevel, player.stats.dex, 70);

    events.push({
        type: 'skill_check',
        skillName: 'Flee',
        result: check.success ? 'success' : 'fail',
        roll: check.roll,
        threshold: check.threshold,
        detail: check.success ? 'You break free and sprint for the exit!' : 'You stumble! The enemies close in...',
    });

    if (check.success) {
        // Skill level-up check
        if (rules.checkSkillLevelUp(fleeLevel)) {
            player.skills = player.skills || {};
            player.skills.flee = (player.skills.flee || 1) + 1;
            events.push({ type: 'skill_level_up', skillName: 'Flee', newLevel: player.skills.flee });
        }

        // Move to a random connected room
        const [direction, targetNodeId] = exits[Math.floor(Math.random() * exits.length)];
        const newNode = await getDoc('nodes', targetNodeId);

        if (newNode) {
            player.location = targetNodeId;
            if (!player.explored) player.explored = [];
            if (!player.explored.includes(targetNodeId)) {
                player.explored.push(targetNodeId);
            }

            events.push({
                type: 'move',
                from: node.nodeId,
                to: targetNodeId,
                direction,
                context: 'Fled in a panic!',
            });

            const lookEvents = await buildLookEvents(newNode);
            events.push(...lookEvents);
        }

        playerState.addEvent(player, { type: 'flee', result: 'success' });
        await playerState.savePlayer(player);
    } else {
        // Failed flee — take a hit from the nearest hostile
        const attacker = hostileEntities[0];
        const aggroResult = resolveEnemyAttack(player, attacker);
        events.push(...aggroResult.events);

        if (aggroResult.playerDead) {
            player.alive = false;
        }

        playerState.addEvent(player, { type: 'flee', result: 'fail' });
        await playerState.savePlayer(player);
    }

    return { events, player };
}

// --- LEVEL UP CHECK ---
function checkLevelUp(player) {
    const events = [];
    while (player.xp >= rules.xpToNextLevel(player.level)) {
        player.xp -= rules.xpToNextLevel(player.level);
        player.level += 1;
        player.statPointsAvailable = (player.statPointsAvailable || 0) + rules.STAT_POINTS_PER_LEVEL;
        player.maxHp = rules.calculateMaxHp(player.level, player.stats.con);
        player.hp = player.maxHp; // Full heal on level up

        events.push({
            type: 'level_up',
            newLevel: player.level,
            statPointsAvailable: player.statPointsAvailable,
            newMaxHp: player.maxHp,
        });
    }
    return events;
}

module.exports = { processAction, checkLevelUp };
