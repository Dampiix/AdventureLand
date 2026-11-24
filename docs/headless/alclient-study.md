# ALClient study – what earthiverse's headless client tells us

Status: **study, 2026-11-24.** Read-only analysis, nothing built. Companion to [PLAN.md](PLAN.md).

## Sources and conventions

| Short name | What | Version read |
|---|---|---|
| `ALClient/` | earthiverse/ALClient, local clone (shallow, 1 commit) | `e41aeb5`, 2026-11-09, `package.json` version 0.26.15 (npm latest is also 0.26.15, modified 2026-11-05) |
| `bots/` | earthiverse/adventure-land-bots (uses ALClient) | local clone, read only for reconnect / hop / command patterns |
| `amdb/` | kaansoral/adventureland_mongodb (game server + web API) | local clone, used to confirm protocol behaviour |
| `common_functions.js` | official client library (same scratch folder) | used for `push_deferred` |

File references are `file:line`. `ALClient/source/` is shortened to `src/`. Everything not marked **unverified** was read in the source.

ALClient in one sentence: a TypeScript class library (`Game` = web API + G + character factory, `Observer` = socket + world state, `Character` → `PingCompensatedCharacter` → class subclasses = actions) that talks the game's socket.io protocol directly. It is **not** a CODE-compatible runtime; the README says so and points to caracAL for that (`README.md:5`).

---

## 1. Login and connection

### Web login and character list
| Step | ALClient | Reference |
|---|---|---|
| Login | `POST /api/signup_or_login {email, password, only_login:true}` → `{user, auth}` stored in static `Game.user` | `src/Game.ts:244-270` |
| Re-use an auth string | `credentials.json` may hold `userID` + `userAuth`; then no password login happens. If the auth is rejected, it deletes them and logs in with email/password, then writes the new auth back into the file | `src/Game.ts:272-312` |
| Auth on API calls | cookie header `auth=<user>-<auth>` | `src/Game.ts:48-50` |
| Servers + characters | `POST /api/servers_and_characters` → `infs[0].servers` (per region/name, incl. `address`, `path`) and `infs[0].characters` (incl. `online`, `server`, `secret`) | `src/Game.ts:501-523`, server `amdb/api.js:573-594` |
| G data | `GET /comm` → `VERSION`, then `GET /data.js`, regex `var G = {...};`, optional cache file `G_<version>.json`, optional `optimizeG` (strips images, sprites, tilesets, positions, docs; recomputes geometry bounds) | `src/Game.ts:86-117, 220-232, 330-395` |
| Other web APIs | `pull_merchants`, `pull_mail`, `read_mail`, `delete_mail`, `logout_everywhere`, `disconnect_character` | `src/Game.ts:63-242, 314-321` |

This confirms PLAN §1 "Login and connection" points 1–2 and decision E3: **user + auth alone is enough** to start characters; email/password is only needed to mint a new auth. earthiverse's public bot service even takes only `user`, `auth` and the character id from the player (`bots/source/earthiverse.html:13-35`).

`Game.user` is static (`src/Game.ts:30`), so the `Game` helpers are **one account per process**. `Character` itself takes `userID/userAuth` in its constructor (`src/Character.ts:223-228`), so a second account is possible by constructing characters by hand.

### Socket and handshake
- One socket.io v4 socket **per character**, `transports:["websocket"]`, `reconnection:false` for characters, query `{no_graphics:"1"}` (+ `secret` for observers) (`src/Observer.ts:89-101`, `src/Character.ts:637`).
- ALClient does **not** send `entity_delta=1` or `map_protocol=1` (no occurrence in `src/` except `send_updates`). It works on the live servers today with full entity packets.
- Sequence (`src/Character.ts:805-866`): server `welcome` → client `loaded {success:1,width:1920,height:1080,scale:2}` → client `auth {user, character:<id>, auth, width, height, scale, no_html:"1", passphrase:""}` → resolve on `start`, reject on `game_error` or `disconnect_reason`, timeout 10 s (`src/Constants.ts:8`).
- On `start`: `parseCharacter(start)`, `parseEntities(start.entities)`, `S = start.s_info`, `ready = true`, start the 25 ms update loop (`src/Character.ts:655-668`).
- No `code_slot` is sent, so the server loads no CODE (server `amdb/node/server.js:11724-11741`).

