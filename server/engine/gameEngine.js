// ============================================================
// GAME ENGINE — Core game loop orchestrator
// All methods are async (Firestore reads/writes)
// ============================================================
const { getDoc, setDoc, updateDoc: updateFirestoreDoc, queryCollection } = require('../firebase');
const { resolveCombat } = require('./combat');
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

    switch (intent.action) {
        case 'move':
            return await handleMove(player, intent);
        case 'look':
            return await handleLook(player);
        case 'attack':
            return await handleAttack(player, intent);
        case 'pickup':
            return await handlePickup(player, intent);
        case 'use':
            return await handleUse(player, intent);
        case 'equip':
            return await handleEquip(player, intent);
        case 'inventory':
            return await handleInventory(player);
        case 'stats':
            return await handleStats(player);
        case 'allocate':
            return await handleAllocateStat(player, intent);
        case 'open':
            return await handleOpenLootbox(player, intent);
        case 'talk':
            return await handleTalk(player, intent);
        default:
            return {
                events: [{ type: 'error', message: `Unknown action: "${intent.action}". Try: move, look, attack, pickup, use, equip, inventory, stats, talk.` }],
                player,
            };
    }
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

    // Apply hazard damage
    const hazardDmg = rules.calculateHazardDamage(newNode.hazardLevel);
    if (hazardDmg > 0) {
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
            events.push({ type: 'player_death', killedBy: 'environmental hazard' });
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
        // Partial name match
        const item = await getDoc('items', node.items[i]);
        if (item && item.name.toLowerCase().includes((targetItemId || '').toLowerCase())) {
            foundIndex = i;
            break;
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

    // Find in inventory
    const idx = player.inventory.findIndex(i =>
        i.itemId === targetItemId ||
        i.name.toLowerCase().includes((targetItemId || '').toLowerCase())
    );

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

    const idx = player.inventory.findIndex(i =>
        i.itemId === targetItemId ||
        i.name.toLowerCase().includes((targetItemId || '').toLowerCase())
    );

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
            attack: playerState.getPlayerAttack(player),
            defense: playerState.getPlayerDefense(player),
            statPointsAvailable: player.statPointsAvailable || 0,
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

    const idx = player.inventory.findIndex(i =>
        (i.itemId === targetItemId || i.name.toLowerCase().includes((targetItemId || '').toLowerCase()))
        && i.type === 'lootbox'
    );

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
            message: `${targetEntity.name} stares at you blankly. It doesn't seem interested in conversation.`,
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

module.exports = { processAction };
