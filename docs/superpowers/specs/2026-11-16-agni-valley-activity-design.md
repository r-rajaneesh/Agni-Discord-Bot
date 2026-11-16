# Agni Valley as a Discord Activity: Game Design

Date: 2026-11-16
Status: draft for review

## 1. Why

The chat version of Agni Valley is unplayable. Each button press renders a PNG on the server and edits an ephemeral message, which gives about 1 frame per second. Walking from A to B takes many clicks and waits. The game moves to a Discord Activity, an HTML5 app running in an iframe inside Discord through the Embedded App SDK. The client draws at 60 fps and sends only player intents to the server.

The move also changes what the game is. It stops being one shared field of plots and becomes a long-running sandbox life-sim. It is an **open-world** game. Each player owns private land (unlimited but locked in chunks) where they can farm, ranch, build, lay track and run industries. Everyone shares one large open public world with a town, meadows, forests, hills, lakes and wilds, and later the City, Industrial and Port districts. Over time they move through jobs and industries from 1900 to 2026: farming, vehicles, shops, factories, offices, IT, the army and trains. The goal, in the owner's words, is "the wildest game ever".

## 2. Goals, non-goals, anti-goals

Goals
- Real-time movement and actions inside Discord (desktop, web and mobile clients).
- A private land per player, unlimited in size but locked in chunks. Players earn or buy chunks to expand.
- A seamless open public world: walk or drive out of town into wilderness with wild animals, resources and jobs.
- Livestock (cattle management) on private land, and wild animals in the world (§4.8).
- Friends who can visit each other's lands, with per-land permissions. Private land can have members who join it in addition to their own land.
- A job and industry system that spans 1900 to 2026 and grows release by release (see `docs/design/2026-11-16-jobs-decisions.md`).
- Monetization once people are playing: cosmetics (skins, land themes), land chunks, a second land.

Non-goals (for now)
- 3D. The game stays top-down 16×16 pixel art. Movement and vehicles use 2D continuous physics (J7 b), and the world stays tile-based.
- Real-money trading between players. Gems never become coins and are never tradeable (existing rule in `game/data/products.ts`).
- A standalone website or mobile app outside Discord.

Anti-goals (would make this a failure even if it works)
- Pay-to-win. Nothing bought with money may produce coins or items that sell for coins, beyond what a free player can earn with time. Land bought with gems must also be earnable with coins.
- Losing a player's progress through a crash or a deploy. Economic writes stay immediate and idempotent, as they are today.
- Unmoderated chat. Global chat crosses Discord servers, so it ships with rate limits, mute, block and moderation logs from day one (§4.5).

## 3. Research summary: what we borrow

### Hypixel SkyBlock
- **Private island + hub.** Each profile has a private island. A shared hub holds shops, NPCs and the Bazaar. Players move between them with travel commands and portals.
- **Co-op.** Several players share one profile and island, and every member can use the minions on it. Island upgrades are shared across the co-op. Co-op members cannot "visit" each other because they already live there.
- **Guests.** Other players can `/visit` an island. The guest cap depends on rank and is raised by a profile upgrade (first upgrade free, later ones cost gems). Owners can kick guests, and a kick also bans them for a while.
- **Island upgrades.** Community or profile upgrades raise island size, minion slots, guest slots and co-op slots. Most are earnable for free over time.
- **Skills and collections.** Skills level up per activity (farming, mining, foraging and others). Collections count lifetime totals per item and unlock recipes. Together they gate progression.
- **Minions.** Placed automation that gathers resources while you are away. This is the model for our workers, machines and factories.
- **Bazaar vs. Auction House.** The Bazaar trades commodities with bulk buy and sell orders. The Auction House sells unique or rare items with listing fees. Our `EconomyManager` already has an NPC market and a limit-order book, which is a Bazaar.

