# Phase 1: Agni Valley Activity Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1 fps PNG chat game with a real-time Discord Activity. Players move continuously across private, chunk-locked land and numbered, read-only public lobbies (a home lobby per Discord server), at client frame rate, and talk through local, private and global chat and emotes. The server decides every outcome.

**Architecture:** The pure rules in `game/` become instance-based (private land or the public open world) and are shared by the server and a Vite + Phaser client. One Bun process runs the discord.js bot, a `Bun.serve` HTTP/WebSocket server and a `GameServer` that holds instances in memory. MongoDB persists tiles and players write-behind, and economic changes go through the existing idempotent `EconomyManager` ledger.

**Tech Stack:** Bun 1.4, TypeScript (strict), discord.js 14.22.1, mongoose 8, `@discord/embedded-app-sdk@2.4.0`, `phaser@3.90.0`, `vite@6.3.5`, `bun:test` + `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-11-16-agni-valley-activity-design.md` (read it first). D1 is decided: numbered lobbies with a home lobby per Discord server. D2 and D3 are my picks: reset land but keep wallets, and `/farm play` becomes a launcher. D4 is decided: Razorpay through the bot. If the owner changes D2 or D3, only Task 15 changes.

**Execution:** subagent-driven (owner delegated the choice).

## Global Constraints

- Shared code in `game/` must not import `discord.js`, `mongoose`, `bun`, or anything from `managers/`. The browser client imports it.
- The server never trusts a client-supplied user ID. Identity comes only from `GET https://discord.com/api/v10/users/@me` with the player's OAuth access token.
- Chunk size is `16`. Start chunks are the 3×3 square from `(-1,-1)` to `(1,1)`. Unlock price is `Math.round(500 * 1.35 ** (n - 9))`, where `n` is the number of chunks already unlocked. A chunk is unlockable only if it shares an edge with an unlocked chunk.
- Lobby capacity is `LOBBY_CAP = 100` players. Public lobbies are read-only: no building, placing, tilling or destroying. Gathering is allowed and regrows (in-memory per lobby): public crops `CROP_REGROW_MS = 5 * 60_000`, rocks `ROCK_REGROW_MS = 2 * 60_000`, trees `TREE_REGROW_MS = 3 * 60_000`, animals `ANIMAL_RESPAWN_MS = 60_000`.
- Emotes: 15 free (`FREE_EMOTES`), 1 emote per 2 s, shown for 3 s. The server sends a player only what is within `AOI_CHUNKS = 2` chunks of them (a 5×5-chunk window): other players, animals and tile changes. An empty land instance unloads `5 * 60_000` ms after its last player leaves.
- The server tick is `TICK_MS = 50` (20 Hz). Movement is continuous and server-simulated: positions are floats in tile units (player centre), `WALK_SPEED = 4.5` tiles/s, player box `PLAYER_BOX = 0.6` tiles square, diagonal input normalised. The client sends only held direction. An input older than `INPUT_STALE_MS = 250` stops the player. Use-actions are limited to `MAX_ACTIONS_PER_SEC = 6`.
- Chat: `CHAT_RADIUS = 8` tiles for local, 200 characters max, 1 message/s per player, 1 global message per 5 s. Plain text is local, `/p ` is private: everyone on the land you are standing on (your current instance: your private land, or your lobby), `/g ` is global (spec §4.5).
- Economic writes go through `EconomyManager.transact` / `npcTrade`, never as direct wallet or inventory updates. Debit before mutating, credit after mutating (existing rule in `GameManager.apply`).
- Real money: Razorpay links only, created by `PaymentManager.createRazorpayLink` and DMed by the bot. The Activity never shows a checkout.
- Response headers on every HTTP route include `Content-Security-Policy: frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com` so Discord can frame the page.
- The client is a single-page app, as Discord requires for Activities: one `index.html`, no full-page navigations or redirects, all in-app screens drawn by Phaser or DOM overlays, all assets bundled by Vite and loaded from the same origin through Discord's proxy.
- Code style: tabs, double quotes, `T`-prefixed type names, comments in the same plain voice as the existing code.

## Review Focus