### What the server does with `auth` (confirms / refines PLAN)
| Check | Result for the client | Reference |
|---|---|---|
| login already running for this character, or character in `dc_players` | `game_log` "authorization in progress" (**not** `game_error`) | `amdb/node/server.js:11611-11616` |
| character's DB entry has `server` set | `game_error` "authentication failed" with `reason:"ingame"` | `server.js:11656, 11676-11690` |
| wrong auth, banned, wrong owner | same `game_error`, reasons `password_issue`, `banned`, `no_character` | `server.js:11645-11652` |
| server full | `game_error` capacity | `server.js:11620-11623` |
| encouragement (Welcome Back) bookkeeping fails | `game_error` "characters unconfirmed" | `server.js:11910-11914` |
| after login: `is_player_allowed` false (e.g. a second merchant of the account on that server) | `disconnect_reason "limits"` + disconnect | `server.js:11951-11953`, `server_functions.js:363-389` |
| `no_html` set | `afk:"code"`, `controller` = `no_html` if that is an online character name | `server.js:11801-11808` |

ALClient only listens to `start` / `game_error` / `disconnect_reason` during connect, so the "authorization in progress" case ends in its 10 s timeout, not in a clear error.

### Platform / DRM (authfail)
ALClient sends no `epl` / `ticket`, so the server takes the `else` branch: `platform="web"` and `auth_id = player.pid` if the character/owner has a `pid` (`server.js:11869-11899`). With `mode.drm_check`, accounts created after 2019-02-01 without `auth_id` get `s.authfail` for 900 000 s (`server.js:11743-11746, 11901-11907`). ALClient neither sends anything else nor checks for `authfail`; it relies on the account having a `pid`. This is exactly PLAN §1.7. For a Steam-created account the `pid` is the Steam id, so it should pass — **unverified for our account until M1** (check `character.s.authfail`).

### Sockets per IP ("loose" sockets)
Every socket that is not (yet) a logged-in player counts as loose. More than 5 loose sockets from one IP → the server disconnects all the *other* loose sockets of that IP (`server.js:4912-4934, 4961-4963`). A character socket is loose from connect until `auth` completes. ALClient has no guard for this: starting 4 characters at once plus an open Steam character list plus an observer can cross the limit. → Start characters one after another.

---

## 2. Reconnect, disconnect reasons, ingame, server change

- **No reconnect inside ALClient.** On `disconnect` or `disconnect_reason` a `Character` sets `ready=false, noReconnect=true` (`src/Character.ts:639-647`); `connect()` then throws, you must create a new object (`src/Character.ts:116, 632-635`). `disconnect()` clears all timers and listeners (`src/Character.ts:871-883`).
- **Reconnect lives in the bots repo** (`bots/source/strategy_pattern/context.ts`):
  - on `disconnect` → `reconnect()` creates a fresh class instance with the same user/auth/characterID (`context.ts:159-231, 350-412`);
  - retry delay by error text (`context.ts:233-241`): `wait_N_second` → N s + 2 s; `limits` → 40 s (`Constants.RECONNECT_TIMEOUT_MS`); **`ingame` → 500 ms**; `nouser` → give up; else 10 s.
  - the `ingame` fast retry means: after a disconnect the server clears `character.server` shortly afterwards, and they simply retry until it is clear. PLAN §2.4 plans "wait ~6 s"; retrying on `ingame` is the more robust version of the same idea.
- **Server change / hop** = `changeServer(region, id)`: disconnect the old bot, create a new one for the new server, same retry rules, guard against superseded attempts (`context.ts:243-329`). There is no special server-side hop call. `bots/source/base/serverhop.ts:12-58` only picks the next server (round robin or by clock).
- **`disconnect_character` web API** (`src/Game.ts:75-84`; server `amdb/api.js:991-1002`): the server runs `player.socket.disconnect()` for an online character of your account; `character_not_in_game` counts as success. Useful for our watchdog to kick a hung session (also one in the Steam client) before re-login.
- **Disconnect reasons seen in the server**: `limitdc` (call budget, `server.js:5024-5043`), `limits` (`server.js:11952`), "Too many loose connections ..." (`server.js:4928`), "Failed to check in. Your network might be too slow." (`server.js:16165`), broadcast reasons from admin/shutdown (`server.js:13207`). ALClient treats them all the same (stop, no reconnect).
- Server-side hop rules (hop sickness, realm fatigue) are applied at login by `serverhop_logic` / `realmfatigue_logic` (`server.js:11941-11942`); ALClient does nothing about them.

---

## 3. Observer

`Observer` (`src/Observer.ts`) is the base class of `Character`: it owns the socket and all world state (entities, players, projectiles, S, ping). Used alone it is a **socket without login**:

- `Game.startObserver(region, id)` – no secret; the server parks the observer at the fixed `observer_map` position (`src/Game.ts:472-480`, server `server.js:5062-5071`).
- `Game.startCharacterObserver(name)` – with the online character's `secret` from `servers_and_characters`; `welcome` then carries that character and the server keeps the observer within 200 px of it (`src/Game.ts:482-495`; server `server.js:5072-5095, 16053-16063`).
- After `loaded` the server registers the observer and sends all entities in vision (`send_all_xy`) and then the normal `entities`/`hit`/`action`/`death`/`disappear`/`server_info`/`game_event` stream (`server.js:5111-5137`). It does **not** get the private `player` updates of the watched character (only the public player entity).
- Observer call budget is a quarter of a player's (`server.js:4983-4989`), and it is a loose socket (§1).
- Two observer-only commands exist on the server: `o:home` (jump back to the watched character) and **`o:command`** → the server emits `code_eval` to the watched character's socket (`server.js:5138-5157`). The official client's observer UI sends `o:command` (`amdb/js/functions.js:2367`). earthiverse's runner listens to `code_eval` and treats "stop"/"disconnect" as a shutdown command (`bots/source/public/runner.ts:123-155`). → **This gives us a free control channel from the Steam client (observer) into our headless characters.**

**What it is used for:** mainly **database tracking**. When Mongo is connected, the observer stream writes special monsters (`entities`), respawn estimates (`respawns`), NPC positions, other players' positions/gear/stands (`players`), server `S` snapshots (`servers`), instance kills (`instances`), throttled to once per 5 s per key (`src/Observer.ts:131-186, 204-248, 299-435, 474-555, 572-812, 864-894`; `src/Constants.ts:51`). earthiverse runs observers on every server to feed his public data site (the `aldata` field in `players` hints at ALData, `database/players/players.schema.ts`). For us that part is irrelevant.

---

## 4. State tracking

### What is kept, and from which event
| State | Container | Updated by | Reference |
|---|---|---|---|
| own character | fields on the `Character` object (~100 typed fields) | `start`, `player`, own entry in `entities.players` (spliced out), `new_map`, own `hit` damage, `eval` (`ui_move` after dash) | `src/Character.ts:103-219, 282-354, 432-456, 549-559, 655-668, 696-707, 741-743, 491-498` |
| monsters | `entities: Map<id, Entity>` | `entities` (`type:"all"` clears both maps first), `death`, `disappear`, `hit` (hp), far-away cleanup (> 800 px) every 1 s | `src/Observer.ts:120-127, 250-279, 557-652, 981-1005` |
| other players + NPCs | `players: Map<id, Player>` | same as monsters | `src/Observer.ts:654-751` |
| projectiles | `projectiles: Map<pid, ActionData>` | `action` (ETA recomputed from distance/projectile speed), removed on `hit` or after 10 s | `src/Observer.ts:103-118, 250-279, 1002-1004` |
| chests | `chests: Map<id, ChestData>` | `drop` add, `chest_opened` delete (not cleared on map change) | `src/Character.ts:674-680` |
| party | `partyData` | `party_update`; member x/y/etc. patched from `entities` | `src/Character.ts:433-443, 710-739` |
| S (server info / events) | `S` | `welcome.S`, `start.s_info`, `server_info`, `game_event` (adds a live monster), boss death removes it | `src/Observer.ts:204-248, 299-440, 478`, `src/Character.ts:663` |
| bank | `user` (getter `bank`) | the `user` field of `player` data while in a bank map; packs padded to 42 | `src/Character.ts:109-111, 302-331` |
| inventory / slots / gold / s / q / c | character fields | `player` (+ `q_data` for upgrade/compound timers, `upgrade` event clears `q`) | `src/Character.ts:333, 561-564, 749-751, 799-803` |
| cooldowns | `nextSkill: Map<skill, Date>` | `eval "skill_timeout(...)"`, `eval "pot_timeout(...)"`, `skill_timeout` event, `game_response` `cooldown` / `skill_success`; shared cooldowns via `G.skills[x].share` | `src/Character.ts:458-547, 566-569, 794-797` |
| friends, achievements, merrit, tracker | fields | `friend`, `achievement_progress`, `merrit_status`, `tracker` | `src/Character.ts:649-653, 670-672, 745-747, 771-791` |
| `game_response` with `hitchhikers` | parsed out of `player` data | `src/Character.ts:287-295` |

### Position extrapolation
Every 25 ms (`UPDATE_POSITIONS_EVERY_MS`) the update loop moves all moving objects toward `going_x/going_y` with `speed`, counts down `s/q/c[*].ms`, and drops expired ones (`src/Character.ts:230-280, 571-623`; `src/Observer.ts:899-1008`). If no `entities type:"all"` arrived for 60 s it asks for one with `send_updates` (`src/Character.ts:253-257, 922-941`; costs 12 calls, `server.js:249-252`). `PingCompensatedCharacter` additionally advances every newly received object by `ping` ms (`src/PingCompensatedCharacter.ts:33-183`). Note: it moves `x/y` itself; there is no `real_x/real_y` and no `from_x/move_num` interpolation like the official client.

