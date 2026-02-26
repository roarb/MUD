// ============================================================
// COMBAT ENGINE — Deterministic combat resolution
// ============================================================
const rules = require('../data/rules');
const { getPlayerAttack, getPlayerDefense } = require('./playerState');

/**
 * Resolve a round of combat between player and entity.
 * Returns an event log of what happened.
 */
function resolveCombat(player, entity) {
    const events = [];

    // --- Player attacks entity ---
    const weaponAttack = getPlayerAttack(player);
    const playerDamage = rules.calculateDamage(weaponAttack, player.stats.str, entity.defense);

    entity.hp = Math.max(0, entity.hp - playerDamage);
    events.push({
        type: 'player_attack',
        damage: playerDamage,
        targetId: entity.entityId,
        targetName: entity.name,
        targetHp: entity.hp,
        targetMaxHp: entity.maxHp,
        weaponUsed: player.equipment.weapon ? player.equipment.weapon.name : 'bare fists',
    });

    // Check if entity died
    if (entity.hp <= 0) {
        events.push({
            type: 'entity_killed',
            entityId: entity.entityId,
            entityName: entity.name,
            entityClass: entity.entityClass,
            actionTags: entity.actionTags,
            xpReward: entity.xpReward || 0,
        });
        return { events, entityDead: true, playerDead: false };
    }

    // --- Entity attacks player ---
    const playerDefense = getPlayerDefense(player);
    const entityDamage = rules.calculateDamage(entity.attack, 10, playerDefense); // entities use base STR of 10

    player.hp = Math.max(0, player.hp - entityDamage);
    events.push({
        type: 'entity_attack',
        damage: entityDamage,
        attackerName: entity.name,
        attackerTags: entity.actionTags,
        playerHp: player.hp,
        playerMaxHp: player.maxHp,
    });

    // Check if player died
    if (player.hp <= 0) {
        events.push({
            type: 'player_death',
            killedBy: entity.name,
        });
        return { events, entityDead: false, playerDead: true };
    }

    return { events, entityDead: false, playerDead: false };
}

/**
 * Resolve a single attack from an entity against a player.
 * Used for independent mob aggression.
 */
function resolveEnemyAttack(player, entity) {
    const events = [];

    const playerDefense = getPlayerDefense(player);
    const entityDamage = rules.calculateDamage(entity.attack, 10, playerDefense);

    player.hp = Math.max(0, player.hp - entityDamage);
    events.push({
        type: 'entity_attack',
        damage: entityDamage,
        attackerName: entity.name,
        attackerTags: entity.actionTags,
        playerHp: player.hp,
        playerMaxHp: player.maxHp,
    });

    if (player.hp <= 0) {
        events.push({
            type: 'player_death',
            killedBy: entity.name,
        });
        return { events, playerDead: true };
    }

    return { events, playerDead: false };
}

module.exports = { resolveCombat, resolveEnemyAttack };
