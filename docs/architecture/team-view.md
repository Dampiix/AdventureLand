# Team view: direct communication between our characters (plan, 2026-11-24)

Status: **step 0 built (v1.237.20-pilot)**, steps 1-5 open. On `modular-pilot` after stages 1-7. Unlike the rebuild stages this **changes behaviour**
(information arrives at once instead of in messages every few seconds), so every step gets a live test, not only
old-vs-new comparisons.

## Why

Today our characters coordinate with 29 message types through the game server (`send_cm`) plus the shared browser
storage. Messages are late (the leader's position is up to 2 s old), cost server calls, can be lost, and some state is
only sent every few minutes (wishes, worn gear). When all characters run in one client (the player logs in the priest,
the leader starts the others in that window) every character can reach the others directly - tested 2026-11-24: each
of the four reads the others' live game object (HP, map, inventory). The headless client will be one process, so the
same holds there.

## What "seeing each other" gives and what it does not

Reachable directly: each character's game object (`character` in its CODE frame: HP, MP, `real_x`/`real_y` - note
`x`/`y` are the little frame's display values 64/30 there, items, slots, s, target, rip, ...).
Not reachable: what our bot decides and plans - farm target, team goal, boss search job, wishes, pickup need, what the
warrior is doing - it lives inside our modules (module scope, not on the window).

## The team view

A small module `team/team-view.js` with one registry per client:
- **browser:** an object on the game page (`top.__botTeam`) - every CODE frame of this client reaches it (the priest's
  `maincode` frame and the `#iframelist` character frames);
- **headless (later):** an object in the process - same interface.

Each bot publishes one entry at start (and again after a reload, replacing the old one):

| Part | What | How |
|---|---|---|
| identity | name, ctype, role (leader / member / merchant / solo), version, published at | values |
| game | the live game object of that character | `character` of its frame (read-only by convention) |
| bot state | farm target, team goal, activity (fighting, travelling, waiting, searching, banking ...), current target, event, manual mode, combat stats, wishes and worn report, pickup need, potion needs, search job, gold multiplier, opener choice ... | getter functions, so a reader always gets the current value |
| actions | the few things another character may ask: accept a pickup / delivery, hand gold, accept a magiport, take a search job | functions running in the owner's frame |
| alive | heartbeat time; a reloaded or closed frame's old entry is dropped | the reader checks before use |

Readers use `teamView.member(name)` / `teamView.members()`; a missing or stale member means "not in this client" and
the flow falls back to today's message for that member. The messages stay as the fallback (a character in its own
window or on another machine), so nothing breaks when the team is split.

Rules: entries are read, never written by others; only listed actions are called; every reader copes with a missing
member; the entry is the contract (no reaching into another module's internals).

## Order (each step: one commit, deploy, reload the team, live check; a step can be rolled back on its own)

| Step | What changes | Message types it replaces (fallback stays) |
|---|---|---|
| 0 | `team-view.js`, every bot publishes its entry; `/team` chat command and a journal line show what each one sees. No reader yet - no behaviour change. | - |
| 1 | Party and team goal: members read the leader's position, farm, goal, target, event, manual flag live; the mage's magiport reads positions and the goal live | `lead` (party, cave) |
| 2 | Team stats and safety reports: the boss check and the team model read each fighter's combat stats and "safe" lists directly | `stats`, `safe`, `died`, `revive_wait` |
| 3 | Merchant: pickups, deliveries, gold, wishes and worn gear, potion needs, drop needs read directly; the fighters' "ready" ping becomes a look at the merchant's entry | `pickup`, `callpickup`, `pos`, `coming`, `served`, `gold`, `wishes`, `ready`, `drops`, `droptimes`, `timesfor`, `values`, `spotgold`, `hunt` |
| 4 | Boss search: jobs, acks, finds, sightings and deaths through the entries (the leader hands out jobs by action) | `searchjob`, `searchack`, `searchdone`, `searchstop`, `scoutdone`, `bosssight`, `bossdeath` |
| 5 | Chests and the cave: opener choice and gold multipliers, the cave vote | `goldm`, `opener`, `cavevote` |

The shared storage (heartbeats, scout plan, Cipher stock, hop requests, Cavalry timer) is already one storage per client
and stays as it is; it moves into the storage module with stage 8.

## Checks per step

- old flow vs new flow in the fake game where the logic is pure (e.g. the leader's goal as a member sees it);
- live: the journal shows which source a decision used (team view or message), and the watched behaviour (members
  following without lag, magiport on exact positions, the merchant's pickups, a boss search) works;
- the fallback: one member started in its own window must still work over messages.

## Not in this plan

The headless client itself (it plugs its process registry into the same interface later); watching - the official
hub (adventure.land/hub) already shows every online character with inventory, equipment and bank and can send
commands, so we build no viewer of our own.