1. **A player opens the Activity on two devices.** The newer socket wins. The older one gets `{t:"kicked", reason:"opened elsewhere"}` and is closed, and the player is never in an instance twice. *(Task 9 test `second connection replaces the first`)*
2. **A modified client spams inputs or walks into a locked chunk or a tree.** The server never reads client positions: it moves each player at most `WALK_SPEED × TICK_MS/1000` per tick from the latest held direction, and walls block. The client's prediction is corrected by `{t:"you", x, y, facing, ack}`. *(Task 4 test `cannot outrun WALK_SPEED`, Task 9 test `input spam does not speed up the player`)*
3. **Two unlock clicks race for the same chunk** (double-click, two tabs). Coins are taken once and the chunk is added once. *(Task 6 test `concurrent unlock charges once`)*
4. **The process restarts mid-session.** Positions flushed within the last 5 s are kept. Tiles and coins are never lost because they're written immediately. The client reconnects with backoff and gets a fresh snapshot. *(Task 9 test `rejoin after restart restores position`, Task 12 test `reconnects with backoff`)*
5. **A malformed or oversized WebSocket message** (bad JSON, unknown `t`, `qty: -5`, a 1 MB frame). It's dropped without throwing, and the socket closes after 20 invalid messages. *(Task 1 tests, Task 9 test `closes socket after repeated garbage`)*

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `game/protocol.ts` | wire message types and `parseClientMessage` validation | new |
| `game/chunks.ts` | chunk math, land terrain generation, unlock rules and price | new |
| `game/world.ts` | public open-world map: procedural regions plus the stamped Town (today's town without plots, plus land gate and Job Centre) | new (replaces `game/map.ts` layout) |
| `game/entities.ts` | wild animals: spawn rules and wander and flee AI | new |
| `game/chat.ts` | chat parsing and audience rules | new |
| `game/data/emotes.ts` | emote catalog (15 free, premium) | new |
| `managers/models/Cosmetics.ts` | owned cosmetics (`Ownership`) | new |
| `game/map.ts` | terrain enum `T`, `isWalkableTerrain` only | modify |
| `game/engine.ts` | instance-based rules: `step`, `use`, `sleep`, `travelTarget` | modify |
| `managers/models/Game.ts` | `Land`, `LandTile`, `PlayerState` models | rewrite |
| `managers/InstanceStore.ts` | load and save lands, tiles, players; atomic chunk unlock | new |
| `managers/ActivityAuth.ts` | OAuth code exchange and token → user verification | new |
| `server.ts` | `Bun.serve` routes, WebSocket upgrade, static client | rewrite |
| `managers/GameServer.ts` | sessions, instances, tick, broadcast, action handlers | new (replaces `GameManager.ts`) |
| `activity/` | Vite + Phaser client | new |
| `commands/farm/play.ts` | launch the Activity | modify |
| `managers/GameManager.ts`, `managers/RenderManager.ts`, `commands/farm/controls.ts`, `scripts/render-frame.ts` | old PNG game | delete in Task 15 |
| `scripts/migrate-activity.ts` | backup and drop old guild-world collections | new |

---

### Task 1: Wire protocol

**Files:**
- Create: `game/protocol.ts`
- Test: `tests/protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROTOCOL_VERSION = 1;
  export type TDir = "u" | "d" | "l" | "r"; // re-exported from engine after Task 4
  export type TClientMsg =
    | { t: "hello"; v: number; token: string; instanceId: string; guildId: string | null }   // first message only; guildId from the SDK, checked by the server against /users/@me/guilds
    | { t: "input"; seq: number; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }   // held direction; sent on change and every 100 ms while held
    | { t: "chat"; text: string }                                     // raw text incl. "/p " or "/g " prefix, 1..200 chars after trim
    | { t: "use"; seq: number }
    | { t: "equip"; item: string }
    | { t: "sleep" }
    | { t: "travel"; to: "world" | "land" }
    | { t: "buy"; item: string; qty: number }
    | { t: "sell"; item: string; qty: number | "all" }
    | { t: "unlock"; cx: number; cy: number }
    | { t: "buyGems"; productId: string }
    | { t: "lobbies" }                                   // request the lobby list
    | { t: "switchLobby"; lobby: number }
    | { t: "emote"; id: string }
    | { t: "buyCosmetic"; itemId: string; via: "gems" | "razorpay" };
  export type TServerMsg =
    | { t: "welcome"; userId: string; snapshot: TSnapshot }
    | { t: "you"; x: number; y: number; facing: TDir; ack: number }  // every tick while moving; ack = last applied input seq
    | { t: "player"; p: TPlayerView }            // joined or moved
    | { t: "left"; userId: string }
    | { t: "tiles"; tiles: [string, TTileView | null][] }
    | { t: "chunks"; unlocked: string[] }
    | { t: "ents"; ents: [id: number, kind: string, x: number, y: number, facing: TDir][] } // animals in AOI, every tick; ids absent from the list have left AOI
    | { t: "wallet"; coins: number; gems: number; inventory: Record<string, number>; energy: number }
    | { t: "toast"; msg: string; ok: boolean }
    | { t: "menu"; menu: "shop" }
    | { t: "lobbyList"; current: number | null; lobbies: { n: number; label: string; players: number; home: boolean }[] }
    | { t: "emote"; userId: string; id: string }        // to players within AOI
    | { t: "owned"; items: string[] }                  // owned cosmetics; sent in welcome flow and after purchases
    | { t: "chat"; channel: "local" | "private" | "global"; from: { userId: string; name: string }; text: string; at: number }
    | { t: "kicked"; reason: string };
  export interface TSnapshot { instance: { id: string; kind: "land" | "world"; seed: number; ownerId: string | null; epoch: number; unlocked: string[] }; tiles: [string, TTileView][]; players: TPlayerView[]; you: TPlayerView; prices: Record<string, { buy: number; sell: number }>; }
  export interface TPlayerView { userId: string; name: string; x: number; y: number; facing: TDir; equipped: string; colour: string; premium: boolean; }
  export type TTileView = { tilled?: boolean; cropId?: string; plantedDay?: number; wateredDays: number[]; clearedDay?: number; regrowAt?: number };
  export const MAX_MSG_BYTES = 2048;
  export function parseClientMessage(raw: string | Buffer): TClientMsg | null;
  ```

- [ ] **Step 1: Write failing tests** in `tests/protocol.test.ts`:
  - `parses each valid message`: one valid example per `TClientMsg` variant round-trips with `toEqual`.
  - `rejects junk`: returns `null` for `"not json"`, `"{}"`, `{t:"input",seq:1,dx:2,dy:0}`, `{t:"chat",text:"   "}`, `{t:"chat",text:"x".repeat(201)}`, `{t:"buy",item:"wheat_seed",qty:-5}`, `{t:"buy",item:"wheat_seed",qty:1.5}`, `{t:"buy",item:"wheat_seed",qty:1000}` (max 999), `{t:"unlock",cx:1e9,cy:0}` (|cx|,|cy| ≤ 10_000), `{t:"equip",item:"x".repeat(65)}` (max 64 chars), and a string longer than `MAX_MSG_BYTES`.
  - `strips unknown fields`: `{t:"use",seq:3,evil:true}` parses to `{t:"use",seq:3}`.
- [ ] **Step 2: Run** `bun test tests/protocol.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `parseClientMessage` as a hand-written switch on `t` with no new dependency. It returns a fresh object holding only the known fields.
- [ ] **Step 4: Run** `bun test tests/protocol.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): add activity wire protocol`.

---

### Task 2: Chunks and land terrain

**Files:**
- Create: `game/chunks.ts`
- Modify: `game/map.ts` (keep `T` and `isWalkableTerrain`; add `T.portal = 11`, `T.fence = 12`, `T.house = 13`, `T.field = 14` (public crop field); `T.portal` and `T.field` are walkable and the others are not)
- Test: `tests/chunks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CHUNK = 16;
  export const START_CHUNKS: string[]; // "-1,-1" … "1,1" (9 keys)
  export const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;
  export function chunkOf(x: number, y: number): { cx: number; cy: number }; // floor division, works for negatives
  export function landBaseTerrain(seed: number, x: number, y: number): number; // deterministic
  export function landTerrain(seed: number, unlocked: ReadonlySet<string>, x: number, y: number): number; // T.fence on locked chunk edges, T.grass inside locked chunks is not walkable (returns T.fence)
  export function canUnlock(unlocked: ReadonlySet<string>, cx: number, cy: number): boolean;
  export function unlockPrice(unlockedCount: number): number;
  export const HOUSE = { x: 6, y: 5, w: 4, h: 3 }; // T.house; door at (8, 7)
  export const LAND_SPAWN = { x: 8, y: 9 };
  export const LAND_PORTAL = { x: 3, y: 9 };
  ```
- [ ] **Step 1: Write failing tests:**
  - `chunkOf handles negatives`: `chunkOf(-1, -1)` → `{cx:-1,cy:-1}`, `chunkOf(15, 16)` → `{cx:0,cy:1}`.
  - `terrain is deterministic and seed-dependent`: the same `(seed,x,y)` gives the same value twice. Over a 64×64 sample, seeds 1 and 2 differ on at least 10% of tiles.
  - `start area is clear`: every tile within 3 of `LAND_SPAWN` and on the house and portal footprint is the expected `T` value, for 20 random seeds.
  - `locked chunks are not walkable`: start chunks cover x and y from -16 to 31. `isWalkableTerrain(landTerrain(1, new Set(START_CHUNKS), 32, 9))` is `false` (chunk `(2,0)` is locked).
  - `canUnlock needs an edge neighbour`: with `START_CHUNKS`, `(2,0)` → true, `(2,2)` → false, `(0,0)` (already unlocked) → false.
  - `price curve`: `unlockPrice(9)` = 500, `unlockPrice(10)` = 675, `unlockPrice(19)` = 10053, `unlockPrice(29)` = 202137.
- [ ] **Step 2: Run** `bun test tests/chunks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Terrain uses the existing mulberry32 PRNG from `game/map.ts` (export it as `prng`), seeded with `hash(seed, cx, cy)`, to place trees (7%), rocks (4%), flowers (6%) and one 3×3 pond at 30% chance per chunk. Inside chunk `(0,0)`, the house, spawn and portal areas are forced.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): chunked land terrain and unlock rules`.

---

### Task 3: Open-world map

**Files:**
- Create: `game/world.ts`
- Modify: `game/map.ts` (keep `T`, `isWalkableTerrain` and `prng`; move the town `build()` into `world.ts` as a stamp, dropping the `PLOTS` rects)
- Test: `tests/world.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const WORLD_SEED = 0xa9e1;
  export const WORLD_CHUNKS = 64;                 // chunk coords -32..31 on both axes → 1024 × 1024 tiles
  export const TOWN_ORIGIN = { x: -24, y: -16 };  // top-left of the 48×32 town stamp; town centre at (0,0)
  export const TOWN_SPAWN: { x: number; y: number };   // today's (23,14) shifted by TOWN_ORIGIN
  export const LAND_GATE: { x: number; y: number };    // T.portal, today's (23,12) shifted
  export const SHOP_DOORS: { x: number; y: number }[]; // today's (23,5) and (24,5) shifted
  export type TRegion = "town" | "meadow" | "forest" | "hills" | "lake" | "wilds" | "reserved";
  export function regionAt(x: number, y: number): TRegion;   // low-frequency value noise from WORLD_SEED; "reserved" areas are flat grass kept for later districts (City, Industrial, Port)
  export function fieldCrop(x: number, y: number): string | null; // crop id growing on a T.field tile (wheat, potato, parsnip, pumpkin, cotton, berry by field), else null
  export function worldTerrain(x: number, y: number): number; // town stamp inside its rect; region-based procedural terrain elsewhere; dirt roads from town to each region; T.water outside the world bounds (ocean)
  ```
- [ ] **Step 1: Failing tests:**
  - `town stamp matches the old layout`: for every tile of the old 48×32 map (excluding old plot rects), `worldTerrain(TOWN_ORIGIN + (i,j))` equals the old value.
  - `deterministic`: two calls over a 256×256 sample give identical results.
  - `ocean border`: `worldTerrain(-513, 0)` and `worldTerrain(0, 512)` are `T.water`.
  - `regions exist`: a 1024×1024 scan at 16-tile stride finds every `TRegion` value.
  - `reachable`: a BFS from `TOWN_SPAWN` reaches `LAND_GATE`, both `SHOP_DOORS`, and at least one walkable tile in each of meadow, forest, hills and wilds (limit the BFS to 400 tiles of radius).
  - `no farmland in the world`.
  - `meadows have public fields`: at least 6 rectangular `T.field` areas within 300 tiles of town, each with a non-null `fieldCrop`, reachable from `TOWN_SPAWN`.
- [ ] **Step 2: Run** `bun test tests/world.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `PLOTS`, `plotAt`, `BASE_MAP`, `baseTerrain` and `SPAWN` from `game/map.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): open-world public map with stamped town`.

