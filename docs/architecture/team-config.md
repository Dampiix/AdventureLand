# Team config: account, leader, team - and every fighter can start alone (plan, 2026-11-25)

Status: **plan, nothing built.** Player request 2026-11-25. On `modular-pilot`; changes behaviour (who plays solo or in the
party is decided at start and re-checked while running).

## Why

- `config.team.fighters` means "every character that may run the bot" (trusted for messages, served by the merchant, its
  gear protected), but some code reads it as "who plays right now". The merchant's team XP value (`xpTeam`) waits for an
  XP rate of every listed fighter - VizRng (listed, not played) never sends one, so the value-based drop choice has never
  run (found 2026-11-25: the team farmed Giant Scorpions while the Winged Boots feathers were worth more).
- The main account (Dmpx) is still the default team and the played one is an `otherTeams` entry - one account per
  player is allowed, so one is enough.
- Who plays together is derived (`fighters - solo`), the party / solo switch is a config phase, and a member started
  without its leader waits for it forever. Nobody restarts a crashed leader.

## The new config

```js
account: {
    characters: ["VizPri", "VizWar", "VizMage", "VizRng"], // every fighter of the account; a new one is added here
    merchant: "VizMerch",
},
leader: "VizPri",
team: ["VizWar", "VizMage"], // the leader starts these (and the merchant) and takes them into its party
```

Gone: `team` / `otherTeams` (Dmpx), `solo`, `phase` and `phases` (derived only, internally), the multi-account pick in
`deriveTeam` (one account). `config.team.fighters` stays as a derived name for `account.characters`, so the ~50 places
that mean "may run the bot / protect its gear" do not change.

## Roles at start

| Who starts | Mode |
|---|---|
| the leader | **leader**: starts the merchant and every `team` member, invites them (as today) |
| a `team` member, leader online | **member**: follows the leader (as today) |
| a `team` member, leader **not** online | **solo** until the leader is there (below) |
| any other `account` character | **solo** |
| the merchant | merchant (as today; serves whoever plays) |

"Leader online" = its heartbeat (`bot_beat:<leader>`, written every loop, shared storage of the client) is younger than
90 s. The decision is made once in `deriveTeam` at start (the modules read party / solo at creation, as today).

## Switching while running (restart of the own code)

Tested 2026-11-25: `api_call("load_code", { name: "20", run: "1" })` restarts a character's own code (main window and the
hidden character frames), and `top.api_call(...)` from a member restarts the leader's code.

- **A member playing solo** checks every 30 s: the leader's heartbeat is fresh -> restart of the own code -> member.
- **A member in the party** whose leader's heartbeat is older than `leaderLostMs` (2 min):
  1. the leader's page is in this client and alive but its code silent (team view entry stale, `top.character` there)
     -> restart the leader's code (`top.api_call`), at most once per 5 min, journal line;
  2. otherwise (leader gone, or its code does not come back within 2 more min) -> restart of the own code -> solo.
- **The leader** needs nothing new; its watchdog keeps restarting crashed member windows (as today).
- Every restart names slot 20 explicitly (the editor may show a scratch slot), and none happens during an active or found
  boss event (the same rule as for our own reloads).

## "Plays now" vs. "may run"

| Meaning | Source | Places |
|---|---|---|
| may run the bot / trusted / served / gear protected | `account.characters` (+ merchant) | comms trust, merchant deliveries, workshop protection (worn, wishes, goal names, box armor, exchange, better weapons) |
| plays right now | heartbeat < 10 min (`workshop activeTeam()`, a shared helper) | the merchant's team XP value (`xpTeam`), its Ponty-round pickup calls, elixir stock per class |
| in our party | `party.inParty` / `memberNames` (server) | boss checks, team model, chests, formation, magiport, team stats (already so) |

`xpTeam` with a fighter that plays but has no XP rate yet (restart < 10 min) stays unknown, as designed - now with a
journal line ("team XP value unknown: waiting for ...") instead of a silent XP spot.

## Order (each step: tests, commit, deploy, reload, live check)

1. **Quick fix first:** `xpTeam` over the fighters that play now + the journal line. The value pick starts working
   (decides XP spot vs. Big Birds for the Winged Boots feathers).
2. **Config shape:** `account` / `leader` / `team`, Dmpx and `otherTeams` out, `deriveTeam` builds the internal
   `team`, `characters`, `phases` from it (same result for today's setup - checked old vs. new config value by value).
3. **Roles at start:** member without its leader -> solo; other account characters -> solo.
4. **Switching while running:** solo member -> member when the leader comes; member -> leader-code restart or solo when
   the leader is gone.
5. **Docs:** README team section and the team switch table (solo = just start that character), module plan.

Live checks (with the player): start the warrior alone (leader offline) -> solo; start the leader -> the warrior switches
to member; stop the leader's code -> a member restarts it; close the leader's window -> members go solo.
