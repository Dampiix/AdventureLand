// =====================================================================
// bot_config – everything you are expected to tweak lives here.
//
// To run a different team (e.g. brand-new level-1 characters) only the
// `team` block needs to change. Classes come from character.ctype, so any
// class works; paladin, priest, mage and ranger have skill modules.
// =====================================================================

module.exports = {
    version: "1.126.2",

    team: {
        // Fresh save (2026-11-15). The old characters DampiixWar, Dampiix, DampiixPri and
        // Dampiiix are an item archive: never list them here, the bot would hand their
        // items to the merchant.
        // 2026-11-16: the paladin DmpxPala is replaced by the warrior DmpxWar (taunt, cleave).
        // Party since 2026-11-16: the priest leads (picks the spots, ranged), the warrior
        // tanks with Taunt.
        // Solo 2026-11-16 to 2026-11-17 (XP test: the warrior alone with Lone Wolf made 24.3M XP
        // in 30 min, the whole party 16.2M): the warrior levelled ahead as the tank (59 -> 64).
        // Party again since 2026-11-17 (booboos and wolves now pass the team check).
        // Solo again 2026-11-17: the warrior hunts the Phoenix nonstop with Lone Wolf for fire
        // weapons (firebow for the ranger). Party again 2026-11-17 for the firebow handover.
        // Solo again 2026-11-17: test run of the warrior alone on CGoos (Tiny Rubies).
        // Party again 2026-11-17: White Wolves to test the lone pulls.
        // Solo again 2026-11-17 (afternoon): the warrior hunts the Phoenix nonstop for firebows.
        // Party again 2026-11-17 (evening): normal farming and the Goo Brawl together.
        // Solo again 2026-11-17 (night): nonstop Phoenix to test config.dismantle (essence).
        // Party again 2026-11-18 (evening): Agitate with the team at the bats, the ranger
        // collects his gear. Solo: leader "DmpxWar", phase "solo".
        leader: "DmpxPriest",
        fighters: ["DmpxPriest", "DmpxWar", "DmpxRanger", "DmpxRogue"],
        // Fighters outside the party: not invited, not started by the leader (only three fighters
        // may be online). 2026-11-18 (late): the rogue joins the party for booboos and belts, the
        // ranger pauses. Before: the new rogue levelled on its own.
        solo: ["DmpxRogue"], // 2026-11-19: the ranger back in the party (booboo belts, level 60); the rogue solos tomorrow
        merchant: "DampiixMerch",                       // null for no merchant
        farm: {},                                       // optional per-character farm override, e.g. { DmpxRanger: "bee" }
    },

    // Market stand (player decision 2026-11-17): what the merchant buys and sells at his stand.
    //   buy:  { item, price, want, level? }  - a buy order for what is missing up to "want"
    //         (bag + bank are counted); level for upgradeable items, default +0.
    //   sell: { item, price, keep, level? }  - everything above "keep" is offered; items in
    //         the bank are fetched on the next bank trip. Wished items are never sold.
    // Prices per unit in gold. The stand has 16 slots for both (24 from merchant level 70).
    market: {
        buy: [
            { item: "essenceoffire", price: 140000, want: 10 }, // = a fire weapon (+ shop weapon, 20k at Leo)
            { item: "ololipop",      price: 150000, want: 4  }, // orange Lolipop Mace (a player pays 300k)
            { item: "glolipop",      price:  80000, want: 4  }, // green one as a stand-in
            { item: "offeringp",     price: 350000, want: 2  }, // Primling
            { item: "crossbow",      price: 400000, want: 1  }, // the ranger's long-term bow
        ],
        sell: [
            { item: "leather",       price:  120000, keep: 0 }, // a player buys at 100k
            { item: "snakefang",     price: 3500000, keep: 0 }, // a player buys at 3M
        ],
        // Shopping pot (player decision 2026-11-18): a share of the merchant's net income over
        // the last 24 h for buying wished items from Ponty / other players (server tour, not
        // built yet). It only fills for now; nothing spends it. Other pots for comparison:
        // gear goals 0.5, weapon ladder 0.25, grace 0.05 per target level (all in workshop).
        shopping: { incomeShare: 0.2 },
    },

    // Dismantle drops (player decision 2026-11-17): instead of upgrading them, the merchant
    // takes every spare copy of these items (up to maxLevel) to Leo and dismantles it into
    // its material - a fire weapon gives one Essence of Fire (10k, any level). The material
    // stacks in one bank slot; weapons are crafted from it when we want them (shop weapon +
    // essence + 20k at Leo). These items are left out of the weapon ladder while enabled.
    // Never dismantled: worn, wished or earmarked copies, a copy readied for a fighter
    // (betterWeapons), locked or titled copies, and copies up to a market.buy "want".
    dismantle: {
        enabled: true,
        // of-the-Dead weapons into Bones (player decision 2026-11-19) - except the Sword of the Dead:
        // its base (Short Sword) only comes from weapon boxes, so it can't be rebuilt.
        names: ["fireblade", "firestaff", "firebow",
            "maceofthedead", "staffofthedead", "bowofthedead", "daggerofthedead", "pmaceofthedead", "spearofthedead"],
        maxLevel: 0, // +1 and higher copies stay (they would only give one essence as well)
    },

    // Essence goals (player decision 2026-11-18): weapons crafted from the dismantled material
    // (e.g. Essence of Fire + shop weapon + 20k at Leo) and pushed up the normal upgrade ladder,
    // one copy at a time, until the goal is reached - then no further essence is touched.
    //   auto:  for every team fighter, the best weapon its class can wield that is crafted from
    //          `material`, at `upTo`; a goal when it beats the worn weapon (a second one for a
    //          weapon in the offhand). Delivered like a wish once done.
    //   extra: more goals on top, { item, level, count } - e.g. a spare to keep or sell.
    // A copy we already hold (a drop) is the base before a new one is crafted, and copies an
    // open goal needs are not dismantled. Normal scrolls only; the weapon ladder's budget pays.
    essenceGoals: {
        enabled: true,
        material: "essenceoffire",
        auto: true,
        upTo: 7,
        reserve: 0,          // essences that always stay in the bank
        maxPerGoal: null, skip: ["firestars"], // skip: never planned automatically (Firestars need Throwing Stars, 2026-11-18)    // null = no limit: a goal is a goal (player decision 2026-11-18)
        // When the weapon ladder's pot is empty, pay from the gear goals' pot - but only while
        // the gear goals have nothing open themselves (player decision 2026-11-18). null = never.
        borrowFrom: "goals",
        extra: [],
    },

    // "solo":  only the leader fights (Lone Wolf bonus); the merchant still supports it.
    // "party": all fighters form a party around the leader.
    phase: "party",

    party: {
        followDistance: 80,   // members idle within this distance of the leader
        leash: 300,           // members drop everything and catch up beyond this
        broadcastMs: 2000,    // leader shares position/target this often
        inviteEveryMs: 10000, // leader re-invites a missing member this often
        // Leader waits while a fighter is farther than waitDistance px (or out of sight), at most
        // waitMaxMs per separation, and not while something attacks it (player request 2026-11-18).
        waitForTeam: true, waitDistance: 500, waitMaxMs: 45000, waitAgainMs: 60000,
        // Ranged fighters keep out of the monsters' melee reach (+margin) while a tank class is
        // near (player request 2026-11-18); monsters reaching farther than we shoot are ignored.
        spacing: { enabled: true, minOwnRange: 100, margin: 50, gap: 130, step: 80, everyMs: 700 },
        // Easy farm targets: members pick their own monster near the leader instead
        // of only assisting (e.g. a 500-goo hunt).
        spread: { enabled: true, maxHits: 3, maxDamageRatio: 0.05 },
    },

    // Damage meter (2026-11-19): every everyMs the leader (or a solo fighter) logs the real damage per
    // second over the last windowMs, per member, from the game's hit events. "/dps" prints it now.
    meter: { everyMs: 5 * 60 * 1000, windowMs: 5 * 60 * 1000 },

    tickMs: 250,

    // Routes (smart_move).
    movement: {
        useTown: true, // the Town skill (teleport to the map's center) where it shortens a route (2026-11-18)
        townMinDistance: 600, // ...but only from farther than this from the map's center (the route search counts Town as one step)
    },

    // Client display only (no effect headless).
    ui: {
        hideGoldLogs: true,   // drop the game's "123 gold" loot lines from the log
        hideKillLogs: true,   // drop the game's "X killed a Bee" lines
    },

    // Events and world bosses (approved 2026-11-15). "always" or "never" (default).
    events: {
        enabled: true,
        observe: true,                  // log which events are live and what we do
        policy: {
            snowman: "always",          // holiday season world boss, 1,200 HP
            goobrawl: "always",         // daily goo fight
            phoenix: "always",          // roaming coop boss, weak hits, 180k XP, fire weapons
            // Dracul (cave, bat area; player request 2026-11-16): 240k HP, 245 magical hits,
            // 200k XP, respawns ~18 min after death at one of two cave spots. Drops firestaff
            // 5%, int/str/dex earrings 10% each, Dracul's Attire 3%, void thread 10%. Not
            // cooperative: never taken from another player who fights it.
            mvampire: "always",
            // Jr. (Spooky Town; player request 2026-11-17): drops the orange Lolipop Mace (+24 STR,
            // explosion splash) on every kill – a warrior weapon for the Agitate mode. 3,200 HP,
            // 80% evasion, weak magical hits, cooperative; respawns after ~5-9 h.
            jr: "always",
            // Green Jr. (Spooky Forest): the green Lolipop Mace (+24 DEX) on every kill – no loss
            // against the fireblades (no stat either), a stand-in until two orange ones are done.
            greenjr: "always",
            crabxx: "never", franky: "never", icegolem: "never",
            horseman: "never", abtesting: "never",
            graveyard: "always",          // Halloween: zombies/ghouls in Spooky Town's graveyard – Bones (2026-11-16)
        },
        // "always" only applies once every fighter has reached this level
        minLevel: { phoenix: 40, goobrawl: 20, snowman: 10, graveyard: 40, mvampire: 50, jr: 40, greenjr: 40 },
        search: [], // OFF 2026-11-19 (dino test); usual: ["phoenix", "mvampire", "jr", "greenjr"]
        // Search again this long after a miss or a kill (player decision 2026-11-15: 30 min,
        // the walk costs farm time). Respawn times (game source): the Phoenix (respawn 32)
        // comes back ~32 s after its death at a random one of its 5 spots; Dracul (1080)
        // after 13-22 min.
        searchEveryMs: 30 * 60 * 1000,
        // Bosses hunted nonstop: searched again after farmBossEveryMs (player option
        // 2026-11-16; Phoenix: weapons and earrings, about half the XP/h of crocs).
        farmBosses: [],                 // ["phoenix"] = nonstop Phoenix hunt; off for the Agitate test at the crocs (2026-11-18)
        // 10 s (player decision 2026-11-17): in the old 60 s the warrior seldom even reached his
        // farm spot; now he goes straight back on the round after a kill or an empty search.
        farmBossEveryMs: 10 * 1000,
        searchSpotMs: 4000,             // look around this long at each spawn area
        // Boss check (bosses only; the guide never calls them safe): from everyone's stats
        // and the game's damage formula. Other players are not counted on.
        boss: {
            minHits: 6,                 // every fighter must survive this many hits in a row
            healCover: 1.5,             // damage/s on the tank <= priests' healing/s x this (potions do the rest)
            maxFightMinutes: null,      // kill-time limit for the team alone; null = none (player decision 2026-11-15)
            priestDamageShare: 0.3,     // priests mostly heal: count this share of their damage
            // Solo (no priest): HP/s a fighter keeps up with potions and its own sustain.
            soloSustainHps: 150,
            pauseAfterDeathMs: 3 * 60 * 60 * 1000, // a death there pauses the boss this long
        },
    },

    // Monster Hunts (Daisy). Unsafe hunts are left to expire.
    hunts: {
        enabled: false, // OFF 2026-11-19 (dino test)
        minLevel: 20,                    // only once every fighter has this level (Daisy ignores our level)
        allow: [],                       // always hunt these, even if the guide calls them unsafe
        deny: [],                        // never hunt these
        minRemainingMs: 2 * 60 * 1000,   // skip hunts about to expire
        teamSpeedup: 2,                  // the team kills ~2x as fast as the leader alone (time check)
        visitCooldownMs: 10 * 60 * 1000, // at most one Daisy trip per 10 min
        waitAtDaisyMs: 6000,             // leader waits at least this long at Daisy...
        waitAtDaisyMaxMs: 45000,         // ...and up to this until every member is done there
        finishedRetryMs: 60 * 1000,      // a finished hunt: next Daisy trip after this at the earliest
        daisyRange: 200,                 // how close counts as standing at Daisy
        shareMs: 10000,                  // members report their hunt to the leader this often
    },

    // Items that can't be bought come before XP (approved 2026-11-15). The merchant
    // reports what is missing (wishes without enough copies + `want`), the leader's
    // guide names the best drop route and its expected time.
    drops: {
        enabled: true,
        maxHoursPerCopy: 4,         // slower drops are not farmed (guide's own time estimate)
        refreshMs: 5 * 60 * 1000,   // leader re-asks the guide this often
        reportMs: 5 * 60 * 1000,    // merchant reports shortages this often
        // Extra stock to collect even without a wish: { name, copies } (bag + bank, any level)
        // Armor Boxes for the Rugged step (2026-11-16): below 50 in stock the team farms
        // their best source – Irradiated Goo (gems -> 21 % box) – if it is safe and fast enough.
        want: [{ name: "armorbox", copies: 50 }],
    },

    targeting: {
        // Player decision 2026-11-17 (night): the solo warrior farms CGoos overnight (gold for the
        // budget pots after the reset, XP to 68, gems); the Phoenix is still searched every 30 min.
        // Boo Boo solo test 2026-11-17 (late) failed: he walked into the pack and died. Back to CGoos.
        farm: ["mummy", "booboo", "stoneworm"], // overnight 2026-11-19: mummies, booboos/stoneworms only as a backup // a list (2026-11-19): the first one not too strong/crowded; null = the guide picks
        fallback: "goo",          // used when the progression guide has no answer
        // Farm only where every fighter's own guide calls the spot safe; routes the guide
        // only offers as a careful trial count once proven – by the guide's own fights, or
        // by 15 min of team farming there without a death (remembered across restarts).
        avoidTrial: true,
        // Melee classes never hit monsters returning this much damage (dreturn in %, porcupine
        // 4800 = 48x back – one hit kills a warrior; armadillo 30 is fine). Ranged ones farm them.
        // Lowered to 20 (2026-11-16): armadillos (30 %) nearly killed the solo warrior – his
        // dual-wield hits and Cleave on several of them came back faster than potions heal.
        melee: { classes: ["warrior", "paladin", "rogue"], maxDreturn: 20 },
        // The current farm spot is left only when a member's "unsafe" lasts this long
        // (verdicts near the edge flip back and forth); a death there counts at once.
        objectionGraceMs: 5 * 60 * 1000,
        // Team model (on since 2026-11-16, a test with the warrior as tank): a spot
        // counts as safe when the party can take it together – the tank survives tankHits
        // volleys of `pull` monsters (pullAggressive for monsters that attack on sight),
        // the priests' healing covers that damage x healCover, everyone else survives
        // otherHits hits until the tank's Taunt pulls the monster. Spots are then ranked by
        // the guide's XP. Off: every member's own guide must call the spot safe alone.
        // "/safety [map]" in the leader's client logs both verdicts per monster.
        teamSafety: {
            enabled: true,
            tankClasses: ["warrior", "paladin"],
            tankHits: 6, otherHits: 3, healCover: 1.5,
            pull: 2, pullAggressive: 3,
            pullLone: 2,                   // monsters pulled one at a time (isolation): one plus a possible add
            // Aggressive monsters whose spawn area per monster is below this (px²) come as a
            // whole pack (vampire rats: 5 in 150x195 wiped the team, 2026-11-16).
            denseArea: 15000,
            abilities: [],                 // monster abilities we accept (others: the guide decides)
            // The whole fight: damage/s the priest's heals and the tank's potions don't cover,
            // for as long as the team needs to kill it, must stay below this share of the
            // tank's max HP (level-12 White Wolves have 312k HP, 2026-11-17).
            fightHpUse: 0.5,
        },
        // Monsters that join a fight (aggro: they hit whoever passes close by; rage: they then
        // stay on that player and chase him – game source) are only pulled when no other free
        // such monster stands within radius of the target, of where we will stand or of the
        // way there. Walking into the middle of the White Wolf pack (rage 1) wiped the team
        // (2026-11-17); one at a time they are fine. Without rage a monster only lands a hit
        // in passing (bees 0.1, crabs, scorpions), and harmless ones never count.
        // strongHold: too-strong ones of the farm type stop the search walk only this close.
        // watchMargin (2026-11-19): waiting for a lone one, the leader stands this far outside the spawn box edge
        isolation: { enabled: true, minAggro: 0.3, minRage: 0.3, radius: 120, strongHold: 300, watchMargin: 150 },
        // Monster levels (player request 2026-11-16): from this level a monster is checked
        // again with its real stats before we pull it (team model, else its damage per
        // second must stay within tolerance x the level-1 monster's).
        live: {
            fromLevel: 2,
            ownHits: 6,           // members/solo picking their own target: survive this many real hits
            // Solo: the HP lost over the whole fight (real damage/s minus own healing: a potion
            // per cooldown, priest self-heals, lifesteal, for the time we need to kill it) must
            // stay below this share of max HP. 0.7 (player decision 2026-11-17): such a fight
            // only starts with enough HP to end it at 30% or more (fighter: heal up first).
            soloHpUse: 0.7,
            waitTolerance: 2.5,   // leader while the team stats are not in yet (level-5 CGoo: 1.9x)
        },
        refreshMs: 5 * 60 * 1000, // how often to ask the guide again
        crowdedAfterMs: 90 * 1000,    // no free target this long on the farm map -> spot is crowded
        // ...or this share of a window without a free target (other players leave us only
        // the odd monster, e.g. one per minute):
        crowdedWindowMs: 3 * 60 * 1000, crowdedIdleShare: 0.7, // idle = not in range of a target (walking counts)
        crowdedForMs: 60 * 60 * 1000,  // then use the guide's next choice for this long,
        // Another player within occupiedRadius of the farm spot we walk to: that spot is skipped
        // for occupiedForMs and its free monsters are left alone (2026-11-18, Eagle at the bats).
        occupiedBy: 1, occupiedRadius: 300, occupiedAfterMs: 20000, occupiedForMs: 20 * 60 * 1000,
        crowdedMaxMs: 6 * 60 * 60 * 1000, // doubled each time the same spot is crowded again within a day
    },

    // Cavalry (Tracktrix): emergency rescue and resetting grown farm spots (2026-11-18).
    // Strong only while the account's highest level is below 80.
    // targets (2026-11-19): spots nuked whenever the Cavalry is ready and the first farm target is
    // fine (loot at high level, e.g. dinos for bones); with the first farm target too strong the
    // Cavalry resets that one instead. Then back to the farm list.
    cavalry: { enabled: true, emergencyHpBelow: 0.35, emergencyOnMe: 1, reset: true, resetFromLevel: 5, resetMinCount: 2,
        targets: [], planStayMs: 100 * 1000, planMaxMs: 10 * 60 * 1000,
        foreignClear: 420, planMinCount: 5 }, // planMinCount: a plan call waits for this many of the kind in reach (or all in sight) // no reset/nuke call with another kind of level-3+ monster this close (the fairy, 2026-11-19)

    combat: {
        // Kiting (solo and in a party - there within the leash, towards a tank class; player
        // decisions 2026-11-18): a fighter with more range than a monster
        // (margin px) that is also faster steps `step` px back when that monster would reach it
        // before it dies - not for ones that die in time. Away from the pack and from free
        // monsters (avoidRadius). The warrior never qualifies (range 38).
        kite: { enabled: true, margin: 30, step: 60, everyMs: 600, avoidRadius: 120 },
        potionHpBelow: 0.8,      // below this: an HP potion on every cooldown (player decision 2026-11-16, was 0.45)
        potionMpBelow: 0.3,
        // Otherwise drink as soon as a whole potion's worth is missing (HP before MP), i.e.
        // on every cooldown in a long fight (player request 2026-11-16).
        potionWhenMissing: true,
        // With a priest in the party close by (or as the priest): potions only as an
        // emergency, the healing does the rest (player decision 2026-11-16).
        // fastLossPerSec (2026-11-18): losing this share of max HP per second (over ~3 s) - the solo
        // potion rules apply although a healer is near (Jr. killed the warrior next to the priest).
        // Pass through (2026-11-19): the leader/solo on its way to the farm spot leaves slower
        // attackers of other kinds behind instead of fighting them (above minHp, not within
        // spotRadius of the spot).
        passThrough: { enabled: true, minHp: 0.5, speedShare: 0.8, spotRadius: 400 },
        withHealer: { potionHpBelow: 0.6, potionWhenMissing: false, fastLossPerSec: 0.06 },
        // MP: drink as soon as this share of an MP potion is missing – solo and in the party
        // (player decision 2026-11-17: "Mana kann ruhig immer voll sein", potions are cheap).
        mpTopUp: 0.5,
        // Below this HP an HP potion always comes first; above it MP comes first once MP is
        // below potionMpBelow and HP above half, or nearly empty (at 0 MP the solo warrior
        // could not attack and only took hits, 2026-11-17).
        hpCriticalBelow: 0.3,
        // Without a priest close by (solo): after a fight below hpBelow HP or mpBelow MP the
        // fighter pulls nothing new and drinks back up to hpUntil / mpUntil first (player
        // request 2026-11-17: 2-3 higher-level CGoos in a row wore the warrior down).
        recover: { enabled: true, hpBelow: 0.5, mpBelow: 0.5, hpUntil: 0.8, mpUntil: 0.8, maxMs: 90 * 1000 },
    },

    classes: {
        paladin: {
            selfHealBelow: 0.6,
            useSmash: true, mpReserve: 150, // Smash needs a mace
            oathBelow: 0.5,                 // Guardian's Oath on allies below 50% HP (lvl 50+)
            useCleansingLight: true,        // lift poison/curse/burn/... from allies (lvl 30+)
            // Mana Shield: damage drains MP instead of HP while on
            manaShield: { onBelow: 0.35, offAbove: 0.7, minMp: 0.25 },
        },
        priest: {
            healBelow: 0.75, selfHealBelow: 0.6,
            partyHealBelow: 0.65,           // Party Heal when 2+ members are below this...
            partyHealDanger: 0.35,          // ...or one member is below this
            useCurse: true, mpReserveRatio: 0.4,
            useRevive: true,                // revive fallen members (consumes an Essence of Life)
            // Absorb Sins (lvl 55): emergency only – a member below `below` with monsters on it
            // and no warrior/paladin within Taunt range of it; only while we are above selfAbove.
            absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            // Dark Blessing (lvl 70): +25% party damage for 8 s on targets needing sturdyHits+
            // of our hits, and on bosses.
            darkBlessing: { enabled: true, sturdyHits: 10 },
        },
        // Rogue (module added 2026-11-18): Quick Stab/Punch follow the mainhand (dagger/fist).
        rogue: {
            mpReserveRatio: 0.25,
            swiftness: true,          // Rogue Swiftness (lvl 40) on us and party members in reach
            smokeBelow: 0.25,         // Assassin's Smoke below this HP share with monsters on us (0 = never) ...
            smokeUntil: 0.6, smokeClear: 200, // ... then hide where no monster is within smokeClear px until this HP share
            mentalBurst: true,        // only once INT reaches the skill's 64
            fanFrom: 3,               // Fan of Knives (lvl 65, Knife Belt) with this many monsters around
            poisonCoat: { enabled: true, minHits: 40 }, // A Poisonous Touch (Poison Sack) on targets needing 40+ hits
        },
        ranger: {
            sturdyHits: 3,                  // Hunter's Mark / Supershot only on targets needing 3+ hits
            mpReserveRatio: 0.3,
            usePoisonArrow: true,           // consumes a Poison Sack
        },
        warrior: {
            mpReserveRatio: 0.2,
            // Taunt a monster off an ally that is below allyHpBelow, or that hits for at
            // least hitRatio of the ally's max HP per hit ("harder targets").
            taunt: { enabled: true, allyHpBelow: 0.8, hitRatio: 0.05 },
            agitateFrom: 3,                 // Agitate (lvl 68) when this many monsters are on allies
            cleaveFrom: 3,                  // Cleave (lvl 52, axe/scythe) with this many monsters around
            stompFrom: 2,                   // Stomp (lvl 52, basher) with this many attackers
            sturdyHits: 4,                  // War Cry (lvl 70) on targets needing this many hits
            hardShell: { enabled: true, below: 0.45 }, // lvl 60, against physical hits
            useCharge: true,                           // +30 speed whenever we walk (on cooldown)
            // Dash: the server accepts a point at most 50 px away (game source) – a 120 MP hop,
            // no gap closer. Off since 2026-11-16 (the old 150 px jumps always failed).
            dash: { enabled: false, from: 120, max: 45, everyMs: 2000 },
            // Agitate pack mode (solo, lvl 68; test since 2026-11-18): with minPack free monsters
            // within Agitate range he puts on his splash weapons (explosion, e.g. Lolipop Maces),
            // casts War Cry + Agitate, steps kiteStep px away so the pack follows from one side,
            // then always hits the monster with the most others in the splash radius. Spread out
            // (fewer than regroupBelow splash neighbours per hit over the last hits): another step.
            // Each pull is logged ("pull done: ... splash neighbours per hit").
            agitate: {
                enabled: true,
                // "auto" (2026-11-18): the bot decides per farm target (safety, learned splash -
                // see the warrior module); a list forces these kinds; deny excludes kinds.
                monsters: "auto", deny: [],
                maxOnMe: 8, maxHp: 50000, abilities: [], // auto: at most this many at once; no bosses / unknown abilities
                splashOnlyFrom: 3, splashOnlyHoldMs: 8000, // Lolipops without Agitate with this many on us (splash must pay) - 2026-11-19
                fearMax: 0, // attackers of one damage type beyond our courage for it (each one more costs 20-40 % attack)
                maxLevel: null, safetyShare: 0.5, // auto: no fixed level cap (the pack check uses real stats; a number caps by hand); a pull may cost only half the HP the pack check allows
                splashMin: 1.0, learnHits: 40, denseCount: 5, denseSpacing: 130, // auto: lolipops from 1.0 splash per hit (guess from spawn density first)
                deathDenyMs: 2 * 60 * 60 * 1000, // auto: no Agitate on a kind for this long after dying to it
                escapeHp: 0.3, escapeMs: 10000, escapeClear: 250, escapeStep: 200, // solo escape from a losing fight (slower monsters only)
                weapons: "splash",    // "splash": put on the splash weapons; "keep": pull with the usual ones ("/agitate off|swords|splash" switches at runtime)
                minPack: 3,
                minHp: 0.8,           // start a pull only above this HP share
                abortHp: 0.3,         // below: walk away from the pack
                gather: "center",     // "center": walk into the pack, Agitate there, all arrive together; "step": Agitate, then step away
                centerWithin: 20,     // "center": at the pull point within this distance
                searchRadius: 200, gridStep: 40, // "center": pull points tried around us
                avgPerMonster: 60,    // "center": one monster more in reach is worth this much less average way (px)
                sideStep: 50,         // "center": step out of the pack after Agitate (0 = stay)
                adjustStep: 40, adjustEveryMs: 4000, // "center": step when monsters come from behind
                waitShare: 0.7, waitMs: 3000, // first swing once this share of the pulled pack is in range (at most waitMs)
                chaseFrom: 3,         // with this many or fewer left and none in range: walk to the nearest one
                swords: "stream",     // mode "swords": "stream" = Agitate on every cooldown where we stand (normal combat), "pull" = the pull-point version
                streamFrom: 1, streamOnMe: 3, // "stream": Agitate when this many free ones are in reach and fewer than streamOnMe attack us (auto: splashOnMe, so the splash is measured fairly)
                splashOnMe: 5, sugarBonus: 2, agitateEverySec: 6, // "splashstream": up to 5 on us (raise once the bat deaths are understood; mana: one Agitate per 6 s) ...
                streamLowHp: 0.6, streamStopHp: 0.4, // ... at most 2 below 60% HP, no Agitate below 40%
                streamToClump: true, clumpRadius: 60, clumpStep: 80, // "splashstream": walk to clumps (each neighbour within 60 px is worth 80 px of way)
                // In a party (2026-11-18): only a stream mode, on the leash - no pull points, no walking
                // off to clumps; the protective Taunt/Agitate for allies goes first. With a priest
                // close by up to partyOnMe may be on us.
                partyMode: "auto", // "auto": the automatic decision for the leader's farm target - same stream as solo (walks to clumps, same limits; 2026-11-18)
                kiteStep: 120,        // "step" (and backing off): this far
                gatherMs: 2500,
                regroupBelow: 0.5, regroupEveryMs: 8000,
                keepMs: 60 * 1000,    // splash weapons stay on this long after a pull
            },
        },
        mage: {
            energizeAbove: 0.6,             // only give mana while we have more than this
            energizeBelow: 0.4,             // to a member below this MP ratio
            useBurst: false,                // Mana Burst empties the whole MP pool
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

    // Fighter side of the item/gold flow
    supply: {
        keep: ["tracker"],               // never handed to the merchant
        keepByClass: { priest: ["essenceoflife"], ranger: ["poison"] }, // skill ingredients
        // Fighters only need gold to buy potions themselves when the merchant can't;
        // the merchant buys all equipment. So they keep a small emergency fund
        // (100 big potions) and hand everything else over (player decision 2026-11-15).
        goldKeep: 10000,
        goldMinSend: 5000,               // only send gold when the surplus is at least this
        freeSlotsMin: 6,                 // ask for a pickup when fewer slots are free
        pickupEveryMs: 15 * 60 * 1000,   // ask for a routine pickup this often
        firstPickupAfterMs: 60 * 1000,   // first routine pickup this long after the bot starts
        requestEveryMs: 60 * 1000,       // don't spam the merchant
        merchantTimeoutMs: 3 * 60 * 1000, // no answer for this long -> buy potions yourself
        // While the merchant is on its way we keep farming and send our position this often,
        // for at most followMs after the request (player decision 2026-11-17).
        positionEveryMs: 5000,
        followMs: 5 * 60 * 1000,
    },

    // Fighters: equipment wishes from the progression guide + auto-equip
    gear: {
        enabled: true,
        // Never equipped automatically, taken off when worn (player decision 2026-11-18):
        // Hand of Midas (-20 speed), Heavy Underarmor, Dracul's Attire (mcape, a chest piece).
        noEquip: ["handofmidas", "hpants", "mcape"],
        wishEveryMs: 5 * 60 * 1000, // re-read the guide and resend wishes this often
        maxWishes: 12,  // class chains alone are up to 9 (ring, earring, belt, orb, cape, five Rugged pieces)   // a longer list shifts less (the merchant works through it one by one)
        // Wishes per class ("all" = every class) for slots the guide leaves empty. An entry
        // is one item or a chain { steps: [...] }: only the first step the worn piece does
        // not reach is wished, a piece of a later step (e.g. a lucky drop) counts for the
        // earlier ones and is equipped over them. A slot holding something outside the
        // entry is left alone. Not counted as gear goals (no further upgrades).
        // Active again since 2026-11-16 (player decision). Rugged armor (armor boxes) comes
        // after the shop armor: wished only once ALL shop gear is done (+8 armor, +7 weapon),
        // kept by the merchant until +7 and then worn over the shop piece (replace).
        // Helmet, gloves, pants first: most common in boxes, and 3 pieces give +20/+20.
        // Tanks only (player decision 2026-11-16): Rugged +7 has 10 main stat, shop +8 has 12,
        // so the priest and ranger keep their shop +8 (damage/healing); the warrior trades
        // 2 STR per piece for ~3x the armor and resistance.
        // The Monster Hunter sets are long-term and stay out for now.
        classWishesEnabled: true,
        // Belts (player decision 2026-11-19, replaces the tank HP-belt chain of 2026-11-17):
        // every class takes its main-stat belt (+4 at +0, +10 at +2) over an HP belt and
        // compounds it to +2. An HP belt is only worn while no stat belt is there (the guide
        // fills the empty slot). Stat belts drop in Spooky Town (map drop).
        // Gear plan phase 1 (player decision 2026-11-19, docs/gear-guide/gear-plan.json):
        // earrings, amulets and belts go on to +4, rings too (player decision 2026-11-19). Item stages: a wish for
        // the next level waits while a lower wish for the same item is still missing
        // (workshop openWishes) - other items never block it.
        // Rings and earrings to +3 (player decision 2026-11-17): +2 first, then +3 for both
        // slots of each (+3 needs ~91 copies at +0 per piece - Phoenix earrings, Winterland rings).
        // Rings (player decision 2026-11-16): two stat rings +2 in the class's main stat
        // (+6) replace the Rings of Small Joys +2 (+3 STR/INT/DEX, +15 resistance) – at +0/+1
        // they are no better. Delivered only complete (+2), worn over a Ring of Joy right away
        // (anytime: no wait for the shop gear). Copies: Winterland map drop (statring table).
        classWishes: {
            all: [
                { name: "cape", level: 0 },      // 40 Leather -> exchange (wolves, boars)
            ],
            // Orbs: Orb of Beginnings (Cole: ascale + pleather + cscale + Bee Fur) to +1 first
            // (+3 to every main stat, 3 copies), then the class orb (+4 main stat already at +0).
            paladin: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofstr", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "strring", level: 2 }, { name: "strring", level: 3 }, { name: "strring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "strearring", level: 2 }, { name: "strearring", level: 3 }, { name: "strearring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "stramulet", level: 2 }, { name: "stramulet", level: 3 }, { name: "stramulet", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "strbelt", level: 0 }, { name: "strbelt", level: 1 }, { name: "strbelt", level: 2 }, { name: "strbelt", level: 3 }, { name: "strbelt", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "helmet1", level: 7 }], replace: true },
                { steps: [{ name: "gloves1", level: 7 }], replace: true },
                { steps: [{ name: "pants1", level: 7 }], replace: true },
                { steps: [{ name: "coat1", level: 7 }], replace: true },
                { steps: [{ name: "shoes1", level: 7 }], replace: true },
            ],
            priest: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofint", level: 0 }] }, // big Pom Pom (level2n)
                { steps: [{ name: "intring", level: 2 }, { name: "intring", level: 3 }, { name: "intring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "intearring", level: 2 }, { name: "intearring", level: 3 }, { name: "intearring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "intamulet", level: 2 }, { name: "intamulet", level: 3 }, { name: "intamulet", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "intbelt", level: 0 }, { name: "intbelt", level: 1 }, { name: "intbelt", level: 2 }, { name: "intbelt", level: 3 }, { name: "intbelt", level: 4 }], replace: true, anytime: true },
            ],
            // The offhand is a second weapon (dual wield, handled by gear/workshop).
            // Monster Hunter Warrior set: long-term, paused (entries: mwhelmet 7, mwgloves 8,
            // mwpants 11, mwarmor 12, mwboots 15 tokens; replace at +7).
            warrior: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofstr", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "strring", level: 2 }, { name: "strring", level: 3 }, { name: "strring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "strearring", level: 2 }, { name: "strearring", level: 3 }, { name: "strearring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "stramulet", level: 2 }, { name: "stramulet", level: 3 }, { name: "stramulet", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "strbelt", level: 0 }, { name: "strbelt", level: 1 }, { name: "strbelt", level: 2 }, { name: "strbelt", level: 3 }, { name: "strbelt", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "helmet1", level: 7 }], replace: true },
                { steps: [{ name: "gloves1", level: 7 }], replace: true },
                { steps: [{ name: "pants1", level: 7 }], replace: true },
                { steps: [{ name: "coat1", level: 7 }], replace: true },
                { steps: [{ name: "shoes1", level: 7 }], replace: true },
                // Two orange Lolipop Maces +7 (player decision 2026-11-17, instead of the Wooden Axe
                // and Cleave – its 720 MP made it useless solo): +24 STR each and explosion splash
                // on every hit, one-handed, so dual wield stays. Carried in the bag until an
                // Agitate mode swaps them in. Only Jr. drops them; +8 (~15-19%) is decided later.
                { steps: [{ name: "ololipop", level: 7 }], carry: true, count: 2 },
                // Green ones (+24 DEX, Green Jr.) stand in while orange ones are missing (player
                // decision 2026-11-17): no loss against a stat-less weapon, just no bonus.
                { steps: [{ name: "glolipop", level: 7 }], carry: true, count: 2, insteadOf: "ololipop" },
            ],
            ranger: [
                // Cole: 1 Armadillo Scale + 200 Beewings (scorpions drop it too). The +7 is built on
                // a second copy; the worn +0 stays until it is done.
                { steps: [{ name: "quiver", level: 0 }, { name: "quiver", level: 7 }] },
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofdex", level: 0 }] }, // Fire Spirit
                { steps: [{ name: "dexring", level: 2 }, { name: "dexring", level: 3 }, { name: "dexring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexearring", level: 2 }, { name: "dexearring", level: 3 }, { name: "dexearring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexamulet", level: 2 }, { name: "dexamulet", level: 3 }, { name: "dexamulet", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexbelt", level: 0 }, { name: "dexbelt", level: 1 }, { name: "dexbelt", level: 2 }, { name: "dexbelt", level: 3 }, { name: "dexbelt", level: 4 }], replace: true, anytime: true },
            ],
            // Rogue (2026-11-18): DEX jewellery like the ranger; weapons (two daggers, e.g. Dagger
            // of the Dead from Ponty) come by hand for now.
            rogue: [
                { steps: [{ name: "orbg", level: 0 }, { name: "orbg", level: 1 }, { name: "orbofdex", level: 0 }] },
                { steps: [{ name: "dexring", level: 2 }, { name: "dexring", level: 3 }, { name: "dexring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexearring", level: 2 }, { name: "dexearring", level: 3 }, { name: "dexearring", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexamulet", level: 2 }, { name: "dexamulet", level: 3 }, { name: "dexamulet", level: 4 }], replace: true, anytime: true },
                { steps: [{ name: "dexbelt", level: 0 }, { name: "dexbelt", level: 1 }, { name: "dexbelt", level: 2 }, { name: "dexbelt", level: 3 }, { name: "dexbelt", level: 4 }], replace: true, anytime: true },
            ],
        },
    },

    // Merchant: fulfil wishes from bag, bank or by upgrading own copies (approved 2026-11-15)
    workshop: {
        enabled: true,
        // Minimum success chance per step, by how the item is replaced (player decision
        // 2026-11-16, replaces the 40/60/70 % value tiers of 2026-11-15: losses are part
        // of the game, progression must not stall at +4..+6):
        risk: {
            shop: 0,               // re-buyable from an NPC: no floor (the budgets cap the gold)
            compound: 0.35,        // compound items (three copies from drops)
            rare: 0.5,             // token / drop items (Hunter set, Phoenix weapons, ...)
            // Grace farming starts only when the chance is at most this far below the floor
            // (a sanity limit). How many grace stacks are built is decided by the fodder's own
            // success chance (grace.maxFodderChance, player decision 2026-11-16).
            graceWindow: 0.25,
            // No floor either (like shop gear): copies come from boxes we hold in numbers.
            free: ["helmet1", "gloves1", "pants1", "coat1", "shoes1",
                "ololipop", "glolipop"], // Lolipop Maces up to +7 like shop gear: (Green) Jr. drops one or two per kill
            maxScrollGrade: 2,     // try up to Rare scrolls when the normal one falls short
            // Weapons nobody sells in normal grade use the High scroll (40k) from +4 -> +5 on.
            higherScrollFrom: 5,
            buyStrongerScrolls: true, // only within budgetPerWish; owned/banked ones are used first
        },
        // Gold per wish (base item + scrolls, failures included): shop gear vs token/drop
        // items (player decision 2026-11-16: room for Rare scrolls, 1.6M each).
        budgetPerWish: {
            shop: 1000000, rare: 4000000,
            // Per item, e.g. { waxe: 4000000 } (the Wooden Axe plan was dropped 2026-11-17).
            byItem: {},
        },
        massSkills: true,             // Mass Production / Mass Exchange before upgrades and exchanges
        mainStatOnArmor: true,        // wished armor always gets the class's main stat scroll
        deliveryBatchMs: 10 * 60 * 1000, // finish the open wishes first; a ready item waits at most this long
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now
        bankScanEveryMs: 10 * 60 * 1000,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming (approved 2026-11-15): before a compound/rare item is risked at a
        // level whose chance is too low, cheap shop items are failed at that level to raise
        // the player's grace for it. The real preview decides when it is enough.
        grace: {
            enabled: true,
            minLevel: 4,             // only for steps to +4 and higher
            fodder: "wbasher",       // cheap upgradeable shop item no gear goal uses (Wooden Basher, 4,900 gold)
            // Gold per target level per 24 h (fodder + scrolls): incomeShare of the merchant's
            // net income over 24 h (player decision 2026-11-16; ~15M/day -> ~750k), at least
            // budgetPerLevel.
            incomeShare: 0.05,
            budgetPerLevel: 300000,
            // Player decision 2026-11-16: +5M per level until the gear goal extra ends.
            extra: { amount: 5000000, until: "2026-11-17T06:15:44Z" },
            maxAttempts: 25,         // fodder attempts per farming round
            // Grace stacks only while the fodder itself would fail more likely than not: stop
            // when its own chance at the target level is above this - now, or by the time the
            // stacks still needed are built (measured gain per stack). A success resets them.
            maxFodderChance: 0.5,
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Spare copies to upgrade when idle (approved 2026-11-15): Phoenix weapons are kept
        // as spares; the best copy below upTo is upgraded, failures use up surplus copies,
        // never going below `spares` copies in total. Normal scrolls only: rare scrolls
        // and grace farming are reserved for the fighters' wishes.
        stockEnabled: false, // paused 2026-11-16 (shop +9 first)
        // Weapon ladder (player decision 2026-11-16): grace can't lift high-grade items, so
        // spare copies of these are upgraded at once with the normal scroll - always to one
        // level above the WEAKEST worn copy in the team (both of the warrior's fireblades
        // count). A spare that gets there is swapped in, the old one becomes the next spare;
        // the next level starts only once every worn copy is at the top. Worn copies are never
        // risked; items nobody wears are left alone.
        // hoardAt (2026-11-16): spares are not risked beyond this level; +7 copies are kept.
        // incomeShare (player decision 2026-11-17): the ladder's own pot, a share of the last
        // 24 h of income – it scales with the account and is not stopped by the gear goals.
        bruteForce: { names: ["fireblade", "firebow", "firestaff"], maxLevel: 9, hoardAt: 7, incomeShare: 0.25 },
        // Box armor (player decision 2026-11-17): while a fighter wishes any Rugged piece,
        // every spare copy from the armor boxes is upgraded towards upTo at once – failures
        // free bank slots and the next chain pieces are ready early (the bank has ~19 free
        // slots; a new pack costs 75M).
        // Once a piece is worn (or held) at upTo and nobody wishes it, new copies are sold.
        boxArmor: { names: ["helmet1", "gloves1", "pants1", "coat1", "shoes1"], upTo: 7 },
        stock: [
            { name: "fireblade", upTo: 7, spares: 3 },
            { name: "firestaff", upTo: 7, spares: 3 },
        ],
        // Drop weapons (player decision 2026-11-15): a Phoenix weapon we hold that beats a
        // fighter's worn weapon goes to that fighter; if none does yet, the best copy is
        // upgraded to the first level that would (at most maxLevel). A failure only costs
        // a drop – the fighter keeps its shop weapon. Gear-goal budget, normal scrolls.
        betterWeapons: {
            enabled: true,
            names: ["fireblade", "firestaff", "firebow", "concordmace", "maceofthedead", "staffofthedead", "bowofthedead",
                "daggerofthedead"], // daggers for the rogue (2026-11-18: bought at Ponty)
            maxLevel: 7,
            margin: 0.03,   // at least 3% stronger than the worn weapon
            // Next weapon step (player decision 2026-11-16): once a fighter's weapon (shop or
            // fire) is at gearGoals.upTo, its "of the Dead" weapon is crafted (Bones from
            // Zombies + a shop weapon + fee) and upgraded until it is stronger.
            // Paused 2026-11-19 (player decision): the first Bones are kept, nothing crafts with them.
            // Gear plan (player decision 2026-11-19): Bones go to Daggers of the Dead for the rogue.
            craft: ["daggerofthedead"], // was ["maceofthedead", "staffofthedead", "bowofthedead"]
            // Bought with tokens when we hold none (player decision 2026-11-16: the Concord
            // Mace first – a paladin's mace beats the fireblade +7 already at +4).
            buy: [], // concordmace paused 2026-11-16 (no paladin; shop +9 first)
            // Token weapons are not cheap to lose: each step needs this chance.
            minChance: { concordmace: 0.5 },   // = risk.rare
        },
        // Gear goals (approved 2026-11-15): when idle, the merchant pushes the fighters' worn
        // shop armor and selected weapons to `upTo`. Shop armor is re-buyable, so every
        // attempt is made whatever its chance: a failure only costs gold and raises the
        // grace for that level (for every item), a success is a finished piece. The finished
        // copy gets the fighter's stat scroll (str/int/dex) and is delivered; the fighter's
        // guide equips it and the old piece comes back as a base for the next copy.
        // Weapons are not re-buyable: only a spare copy one level below `upTo` is risked,
        // and only once grace has raised its chance to `minChance`.
        // The workshop (wishes, gear goals, grace) never spends below this (player
        // decision 2026-11-16, together with the income-based gear-goal budget).
        keepGold: 5000000,
        gearGoals: {
            enabled: true,
            // Since 2026-11-15 (player request): don't let armor and weapons wait while the guide
            // works on accessories – worn shop armor and shop weapons go to +7 (the end of the
            // guide's lessons) in parallel, with the class's main stat. Weapons come first,
            // armor follows once no weapon step is open (player request 2026-11-15).
            fromLevel: 0,
            // Shop weapons to +8 (gear plan, player decision 2026-11-19) - only while no better
            // weapon is worn: a Fiery Blade +7 already beats a Blade +8, so it counts as done.
            upTo: 8,                  // weapons and the "shop gear done" mark for class wishes
            // Armor in stages (player decision 2026-11-16): ALL of a fighter's shop armor
            // reaches a stage before any piece goes on to the next. From +7 each level adds
            // +3 main stat. Guide estimate per piece from scratch: +8 ~170 copies / 1.1M,
            // +9 ~2400 copies / 17M, +10 ~100,000 copies / 770M. Capped at +8 (player
            // decision 2026-11-16: 170 -> 2400 copies is too steep; armor boxes / Rugged next).
            stages: [7, 8],
            everyMs: 3 * 60 * 1000,   // one gear-goal step this often even while wishes are open
            // offhand: a second shop weapon (dual wield) goes to upTo too, so a fresh warrior
            // reaches the Wooden Axe wish (both hands +7); shields, books, quivers stay out.
            slots: ["helmet", "chest", "pants", "shoes", "gloves", "mainhand", "offhand"],
            weapons: [], // fire weapons: workshop.bruteForce (weapon ladder) since 2026-11-16
            // Daily budget from income (player decision 2026-11-15): a share of the merchant's
            // net gold gain over the last 24 h; the gear goals' own spending is not counted
            // as a loss. Gold moved by hand (a jump of transferAbove or more within 10 min)
            // is not income. No fixed total since 2026-11-16 (player decision): long-term
            // positive cash flow, with workshop.keepGold as the floor. `total` (optional)
            // would cap everything ever spent on gear goals.
            budget: {
                incomeShare: 0.5, transferAbove: 3000000,
                // Player decisions 2026-11-17: 10M more for 12 h at 08:45, another 10M at 12:23 (the
                // budget ran out on the Rugged pants/shoes). The extra counts against the last 24 h of
                // spending, so the total grows: 30M until 2026-11-18 00:23 UTC.
                // Ends with the reset at 22:00 German time (player decision 2026-11-17), so the reset
                // does not hand out a fresh 30M.
                extra: { amount: 30000000, until: "2026-11-17T21:00:00Z" },
                // One-time fresh start of every pot (gear goals, weapon ladder, grace): from this
                // time on, spending and gold samples before it are ignored, so no pot starts in
                // the minus – the income since then fills them again. May lie in the future;
                // once 24 h have passed it has no effect any more. null = none.
                resetAt: "2026-11-17T21:00:00Z", // player decision 2026-11-17: fresh start at 22:00 German time
            },
        },
        // Fixed wishes on top of the guide's. Items without a shop are bought with tokens
        // (Monster Tokens at Daisy). Steps below the risk tier are not attempted: the copy
        // is delivered at the level reached and the fighter's guide decides whether to wear it.
        // e.g. DmpxPala: [{ name: "concordmace", level: 4 }]
        wishes: {},
        compound: {
            auto: true,   // combine spare accessories/books when no wish is open
            autoUpTo: 3,  // ...up to this level (each step still needs the risk tier's chance)
            // Copies held back from auto compounding ("name:level": count). DEX belts +2 are the
            // ranger's belt and the base of the rogue's Knife Belt (2026-11-18): a try at +3 only
            // with five spare ones.
            keep: { "dexbelt:2": 2 },
        },
        // Exchange (approved 2026-11-15: everything except seasonal items).
        exchange: {
            enabled: true,
            // armor boxes stopped 2026-11-15 (their rewards only filled the bank);
            // leather (40 -> mostly a Cape) added 2026-11-16 for the cape class wish
            items: ["gem0", "gem1", "seashell", "leather"],
            // Opened only when a wished item comes out of them (Rugged armor), a few at a
            // time and only while the bank has room for the other rewards (2026-11-16).
            onDemand: ["armorbox"], onDemandBatch: 3, onDemandBankFree: 10,
            // Hoarded, not exchanged or opened (player decision 2026-11-17: collect gems and
            // boxes from CGoo, then exchange, open and upgrade in one big batch). Empty the
            // list for the big batch.
            // armorbox off the list 2026-11-18 (player decision): the boxes open on demand again
            // for the warrior's Rugged pants1/shoes1 +7.
            hold: ["gem0", "gem1", "marketparcel"], // + Merrit's parcels (collected first, 2026-11-17)
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },

    // Merchant role
    merchantRole: {
        // The merchant's own wish list (player decision 2026-11-17): things he needs himself,
        // made the same ways as the fighters' wishes - bought (stand at Divian), crafted at Leo
        // (Fishing Rod, Pickaxe: shop staff/blade + Spider Silk), and a missing drop ingredient
        // is reported as a shortage, so a fighter farms it (spiders). Kept in his bag, never
        // delivered, sold or banked; a broken tool (1% per catch) is simply wished again.
        // Cheap and needed early: they come before the fighters' wishes and only keep the
        // potion reserve, not workshop.keepGold.
        ownWishes: [
            { name: "stand0" },       // market stand (buy orders, Merrit's parcels)
            { name: "rod" },          // fishing: Rugged pieces
            { name: "pickaxe" },      // mining (later: the Mining Tunnel has moles)
        ],
        // Gathering with the merchant's own tools, whenever its cooldown is over.
        gather: {
            // Mainland pier by the fisherman: water within 24 px (server). One catch per
            // 48 min (10% per cast), 99.5% a Rugged piece.
            fishing: { enabled: true, spot: { map: "main", x: -1560, y: 470 }, maxCasts: 40 },
            mining: { enabled: false },
        },
        // Market stand (player decision 2026-11-17): with a Merchant Stand (stand0, bought by
        // hand) the merchant's home is a spot on the town square with the stand open - buy
        // orders for what we want, and Merrit's hourly Market Parcel for keeping a shop there
        // two minutes. From there upgrade, compound, Xyn, Lucas and the potion shop are within
        // the server's 400 px, so he only closes the stand for the bank, deliveries and crafts.
        // Square: x -240..240, y -120..144; 40+ px from fixed NPCs (Merrit's rules).
        stand: {
            enabled: true,
            home: { x: -120, y: -112 },
            reach: 390,               // NPCs this close are used without walking (server: 400)
            // Buy and sell orders: config.market at the top.
        },
        // Potion stock: potions.target per fighter using a size (at most stockPerPotion),
        // only built while we have stockFromGold – below that, gold goes to equipment
        // first and deliveries buy just what is needed.
        stockPerPotion: 1000,
        stockFromGold: 100000,
        goldReserve: { ratio: 0.2, min: 0, max: 1000000 }, // never spend below 20% of our gold (max 1M)
        handoverWaitMs: 10000,               // wait next to the fighter for its loot
        // A pickup follows the fighter (its newest position) and re-routes once it moved more
        // than retargetPx away; gives up after followMs (player decision 2026-11-17).
        followMs: 4 * 60 * 1000,
        retargetPx: 150,
        // Items the merchant sells to NPCs.
        // A plain name sells only +0 copies. { name, maxLevel } also sells
        // upgraded copies up to that level. Shiny and locked items are never sold.
        // Anything an NPC shop sells is not worth storing at +0: sell it (approved
        // 2026-11-15). Consumables and scrolls are excluded; upgraded copies are kept.
        sellBuyable: {
            enabled: true,
            maxLevel: 0,
            exceptTypes: ["pot", "uscroll", "cscroll", "pscroll", "offering", "stand", "elixir", "booster", "tome", "qubics"],
        },
        // Phoenix and event weapons are never on this list – they can't be bought again.
        sellList: [
            // junk drops. Craft ingredients (spores, crab claws, frog tongues, ascale,
            // bear fur, white eggs, carrots, vit scrolls) are kept since the
            // fresh start (2026-11-15): Cole and Leo craft gear from them.
            "slimestaff", "mushroomstaff",
            { name: "stinger", maxLevel: 2 }, // +3 and up are rogue daggers now (2026-11-18)
            // Wanderer's set no longer sold (gear plan 2026-11-19): it replaces shop armor (phase 2).
            // +0 weapons (approved 2026-11-15). Phoenix weapons (fireblade, firestaff,
            // firebow) are never sold – player decision 2026-11-15.
            // "dagger" kept since 2026-11-19 (player decision: no investment, but not sold either)
            "snowball",
            // V1 upgraded short swords to +4 – no longer needed (approved 2026-11-15)
            // Short Swords are no longer sold (2026-11-19): the base of the Sword of the Dead.
            // the Paladin's old starter gear (approved 2026-11-15).
            // Accessories (rings, belts, amulets, earrings) and books are NOT sold:
            // they are compound/upgrade material the progression guide asks for –
            // except the HP/VIT ones no class or guide wants (approved 2026-11-16; any
            // level: compounding them first loses gold on average). Worn copies stay.
            { name: "hpamulet", maxLevel: 10 },
            { name: "vitearring", maxLevel: 10 },
            { name: "vitring", maxLevel: 10 },  // STR beats VIT for the warrior too (player decision 2026-11-16)
            { name: "hpbelt", maxLevel: 10 },   // stat belts replace them (2026-11-19); a worn copy stays
            { name: "helmet", maxLevel: 3 },
            // Shop weapons and the old quiver that did their job (player decision 2026-11-16):
            // fire weapons replaced them, the ranger wears a quiver +8. A copy a fighter or
            // its guide wishes for is never sold (isReserved).
            { name: "mace", maxLevel: 7 },
            { name: "staff", maxLevel: 7 },
            { name: "blade", maxLevel: 5 },
            { name: "quiver", maxLevel: 2 },
            // Materials without a plan (player decision 2026-11-16). Kept on purpose: green
            // slime, ashleaf (Thistle Quiver), bat wings, spores (Oathplate), reef glass,
            // carrots (Carrot Sword).
            // Snake Fangs are no longer sold (2026-11-17): a player buys them for 3M each.
            "embercoal", "rattail", "smush",
            "cclaw",   // Crab Claw (fist weapon, 12 attack) - player decision 2026-11-17
            "vitscroll", "lspores", // VIT stat scrolls (we use STR/INT/DEX; the shop sells them), Large Spores - 2026-11-17
            // Rugged and Heavy armor (armor boxes) are no longer sold since the fresh start:
            // craft bases (Oathplate, Resolute Sallet, class boots) and upgrades (2026-11-16).
        ],
        // Items the merchant hands to a fighter on its next delivery (one-off gifts).
        give: {
        },
        // Every fighter gets one of these if it carries none; the merchant keeps one too.
        // Tracktrix: monster achievement bonuses only apply while it is carried.
        onePerCharacter: ["tracker"],
        // Skill ingredients go to the class that uses them on every delivery.
        classItems: { priest: ["essenceoflife"], ranger: ["poison"] },
        // Bank: when the bag runs low on space, everything that is neither sold
        // nor kept below goes into the bank (auto placement, stacks merge).
        // New bank packs are never bought automatically.
        bank: {
            whenFreeBelow: 6,
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