---

### Task 4: Instance-based engine

**Files:**
- Modify: `game/engine.ts`
- Rewrite: `tests/engine.test.ts` (keep the clock, crop growth, axe, pickaxe, ore and sleep cases, retargeted to private land instance)

**Interfaces:**
- Consumes: Task 2 (`landTerrain`, `LAND_SPAWN`, `LAND_PORTAL`, `HOUSE`), Task 3 (`worldTerrain`, `TOWN_SPAWN`, `LAND_GATE`, `SHOP_DOORS`).
- Produces:
  ```ts
  export interface TInstance {
    id: string;               // "land:<landId>" | "lobby:<n>"
    kind: "land" | "world";
    lobby?: { n: number; label: string; homeGuildId: string | null }; // world only
    seed: number;             // land seed; WORLD_SEED for the world
    ownerId: string | null;   // land owner; null for the world
    epoch: number;
    unlocked: Set<string>;    // chunk keys; empty for the world (every in-bounds chunk is open)
    tiles: Map<string, TTileState>;
    players: Map<string, TPlayerState>;
  }
  export function createLand(id: string, ownerId: string, seed: number, epoch: number): TInstance;
  export function createLobby(n: number, label: string, homeGuildId: string | null, epoch: number): TInstance;
  export function terrainAt(inst: TInstance, x: number, y: number, day: number): number;
  export function canBuild(inst: TInstance, userId: string): boolean; // Phase 1: kind==="land" && ownerId===userId
  export function enter(inst: TInstance, base: Omit<TPlayerState,"x"|"y"|"facing">, at?: {x:number;y:number;facing:TDir}): TPlayerState; // spawn point if `at` missing or not walkable
  export const WALK_SPEED = 4.5, PLAYER_BOX = 0.6, TICK_MS = 50;
  export function simulate(inst: TInstance, userId: string, dx: -1|0|1, dy: -1|0|1, dtMs: number, day: number): void; // moves x/y (floats), sets facing from the dominant axis; axis-separated AABB vs non-walkable tiles; blocked by other players' boxes: no (players pass through each other)
  export function facedTile(p: TPlayerState): { x: number; y: number }; // tile containing (centre + facing × 0.8)
  export function use(inst: TInstance, userId: string, now: number, inventory: Record<string, number>): TActionResult;
  export function sleep(inst: TInstance, userId: string, now: number): TActionResult; // only at house door, after 18:00
  // TActionResult gains: travel?: "world" | "land"
  ```
  `TPlayerState` loses `plotId`; `x` and `y` become float tile-unit centres. The old `move()`, `joinWorld()`, `createWorld(guildId)` and `TWorldState` are removed. `enter()` places players at the spawn tile centre (`tile + 0.5`).
- [ ] **Step 1: Write failing tests:**
  - `simulate moves at WALK_SPEED`: one `simulate(…, 1, 0, 1000, day)` from spawn moves x by `4.5` (± 1e-9) and sets facing `"r"`.
  - `diagonal is normalised`: `(1, 1)` for 1000 ms moves `4.5 / √2` on each axis.
  - `cannot outrun WALK_SPEED`: 100 calls of `dtMs = 10` equal one call of `dtMs = 1000` (within 1e-6).
  - `locked chunk blocks`: from `(31.0, 9.5)` moving right for 1000 ms, x stops at `32 - PLAYER_BOX/2` (= 31.7).
  - `slides along walls`: pressing `(1, 1)` into a wall on the right still moves down.
  - `only the owner can till`: on private land owned by `u1`, `u2` using the hoe on grass-turned-farmland gets `ok:false` and msg `"This isn't your land."`.
  - `hoe tills plain grass on your land` (private land has no farmland terrain; any grass inside an unlocked chunk is tillable).
  - `no farming in the world`: a hoe on world grass gives `ok:false` and msg `"You can only farm on your own land."`.
  - `portal returns travel`: facing `LAND_GATE` gives `{ok:true, travel:"land"}`. Facing `LAND_PORTAL` gives `{ok:true, travel:"world"}`.
  - `shop door opens the shop` in the world: `menu:"shop"`.
  - `public land is read-only`: in a lobby, the hoe on grass, planting seeds, and watering all give `ok:false` with msg `"You can only build on your own land."`.
  - `public crops harvest and regrow`: using on a `T.field` tile gives `fieldCrop` yield and sets `regrowAt = now + CROP_REGROW_MS`. A second harvest before `regrowAt` fails with `"This is still growing."`, and after `regrowAt` it succeeds.
  - `public trees and rocks regrow in minutes`: chopping in a lobby sets `regrowAt = now + TREE_REGROW_MS` (rock: `ROCK_REGROW_MS`), and `terrainAt` shows grass until then. On private land, they keep the day-based respawn.
  - `sleep only at the house door after 18:00`.
  - The existing crop growth, watering, harvest, tree respawn, rock respawn and ore-roll tests, ported.
