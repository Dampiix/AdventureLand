// =====================================================================
// bot_fighter (combat/fighter.js) – the main loop for every non-merchant character: the tick. Its work is in the
// parts (module plan, stage 5) - see PARTS below; the parts share one internal state (ftr).
//
// Each tick:
//   1. dead?              -> respawn
//   2. class survival     -> e.g. Paladin self-heal; else potions
//   3. loot
//   4. party management   -> invites / accept / leave wrong party
//   4b. gear              -> send equipment wishes, equip upgrades
//   4c. Cavalry           -> cavalryTick: walk to a grown pack and call it
//   4d. rage zones        -> leaveRageZone (out of a failing zone), then
//                            keepClearOfZones (out to travel.rageMargin);
//                            path walks treat rage boxes as walls
//   5. supply             -> merchant handover / pickup / self-resupply
//   5a. events            -> join events, travel to / search world bosses
//   5b. hunts             -> Daisy trips, turn in / take Monster Hunts
//   6. formation          -> members follow the leader (party.keepUp) and
//                            the leader waits for the team (busyStep)
//   6b. kiting            -> kiteStep keeps us off monsters we can outrun
//   6c. toHealer          -> a hurt member walks into the healer's range;
//                            coverMembers: a healer leader stays with a
//                            member under attack
//   7. class support      -> e.g. Priest heals, Mage energizes
//   8. combat             -> pick target, class skills, basic attack, move
//                            (kiting / party spacing)
//
// Class modules provide: name, survive(), support(), fight(target), and
// optionally move(target) – called while walking (target null on a route);
// true means it moved us itself this tick (e.g. Warrior Dash).
// survive/support return true when they used the action for this tick;
// fight returns true when the basic attack should be skipped.
// =====================================================================

const game = require("../lib/game.js");
const createTravel = require("../travel/travel.js");
const createRageWalls = require("../travel/rage-walls.js");
const PARTS = [
    require("../combat/meters.js"),
    require("../combat/death.js"),
    require("../combat/potions.js"),
    require("../combat/movement.js"),
    require("../combat/kiting.js"),
    require("../combat/passing.js"),
    require("../combat/combat.js"),
    require("../combat/cavalry.js"),
    require("../combat/strike-loop.js"),
    require("../combat/chests.js"),
    require("../team/formation.js"),
    require("../events/giga-crab.js"),
];