### Not handled (you attach your own `socket.on`)
`cm`, `invite`, `request`, `magiport` (offer), `pm`/`chat_log`/`partym` (only used inside `say`/`sendPM`), `correction` (server position fix, `server.js:11289`), `code_eval`, `notthere`, `disappearing_text` (only inside `equip`), `ui` (only inside some actions), `light`, `map_info`, `map_chunk` (generated maps), `limitdcreport`, `ccreport`, `game_chat`, `tavern`. Full list of server events: compare `src/definitions/adventureland-server.ts` (`ServerToClientEvents`) with the `emit(...)` calls in `amdb/node/server.js`.

### Gaps / quirks found while reading
- `Character.bank` defaults to `{gold:0}` (`src/Character.ts:214`), so the "wait up to 5 s for bank data" loop in `depositItem` never waits (`src/Character.ts:2735-2740`).
- `say()` detects "too fast" by the string "You can't chat this fast." on `game_error` (`src/Character.ts:5050-5056`), but the server answers `fail_response("chat_slowdown")` (`server.js:5182-5187`), so it just times out.
- `move()` adds `distance/speed` (seconds) to `ping` (ms) for its first check (`src/Character.ts:4543-4544`); it works because it re-checks until done, but it polls more than needed.
- No generated-map support: without `map_protocol=1` the server throws `client_update_required` when entering a generated floor and refuses the party start at the keeper (`amdb/node/logic/generated_maps.js:186, 470-478`). **ALClient cannot do the Cave of Many Dreams.** For headless sockets (`no_graphics=1`) the server would also send a precomputed navigation grid `floor.amap` with each floor (`generated_maps.js:192-205`).

### What a renderer needs and whether it is there
| Need | Available in ALClient state? |
|---|---|
| map walls | `G.geometry[map].x_lines / y_lines` (kept by `optimizeG`) – yes |
| NPCs, doors, spawns, zones | `G.maps[map].npcs/doors/spawns/monsters` – yes |
| monsters with position, target, hp/max_hp, conditions | `entities` (+ G monster fields copied onto each `Entity`, `src/Entity.ts:139-158`) – yes |
| players with class, gear, stand, party | `players` – yes |
| own character incl. inventory | character object – yes |
| projectiles / hits for animation | `projectiles` + raw `hit` – yes |
| chests | `chests` – yes |
| tiles / sprites (pretty map) | stripped by `optimizeG`; available in full G + image files on adventure.land – not used by ALClient |
| chat | not stored; listen to `chat_log`, `pm`, `partym`, `cm` yourself |

So a simple vector renderer (walls + dots + labels) can be built from exactly this state. earthiverse does not render anything himself; his service tells users to watch at `/comm` (`bots/source/earthiverse.ts:1397`). A separate earthiverse renderer project may exist – **unverified, not in the clones**.

---

## 5. Actions

### Pattern
Each action is a method that (1) checks `ready` and some local preconditions, (2) attaches temporary listeners, (3) `socket.emit`s, (4) resolves/rejects on the matching event or a timeout, then removes the listeners. The generic helper `getResponsePromise(place, response, {extraGameResponseCheck, timeoutMs})` matches `game_response` by its `place` field, rejects on `failed` (with readable reasons for `cooldown`, `no_mp`, `too_far`, `disabled`) and on `disappear` with the same `place` (target gone) (`src/Character.ts:4043-4114`). Default timeout is **1000 ms** (`src/Constants.ts:15`).

This is the same idea as the official client's `push_deferred(name)` / `resolve_deferred(name, data)` queue keyed by place (`common_functions.js:463-502`), but without a FIFO per place: two parallel calls of the same action can resolve on the same response. The server echoes a `request_id` only for a few newer handlers (`interaction`/knock, `exchange`, `bank`, `sbuy`, `secondhands`, `lostandfound`, `mail_take_item`, `donate`, `bet`, `tavern`, `friend`, `duel`, some skill paths; grep of `request_id` in `server.js`); ALClient uses it only for `knock` (`src/Character.ts:4344-4379`).

