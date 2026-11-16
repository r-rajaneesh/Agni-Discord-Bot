# Agni Valley Jobs & Industries: Decisions for You

Date: 2026-11-16
Companion to: `docs/superpowers/specs/2026-11-16-agni-valley-activity-design.md`

This doc lists every job and industry for the 1900 to 2026 range and the decisions that shape them.

## Decisions (owner, 2026-11-16)

| # | Decision |
|---|---|
| J1 | a: personal era progression |
| J2 | b: 2 job slots |
| J3 | **a: full Horizon crime**, including drugs, guns, carjacking and gangs. The owner's reading is that Discord does not explicitly forbid these job roles. |
| J4 | a: opt-in crime. Law-abiding players are never attacked or arrested, and farms are safe zones. |
| J5 | c: NPC floor plus player services |
| J6 | 12-hour offline cap |
| J7 | **b: real driving physics.** Movement becomes continuous for everyone from Phase 1 (see spec §5). |
| J8 | a: army faction with PvE operations |
| J9 | **The public map has a fixed rail network. On private farms, players lay their own track.** |
| J10 | yes: player businesses from the 1920s |
| Cuts | **None. Every job is kept.** Jobs previously marked Cut were redesigned into real loops (marked **Redesigned** below). |

The option lists below are kept as the record of what was considered.

Sources of the mechanics are marked **[H]** for Horizon Roleplay (SA:MP) and **[S]** for Hypixel SkyBlock. Unmarked items are new.

---

## Part A: Decisions that shape every job

### J1. How do eras unlock?
- **a) Personal era progression.** Each player starts in 1900 and advances to the next era by hitting milestones: skill levels, item collections [S] and a coin "investment". Veterans have trains while newcomers plough fields, and both share the hub.
- **b) Server calendar.** The whole game moves forward one era every N weeks, like a season. Everyone gets the same era at once, and late joiners skip early eras.
- **c) Everything at once.** All jobs exist from day one and are gated only by job level and money.

**My pick: a.** It gives a long progression ladder, which is what keeps SkyBlock players for years. It also lets new players start at the beginning without being outclassed, and every era stays relevant because later eras consume earlier eras' goods (see Part C).

### J2. How many jobs can a player hold?
- **a)** 1 job at a time [H]
- **b)** 2 job slots, the second unlocked at a set level
- **c)** No limit: every job is just a skill you level

**My pick: b.** One slot is a dead end when your job has no demand. Unlimited slots remove player-to-player specialization, which is what makes Horizon's service economy work (you need a mechanic because you aren't one). Farming, foraging, mining and fishing are skills, not jobs, so everyone can always do them.

### J3. Crime content
Horizon's roster includes Drug Dealer, Drug Smuggler, Arms Dealer and Carjacker. Discord reviews Activities and apps for its App Directory, and I could not confirm where its content line sits for simulated drug sales or gun crafting. Treat this as a risk to check, not a known rule.
- **a) Full Horizon crime:** drugs, guns, carjacking, gangs
- **b) Stylized crime:** smuggling unmarked "contraband" crates, 1920s bootlegging, heists on NPC banks, car theft from NPCs, a wanted level, police and jail. No drugs and no selling guns to players.
- **c) No crime:** police and lawyers are dropped too

~~My pick: b.~~ **Owner chose a.**

### J4. Police, wanted level and jail
- **a) Opt-in crime:** you become "wanted" only by committing a crime. Police (players) can arrest wanted players, and NPC police respond if no players are online. Jail is a timed stay in the hub jail (5 to 30 minutes). Lawyers cut the time, and bail costs coins.
- **b) No player-vs-player arrests:** only NPC police

**My pick: a**, with a hard rule that law-abiding players can never be attacked or arrested. Farms are always safe zones.

### J5. Who pays the jobs?
- **a) NPC demand only:** contracts from NPC shops and towns
- **b) Players only** [H]
- **c) Both:** NPC contracts set a floor so every job works at 3 a.m. with nobody online. Serving a real player pays more.

**My pick: c.**

