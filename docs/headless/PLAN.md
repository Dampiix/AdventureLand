# Headless client – plan (draft for discussion)

Status: **draft, 2026-11-21. Nothing is built yet.** The decisions marked *open* below are to be agreed with the player first.

Goal: run our existing bot (`bot/`, team Viz on EU IV) without the Steam client, 24/7 on a Raspberry Pi or a small rented server, with a web app to watch it, control it and see statistics.

Already decided (2026-11-21):
- Our own client in Node.js. No ALClient.
- Our own pathfinding in plain JavaScript. No ALPathfinder (Rust/WASM).
- No hidden browser (too heavy for a small server).

---

## 1. Verified facts (sources read on 2026-11-21)

### Sources
| What | Where | Note |
|---|---|---|
| Game server, web API, MCP API (current) | GitHub `kaansoral/adventureland_mongodb`, public, last push 2026-11-04 | `node/server.js`, `api.js`, `mcp_api.js`, `adventure_functions.js`. License "AdventureLandOnlyUse": use and modification allowed, no selling, attribution. |
| Game server (old) | GitHub `kaansoral/adventureland`, last push 2026-03-01 | Out of date: has no `entity_delta` (added 2026-10-02). Don't use it as the protocol reference. |
| Live game client | `https://adventure.land/js/game.js`, `functions.js`, `runner_functions.js`, `common_functions.js`, `data.js` (all `?v=18285`) | Public. This is the reference for the client side. socket.io client 4.8.3. |
| ALClient, adventure-land-bots | earthiverse repos | Only to see how they use the protocol. |

### Login and connection
1. **Web login**: `POST https://adventure.land/api/signup_or_login` with `{ email, password, only_login: true }`. It returns `{ user, auth }` and sets the cookie `auth=<user>-<auth>`. Each login adds a new auth string to the account (up to 200, then the list is cleared). Logging in from Node does **not** log the Steam client out.
2. **Servers and characters**: `POST /api/servers_and_characters` with that cookie. It returns the servers (address, port/path) and the characters. Characters that are online also come with `server` and `secret`.
3. **Socket**: socket.io v4, websocket transport only, `wss://<server address>`. The query string selects the protocol features:
   - `entity_delta=1`: entities as deltas (see 4).
   - `map_protocol=1`: needed only to see generated maps (the cave).
   - `no_graphics=1`.
   - `secret=<character secret>`: observer mode, see 5.
4. **Handshake**: server `welcome` → client `loaded` `{success:1, width, height, scale}` → client `auth` `{ user, character: <character id>, auth, code_slot?, width, height, scale, no_html, no_graphics, passphrase }` → server `start` (the full character, `entities` with `type:"all"`, optionally the CODE of `code_slot`).
   After that the server sends `entities` (`type:"xy"`), `player`, `new_map`, `disappear`, `death`, `hit`, `action`, `game_response`, `cm` and 75 event types in total (see `game.js`).
5. **Observer mode**: if the query contains the `secret` of a character that is online, the `welcome` already holds that character, and the socket receives all entities around it. **The running bot is not kicked.** This is exactly how the official client watches characters.
6. **Entity deltas** (since 2026-10-02): with `entity_delta=1` the server sends only changed fields, `{"id":..,"~":[removed keys], changed...}`. The client rebuilds the full packet (`decode_entities` in `game.js`, ~30 lines) and sends `send_updates` when a base is missing. The server says this saves about 75 % of the entity bytes. Without the flag the server keeps sending full packets.
7. **Platform / DRM** (`auth` handler): a login without a Steam ticket gets platform "web". Accounts created after 2019 need an `auth_id`. On "web" that comes from the account's `pid` (the Steam id for Steam accounts). Without it the character gets the `authfail` condition. **Check this in the prototype**: `character.s.authfail` must be missing.