### Horizon Roleplay (SA:MP)
- **Jobs taken at a physical location.** You go to a job's pickup point, take the job, and use job-specific commands. Jobs level from 1 to 5 by repeating the work, and higher levels unlock more (for example, Arms Dealer unlocks all weapons at level 5).
- **Jobs that serve other players.** Mechanics repair and refuel other players' cars, lawyers get people out of jail, and bodyguards sell protection. Truckers move cargo, detectives find people. Jobs form a player-to-player service economy.
- **Factions and families.** There are government factions (LSPD, FBI, fire department, San News, government, a hitman agency) and player "families" (gangs and mafias). Factions are organizations with ranks, separate from jobs.
- **Job roster.** The roster seen across sources includes Detective, Lawyer, Drug Dealer, Drug Smuggler, Arms Dealer, Mechanic, Boxer, Fisherman, Trucker, Carjacker, Pizza Boy, Bodyguard, Craftsman, Bartender and Taxi Driver. Some of these are crime jobs (see jobs doc, J3).

The research sources were community wikis, forum posts and changelogs, some from years ago. Details like exact caps may be out of date. This design borrows only the structures.

### Discord Activities
- Purchases inside an Activity use `discordSdk.commands.startPurchase({ sku_id })`, and the server must verify entitlements through the HTTP API ("trust the SDK, verify via the API"). Consumables must be consumed after the grant. `PaymentManager.handleEntitlement` already does this.
- **Decided (owner, 2026-11-16):** Discord's own store is not available to sellers in India, so the game sells through **Razorpay via the bot**. The Activity never takes payment itself. A "Buy" button asks the server to create a Razorpay payment link, and the bot DMs it to the player. When the existing `/webhooks/razorpay` handler grants the purchase, the server pushes the new wallet and unlocks to the player's open Activity session. Discord SKU support in `PaymentManager` stays in place for later.
- Open risk: the research did not confirm Discord's policy on selling outside its store for content used inside an Activity. Keeping checkout in a bot DM, outside the Activity iframe, is the lower-risk shape.

## 4. Game structure

### 4.1 Instances
Every place a player can be is an **instance**: a map plus its tiles plus the players currently in it. There are two kinds.