### J6. Automation: workers, machines, factories [S minions]
- Offline production runs up to 12 hours, then stops until you collect. Storage per machine is capped.
- Machines take fuel or power from later eras: coal, then electricity, then solar.

**Decide:** is a 12-hour offline cap right? It controls how much the game rewards logging in versus idling. **My pick: 12 hours.**

### J7. Vehicles
- **a) Vehicles as items:** owning one makes you move faster on road tiles, carries cargo, and needs fuel and repairs. The same top-down tile grid, so no new physics.
- **b) Real driving physics:** free movement with momentum, collisions, a separate road map

~~My pick: a.~~ **Owner chose b.** Vehicles have momentum, steering and collisions on a continuous-coordinate world. Vehicles need a bigger map, so a "City" district is reached by road from the hub.

### J8. Army
- **a) A faction [H-style organization]** with ranks. Daily PvE operations: defend the valley from wild-animal raids or storms, escort supply convoys. Factories sell supply contracts to it.
- **b) Cut the army**

**My pick: a.** The army is a large demand sink for factory goods (uniforms, vehicles, rations), which keeps the economy from inflating. No player-vs-player war.

### J9. Trains
- A rail network linking hub districts (Town, City, Industrial, Port). Train Driver and Conductor are jobs.
- Late game: freight rail moves factory output in bulk, cheaper than trucks but only between stations.
- Players can build private sidings to their farm station, which is an expensive late-game coin sink.

**Decided:** the public map has a fixed network. On private farms, players lay track themselves (rail pieces crafted by Blacksmith and Carpenter), connecting to the public network at a farm station.

### J10. Player-owned businesses [H]
- Players can buy a lot in the hub or City and open a shop: bakery, diner, gas station, electronics store, car dealership. They set prices and stock it, and other players and NPCs buy from it.

**My pick: yes, from the 1920s era.** This is what turns individual jobs into an economy.

---

## Part B: Job catalog

Status: **Keep**, **Modify** (changed from the source, with the reason) or **Redesigned** (was cut, now has a real loop). Nothing is cut. "Phase 3.x" is the era batch it ships in.

### 1900s: Agrarian (starting era)
| Job / skill | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Farming (skill) | till, plant, water, harvest | mill, bakery, textile, diner | existing | Keep |
| Foraging (skill) | chop trees | sawmill, carpentry | existing [S] | Keep |
| Mining (skill) | break rocks for ore | smelter, blacksmith | existing [S] | Keep |
| Fishing (skill) | cast at water, timing minigame | diner, market | [H][S] | Keep |
| Rancher (cattle management) | raise cows, chickens, sheep, pigs, goats and horses on private land; feed, water, shelter, breed for traits, herd between pastures; products scale with care (spec §4.8) | Dairy, Textile Mill, Butcher, Tailor (leather) | — | Keep, expanded |
| Vet | treat sick livestock and pets; vaccinate herds to stop disease spreading | Rancher | — | Keep (new) |
| Butcher | process livestock and game into meat cuts | Chef, Cannery, army rations | — | Keep (new) |
| Horse Trainer | break and train horses (speed, stamina); sell mounts; horses are the first mount before vehicles | transport, Rancher | — | Keep (new) |
| Game Warden | patrol the wilds, enforce hunting seasons, fine poachers, relocate dangerous animals | Hunter, wildlife | — | Keep (new) |
| Blacksmith | smelt ore into ingots, then forge tools and parts | every tool upgrade; later vehicles | [H Craftsman] | Keep |
| Miller & Baker | wheat to flour to bread and pies | diner, army rations | — | Keep |
| Carpenter | wood to planks to fences, furniture, farm buildings | farm decoration, construction | [H Craftsman] | Keep |
| Tailor | cotton and wool to cloth to clothes | **earnable skins** (cosmetics also sold for gems) | — | Keep |
| Courier | deliver parcels between hub NPCs and players' farm mailboxes | first transport job; becomes Trucker | [H Pizza Boy] | Keep |
| Bartender | brew drinks from crops; serve at the tavern | buffs (energy, luck) | [H] | Keep |
| Boxer | arena minigame (timing and stamina), weekly ladder | fame, prizes | [H] | Keep |
| Hunter | track and hunt wild animals in the Wilds region with a rifle from the Arms Dealer; hunting seasons and bag limits; a Game Warden NPC fines poachers | meat to diner, hide to Tailor (leather), trophies as decoration | — | **Redesigned** |
| Lamplighter | at dusk, light oil street lamps on the public map before they go dark; lamps burn out each night. **Night lowers every player's vision radius; lit lamps restore vision around them**, so unlit streets are dangerous (crime, getting lost). Paid per lamp lit; streaks pay bonuses. From the 1950s, the Electrician's grid replaces oil lamps on powered streets | night visibility for everyone, safer streets for police | — | **Redesigned** |
| Chimney Sweep | stoves, smelters and bakeries build up soot with use; above 50% soot, output drops (−1% per 2% soot) and fire risk rises (Firefighter events). Sweeps clean buildings with a brush minigame for a fee | factories, Firefighter | — | **Redesigned** |
| Telegraph Operator | before the 1950s telephone era, players away from the hub can only trade through a telegraph office. The operator relays remote Market orders and contract offers for a fee per message; faster with level | Market, contracts | — | **Redesigned**: later becomes Telephone Operator, then obsolete as eras advance (era flavour) |
| Ice Cutter | in winter, cut ice blocks from frozen ponds and store them in an ice house. **Before refrigeration (1950s), crops and fish spoil** after a few days unless kept on ice | Fisherman, Chef, Butcher; replaced by Fridge (Electronics) later | — | **Redesigned** (needs seasons and spoilage) |