### Server limits that matter for us
- **Loose sockets**: at most **5** sockets per IP that are not logged in (observers, client screens). One more and the server disconnects **all** loose sockets from that IP, which can include the Steam client on its character list. Keep observers to 1–2.
- **Call limit**: 200 calls per 4 s per socket (a quarter of that for observers). Over the limit: `limitdc` disconnect.
- **Characters**: 3 fighters + 1 merchant online per account. Logging in a character that is already online fails ("ingame" or "authorization in progress"). That is our guard against kicking a running character, but we still check `servers_and_characters` before every login.
- **24/7 rule** (memory, 2026-11-15): accounts that run 24/7 without any player interaction get temp-banned. The player has to stay active, about weekly. Headless does not change that.
- **Hop sickness**: characters from level 60 get a debuff for server hops in the last 4 h. This matters later for the merchant's Ponty round.
- **Realm fatigue**: a fighter gets a condition if another fighter of the account was on a different server in the last 30 min. Merchants are exempt.

### What our bot uses from the game (inventory of `bot/`, ~15k lines)
- **CODE functions**: `use_skill` (51 calls), `get_player`, `is_moving`, `is_in_range`, `get_nearest_monster`, `smart_move`, `xmove`, `move`, `stop`, `buy`, `sell`, `equip`, `unequip`, `upgrade`, `compound`, `exchange`, `exchange_buy`, `dismantle`, `auto_craft`, `bank_store`, `bank_retrieve`, `send_item`, `send_gold`, `send_cm`, `loot`, `interact`, `respawn`, `change_target`, `get_targeted_monster`, `get_party`, `send_party_invite`, `accept_party_invite`, `leave_party`, `trade`, `trade_buy`, `trade_sell`, `buy_secondhand`, `get_secondhands`, `open_stand`, `close_stand`, `get_progression`, `item_grade`, `calculate_item_value`, `calculate_item_properties`, `can_move_to`, `is_on_cooldown`, `reduce_cooldown`, `damage_multiplier`, `game_log`, `set_message`, `say`, `start_character`, `get`, `set`, `require_code`, `sleep`.
- **Globals**: `character` (with `.on("cm")`), `G`, `smart` (`moving`, `use_town`, `map`, `x`, `y`), `code_settings`, `handle_command`, `on_party_invite`, `on_destroy`.
- **`parent.*` (browser internals)**: `entities` (48 uses), `socket.on/off/emit` (`hit`, `death`, `action`; `unequip`, `trade_wishlist`), `server_region`/`server_identifier`, `chests`, `next_skill`, `is_disabled`, `can_move`, `distance`, `X.characters`, `fetch("/api/pull_merchants")`, `add_log`/`add_chat`, plus DOM access for the watchdog and the merchant hop (`$`, `document`, `stop_character_runner`, `#iframelist`).
- **Shared storage `get`/`set`**: heartbeats, journal, hop requests, trade logs, cavalry timers, value report. In the browser this is the `localStorage` all windows share. It is synchronous.
- The bot never writes into `G`, so one frozen copy of G can be shared by all characters.

### Official `smart_move` (runner_functions.js)
A breadth-first search on a step grid. Every step calls `can_move` (a line check against `G.geometry`). Doors, the transporter and Town are graph edges, and a final pass smooths the path. In a background window it runs in 500 ms CPU slices. It works, but it is CPU-heavy, which is a real cost on a Pi. Our own A* is worth doing.

### Measured: G data in Node 24 (this PC)
`data.js` is 2.8 MB. Parsing takes 32 ms. It adds +23 MB heap (RSS 37 → 63 MB). 49 maps have geometry, 108 Mpx in total (main 12.9 M, winterland 12.6 M). A 1-px grid for all maps would take 108 MB; with 4-px cells it is ~7 MB, loaded per map on demand.

---

## 2. Architecture

```
                         one Node.js process ("alhost")
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ supervisor: config, credentials, start/stop/restart of characters, hops,     │
 │             watchdog, shared storage (get/set), stats DB, web server         │
 │                                                                              │
 │  ┌──────────── per character ────────────┐   ┌──── shared ─────────────────┐ │
 │  │ connection  socket.io client, login,  │   │ G (frozen), geometry grids, │ │
 │  │             reconnect, call budget    │   │ map graph, pathfinder       │ │
 │  │ world       character, entities,      │   └─────────────────────────────┘ │
 │  │             party, chests, position   │                                   │
 │  │             extrapolation, deltas     │   ┌──── web app ────────────────┐ │
 │  │ actions     emit + wait for           │   │ HTTP + WebSocket/SSE        │ │
 │  │             game_response (promises)  │   │ status, journal, XP/gold/h, │ │
 │  │ runtime     vm context with the CODE  │   │ boss timers, commands       │ │
 │  │             globals → bot/ (unchanged)│   └─────────────────────────────┘ │
 │  └───────────────────────────────────────┘          × 4 characters         │
 └──────────────────────────────────────────────────────────────────────────────┘
        │ wss (socket.io 4)                              │ http (LAN / Tailscale)
   Adventure Land game server EU IV                 player's browser / phone
```