module.exports = function createFighter(ctx, cls) {
    // Outside dependencies of the parts (module plan, stage 5): read when used, as the old code read ctx.
    const deps = {
        game: game, cls: cls,
        get util() { return ctx.util; }, get config() { return ctx.config; }, get comms() { return ctx.comms; }, get bus() { return ctx.bus; },
        get party() { return ctx.party; }, get targeting() { return ctx.targeting; }, get supply() { return ctx.supply; },
        get events() { return ctx.events; }, get cave() { return ctx.cave; }, get hunts() { return ctx.hunts; }, get gear() { return ctx.gear; },
        get teamStats() { return ctx.teamStats; }, get teamView() { return ctx.teamView; },
    };
    // The internal state shared by the parts; they put their functions here too (the tick's as well).
    const ftr = { tick: tick, busyStep: busyStep, loop: loop };
    PARTS.forEach(function (install) { install(ftr, deps); });

    // ---- state, start-up and the tick, in the old order (the parts' functions are all there already, as the hoisted
    // functions were) ----
    const config = ctx.config;
    const util = ctx.util;
    const targeting = ctx.targeting;
    const supply = ctx.supply;
    const party = ctx.party;

    ftr.running = false;
    ftr.lastRespawnTry = 0;
    ftr.lastFarm = null;   // remembered for the leader broadcast while busy
    ftr.lastTarget = null;

    // A priest with an Essence of Life is on its way: don't respawn in town meanwhile.
    ftr.reviveWaitUntil = 0;
    ctx.comms.on("revive_wait", function () { ftr.reviveWaitUntil = Date.now() + 30 * 1000; });

    // Death analysis (2026-11-18: three deaths at level-1 bats the pack check called harmless):
    // the hits we took in the last 10 s (attacker, level, damage) and the potions drunk then go
    // to the log when we die. One socket listener for the page (reloads would stack them).
    const HIT_LOG_MS = 10 * 1000;
    // The listener lives on the game page and outlasts a bot reload: it holds the page window
    // itself (the old CODE frame's "parent" is null after a reload - every hit threw and the
    // log filled with "{}", 2026-11-18), and each load swaps the previous listener for its own.
    const PAGE = parent;
    try {
        PAGE.__botHits = PAGE.__botHits || [];
        game.onSocket("hit", "Hit", function (d) {
            try {
                if (!d || !d.damage || !PAGE.character || d.id !== PAGE.character.id) return;
                const a = PAGE.entities && PAGE.entities[d.hid];
                PAGE.__botHits.push({ t: Date.now(), dmg: d.damage, who: a ? a.mtype + " L" + (a.level || 1) : String(d.hid || "?") });
                util.noteHitTaken(d, a); // learned hit factor for the safety checks (2026-11-22)
                while (PAGE.__botHits.length && Date.now() - PAGE.__botHits[0].t > HIT_LOG_MS) PAGE.__botHits.shift();
            } catch (e) { /* analysis only */ }
        });
    } catch (e) { /* no socket */ }
    // Damage meter (player request 2026-11-19): real damage per second from the game's "hit"
    // events - ours, and on the leader every party member's it sees. Logged every
    // config.meter.everyMs, "/dps" prints it now. Listener swapped on each load like the one above.
    const meterCfg = config.meter || {};
    try {
        PAGE.__botDps = PAGE.__botDps || [];
        game.onSocket("hit", "Dps", function (d) {
            try {
                if (!d || !d.damage || !PAGE.entities || !d.hid) return;
                const target = PAGE.entities[d.id];
                if (!target || target.type !== "monster") return; // damage on monsters only (no heals, no hits on us)
                PAGE.__botDps.push({ t: Date.now(), who: String(d.hid), dmg: d.damage, kill: !!d.kill });
                const keep = (meterCfg.windowMs || 5 * 60 * 1000) + 5000;
                while (PAGE.__botDps.length && Date.now() - PAGE.__botDps[0].t > keep) PAGE.__botDps.shift();
            } catch (e) { /* meter only */ }
        });
    } catch (e) { /* no socket */ }
    ftr.meterStart = Date.now();
    ftr.lastMeterLog = Date.now();
    BOT_DPS_REPORT = function () { ftr.meterReport(true); };
    // Kills by target (2026-11-22, for the luck catch): drops roll with the luck of the character a monster targets
    // when it dies. The game's "death" event carries that luck (luckm) but comes after the client removed the monster,
    // so every tick notes each monster's target (noteTargets) and a death is counted under the last one seen - our
    // members by name, "none" (no target), "others" (another player). Logged with twice the damage meter's
    // interval, "/kills" prints it now.
    PAGE.__botLastTarget = PAGE.__botLastTarget || {};
    try {
        PAGE.__botKills = PAGE.__botKills || [];
        game.onSocket("death", "Death", function (d) {
            try {
                const last = d && PAGE.__botLastTarget && PAGE.__botLastTarget[d.id];
                if (!last) return; // not a monster we saw
                PAGE.__botKills.push({ t: Date.now(), target: last.target, mtype: last.mtype, luckm: d.luckm });
                const keep = (meterCfg.windowMs || 5 * 60 * 1000) * 2 + 5000;
                while (PAGE.__botKills.length && Date.now() - PAGE.__botKills[0].t > keep) PAGE.__botKills.shift();
            } catch (err) { /* statistics only */ }
        });
    } catch (e) { /* no socket */ }
    ftr.lastKillLog = Date.now();
    BOT_KILLS_REPORT = function () { ftr.killReport(true); };
    ftr.potSamples = []; // { t, hp, mp } potion counts, one per second

    ftr.deathReported = false;
    // HP lost per second over the last ~3 s, as a share of max HP.
    ftr.hpTrail = [];
    ftr.lastDangerLog = 0;

    // Path walks (travel/travel.js) and the rage zones (travel/rage-walls.js, which also wraps this frame's can_move and
    // smart_move) - stage 3b of the module plan; the names below are the ones the tick always used.
    ftr.walks = createTravel({ game: game, util: util, config: config, party: party, targeting: targeting, cls: cls });
    ftr.travel = ftr.walks.travel, ftr.viaFor = ftr.walks.viaFor, ftr.goalFor = ftr.walks.goalFor, ftr.endSearchWalk = ftr.walks.endSearchWalk;
    const rage = createRageWalls({ game: game, util: util, config: config, party: party, targeting: targeting,
        moveTo: ftr.moveTo, stopOnPurpose: ftr.walks.stopOnPurpose });
    const leaveRageZone = rage.leaveRageZone, keepClearOfZones = rage.keepClearOfZones;
    ftr.holdRingStep = rage.holdRingStep;

    // Solo recovery (config.combat.recover): after a fight that left us low, no new pull
    // until the potions brought HP and MP back up. Monsters already on us are fought.
    ftr.recovering = false;
    ftr.restSince = 0;

    ftr.topUpSince = 0;

    // Walk to a point; a new order only when standing or the point moved 40+ px.
    ftr.moveDest = null;

    // Kiting (config.combat.kite), after earthiverse's KiteMoveStrategy (player decision 2026-11-21):
    // we stand on a circle around the monster at the kite distance - its charge speed + its range +
    // extra px, at most our own range - and keep the angle we stand at. The point taken is the one on
    // that circle closest to our current direction (turning left/right in small steps) with room 25 %
    // farther out (no corners). Inside the circle we step out to it; at or beyond it we stay put - no
    // pendulum next to a monster that stands still (2026-11-21: priest and ranger swung between two
    // points). Only for attackers on us that we outrange and about outrun (charge counts), not for
    // ones that die before they reach us. Attacks and heals go on while we walk.
    ftr.lastKite = 0;
    ftr.escape = null; // { x, y, until }: a way out of a corner we are walking
    // Party spacing (player request 2026-11-18): with a tank class near, ranged fighters stay out of
    // the melee reach of the monsters around - priest, ranger and warrior stood on one spot at the
    // booboos and some went for the ranged ones. Monsters reaching farther than we shoot (booboos,
    // 420) can't be outranged: from those we keep party.spacing.gap px, so the tank in melee is the
    // one closest to them. We stay in range of our target.
    ftr.lastSpace = 0;
    ftr.spaceGoal = null; // { x, y, at }: the spacing point we are walking to

    // Stacking guard (earthiverse's AvoidStackingStrategy, player request 2026-11-21): a hit on us
    // that the server marks as "stacked" (we stand on top of another player) moves us up to 25 px
    // aside - looks better, no game advantage. Not while we walk, at most every 250 ms. The listener
    // lives on the game page and is swapped on each code load.
    ftr.lastUnstack = 0;
    try {
        game.onSocket("hit", "Unstack", function (data) { try { ftr.unstack(data); } catch (e) { /* cosmetic only */ } });
    } catch (e) { /* no socket */ }

    ftr.passing = null; // { until, dest } while we pass through attackers on the way
    // Leave a fight with another kind than the farm target (player request 2026-11-19): after
    // combat.passThrough.leaveAfterMs of such fighting we walk out towards the target - the
    // warrior stood in the mummies' rage zone, they kept pulling him and the team never left
    // for the new spot. Every fighter (members too), any speed, any HP; a 5 s pause starts over.
    ftr.offSince = 0, ftr.offSeen = 0, ftr.leaveLogged = 0;

    // Cavalry (Tracktrix, interact("cavalry"); player decision 2026-11-18). Below account level 80
    // the four sentries fight up to 24 level-3+ monsters within 320 px for 90 s, and those they hit
    // respawn at level 1. One call per ~10 min + 1 min per level, shared by the whole account.
    //   emergency: any fighter low on HP with level-3+ monsters on it
    //   reset:     the one who picks the spot (leader, solo, farming on its own) at its farm target
    //              when several of them in reach have grown (resetFromLevel)
    ftr.cavTryAt = 0;
    ftr.cavBlocked = { why: "", at: 0 };
    ftr.cavWalk = null, ftr.cavWalkLog = 0;

    // ---- strike loop (player decision 2026-11-20, idea from earthiverse's bot) ------
    // Attacks and heals fire the moment the cooldown ends instead of on the next 250 ms tick
    // (on average ~125 ms lost per swing, 15-25 % of damage and heals). The tick decides WHAT
    // to hit (strike.attack / strike.heal set an intent for ~700 ms); this loop decides WHEN.
    // After each strike the local cooldown is shortened by our ping (reduce_cooldown).
    ftr.strikeIntent = null; // { kind: "attack"|"heal", id|name, at, after }
    ftr.strike = {
        // Hit this monster as soon as the cooldown allows; `after` runs once per swing sent.
        attack: function (target, after) {
            if (!target) return;
            ftr.strikeIntent = { kind: "attack", id: target.id, at: Date.now(), after: after || null };
            ftr.fire();
        },
        // A multi-target skill on the attack cooldown (ranger 3-Shot): replaces the basic attack.
        skill: function (name, targets) {
            if (!targets || !targets.length) return;
            ftr.strikeIntent = { kind: "skill", name: name, ids: targets.map(function (t) { return t.id; }), at: Date.now() };
            ftr.fire();
        },
        heal: function (entity) {
            if (!entity) return;
            ftr.strikeIntent = { kind: "heal", name: entity === character ? character.name : entity.name, at: Date.now() };
            ftr.fire();
        },
    };
    ctx.strike = ftr.strike;

    // ---- chest opener (player decision 2026-11-20) ---------------------------------
    // A party chest's gold uses the OPENER's gold multiplier for everyone (game guide: opener
    // within 400 px, within 8 min). So the fighter with the highest gold bonus opens them; the
    // others leave a chest to it - unless it is dead, out of sight or farther than awayRange
    // from the chest (its bonus would not count anyway), or the chest has waited fallbackMs.
    // The game's own loot() opens every chest on the map, whoever is first.
    ftr.goldOf = {}; // fighter -> { g, at } gold multipliers the others reported
    ftr.lastGoldSend = 0, ftr.lastLootAt = 0, ftr.lastOpenerSend = 0, ftr.lastOpenerSent = "";
    ftr.leaderOpener = null; // { name, at } - the leader's choice (members follow it)
    ftr.openerSource = null; // "view" | "msg" | "own": where a member's opener choice came from last (step 5, journal)
    ftr.lastStuckLog = 0;
    ftr.chestSeen = {}; // chest id -> first time we saw it
    // The members' luck multipliers ride along (v1.227.5): the leader's drop estimate weighs each member's own luck
    // (drops.luckFactor - party drop rolls use the luck of the monster's target and of every contributor).
    const luckOf = {}; // fighter -> { l, at }
    // Live from the team view (step 5, 2026-11-25): a member in our client on our server counts with its luck now (the
    // report is up to 30 s old - the priest's luck swap changes it at once); the others by their report.
    ctx.bus.provide("memberLuck", function () {
        const out = Object.assign({}, luckOf);
        ((config.team && config.team.fighters) || []).forEach(function (n) {
            if (n === character.name) return;
            const l = ftr.liveMult(n, "luckm");
            if (l !== null) out[n] = { l: l, at: Date.now() };
        });
        return out;
    }); // read by drops
    ctx.comms.on("goldm", function (data, from) {
        if (!data || typeof data.g !== "number" || !((config.team && config.team.fighters) || []).includes(from)) return;
        ftr.goldOf[from] = { g: data.g, at: Date.now() };
        if (typeof data.l === "number") luckOf[from] = { l: data.l, at: Date.now() };
    });
    // One decision for the whole team (2026-11-20): every fighter choosing on its own from
    // reports up to a minute old disagreed when a gold bonus changed - the priest saw another
    // opener, the others saw the priest, and the bees' chests piled up until fallbackMs.
    ctx.comms.on("opener", function (data, from) {
        if (from !== config.leader || !data || !data.name) return;
        ftr.leaderOpener = { name: data.name, at: Date.now() };
    });

    // Leader: wait for fighters far behind (player request 2026-11-18: the priest walked into the
    // farm spot while warrior and ranger were still on the way). Only while nothing attacks us;
    // members farming on their own (damage return) and dead ones are not waited for; after
    // party.waitMaxMs we go on anyway (a stuck member must not stop the team).
    ftr.teamWaitSince = 0;
    // The wait's "wait VizRng" stayed on screen after it ended: walks that run on their own (the
    // boss search) set their status only once per spot (2026-11-20).
    ftr.waitShown = false;
    ftr.teamWaitAt = 0; // on the bus for events (a walk stopped by the team wait is no failed boss-search try)
    ctx.bus.provide("teamWaitAt", function () { return ftr.teamWaitAt; });

    // A member below party.toHealerBelow HP walks into the healer's range (player decision 2026-11-21,
    // from earthiverse): with the members walking ahead on their own, one may end up out of reach.
    ftr.toHealerAt = 0;
    // ---- Giga Crab on us (events.foreignRules[type].flee, 2026-11-24, player decision) ------------------------------
    // It only takes one of us when our hit lands just after its foreign holder lost it. Then we step fleeStep px away
    // from it every tick (the free direction closest to straight away), the mage by Blink, and fight nothing meanwhile.
    ftr.gigaLogAt = 0, ftr.gigaMoveAt = 0;

    let journalMap = null; // map changes go into the decision journal (util.journal, 2026-11-21)
    function tick() {
        if (character.map !== journalMap) {
            if (journalMap !== null) util.journal("[map] " + journalMap + " -> " + character.map);
            journalMap = character.map;
        }
        // Cave of Many Dreams, manual mode (bot_cave, v1.231.0, player decision 2026-11-24): no respawn of our own (Nera
        // at the doorway is free, in place costs Amber - the player decides), nothing while the cave is paused (votes),
        // no events, supply, Cavalry or zone walks; the farm target is "cave" (targeting: only what the player starts or
        // what attacks the party, never a walk to a spot) - the leader stands still outside fights.
        // /manual (v1.231.1): the same rules outside the cave - the player walks the leader, members follow it.
        const cave = !!(ctx.cave && ctx.cave.active());
        const inCave = cave && ctx.cave.caveManual();
        if (inCave && character.rip) { util.status("dead in the cave - your call (Nera)", "red"); return; }
        if (ftr.handleDeath()) return;
        ftr.samplePotions();
        ftr.noteTargets();
        if (!party.enabled || party.isLeader) { ftr.meterReport(false); ftr.killReport(false); } // the leader sees the whole team
        if (!cls.survive()) ftr.handlePotions();
        if (inCave && ctx.cave.paused()) { util.status("cave paused (vote)", "white"); return; }
        if (cls.always) cls.always(); // every tick, also while a trip keeps the loop busy
        if (!inCave) ftr.lootChests(); // the cave module opens cave chests itself
        party.manage();
        // Leader: share position every tick – also while searching, travelling or at Daisy,
        // so members never lose track (party.broadcast throttles itself).
        party.broadcast(ftr.lastFarm, ftr.lastTarget, cave ? null : ctx.events.current());
        if (ftr.gigaFlee()) return; // a Giga Crab on us: run, nothing else (2026-11-24)
        ctx.gear.tick();
        if (cave) {
            // Members: on the leader's map first - never inside the cave (v1.231.3: a path walk led out of it).
            if (!inCave && party.keepUp(false)) { ftr.defendInPlace(); return; }
        } else {
            if (ftr.cavalryTick() === true) return; // walking to a grown pack for the Cavalry
            if (leaveRageZone()) return; // standing in a rage zone we can't take: out first (2026-11-22)
            if (keepClearOfZones()) return; // standing next to one: on to rageMargin first (2026-11-22)
            if (busyStep()) { ftr.defendInPlace(); return; }
        }
        // Kiting comes before healing and covering (2026-11-21): the priest alone with a Phoenix
        // healed itself every tick (cls.support ends the tick) and never stepped back - the Phoenix
        // stood 13 px off and hit it all along. Heals and attacks still fire while we walk; the
        // kite step in handleCombat is throttled and does not move twice.
        const aimed = get_targeted_monster();
        // Passing through (2026-11-22, player report): on a spot change with 1-2 slow monsters on us, the kite step
        // cut the walk to the new spot every time the monster came near - a step, a wait, a step, for 60 s and more
        // (the priest alone in desertland while the others were at the Phoenix in the cave). Once we pass through,
        // there are no kite steps: we outrun them, heals and attacks in range go on. The decision is made here too,
        // because a healing priest ends most ticks in cls.support and never reaches handleCombat.
        if (!cave && ftr.lastFarm && !(ftr.passing && Date.now() < ftr.passing.until)) {
            const on = aimed && !aimed.dead ? aimed : util.attackersOnMe()[0];
            if (on && ftr.passThrough(ftr.lastFarm, on)) ftr.startPassing(ftr.lastFarm);
        }
        const passingNow = !cave && !!ftr.passing && Date.now() < ftr.passing.until;
        const kited = !passingNow && ftr.kiteStep(aimed && !aimed.dead ? aimed : null);
        if (!kited && ftr.toHealer()) return;
        const covering = !kited && ftr.coverMembers();
        if (cls.support()) {
            // Healing while passing through: keep walking (a priest healing the warrior every tick
            // never got to travel on - 2026-11-19).
            if (!covering && ftr.passing && Date.now() < ftr.passing.until && !is_moving(character)) ftr.travel(ftr.passing.dest, "passing");
            return;
        }
        if (covering) return;
        ftr.handleCombat();
    }

    // True while something else than the fight decides where we go this tick.
    function busyStep() {
        // The merchant's boss-search plan goes out every tick (v1.220.4): the team wait and supply trips skip events.tick().
        if (ctx.events.publishScoutPlan) { try { ctx.events.publishScoutPlan(); } catch (e) { /* plan only */ } }
        if (ftr.waitForTeam()) return true;
        if (supply.tick() === "busy") return true;
        if (ctx.events.tick() === "busy") return true;
        // No Daisy trips during events or a boss fight (a paused boss too, 2026-11-21); one on its
        // way is stopped.
        // Nor in the Witch's Cipher gathering window (2026-11-23, player decision).
        const cipherOn = !!(ctx.events.cipherActive && ctx.events.cipherActive());
        if (ctx.events.bossBusy() || cipherOn) ctx.hunts.abort();
        else if (!ctx.events.current() && ctx.hunts.tick() === "busy") return true;
        const ev = ctx.events.current();
        if (ev && ev.solo) return false; // runner fighting its solo boss away from the team (events runner)
        // The event's boss in our own sight: fight it, no leash (player decision 2026-11-21: anyone
        // may open on a boss alone, holdForTeam off). The warrior found a Phoenix in the cave at
        // 11:54Z and only watched it until the ranger came - keepUp held it at the sighting point
        // the leader travelled to while the Phoenix moved on. Held bosses (events.holdFor) stay
        // held by targeting; a boss out of sight still means following as before.
        if (ev && ev.monster && !character.rip) {
            const b = get_nearest_monster({ type: ev.monster });
            if (b && !b.dead) return false;
        }
        if (party.keepUp(!!(ev && ev.join))) return true;
        if (party.leaderTravels && party.leaderTravels()) { party.idleFollow(); return true; } // no fights on the way
        return false;
    }

    ftr.coverMoveAt = 0; // team/formation.js coverMembers: last move to a member under attack

    async function loop() {
        ftr.running = true;
        util.log("bot", "fighter started (" + cls.name + (party.enabled ? ", party " + (party.isLeader ? "leader" : "member") : ", solo") + ")", "green");
        ftr.strikeLoop();
        while (ftr.running) {
            try {
                tick();
                util.heartbeat(); // member watchdog (main.js): only after a step went through
            } catch (e) {
                util.log("bot", "tick error: " + util.errReason(e), "red");
            }
            await sleep(config.tickMs);
        }
    }

    return {
        start: function () { loop(); },
        stop: function () { ftr.running = false; },
        // The leader's chest opener choice for its team view entry (step 5).
        opener: function () { return ftr.chooseOpener(); },
    };

};