### 1920s: Industrial
| Job | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Trucker | pick up cargo at A, drive to B; pay by distance and weight | moves goods between farms, factories, shops | [H] | Keep |
| Mechanic | repair and refuel players' vehicles; tune engines | every vehicle owner | [H] | Keep |
| Taxi Driver | drive player or NPC fares between districts | — | [H] | Keep |
| Factory Worker | run assembly stations (sorting and timing minigame) | all factory output | — | Keep |
| Train Driver / Conductor | run scheduled trains; sell tickets | passengers, freight | — | Keep (J9) |
| Police Officer | patrol, respond to crimes, arrest wanted players | jail, lawyers | [H LSPD] | Keep if J3 is a or b |
| Detective | locate wanted players, solve NPC mystery cases | police | [H] | **Modify**: in Horizon it finds any player, which can feel like stalking. Here it finds only wanted players and NPC cases. |
| Lawyer | cut jail time, get bail reduced | jailed players | [H] | Keep if J3 is a or b |
| Bootlegger | 1920s prohibition: brew and run liquor past police checkpoints | Bartender, black market | — | Keep |
| Journalist | publish to the in-game newspaper board; paid by reads | events, server news | [H San News] | Keep |
| Food Delivery | carry orders from diners to players and NPCs | diners | [H Pizza Boy] | Keep (merges with Courier progression) |
| Shopkeeper | run a player-owned shop (J10) | everything | [H businesses] | Keep |

### 1950s: Post-war boom
| Job | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Construction Worker | build structures on hub lots and farms from blueprints and materials | businesses, farm buildings | — | Keep |
| Electrician | wire buildings to the power grid; repair outages | factories, electronics | — | Keep |
| Gas Station Owner | business: buy fuel wholesale, sell to drivers | vehicles | [H businesses] | Keep |
| Car Dealer | business: sell factory-made vehicles | vehicles | [H dealerships] | Keep |
| Chef (Diner) | cook dishes from crops and animal products | buffs, food delivery | — | Keep |
| Firefighter | PvE fire events on farms and in the city | safety | [H FDSA] | Keep |
| Paramedic | revive players knocked out in crime, events and the boxing arena; ambulance driving (J7 b) | crime, boxing, events | [H] | Keep (J3 a makes knockouts common) |
| Soldier | army faction (J8) | demand for factory goods | [H factions] | Keep if J8 a |
| Bodyguard | escort players who take **high-risk contracts** (valuable cargo, cash runs, heist crews). Taking such a contract makes the carrier attackable by criminals for its duration, so they hire bodyguards; paid per escort, bonus if the cargo arrives | Trucker, heists, gangs | [H] | **Redesigned**: works within J4, because only opted-in players are attackable |
| Security Guard | guard player businesses and NPC banks during heists | heists | — | Keep |
| Milkman | daily milk and egg rounds to NPC houses and player subscribers; route optimisation pays more; bottles returned and reused | Rancher, Dairy | — | **Redesigned** |
| Cinema Operator | run film screenings at the town cinema: load reels in order, keep the projector running (timing minigame). Players who watch get a mood buff (+energy regen) | Electrician, social | — | **Redesigned** |

