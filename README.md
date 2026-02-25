# Dungeon Crawler MUD

A multi-agent text-based dungeon crawler where AI agents collaborate to create a living, reactive narrative. Built with Node.js, GraphQL, WebSockets, and Firebase.

> *The System is watching. The audience is waiting. Try not to die.*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER CLIENT                         │
│  index.html + style.css + app.js (CRT terminal aesthetic)   │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket (ws://localhost:3000/ws)
┌──────────────────────────▼──────────────────────────────────┐
│                     NODE.JS SERVER                          │
│  Express + Apollo GraphQL + WebSocket Server (index.js)     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─── Agent Pipeline (agentPipeline.js) ──────────────────┐ │
│  │                                                         │ │
│  │  1. INPUT PARSER ──► Translates natural language to     │ │
│  │     (Agent 1)        structured JSON intent             │ │
│  │          │                                              │ │
│  │          ▼                                              │ │
│  │  2. GAME ENGINE ──► Resolves action deterministically   │ │
│  │     (gameEngine.js)  (combat, movement, inventory)      │ │
│  │          │                                              │ │
│  │          ├──────────────────┐                            │ │
│  │          ▼                  ▼                            │ │
│  │  3a. WORLD BUILDER   3b. SHOWRUNNER                     │ │
│  │      (Agent 2)           (Agent 3)                      │ │
│  │      Room descriptions   Flavor text + achievements     │ │
│  │          │                  │          (run in parallel) │ │
│  │          └──────┬───────────┘                            │ │
│  │                 ▼                                        │ │
│  │  4. GAME MASTER ──► Compiles final player-facing text   │ │
│  │     (Agent 4)                                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
├───────────────────────┬─────────────────────────────────────┤
│   Rules Engine        │   Firebase / Firestore              │
│   (deterministic)     │   (persistent game state)           │
└───────────────────────┴─────────────────────────────────────┘
```

### Data Flow (per player command)

1. Player types `attack goblin` in browser terminal
2. **Agent 1** (Input Parser) → `{ "action": "attack", "target": "goblin" }`
3. **Game Engine** resolves combat using deterministic rules (damage, HP, XP, loot)
4. **Agent 2** (World Builder) + **Agent 3** (Showrunner) run **in parallel** — atmospheric room description + sarcastic flavor text + achievement detection
5. **Agent 4** (Game Master) compiles everything into cohesive output → browser

---

## Project Structure

```
MUD/
├── .env.example          # Environment variable template
├── .gitignore
├── package.json
├── README.md
├── server/
│   ├── index.js          # Express + Apollo + WebSocket entry point
│   ├── firebase.js       # Firebase Admin SDK + Firestore helpers
│   ├── schema.js         # GraphQL type definitions
│   ├── resolvers.js      # GraphQL resolvers (Firestore-backed)
│   ├── data/
│   │   ├── seedData.js   # 12 rooms, 10 entities, 64 items, 9 loot tables
│   │   ├── seedFirestore.js  # CLI script to push seed data → Firestore
│   │   └── rules.js      # Deterministic game formulas (HP, damage, XP, loot)
│   ├── engine/
│   │   ├── gameEngine.js # Core game loop (11 action handlers)
│   │   ├── combat.js     # Combat resolution math
│   │   └── playerState.js # Player CRUD against Firestore
│   └── agents/
│       ├── llmClient.js      # LLM API wrapper (OpenAI/Anthropic + fallback)
│       ├── inputParser.js    # Agent 1: text → JSON intent
│       ├── worldBuilder.js   # Agent 2: game state → room description
│       ├── showrunner.js     # Agent 3: events → flavor text + achievements
│       ├── gameMaster.js     # Agent 4: compile final output
│       └── agentPipeline.js  # Orchestrates all agents
└── client/
    ├── index.html        # Terminal-style UI
    ├── style.css         # CRT aesthetic (scanlines, phosphor green)
    └── app.js            # WebSocket client + DOM
```

---

## Prerequisites

- **Node.js** v18+
- **npm** v9+
- **Firebase project** with Firestore enabled
- **LLM API key** (OpenAI or Anthropic) — *optional, the game works in fallback mode without one*

---

## External Services

### Firebase / Firestore

Firebase is used for persistent storage of all game state. You need:

1. A **Firebase project** — create one at [console.firebase.google.com](https://console.firebase.google.com)
2. **Cloud Firestore** enabled in *Native mode* (not Datastore mode)
3. A **service account key** (JSON file):
   - Firebase Console → Project Settings → Service Accounts → Generate New Private Key
   - Save the file as `serviceAccountKey.json` in the project root (it's `.gitignore`'d)

**Firestore Collections** (created automatically by the seed script):

| Collection     | Purpose                                  |
|----------------|------------------------------------------|
| `nodes`        | Map rooms (12 nodes, graph connections)  |
| `entities`     | Mobs & NPCs (10 templates)              |
| `items`        | Weapons, armor, consumables, etc. (64)   |
| `lootTables`   | Weighted drop pools (9 tables)           |
| `players`      | Player state (created at runtime)        |


### LLM / AI Services

The game uses an LLM for its 4-agent narrative pipeline. Supported providers:

| Provider   | Config Value   | Models                          |
|------------|----------------|---------------------------------|
| OpenAI     | `openai`       | `gpt-4`, `gpt-4o`, `gpt-3.5-turbo` |
| Anthropic  | `anthropic`    | `claude-3-opus`, `claude-3-sonnet`  |

**Without an LLM key**, the game runs in **fallback mode**:
- Input parsing uses pattern matching instead of AI
- Room descriptions use the base text from seed data
- Flavor text and achievements are template-based
- The game is fully playable — just less atmospheric

---

## Setup & Running Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# --- LLM Configuration ---
LLM_PROVIDER=openai                       # or "anthropic"
LLM_API_KEY=sk-your-api-key-here          # or leave as-is for fallback mode
LLM_MODEL=gpt-4o                          # model name

# --- Firebase Configuration ---
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

# --- Server ---
PORT=3000
```

### 3. Seed the database

This pushes all map nodes, entities, items, and loot tables into Firestore:

```bash
npm run seed
```

Expected output:
```
[Nodes] Seeding 12 map nodes...
  ✓ entrance_plaza (CollapsedStreet)
  ...
[Items] Seeding 64 items...
  ✓ rusty_pipe — Rusty Pipe
  ...
✅ Seeding complete!
```

### 4. Start the server

```bash
npm run dev
```

You'll see:
```
╔══════════════════════════════════════════════════════════╗
║           DUNGEON CRAWLER MUD — SERVER ONLINE           ║
╠══════════════════════════════════════════════════════════╣
║  🌐 Frontend:   http://localhost:3000                   ║
║  📡 GraphQL:    http://localhost:3000/graphql            ║
║  🔌 WebSocket:  ws://localhost:3000/ws                  ║
║  🔑 LLM:       Configured ✓                            ║
║  🔥 Firebase:   Connected ✓                             ║
╚══════════════════════════════════════════════════════════╝
```

### 5. Play

Open **http://localhost:3000** in your browser. Enter a crawler name and start exploring.

---

## Endpoints

| Endpoint                          | Protocol  | Purpose                        |
|-----------------------------------|-----------|--------------------------------|
| `http://localhost:3000`           | HTTP      | Browser frontend               |
| `http://localhost:3000/graphql`   | HTTP      | GraphQL API (Apollo Sandbox)   |
| `ws://localhost:3000/ws`          | WebSocket | Game I/O (real-time)           |
| `http://localhost:3000/health`    | HTTP      | Health check JSON              |

---

## Game Commands

| Command                    | Example                     | Description                     |
|----------------------------|-----------------------------|---------------------------------|
| `move <direction>`         | `go north`, `move east`     | Move between rooms              |
| `look`                     | `look around`               | Describe current room           |
| `attack <target>`          | `attack goblin`             | Initiate combat                 |
| `pickup <item>`            | `grab rusty pipe`           | Pick up item from ground        |
| `use <item>`               | `use health potion`         | Use a consumable                |
| `equip <item>`             | `equip kevlar vest`         | Equip weapon/armor              |
| `inventory`                | `check inventory`           | List carried items              |
| `stats`                    | `show stats`                | Display character stats         |
| `allocate <stat>`          | `allocate str`              | Spend stat points               |
| `open <lootbox>`           | `open iron loot box`        | Open a loot box                 |
| `talk <npc>`               | `talk to merchant`          | Talk to an NPC                  |

With the LLM enabled, you can use natural language — the Input Parser agent translates it for you.

---

## Item Tiers & Rarity

Items and entities have a `rarity` score from `1.0` (dirt-common) to `0.0000000001` (mythic):

| Tier       | Rarity Range      | Examples                                    |
|------------|--------------------|--------------------------------------------|
| Common     | 1.0 – 0.5         | Scrap Metal, Rusty Pipe, Stale Granola Bar |
| Iron       | ~0.5 – 0.25       | Sharpened Rebar, First Aid Kit, Lucky Coin |
| Bronze     | ~0.25 – 0.08      | Nail-Studded Bat, Kevlar Vest, Fire Axe    |
| Silver     | ~0.08 – 0.02      | Cattle Prod, Crawler Hide Jacket, System Crown |
| Gold       | < 0.01            | Graviton Hammer, Entropy Plate, Null Edge  |

Loot drops use **weighted random selection** — the `weight` values in loot tables determine drop frequency, while `rarity` indicates how rare an item is in the world overall.

---

## Fallback Mode

The game is designed to be fully playable without external services:

| Service        | Without It                                              |
|----------------|---------------------------------------------------------|
| Firebase       | Server warns "offline mode" — no persistence            |
| LLM API Key    | Pattern-matching parser, template descriptions          |

This makes local development and testing easy — just `npm run dev` with no `.env` configured.

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Runtime    | Node.js                             |
| API        | Apollo Server (GraphQL)             |
| HTTP       | Express                             |
| Real-time  | ws (WebSocket)                      |
| Database   | Firebase Admin SDK / Cloud Firestore|
| AI         | OpenAI or Anthropic API             |
| Frontend   | Vanilla HTML/CSS/JS                 |
