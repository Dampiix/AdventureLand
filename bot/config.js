// =====================================================================
// bot_config - everything you are expected to tweak lives here. Another team (e.g. new level-1 characters)
// only needs a new `team` block; classes come from character.ctype (all six have skill modules).
// =====================================================================

module.exports = {
    version: "1.237.7-pilot",

    team: {
        // DampiixWar, Dampiix, DampiixPri, Dampiiix are an item archive: never list them (items would go to the merchant).
        leader: "DmpxPriest",
        fighters: ["DmpxPriest", "DmpxWar", "DmpxRanger", "DmpxRogue"],
        // Fighters outside the party: not invited, not started by the leader (at most three fighters online).
        solo: ["DmpxRogue"],
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },
    // Other accounts on this code (util.deriveTeam picks the team that lists the running character); one at a time.
    otherTeams: [
        { name: "viz", leader: "VizPri", fighters: ["VizPri", "VizWar", "VizMage", "VizRng"], solo: ["VizRng"], merchant: "VizMerch", farm: {} },
    ],

    // Market stand (16 slots for both, 24 from merchant level 70, 30 from 80; prices per unit in gold):
    //   buy:  { item, price, want, level? }  - a buy order for what is missing up to "want" (bag + bank); level default +0.
    //   sell: { item, price, keep, level? }  - everything above "keep" is offered (bank copies fetched); wished items never.
    market: {
        buy: [
            // Wanderer's set materials at about 3x the NPC value; they keep the stand open for Merrit's parcels too.
            { item: "beewings",      price:     75, want: 600 },
            { item: "crabclaw",      price:    360, want: 300 },
            { item: "spores",        price:    360, want: 200 },
            { item: "gslime",        price:     60, want: 100 },
            { item: "frogt",         price:     10, want: 10  },
            { item: "seashell",      price:    900, want: 3000 }, // elixirs: 20 of each main-stat elixir need ~2,100
            { item: "essenceoffire", price: 140000, want: 10 }, // = a fire weapon (+ shop weapon, 20k at Leo)
            { item: "ololipop",      price: 150000, want: 4  }, // orange Lolipop Mace (a player pays 300k)
            { item: "glolipop",      price:  80000, want: 4  }, // green one as a stand-in
            { item: "offeringp",     price: 350000, want: 2  }, // Primling
            { item: "crossbow",      price: 400000, want: 1  }, // the ranger's long-term bow
        ],
        sell: [

            // Monster Tokens are not sold: saved for the Monster Hunter sets at Daisy (53 tokens per class).
        ],
        // Selling into players' buy orders on any server: every scanEveryMs (each trip hops out and home) a buy order at
        // minPrice+ for what is above "keep" starts a trip. buyFromPlayers: buy what Ponty would buy from players' stands.
        sellTo: {
            enabled: true,
            scanEveryMs: 20 * 60 * 1000,
            buyFromPlayers: true,
            items: [
                // Vitality earrings: +0 sold while a buyer pays minPrice, else compounded after demandHours (+1 never sold).
                { item: "vitearring", level: 0, minPrice: 500000, keep: 0, demandHours: 3 },
                { item: "vitearring", level: 2, minPrice: 8000000, keep: 2 }, // keep: the priest's two Clover Studs
            ],
        },
        // Buy orders for wished items / gear goals: priceShare of our own expected cost, at most maxShareOfPot of the gear
        // pot and max orders; not for +0 NPC stock, taken down once we hold a copy.
        wishOrders: { enabled: true, priceShare: 1.2, maxShareOfPot: 0.2, minPrice: 1000, max: 8 },
        // Ponty every everyMs: buys wished / gear-goal items better than ours at most at maxShareOfOwn of our own cost and
        // maxShareOfPot of the gear pot (also caps players' stands). reportFinds / buyFinds: other upgrades worth the gold.
        ponty: { enabled: true, everyMs: 20 * 60 * 1000, maxShareOfOwn: 1.2, maxShareOfPot: 0.2, reportFinds: true, buyFinds: true, findMinGain: 0.5 },
    },

    // Dismantle at Leo: spare copies (up to maxLevel) become material - fire weapons Essence of Fire, of-the-Dead weapons
    // Bones (materialGoals). Never: worn, wished, earmarked, locked or titled copies, or copies up to a market.buy "want".
    dismantle: {
        enabled: true,
        // Not listed: the Sword of the Dead (its Short Sword base is rare), Spear and Hand of the Dead (worth more sold).
        names: ["fireblade", "firestaff", "firebow",
            "maceofthedead", "bowofthedead", "daggerofthedead", "staffofthedead"],
        maxLevel: 0, // +1 and higher copies stay (they would only give one essence as well)
    },

    // Material goals (workshop materialGoals): weapons crafted from Essence of Fire or Bones and upgraded one copy at a time.
    //   goals:   material items of a fighter's gearPlan.weapons list that beat the worn weapon; the last list item first.
    //   deliver: "better" - each copy that beats the worn weapon; "goal" - only at the goal level (upTo, else weaponCaps).
    //   budget:  "ladder" - the workshop.bruteForce pot; "goals" - the gear goals' pot. buyCopies: buy bases;
    //   sources + sourceMaxPrice: +0 items bought to dismantle; rareBases: { item: max price }; extra: { item, level, count }.
    materialGoals: {
        enabled: true,
        auto: true,
        reserve: 0,            // material units that always stay in the bank
        maxPerGoal: null,      // null = no limit
        borrowFrom: "goals",   // "ladder" materials may borrow from the idle gear goals' pot
        skip: ["firestars"],
        materials: {
            // Fire weapons go to +8 before the Fiery Gloves and Ember Seals get any essence (workshop.materialHold).
            essenceoffire: { upTo: 8, budget: "ladder", deliver: "better", buyCopies: false, extra: [] },
            mbones: {
                upTo: 7, budget: "goals", deliver: "better", buyCopies: true,
                sources: ["maceofthedead", "staffofthedead", "bowofthedead", "daggerofthedead"], // not the Sword of the Dead: kept, never Bones
                sourceMaxPrice: 300000,
                rareBases: { sword: 150000 }, // Short Sword, the Sword of the Dead's base (no shop sells it)
            },
        },
    },

    // Travel (core/fighter.js): via / leaveVia - to reach or leave the key map, walk through the value map first.
    // rageWalls: rage boxes (+ rageMargin px) and wallMonsters' spawn boxes are walls for path walks (not the goal's own
    // zones); rageWallSteps: margins tried in turn when no path is found (-1 = walls off).
    travel: { via: { spookytown: "halloween" }, leaveVia: { spookytown: "halloween" }, rageWalls: true, rageWallSteps: [100, 50, 0, -1], rageMargin: 100, wallMonsters: ["prat"] },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "party",

    party: {
        followDistance: 80,   // members idle within this distance of the leader
        // Agitate range around the leader; a member within it judges rage zones with the team model, else its own check.
        leash: 300,
        farmRadius: 400,      // members pick free monsters only within this of the leader
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
        // The leader waits for a fighter farther than waitDistance px (at most waitMaxMs per separation, not while attacked).
        waitForTeam: true, waitDistance: 500, waitMaxMs: 45000, waitAgainMs: 60000,
        // Members walk to the route's end themselves; below toHealerBelow HP they walk into the priest's range.
        goToDest: true, toHealerBelow: 0.5,
        // Team goal reached: within goalEdge px of a farm spot's edge point, else within goalRadius px (party.js).
        goalEdge: 250, goalRadius: 200,
        // The highest gold bonus opens chests (fixed: a name); others only if it is away (awayRange px) or after fallbackMs.
        chestOpener: { enabled: true, fixed: null, awayRange: 400, fallbackMs: 10000 },
        // Ranged fighters keep out of the monsters' melee reach (+margin px) while a tank class is near.
        spacing: { enabled: true, minOwnRange: 100, margin: 50, gap: 130, step: 80, everyMs: 700 },
        // Easy targets members pick themselves near the leader; harmlessRatio: hits for at most this share of our max HP.
        spread: { enabled: true, maxHits: 3, maxDamageRatio: 0.05, harmlessRatio: 0.02 },
    },

    // Damage meter: every everyMs the leader (or a solo fighter) logs each member's damage/s over windowMs ("/dps": now).
    meter: { everyMs: 5 * 60 * 1000, windowMs: 5 * 60 * 1000 },

    tickMs: 250,

    // Routes (smart_move).
    movement: {
        useTown: true, // the Town skill (teleport to the map's center) where it shortens a route
        townMinDistance: 600, // ...but only from farther than this from the map's center (the route search counts Town as one step)
    },

    // Member watchdog (main.js): a bot window without a heartbeat for silentMs is restarted - at most one restart per
    // gapMs and maxPerHour. A member stopped on purpose comes back too.
    watchdog: { enabled: true, silentMs: 2 * 60 * 1000, checkEveryMs: 15 * 1000, gapMs: 10 * 60 * 1000, maxPerHour: 3 },

    // Client display only (no effect headless).
    ui: {
        hideGoldLogs: true,   // drop the game's "123 gold" loot lines from the log
        hideKillLogs: true,   // drop the game's "X killed a Bee" lines
    },

    // Events and world bosses (core/events.js). policy: "always" or "never" (default).
    events: {
        enabled: true,
        observe: true,                  // log which events are live and what we do
        policy: {
            snowman: "always",          // holiday season world boss, 1,200 HP
            goobrawl: "always",         // daily goo fight
            phoenix: "always",          // roaming coop boss, weak hits, 180k XP, fire weapons
            mvampire: "always",         // Dracul (cave): 240k HP, magical hits; never taken from another player
            fvampire: "always",         // Ms. Dracul (halloween): 240k HP, 875 magical; the warrior tanks her
            jr: "always",               // Jr. (Spooky Town): orange Lolipop Mace on every kill
            greenjr: "always",          // Green Jr. (Spooky Forest): green Lolipop Mace on every kill
            skeletor: "always",         // Skeletor (arena): 1,800 physical hits, see boss.minHitsNonTankBy
            // Giga Crab (main beach, daily): 16,000 physical hits (one kills priest or ranger); see joinNeeds..noArea below.
            crabxx: "always",
            franky: "never", icegolem: "never",
            horseman: "never", abtesting: "never",
            graveyard: "always",          // Halloween: zombies/ghouls in Spooky Town's graveyard - Bones
        },
        // Join events on a normal map: their monster types, where join() puts us (joined within r px), what the team must
        // handle to go (joinNeeds); "1hp": hit the boss only while a FOREIGN player holds it (foreignOnly).
        joinTypes: { crabxx: ["crabx", "crabxx"] },
        joinSpot: { crabxx: { map: "main", x: -1000, y: 1700, r: 600 } },
        joinNeeds: { crabxx: "crabx" },
        foreignOnly: { crabxx: "1hp" },
        // neverBy never hit it; the others only while the holder is visible, above holderMinHp and within holderMaxDist px.
        // flee: its target runs fleeStep px away every tick (util.foreignOnlyBlocks, fighter.gigaFlee).
        foreignRules: { crabxx: { neverBy: ["priest"], holderMinHp: 0.4, holderMaxDist: 400, flee: true, fleeStep: 250 } },
        noArea: ["crabxx"], // no Taunt, Agitate, Cleave, Stomp, multi-shot or Absorb on these
        // "always" only applies once every fighter has reached this level
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10, graveyard: 40, mvampire: 50, fvampire: 60, jr: 40, greenjr: 40, skeletor: 60 },
        // search: the whole team searches these; engage: fought when met (searched by the scout or the runner).
        search: ["phoenix"],
        engage: ["mvampire", "fvampire", "jr", "greenjr", "skeletor"],
        // splitSearch: spawn areas split between the fighters; holdForTeam: open only with everyone within holdRange px.
        splitSearch: true, splitWaitMs: 4 * 60 * 1000, holdForTeam: false, holdRange: 350,
        searchEveryMs: 20 * 60 * 1000,  // search again this long after a miss or a kill
        // Witch's Cipher (events.js cipherFarm): from leadMs before a round until its gathering ends the team farms the
        // scarcest ingredient at the first safe spot of spots[ingredient] (highest HP first); no report: fallback.
        witchCipher: {
            farm: true, leadMs: 10 * 60 * 1000, fallback: "embercoal",
            spots: {
                embercoal: ["gscorpion", "plantoid"],
                frostscale: ["wolfie", "boar", "arcticbee", "iceroamer"],
                gloomfeather: ["ghost", "osnake", "snake", "minimush"],
                verdantspore: ["spider", "croc", "bee", "goo"],
            },
        },
        // Merchant scout (roles/scout.js): searches `bosses` between chores; the runner steps in while it is unavailable
        // or a boss is overdue by fallbackMs. Finds are reported for reportMs, `watch` bosses until a fighter is within
        // teamNear px. safeWalk: its paths avoid aggressive monsters (pad px) and rage zones (ragePad px).
        scout: {
            enabled: true,
            bosses: ["phoenix", "mvampire", "fvampire", "skeletor", "greenjr"],
            fallbackMs: 10 * 60 * 1000, lapMaxMs: 15 * 60 * 1000, freshMs: 90 * 1000,
            reportMs: 3000, holdMs: 3 * 60 * 1000, arriveRadius: 300, arriveGraceMs: 10 * 1000, watch: [],
            keepAway: 250, teamNear: 300, watchMs: 3 * 60 * 1000, lostMs: 8000, spotMs: 3000, pauseAfterDeathMs: 30 * 60 * 1000,
            mapOrder: ["main", "arena", "cave", "halloween"],
            // hits: only aggressive monsters that kill the merchant in this many hits are walled.
            safeWalk: { enabled: true, pad: 100, ragePad: 100, offMs: 60 * 1000, hits: 2 },
        },
        // Runner (events.runnerCandidate: fastest ranged fighter, never leader or healer): searches `bosses` (interval
        // each) alone; solo: bosses it kills alone. maxMs: the leader gives up on it; killMs: longest solo fight.
        runner: {
            enabled: true,
            bosses: { mvampire: 20 * 60 * 1000, fvampire: 25 * 60 * 1000, jr: 60 * 60 * 1000, greenjr: 60 * 60 * 1000, skeletor: 20 * 60 * 1000 },
            solo: [],
            maxMs: 8 * 60 * 1000,
            killMs: 3 * 60 * 1000,
            // Nonstop mode: farmBosses hunted by the runner alone while the boss check says it can win.
            nonstopKillMs: 15 * 60 * 1000, // longest solo fight
            nonstopMaxMs: 20 * 60 * 1000,  // one lap plus a fight; the leader gives up after this
        },
        // Held for the team; otherwise the finder opens when the solo boss check passes, else waits by the spawn box.
        holdFor: [],
        // A seen kill of a slow boss (respawn > 200 s): searched again at kill + respawn x respawnFactor.
        respawnFactor: 0.72,
        farmBosses: [], // hunted nonstop: searched again after farmBossEveryMs
        farmBossEveryMs: 10 * 1000,
        searchSpotMs: 4000,             // look around this long at each spawn area
        // Boss check (bosses only; the guide never calls them safe): from everyone's stats
        // and the game's damage formula. Other players are not counted on.
        boss: {
            minHits: 6,                 // every fighter must survive this many hits in a row
            minHitsNonTank: 4,          // ...the others only this many while a tank (warrior/paladin) is in the team
            minHitsNonTankBy: { skeletor: 2 }, // per boss instead of minHitsNonTank
            healCover: 1.5,             // damage/s on the tank <= priests' healing/s x this (potions do the rest)
            maxFightMinutes: null,      // kill-time limit for the team alone; null = none
            priestDamageShare: 0.3,     // priests mostly heal: count this share of their damage
            // Solo (no priest): HP/s a fighter keeps up with potions and its own sustain.
            soloSustainHps: 150,
            pauseAfterDeathMs: 3 * 60 * 60 * 1000, // a death there pauses the boss this long
        },
    },

    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: true,
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
        xpTop: 5,                        // only monsters among the team's top xpTop XP spots (0 = every safe hunt)...
        dropHunts: true,                 // ...or that drop something the merchant misses (wish or craft ingredient)
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        teamSpeedup: 2,                  // the team kills ~2x as fast as the leader alone (time check)
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits at least this long at Daisy...
        waitAtDaisyMaxMs: 45000,         // ...and up to this until every member is done there
        finishedRetryMs: 60 * 1000,      // a finished hunt: next Daisy trip after this at the earliest
        daisyRange: 200,                 // how close counts as standing at Daisy
        shareMs: 10000,                  // members report their hunt to the leader this often
    },

    // Items that can't be bought come before XP: the merchant reports what is missing, the guide names the drop route.
    drops: {
        enabled: true,
        maxHoursPerCopy: 100,       // slower drops are not farmed (a sanity cap; wishes compete by value)
        refreshMs: 5 * 60 * 1000,   // leader re-asks the guide this often
        reportMs: 5 * 60 * 1000,    // merchant reports shortages this often
        // Extra stock to collect even without a wish: { name, copies } (bag + bank, any level).
        want: [{ name: "armorbox", copies: 50 }],
        // Drop spots vs the XP spot by value per hour; a switch needs valueSwitch x the current choice's value.
        byValue: true,
        valueSwitch: 1.2,
        // Own loot gold per farm target over windowH hours (after minMinutes, fighters within togetherRange px).
        spotGold: { enabled: true, windowH: 3, minMinutes: 10, togetherRange: 500 },
    },

    targeting: {
        farm: null, // null = the guide picks; a monster or a list (the first one not too strong/crowded) to test or for a drop
        fallback: "goo",          // used when the progression guide has no answer
        // Rare monsters attacked first when in sight within range px; skipped while invulnerable.
        rare: { enabled: true, range: 400, types: ["goldenbat", "cutebee", "tinyp", "wabbit", "pinkgoo", "snowman"] },
        // Guide "careful trial" routes count only once proven (own fights or 15 min of team farming without a death).
        avoidTrial: true,
        // Melee classes never hit monsters returning more than maxDreturn % damage (porcupine 4800); ranged ones farm them.
        melee: { classes: ["warrior", "paladin", "rogue"], maxDreturn: 20 },
        // The farm spot is left only when a member's "unsafe" lasts this long; a death there counts at once.
        objectionGraceMs: 5 * 60 * 1000,
        // Team model: safe when the tank survives tankHits volleys of `pull` monsters (pullAggressive: aggressive ones),
        // healing covers that x healCover and the others survive otherHits hits. "/safety [map]" logs the verdicts.
        teamSafety: {
            enabled: true,
            tankClasses: ["warrior", "paladin"],
            tankHits: 6, otherHits: 3, healCover: 1.5,
            pull: 2, pullAggressive: 3,
            pullPassive: 1,                // aggro and rage below isolation.minAggro/minRage: one at a time
            pullLone: 2,                   // monsters pulled one at a time (isolation): one plus a possible add
            denseArea: 15000,              // aggressive spawns with less area per monster (px²) come as a whole pack
            abilities: [],                 // monster abilities we accept (others: the guide decides)
            fightHpUse: 0.5,               // uncovered damage over the whole fight: at most this share of the tank's max HP
        },
        // Aggro/rage monsters are pulled only with no other free one within radius px of the target or the way there.
        // strongHold / watchMargin: px to stop from too-strong ones / to wait outside the spawn box for a lone one.
        isolation: { enabled: true, minAggro: 0.3, minRage: 0.3, radius: 120, strongHold: 300, watchMargin: 150 },
        // Spot check: the picker stops margin..maxMargin px outside the spawn/rage box, watches watchMs and judges the pack.
        // groupGap: passive kinds chained this close are one pull (groupRule); aggroPack: a whole aggro spawn is one pull.
        spotCheck: { enabled: true, party: true, margin: 150, maxMargin: 150, watchMs: 3000, maxWaitMs: 30000, groupGap: 60, groupRule: false, aggroPack: false },
        // Learned hit factor: from minHits real hits of a kind, its predicted hits are scaled by real / predicted (1..max).
        hitFactor: { enabled: true, minHits: 8, max: 5, keepHits: 400 },
        // Mobbing (more than 3 on one player multiply its hits): guard - no new monster while maxOnOne are on one of us
        // (unless the multiplier stays <= guardMinMult); projectSec - the live check looks this far ahead.
        mobbing: { enabled: true, guard: true, maxOnOne: 3, guardMinMult: 1.25, projectSec: 4, healShare: 0.8 }, // healShare: share of a healer's heal/s counted in the live check
        // Rage zones (map "rage" boxes): the spawn counts as a whole; failing it we stay out and call the Cavalry.
        rage: { enabled: true },
        // From fromLevel a monster is checked again with its real stats before a pull.
        live: {
            fromLevel: 2,
            ownHits: 6,           // members/solo picking their own target: survive this many real hits
            soloHpUse: 0.7,       // solo: HP lost over the whole fight (after own healing) at most this share of max HP
            waitTolerance: 2.5,   // only while the team stats are not in yet: real/level-1 damage ratio cap (level-5 CGoo: 1.9x)
        },
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        // ...or this share of a window without a free target:
        crowdedWindowMs: 3 * 60 * 1000, crowdedIdleShare: 0.7, // idle = not in range of a target (walking counts)
        crowdedForMs: 60 * 60 * 1000,  // then use the guide's next choice for this long,
        // Another player within occupiedRadius px of our spot: skipped for occupiedForMs; free again after occupiedFreeMs alone.
        occupiedBy: 1, occupiedRadius: 300, occupiedAfterMs: 20000, occupiedForMs: 60 * 60 * 1000, occupiedFreeMs: 30 * 1000,
        // Shared, not taken: we stay while we had a target stayIfBusy of the last shareWindowMs.
        stayIfBusy: 0.75, shareWindowMs: 2 * 60 * 1000, shareMinMs: 60 * 1000,
        crowdedMaxMs: 6 * 60 * 60 * 1000, // doubled each time the same spot is crowded again within a day
    },

    // Cavalry (Tracktrix; strong only while our highest level is below 80): emergencies and spots the spot check blocked.
    // reset: also reset grown farm spots; targets: spots nuked whenever it is ready.
    cavalry: { enabled: true, emergencyHpBelow: 0.35, emergencyOnMe: 1, reset: false, resetFromLevel: 5, resetMinCount: 2,
        targets: [], planStayMs: 100 * 1000, planMaxMs: 10 * 60 * 1000,
        foreignClear: 420, planMinCount: 5, resetPackMin: 5 }, // foreignClear: no call with another level-3+ kind this close; *MinCount/PackMin: wait for this many in reach

    combat: {
        // Kiting (fighter.kiteStep): outranging (by margin px) a slower attacker (charge <= maxSpeedRatio x our speed), we
        // circle it at charge + range + extra px. anchorRadius / farmAnchorMargin: stay near the spawn (boss / normal).
        // farmRisk: a kiteable monster still counts with this share of its damage in the farm checks.
        kite: { enabled: true, margin: 30, extra: 50, rangeSlack: 10, slack: 15, maxSpeedRatio: 0.99, anchorRadius: 280, farmAnchor: true, farmAnchorMargin: 250, everyMs: 250, avoidRadius: 120,
            foreignMargin: 50, // kite/escape/spacing points stay this far beyond the reach of other kinds
            farmRisk: 0.25, farmSpeedRatio: 0.9, farmRangeMargin: 50 },
        potionHpBelow: 0.8,      // below this: an HP potion on every cooldown
        potionMpBelow: 0.5,      // below this MP comes before the HP top-up (HP above half)
        mpFirstAboveHp: 0.65,    // MP before the HP top-up only above this HP
        hpWhenFits: true,        // solo: an HP potion whenever a whole one fits, MP in the gaps
        potionWhenMissing: true, // otherwise drink as soon as a whole potion's worth is missing (HP before MP)
        // passThrough: on the way, leave slower attackers of other kinds behind (above minHp, outside spotRadius).
        // withHealer: potion rules near a priest; losing fastLossPerSec of max HP per second switches back to solo rules.
        passThrough: { enabled: true, minHp: 0.5, speedShare: 0.8, spotRadius: 400, leaveAfterMs: 60 * 1000 },
        withHealer: { potionHpBelow: 0.6, potionWhenMissing: false, fastLossPerSec: 0.06 },
        mpTopUp: 0.5,            // MP: drink as soon as this share of an MP potion is missing
        hpCriticalBelow: 0.3,    // below this HP an HP potion always comes first
        // Solo: after a fight below hpBelow HP or mpBelow MP, pull nothing new and drink up to hpUntil / mpUntil first.
        recover: { enabled: true, hpBelow: 0.5, mpBelow: 0.5, hpUntil: 0.8, mpUntil: 0.8, maxMs: 90 * 1000 },
    },

    classes: {
        // Paladin (classes/paladin/): mana-shield, oath, cleansing modules; self-heal and Smash in the class.
        paladin: {
            selfHealBelow: 0.6,
            useSmash: true, mpReserve: 150, // Smash needs a mace
            oathBelow: 0.5,                 // Guardian's Oath on allies below 50% HP (lvl 50+)
            useCleansingLight: true,        // lift poison/curse/burn/... from allies (lvl 30+)
            // Mana Shield: damage drains MP instead of HP while on
            manaShield: { onBelow: 0.35, offAbove: 0.7, minMp: 0.25 },
        },
        // Priest (classes/priest/): each skill module has its own defaults; these are our values. Details: the module headers.
        priest: {
            healBelow: 0.75, selfHealBelow: 0.6,   // heal a member below / ourselves below this HP ratio
            // Party Heal: 2+ members below partyHealBelow, or one below partyHealDanger, or any (also out of sight) below partyHealOne.
            partyHealBelow: 0.65, partyHealDanger: 0.35, partyHealOne: 0.5,
            useCurse: true, mpReserveRatio: 0.4,   // Curse on sturdy targets; Curse and Dark Blessing keep this MP share
            useRevive: true,                       // revive fallen members (consumes an Essence of Life)
            // Absorb Sins as an emergency: a non-tank member below `below` with monsters on it and no tank in Taunt range,
            // while we are above selfAbove.
            absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            // Luck catch: Absorb Sins on an ally whose monster dies within `hits` hits (at most maxPull, we above minHp, once per
            // everyMs per ally); without a tank within tankRange only what our courage holds. Summary every logEveryMs.
            luckCatch: { enabled: true, hits: 2, maxPull: 5, minHp: 0.6, everyMs: 1500, tankRange: 400, logEveryMs: 10 * 60 * 1000 },
            // Luck swap (core/gear.js): these pieces go on with the luck catch and come off backMs after the last one; missing
            // pieces are skipped, a piece listed twice fills both slots (two Clover Studs).
            luckSwap: { enabled: true, items: ["mshield", "rabbitsfoot", "wcap", "wattire", "wbreeches", "wgloves", "wshoes", "cloverstud", "cloverstud"], backMs: 3000 },
            // Dark Blessing (level 70): +25 % party damage for 8 s on targets needing sturdyHits+ of our hits, and on bosses.
            darkBlessing: { enabled: true, sturdyHits: 10 },
        },
        // Rogue (classes/rogue/): swiftness, stealth, fanofknives, strikes modules; Quick Stab/Punch follow the mainhand.
        rogue: {
            mpReserveRatio: 0.25,
            swiftness: true,          // Rogue Swiftness (lvl 40) on us and party members in reach
            smokeBelow: 0.25,         // Assassin's Smoke below this HP share with monsters on us (0 = never) ...
            smokeUntil: 0.6, smokeClear: 200, // ... then hide where no monster is within smokeClear px until this HP share
            mentalBurst: true,        // only once INT reaches the skill's 64
            fanFrom: 3,               // Fan of Knives (lvl 65, Knife Belt) with this many monsters around
            poisonCoat: { enabled: true, minHits: 40 }, // A Poisonous Touch (Poison Sack) on targets needing 40+ hits
        },
        // Ranger (classes/ranger/): three-shot and sturdy-shots modules.
        ranger: {
            sturdyHits: 3,                  // Hunter's Mark / Supershot only on targets needing 3+ hits
            mpReserveRatio: 0.3,
            usePoisonArrow: true,           // consumes a Poison Sack
        },
        // Warrior (classes/warrior/): agitate-*, protect, escape, splash, sword-swap, mobility. Details: the module headers.
        warrior: {
            mpReserveRatio: 0.2,
            // Taunt off an ally below allyHpBelow or hit for hitRatio+ of its max HP; always bosses (max HP >= bossHp) and
            // monsters on our healer. walkFirst: walk within closeBy px first (unless below urgentHpBelow).
            taunt: { enabled: true, first: false, agitateOver: 6, allyHpBelow: 0.8, hitRatio: 0.05, bosses: true, bossHp: 20000, offHealer: true,
                walkFirst: true, closeBy: 25, urgentHpBelow: 0.5 },
            agitateFrom: 3,                 // Agitate (lvl 68) when this many monsters are on allies
            cleaveFrom: 3,                  // Cleave (lvl 52, axe/scythe) with this many monsters around
            stompFrom: 2,                   // Stomp (lvl 52, basher) with this many attackers
            sturdyHits: 4,                  // War Cry (lvl 70) on targets needing this many hits
            hardShell: { enabled: true, factor: 3 }, // lvl 60: when the predicted next physical hits x factor reach our HP
            useCharge: true,                           // +30 speed whenever we walk (on cooldown)
            // Dash (combat, 120 MP): toward the target from `from` px, at most `max` px (server limit 50), one per everyMs.
            dash: { enabled: false, from: 80, max: 49, minMpRatio: 0.5, everyMs: 1000, pauseMs: 10000 },
            // Sword swap: `count` Swords of the Dead for targets dying in maxHits hits (burn never procs on the killing hit);
            // fire blades back holdMs after the last quick target.
            swordSwap: { enabled: true, names: ["swordofthedead"], count: 2, maxHits: 5, holdMs: 60 * 1000 },
            // Agitate pack mode (lvl 68): splash weapons, War Cry + Agitate, hit the target with the most splash neighbours.
            agitate: {
                enabled: true,
                monsters: "auto", deny: [], // "auto": decided per farm target; a list forces these kinds; deny excludes
                maxOnMe: 8, maxHp: 50000, abilities: [], // auto: at most this many at once; no bosses / unknown abilities
                splashOnlyFrom: 3, splashOnlyHoldMs: 8000, // Lolipops without Agitate with this many on us (splash must pay)
                splashPullSlack: 40, // ...if we survive what the splash pulls: chained within splash radius + this (px)
                offAfterMs: 60 * 1000, // a running auto mode goes off on a live "no" only after it held this long
                fearMax: 0, // attackers of one damage type beyond our courage for it (each one more costs 20-40 % attack)
                maxLevel: null, safetyShare: 0.5, // auto: null = no level cap; a pull may cost only this share of the HP the pack check allows
                splashMin: 1.0, learnHits: 40, denseCount: 5, denseSpacing: 130, // auto: lolipops from 1.0 splash per hit (guess from spawn density first)
                deathDenyMs: 2 * 60 * 60 * 1000, // auto: no Agitate on a kind for this long after dying to it
                // Escape (escape.js, from slower monsters): below escapeHp, or when the HP lost over escapeLossSec kills us
                // within escapeTtdSec; until nobody reaches us (range + escapeMargin, >= escapeClear px) and HP >= escapeUntilHp.
                escapeHp: 0.3, escapeUntilHp: 0.6, escapeMaxMs: 45000, escapeClear: 250, escapeMargin: 100, escapeStep: 200, escapeKeepOff: 80, escapeLossSec: 3,
                // Mobbing: escape below escapeMobHp if the live combo kills us within escapeTtdSec; no Agitate within mobStopTtdSec.
                escapeMobHp: 0.7, escapeTtdSec: 8, mobStopTtdSec: 20,
                partyEscape: true, // in a party too (healing counted), staying within the healer's reach where possible
                // Gap step: minOnMe+ on us and the splash misses one in range -> `step` px into the largest angle gap.
                gapStep: { enabled: true, step: 50, everyMs: 4000, minMs: 2500, minOnMe: 3 },
                weapons: "splash",    // "splash": put on the splash weapons; "keep": pull with the usual ones ("/agitate off|swords|splash|chain|splashstream|config" switches the mode at runtime)
                minPack: 3,
                minHp: 0.8,           // start a pull only above this HP share
                abortHp: 0.3,         // below: walk away from the pack
                gather: "center",     // "center": walk into the pack, Agitate there, all arrive together; "step": Agitate, then step away
                centerWithin: 20,     // "center": at the pull point within this distance
                searchRadius: 200, gridStep: 40, // "center": pull points tried around us
                // No other kind within reach + clearMargin px when we Agitate; else move within clearSearch px (none: skip).
                clearMargin: 80, clearSearch: 240,
                // Toward the spot middle: beyond homeSlack px from the spawn middle, Agitate from a point up to homeStep px
                // nearer (gain >= homeMinGain); homePxPerMonster px nearer is worth one free monster more.
                home: true, homeSlack: 100, homeStep: 160, homeMinGain: 40, homeNear: 600, homePxPerMonster: 40,
                avgPerMonster: 60,    // "center": one monster more in reach is worth this much less average way (px)
                sideStep: 50,         // "center": step out of the pack after Agitate (0 = stay)
                adjustStep: 40, adjustEveryMs: 4000, // "center": step when monsters come from behind
                waitShare: 0.7, waitMs: 3000, // first swing once this share of the pulled pack is in range (at most waitMs)
                chaseFrom: 3,         // with this many or fewer left and none in range: walk to the nearest one
                swords: "stream",     // mode "swords": "stream" = Agitate on every cooldown where we stand (normal combat), "pull" = the pull-point version
                streamFrom: 1, streamOnMe: 3, // "stream": Agitate when this many free ones are in reach and fewer than streamOnMe attack us (auto: splashOnMe, so the splash is measured fairly)
                splashOnMe: 5, sugarBonus: 2, agitateEverySec: 6, // "splashstream": at most this many on us; one Agitate per agitateEverySec (mana) ...
                streamLowHp: 0.6, streamStopHp: 0.4, // ... at most 2 below 60% HP, no Agitate below 40%
                streamToClump: true, clumpRadius: 60, clumpStep: 80, // "splashstream": walk to clumps (each neighbour within 60 px is worth 80 px of way)
                partyMode: "auto", // party: stream only, on the leash, allies' Taunt/Agitate first; "auto" = the solo stream
                kiteStep: 120,        // "step" (and backing off): this far
                gatherMs: 2500,
                regroupBelow: 0.5, regroupEveryMs: 8000, // spread out (fewer splash neighbours per hit than this): another step
                keepMs: 60 * 1000,    // splash weapons stay on this long after a pull
            },
        },
        // Mage (classes/mage/): each skill module has its own defaults; these are our values. Details: the module headers.
        mage: {
            // Energize: MP to a member below energizeBelow while we keep energizeAbove; else a speed burst on the strongest
            // fighter (ourselves within burstLeadMs ms of our next attack). energize: false = off.
            energizeAbove: 0.6, energizeBelow: 0.4, burstLeadMs: 250,
            // Reflective Shield on whoever takes the most magical attack (at least reflectMinAttack), keeping reflectKeepMp
            // of our MP. reflect: false = off.
            reflectMinAttack: 100, reflectKeepMp: 0.25,
            useBurst: false, // Mana Burst: empties the whole MP pool
            // Blaster mode: on for a pack (minNeighbours in its blast radius) above minMp, or always when it beats staff + book
            // by singleMargin (singleTarget); back after keepMs without a pack or below offMp. aim: shoot the same kind's best
            // pack. blockMs: staff + book after a held unsafe blast. fearMax: a blast may pull courage + this many.
            blaster: { enabled: true, names: ["gstaff"], minNeighbours: 2, minMp: 0.5, offMp: 0.2, keepMs: 4000, holdMs: 60000,
                singleTarget: true, singleMargin: 0.03, aim: true, blockMs: 6000, fearMax: 0 },
            // Team Magiport at the team goal: pulls fighters farther than minDist px (tank first) while keepMp stays; a boss
            // goal counts once it is in sight within bossRange px for graceMs; tries per member and goal, retryMs apart.
            // events.js reads enabled for the members' consent.
            magiport: { enabled: true, keepMp: 0.3, minDist: 600, bossRange: 800, graceMs: 4000, tries: 3, retryMs: 8000 },
            // Blink on routes: jump to the farthest step on this map at least minDist px away, keeping keepMp of our MP.
            blinkTravel: { enabled: true, minDist: 400, keepMp: 0.4 },
        },
    },

    potions: {
        hp: "auto",       // "auto": small potions until the pool is big enough, then big ones
        mp: "auto",
        bigFrom: { hp: 1500, mp: 1000 }, // max HP / max MP from which hpot1 / mpot1 are used
        target: 300,       // fighters get topped up to this many of each
        requestBelow: 100, // ask the merchant for more below this
        selfBuyBelow: 20,  // walk to town and buy yourself below this (merchant missing)
    },

    // Elixirs, one per class: a fighter carries `carry` and drinks one when none works or its own runs out within
    // drinkBeforeMs. Merchant: buy - NPC elixirs below min (bag + bank) up to max; exchange - Seashells while a stat
    // elixir is below min, until all are at refill (sourceKeep shells stay).
    elixirs: {
        enabled: true,
        byClass: { priest: "elixirluck", mage: "elixirint0", warrior: "elixirstr0", ranger: "elixirdex0", rogue: "elixirdex0", paladin: "elixirstr0" },
        carry: 4,                           // per fighter in the bag: 2 days
        drinkBeforeMs: 10 * 60 * 1000,
        callEveryMs: 5 * 60 * 1000,         // fewer than carry/2 in the bag calls the merchant, at most this long after its last visit
        buy: { elixirluck: { min: 10, max: 30 } },
        exchange: { source: "seashell", min: 6, refill: 20, sourceKeep: 40 },
    },

    // Cave of Many Dreams (core/cave.js, docs/cave-of-many-dreams.md): the player enters at Dorr and walks the leader.
    // mode "manual": the bot fights only the player's target or attackers - no own travel, pulls or area skills (noArea).
    cave: {
        mode: "manual",
        noArea: true,
        neverFight: ["cave_darkmage"], // never attacked, also when it hits us
        // Recorder (storage "bot_cave_rec:<name>"), up to recordMaxChars per state.
        record: true, recordMaxChars: 12000, recordCapLeader: 400, recordCapMember: 150, entsEveryMs: 10000,
    },

    // Fighter side of the item/gold flow
    supply: {
        keep: ["tracker"],               // never handed to the merchant
        keepByClass: { priest: ["essenceoflife"], ranger: ["poison"] }, // skill ingredients
        goldKeep: 10000,                 // emergency fund for potions; the rest goes to the merchant
        goldMinSend: 5000,               // only send gold when the surplus is at least this
        freeSlotsMin: 6,                 // ask for a pickup when fewer slots are free
        pickupEveryMs: 20 * 60 * 1000,   // ask for a routine pickup this often
        firstPickupAfterMs: 60 * 1000,   // first routine pickup this long after the bot starts
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000, // no answer for this long -> buy potions yourself
        // While the merchant is on its way we keep farming and send our position this often, for at most followMs.
        positionEveryMs: 5000,
        followMs: 5 * 60 * 1000,
    },

    // Fighters: equipment wishes from the progression guide + auto-equip
    gear: {
        enabled: true,
        noEquip: ["handofmidas"],   // never equipped automatically, taken off when worn
        minLevel: { mcape: 7, hpants: 7 }, // never put on below this level
        maxWorn: { zapper: 1 },     // at most this many worn at once
        wishEveryMs: 5 * 60 * 1000, // re-read the guide and resend wishes this often
        maxWishes: 12,  // class chains alone are up to 9; a longer list shifts less (the merchant works through it one by one)
        // Class wishes for slots the guide leaves empty: the chains of gearPlan.wishes (only the first step not reached).
        classWishesEnabled: true,
    },

    // =================================================================
    // Gear plan: the ONE place for our gear progression. Class wishes are built from `wishes` (chainsFor, called by
    // core/gear.js) and `equivalent`; scripts/gear-plan-guide.mjs renders the block as docs/gear-guide/gear-plan.pdf.
    // Items: "{stat}" = the class's main stat (str/int/dex). `for`: a class or a group.
    // =================================================================
    gearPlan: {
        version: "2.0",
        updated: "2026-11-22",
        about: "General gear progression rules the bot follows. Derived from the community chart and our own decisions.",
        principles: [
            "Every slot has a ladder: base -> better pieces -> end goal. Each step has a target upgrade level.",
            "Keep upgrading instead of waiting: the worn piece goes up to its cap until the next step is in hand.",
            "The game's progression valuation decides what is better (the bot's equip pass already uses it). The plan only says what to wish for and what stands in.",
            "A missing item is replaced by its stand-in (e.g. green Lolipop Mace for the orange one).",
            "Wish: shop, craft and farmable drops are pursued actively. Found: event and boss items are worn when we have them, never chased.",
            "Item stages: an item goes up level by level across the team - e.g. STR rings +4 are wished only once every STR-ring wish at +3 is fulfilled. Different items never block each other.",
            "A worn alternative pauses the ladder of its slot: while e.g. a Loaded Die is worn, no class orb is built.",
            "Shop weapons stop at +8 and only while no better copy is there (a worn Fiery Blade +7 already beats a Blade +8: 54 + burn vs 50). Above that the fire weapon ladder is the way up.",
            "Wanderer's set: each piece has the stats of the shop piece of its slot plus a little (cap +120 HP, attire +80 MP, breeches +1 speed) and the set bonus (2: +200 HP, 3: +100 MP, 4: +10% gold, 5: +16 luck). Only the chest opener (priest) runs it (2026-11-23): it wishes its pieces actively (2026-11-20); once its Wanderer goals are done, spare copies are sold.",
        ],
        decisions: {
            "2026-11-19": [
                "Elixirs: not for now.",
                "Dagger of the Dead may be crafted from Bones for the rogue; it joins the weapon ladder.",
                "Jewelry (rings, earrings, amulets, belts) to +4 with item stages.",
                "Wanderer's set runs in parallel with the shop armor (drops only, no spare copies kept).",
                "No risk floors and no grace preparation.",
                "The merchant works on wishes by value (gain per gold / per hour).",
                "Winged Boots built to +7 (rare scrolls from +8).",
                "The warrior stays on Fiery Blades (no Swords of the Dead).",
                "Shop weapons run through the stages with the armor: everything to +7 first, then +8.",
            ],
            "2026-11-20": [
                "The fighter with the highest gold bonus opens the party's chests (the opener's gold multiplier counts for the whole chest).",
                "The priest (our opener) wishes Wanderer's Attire, Breeches and Gloves +8 once its shop gear is done - with the cap +10% gold. Bases from Ponty; never a stat loss (delivered only at +8).",
                "Wanderer's Shoes +8 stand in for the Winged Boots on the priest (full set: +16 luck); finished Winged Boots replace them.",
                "Shop gear and armor take the High scroll from +5 -> +6 on.",
                "Stages are team-wide: everyone's shop gear to +7, then everyone to +8.",
                "Weapon wishes and Ponty finds only for the weapon types of the class's plan.",
            ],
            "2026-11-23": [
                "Wanderer's set only for the priest (chest opener, luck catch); spare copies are sold once its goals are done.",
                "Rugged +0 copies nobody wears and nobody wishes are sold (e.g. Rugged Coats after the warrior's Dracul's Attire).",
            ],
        },
        groups: {
            physical: ["warrior", "ranger", "rogue", "paladin"],
            caster: ["mage", "priest"],
            tank: ["warrior", "paladin"],
            nontank: ["ranger", "priest", "rogue", "mage"],
            opener: ["priest"], // the chest opener and luck catcher: the only class on the Wanderer's set
        },
        // Class wish chains for one class ({ name, level } or { steps: [...], replace, anytime, ... }); used by core/gear.js classChains.
        chainsFor: function (ctype, mainStat) {
            const groups = this.groups;
            const inGroup = function (f) {
                if (!f) return true;
                return (Array.isArray(f) ? f : [f]).some(function (x) { return x === ctype || (groups[x] || []).includes(ctype); });
            };
            const res = function (n) { return n.replace('{stat}', mainStat || ''); };
            return this.wishes.filter(function (w) { return inGroup(w.for); }).map(function (w) {
                if (w.single) return { name: res(w.item), level: w.to };
                let steps;
                if (w.steps) steps = w.steps.map(function (s) { return { name: res(s[0]), level: s[1] }; });
                else {
                    steps = [];
                    for (let l = (w.from != null ? w.from : w.to); l <= w.to; l++) steps.push({ name: res(w.item), level: l });
                }
                const e = { steps: steps };
                if (w.replace) e.replace = true;
                if (w.anytime) e.anytime = true;
                const alts = (w.alts || []).filter(function (a) { return inGroup(a.for); }).map(function (a) { return a.item; });
                if (alts.length) e.alts = alts;
                if (w.carry) e.carry = true;
                if (w.count) e.count = w.count;
                if (w.insteadOf) e.insteadOf = w.insteadOf;
                if (w.slots) e.slots = w.slots;
                return e;
            });
        },
        caps: { armor: 8, weapon: 9 }, // for the gear plan PDF only (scripts/gear-plan-guide.mjs); the bot uses workshop.gearGoals
        // Weapon lists, worst to best: the merchant upgrades the last item we hold while a step beats the weaker worn weapon
        // (util.weaponPower), else the one before it. The front shop weapon: gear goals; material weapons: materialGoals.
        weapons: {
            warrior: ["blade", "swordofthedead", "fireblade"],
            priest: ["staff", "firestaff", "staffofthedead"],
            ranger: ["bow", "hbow", "firebow", "crossbow"],
            rogue: ["stinger", "daggerofthedead"],
            // The Blaster is carried (wishes below), not listed; with burn the Fiery Staff beats the Staff of the Dead.
            mage: ["staff", "staffofthedead", "firestaff"],
        },
        // Highest level the list items are upgraded to (per item, else default).
        weaponCaps: { default: 7, fireblade: 8, firestaff: 8, firebow: 8 },
        // Shop armor per slot: gear goals push the worn piece through workshop.gearGoals.stages - no wish needed.
        shop: { helmet: "helmet", chest: "coat", pants: "pants", shoes: "shoes", gloves: "gloves" },
        // A piece that replaces the worn shop piece of its slot at the same level or higher.
        equivalent: { wcap: "helmet", wattire: "coat", wbreeches: "pants", wshoes: "shoes", wgloves: "gloves" },
        // Equivalents run with the armor goals for this group (built to the worn shop piece's level, then replace it).
        parallel: "opener",
        // ...and crafted only when every ingredient is in stock (never a reason to farm; market.buy keeps materials coming).
        craftFromStock: ["wcap", "wattire", "wbreeches", "wgloves", "wshoes"],
        // Wish chains, in wish order. `item` + `to` (and `from`: one step per level from..to) or
        // `steps`: [[item, level], ...]. replace: worn over pieces outside the chain; anytime: not
        // only after the shop gear is done; alts: worn alternatives pause the chain; carry: kept
        // in the bag for a mode (count copies, insteadOf: stand-in for another carried item).
        wishes: [
            { slot: "cape", item: "cape", to: 0, single: true, how: "exchange: 40 Leather" },
            // Tanks take the Winged Boots after their Rugged Shoes +8 (tank shoes chain below).
            { slot: "shoes", item: "wingedboots", to: 7, replace: true, for: "nontank", how: "craft: Shoes + 20 Magical Feathers" },
            { slot: "offhand", steps: [["quiver", 0], ["quiver", 7], ["quiver", 8]], for: "ranger", how: "craft: Armadillo Scale + 200 Bee Wings" },
            { slot: "orb", steps: [["orbg", 0], ["orbg", 1], ["orbof{stat}", 0]], alts: [{ item: "cave_loaded_die", how: "craft: 10 Cave Amber + 8 Seashells + 2 Reef Glass" }], how: "craft (Cole)" },
            // Rings: main-stat rings +2 -> +4, then the crafted seals +2 (12 main stat vs 10). Sucker Punch: ranger only.
            { slot: "ring", item: "{stat}ring", from: 2, to: 4, replace: true, anytime: true, for: ["ranger", "rogue", "mage", "paladin"],
                alts: [{ item: "suckerpunch", for: "ranger", how: "drop: crabs" }] },
            { slot: "ring", steps: [["strring", 2], ["strring", 3], ["strring", 4], ["emberseal", 2]], replace: true, anytime: true, for: "warrior",
                how: "craft: STR ring +2 + ember core + 6 essence of fire" },
            { slot: "ring", steps: [["intring", 2], ["intring", 3], ["intring", 4], ["glacierseal", 2]], replace: true, anytime: true, for: "priest",
                how: "craft: INT ring +2 + frost core + 6 essence of frost" },
            { slot: "earring", item: "{stat}earring", from: 2, to: 4, replace: true, anytime: true, for: ["warrior", "ranger", "rogue", "mage", "paladin"] },
            // Moonshard +2: 12.5 INT + 160 MP (an INT earring +4 has 11).
            { slot: "earring", steps: [["intearring", 2], ["intearring", 3], ["intearring", 4], ["moonshardearring", 2]], replace: true, anytime: true, for: "priest",
                how: "craft: INT earring +2 + 8 void thread + 40 bat wings + 4 essence of ether" },
            { slot: "amulet", item: "{stat}amulet", from: 2, to: 4, replace: true, anytime: true },
            { slot: "belt", item: "{stat}belt", from: 0, to: 4, replace: true, anytime: true, how: "map drop: Spooky Town", for: ["warrior", "priest", "rogue", "mage", "paladin"],
                alts: [{ item: "knifebelt", for: "rogue", how: "craft - gives Fan of Knives" }] },
            // Ranger: DEX belt +4, then the Wind Belt +2 (16 DEX like the belt +4, plus armor and speed).
            { slot: "belt", steps: [["dexbelt", 0], ["dexbelt", 1], ["dexbelt", 2], ["dexbelt", 3], ["dexbelt", 4], ["windbelt", 2]], replace: true, anytime: true, for: "ranger",
                how: "craft: DEX belt +2 + 40 storm feathers + 4 essence of ether" },
            // Tanks: Rugged set from armor boxes, +7 then +8, worn over the shop piece once the shop gear is done.
            { slot: "helmet", steps: [["helmet1", 7], ["helmet1", 8]], replace: true, for: "tank", how: "armor box" },
            { slot: "pants", steps: [["pants1", 7], ["pants1", 8]], replace: true, for: "tank", how: "armor box" },
            // Warrior gloves: Rugged +8, then the Fiery Gloves (+7, then +8 - never more than one level below).
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "warrior",
                how: "armor box / craft: gloves + 20 feathers + 2 essence of fire" },
            { slot: "gloves", steps: [["gloves1", 7], ["gloves1", 8]], replace: true, for: "paladin", how: "armor box" },
            // Warrior chest: Rugged +7, then Dracul's Attire from +7 (no stat drop below +7), then +8 slowly
            // (workshop.dailyTries). No Rugged Coat +8 - the Attire replaces it.
            { slot: "chest", steps: [["coat1", 7], ["mcape", 7], ["mcape", 8]], replace: true, for: "warrior", how: "armor box / drop: Dracul, Ms. Dracul" },
            { slot: "chest", steps: [["coat1", 7], ["coat1", 8]], replace: true, for: "paladin", how: "armor box" },
            { slot: "shoes", steps: [["shoes1", 7], ["shoes1", 8], ["wingedboots", 7]], replace: true, for: "tank", how: "armor box / craft: shoes + 20 magical feathers" },
            // Priest (chest opener): Wanderer's pieces +8 once its shop gear is done; the shoes stand in for Winged Boots.
            { slot: "chest", item: "wattire", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "pants", item: "wbreeches", to: 8, replace: true, for: "priest", how: "Ponty / craft" },
            { slot: "gloves", steps: [["wgloves", 8], ["fierygloves", 7], ["fierygloves", 8]], replace: true, for: "priest", how: "Ponty / craft" },
            // Ranger gloves: Thundergrips, crafted from Gloves of the Hunter Ranger +6 (8 Monster Tokens).
            { slot: "gloves", steps: [["thundergrips", 7], ["thundergrips", 8]], replace: true, for: "ranger",
                how: "craft: hunter gloves +6 + 80 storm feathers + 12 essence of ether" },
            // Priest luck swap set: carried, never worn by the equip pass - classes.priest.luckSwap puts them on.
            { slot: "orb", item: "rabbitsfoot", to: 0, carry: true, for: "priest", how: "120 Fun Tokens" },
            { slot: "offhand", item: "mshield", to: 7, carry: true, for: "priest", how: "10 Fun Tokens (after the Rabbit's Foot: workshop.tokenOrder)" },
            { slot: "earring", item: "cloverstud", to: 0, carry: true, count: 2, for: "priest", how: "craft: vit earring +2 + verdant core + 40 ash leaf + 40 spores + 5 green slime (x2, one per earring slot)" },
            // Ranger AoE: Poucher and Alloy Quiver are held in the bag for a later AoE mode.
            { slot: "mainhand", item: "pouchbow", to: 7, carry: true, for: "ranger", how: "craft: bow + Pouch of Poof" },
            { slot: "offhand", item: "alloyquiver", to: 0, carry: true, for: "ranger", how: "drop: targetrons 1:4,000" },
            { slot: "shoes", item: "wshoes", to: 8, replace: true, for: "priest", how: "Ponty / craft",
                alts: [{ item: "wingedboots", how: "craft: Shoes + 20 Magical Feathers" }] },
            // Warrior Agitate mode: two orange Lolipop Maces carried; green ones stand in (weapons: gearPlan.weapons).
            { slot: "mainhand", item: "ololipop", to: 7, carry: true, count: 2, for: "warrior", how: "drop: Jr." },
            { slot: "mainhand", item: "glolipop", to: 7, carry: true, count: 2, insteadOf: "ololipop", for: "warrior", how: "drop: Green Jr." },
            // Mage Blaster (classes.mage.blaster), carried. to: 0 - upgraded by hand with Primlings, never by the workshop.
            { slot: "mainhand", item: "gstaff", to: 0, carry: true, for: "mage", how: "craft: staff +8 + Essence of Greed (crafted 2026-11-23)" },
        ],
        // Not wished: worn when we have them and the valuation rates them higher.
        found: {
            helmet: [{ item: "fury", for: "physical" }, { item: "xhelmet" }],
            chest: [{ item: "tshirt9" }, { item: "vattire", for: "caster" }, { item: "cdragon", for: "tank" }],
            pants: [{ item: "fallen", for: ["warrior", "rogue"] }, { item: "starkillers", for: "caster" }],
            shoes: [{ item: "wshoes", for: "nontank" }],
            gloves: [{ item: "supermittens" }, { item: "mpxgloves", for: ["paladin", "priest", "rogue"] }],
            cape: [{ item: "horsecape" }, { item: "ecape" }, { item: "vcape" }, { item: "gcape", for: "priest" }],
            earring: [{ item: "cearring" }, { item: "moonshardearring", for: "mage" }, { item: "frostfang" }, { item: "molesteeth" }],
            ring: [{ item: "cring", for: "caster" }, { item: "zapper", for: "priest" }, { item: "vring", for: "warrior" }, { item: "emberseal", for: "paladin" }],
            amulet: [{ item: "mpxamulet", for: ["paladin", "rogue"] }, { item: "keepsakependant", for: "paladin" }, { item: "gloampendant", for: "rogue" }],
            belt: [],
            orb: [{ item: "rabbitsfoot", for: "priest" }],
        },
        // Documentation only - the bot follows config.elixirs.
        elixirs: { off: true, note: "Superseded by config.elixirs (2026-11-23): Liquid Luck for the priest, main stat tier 0 for the others.", options: [{ item: "pumpkinspice", for: "physical" }, { item: "elixirluck", for: "priest" }] },
        // Weapons per class (PDF documentation); the bot rates guide weapon wishes and Ponty finds only for these types.
        classes: {
            warrior: {
                modes: {
                    single: { mainhand: [["blade", 8], ["swordofthedead", 7], ["fireblade", 9]], offhand: [["blade", 8], ["swordofthedead", 7], ["fireblade", 9]] },
                    aoe: { mainhand: [["glolipop", 7], ["ololipop", 7], ["vhammer", null, "found"]], offhand: [["glolipop", 7], ["ololipop", 7]],
                        note: "Missing Vampiric Hammer: a second Lolipop. Missing orange Lolipop: the green one." },
                },
                rules: ["Tank armor: Rugged set +7 replaces the shop pieces (2026-11-16).", "HP belt only while no STR belt is there.", "Swords of the Dead +5/+6/+7 as steps until the Fiery Blades +7 (2026-11-21; was: no Swords of the Dead, 2026-11-19)."],
            },
            ranger: {
                modes: {
                    single: { mainhand: [["bow", 8], ["hbow", null, "craft"], ["firebow", 7], ["crossbow", null, "found"]], offhand: [["quiver", 8], ["t2quiver", null, "found"]] },
                    aoe: { mainhand: [["pouchbow", 7, "craft"]], offhand: [["alloyquiver", null, "found"]], note: "Held in the bag for a later AoE mode." },
                },
            },
            priest: {
                modes: {
                    single: { mainhand: [["staff", 8], ["firestaff", 7], ["staffofthedead", 7], ["lmace", null, "found"]], offhand: [["wbook0", 2]],
                        note: "Shield M, Rabbit's Foot, the Wanderer's set and a Clover Stud are the luck swap set (classes.priest.luckSwap)." },
                },
            },
            rogue: {
                modes: {
                    single: { mainhand: [["stinger", 7], ["daggerofthedead", 7, "craft"], ["vdagger", null, "found"]], offhand: [["stinger", 7], ["daggerofthedead", 7, "craft"], ["vdagger", null, "found"]],
                        note: "First the main hand, then the offhand; spares climb the weapon ladder." },
                },
                rules: ["Knife Belt as soon as it can be crafted: it unlocks Fan of Knives."],
            },
            mage: {
                modes: {
                    single: { mainhand: [["staff", 8], ["firestaff", 9]], offhand: [["wbook0", 4]] },
                    aoe: { mainhand: [["gstaff", 3, "craft"], ["sparkstaff", null, "found"]], offhand: [] }, // the Blaster takes both hands
                },
            },
            paladin: {
                modes: {
                    single: { mainhand: [["mace", 8], ["maceofthedead", 9, "craft"], ["concordmace", 9]], offhand: [["wshield", 6], ["cave_counterweight", 7, "craft"]] },
                    aoe: { mainhand: [["glolipop", 7], ["ololipop", 7], ["vhammer", null, "found"]], offhand: [["wshield", 6], ["exoarm", null, "found"]] },
                },
                rules: ["Tank armor: Rugged set +7 like the warrior."],
            },
        },
    },

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies
    workshop: {
        enabled: true,
        // Minimum success chance per upgrade step, by how the item is replaced (0: a failure only costs the attempt).
        risk: {
            shop: 0,               // re-buyable from an NPC
            compound: 0,           // compound items (three copies from drops)
            rare: 0,               // token / drop items (Hunter set, Phoenix weapons, ...)
            graceWindow: 0.25,     // grace farming only when the chance is at most this far below the floor
            // No floor (like shop gear): copies come from boxes we hold in numbers.
            free: ["helmet1", "gloves1", "pants1", "coat1", "shoes1",
                "ololipop", "glolipop"], // Lolipop Maces up to +7 like shop gear: (Green) Jr. drops one or two per kill
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            // Only with scrollChoice off: the High scroll from this level (drop weapons / shop gear and armor).
            higherScrollFrom: 5,
            gearHighScrollFrom: 5,
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        // Cheapest scroll per step by expected gold; a +0 copy no shop sells is valued at max(drop hours x gold/h, game
        // value x valueFactor), else unknownValue.
        scrollChoice: { enabled: true, valueFactor: 3, unknownValue: 1000000 },
        dropNeverHours: 1000, // a drop slower than this per copy has no known own cost (no buy order at own cost)
        // Gold per wish (base item + scrolls, failures included): shop gear vs token/drop items; byItem per item.
        budgetPerWish: {
            shop: 1000000, rare: 4000000,
            byItem: { wattire: 8000000, wbreeches: 8000000, wgloves: 8000000, wshoes: 8000000 },
        },
        massSkills: true,             // Mass Production / Mass Exchange before upgrades and exchanges
        mainStatOnArmor: true,        // wished armor always gets the class's main stat scroll
        deliveryBatchMs: 10 * 60 * 1000, // finish the open wishes first; a ready item waits at most this long
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        onlineMs: 10 * 60 * 1000,     // only fighters with a heartbeat fresher than this are planned for
        // Items with a stat slot go out with the receiver's main stat; these scrolls skip the pots up to maxCost.
        statOnDelivery: { enabled: true, maxCost: 100000 },
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now (or the bag is full)
        bagReserve: 2,                // copies come out of the bank only while this many bag slots stay free
        bankScanEveryMs: 10 * 60 * 1000,
        // Value report: logs gain, cost and gain per hour of every open wish; orderWishes: work on open wishes by value.
        valueReport: { enabled: true, everyMs: 15 * 60 * 1000, top: 6, orderWishes: true },
        // Bases of a wished drop/craft are bought until their chances add up to baseTargetPieces finished pieces.
        baseTargetPieces: 1,
        maxBaseCopies: 20,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming: cheap shop items are failed at a level to raise the grace before a risky compound/rare step.
        grace: {
            enabled: false,
            minLevel: 4,             // only for steps to +4 and higher
            fodder: "wbasher",       // cheap upgradeable shop item no gear goal uses (Wooden Basher, 4,900 gold)
            // Gold per target level per 24 h: incomeShare of the merchant's net income, at least budgetPerLevel.
            incomeShare: 0.05,
            budgetPerLevel: 300000,
            maxAttempts: 25,         // fodder attempts per farming round
            // Stop once the fodder's own chance at the target level is above this (now or with the stacks still needed).
            maxFodderChance: 0.5,
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Ladder pot: income share (last 24 h) for the materialGoals "ladder" budget; optional extra: { amount, until }.
        bruteForce: { incomeShare: 0.25 },
        // Box armor: spare Rugged copies are upgraded towards upTo while wished; sold once nobody needs them.
        boxArmor: { names: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"], upTo: 8 },
        // At most this many upgrade tries per day for "item:level" (rare copies).
        dailyTries: { "mcape:8": 3 },
        // Shared material: a recipe waits while an item listed before it (or a material weapon goal) is still wished.
        materialOrder: { essenceofether: ["thundergrips", "moonshardearring", "windbelt"] },
        tokenOrder: { funtoken: ["rabbitsfoot", "mshield"] }, // token purchases in this order
        // Drop weapons that beat a fighter's worn one are delivered or upgraded until they do. With a gearPlan.weapons list
        // that list rules; names, maxLevel, craft and buy only matter for classes without one.
        betterWeapons: {
            enabled: true,
            names: ["fireblade", "firestaff", "firebow", "concordmace", "maceofthedead", "staffofthedead", "bowofthedead",
                "daggerofthedead"],
            maxLevel: 7,
            margin: 0.03,   // at least 3% stronger than the worn weapon
            craft: ["daggerofthedead"], // crafted once the fighter's weapon is at gearGoals.upTo
            buy: [],        // bought with tokens when we hold none
            minChance: {},  // per item: chance each upgrade step needs
        },
        // The workshop never spends below share x the merchant's highest gold of the last 24 h (at most max).
        keepGold: { share: 0.2, max: 5000000 },
        // Bonus wishes (no measurable gain, e.g. the priest's Wanderer set): one unit of work every everyMs.
        bonusWishes: { everyMs: 3 * 60 * 1000 },
        // Gear goals: when idle, the merchant pushes worn shop armor and weapons to `upTo` with the main-stat scroll.
        gearGoals: {
            enabled: true,
            fromLevel: 0,
            upTo: 8,                  // weapons and the "shop gear done" mark for class wishes
            stages: [7, 8],           // team-wide: every fighter's shop gear reaches a stage before anyone goes on
            capBy: { ranger: { chest: 9 } }, // per-piece caps once the whole team is through the stages
            everyMs: 3 * 60 * 1000,   // one gear-goal step this often even while wishes are open
            // offhand: a second shop weapon (dual wield) goes to upTo too; shields, books, quivers stay out.
            slots: ["helmet", "chest", "pants", "shoes", "gloves", "mainhand", "offhand"],
            weapons: [], // drop weapons: materialGoals and gearPlan.weapons
            // The gear pot: incomeShare of the last 24 h of income (minus consumables); everything on gear pays from it.
            budget: {
                incomeShare: 0.7,
                // One-time fresh start of every pot (no effect after 24 h). Optional: extra: { amount, until } on top.
                resetAt: "2026-11-24T00:00:00Z",
            },
        },
        wishes: {}, // fixed wishes on top of the guide's, e.g. DmpxPala: [{ name: "concordmace", level: 4 }]
        compound: {
            auto: true,   // combine spare accessories/books when no wish is open
            autoUpTo: 3,  // ...up to this level (each step still needs the risk tier's chance)
            keep: { "dexbelt:2": 2 }, // copies held back from auto compounding ("name:level": count)
            tidyMaxCost: 50000,       // an auto-compound step costing at most this never waits for a pot
        },
        exchange: {
            enabled: true,
            items: ["gem0", "gem1", "seashell", "leather"], // seashell only while config.elixirs.exchange asks for it
            // Opened only when a wished item comes out of them, a few at a time and while the bank has room.
            onDemand: ["armorbox"], onDemandBatch: 3, onDemandBankFree: 10,
            // Hoarded, not exchanged or opened (empty the list for a big batch).
            hold: ["gem0", "gem1", "marketparcel", "armorbox"], // + Merrit's parcels
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },

    // Merchant role
    merchantRole: {
        // The merchant's own wishes: bought, crafted at Leo or reported as a drop shortage; kept in his bag, never
        // delivered, sold or banked. They come before the fighters' wishes and only keep the potion reserve.
        ownWishes: [
            { name: "stand0" },       // market stand (buy orders, Merrit's parcels)
            { name: "rod" },          // fishing: Rugged pieces
            { name: "pickaxe" },      // mining (later: the Mining Tunnel has moles)
        ],
        // Gathering with the merchant's own tools, whenever its cooldown is over.
        gather: {
            // Mainland pier by the fisherman (water within 24 px); one catch per 48 min, 99.5% a Rugged piece.
            fishing: { enabled: true, spot: { map: "main", x: -1560, y: 470 }, maxCasts: 40 },
        },
        // Market stand: the merchant's home on the town square with the stand open (buy orders, Merrit's hourly parcel).
        // Upgrade, compound, Xyn, Lucas and the potion shop are within reach; keep 40+ px from fixed NPCs.
        stand: {
            enabled: true,
            home: { x: -120, y: -112 },
            reach: 390,               // NPCs this close are used without walking (server: 400)
            // Buy and sell orders: config.market at the top.
        },
        // Potion stock: potions.target per fighter (at most stockPerPotion), built only while we have stockFromGold gold.
        stockPerPotion: 1000,
        stockFromGold: 100000,
        goldReserve: { ratio: 0.2, min: 0, max: 1000000 }, // never spend below 20% of our gold (max 1M)
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // A pickup follows the fighter and re-routes once it moved more than retargetPx; gives up after followMs.
        followMs: 4 * 60 * 1000,
        retargetPx: 150,
        // NPC sales (never shiny, locked, worn or wished copies); sellBuyable: NPC-shop items go at +0, except these types.
        sellBuyable: {
            enabled: true,
            maxLevel: 0,
            exceptTypes: ["pot", "uscroll", "cscroll", "pscroll", "offering", "stand", "elixir", "booster", "tome", "qubics"],
        },
        // A plain name sells +0 copies, { name, maxLevel } up to that level. Never listed: Phoenix/event weapons, craft or
        // Witch's Cipher ingredients, Short Swords, Rugged/Heavy armor, accessories and books other than HP/VIT ones.
        sellList: [
            "slimestaff", "mushroomstaff",
            { name: "stinger", maxLevel: 2 }, // +3 and up are rogue daggers
            // Wanderer's set: sold only when no fighter can use the copy (workshop.equivalentWanted).
            "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
            "snowball",
            { name: "hpamulet", maxLevel: 10 },
            { name: "vitring", maxLevel: 10 },  // STR beats VIT for the warrior too
            { name: "hpbelt", maxLevel: 10 },   // stat belts replace them; a worn copy stays
            { name: "helmet", maxLevel: 3 },
            // Shop weapons and the old quiver that did their job; a copy anyone wishes for is never sold (isReserved).
            { name: "mace", maxLevel: 7 },
            { name: "staff", maxLevel: 7 },
            { name: "blade", maxLevel: 5 },
            { name: "quiver", maxLevel: 2 },
            // Materials without a plan.
            "rattail", "smush",
            "dawnwardaegis", // Skeletor drop, paladin-only shield
            "vitscroll", "lspores", // VIT stat scrolls (we use STR/INT/DEX; the shop sells them), Large Spores
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Every online fighter gets one if it carries none - from the bank, else bought with tokens (Tracktrix: 4 at Daisy).
        onePerCharacter: ["tracker"],
        onePerCharacterKeepOwn: false, // the merchant keeps no copy for itself
        // Merchant's Luck on ourselves, our fighters and (strangers) every other non-merchant player in reach; ours is
        // renewed below refreshBelowMs, strangers' strong mluck is left alone.
        mluck: { enabled: true, strangers: true, refreshBelowMs: 30 * 60 * 1000, mpReserve: 100 },
        // Ponty round over other servers (main.js hop watcher): every everyHours full local hours (0 = off) and once at
        // testAt the merchant serves every fighter, banks, visits Ponty on each server and comes home.
        pontyRound: {
            enabled: true,
            // Home = the leader's server (util.teamServer); this one only until the leader's first heartbeat is stored.
            home: ["EU", "III"],
            // Every server, PvP ones too (worth the risk); the home server is skipped automatically.
            servers: [["EU", "I"], ["EU", "II"], ["EU", "III"], ["EU", "IV"], ["US", "I"], ["US", "II"], ["US", "III"], ["US", "IV"], ["US", "V"], ["ASIA", "I"], ["ASIA", "II"],
                ["EU", "PVP"], ["US", "PVP"]],
            // Every hop ends a Lost and Found (Ron) access; hourly rounds mostly found nothing new.
            everyHours: 3,                     // every third full hour local time (0, 3, 6 ... o'clock)
            testAt: null,                      // one extra round at this ISO time
            prepMaxMs: 8 * 60 * 1000, hopTimeoutMs: 2 * 60 * 1000,
        },
        // Workshop rhythm: after a round that did something the next one comes after this; a round that only found locked
        // jobs tries the next at once; 30 s only when there is nothing to do.
        workshopFastMs: 3000,
        classItems: { priest: ["essenceoflife"], ranger: ["poison"] }, // skill ingredients, sent with every delivery
        // Bank: with few free bag slots, everything neither sold nor kept goes into the bank (no new bank packs bought).
        bank: {
            whenFreeBelow: 6,
            // Below this many free bag slots the workshop's idle stock is banked as well (taken out again when needed).
            stockFreeBelow: 15,
            // Before each pickup: bank first while fewer slots are free (store only, workshop copies too). 0 = off.
            beforePickupFree: 12,
            keep: [
                "tracker",
                "scroll0", "scroll1", "scroll2", "cscroll0", "cscroll1", "cscroll2",
                "essenceoflife", "poison", // skill ingredients for priests / rangers
                "stand0", "stand1",        // the market stand stays in the bag
                "rod", "pickaxe",          // the merchant's tools stay in the bag
            ],
        },
    },
};