- [ ] **Step 2: Run** `bun test tests/engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `step` checks bounds only through `terrainAt` (the land has no bounds; the world returns `T.water` outside). Tillable means `terrainAt === T.grass` and `canBuild`. `canBuild` is always false in a lobby. Tree and rock clearing and respawn keep their current day counts.
- [ ] **Step 4: Run** `bun test tests/engine.test.ts tests/chunks.test.ts tests/world.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(game): instance-based engine for lands and the world`.

---

### Task 5: Persistence models

**Files:**
- Rewrite: `managers/models/Game.ts`
- Modify: `managers/DatabaseManager.ts` (export the new models in place of `GameWorld`, `GamePlayer`, `GameTile`)

**Interfaces:**
- Produces:
  ```ts
  Land:        { landId: string (unique, = ObjectId hex), ownerId: string, slot: number (0; 1 = second land in Phase 4), seed: number, epoch: number, unlocked: string[], createdAt: Date }  index {ownerId:1, slot:1} unique
  LandTile:    { landId, x, y, tilled?, cropId?, plantedDay?, wateredDays: number[], clearedDay? }  index {landId:1,x:1,y:1} unique
  PlayerState: { userId (unique), name, colour, energy, lastEnergyAt, equipped, location: { instanceKind: "land"|"world", landId?: string, x, y, facing } }
  ```
- [ ] **Step 1:** Write the schemas. They're covered by Task 6's tests, so there's no separate test step.
- [ ] **Step 2: Run** `bunx tsc --noEmit`. Expected: errors only in files that later tasks replace (`GameManager.ts`, `RenderManager.ts`, `commands/farm/controls.ts`, `scripts/render-frame.ts`). Note them and leave them.
- [ ] **Step 3: Commit** `feat(db): land, land tile and player state models`.

---

### Task 6: InstanceStore

**Files:**
- Create: `managers/InstanceStore.ts`
- Test: `tests/instance-store.test.ts` (same `MongoMemoryReplSet` setup as `tests/economy.test.ts`)

**Interfaces:**
- Consumes: Task 4 `TInstance`, `createLand`; Task 5 models; `EconomyManager.transact`.
- Produces:
  ```ts
  export default class InstanceStore {
    constructor(eco: EconomyManager, log: { error(...a: unknown[]): void });
    getOrCreateLand(ownerId: string, slot?: number): Promise<TInstance>;      // seed = random 31-bit int on create
    loadPlayer(userId: string): Promise<(TPlayerState & { location: TLocation }) | null>;
    savePlayers(players: (TPlayerState & { location: TLocation })[]): Promise<void>; // bulkWrite upsert
    saveTiles(inst: TInstance, keys: string[]): Promise<void>;                // same $set/$unset logic as GameManager.saveTiles
    unlockChunk(inst: TInstance, userId: string, cx: number, cy: number): Promise<{ ok: true; price: number } | { ok: false; msg: string }>;
  }
  export type TLocation = { instanceKind: "land" | "world"; landId?: string; x: number; y: number; facing: TDir };
  ```
- [ ] **Step 1: Failing tests:**
  - `creates one land per owner, even concurrently`: 5 parallel `getOrCreateLand("u1")` give the same `id` and `Land.countDocuments` = 1.
  - `tiles round-trip`: set a crop on a tile, `saveTiles`, drop the instance, reload, and `toEqual` the original. Removing a field `$unset`s it.
  - `unlock charges and persists`: give `u1` 1000 coins, unlock `(2,0)`, then the wallet has 500 coins, `Land.unlocked` contains `"2,0"`, and `inst.unlocked.has("2,0")`.
  - `unlock rejects non-adjacent, already-unlocked, not-owner, and broke`: one assertion each on `ok:false`, with the wallet unchanged.
  - `concurrent unlock charges once`: 5 parallel unlocks of `(2,0)` with 5000 coins → exactly one `ok:true` and a wallet of 4500.
- [ ] **Step 2: Run** `bun test tests/instance-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `unlockChunk`** in this order: validate with `canUnlock` and the owner check. Run `eco.transact([{userId, coins:-price}], {reason:"chunk_unlock", ref:key, idempotencyKey:\`unlock:${landId}:${key}\`})`. Then run `Land.updateOne({landId, unlocked:{$ne:key}}, {$push:{unlocked:key}})`. If the transact result is `duplicate`, return `ok:false, msg:"Already unlocked."` without touching the instance. The idempotency key is what makes races charge once.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): instance store with atomic chunk unlock`.

---

### Task 7: Activity OAuth

**Files:**
- Create: `managers/ActivityAuth.ts`
- Test: `tests/activity-auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export default class ActivityAuth {
    constructor(opts: { clientId: string; clientSecret: string; fetch?: typeof fetch; now?: () => number });
    exchangeCode(code: string): Promise<{ access_token: string } | null>; // POST https://discord.com/api/oauth2/token, form body: client_id, client_secret, grant_type=authorization_code, code
    verify(accessToken: string): Promise<{ id: string; name: string } | null>; // GET https://discord.com/api/v10/users/@me; name = global_name ?? username; cached 5 min per token
    guild(accessToken: string, guildId: string): Promise<{ id: string; name: string } | null>; // GET /users/@me/guilds; null if the user isn't in it; cached 5 min
  }
  ```
  `clientId` = `process.env.BOT_ID` and `clientSecret` = `process.env.BOT_SECRET` (both already in `.example.env`).
- [ ] **Step 1: Failing tests** with an injected fake `fetch`:
  - `exchange posts form-encoded body`: assert the URL, method and `Content-Type: application/x-www-form-urlencoded`, and that the body has all four fields. It returns `{access_token:"abc"}`.
  - `exchange returns null on 400`.
  - `verify caches for 5 minutes`: two calls inside 5 min → fetch called once. After advancing `now` by 301_000 → called twice.
  - `verify returns null on 401` and does not cache the failure.
  - `guild returns the name when the user is a member, null otherwise`.
- [ ] **Step 2: Run** `bun test tests/activity-auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(activity): oauth code exchange and token verification`.

---

### Task 8: HTTP server on Bun.serve

**Files:**
- Rewrite: `server.ts`
- Modify: `index.ts` (always start the server; it no longer depends on `RAZORPAY_WEBHOOK_SECRET`)
- Modify: `package.json` (remove `express`, `helmet`, `cors`, `@types/express`, `@types/helmet`, `@types/cors`)
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: Task 7 `ActivityAuth`; `client.payments.handleRazorpayWebhook(raw, sig)`.
- Produces:
  ```ts
  export interface TServerDeps {
    auth: Pick<ActivityAuth, "exchangeCode">;
    razorpayWebhook: (raw: string, sig: string | undefined) => Promise<number>;
    isReady: () => boolean;
    ws: { open(ws: ServerWebSocket<TSocketData>): void; message(ws: ServerWebSocket<TSocketData>, msg: string | Buffer): void; close(ws: ServerWebSocket<TSocketData>): void };
    staticDir: string;         // activity/dist
    log: { info(...a: unknown[]): void; error(...a: unknown[]): void; warn(...a: unknown[]): void };
  }
  export type TSocketData = { connId: string; userId?: string };
  export function startServer(deps: TServerDeps, port: number): Server;
  ```
  Routes: `GET /health` → `{ok:true, discord:isReady()}`. `GET /paid` → the existing HTML. `POST /webhooks/razorpay` → raw body, max 100 KB. `POST /api/token` with `{code}` → `{access_token}` or 400. `GET /ws` → upgrade. Anything else serves the file from `staticDir`, with SPA fallback to `index.html`, and refuses `..` path traversal. All responses carry the CSP header from Global Constraints plus `X-Content-Type-Options: nosniff`.
- [ ] **Step 1: Failing tests**, starting the server on port `0` with stub deps:
  - `health`, `token ok`, `token 400 on missing code`, `token 400 when exchange returns null`.
  - `webhook passes raw body and signature through`, and the stub receives the exact bytes.
  - `webhook 413 over 100 KB`.
  - `static serves index for unknown path` and `blocks path traversal` (`/../package.json` → 404).
  - `every response has frame-ancestors CSP`.
  - `ws upgrade calls open/message/close`.
- [ ] **Step 2: Run** `bun test tests/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Bun.serve({ port, fetch, websocket })`. Set `maxPayloadLength: MAX_MSG_BYTES` on the websocket.
- [ ] **Step 4: Run** `bun test tests/server.test.ts tests/payments.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): bun.serve with activity token, websocket and static client`.

---

### Task 9: GameServer core: sessions, instances, movement

**Files:**
- Create: `managers/GameServer.ts`
- Modify: `managers/ClientManager.ts` (add `public gameServer: GameServer` and construct it after `economy` and `payments`; `index.ts` passes `gameServer` as `deps.ws`)
- Test: `tests/game-server.test.ts` (uses a fake socket `{ data, send: mock(), close: mock() }`, a stub `ActivityAuth.verify`, and a real `InstanceStore` on `MongoMemoryReplSet`)

**Interfaces:**
- Consumes: Tasks 1, 4, 6, 7.
- Produces:
  ```ts
  export default class GameServer {
    constructor(deps: { store: InstanceStore; auth: Pick<ActivityAuth,"verify">; eco: EconomyManager; payments: Pick<PaymentManager,"hasPass"|"createRazorpayLink"|"razorpayEnabled">; dm: (userId: string, content: string) => Promise<void>; log: TLog; now?: () => number });
    open(ws): void; message(ws, raw): void; close(ws): void;   // TServerDeps["ws"]
    pushWallet(userId: string): Promise<void>;                  // used by PaymentManager after a grant
    shutdown(): Promise<void>;                                  // flush + close sockets with kicked:"server restarting"
  }
  ```
  Behaviour:
  - Until `hello` is verified, a socket may send nothing else. Anything else closes it.
  - On `hello`: verify the token, load the `PlayerState` (or create one with defaults: energy `MAX_ENERGY`, equipped `"hoe"`, colour from the existing `PALETTE`). The first session for a user gets the `STARTER_COINS` and `STARTER_KIT` grant with idempotency key `starter:<userId>`. Put the player into their saved location, defaulting to their land, then send `welcome`.
  - Lobbies: public lobby #1 always exists. Numbers are the lowest free positive integer. When a `hello` carries a `guildId` the user belongs to (checked with `auth.guild`), the player's world destination is that guild's home lobby, labelled `Home · <guild name>`, created on demand. Otherwise, or when the home lobby has `LOBBY_CAP` players, it's the public lobby with the most players that still has room, and a new public lobby opens if none has room. Lobbies other than #1 close 60 s after their last player leaves.
  - `lobbies` → `lobbyList`. `switchLobby` moves the player to lobby `n` at the same position if it exists and isn't full, otherwise toast `"Lobby #n is full."` or `"No lobby #n."`. Switching from private land is allowed and takes you to that lobby.
  - `input`: store `{dx, dy, seq, at}` as the player's latest input. Inputs with `seq` ≤ the stored seq are ignored.
  - Each `TICK_MS` tick: for every player whose input is younger than `INPUT_STALE_MS`, run `simulate` for `TICK_MS`. Moved players are marked dirty. Each mover gets `you` with `ack` = their latest seq, and everyone else in the instance gets one batched `player` per moved player.
  - Every 5 s, flush dirty players with `store.savePlayers`.
  - 20 invalid messages → close the socket.
  - Private land with no players is unloaded after 5 min.
- [ ] **Step 1: Failing tests:**
  - `hello with bad token closes socket`.
  - `hello creates player on own land and sends welcome` (snapshot `instance.kind === "land"`, `you` at `LAND_SPAWN`, starter wallet granted once across two hellos).
  - `second connection replaces the first` (Review Focus 1).
  - `input spam does not speed up the player` (Review Focus 2): 100 `input` messages in one tick move the player no more than `WALK_SPEED × 0.05` per tick. Stale input (300 ms old) stops them.
  - `nearby players see moves`: two users in the world within AOI, one holds right, the other socket gets `{t:"player"}` after the tick.
  - `players outside AOI see nothing`: two users 200 tiles apart get no `player` messages about each other. When one walks into AOI, the other gets a `player`. When they leave AOI, the other gets `left`.
  - `entering a chunk sends its changed tiles`: a tree cut at a far chunk is sent as `tiles` when a player's AOI first covers that chunk.
  - `home lobby per guild`: two users launching from guild G end up in the same lobby labelled `Home · G-name`. A user launching from guild H gets a different lobby.
  - `spoofed guildId is ignored`: a `guildId` the user isn't in sends them to a public lobby.
  - `lobbies cap at 100`: the 101st player into a full home lobby goes to a public lobby, and the 101st public player opens lobby #2 (or the next free number).
  - `lobby numbers are reused`: after #2 closes, the next new lobby is #2.
  - `switchLobby keeps position and rejects full or missing lobbies`.
  - `lobby regrowth state is separate`: harvesting a field in #1 doesn't change it in #2.
  - `rejoin after restart restores position` (Review Focus 4): move for 5 ticks, call `shutdown()`, build a new GameServer on the same DB, hello → `you` at the moved position.
  - `closes socket after repeated garbage` (Review Focus 5).
  - `empty land unloads after 5 minutes` (inject `now`).
- [ ] **Step 2: Run** `bun test tests/game-server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each instance has a mutation queue like `GameManager.withWorld`, so one instance's actions are serialized.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): real-time game server with instances and sessions`.