Code location (proposal): new top-level folder `headless/` next to `bot/` (ES modules, Node 24, the only npm dependency is `socket.io-client`). The pathfinder lives in `bot/lib/pathfinder.js`, so it can be deployed as a CODE slot and also be imported in Node.

### 2.1 Client core (`headless/client/`)
- `api.js`: web login (credentials file), `servers_and_characters`, `pull_merchants`, refreshing the auth string.
- `connection.js`: the socket, the handshake (welcome → loaded → auth → start), the ping (`ping_trig`/`ping_ack`), reconnect with backoff, a call budget (stays below 200 calls / 4 s), and a disconnect reason in the log.
- `world.js`: the state per character. It holds `character` (from `start`, `player`, `q_data`, ...), `entities` (players and monsters), `chests`, `party` and map info, and decodes entity deltas.
  Positions are extrapolated like the client does (`from_x/going_x/speed/move_num`, `calculate_vxy`), so `real_x/real_y` stay current between packets.
- `actions.js`: every action is an `emit`. Its promise resolves or rejects on `game_response` (or on the matching event, e.g. `new_map` after `transport`), like the client's `push_deferred`/`resolve_deferred`.

### 2.2 Compatibility layer (`headless/runtime/`) – see decision **E1**
Each character gets a `vm` context with the globals the bot expects (`character`, `G`, `parent`, `smart`, `use_skill`, ..., `get`/`set`, `require_code`). `require_code("bot_xyz")` loads `bot/<file>` through `bot/slots.json`, so there is no deploy step. `get`/`set` go to the supervisor's shared storage: synchronous, one process, persisted to disk. That is the same behaviour as localStorage in the browser.

Browser-only parts of the bot are moved behind a small runtime module: watchdog, merchant hop, `start_character`, `parent.$`/`document`, the log filter and chat commands.
- In the browser it behaves as today.
- Headless, it calls the supervisor (`hop(name, server)`, `restart(name)`).

These are the only planned changes to `bot/`.