### Coverage (examples)
| Area | Methods | Wire event | Reference |
|---|---|---|---|
| move | `move(x,y,{resolveOnStart,...})` – clamps the target with `Pathfinder.getSafeWalkTo`, waits for arrival; rejects if the server-side `going_x/y` differs | `move {x,y,going_x,going_y,m}` | `src/Character.ts:4514-4630` |
| smart move | `smartMove(dest, {getWithin, stopIfTrue, useBlink, avoidTownWarps, numAttempts, resolveOnFinalMoveStart, costs})` – dest can be map, monster, NPC, item (seller), bank pack, position | move/transport/town/enter/leave | `src/Character.ts:5244-5726` |
| attack / skills | `basicAttack`, class methods (`Warrior.agitate/charge/cleave/dash...`, `Mage.blink`, `Priest`, `Ranger`, `Rogue`, `Paladin`, `Merchant.mluck/fish/mine...`) | `attack`, `skill {name,id,...}` | `src/Character.ts:1113-1119`, `src/Warrior.ts:9-60`, `src/Merchant.ts` |
| usability | `canUse(skill)` (cooldown, MP incl. `mp_reduction`, level, weapon type, offhand, consumables, safe maps), `isOnCooldown`, `getCooldown`, `isDisabled` | – | `src/Character.ts:2406-2515, 4238-4252, 6572-6692` |
| items | `buy`, `sell`, `equip`, `equipBatch`, `unequip`, `swapItems`, `splitItem`, `destroy`, `usePotion`, `regenHP/MP`, `openChest`, `sendItem`, `sendGold` | `buy`, `sell`, `equip`, `equip_batch`, ... | `src/Character.ts:1130-1154, 3062-3126, 4641-4674, 4748-4828, 5098-5170` |
| upgrade / compound / exchange / craft / dismantle | `upgrade` (waits for start via `player.q.upgrade`, then for `upgrade_success/fail` in hitchhikers), `compound`, `exchange`, `craft`, `dismantle`, `calculateUpgrade/Compound` (server chance query) | `upgrade`, `compound`, `exchange`, `craft`, `dismantle` | `src/Character.ts:6171-6268, 2549-2656, 3127-3196, 2657-2706, 2864-2893, 1449-1600` |
| bank | `depositGold/Item`, `withdrawGold/Item`, `swapBankItems` | `bank {operation,...}` | `src/Character.ts:2707-2855, 6407-6473, 5858-5901` |
| trade / Ponty | `Merchant.listForSale/listForPurchase`, `openMerchantStand/close`, `buyFromMerchant`, `sellToMerchant`, `getPontyItems`, `buyFromPonty`, `getLostAndFoundItems`, `Game.getMerchants` (pull_merchants) | `merchant`, `trade_buy`, `trade_sell`, `trade_wishlist`, `secondhands`, `sbuy`, `lostandfound` | `src/Merchant.ts:102-302`, `src/Character.ts:1270-1400, 3640-3693, 3962-4014, 4675-4705` |
| chat / messages | `say`, `sendPM` (resolves only after 5 s), `sendCM` (fire and forget), `sendMail` | `say`, `cm`, `mail` | `src/Character.ts:4987-5069` |
| party | `sendPartyInvite`, `sendPartyRequest`, `acceptPartyInvite/Request`, `kickPartyMember`, `leaveParty` | `party {event,...}` | `src/Character.ts:1036-1110, 4389-4473, 5173-5204` |
| maps | `transport`, `enter`, `leaveMap`, `warpToTown`, `respawn`, `acceptMagiport`, `join` (events) | `transport`, `enter`, `leave`, `town`, `respawn`, `magiport`, `join` | `src/Character.ts:6005-6070, 2982-3061, 4429-4467, 6329-6398, 4829-4857, 1010-1035, 4272-4283` |
| misc | `getMonsterHuntQuest`, `finishMonsterHuntQuest`, `getTrackerData`, `getServerPlayers`, `getTradeHistory`, `knock`, `donateGold` | | `src/Character.ts:3205-3255, 3694-3756, 3945-3961, 4132-4178, 4308-4388, 2894-2921` |

Missing compared to our bot (grep of the emits): `change_target` (no `target` emit), anything like `get_progression`, `set_message`, `game_log`.

### Ping compensation
`ping_trig {id}` → `ping_ack {id}`; every 1 s until 6 samples, then every 30 s; `ping` = minimum of the last 50 samples; saved per server across reconnects (`src/PingCompensatedCharacter.ts:185-206`, `src/Observer.ts:50-68, 189-194, 285-297, 1010-1043`). Used to shift cooldown end times earlier by `ping` (`src/PingCompensatedCharacter.ts:29-31`) and to advance positions/timers of received data (§4). `timeout` getter = `min(2*ping, 1000)`.