---

### Task 10: GameServer actions: use, equip, sleep, travel, shop, unlock, gems

**Files:**
- Modify: `managers/GameServer.ts`
- Modify: `managers/PaymentManager.ts` (after a successful non-duplicate grant, call `this.client.gameServer?.pushWallet(userId)`)
- Test: `tests/game-server.test.ts` (new `describe("actions")`)

**Interfaces:**
- Consumes: Task 9 internals; `EconomyManager.npcTrade`, `npcPrices`, `inventory`, `wallet`; `PaymentManager.createRazorpayLink`; `productById`.
- Produces handlers for `use`, `equip`, `sleep`, `travel`, `buy`, `sell`, `unlock` and `buyGems`. The `use` flow is ported from `GameManager.apply`: debit `take`, `apply()`, `saveTiles`, credit `give`. On success it sends `tiles` to everyone in the instance and `wallet` to the actor. On failure it sends a `toast`.
- [ ] **Step 1: Failing tests:**
  - `till, plant, water, harvest on own land` end-to-end over messages, with inventory and tile changes asserted.
  - `use is rate limited to 6/s`.
  - `travel moves player between land and world`: returning to the world puts the player back where they left it, or at `TOWN_SPAWN`; `left` goes to the old instance's players and `welcome` to the mover.
  - `travel only from a portal tile` (or from the house door): otherwise a toast.
  - `buy only while facing a shop door`: otherwise toast `"Visit the General Store to buy."`.
  - `unlock sends chunks to everyone on the land and wallet to the owner`.
  - `buyGems DMs a Razorpay link and toasts "Check your DMs…"`: the `dm` stub receives a string containing the link. With `razorpayEnabled=false` → toast `"Purchases are not available right now."`.
  - `pushWallet sends wallet to an online player and is a no-op offline`.
- [ ] **Step 2: Run** `bun test tests/game-server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The DM content is `` `${product.emoji} **${product.name}**: pay here within 30 minutes: ${url}\nYour gems appear in game as soon as payment completes.` ``.
- [ ] **Step 4: Run** `bun test`. Expected: all PASS except the old `tests/game.test.ts` and `tests/commands.test.ts` cases for the PNG game, which Task 15 deletes or updates.
- [ ] **Step 5: Commit** `feat(game): land actions, shop, chunk unlock and gem purchase over websocket`.

---

### Task 11: Client scaffold and Discord auth

**Files:**
- Create: `activity/package.json` (deps: `phaser@3.90.0`, `@discord/embedded-app-sdk@2.4.0`; dev: `vite@6.3.5`, `typescript`)
- Create: `activity/vite.config.ts` (alias `@game` → `../game`; dev server proxy `/api` → `http://localhost:3000`, `/ws` → `ws://localhost:3000`; `server.allowedHosts: true` for the tunnel)
- Create: `activity/index.html`, `activity/src/main.ts`, `activity/src/discord.ts`, `activity/tsconfig.json`
- Modify: root `package.json` scripts: `"activity:dev": "cd activity && bunx vite"`, `"activity:build": "cd activity && bunx vite build"`
- Test: `activity/src/discord.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // activity/src/discord.ts
  export interface TDiscordSession { accessToken: string; instanceId: string; guildId: string | null; channelId: string | null; sdk: DiscordSDK }
  export async function setupDiscord(clientId: string, fetchFn?: typeof fetch): Promise<TDiscordSession>;
  // ready() → commands.authorize({ client_id, response_type:"code", state:"", prompt:"none", scope:["identify","guilds"] }) → POST /api/token → commands.authenticate({ access_token })
  ```
  `clientId` comes from `import.meta.env.VITE_DISCORD_CLIENT_ID`.
