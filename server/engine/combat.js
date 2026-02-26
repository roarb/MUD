// ============================================================
// COMBAT ENGINE — Deterministic combat resolution + skill checks
// ============================================================
const rules = require('../data/rules');
const { getPlayerAttack, getPlayerDefense, getSkillLevel } = require('./playerState');

/**
 * Resolve a round of combat between player and entity.
 * Returns an event log of what happened.
 */
function resolveCombat(player, entity) {
    const events = [];

    // --- Player attacks entity ---
    let weaponAttack = getPlayerAttack(player);
    const isBareFists = !player.equipment.weapon;

    // Improvise skill: bonus damage when fighting bare-handed
    if (isBareFists) {
        const improviseLevel = getSkillLevel(player, 'improvise');
        const improviseMod = Math.floor(improviseLevel * 0.5);  // +0.5 damage per level
        weaponAttack += improviseMod;
        if (improviseMod > 0) {
            events.push({
                type: 'skill_check',
                skillName: 'Improvise',
                result: 'passive',
                detail: `+${improviseMod} improvised attack bonus`,
            });
        }
    }

    const playerDamage = rules.calculateDamage(weaponAttack, player.stats.str, entity.defense);

    entity.hp = Math.max(0, entity.hp - playerDamage);
    events.push({
        type: 'player_attack',
        damage: playerDamage,
        targetId: entity.entityId,
        targetName: entity.name,
        targetHp: entity.hp,
        targetMaxHp: entity.maxHp,
        weaponUsed: isBareFists ? 'bare fists (improvised)' : player.equipment.weapon.name,
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

    // --- Entity attacks player (with dodge check) ---
    const dodgeResult = rollDodge(player, entity);
    events.push(...dodgeResult.events);

    if (dodgeResult.dodged) {
        // Player dodged — no damage taken
        return { events, entityDead: false, playerDead: false };
    }

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
        events.push({ type: 'player_death', killedBy: entity.name });
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

    // --- Dodge check ---
    const dodgeResult = rollDodge(player, entity);
    events.push(...dodgeResult.events);

    if (dodgeResult.dodged) {
        return { events, playerDead: false };
    }

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
        events.push({ type: 'player_death', killedBy: entity.name });
        return { events, playerDead: true };
    }

    return { events, playerDead: false };
}

/**
 * Roll a dodge skill check against an incoming attack.
 * Base difficulty scales with enemy attack power.
 */
function rollDodge(player, entity) {
    const events = [];
    const dodgeLevel = getSkillLevel(player, 'dodge');
    const baseDifficulty = 65 + Math.floor(entity.attack / 2);  // Harder to dodge strong enemies

    const check = rules.rollSkillCheck(dodgeLevel, player.stats.dex, baseDifficulty);

    if (check.success) {
        events.push({
            type: 'skill_check',
            skillName: 'Dodge',
            result: 'success',
            roll: check.roll,
            threshold: check.threshold,
            detail: `Dodged ${entity.name}'s attack!`,
        });

        // Skill level-up check
        if (rules.checkSkillLevelUp(dodgeLevel)) {
            player.skills = player.skills || {};
            player.skills.dodge = (player.skills.dodge || 1) + 1;
            events.push({
                type: 'skill_level_up',
                skillName: 'Dodge',
                newLevel: player.skills.dodge,
            });
        }

        return { events, dodged: true };
    }

    // Failed dodge — attack proceeds normally (no event for failed dodge to reduce noise)
    return { events, dodged: false };
}

module.exports = { resolveCombat, resolveEnemyAttack };
