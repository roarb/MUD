// ============================================================
// GRAPHQL SCHEMA — Type definitions
// ============================================================
const typeDefs = `#graphql
  type Connections {
    n: String
    s: String
    e: String
    w: String
    down: String
    up: String
  }

  type Node {
    nodeId: String!
    zoneType: String!
    baseDescription: String!
    connections: Connections!
    hazardLevel: Int!
    entities: [String!]!
    items: [String!]!
  }

  type Entity {
    entityId: String!
    name: String!
    entityClass: String!
    hp: Int!
    maxHp: Int!
    attack: Int!
    defense: Int!
    actionTags: [String!]!
    lootTableId: String
    respawns: Boolean!
    xpReward: Int
    dialogue: [String]
  }

  type ItemStats {
    attack: Int
    defense: Int
    healAmount: Int
  }

  type Item {
    itemId: String!
    name: String!
    type: String!
    stats: ItemStats
    tier: String!
    description: String!
    isCustom: Boolean!
    slot: String
  }

  type PlayerStats {
    str: Int!
    dex: Int!
    con: Int!
    int: Int!
    wis: Int!
    cha: Int!
  }

  type Equipment {
    weapon: Item
    head: Item
    chest: Item
    feet: Item
  }

  type Player {
    id: String!
    name: String!
    gender: String
    visuals: String
    startingSkills: [String!]
    level: Int!
    xp: Int!
    stats: PlayerStats!
    hp: Int!
    maxHp: Int!
    location: String!
    inventory: [Item!]!
    equipment: Equipment!
    achievements: [Achievement!]!
    statPointsAvailable: Int!
    alive: Boolean!
  }

  type Achievement {
    title: String!
    description: String!
    tier: String!
    timestamp: Float
  }

  type Query {
    node(nodeId: String!): Node
    allNodes: [Node!]!
    entity(entityId: String!): Entity
    item(itemId: String!): Item
    player(playerId: String!): Player
  }

  type Mutation {
    createPlayer(name: String!, description: String): Player!
  }
`;

module.exports = typeDefs;