- [ ] **Step 1: Failing test** `setupDiscord calls authorize, token, authenticate in order`, with a fake SDK injected through a second optional parameter `sdkFactory`. It asserts the scope is `["identify", "guilds"]`.
- [ ] **Step 2: Run** `cd activity && bun test`. Expected: FAIL.
- [ ] **Step 3: Implement.** `main.ts` shows a loading screen, then calls `setupDiscord`. On failure it shows "Open this from Discord" with the error message.
- [ ] **Step 4: Run** `cd activity && bun test && bunx vite build`. Expected: PASS, and `activity/dist/index.html` exists.
- [ ] **Step 5: Commit** `feat(activity): vite + phaser scaffold with discord auth`.

---

### Task 12: Client connection

**Files:**
- Create: `activity/src/net.ts`
- Test: `activity/src/net.test.ts`

**Interfaces:**
- Consumes: Task 1 types through `@game/protocol`.
- Produces:
  ```ts
  export class Connection {
    constructor(opts: { url: string; hello: () => TClientMsg; onMessage: (m: TServerMsg) => void; onStatus: (s: "connecting" | "open" | "closed") => void; WebSocketImpl?: typeof WebSocket; setTimeoutImpl?: typeof setTimeout });
    send(m: TClientMsg): void; // dropped while not open
    close(): void;
  }
  ```
  URL: `` `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws` ``. Reconnect backoff is 0.5 s, 1 s, 2 s, 4 s, capped at 8 s, and resets on `welcome`. It stops reconnecting after `kicked`.
- [ ] **Step 1: Failing tests:** `sends hello on open`, `reconnects with backoff` (Review Focus 4: delays `[500,1000,2000,4000,8000,8000]`), `no reconnect after kicked`, `send is dropped while closed`.
- [ ] **Step 2: Run** `cd activity && bun test src/net.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(activity): websocket connection with reconnect`.

---

### Task 13: World rendering

**Files:**
- Create: `activity/src/textures.ts` (port the procedural sprite functions from `managers/RenderManager.ts`, using `document.createElement("canvas")`, and register them as Phaser textures)
- Create: `activity/src/scenes/World.ts`
- Create: `activity/src/state.ts` (client mirror: instance, tiles, players, wallet)
- Test: `activity/src/state.test.ts`

**Interfaces:**
- Consumes: Task 4 `terrainAt`, `cropStage`, `darkness`, `clock`; Task 1 messages.
- Produces:
  ```ts
  // activity/src/state.ts
  export class ClientState {
    instance: TInstance | null; you: TPlayerView | null; wallet: { coins: number; gems: number; inventory: Record<string, number>; energy: number };
    apply(m: TServerMsg): { redrawTiles?: string[]; redrawChunks?: boolean; players?: string[] }; // pure reducer; scene reacts to the returned hints
  }
  ```
  Scene: 16 px source tiles drawn at scale 3. Chunks are drawn lazily into one `RenderTexture` each, for those within 2 chunks of the camera, and the rest are destroyed. Locked chunks get a 50% dark overlay and fence edges. Other players are drawn 100 ms in the past, interpolated between buffered server positions. Your own player is drawn at the predicted position. Every player gets a name label and a crown if `premium`. Speech bubbles for local chat (4 s) attach above the sprite. Night uses a full-screen rectangle with alpha `darkness(minuteOfDay)`. The camera follows `you` with `roundPixels`.
- [ ] **Step 1: Failing tests** for `ClientState.apply`: `welcome` builds the instance with `unlocked` as a Set. `tiles` returns `redrawTiles` keys and a `null` tile deletes. `chunks` sets `redrawChunks`. `left` removes the player.
- [ ] **Step 2: Run** `cd activity && bun test src/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the state, then the scene.
- [ ] **Step 4: Run** `cd activity && bun test && bunx vite build`. Expected: PASS. Then manual check with Task 15's dev setup: open the Activity, see your land, the town through the land gate, walk out into the meadow and forest, and watch a second account glide smoothly with no tile snapping.
- [ ] **Step 5: Commit** `feat(activity): chunked world rendering and player interpolation`.

---

### Task 14: Input, prediction and UI

**Files:**
- Create: `activity/src/input.ts` (keyboard and touch)
- Create: `activity/src/predict.ts`
- Create: `activity/src/ui/` (`hud.ts`, `hotbar.ts`, `toast.ts`, `shop.ts`, `inventory.ts`, `unlock.ts`, `gems.ts`): plain DOM overlays styled in `activity/src/ui/ui.css`
- Test: `activity/src/predict.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // activity/src/predict.ts
  export class Predictor {
    constructor(state: ClientState, now: () => number);
    setInput(dx: -1|0|1, dy: -1|0|1): TClientMsg | null; // returns an input msg (new seq) to send if direction changed or 100 ms passed
    advance(dtMs: number): void;                           // fixed-step: runs engine.simulate in TICK_MS slices with the current input, recording each slice under its seq
    reconcile(m: Extract<TServerMsg, { t: "you" }>): void; // set position to server x/y, drop slices with seq <= m.ack, replay the rest
  }
  ```
  Input: hold arrows or WASD to walk in 8 directions. `E` or Space uses. `1`–`9` select hotbar slots. `I` opens inventory. `Esc` closes panels. Touch: an 8-way virtual joystick bottom-left and A (use) and B (inventory) bottom-right, shown when `matchMedia("(pointer: coarse)")`.
  UI:
  - The HUD shows coins, gems, an energy bar and the clock.
  - The hotbar shows tools plus seeds held.
  - Toasts stack top-centre and last 3 s.
  - The shop panel opens on `menu:"shop"` and lists buy and sell with prices from the snapshot.
  - `Enter` focuses the chat box, so movement keys are ignored while typing.
  - The lobby switcher (`L`, or a button in the HUD) shows the `lobbyList` with number, label and player count, and highlights the current lobby. The HUD shows `Lobby #n` or `Home · <name> #n` while in the public world.
  - The unlock dialog opens when using a fence tile and shows the `unlockPrice` and an "Unlock" button.
  - The gems panel lists `PRODUCTS` with INR prices. A "Buy" button sends `buyGems`, and the panel shows "Check your Discord DMs to pay".