| Kind | Who can enter | Map | Count |
|------|---------------|-----|-------|
| `land` | owner, members, and guests the permissions allow | chunked, procedurally generated per land, unlimited | one per land (one per player at first; a second land later) |
| `world` (a **lobby**) | everyone | public world of 64 × 64 chunks (1024 × 1024 tiles), procedural regions around a stamped Town (today's town square and store, without the plots); ocean at the edge; space reserved for later districts | many lobbies, each an identical copy for up to 100 players (§4.3) |

The server holds loaded instances in memory and unloads private land 5 minutes after its last player leaves. Public lobby #1 is always loaded; other lobbies unload when empty. In the world, the server only simulates and sends what is within 2 chunks of each player (area of interest), so a big map stays cheap.

### 4.2 Private land: unlimited, chunk-locked
- Land is divided into **chunks** of 16×16 tiles, addressed by integer `(cx, cy)` with no bounds.
- Terrain inside a chunk comes from `(landSeed, cx, cy)`: grass, trees, rocks, ponds and occasional ore. The same seed always gives the same chunk, so only changes are stored, the same way `baseTerrain` plus `GameTile` works today.
- A new land starts with the 3×3 chunks around `(0, 0)` unlocked (48×48 tiles), with the house at the centre.
- Locked chunks are visible behind a fence and dimmed. Walking up to the fence shows the unlock price.
- **Unlock cost:** `price(n) = round(500 × 1.35^(n − 9))` coins, where `n` is the number of chunks already unlocked. The 10th chunk costs 500, the 11th 675, the 20th 10,053 and the 30th 202,137. A chunk can be unlocked only if it touches an unlocked chunk (edges count, corners do not).
- In Phase 4, a chunk can also be bought with gems at the same `n`-based curve converted at a fixed rate. Coin unlock stays available forever (anti-goal: no pay-to-win).

### 4.3 Open world
- **Town** at the centre keeps today's town square and General Store, and gains a **Job Centre**, a **Market** building (the existing order book), a **Land Gate** that sends players to their private land, and empty lots for later job buildings.
- **Regions** around it: meadow, forest, hills (quarry), lake, wilds, and flat "reserved" space for later districts. Dirt roads link the town to each region.
- **Public land is read-only** (Hypixel SkyBlock style). Players can't build, place, till or destroy anything in a lobby. They can only interact. The exceptions are **gathering**, and everything gathered **regrows**:
  - **Public crop fields** in the meadows (wheat, potato, pumpkin and more) are harvested by anyone and regrow 5 minutes later.
  - **Rocks and ore** in the hills are mined and regrow after 2 minutes. **Trees** in the forest are chopped and regrow after 3 minutes (my call, matching SkyBlock's public foraging).
  - **Wild animals** can be slaughtered for drops (meat, hide, feathers) and respawn 1 minute later (§4.8).
  - Regrowth state lives in memory per lobby and isn't saved.
- **Sandbox freedom (build, destroy, terraform, lay track) exists only on private land.**

#### Lobbies
- Every copy of the public world is a **lobby** with a number: `#1`, `#2`, and so on. Numbers are reused once a lobby closes. Each holds up to 100 players.
- **Home lobby:** each Discord server that runs the Activity gets its own lobby, labelled "Home · <server name>" plus its number. It opens automatically the first time someone launches the game from that server and closes when empty. Launching from a server puts you in its home lobby. Launching from a DM or group DM, or when the home lobby is full, puts you in the public lobby with the most players that still has room.
- **Lobby switcher:** a menu lists every open lobby with its number, label and player count, and in Phase 2 which friends are in it. Players can switch to any lobby that isn't full. Home lobbies are joinable by anyone. Switching keeps your position.
- Each lobby has its own regrowth state, so a field picked bare in #1 may be full in #2.- **Private land is not only farmland.** It is the player's own open space: farms, ranches, houses, workshops, factories and private rail all go there as later phases ship.
- From the land's portal stone or house door, players go back to the world where they left it. From the Land Gate, they go to their land.

### 4.4 Social (Phase 2)
- **Friends:** request, accept, remove, block. Friends stay in sync with nothing from Discord except the user ID, so friends can be from different servers.
- **Visiting:** a player can visit a friend's land if that land's permission level allows it.
- **Land permissions**, one per role (owner, member, friend, everyone):
  - `none`: cannot enter
  - `visit`: can walk around
  - `harvest`: can also harvest and water
  - `build`: can also till, plant, cut and mine
  - `manage`: can also unlock chunks, invite and kick (members only)
- **Land members:** the owner invites a player to join. Members have their own land too, and they switch between lands from the portal. Wallets stay personal. Harvests go to the person who harvests. A shared land chest comes in Phase 2.
- **Guest cap:** 5 guests at once per land at first, raisable later.
- **Kick and ban:** the owner or a manager can kick a guest, which bans them for 30 minutes.

### 4.5 Chat (Phase 1)
Built into the Activity. Every message has a channel picked by its prefix:

| Typed | Channel | Who sees it |
|---|---|---|
| plain text | **local** | players in the same instance within `CHAT_RADIUS = 8` tiles of the sender (Euclidean, from player centres). On a private land this never leaves the land. |
| `/p <text>` | **private** | everyone on the land you're standing on: on private land, everyone there (owner, members, guests); in the public world, everyone in your lobby |
| `/g <text>` | **global** | every online player in every instance |

- Messages appear in a chat log and, for local messages, as a speech bubble over the sender for 4 s.
- Limits: 200 characters, 1 message/s per player, 1 global message per 5 s, and links are not clickable.
- Safety: `/mute <name>` hides a player for you, and `/block` (Phase 2 friends) also hides chat. Bot owners can `/gmute` a player from global chat. Global and private messages are logged for 30 days for moderation.
- The base radius can change with game logic later, for example shouting, a megaphone item, or smaller radius indoors.

### 4.5a Emotes (Phase 1)
- Players play an emote with `/e <name>`, the emote wheel (`T` key or a button on mobile), or the chat box. Everyone within the area of interest sees the animation and an icon above the player for 3 seconds. Limit: 1 emote per 2 seconds.
- **15 free emotes:** wave, nod, shake head, laugh, cry, angry, love (heart), thumbs up, clap, dance, sit, sleep (zzz), surprised, thinking, point.
- **Premium emotes** are unlocked by either:
  - **in-game payment:** gems, at 50 to 200 gems each, or
  - **external payment:** Razorpay emote packs that the bot DMs as a link, the same flow as gems.
- First premium set: breakdance, moonwalk, flex, guitar solo, fireworks, money rain, rain cloud, royal bow, backflip, facepalm, zombie walk, victory, salute, chicken dance, spin.
- Owned cosmetics live in a new `Ownership` record (user, item, source). Skins and themes reuse it in Phase 4.

### 4.6 Light and night (Phase 1 visuals, Phase 3.1 gameplay)
- Phase 1 draws a darkness overlay from `darkness(minuteOfDay)`, as today.
- Phase 3.1 turns night into gameplay: each player's vision radius shrinks after dusk. Light sources (street lamps lit by the Lamplighter, lanterns and later electric lights) restore vision around them (jobs doc, Lamplighter).

### 4.7 Progression
- **Skills** (Hypixel-style), levelled by XP per action: Farming, Foraging, Mining, Fishing, and then one per job family as jobs ship.
- **Job levels** (Horizon-style), 1 to 5 per job, by repetitions. Higher levels unlock better pay, tools and recipes.
- **Eras:** jobs and buildings unlock by era (1900s, 1920s and so on up to 2026). How eras unlock is decision J1 in the jobs doc, and it shapes the whole long-term game.

### 4.8 Animals
- **Phase 1, wild animals (passive):** rabbits, deer, ducks and boars spawn by region in world chunks near players. They wander around a home point and flee from players. They exist only while a player is nearby and aren't saved.
- **Phase 3.1, wildlife:** hostile animals at night in the wilds (wolves, bears) that can knock players out and raid unfenced livestock. Hunting with Hunter-job weapons, hunting seasons, and a Game Warden NPC.
- **Phase 3.1, livestock (cattle management):** buy and raise cows, chickens, sheep, pigs, goats and horses on private land.
  - Each animal has hunger, thirst, happiness and health. Barns, coops and fences give shelter and keep animals in, and troughs give food and water.
  - Products depend on care: milk, eggs, wool, meat and leather.
  - **Breeding** with traits (yield, temperament, colour) that pass to offspring, and a **herding** mechanic for moving animals between pens and pastures.
  - **Disease** spreads in crowded or dirty pens, and a Vet (new job) treats it.
  - **Horses** are the first mount: faster than walking on any terrain, the 1900s bridge to vehicles.
  - Livestock can be sold at a town auction yard or on the Market.

### 4.9 Monetization (Phase 4)
| Product | Kind | Notes |
|---------|------|-------|
| Gems (existing packs) | Razorpay one-time | buy the things below |
| Skins (character outfits) | gem item, durable | cosmetic only |
| Premium emotes | gems, or Razorpay emote packs | cosmetic only; ships in Phase 1 (§4.5a) |
| Land themes (grass, fence, house palette) | gem item, durable | cosmetic only |
| Land chunk | gem price on the same curve | coin unlock stays available |
| Second land | gems | a second private land instance with its own seed and land |
| Farm Pass (existing) | Razorpay one-time, 30 days | crown and daily energy refill, unchanged |

All real-money products are sold through Razorpay links that the bot DMs (decided, see §3). Gems are the in-game currency for everything cosmetic.

## 5. Architecture

```
Discord client
  └─ Activity iframe (https://<app_id>.discordsays.com)
       activity/  Vite + TypeScript + Phaser 3 + @discord/embedded-app-sdk
        │  HTTPS  /api/token        (OAuth code → access token)
        │  WSS    /ws               (game protocol, JSON)
        ▼  Discord proxy (URL mapping "/" → PUBLIC_URL)
Bun process (index.ts)
  ├─ discord.js bot (commands, /farm play → launch Activity, DMs Razorpay links)
  ├─ server.ts  Bun.serve: /health /paid /webhooks/razorpay /api/token /ws + static activity/dist
  ├─ GameServer (managers/GameServer.ts): sessions, instances, 20 Hz tick, broadcast
  ├─ game/ (pure rules, shared with the client): engine, chunks, world map, entities, chat, protocol
  └─ EconomyManager / PaymentManager (unchanged ledger, idempotent grants)
MongoDB
```

Calls I made, open to correction:
- **One process.** The bot, HTTP and WebSocket share one Bun process so the game can reuse `EconomyManager` and `PaymentManager` directly. Split it later if load needs that.
- **`Bun.serve` instead of Express.** Bun has native WebSockets, and the current Express server is 40 lines. Moving to `Bun.serve` removes the `express`, `helmet` and `cors` dependencies.
- **Single-page app**, as Discord requires for Activities: one `index.html`, no page navigations, everything bundled by Vite and served through Discord's proxy.
- **Phaser 3** on the client. It gives tilemaps, camera, input, tweens and scaling, and it has published Discord Activity guides. Textures stay procedural and are ported from `RenderManager`.
- **Continuous, server-simulated movement** (because the owner chose real driving physics, J7 b). Positions are floats in tile units. The client sends only its held direction (8-way). The server simulates every player on a 20 Hz tick at `WALK_SPEED = 4.5` tiles/s, with axis-separated box collision (0.6 × 0.6 tiles) against non-walkable tiles. The client predicts its own player with the same `game/` code and replays unacknowledged inputs when the server corrects it. Other players are drawn 100 ms behind, interpolated. Speed hacks can't work because the server ignores client positions. Vehicles in Phase 3 reuse this loop with acceleration, steering and their own collision box. Farming actions still target whole tiles: the tile in front of the player.
- **Shared pure code.** `game/` has no Discord or Mongo imports today. The client imports `game/engine.ts`, `game/chunks.ts`, `game/world.ts` and `game/protocol.ts` for prediction and rendering.
- **Identity.** The server never trusts a user ID from the client. `/api/token` exchanges the OAuth code. The WebSocket's first message carries the access token, which the server checks against `GET https://discord.com/api/v10/users/@me`.

## 6. Decisions

| # | Decision | Options | My pick |
|---|----------|---------|---------|
| D1 | ~~Is the public world global or per Discord server?~~ | **Decided:** numbered lobbies of 100, one home lobby per Discord server, and a lobby switcher (§4.3). | — |
| D2 (default taken) | What happens to existing guild worlds? | **Reset land, keep wallets and inventory** (wallets are already per user). **Migrate each player's plot into chunk (0,0)** of their new land. | Reset land, keep wallets and inventory. Old plots are 7×5 and do not map cleanly onto chunks. |
| D3 (default taken) | Does the chat version stay? | **Keep `/farm play` as a launcher** that opens the Activity. **Keep a reduced chat game too.** | Launcher only. Delete the PNG viewport and keep `/wallet`, `/market` and `/shop`. |
| D4 | ~~Payment provider in the Activity~~ | **Decided:** Razorpay through the bot. Discord's store isn't available in India. | — |
| D5 | Jobs list and era model | **Decided:** see the decisions table in `docs/design/2026-11-16-jobs-decisions.md`. | — |

## 7. Roadmap

| Phase | Ships | Depends on |
|-------|-------|------------|
| 1 | Activity port: real-time client with continuous movement, read-only public lobbies (home lobby per server, switcher, regrowing crops, ore, trees and animals), emotes, private chunked land, coin chunk unlocks, store, inventory, chat | — |
| 2 | Social: friends, visiting, permissions, land members, guest cap, kicks | 1 |
| 3 | Jobs and industries, era by era (separate design per era batch) | 1, decisions in the jobs doc |
| 4 | Monetization: skins, themes, gem chunks, second land, Activity storefront | 1 (2 for themes on visits) |

Each phase gets its own plan. Phase 1's plan is `docs/superpowers/plans/2026-11-16-phase1-activity-port.md`.

## 8. Left to the builder
- Exact pixel art, colours and UI layout, within the existing procedural style.
- The terrain noise for chunks, as long as it is deterministic per `(seed, cx, cy)`.
- Mobile touch controls layout (an on-screen d-pad plus an action button is the minimum).
