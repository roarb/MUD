// Seed Firestore with game data from seedData.js
// Run: node server/data/seedFirestore.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { initFirebase, setDoc } = require('../firebase');
const { MAP_NODES, ENTITIES, ITEMS, LOOT_TABLES } = require('./seedData');

async function seed() {
    const db = initFirebase();
    if (!db) {
        console.error('Firebase not configured. Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_PATH in .env');
        process.exit(1);
    }

    console.log('Seeding Firestore...\n');

    // Seed map nodes
    console.log(`[Nodes] Seeding ${MAP_NODES.length} map nodes...`);
    for (const node of MAP_NODES) {
        await setDoc('nodes', node.nodeId, node);
        console.log(`  ✓ ${node.nodeId} (${node.zoneType})`);
    }

    // Seed entities
    console.log(`\n[Entities] Seeding ${ENTITIES.length} entities...`);
    for (const entity of ENTITIES) {
        await setDoc('entities', entity.entityId, entity);
        console.log(`  ✓ ${entity.entityId} — ${entity.name}`);
    }

    // Seed items
    console.log(`\n[Items] Seeding ${ITEMS.length} items...`);
    for (const item of ITEMS) {
        await setDoc('items', item.itemId, item);
        console.log(`  ✓ ${item.itemId} — ${item.name}`);
    }

    // Seed loot tables
    const lootTableKeys = Object.keys(LOOT_TABLES);
    console.log(`\n[Loot Tables] Seeding ${lootTableKeys.length} loot tables...`);
    for (const key of lootTableKeys) {
        await setDoc('lootTables', key, LOOT_TABLES[key]);
        console.log(`  ✓ ${key} (${LOOT_TABLES[key].items.length} entries)`);
    }

    console.log('\n✅ Seeding complete!');
    process.exit(0);
}

seed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