- [ ] **Step 1: Failing tests:** `setInput returns msg only on change or after 100 ms`, `advance matches server simulate for the same inputs`, `reconcile with no mismatch leaves position unchanged`, `reconcile after a server correction replays pending inputs to the right spot`.
- [ ] **Step 2: Run** `cd activity && bun test src/predict.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the predictor, then input, then UI.
- [ ] **Step 4: Run** `cd activity && bun test && bunx vite build`. Expected: PASS. Manual check in Discord desktop and mobile: walk, till, plant, water, buy seeds, sell a crop, unlock a chunk, and press Buy Gems to receive a DM.
- [ ] **Step 5: Commit** `feat(activity): input, client prediction and game UI`.

---

### Task 15: Launch command, cleanup, migration, deploy

**Files:**
- Modify: `commands/farm/play.ts` (`await interaction.launchActivity()`; if it throws, reply ephemeral "Activities aren't enabled for this app yet.")
- Delete: `managers/GameManager.ts`, `managers/RenderManager.ts`, `commands/farm/controls.ts`, `scripts/render-frame.ts`, `tests/game.test.ts`; remove `game` and `render` from `ClientManager`; remove `@napi-rs/canvas` from `package.json` if nothing else imports it (check with `grep -r "@napi-rs/canvas" --include=*.ts .`)
- Modify: `tests/commands.test.ts` (remove the farm controls cases; add `farm play calls launchActivity`)
- Create: `scripts/migrate-activity.ts`
- Modify: `.example.env` (add `PORT=3000`, `PUBLIC_URL="https://<your-domain>"`, `VITE_DISCORD_CLIENT_ID="<same as BOT_ID>"`, and a note that `BOT_SECRET` is the OAuth2 client secret)
- Modify: `start.sh`, `pm2.config.js` (run `bun run activity:build` before start)
- Modify: `README.md` (Activity setup section, below)

**Interfaces:**
- `scripts/migrate-activity.ts`: `bun scripts/migrate-activity.ts --backup-dir ./backups` writes `game_worlds.json`, `game_players.json` and `game_tiles.json`, then drops those three collections. With `--dry-run` it only prints counts. It never touches `wallets`, `inventories` or `ledger_entries` (D2).
- [ ] **Step 1: Failing test** in `tests/commands.test.ts`: `farm play calls launchActivity` with a stub interaction whose `launchActivity` is a `mock()`.
- [ ] **Step 2: Run** `bun test tests/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the command change and the deletions. Write the migration script.
- [ ] **Step 4: Run** `bun test && bunx tsc --noEmit && bun run activity:build`. Expected: all PASS with no type errors.
- [ ] **Step 5: Run** `bun scripts/migrate-activity.ts --dry-run` against a local DB. Expected: three counts are printed and nothing is dropped.
- [ ] **Step 6: Write the README "Activity setup" section** with these exact steps:
  1. In the Developer Portal, go to **Activities → Settings** and enable Activities.
  2. Under **Activities → URL Mappings**, map `/` to your `PUBLIC_URL` host without `https://`.
  3. Under **OAuth2 → Redirects**, add `https://127.0.0.1`. The SDK needs a redirect URI to exist, even though it's unused.
  4. Set `.env` with `BOT_ID`, `BOT_SECRET`, `PUBLIC_URL`, `PORT`, `VITE_DISCORD_CLIENT_ID` and the Razorpay variables.
  5. For local dev, run `bun run dev` and `bun run activity:dev`, then `cloudflared tunnel --url http://localhost:5173`, and map `/` to the tunnel host in step 2.
  6. Back up the database, then run `bun scripts/migrate-activity.ts --backup-dir ./backups` once.
- [ ] **Step 7: Commit** `feat(farm): launch activity from /farm play; remove png game; migration script`.

---

### Task 16: Chat

**Files:**
- Create: `game/chat.ts` (pure parsing and audience rules)
- Modify: `managers/GameServer.ts` (handle `chat`, mute lists, rate limits, logging)
- Modify: `managers/models/Game.ts` (add `ChatLog { channel, fromId, instanceId, text, at }` with a TTL index of `30 * 86400` seconds on `at`; add `mutedIds: string[]` and `globalMutedUntil?: Date` to `PlayerState`)
- Create: `activity/src/ui/chat.ts` (log panel with channel colours: local white, private green, global gold; input box; speech bubbles through the World scene)
- Create: `commands/owner/gmute.ts` (bot-owner slash command `/gmute <user> <minutes>`)
- Test: `tests/chat.test.ts`, plus a `describe("chat")` in `tests/game-server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // game/chat.ts
  export const CHAT_RADIUS = 8, CHAT_MAX = 200;
  export type TChatChannel = "local" | "private" | "global";
  export type TChatCommand = { kind: "say"; channel: TChatChannel; text: string } | { kind: "mute" | "unmute"; name: string } | { kind: "error"; msg: string };
  export function parseChat(raw: string): TChatCommand;    // "/g hi" → global, "/p hi" → private, "/mute Bob", "/unmute Bob", other "/x" → error "Unknown command. Use /g, /p, /e, /mute or /unmute."; plain → local
  export function localAudience(inst: TInstance, fromId: string): string[]; // userIds in inst within CHAT_RADIUS of sender (sender included)
  ```
  The server's private audience is every player in the sender's current instance: their private land, or their lobby. Global is every connected session. Recipients that muted the sender are skipped. Global messages from a player with `globalMutedUntil > now` are rejected with the toast `"You are muted from global chat."`. Text is trimmed, control characters are stripped, and it's sent to clients as plain text (the client renders with `textContent`, never `innerHTML`).
- [ ] **Step 1: Failing tests** in `tests/chat.test.ts`:
  - `parseChat` gives `local` for `"hi"`, `global` for `"/g hi"`, `private` for `"/p hi"`, an error for `"/x"`, and an error for `"/g "` (empty).
  - `localAudience` includes a player at distance 8, excludes one at 8.01, and excludes players in other instances.
- [ ] **Step 2: Failing tests** in `tests/game-server.test.ts`:
  - `local chat reaches only nearby players`
  - `private chat on private land reaches everyone on that land and nobody in the world`
  - `private chat in a lobby reaches the whole lobby and nobody on private lands or in other lobbies`
  - `global reaches all instances`
  - `chat rate limit 1/s` (second message → toast)
  - `global rate limit 1 per 5 s`
  - `muted sender is hidden from the muter only`
  - `gmuted player cannot /g but can talk locally`
  - `global and private messages are written to ChatLog, local are not`