### 2.3 Pathfinding (`bot/lib/pathfinder.js`, plain JS, no dependencies)
1. A walkability grid per map from `G.geometry` (x_lines, y_lines, the character's `base` as padding). The cell size is to be decided, about 4 px. The grid is built when the map is first needed, then cached.
2. A* on the grid (8 neighbours), then line shortening with an exact `can_move` check, so the result is identical to the server's collision.
3. Later: a map graph (doors with `door[4..]`, transporter `G.npcs.transporter.places`, Town = spawn 0 of the map, bank shortcut) with Dijkstra over maps. A* runs inside each map.
4. An executor: walk the path with `move` (one segment per call), re-plan on `correction`, a timeout or an aborted move, and offer the same interface as `smart_move` (a promise, `smart.moving`, stop).
5. Tests: offline in Node against `G.geometry` (random start and end points, every path must pass `can_move`), then in the browser as a CODE slot next to the official smart_move.
Step 1 covers one map only, as agreed.

### 2.4 Supervisor and web app
- **Supervisor**: starts the team (VizPri, VizWar, VizRng, VizMerch) and restarts a character that drops out (with backoff, a maximum per hour and a log entry). It does the merchant's server hop: disconnect, wait about 6 s, connect to the new server. It also runs the watchdog that `bot/main.js` runs today, based on the heartbeat. Run as a systemd service with `Restart=always`, so a crash of the whole process is covered too.
- **Stats store**: SQLite via `node:sqlite` (built into Node 24, no npm package). It holds XP/gold per character per minute, kills, drops, journal entries and, later, market prices (from `pull_merchants`, see the deferred price tracking).
- **Web app**: plain HTML/JS with no build step, served by the supervisor, with live updates via WebSocket or SSE. It shows:
  - per character: status line, HP/MP, map/position, level/XP%, gold;
  - the journal;
  - XP/h and gold/h (1 h / 24 h);
  - boss timers;
  - commands: "Phoenix now", "farm target X", "pause/continue", "restart character", "merchant to server Y".
  Commands go through the same paths the chat commands use today (`handle_command`, `events.searchNow`).
- **Watching in the game**: the official client can still observe the headless characters (observer mode), so no rendering of our own is needed.

---

## 3. Milestones

Each milestone ends with something the player can see. Nothing touches the running Viz characters until M4.

| # | Content | Done when | Risk for the running bot |
|---|---|---|---|
| **M0** | Login + **observer** of a running Viz character (e.g. VizPri via `secret`). Prints servers, characters (no secrets), the surroundings (monsters, players) for a few minutes. Measures ping, bytes/s, CPU, RAM. | The console list matches what the client shows. Measurements noted here. | none (observer only, 1 loose socket) |
| **M1** (first agreed) | Log in an **archive character that is not running** (e.g. Dampiix on the old account), see its surroundings, **walk a few steps** with `move` (straight lines checked with `can_move`), log out cleanly. No bot code, no items, no fighting. | Character visibly walks a few steps (the player watches it in the Steam client as an observer). `authfail` is missing. | none (another account, another character) |
| **M2** | World model complete: position extrapolation, entity deltas, party, chests, `game_response` promises. A small **test CODE** in the vm context (`move`, `smart_move` within the map, `get_nearest_monster`, `set_message` into the log). | Test CODE runs on the archive character with no attacks or item actions. | none |
| **M3** | **Pathfinder** v1 (one map) + executor. Offline tests in Node, then compared against the official smart_move in the browser (time, path length). | 1000 random paths per big map without collisions. Faster than smart_move. | none |
| **M4** | **One Viz character** headless with the real bot (see E5: merchant or a fighter). Its browser window is stopped first. Runs 1–2 h next to the others. | Bot works as in the browser (status, journal, trades or fights). | small, the player stops the window by hand |
| **M5** | **Whole team** headless + supervisor (start, restart, watchdog, merchant hop by reconnect). Map graph for the pathfinder (doors, transporter, Town). | A night without the Steam client. Restarts in the journal. | as M4 |
| **M6** | **Web app** v1 (status, journal, XP/gold/h, boss timers, commands). | Player controls the team from the phone. | none |
| **M7** | **Operation** on a Pi or VPS (systemd, logs, updates via git pull), real measurements, then market price tracking. | Runs a week stable. | none |

---

## 4. Resources and hosting

### Estimate (to be measured in M0/M4)
| Item | Estimate |
|---|---|
| Node base + G (measured) | ~65 MB RSS |
| 4 vm contexts with bot code, entities, journal | 4 × 15–40 MB |
| Pathfinding grids (4-px cells, on demand) | 5–15 MB |
| SQLite + web server | 10–30 MB |
| **Total** | **~150–300 MB RAM**, CPU mostly idle (peaks while pathfinding), network probably < 50 kB/s per character (with deltas less) |

So a Pi 4/5 with 2–4 GB or the smallest VPS (2 vCPU, 4 GB) is more than enough. ARM is fine: Node and socket.io have no native parts.

### Prices (searched 2026-11-21, prices move a lot this year)
| Option | Cost | Notes |
|---|---|---|
| Player's own PC (Node, no Steam client) | 0 € | Fine for M0–M5. The PC bluescreen risk stays (the GPU driver is no longer involved, but the PC still has to be on). |
| Raspberry Pi 5 4 GB (DE) | board ~134–140 €, kit with PSU/SD ~155–190 € | Power ~4–6 W ≈ 10–15 €/year. Needs the home internet connection. Prices rose because of memory costs. ([heise Preisvergleich](https://preisvergleich.heise.de/raspberry-pi-5-modell-b-4gb-ram-a3029965.html), [geizhals](https://geizhals.de/raspberry-pi-5-modell-b-a3081796.html)) |
| Hetzner Cloud CX23 / CAX11 (2 vCPU, 4 GB) | ~5.50–6.50 €/month | Two price rises in 2026. Cost-optimized plans were reported as unavailable at times, so check the price page before ordering. ([northflank](https://northflank.com/blog/hetzner-cloud-server-price-increases), [costgoat Nov 2026](https://costgoat.com/pricing/hetzner)) |
| netcup VPS (ARM G12.5, 4 vCPU, 8 GB) | ~10–17 €/month depending on term | More than we need. ([netcup pricing 2026](https://netcupvoucher.com/blog/netcup-pricing-2026)) |
| Official Mainframe | Steam free hours, then Shells | Not our own client, only for comparison. |

Latency: where the EU game servers are hosted is to be measured in M0 (ping from the PC). A server in Germany is likely similar or better than a home connection.

---

## 5. Open decisions (to agree with the player)

- **E1 – How the CODE API is provided** (the biggest decision)
  - (a) **Our own implementation** of every function the bot uses (~60 functions + `character`/`parent`/`smart`). Fully our own, but every detail has to be rebuilt (argument shapes, promise results, the `character` proxy), which means many small differences.
  - (b) **Hybrid**: load the game's own `runner_functions.js` at start from adventure.land (the same file the browser loads; we don't copy it into the repo) in the vm context. We implement only its `parent` side: socket, character, entities, `push_deferred`/`game_response`, about 115 names, many of them UI stubs. Each function can be replaced with our own over time. `smart_move` is the first to go (our pathfinder).
  - *Recommendation: (b).* The bot was written against exactly these functions. The connection, world model, protocol and pathfinding stay entirely our own.
- **E2 – Process model**
  - (a) One process, one vm context per character. Shared G, synchronous shared `get`/`set` as in the browser today, one web server. A hang in one character slows all of them (the same as today in the Steam window).
  - (b) One process per character: isolated, but `get`/`set` would no longer be synchronous.
  - *Recommendation: (a) + systemd restart.*
- **E3 – Login data**
  - Does the Viz account have an email + password (an account created through Steam may not)?
  - Otherwise the player copies the `auth` cookie (`<user>-<auth>`) from the browser into a local file.
  - The file would be `headless/secrets/credentials.json` (gitignored). It holds email+password or user+auth per account, is never logged, and the player fills it in.
  - Caution: `change_password` rotates the Steam login revision, so the password should not be changed just for this without need.
- **E4 – Where the bot code comes from headless**
  - *Recommendation: the local files in `bot/` (repo = source of truth, no deploy).*
  - Alternatively read the CODE slots through the API, like the browser does. The player sometimes edits `bot_config` in the game, so then a `--pull` before the start is needed.
- **E5 – Which character goes first in M4**
  - The merchant (no combat timing, the server hop is the biggest headless gain, but it uses many trade/bank functions).
  - A fighter (e.g. VizRng; combat, party and healing timing).
  - *Recommendation: the merchant.*
- **E6 – Test character for M1/M2**
  - An archive character of the old account (Dampiix, DampiixWar, DampiixPri, Dampiiix): only logging in and walking, no bot.
  - Question: does an archive character online at the same time affect the Viz account in any way (the Welcome Back timer is shared, `encouragement_identity`)? Probably not (another account, no Lone Wolf in party play), but the player decides.
- **E7 – Entity deltas and `map_protocol`**
  - *Recommendation: start with full packets (simpler).* Turn on `entity_delta=1` in M2 once the decoder is tested.
  - Leave `map_protocol=1` (the cave) for later.
- **E8 – Hosting**: PC first (M0–M5), then Pi 5 or Hetzner? Decide after the measurements in M4.
- **E9 – Access to the web app**
  - Only on the home network / via Tailscale or WireGuard (no open port).
  - Or public with a login. *Recommendation: Tailscale (free for private use).*
- **E10 – Pathfinding before or after M4?** With (b) the official smart_move works headless at once. Our pathfinder could then come in parallel or right after M4 and replace it once it is better. *Recommendation: M3 as planned, but M4 does not wait for it.*

---

## 6. Risks
- **Protocol changes**: the game is updated often (deltas since 2026-10). Mitigation: follow `game.js` on the live site, log unknown events, the version check `G.version` / `?v=` on start.
- **Kicking a running character**: only log in characters that `servers_and_characters` shows as offline. The server refuses an online one anyway. Never touch the Viz characters before M4.
- **Too many loose sockets** (>5 per IP) disconnect the player's client too: at most 1–2 observers, and login sockets are short-lived.
- **24/7 rule**: the player has to stay active (weekly). The web app can show a reminder.
- **Differences from the browser** (proxy `character`, promise results, timing): with E1 (b) small, and visible in the journal of M4.