### Call-rate limits
ALClient has **no client-side call budget**. Server rules (`server.js:4966-5050`, `server_functions.js:5421-5490`):
- window 4 s, limit **200** for players, **50** for observers/loose sockets (`limits.calls`, `server.js:261-263`);
- every call costs 1 plus a per-method extra (`CC`, `server.js:247-260`: `move` +1.5, `send_updates` +12, `players` +12, `secondhands` +16, `friend` +24, `tracker` +50, `equip` +3, `unequip` +6, `auth` +2, `ccreport` +3);
- `cm` cost grows with message size (1/2/3/10/20 per recipient for >100/>1000/>10000/>50000 chars, ×0.8 if several recipients) (`server.js:4991-5011`);
- an exception inside a handler adds 16;
- over the limit: `limitdcreport` + `disconnect_reason "limitdc"` + disconnect.
- `ccreport` (client → server) returns `{calls, climit, total}` (`server.js:5520-5522`) – a cheap way to monitor our own budget.
- New find: the server skips entity updates for a socket whose send queue exceeds 256 KB and resyncs later (`xy_backlog_limit`, `server.js:243`). Relevant on a slow Pi uplink.

---

## 6. Pathfinding

- ALClient's `Pathfinder` is a thin wrapper around **`alpathfinder` 0.6.0, "A Rust/WASM Pathfinder for Adventure.Land"** (`src/Pathfinder.ts:1-2, 116-145`; `bun.lock:276`; npm metadata). The Rust source is **not** in the clones; its algorithm (grid size, A* vs Dijkstra) is **unverified**.
- `prepare(G)` builds all maps reachable from `main` through doors (`door[4]`) and the transporter (`G.npcs.transporter.places`), plus `abtesting`, `goobrawl`, `jail`; options remove maps and add hand-made "cheat" paths over small walls (`src/Pathfinder.ts:165-298`).
- Graph edges and costs (seconds): door / enter / leave 0.812 (the 812 ms `penalty_cd`), transport 3.2, town 3.812 (3 s channel + penalty), walking `distance/speed` (`src/Pathfinder.ts:14-18, 66-109`). `avoidTownWarps` makes town infinite; `avoidMaps` excludes maps.
- Queries: `getPath` (synchronous), `canWalkPath` (line check), `canStand`, `getSafeWalkTo` (furthest reachable point on a line), `findClosestWalkable`, `locateMonster` / `locateNPC` / `locateCraftNPC` / `locateExchangeNPC` from G (`src/Pathfinder.ts:23-64, 116-163, 300-473`).
- Executor (`smartMove`, `src/Character.ts:5479-5718`) is the valuable part for us:
  1. if we stand in a wall, step to the closest walkable spot or warp to town (`:5286-5291`);
  2. shortcut: skip ahead to the furthest later node on the same map that `canWalkPath` reaches (`:5520-5532`);
  3. `getWithin`: try a straight line to a point at that radius of the goal (`:5505-5518`);
  4. optional blink to the furthest node, rounded to 10 px (`:5534-5591`);
  5. town warp: start the warp **and** walk toward the spawn meanwhile, in case the channel is interrupted (`:5636-5696`);
  6. on any error: re-request player data, re-plan, up to `numAttempts` (default 3) (`:5700-5718`);
  7. `stopIfTrue` callback checked every 1 s; a newer `smartMove` cancels the older one (`:5458-5496`).
- Performance: no numbers in the repo; the tests only check correctness (`src/Pathfinder.test.ts`). **Unverified.**
- Licence of `alpathfinder`: npm metadata has **no licence field and no repository link** (checked with `npm view alpathfinder@0.6.0`). Treat as "all rights reserved" until clarified. PLAN already decided against it (own plain-JS pathfinder) – this confirms that decision.

---

## 7. Persistence (Mongo)

- Optional: only if `credentials.json` contains `mongo` or `Database.connect(uri)` is called (`src/Game.ts:244-246`, `src/database/Database.ts:20-50`). Without it every DB branch is skipped.
- Collections (mongoose schemas in `src/database/*/*.schema.ts`): `players` (name, server, map, x/y, slots incl. trade slots, items for own chars, party, owner, rip, s), `entities` (special monsters: type, hp, map, x/y, target, first/last seen), `respawns` (estimated respawn per server/type), `servers` (full `S` snapshot), `npcs` (position per server), `instances` (instance kills, first/last entered), `banks` (whole bank per owner), `deaths` (cause, place, time), `achievements` (tracker snapshots).
- Writers: `Observer` (world tracking, §3), `Character` (own character, bank, party members, deaths, tracker; `src/Character.ts:306-323, 355-429, 520-532, 713-738, 753-792`), `Game.getMerchants` (merchant stands, `src/Game.ts:160-215`). Throttle: LRU of 1000 keys, 5 s per key (`src/database/Database.ts:21`, `src/Constants.ts:51`).
- **Nothing for shared state between our own characters** (no heartbeats, locks, plans, timers). The bots repo shares state simply as in-memory module variables in one process (e.g. `bots/source/strategy_pattern/lock.ts:3-28`), and uses Mongo for cross-process/cross-server knowledge (boss positions, respawns, who is where).

