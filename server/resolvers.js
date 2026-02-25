// ============================================================
// GRAPHQL RESOLVERS — Firestore-backed
// ============================================================
const { getDoc, getAllDocs } = require('./firebase');
const { createPlayer } = require('./engine/playerState');

const resolvers = {
    Query: {
        node: async (_, { nodeId }) => {
            return await getDoc('nodes', nodeId);
        },
        allNodes: async () => {
            return await getAllDocs('nodes');
        },
        entity: async (_, { entityId }) => {
            return await getDoc('entities', entityId);
        },
        item: async (_, { itemId }) => {
            return await getDoc('items', itemId);
        },
        player: async (_, { playerId }) => {
            return await getDoc('players', playerId);
        },
    },
    Mutation: {
        createPlayer: async (_, { name }) => {
            return await createPlayer(name);
        },
    },
};

module.exports = resolvers;