### 1980s: Electronics
| Job | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Electronics Technician | assemble radios, TVs, consoles from copper, gold, circuits | electronics store, arcade | — | Keep |
| Arcade Owner | business: install arcade cabinets (playable minigames) | fun, coin sink | — | Keep |
| Pilot | cargo and passenger flights between far districts | logistics | — | Keep, **late**: needs an airport map |
| Carjacker | steal NPC cars and wanted players' cars, strip them at a chop shop or resell; lockpicking minigame; triggers a wanted level | black market, Mechanic (parts), Police | [H] | Keep (J3 a). Law-abiding players' cars are protected by J4 |
| Arms Dealer | craft guns from materials packages, sell to players; level 1–5 unlocks weapons [H] | Hunter, gangs, Army, Police | [H] | Keep (J3 a) |
| Drug Dealer | grow illegal plants in hidden farm plots, process them at a lab, sell to NPC buyers in hot zones; quality and heat levels; raids by police | gangs, Police, Detective | [H] | Keep (J3 a) |
| Drug Smuggler | move packages across the map in vehicles past police checkpoints | Drug Dealer, Police | [H] | Keep (J3 a) |
| Banker | run a player bank: take deposits, lend **only from deposits** (no coin creation), set interest rates; defaulted loans seize collateral (vehicles, business shares). Bank robberies are heists | economy, heists, Security Guard | — | **Redesigned**: money can't be minted |
| Stock Trader / Market Maker | keep buy and sell orders on both sides of the Market; earns a fee rebate per filled order and level perks (lower fees, more open orders) | Market liquidity | — | **Redesigned** |

### 2000s: Internet
| Job | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Office Worker | quick puzzle tasks (sort, match, type) at office desks; salary per shift | first "white collar" income | — | Keep |
| IT Technician | fix computers and servers for businesses (repair minigame) | offices, data centres | — | Keep |
| Programmer | build software: puzzle-style "code" minigame produces app licenses that sell to NPCs | offices, the 2020s | — | Keep |
| Real Estate Agent | broker hub and City lots between players for a commission | businesses | — | Keep (land chunks on farms are not tradeable) |
| Content Creator | stream your farm: visitors and likes pay out | social, visits (Phase 2) | — | Keep |
| Phone Repair | fix phones (electronics minigame) | electronics store | — | Keep (merges into Electronics Technician level 3+) |
| Call Centre Agent | answer NPC calls and route them to the right department or player business (fast sorting puzzle); also dispatches Police, Firefighter and Paramedic calls to on-duty players | emergency jobs, businesses | — | **Redesigned** |