---

## 8. Multi-character

- Intended model: **one Node process, many `Character` objects**, each with its own socket; `Game.G` and the WASM pathfinder are static singletons shared by all (`src/Game.ts:35`, `src/Pathfinder.ts:8-11`). earthiverse runs his whole team plus other players' characters this way (`bots/source/earthiverse.ts:91-92`, `bots/source/public/runner.ts`); his public service spawns **one child process per request** (up to 4 characters each) for isolation (`bots/source/public/server.ts:38`).
- CPU/memory: no measurements or notes in either repo (**unverified**). Things that cost:
  - each character runs a 25 ms timer loop (40 Hz) that walks all its entities, players and projectiles (`src/Character.ts:230-280`);
  - every `Entity` copies all fields of its `G.monsters[type]` onto itself (`src/Entity.ts:146-148`);
  - each character keeps its own copy of the world it sees (no shared world model between characters on the same map);
  - many small listeners are added/removed per action.
  For 4 characters this is small; the PLAN estimate (150–300 MB) stays plausible.

---

## 9. What ALClient does not do that our browser bot relies on

| Our bot uses | ALClient | Gap / effort for us |
|---|---|---|
| CODE API names (`use_skill`, `smart_move`, `get_nearest_monster`, `is_in_range`, ...) | different names and shapes (`basicAttack`, `smartMove`, `getEntity`, class methods); explicitly not compatible (`README.md:5, 277-298`) | **large** if we used ALClient: every call site in `bot/` would change. With our own runtime (PLAN E1 b) we keep the names. |
| `character` object (fields, `real_x/real_y`, `character.on("cm")`) | fields exist on `Character`; no `real_x/real_y`, no event emitter API on the character | medium: a proxy/adapter object |
| `parent.entities` (monsters + players + NPCs in one object) | split into `entities` and `players` Maps | small: merged view |
| `parent.socket.on/off/emit` | `bot.socket` is the raw socket | none |
| `parent.next_skill`, `is_on_cooldown`, `reduce_cooldown` | `nextSkill` Map of Date, `isOnCooldown`, ping-shifted | small |
| `parent.is_disabled`, `can_move`, `distance` | `isDisabled`, `Pathfinder.canWalkPath` (WASM), `Tools.distance` (hitbox-aware like the game) | small (our own `can_move` port needed anyway) |
| `parent.chests` | `chests` Map | small |
| `smart` (`moving`, `use_town`, `map/x/y`), `smart_move` | `smartMoving`, `smartMove(dest, options)` | medium: our executor + `smart` shim |
| `get` / `set` (shared localStorage) | none | medium: our supervisor store (sync, persisted) – nothing to copy |
| `require_code`, CODE slots | none (no `code_slot` sent) | small with our loader |
| `game_log`, `set_message`, `add_log`, `add_chat` | console only | small: log sink to the web app |
| `send_cm` + `character.on("cm")` | `sendCM` exists, receiving is manual `socket.on("cm")` | small |
| `on_party_invite`, `handle_command`, `on_destroy` | none; attach `invite`/`request`/`code_eval` listeners | small |
| `change_target` / `get_targeted_monster` | no `target` emit; `getTargetEntity()` reads `character.target` | small |
| `get_progression`, `calculate_item_value`, `item_grade` | `calculateItemCost`, `calculateItemGrade`; no progression | small–medium (port from `common_functions.js` / `runner_functions.js`) |
| `parent.server_region/identifier`, `parent.X.characters`, `start_character` | `serverData.region/name`, `Game.characters`, `Game.startCharacter` | small |
| `fetch("/api/pull_merchants")` | `Game.getMerchants()` | small |
| DOM: watchdog, iframe hop, `stop_character_runner` | n/a; reconnect/hop in the bots repo's `Strategist` | medium: supervisor |
| Cave of Many Dreams (generated maps) | not supported (no `map_protocol`, no `map_chunk`) | medium–large: chunk assembly + per-floor geometry + nav grid |
| entity deltas | not used | small–medium (PLAN E7) |

---

## 10. Licence

| Piece | Licence | Meaning for us |
|---|---|---|
| ALClient | `"license": "MIT"` in `package.json` (also on npm). **No LICENSE file in the repo root** (only `package.json` declares it). | We may depend on it, copy code or ideas, with the MIT notice (author "Kent Rasmussen"). |
| adventure-land-bots | MIT, `LICENSE` file, © 2020 Kent Rasmussen | same |
| alpathfinder (WASM) | no licence declared on npm, no repository link | don't copy or bundle; using it via npm is legally unclear – and PLAN already excludes it |
| game server `amdb` | "AdventureLandOnlyUse" (PLAN §1) | read for protocol behaviour only |

