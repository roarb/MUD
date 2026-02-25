// ============================================================
// SERVER ENTRY POINT
// Express + Apollo GraphQL + WebSocket game I/O
// ============================================================
const express = require('express');
const { createServer } = require('http');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { initFirebase } = require('./firebase');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');
const { runPipeline } = require('./agents/agentPipeline');
const { createPlayer, loadPlayer } = require('./engine/playerState');
const { getDoc } = require('./firebase');

const PORT = process.env.PORT || 3000;

async function startServer() {
    // --- Initialize Firebase ---
    const db = initFirebase();
    if (!db) {
        console.warn('⚠ Firebase not configured. The game will not persist data.');
        console.warn('  Set FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_PATH in .env');
        console.warn('  Run: cp .env.example .env && edit .env\n');
    }

    // --- Express App ---
    const app = express();
    const httpServer = createServer(app);

    // --- Apollo GraphQL ---
    const apolloServer = new ApolloServer({ typeDefs, resolvers });
    await apolloServer.start();
    app.use('/graphql', cors(), express.json(), expressMiddleware(apolloServer));

    // --- Serve static frontend ---
    app.use(express.static(path.join(__dirname, '../client')));

    // --- Health check ---
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', firebase: !!db });
    });

    // --- WebSocket Server for Game I/O ---
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        console.log('[WS] New connection');
        let playerId = null;

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());

                // --- CREATE or LOAD player ---
                if (msg.type === 'create_player') {
                    const player = await createPlayer(msg.name || 'Crawler');
                    playerId = player.id;

                    ws.send(JSON.stringify({
                        type: 'player_created',
                        playerId: player.id,
                        playerName: player.name,
                    }));

                    // Send initial room description
                    const result = await runPipeline(playerId, 'look');
                    ws.send(JSON.stringify({
                        type: 'game_output',
                        text: result.text,
                        player: sanitizePlayer(result.player),
                        achievement: result.achievement,
                    }));
                    return;
                }

                if (msg.type === 'load_player') {
                    const player = await loadPlayer(msg.playerId);
                    if (!player) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Player not found.' }));
                        return;
                    }
                    playerId = player.id;

                    ws.send(JSON.stringify({
                        type: 'player_loaded',
                        playerId: player.id,
                        playerName: player.name,
                    }));

                    // Send current room
                    const result = await runPipeline(playerId, 'look');
                    ws.send(JSON.stringify({
                        type: 'game_output',
                        text: result.text,
                        player: sanitizePlayer(result.player),
                        achievement: result.achievement,
                    }));
                    return;
                }

                // --- GAME INPUT ---
                if (msg.type === 'game_input') {
                    if (!playerId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'No active player. Create or load a player first.' }));
                        return;
                    }

                    // Send "processing" indicator
                    ws.send(JSON.stringify({ type: 'processing', active: true }));

                    const result = await runPipeline(playerId, msg.text);

                    ws.send(JSON.stringify({
                        type: 'game_output',
                        text: result.text,
                        player: sanitizePlayer(result.player),
                        achievement: result.achievement,
                    }));

                    ws.send(JSON.stringify({ type: 'processing', active: false }));
                    return;
                }

            } catch (err) {
                console.error('[WS] Error processing message:', err);
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
        });

        ws.on('close', () => {
            console.log('[WS] Connection closed');
        });
    });

    // --- Start ---
    httpServer.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════════╗
║           DUNGEON CRAWLER MUD — SERVER ONLINE           ║
╠══════════════════════════════════════════════════════════╣
║  🌐 Frontend:   http://localhost:${PORT}                   ║
║  📡 GraphQL:    http://localhost:${PORT}/graphql              ║
║  🔌 WebSocket:  ws://localhost:${PORT}/ws                    ║
║  🔑 LLM:       ${process.env.LLM_API_KEY && process.env.LLM_API_KEY !== 'your_api_key_here' ? 'Configured ✓' : 'Not configured (fallback mode)'}               ║
║  🔥 Firebase:   ${db ? 'Connected ✓' : 'Not connected (no persistence)'}              ║
╚══════════════════════════════════════════════════════════╝
    `);
    });
}

// Strip large fields from player for WS transmission
function sanitizePlayer(player) {
    if (!player) return null;
    return {
        id: player.id,
        name: player.name,
        level: player.level,
        xp: player.xp,
        hp: player.hp,
        maxHp: player.maxHp,
        location: player.location,
        alive: player.alive,
        statPointsAvailable: player.statPointsAvailable || 0,
    };
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