### 2020s to 2026: Modern
| Job | Core loop | Feeds into | Source | Status |
|---|---|---|---|---|
| Ride-share Driver | Taxi upgrade with app dispatch | — | [H Taxi] | Keep (Taxi Driver's top level) |
| Drone Operator | crop-spraying drones on farms; drone delivery | farming boost, delivery | — | Keep |
| Solar / EV Technician | install solar on farms, run EV chargers | power, vehicles | — | Keep |
| Data Centre Operator | run server racks with power and cooling; sells compute to Programmers and AI | late-game sink | — | Keep |
| AI Engineer | train models: compute plus data become "AI services" sold to offices and factories (automation boost) | factories (J6 boost) | — | Keep, end-game |
| E-commerce Seller | run an online store, an Auction House [S] for unique items, with listing fees | unique items | [S AH] | Keep |
| Crypto Miner | mine an in-game token ("AgniCoin", fixed total supply, halving every 30 days) with chips and power; tradeable on the Market for coins. **Never real money or real crypto** | Chip Fab, Power, Data Centre | — | **Redesigned**: capped supply so it can't inflate coins |

---

## Part C: Industries (production chains)

Each building is placed on a farm or a hub lot, takes inputs and produces outputs. Automation follows J6.

| Era | Building | In | Out |
|---|---|---|---|
| 1900s | Mill | wheat | flour |
| 1900s | Bakery | flour, eggs, milk | bread, pie |
| 1900s | Dairy | milk | butter, cheese |
| 1900s | Sawmill | wood | planks |
| 1900s | Smelter | ore, coal | ingots |
| 1900s | Textile Mill | cotton, wool | cloth |
| 1920s | Fuel Depot | oil (new resource in the City quarry) | fuel |
| 1920s | Vehicle Factory | ingots, planks, rubber | carts, trucks, then cars |
| 1920s | Railway Station | — | freight and passenger routes |
| 1950s | Power Plant (coal) | coal | power |
| 1950s | Cannery | crops, metal sheets | canned food, army rations |
| 1980s | Electronics Factory | copper, gold, plastic | circuits, radios, TVs |
| 2000s | Office Tower | power, computers | salaries, software |
| 2020s | Solar Farm | (none) | power |
| 2020s | Chip Fab | silicon, power, gold | chips |
| 2020s | Data Centre | chips, power | compute |
| — | Army Base | rations, uniforms, vehicles | contracts (coin payout), ranks |

Why the chains matter: every era consumes the eras before it. A 2026 data centre still needs chips, which need gold from a 1900s miner. That keeps early-era players' goods in demand on the Market.

---

## Part D: Suggested era batches (Phase 3 ships in these)

1. **3.1 Agrarian:** skills, Rancher (cattle management), Vet, Butcher, Horse Trainer, Game Warden, hostile wildlife, Blacksmith, Miller & Baker, Carpenter, Tailor, Courier, Bartender, Boxer, Hunter, Lamplighter (night vision), Chimney Sweep, Ice Cutter (seasons, spoilage); Mill, Bakery, Dairy, Sawmill, Smelter, Textile Mill; era progression (J1).
2. **3.2 Industrial:** driving physics (J7 b), the City district, Trucker, Mechanic, Taxi, Factory Worker, trains (J9), businesses (J10), Food Delivery, Journalist, Telegraph Operator, Milkman; crime (J3 a): Drug Dealer, Drug Smuggler, Arms Dealer, gangs and families; Police, Detective, Lawyer, jail, Bodyguard, Paramedic.
3. **3.3 Post-war:** construction, the power grid, gas stations, car dealers, the diner, firefighters, the army (J8), security.
4. **3.4 Electronics:** electronics chain, arcade, Carjacker, Banker, Stock Trader, Cinema Operator, pilot and airport.
5. **3.5 Internet:** offices, IT, programming, real estate, content creators, Call Centre.
6. **3.6 Modern:** drones, solar and EV, data centres, AI, e-commerce and the Auction House, Crypto Miner.

## New systems the redesigned jobs need
- **Livestock simulation and hostile wildlife** (Rancher, Vet, Butcher, Horse Trainer, Hunter, Game Warden): Phase 3.1, built on Phase 1's animal module.
- **Night vision radius** (Lamplighter): ships in Phase 3.1. Phase 1 already draws night darkness.
- **Seasons and spoilage** (Ice Cutter, Milkman): Phase 3.1.
- **Soot** on production buildings (Chimney Sweep): Phase 3.1.
- **High-risk contracts** that make the carrier attackable (Bodyguard): Phase 3.2, with crime.
- **Combat and knockouts** (Paramedic, crime): Phase 3.2.