- [ ] **Step 3: Run** `bun test tests/chat.test.ts tests/game-server.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `game/chat.ts`, then the server handler, then `/gmute`, then the client panel (Enter opens the input; Esc closes; last 100 messages kept).
- [ ] **Step 5: Run** `bun test && cd activity && bun test && bunx vite build`. Expected: PASS. Manual check with two accounts: local works only within 8 tiles, `/p` on private land, `/g` from a private land reaches the world.
- [ ] **Step 6: Commit** `feat(chat): local, private and global chat with moderation`.

---

### Task 17: Wild animals

**Files:**
- Create: `game/entities.ts`
- Modify: `managers/GameServer.ts` (simulate animals in active chunks; broadcast `ents` within AOI)
- Modify: `activity/src/state.ts`, `activity/src/scenes/World.ts`, `activity/src/textures.ts` (animal sprites and interpolation)
- Modify: `game/data/items.ts` (add tradeable `raw_meat` base 15, `venison` base 40, `hide` base 20, `feather` base 4) and `game/engine.ts` `use()` (an animal within 1.2 tiles in front of the player is hit before the tile action; costs 2 energy)
- Test: `tests/entities.test.ts`, plus `describe("animals")` in `tests/game-server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TAnimalKind = "rabbit" | "deer" | "duck" | "boar";   // Phase 1: passive wildlife that can be slaughtered
  export interface TAnimal { id: number; kind: TAnimalKind; x: number; y: number; facing: TDir; homeX: number; homeY: number; state: "idle" | "wander" | "flee" | "dead"; until: number; hp: number }
  export const ANIMAL_HP: Record<TAnimalKind, number> = { rabbit: 1, duck: 1, deer: 3, boar: 4 };
  export const ANIMAL_DROPS: Record<TAnimalKind, Record<string, number>> = { rabbit: { raw_meat: 1, hide: 1 }, duck: { raw_meat: 1, feather: 2 }, deer: { venison: 2, hide: 2 }, boar: { raw_meat: 3, hide: 1 } };
  export function hitAnimal(a: TAnimal, now: number): { killed: boolean; drops?: Record<string, number> }; // −1 hp, enters flee; at 0 → state "dead", until = now + ANIMAL_RESPAWN_MS, returns drops
  // dead animals are not sent in ents; at `until` they respawn at home with full hp
  export const ANIMALS: Record<TAnimalKind, { speed: number; fleeSpeed: number; fleeRadius: number; regions: TRegion[]; perChunk: number }>;
  // rabbit 2/5.5/3/[meadow,forest]/1.5, deer 2.5/6/5/[forest,wilds]/0.6, duck 1.5/3/3/[lake]/1, boar 2/4/2/[forest,wilds]/0.4
  export function spawnAnimals(cx: number, cy: number): TAnimal[];   // deterministic from (WORLD_SEED, cx, cy); count = floor(perChunk) + (roll < frac); never on non-walkable tiles; ids unique per chunk via cx,cy hash
  export function tickAnimal(a: TAnimal, inst: TInstance, nearestPlayer: { x: number; y: number; d: number } | null, now: number, dtMs: number, rand: () => number): void;
  // idle 1–4 s → wander toward a random point within 6 tiles of home → idle; a player within fleeRadius → flee directly away at fleeSpeed for 2 s; same collision as players (engine.simulate rules); never leaves 12 tiles from home
  ```
  Server: a world chunk is **active** while any player's AOI covers it. Animals spawn when a chunk becomes active and are dropped 60 s after it goes inactive (they respawn fresh next time; not persisted). They're simulated each tick only in active chunks.
- [ ] **Step 1: Failing tests** in `tests/entities.test.ts`:
  - `spawnAnimals is deterministic and region-correct`: same output twice; no deer in meadow-only chunks; no animal on water or tree tiles.
  - `flees from a close player`: rabbit with a player at distance 2 enters `flee`, and after 500 ms its distance from the player has grown.
  - `stays near home`: after 10 simulated minutes of wandering, distance from home is ≤ 12.
  - `blocked by walls`: an animal never ends inside a non-walkable tile over 10 simulated minutes.
  - `slaughter drops and respawns`: a deer takes 3 hits; the third returns `{venison:2, hide:2}`; it's absent while dead and back at home with full hp after `ANIMAL_RESPAWN_MS`.
- [ ] **Step 2: Failing tests** in `tests/game-server.test.ts`: `ents only within AOI`, `inactive chunks are not simulated` (spy on `tickAnimal` call count), `animals despawn 60 s after chunk goes inactive`, `slaughter credits drops to the hitter's inventory through EconomyManager`, `slaughter works in lobbies and on private land`.
- [ ] **Step 3: Run** `bun test tests/entities.test.ts tests/game-server.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the entity module, server integration, then client sprites (drawn 100 ms behind, interpolated like other players).
- [ ] **Step 5: Run** `bun test && cd activity && bun test && bunx vite build`. Expected: PASS. Manual check: rabbits scatter when you walk at them, and hitting one drops meat and hide.
- [ ] **Step 6: Commit** `feat(world): wild animals with slaughter, respawn and AOI sync`.

Hostile wildlife, hunting and livestock (cattle management) are Phase 3.1 and build on this module (spec §4.8).

---

### Task 18: Emotes and cosmetic ownership

**Files:**
- Create: `game/data/emotes.ts`
- Create: `managers/models/Cosmetics.ts` (`Ownership { userId, itemId, source: "free" | "gems" | "razorpay" | "grant", sourceKey (unique, sparse), at }`, index `{userId:1, itemId:1}` unique)
- Modify: `game/data/products.ts` (add `kind: "cosmetic"` with `items: string[]`; first product `emotes_party_pack` ₹149 with breakdance, moonwalk, backflip, chicken dance, spin)
- Modify: `managers/PaymentManager.ts` (`grant`/`revoke` handle `kind: "cosmetic"`: upsert or delete `Ownership` rows keyed by `sourceKey:itemId`; `revoke` removes only rows from that `sourceKey`)
- Modify: `managers/GameServer.ts` (handle `emote` and `buyCosmetic`; send `owned` after welcome and after grants)
- Create: `activity/src/ui/emotes.ts` (emote wheel: free emotes first, premium ones locked with a gem price and a "Buy pack" button), plus emote animations in `World.ts`
- Test: `tests/emotes.test.ts`, plus `describe("emotes")` in `tests/game-server.test.ts` and `tests/payments.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // game/data/emotes.ts
  export interface TEmote { id: string; name: string; icon: string; anim: "bounce" | "spin" | "shake" | "jump" | "sit" | "lie" | "wiggle" | "float"; gems: number | null } // null = free
  export const EMOTES: Record<string, TEmote>;
  export const FREE_EMOTES: string[]; // exactly 15: wave, nod, shake_head, laugh, cry, angry, love, thumbs_up, clap, dance, sit, sleep, surprised, thinking, point
  // premium (gems): breakdance 150, moonwalk 150, flex 75, guitar 120, fireworks 200, money_rain 200, rain_cloud 75, royal_bow 100, backflip 150, facepalm 50, zombie_walk 100, victory 75, salute 50, chicken_dance 120, spin 50
  export function canUseEmote(id: string, owned: ReadonlySet<string>): boolean;
  ```
  `/e <id>` in chat is parsed by `parseChat` as `{ kind: "emote"; id }`; add that variant to `TChatCommand` in Task 16's file.
- [ ] **Step 1: Failing tests** in `tests/emotes.test.ts`: `exactly 15 free emotes`, `every FREE_EMOTES id has gems === null and every other emote has gems > 0`, `canUseEmote` allows free ids and owned premium ids only, `parseChat("/e wave")` gives the emote command.
- [ ] **Step 2: Failing tests** in `tests/game-server.test.ts`:
  - `emote broadcasts to AOI only`
  - `locked premium emote is rejected with toast "Unlock this emote first."`
  - `emote rate limit 1 per 2 s`
  - `buyCosmetic via gems debits gems once and sends owned` (two parallel buys → one debit, idempotency key `cosmetic:<userId>:<itemId>`)
  - `buyCosmetic via gems fails cleanly when gems are short` (toast, nothing owned)
  - `buyCosmetic via razorpay DMs the pack link`
- [ ] **Step 3: Failing tests** in `tests/payments.test.ts`: `cosmetic grant creates Ownership rows once`, `cosmetic refund removes only that purchase's rows`.
- [ ] **Step 4: Run** `bun test tests/emotes.test.ts tests/game-server.test.ts tests/payments.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement.** Gem purchase: `eco.transact([{userId, gems: -price}], {reason: "cosmetic", ref: itemId, idempotencyKey})`, then upsert `Ownership`. If the upsert finds an existing row, the transact's idempotency already made the debit a no-op.
- [ ] **Step 6: Run** `bun test && cd activity && bun test && bunx vite build`. Expected: PASS. Manual check: the wheel shows 15 free emotes, a gem buy unlocks one live, and a second account sees the animation.
- [ ] **Step 7: Commit** `feat(emotes): 15 free emotes, premium emotes via gems or razorpay`.

---

## Self-review notes

- **Spec coverage.** Continuous movement (§5, J7 b): Tasks 1, 4, 9, 13 and 14. Chat (§4.5): Task 16. §4.1 instances: Tasks 4 and 9. §4.2 chunks: Tasks 2 and 6. §4.3 open world, read-only lobbies and regrowth: Tasks 3, 4 and 9; home lobbies and the switcher: Tasks 7, 9 and 14. Emotes (§4.5a): Task 18. Wild animals (§4.8): Task 17. §5 architecture: Tasks 7, 8 and 11. D4 Razorpay via bot: Task 10. D2 migration and D3 launcher: Task 15. §4.4 social, §4.6 night vision, §4.7 jobs and §4.9 cosmetics are Phases 2 to 4 and out of scope here, apart from the gem purchase entry point.
- `canBuild` is owner-only in Phase 1. Phase 2 replaces its body with the permission table, and the signature stays.
- `Land.slot` exists now so the Phase 4 second land doesn't need a migration.