So: **ideas and small code pieces from ALClient are fine** (with attribution in the file). Depending on the whole package would pull in mongoose, axios, lru-cache and the WASM pathfinder (`package.json` dependencies) and force its API on the bot.

---

## What this means for our client

### Confirmed in PLAN.md
- Login via `signup_or_login`, then `user-auth` cookie; auth string can be stored and reused (E3: copying the auth cookie is enough).
- Handshake welcome → loaded → auth → start, socket.io v4 websocket-only, `no_graphics=1`.
- Observer via `secret`; it does not kick the character.
- Loose-socket limit 5, call limit 200 / 4 s (observer 50).
- "ingame" protects running characters.
- Full entity packets work today (E7: start without deltas is safe – ALClient has never used deltas).
- Own pathfinder: the WASM pathfinder has no declared licence; the decision stands.

### Corrections / additions to PLAN.md
1. "Authorization in progress" comes as **`game_log`**, "ingame" as **`game_error`** with `reason`. Our connect must listen to all three channels (`game_log`, `game_error`, `disconnect_reason`) and map them to clear results.
2. New failure modes to handle: `characters_unconfirmed` (encouragement), `disconnect_reason "limits"` right after start (e.g. second merchant on a server), capacity.
3. Hop: instead of a fixed 6 s wait, **retry on `ingame` every ~0.5–1 s with a cap** (earthiverse's proven approach).
4. `/api/disconnect_character` exists and works for our own characters → watchdog option to kick a hung session before re-login.
5. **`o:command` → `code_eval`**: the Steam client in observer mode can send text commands to our headless characters. Cheap remote control for M4/M5 before the web app exists.
6. `ccreport` gives the server's view of our call budget; log it in M0/M2.
7. Generated maps (Cave of Many Dreams) need `map_protocol=1` and `map_chunk` assembly; headless sockets get a navigation grid (`amap`) per floor. Add to the M5+ backlog; ALClient is no help there.
8. Start characters **sequentially** (loose sockets).
9. Server queue limit 256 KB per socket – watch bandwidth on the Pi.

### Recommendations
- **Don't depend on ALClient** (API incompatible with `bot/`, heavy dependencies, WASM pathfinder without licence, no reconnect, no deltas, no generated maps). Keep PLAN's "own client" decision.
- **Borrow these ideas** (MIT, with attribution where code is close):
  - connect promise with start/fail/timeout and cleanup (`src/Character.ts:827-866`);
  - `getResponsePromise` matching by `place` + `disappear` + timeout (`src/Character.ts:4043-4114`) – but keep a FIFO per place like `push_deferred`, and use `request_id` where the server echoes it;
  - cooldown parsing from `eval` strings and `skill_timeout` + shared cooldowns (`src/Character.ts:458-547, 566-569`);
  - ping loop and min-of-N ping (`src/PingCompensatedCharacter.ts:185-206`);
  - smartMove executor logic: shortcutting, getWithin line, town warp with parallel walk, re-plan on error, cancel on new move (`src/Character.ts:5479-5718`);
  - map-graph edge costs from `penalty_cd` (`src/Pathfinder.ts:14-18`);
  - Strategist reconnect/hop state machine with superseded-attempt guard (`bots/.../context.ts:183-412`).
- **Do better than ALClient** where it matters for us: listen to `correction`, `cm`, `invite`, `code_eval`; FIFO deferreds; an explicit call budget; `real_x/real_y` + `from_x/move_num` like the official client; a single world model per map shared by characters on the same server (optional).
- **Web view**: our process already has all state per character (§4 table), so the web app reads from it – no extra sockets. Use observer sockets only to watch characters that run elsewhere (Steam). A vector renderer from `G.geometry` + entities + projectiles + chests is enough for v1; tiles later.
- **Shared storage**: nothing to take from ALClient. Keep PLAN's synchronous in-process store persisted to disk (one process).

### Open questions
1. Does our Viz account (Steam-created) have a `pid`, i.e. no `authfail` when logging in as platform "web"? → M1.
2. How long after a disconnect does the server keep `character.server` set (how many `ingame` retries for a hop)? → measure in M1.
3. Does `o:command` from the Steam observer reach a headless character reliably, and is `code_eval` sent as a plain string? (ALClient types it as string; earthiverse lowercases it.) → test in M2.
4. Do two parallel calls of the same action (e.g. two `use` potions) get two `game_response`s in order, so a FIFO per place is safe? → test in M2.
5. `alpathfinder` licence and algorithm – only relevant if we ever want to compare; not planned.
6. Exact semantics of `call_modifier` (`server.js:4982`) and whether `skill` calls are cheaper than other calls – read `add_call_cost` callers if the budget gets tight.
