// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. a live event / world boss (bot_events)
//   2. members: the leader's farm target - "waiting for the leader" until
//      it is known (no own choice right after a restart)
//   3. an open, safe Monster Hunt of any party fighter (bot_hunts)
//   4. a drop route for an item the merchant is missing (bot_drops; only
//      without a configured farm target)
//   5. the Cavalry plan (reset a too-strong spot / nuke cavalry.targets)
//   6. per-character or global farm setting (config.characters[name].farm,
//      config.targeting.farm; a list: the first one not blocked)
//   7. the game's progression guide (fromProgression: routes safe for the
//      whole team, best XP first)
//   8. config.targeting.fallback
//
// Target choice (pick):
//   all:           a rare monster in sight (targeting.rare) first
//   leader / solo: current target > monster attacking a party member
//                  > nearest free farm monster, after the spot check from
//                    the edge (spotGate)
//   party member:  current target > monster attacking a party member
//                  > own monster when the farm target is easy (party.spread)
//                  > the leader's target – otherwise members never open fights,
//                  so the tank keeps the aggro
//   then the guards: mobbing (no 4th monster on one of us), fear (courage),
//   and bosses held for the team.
// Safety: team model / live level checks, lone pulls, rage zones (a whole
// spawn comes at once - judged as one pull, failing zones are kept out of).
// =====================================================================

module.exports = function createTargeting(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const party = ctx.party;
    const cfg = config.targeting;
    let farm = null;
    let nextPickAt = 0;
    let huntBlockLogAt = 0; // v1.235.3: a hunt waiting for its blocked spot
    const crowdedUntil = {}; // monster -> timestamp: skip this guide choice until then
    let idleSince = 0;       // on the farm map without a free target since

    // ---- team safety ------------------------------------------------------------
    // The guide judges a route only for the character asking (the leader, usually
    // the tank). It also offers borderline routes as a careful "trial" and only
    // counts them as proven from fights it watched since CODE started – a restart
    // forgets that. So:
    //  - every member reports its "safe" monsters (trials included) and its "sure"
    //    ones (safe and not a mere trial),
    //  - the leader remembers the team's own experience (survives restarts): a
    //    monster farmed for 15+ minutes without anyone dying counts as proven,
    //    a death there wipes that,
    //  - a spot needs everyone's "safe", and everyone's "sure" or our own proof
    //    (config.targeting.avoidTrial).
    const comms = ctx.comms;
    const reports = {};   // member -> { safe, sure, at }
    let lastReport = 0;
    let lastSkipLog = "";

    const PROVEN_MS = 15 * 60 * 1000;
    const EXP_KEY = "bot_farm_experience:" + character.name;
    const experience = (function () { // monster -> { ms, at, bad }
        try { return get(EXP_KEY) || {}; } catch (e) { return {}; }
    })();
    let lastClock = 0;
    let clockMonster = null, clockSince = 0; // farm target the clock watches, and since when
    let lastSave = 0;

    function saveExperience() {
        try { set(EXP_KEY, experience); } catch (e) { /* storage unavailable */ }
    }
    function provenByUs(monster) {
        const e = experience[monster];
        return !!e && e.ms >= PROVEN_MS && Date.now() - e.at < 24 * 60 * 60 * 1000;
    }
    function recentDeath(monster) {
        const e = experience[monster];
        return !!e && !!e.bad && Date.now() - e.bad < 60 * 60 * 1000;
    }

    const deathReported = {}; // fighter -> when it reported its own death (diedAt)
    const pendingDeath = {};  // fighter -> since when the leader sees it dead without a report
    // Leader: count the time spent on the current farm target; a death wipes it.
    function clock() {
        const now = Date.now();
        const dt = lastClock ? Math.min(5000, now - lastClock) : 0;
        lastClock = now;
        if (party.isMember || !farm || !farm.monster || farm.any) return;
        const e = experience[farm.monster] || (experience[farm.monster] = { ms: 0, at: now });
        // Only a death at the farm spot counts: on the farm map with such a monster nearby
        // (a death on the way or at a hunt somewhere else must not mark this monster).
        // Only fresh deaths (2026-11-19): a member still lying dead after the farm target changed
        // closed the NEW spot too (booboos after a mummy death). Every fighter reports its own
        // death with the monster that killed it (fighter.js), so this is only a fallback.
        if (farm.monster !== clockMonster) { clockMonster = farm.monster; clockSince = now; }
        // The fallback waits for the dead fighter's own report (2026-11-22): the warrior killed by a Fire Spirit next to
        // the Giant Scorpions reported "fireroamer", but this check saw a gscorpion within 500 px in the same tick and
        // closed the gscorpion spot for an hour as well. A death with a report (diedAt, killer by damage) is never
        // counted here; one without a report only after 15 s.
        Object.keys(pendingDeath).forEach(function (n) {
            const p = n === character.name ? character : get_player(n);
            if (!p || !p.rip) delete pendingDeath[n];
        });
        const dead = (now - clockSince < 15 * 1000) ? null : [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            if (!p || !p.rip) return false;
            if (deathReported[n] && now - deathReported[n] < 5 * 60 * 1000) return false; // it told us what killed it
            if (!pendingDeath[n]) pendingDeath[n] = now;
            if (now - pendingDeath[n] < 15 * 1000) return false;
            if (farm.map && p.map !== farm.map) return false;
            const m = get_nearest_monster({ type: farm.monster });
            return !!m && Math.hypot(m.x - p.x, m.y - p.y) < 500;
        });
        if (dead) {
            if (!(e.bad && now - e.bad < 60 * 1000)) {
                util.log("target", dead + " died while farming " + farm.monster + " - not counted as safe for an hour", "red");
                experience[farm.monster] = { ms: 0, at: now, bad: now };
                saveExperience();
                nextPickAt = 0;
            }
            return;
        }
        if (farm.map && character.map !== farm.map) return; // still travelling
        const before = e.ms;
        e.ms += dt;
        e.at = now;
        if (before < PROVEN_MS && e.ms >= PROVEN_MS) util.log("target", farm.monster + ": 15 min without deaths - counts as safe for the team", "green");
        if (now - lastSave > 60 * 1000) { lastSave = now; saveExperience(); }
    }

    // A fighter died while its farm target was `monster`: not safe for an hour. Every
    // fighter reports its own death (fighter.js), so a whole-team wipe counts too – the
    // leader's clock() only sees deaths while it is alive itself.
    function diedAt(monster, who) {
        if (who) deathReported[who] = Date.now();
        if (!monster || !G.monsters[monster]) return;
        const now = Date.now();
        const e = experience[monster];
        if (e && e.bad && now - e.bad < 60 * 1000) return; // already noted for this wipe
        util.log("target", who + " died while farming " + monster + " - not counted as safe for an hour", "red");
        experience[monster] = { ms: 0, at: now, bad: now };
        saveExperience();
        nextPickAt = 0;
    }
    function deathAt(monster) {
        const e = experience[monster];
        return (e && e.bad) || 0;
    }

    if (comms) {
        comms.on("died", function (data, from) {
            if (!config.characters[from] || party.isMember) return;
            diedAt(data && data.monster, from);
        });
        comms.on("safe", function (data, from) {
            if (!config.characters[from]) return;
            reports[from] = { listed: data.listed || null, safe: data.safe || data.list || [], sure: data.sure || data.list || [], at: Date.now() };
            // Our current guide spot is not acceptable for this member: pick again right away.
            if (farm && String(farm.source).startsWith("guide") && lastingObjector(farm.monster, null)) nextPickAt = 0;
        });
    }

    // Monsters our own guide calls safe (trials included) and sure (no mere trial),
    // or null when the guide has no route data.
    function ownSafe(advice) {
        const routes = advice && advice.routes;
        if (!Array.isArray(routes)) return null;
        const safe = routes.filter(function (r) { return r && r.safe; });
        return {
            listed: new Set(routes.filter(Boolean).map(function (r) { return r.monster; })),
            safe: new Set(safe.map(function (r) { return r.monster; })),
            sure: new Set(safe.filter(function (r) { return !r.trial || r.proven; }).map(function (r) { return r.monster; })),
        };
    }

    // Monsters the guide doesn't list at all (e.g. goos once we outgrew them) are not
    // "unsafe", just unknown: harmless if every fighter survives 20+ of their hits
    // (team stats from bot_events, the game's damage formula).
    // attack (optional): a live monster's real attack instead of the level-1 value.
    // n (optional, 2026-11-22): how many come at once - above 3 the hits count with the full
    // mobbing multiplier (util.mobbing): nothing is harmless in a mob.
    function harmless(monster, attack, n) {
        const m = G.monsters[monster];
        if (!m || m.cooperative || (m.abilities && Object.keys(m.abilities).length)) return false;
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [util.combatStats()];
        const att = attack || m.attack || 0;
        const mob = (n || 1) > 3 ? util.mobCap(att) : 1;
        return team.every(function (f) {
            // Pure damage ignores armor and resistance (2026-11-22 review: booboos hit "pure" and counted as reduced).
            return f.max_hp >= 20 * att * mob * 1.1 * util.hitMultiplier(f, m.damage_type, m) * util.hitFactor(monster);
        });
    }

    function shareSafe() {
        if (!party.isMember || !comms || Date.now() - lastReport < 60 * 1000) return;
        lastReport = Date.now();
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (own) comms.send(config.leader, "safe", { listed: Array.from(own.listed), safe: Array.from(own.safe), sure: Array.from(own.sure) });
    }

    // ---- team model (config.targeting.teamSafety) -----------------------------------
    // The per-member rule above asks every fighter's guide whether it could farm the
    // monster ALONE – so a tank changes nothing. The team model judges the party like
    // the boss check does, from everyone's stats (members report them every minute)
    // and the game's damage formula:
    //   tank:    survives tankHits volleys of `pull` monsters (pullAggressive for monsters
    //            that attack on sight) and the priests' healing covers that damage per
    //            second (x healCover; potions do the rest)
    //   others:  survive otherHits hits of one monster – the tank's Taunt pulls it off
    // Monsters with special abilities are left to the guide (teamSafety.abilities lists
    // the ones we accept).
    const ts = cfg.teamSafety || {};
    function teamModelOn() {
        return !!ts.enabled && party.enabled && !party.isMember;
    }
    // Aggressive monsters packed tightly (spawn area per monster below ts.denseArea px²)
    // all come at once – e.g. 5 vampire rats in a 150x195 box at the level1 entrance
    // wiped the team in seconds (2026-11-16). Largest such pack on any map, else 0.
    function densePack(monster) {
        let most = 0;
        Object.keys(G.maps).forEach(function (mapName) {
            const map = G.maps[mapName];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== monster || !pack.count) return;
                const boxes = util.spawnBoxes(pack);
                boxes.forEach(function (b) {
                    const area = Math.abs((b[2] - b[0]) * (b[3] - b[1]));
                    if (area / pack.count < (ts.denseArea || 15000)) most = Math.max(most, pack.count);
                });
            });
        });
        return most;
    }

    // HP per second from drinking a potion on every cooldown.
    // Share of the potion cooldowns left for HP potions when we burn mpPerSec mana (plus the
    // attacks' own MP cost) beyond the natural regeneration.
    function hpPotionShare(mpPerSec, me) {
        const cd = ((G.skills.use_mp && G.skills.use_mp.cooldown) || 2000) / 1000;
        const mpName = util.potionNames(config.potions).mp;
        const mpGives = ((G.items[mpName] && G.items[mpName].gives) || []).find(function (x) { return x[0] === "mp"; });
        const perSec = (mpGives ? mpGives[1] : 300) / cd;
        const need = Math.max(0, mpPerSec + (me.mp_cost || character.mp_cost || 0) * (me.frequency || 1) - (character.mp_regen || 0));
        return Math.max(0, 1 - need / Math.max(1, perSec));
    }
    function potionHps() {
        const cd = ((G.skills.use_hp && G.skills.use_hp.cooldown) || 2000) / 1000;
        const potName = util.potionNames(config.potions).hp;
        const potGives = ((G.items[potName] && G.items[potName].gives) || []).find(function (x) { return x[0] === "hp"; });
        return (potGives ? potGives[1] : 200) / cd;
    }

    // `live` (optional): a monster entity – its real attack/frequency (higher levels hit
    // harder) replace the base values from G.monsters.
    // opts.pull: check this many at once (the pack check below) instead of the usual count.
    function teamVerdict(monster, live, opts) {
        const base = G.monsters[monster];
        const m = base && live ? Object.assign({}, base, { attack: live.attack || base.attack, frequency: live.frequency || base.frequency }) : base;
        if (!m || m.cooperative) return { ok: false, why: "no data / cooperative" };
        const odd = Object.keys(m.abilities || {}).filter(function (a) { return !(ts.abilities || []).includes(a); });
        if (odd.length) return { ok: false, why: "abilities: " + odd.join(", ") };
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [util.combatStats()];
        const expected = config.team.fighters.filter(function (f) { return f === character.name || party.inParty(f); }).length;
        if (team.length < expected) return { ok: false, why: "waiting for the team's stats" };
        // No tank class in the party (2026-11-22): whoever pulls - we, the leader - takes the hits in the
        // model instead of refusing every spot ("no tank in the party").
        const tank = team.filter(function (f) { return (ts.tankClasses || []).includes(f.ctype); })
            .sort(function (a, b) { return b.max_hp - a.max_hp; })[0] ||
            team.find(function (f) { return f.name === character.name; }) || team[0];
        if (!tank) return { ok: false, why: "no team stats" };
        const hitOn = function (f) {
            return (m.attack || 0) * 1.1 * util.hitMultiplier(f, m.damage_type, m) * util.hitFactor(monster);
        };
        // Monsters we pull one at a time (isolation) come as one plus a possible add
        // (pullLone) – a level-12 White Wolf failed "5.1 volleys of 3" though we never pull
        // three (2026-11-17). Dense packs still count whole.
        const lonePull = icfg.enabled && joinsFights(m) && !(opts && opts.pull);
        // Passive monsters (aggro and rage below the isolation limits) come one at a time (2026-11-21: the
        // level-26 CGoos, aggro 0.1, failed as "2 at once" by 1 % and the team skipped them all).
        const passive = (m.aggro || 0) < (icfg.minAggro || 0.3) && (m.rage || 0) < (icfg.minRage || 0.3);
        const pull = opts && opts.pull ? opts.pull : (m.aggro || 0) >= 1
            ? Math.max(lonePull ? (ts.pullLone || 2) : (ts.pullAggressive || 3), densePack(monster))
            : passive ? (ts.pullPassive || 1) : (ts.pull || 2);
        // Fear on the tank (2026-11-22, server rule): more of one damage type on it than its courage for that
        // type cuts its attack to 60/40/20 % (members report their courage with their stats).
        const dtype = m.damage_type || "physical";
        const tankCourage = dtype === "pure" ? tank.pcourage : dtype === "magical" ? tank.mcourage : tank.courage;
        const fearOver = typeof tankCourage === "number" ? Math.max(0, pull - tankCourage) : 0;
        const tankFear = util.fearMult(fearOver);
        // Kill time of the whole pull (for the mobbing combo) and of the fight below.
        const teamDps = team.reduce(function (s, f) {
            if ((f.heal || 0) > 0) return s; // a healer's actions are counted as healing above
            return s + (f.attack || 0) * (f === tank ? tankFear : 1) * (f.frequency || 1) * util.hitMultiplier(m, f.damage_type, f);
        }, 0);
        const monsterHp = (live && (live.hp || live.max_hp)) || m.hp || 0;
        // Mobbing (2026-11-22): more than 3 on the tank multiply every hit (util.mobbing) - the
        // volley check with the highest multiplier the fight reaches, the rates with its average.
        const mob = util.mobbing(m.attack, pull, pull * (m.frequency || 1), monsterHp * pull / Math.max(1, teamDps));
        const volley = hitOn(tank) * pull * mob.peak;
        // Healing per second from the party: every fighter with a heal stat (a priest today;
        // no class names - player request 2026-11-17).
        const healing = team.reduce(function (s, f) { return s + ((f.heal || 0) > 0 ? f.heal * (f.frequency || 1) : 0); }, 0);
        // Volleys the tank survives, with what the healers heal between two volleys (none
        // solo): 3 level-1 moles failed "5.9 volleys (need 6)" though the priest heals all
        // along (player idea 2026-11-17).
        const healedPerVolley = healing / (m.frequency || 1);
        const netVolley = volley - healedPerVolley;
        const tankHits = netVolley <= 0 ? Infinity : tank.max_hp / netVolley;
        const mobWhy = (mob.peak > 1 ? ", mobbing up to " + mob.peak.toFixed(1) + "x" : "") + (fearOver ? ", " + tank.name + " scared (attack x" + tankFear + ")" : "");
        if (tankHits < (ts.tankHits || 6)) return { ok: false, why: tank.name + " survives " + tankHits.toFixed(1) + " volleys of " + pull + (healing ? " with healing" : "") + mobWhy + " (need " + (ts.tankHits || 6) + ")" };
        const incoming = hitOn(tank) * pull * mob.avg * (m.frequency || 1);
        if (incoming > healing * (ts.healCover || 1.5)) return { ok: false, why: Math.round(incoming) + " dmg/s on " + tank.name + mobWhy + " vs " + Math.round(healing) + " healing/s" };
        // The whole fight, not only its rate: what heals and potions don't cover is lost for
        // as long as the kill takes (a level-12 White Wolf has 312k HP). Lone pulls
        // (isolation) start with one monster; the volley check above keeps the margin for adds.
        const fightPull = lonePull ? 1 : pull;
        const killSec = monsterHp * fightPull / Math.max(1, teamDps);
        const lost = Math.max(0, hitOn(tank) * fightPull * (fightPull > 3 ? mob.avg : 1) * (m.frequency || 1) - healing - potionHps()) * killSec;
        if (lost > tank.max_hp * (ts.fightHpUse || 0.5)) {
            return { ok: false, why: tank.name + " would lose " + Math.round(lost) + " HP over ~" + Math.round(killSec) + " s (max " + Math.round(tank.max_hp * (ts.fightHpUse || 0.5)) + ")" };
        }
        for (const f of team) {
            if (f === tank) continue;
            const hits = f.max_hp / Math.max(1, hitOn(f));
            if (hits < (ts.otherHits || 3)) return { ok: false, why: f.name + " survives " + hits.toFixed(1) + " hits (need " + (ts.otherHits || 3) + ")" };
        }
        return { ok: true, why: tank.name + " tanks " + pull + " (" + tankHits.toFixed(1) + " volleys, " + Math.round(incoming) + " dmg/s vs " + Math.round(healing) + " healing/s" + mobWhy + ")" };
    }

    // Solo safety of our own (v1.226.8, player decision 2026-11-23): the guide's "safe" knows no kiting - it marked the
    // Huge Crabs unsafe for the mage (240 per hit, but speed 8: they never reach a ranged fighter). Alone (no party) a route
    // the guide calls unsafe is taken when our solo check passes for the level-1 monster: we survive live.ownHits of its hits
    // and the whole fight costs at most live.soloHpUse of our HP - a monster we can kite (util.kiteRisk) hits with the
    // residual risk only. No bosses, no special abilities. targeting.soloOwnCheck false switches it off.
    const soloSafeCache = {};
    function soloRouteSafe(monster) {
        if (party.enabled || cfg.soloOwnCheck === false) return false;
        const c = soloSafeCache[monster];
        if (c && Date.now() - c.at < 60 * 1000) return c.ok;
        const def = G.monsters[monster];
        let ok = false;
        if (def && !def.cooperative && !bossList().includes(monster) && !(def.abilities && Object.keys(def.abilities).length)) {
            const lc = cfg.live || {};
            const me = util.combatStats();
            const kite = util.kiteRisk(def, null, { speed: character.speed, range: character.range });
            const d = util.defenseVs(me, def.damage_type, def);
            const hit = (def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(monster) * kite;
            if (me.max_hp / Math.max(1, hit) >= (lc.ownHits || 6)) {
                const pull = (def.aggro || 0) >= 1 ? Math.max(1, densePack(monster)) : 1;
                let sustain = potionHps() * hpPotionShare(0, me);
                if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5;
                const myDef = util.defenseVs(def, me.damage_type, me);
                const fearMult = util.fearMult(Math.max(0, pull - util.courageOf(def.damage_type || "physical")));
                const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef));
                sustain += myDps * ((character.lifesteal || 0) / 100);
                const killSec = (def.hp || 1) * pull / myDps;
                const freq = def.frequency || 1;
                const mob = util.mobbing(def.attack || 0, pull, pull * freq, killSec);
                const incoming = hit * freq * pull * mob.avg;
                ok = Math.max(0, incoming - sustain) * killSec <= me.max_hp * (lc.soloHpUse || 0.5);
            }
        }
        soloSafeCache[monster] = { at: Date.now(), ok: ok };
        return ok;
    }

    // ---- monster levels ---------------------------------------------------------
    // Monsters nobody attacks gain levels over time (game source: +50% base HP, +100%
    // base XP, +5% attack on growing spawns / +12.5% elsewhere per level, a bit faster).
    // All checks above use level-1 stats, so a monster above config.targeting.live.fromLevel
    // is checked again with its real stats before we pull it: the team model when it is
    // on, else ownCheck (party) or soloCheck (alone). Only while the team stats are missing
    // does its attack rate have to stay within live.waitTolerance of the level-1 monster's.
    // Monsters already on us are always fought.
    const lcfg = cfg.live || {};
    const liveChecked = {}; // entity id -> { level, ok, at }
    const liveLogged = {};  // "type:level" -> last log
    const soloCostById = {}; // entity id -> HP a solo fight against it costs (soloCheck)
    function liveSafe(e) {
        if (!e || (e.level || 1) < (lcfg.fromLevel || 2)) return true;
        const def = G.monsters[e.mtype];
        if (!def || def.cooperative) return true;
        // Bosses are judged by the events boss check with their real level (player decision
        // 2026-11-21): this farm check took a level-8 Dracul for a pack of 2-3 ("VizWar would lose
        // 157636 HP over ~1343 s") while the boss check rightly said 738 damage/s vs 1158 healing/s.
        // Who may open alone is targeting.holdBoss (events.soloOk).
        if (bossList().includes(e.mtype)) return true;
        const now = Date.now();
        const c = liveChecked[e.id];
        if (c && c.level === e.level && now - c.at < 30 * 1000) return c.ok;
        // Harmless even at its real attack (every fighter survives 20+ hits, e.g. a level-7
        // armadillo with 27 attack): no further check.
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [];
        const fighters = team.length ? team : [util.combatStats()];
        const harmlessNow = !(def.abilities && Object.keys(def.abilities).length) && fighters.every(function (f) {
            return f.max_hp >= 20 * (e.attack || def.attack || 0) * 1.1 * util.hitMultiplier(f, def.damage_type, def) * util.hitFactor(e.mtype);
        });
        if (harmlessNow) {
            liveChecked[e.id] = { level: e.level, ok: true, at: now };
            return true;
        }
        const ratioCheck = function (tolerance) {
            const ratio = ((e.attack || def.attack) * (e.frequency || def.frequency || 1)) / Math.max(1, def.attack * (def.frequency || 1));
            return ratio <= tolerance ? { ok: true } : { ok: false, why: "hits " + ratio.toFixed(1) + "x as hard as at level 1" };
        };
        // Members (and solo fighters) pulling their own target: we must survive ownHits of its
        // real hits ourselves (the warrior shrugs off a level-7 CGoo, a priest may not).
        // Kiteable for us (util.kiteRisk): its hits count with the residual risk only (2026-11-21).
        const kite = util.kiteRisk(def, e, { speed: character.speed, range: character.range });
        const ownCheck = function () {
            const me = util.combatStats();
            const d = util.defenseVs(me, def.damage_type, def);
            const hits = me.max_hp / Math.max(1, (e.attack || def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) * kite);
            return hits >= (lcfg.ownHits || 6) ? { ok: true } : { ok: false, why: "I survive " + hits.toFixed(1) + " of its hits (need " + (lcfg.ownHits || 6) + ")" };
        };
        // Alone (no party): the fight must be survivable over its whole length – the
        // monster's real damage per second against what we heal ourselves (a potion per
        // cooldown, a priest's own heals, lifesteal), for as long as it takes us to kill it.
        // A level-12 CGoo (800 attack, 1.6 hits/s) killed the solo warrior though he
        // survives 12 of its single hits (2026-11-16).
        const soloCheck = function () {
            const first = ownCheck();
            if (!first.ok) return first;
            const me = util.combatStats();
            const d = util.defenseVs(me, def.damage_type, def);
            const pull = (def.aggro || 0) >= 1 ? Math.max(1, densePack(e.mtype)) : 1;
            // The MP potions share the cooldown (2026-11-22 review: packVerdict had this fix, soloCheck not).
            let sustain = potionHps() * hpPotionShare(0, me);
            if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5; // half its actions heal
            const myDef = util.defenseVs(def, me.damage_type, me);
            const over = Math.max(0, pull - util.courageOf(def.damage_type || "physical")); // fear (see packVerdict)
            const fearMult = util.fearMult(over);
            const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef));
            sustain += myDps * ((character.lifesteal || 0) / 100);
            const killSec = (e.hp || e.max_hp || def.hp) * pull / myDps;
            // A dense aggressive pack of more than 3 mobs us (2026-11-22): its average multiplier over the fight.
            const freq = e.frequency || def.frequency || 1;
            const mob = util.mobbing(e.attack || def.attack || 0, pull, pull * freq, killSec);
            const incoming = (e.attack || def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) * freq * pull * kite * mob.avg;
            const lost = Math.max(0, incoming - sustain) * killSec;
            const budget = me.max_hp * (lcfg.soloHpUse || 0.5);
            soloCostById[e.id] = lost;
            return lost <= budget ? { ok: true }
                : { ok: false, why: Math.round(incoming) + " dmg/s vs " + Math.round(sustain) + " healed/s for ~" + Math.round(killSec) +
                    " s: I'd lose " + Math.round(lost) + " HP (max " + Math.round(budget) + ")" };
        };
        let v = teamModelOn() ? teamVerdict(e.mtype, e) : (party.enabled ? ownCheck() : soloCheck());
        // Team stats not in yet (right after a restart, or a member was away): the level-1
        // monster passed the team check already, so only a big level jump is refused.
        if (!v.ok && /waiting for the team/.test(v.why || "")) v = ratioCheck(lcfg.waitTolerance || 2.5);
        liveChecked[e.id] = { level: e.level, ok: v.ok, at: now };
        const k = e.mtype + ":" + e.level;
        if (!v.ok && now - (liveLogged[k] || 0) > 10 * 60 * 1000) {
            liveLogged[k] = now;
            util.log("target", "skipping " + e.mtype + " level " + e.level + " (attack " + Math.round(e.attack || 0) + "): " + v.why, "orange");
        }
        return v.ok;
    }
    // Where to walk for a farm target: the spawn pack on its map (guide routes name one),
    // else the biggest pack of that monster anywhere. smart_move("cgoo") picked the nearest
    // spawn, through the vampire rats at the underground entrance, while 32 CGoos wait in
    // the arena right next to town.
    // Spots where other players farm (2026-11-18: the warrior joined the Eagle party at the
    // biggest bat group while three other bat groups were free): skipped for occupiedForMs,
    // and their free monsters are left alone - ones on us are still fought.
    const occupiedUntil = {}; // "map:x:y" -> timestamp
    // Spots the spot check found too strong (2026-11-22): "map:x:y" -> until. Only that spot - a booboo hunt
    // sent the team to the 5-booboo spawn the team can't take while the 4-booboo one is fine.
    const strongSpotUntil = {};
    const noResetUntil = {}; // monster -> no Cavalry reset planned before (reset found nothing grown, v1.227.2)
    let lastSpot = null;
    function spotKey(s) { return s.map + ":" + s.x + ":" + s.y; }
    function strangersNear(p, r) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "character" && !e.npc && !e.rip && !config.characters[e.name] &&
                Math.hypot(e.real_x - p.x, e.real_y - p.y) <= r;
        });
    }
    function occupiedSpots() {
        const now = Date.now();
        return Object.keys(occupiedUntil).filter(function (k) { return occupiedUntil[k] > now; })
            .concat(Object.keys(strongSpotUntil).filter(function (k) { return strongSpotUntil[k] > now; })).map(function (k) {
            const p = k.split(":");
            return { map: p[0], x: Number(p[1]), y: Number(p[2]) };
        });
    }
    function inOccupied(e) {
        const p = util.xy(e);
        const r = cfg.occupiedRadius || 300;
        return occupiedSpots().some(function (s) { return s.map === character.map && Math.hypot(p.x - s.x, p.y - s.y) <= r; });
    }
    const strangerSince = {}; // name -> first seen on our spot (checkOccupied)
    let sharedLogged = "";
    // Busy samples from reportSearch: [time, had a target]. Share of the time with a target over the
    // last windowMs (gaps capped at 5 s) and how much of the window is known.
    const busyLog = [];
    function busyShare(windowMs) {
        const now = Date.now();
        while (busyLog.length && now - busyLog[0][0] > windowMs) busyLog.shift();
        let ms = 0, on = 0;
        for (let i = 1; i < busyLog.length; i++) {
            const dt = Math.min(5000, busyLog[i][0] - busyLog[i - 1][0]);
            ms += dt;
            if (busyLog[i][1]) on += dt;
        }
        return { ms: ms, share: ms > 0 ? on / ms : 0 };
    }
    const emptySince = {}; // occupied spot key -> first time we saw it without other fighters
    // Other players' fighters on a spot (merchants never count).
    function fightersNear(p) {
        return strangersNear(p, cfg.occupiedRadius || 300).filter(function (e) { return e.ctype !== "merchant"; });
    }
    // An occupied spot we stand on with no other fighter on it for occupiedFreeMs is free again
    // (player decision 2026-11-20: the croc spot stayed "taken" long after the player had left,
    // and the detached warrior stood idle among six free crocs until the crowded check fired).
    function releaseFreedSpots() {
        const now = Date.now();
        occupiedSpots().forEach(function (s) {
            const k = spotKey(s);
            if (strongSpotUntil[k] > now) return; // too strong, not taken: it frees up by time only
            const near = character.map === s.map && Math.hypot(character.real_x - s.x, character.real_y - s.y) <= 400;
            if (!near || fightersNear(s).length) { delete emptySince[k]; return; }
            if (!emptySince[k]) emptySince[k] = now;
            if (now - emptySince[k] < (cfg.occupiedFreeMs || 30 * 1000)) return;
            delete occupiedUntil[k];
            delete emptySince[k];
            util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " is free again", "green");
        });
    }
    function checkOccupied() {
        releaseFreedSpots();
        const s = lastSpot;
        // Only the spot of our current farm target (2026-11-20): a spot remembered from an earlier
        // target was marked taken while we stood next to it with the leader, and blocked it later.
        if (!s || !farm || farm.any || s.type !== farm.monster) return;
        if (character.map !== s.map || occupiedUntil[spotKey(s)] > Date.now()) return;
        if (Math.hypot(character.real_x - s.x, character.real_y - s.y) > 400) return; // judged on the spot only
        // Only players who stay: merchants never count, and a fighter must be seen on the spot
        // for occupiedAfterMs (2026-11-18: a merchant walking past blocked the goo spot for 20 min).
        const now = Date.now();
        const here = fightersNear(s);
        Object.keys(strangerSince).forEach(function (n) { if (!here.some(function (e) { return e.name === n; })) delete strangerSince[n]; });
        here.forEach(function (e) { if (!strangerSince[e.name]) strangerSince[e.name] = now; });
        const others = here.filter(function (e) { return now - strangerSince[e.name] >= (cfg.occupiedAfterMs || 20000); });
        if (others.length < (cfg.occupiedBy || 1)) return;
        // Shared, not taken (player decision 2026-11-21): a lone bot farming single giant scorpions
        // left more than enough for us, but the spot counted as taken after 20 s. While we had a target
        // at least stayIfBusy of the last shareWindowMs, we stay; judged once shareMinMs of it is known.
        const busy = busyShare(cfg.shareWindowMs || 2 * 60 * 1000);
        if (cfg.stayIfBusy && busy.ms < (cfg.shareMinMs || 60 * 1000)) return; // not enough known yet
        if (cfg.stayIfBusy && busy.share >= cfg.stayIfBusy) {
            const who = others.map(function (e) { return e.name; }).join(", ");
            if (sharedLogged !== who + "|" + spotKey(s)) {
                sharedLogged = who + "|" + spotKey(s);
                util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " shared with " + who + " - staying, we had a target " + Math.round(busy.share * 100) + "% of the time", "white");
            }
            return;
        }
        sharedLogged = "";
        occupiedUntil[spotKey(s)] = Date.now() + (cfg.occupiedForMs || 20 * 60 * 1000);
        util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " is taken by " + others.map(function (e) { return e.name; }).join(", ") +
            (cfg.stayIfBusy ? " (we had a target " + Math.round(busy.share * 100) + "% of " + Math.round(busy.ms / 1000) + " s, need " + Math.round(cfg.stayIfBusy * 100) + "%)" : "") +
            " - another one for " + Math.round((cfg.occupiedForMs || 20 * 60 * 1000) / 60000) + " min", "orange");
        // Every spot of our farm target taken (2026-11-18: squigtoads have a single spot, bots on
        // it, the rogue stood there on "find"): skip the monster like a crowded one, pick again.
        if (farm && farm.monster && !farm.any && allSpotsTaken(farm.monster)) {
            crowdedUntil[farm.monster] = Date.now() + (cfg.occupiedForMs || 20 * 60 * 1000);
            nextPickAt = 0;
            util.log("target", "every " + farm.monster + " spot is taken - another farm target", "orange");
        }
    }
    // ignoreStrong: only other players count (the Cavalry plan resets too-strong spots).
    function allSpotsTaken(type, ignoreStrong) {
        const now = Date.now();
        let any = false, free = false;
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== type) return;
                const boxes = pack.boundaries ? pack.boundaries : pack.boundary ? [[m].concat(pack.boundary)] : [];
                boxes.forEach(function (b) {
                    any = true;
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) };
                    if (!(occupiedUntil[spotKey(spot)] > now) && (ignoreStrong || !(strongSpotUntil[spotKey(spot)] > now))) free = true;
                });
            });
        });
        return any && !free;
    }
    function spotFor(type, mapName) {
        // The spot a Cavalry reset was planned for (hunt reset, 2026-11-22) - even though it is marked too strong.
        if (cavPlan && cavPlan.spot && cavPlan.monster === type) {
            lastSpot = { map: cavPlan.spot.map, x: cavPlan.spot.x, y: cavPlan.spot.y, type: type };
            return { map: cavPlan.spot.map, x: cavPlan.spot.x, y: cavPlan.spot.y };
        }
        let best = null, bestFree = null;
        const now = Date.now();
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== type) return;
                const boxes = pack.boundaries ? pack.boundaries : pack.boundary ? [[m].concat(pack.boundary)] : [];
                boxes.forEach(function (b) {
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2), count: pack.count || 1 };
                    const score = (mapName && spot.map === mapName ? 1000 : 0) + spot.count;
                    spot.score = score;
                    if (!best || score > best.score) best = spot;
                    if (!(occupiedUntil[spotKey(spot)] > now) && !(strongSpotUntil[spotKey(spot)] > now) && (!bestFree || score > bestFree.score)) bestFree = spot;
                });
            });
        });
        const pickSpot = bestFree || best; // every spot taken: the best one anyway
        if (pickSpot) lastSpot = { map: pickSpot.map, x: pickSpot.x, y: pickSpot.y, type: type };
        return pickSpot ? { map: pickSpot.map, x: pickSpot.x, y: pickSpot.y } : null;
    }

    // ---- lone pulls -------------------------------------------------------------
    // Aggressive monsters attack whoever passes within ~32 px of them, and with rage they
    // stay on that player (game source). So we pull them one at a time: from our range,
    // and only when no other free aggressive monster is near the target, near where we
    // will stand or near the way there (config.targeting.isolation).
    const icfg = cfg.isolation || {};
    // Harmless ones (every fighter survives 20+ of their real hits) don't count: a whole
    // swarm of bees can't hurt us, and waiting for a lone bee left the team idle (2026-11-17).
    const harmlessSeen = {}; // "type:attack" -> { ok, at }
    function joinsFights(def) {
        return (def.aggro || 0) >= (icfg.minAggro || 0.3) && (def.rage || 0) >= (icfg.minRage || 0.3);
    }
    // Can we take a whole pack of them at once (isolation.packOf, default the aggressive pull)?
    // Then lone pulls are pointless - the moles were waited for one by one though the team
    // tanks three easily (2026-11-17). Uses the monster's real level (attack, HP).
    // Party leader: the team model; solo: our own hits and sustain against the pack.
    const packSeen = {}; // "type:level" -> { ok, at }
    const packLogged = {}; // "type:level" -> last log
    function packOk(e) {
        const def = G.monsters[e.mtype];
        const n = Math.max(icfg.packOf || ts.pullAggressive || 3, densePack(e.mtype));
        if (teamModelOn()) {
            const v = teamVerdict(e.mtype, e, { pull: n });
            // Why a pack is too much, once per type and level every 10 min (2026-11-17).
            const lk = e.mtype + ":" + (e.level || 1);
            // Right after a restart the members' stats are not in yet: no verdict, ask again soon.
            if (!v.ok && /waiting for the team/.test(v.why || "")) return null;
            if (!v.ok && Date.now() - (packLogged[lk] || 0) > 10 * 60 * 1000) {
                packLogged[lk] = Date.now();
                util.log("target", e.mtype + " level " + (e.level || 1) + " one at a time - " + n + " at once: " + v.why, "white");
            }
            return v.ok;
        }
        if (party.enabled) return false; // members: the leader decides who is pulled
        const v = packVerdict(e, n);
        const lk = e.mtype + ":" + (e.level || 1);
        if (!v.ok && Date.now() - (packLogged[lk] || 0) > 10 * 60 * 1000) {
            packLogged[lk] = Date.now();
            util.log("target", e.mtype + " level " + (e.level || 1) + " one at a time - " + n + " at once: " + v.why, "white");
        }
        return v.ok;
    }
    // Solo: can we take n of these at once - the burst (ownHits of their combined hits) AND the
    // whole fight: their damage per second (falling as they die, so on average (n+1)/2 of them)
    // against what we heal, for as long as killing all n takes, within live.soloHpUse of max HP.
    // The burst check alone let the warrior walk into the Boo Boo pack (2026-11-17: 10k HP
    // survive three hits easily, but five 8k-HP Boo Boos hit for minutes). Shared with the
    // Agitate decision (a pull is a pack on purpose). { ok, why, lost, killSec }
    // opts.mpPerSec (2026-11-18): mana we burn during the fight (e.g. Agitate) - MP potions
    // share the HP potions' cooldown, so that share of the cooldowns heals nothing. The bats
    // killed the warrior three times while the check counted every cooldown as an HP potion.
    // opts.splash: extra targets each hit also damages (kill time shrinks with the splash).
    function packVerdict(e, n, opts) {
        opts = opts || {};
        const def = G.monsters[e.mtype] || {};
        const me = util.combatStats();
        const d = util.defenseVs(me, def.damage_type, def);
        const att = e.attack || def.attack || 0;
        const freq = e.frequency || def.frequency || 1;
        // Kiteable for us (v1.227.1, util.kiteRisk: slower than us, shorter reach, no abilities): its hits count with the
        // residual risk only, like the solo check - two Huge Crabs (speed 8) standing together blocked the mage's spot
        // ("I survive 5.5 of their combined hits"). Melee fighters and the warrior's pulls are never kiteable (factor 1).
        const hit = att * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) *
            util.kiteRisk(def, e, { speed: character.speed, range: character.range });
        let sustain = potionHps() * hpPotionShare(opts.mpPerSec || 0, me);
        if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5;
        const myDef = util.defenseVs(def, me.damage_type, me);
        // Fear (server.js, 2026-11-22): more attackers of one damage type than our courage for it cut our
        // attack to 60/40/20 % (and our speed by 20/40/70+). 3 booboos (pure courage 2) scared the warrior,
        // the fight took longer and he died. Counted only when the pull itself goes over our courage.
        const over = Math.max(0, n - util.courageOf(def.damage_type || "physical"));
        const fearMult = util.fearMult(over);
        const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef) * (1 + 0.7 * Math.min(opts.splash || 0, Math.max(0, n - 1))));
        sustain += myDps * ((character.lifesteal || 0) / 100);
        const killSec = (e.max_hp || def.hp || 1) * n / myDps;
        // Mobbing (2026-11-22): while more than 3 of them are alive every hit is multiplied (util.mobbing).
        // Those on their way don't hit - opts.hitters caps how many stand on us at once (default all).
        // The burst check uses the highest multiplier the fight reaches; the HP loss the average over
        // the mobbed part of the fight (the first (n-3)/n of it - after that 3 are left).
        const hitters = Math.min(n, opts.hitters || n);
        const mobSec = n > 3 ? killSec * (n - 3) / n : 0;
        const mob = util.mobbing(att, n, hitters * freq, mobSec);
        const mobShare = n > 3 ? (n - 3) / n : 0;
        const hits = me.max_hp / Math.max(1, hit * hitters * mob.peak);
        const mobWhy = mob.peak > 1 ? ", mobbing up to " + mob.peak.toFixed(1) + "x" : "";
        if (hits < (lcfg.ownHits || 6)) return { ok: false, why: "I survive " + hits.toFixed(1) + " of their combined hits" + mobWhy + " (need " + (lcfg.ownHits || 6) + ")" };
        const incoming = hit * freq * Math.min(hitters, (n + 1) / 2) * (mobShare * mob.avg + (1 - mobShare));
        const lost = Math.max(0, incoming - sustain) * killSec;
        const budget = me.max_hp * (lcfg.soloHpUse || 0.5);
        const fearWhy = over ? ", scared (attack x" + fearMult + ")" : "";
        return lost <= budget ? { ok: true, lost: lost, killSec: killSec, mob: mob.peak }
            : { ok: false, lost: lost, killSec: killSec, mob: mob.peak, why: Math.round(incoming) + " dmg/s" + mobWhy + fearWhy + " vs " + Math.round(sustain) + " healed/s for ~" +
                Math.round(killSec) + " s: I'd lose " + Math.round(lost) + " HP (max " + Math.round(budget) + ")" };
    }
    function aggressive(e) {
        const def = e && G.monsters[e.mtype];
        if (!def || !joinsFights(def)) return false;
        const now = Date.now();
        const k = e.mtype + ":" + Math.round(e.attack || def.attack || 0);
        const c = harmlessSeen[k];
        // A dense spawn comes as a whole - harmless only if it stays harmless as a mob (2026-11-22).
        if (!c || now - c.at > 30 * 1000) harmlessSeen[k] = { ok: harmless(e.mtype, e.attack, densePack(e.mtype)), at: now };
        if (harmlessSeen[k].ok) return false;
        const pk = e.mtype + ":" + (e.level || 1);
        const p = packSeen[pk];
        if (!p || now - p.at > 30 * 1000) {
            const r = packOk(e);
            // null = unknown yet (team stats missing): treated as too much, checked again in 5 s
            packSeen[pk] = { ok: r === true, at: r === null ? now - 25 * 1000 : now };
        }
        return !packSeen[pk].ok;
    }
    // Where we stop to hit e: on the line from us to it, at 90% of our range.
    function standPoint(e) {
        const p = util.xy(e);
        const me = util.xy(character);
        const dx = me.x - p.x, dy = me.y - p.y;
        const d = Math.hypot(dx, dy);
        const r = Math.max(10, (character.range || 30) * 0.9);
        if (d <= r) return me;
        return { x: p.x + dx / d * r, y: p.y + dy / d * r };
    }
    function distToSegment(p, a, b) {
        const vx = b.x - a.x, vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
        return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    }
    function crowdAround(e) {
        const r = icfg.radius || 120;
        const at = util.xy(e);
        const me = util.xy(character);
        const stand = standPoint(e);
        return Object.values(parent.entities || {}).filter(function (o) {
            if (!o || o.id === e.id || o.type !== "monster" || o.dead || !o.visible || o.target) return false;
            if (!aggressive(o)) return false;
            const q = util.xy(o);
            return Math.hypot(q.x - at.x, q.y - at.y) < r || distToSegment(q, me, stand) < r;
        }).length;
    }
    function isolated(e) {
        // In a rage zone there is no lone pull (2026-11-22): stepping in brings the whole spawn, so the zone's own
        // verdict decides (rageBlocks) - the priest stood at the booboo zone waiting for a lone one.
        if (rcfg.enabled !== false && zoneAt(util.xy(e))) return true;
        return !icfg.enabled || !aggressive(e) || crowdAround(e) === 0;
    }

    // ---- rage zones (2026-11-22, server.js rage_logic) --------------------------------
    // Some spawns have a rage box (map data "rage"; today the mummies and both booboo spawns in
    // spookytown): every 4.2 s each monster of that spawn takes a player standing in the box as its
    // target, wherever it is and whether we attacked it or not. The warrior picked one booboo that
    // stood alone, walked in and all 5 came (terrified, dead in 7 s) - three times. So a spawn with a
    // rage box counts as a whole: its live members in and around the box (at least its count), judged
    // with the strongest of them by the pack check (mobbing, fear) or the team model.
    //   - no monster of the kind is picked when it, our stand point or the straight way there lies in
    //     a box that fails (nearestSafe);
    //   - standing in such a box we step out (fighter.leaveRageZone).
    const rcfg = cfg.rage || {};
    const zonesByMap = {};
    function rageZones(mapName) {
        if (!zonesByMap[mapName]) {
            const map = G.maps[mapName] || {};
            // travel.wallMonsters (2026-11-22): packs without a rage box that attack on sight count as zones too, with their
            // spawn box - the Vampire Rats in level1 (aggro 1, 9,200 HP, level 20): the ranger walked through them on the way
            // out of Spooky Town and died. Every path walk plans around them (rage walls); farming them stays possible.
            const walls = ((config.travel || {}).wallMonsters) || [];
            zonesByMap[mapName] = [];
            (map.monsters || []).forEach(function (p) {
                if (!G.monsters[p.type]) return;
                if (p.rage) { zonesByMap[mapName].push({ type: p.type, b: p.rage, count: p.count || 1, key: mapName + ":" + p.rage.join(",") }); return; }
                if (!walls.includes(p.type)) return;
                (p.boundary ? [p.boundary] : (p.boundaries || []).filter(function (x) { return !x[4] || x[4] === mapName; }).map(function (x) { return x.length > 4 ? x.slice(0, 4) : x; }))
                    .forEach(function (bx) { if (bx && bx.length >= 4) zonesByMap[mapName].push({ type: p.type, b: bx.slice(0, 4), count: p.count || 1, key: mapName + ":" + bx.slice(0, 4).join(",") }); });
            });
        }
        return zonesByMap[mapName];
    }
    function zoneAt(p, mapName) {
        return rageZones(mapName || character.map).find(function (z) { return boxDist(p, z.b) === 0; }) || null;
    }
    const zoneCache = {}; // key -> { at, ok, why }
    function zoneVerdict(z) {
        const c = zoneCache[z.key];
        if (c && Date.now() - c.at < 10 * 1000) return c;
        const def = G.monsters[z.type];
        const near = [z.b[0] - 200, z.b[1] - 200, z.b[2] + 200, z.b[3] + 200];
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === z.type && !e.dead && boxDist(util.xy(e), near) === 0;
        });
        const n = Math.max(seen.length, z.count);
        const strongest = seen.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0] ||
            { mtype: z.type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 };
        // Members judge with the team model themselves (every fighter has the team's stats since v1.207.0) - trusting
        // "the leader decides" let warrior and ranger walk into the level-17 booboos before the leader looked (2026-11-22).
        // Ahead of the leader (not near): solo pack check.
        const lead = party.enabled && party.isMember && !party.detached() ? party.leaderInfo() : null;
        // Or the leader stands at this zone (2026-11-22): the ranger coming back to the accepted 4-booboo zone was more
        // than 300 px from the leader in its middle, judged it alone ("I survive 2.4 hits") and stepped out again.
        const leaderNear = !!lead && lead.map === character.map && (Math.hypot(lead.x - character.x, lead.y - character.y) <= ((config.party && config.party.leash) || 300) ||
            boxDist({ x: lead.x, y: lead.y }, z.b) <= 150);
        let v = teamModelOn() || leaderNear ? teamVerdict(z.type, strongest, { pull: n }) : packVerdict(strongest, n);
        if (!v.ok && /waiting for the team/.test(v.why || "")) v = { ok: false, why: "team stats not in yet" };
        const r = { at: Date.now(), ok: !!v.ok, why: n + " at once (level " + (strongest.level || 1) + "+)" + (v.ok ? "" : ": " + v.why) };
        zoneCache[z.key] = r;
        return r;
    }
    // Every rage box on a map (for the rage walls): { type, b, key }.
    function rageBoxes(mapName) {
        return rcfg.enabled === false ? [] : rageZones(mapName).map(function (z) { return { type: z.type, b: z.b, key: z.key }; });
    }
    // The failing rage zone within `margin` px of point p (outside or inside) on our map, or null - nobody should stand
    // there: a booboo at the edge reaches ~64 px by contact aggro (2026-11-22: the warrior stood 13 px off the big
    // booboo zone after a "Path not found!" and was taken). { type, b, gap }
    function failingZoneNear(p, margin) {
        if (rcfg.enabled === false) return null;
        let best = null;
        rageZones(character.map).forEach(function (z) {
            const gap = boxDist(p, z.b);
            if (gap >= margin || zoneVerdict(z).ok) return;
            if (!best || gap < best.gap) best = { type: z.type, b: z.b, gap: gap };
        });
        return best;
    }
    // The failing rage zone at point p on our map, or null.
    function failingZoneAt(p) {
        if (rcfg.enabled === false) return null;
        const z = zoneAt(p);
        return z && !zoneVerdict(z).ok ? z : null;
    }
    // The failing rage zone we stand in, or null. { type, b, why }
    function rageZoneHere() {
        if (rcfg.enabled === false) return null;
        const z = zoneAt(util.xy(character));
        if (!z) return null;
        const v = zoneVerdict(z);
        return v.ok ? null : { type: z.type, b: z.b, why: v.why };
    }
    // The failing rage zone that hitting e would take us into (e, our stand point, or the straight way
    // there lies in it), or null.
    const rageLogged = {};
    function rageBlocks(e) {
        if (rcfg.enabled === false) return null;
        const me = util.xy(character), stand = standPoint(e), at = util.xy(e);
        const zones = rageZones(character.map);
        if (!zones.length) return null;
        const hit = zones.find(function (z) {
            if (zoneVerdict(z).ok) return false;
            if (boxDist(at, z.b) === 0 || boxDist(stand, z.b) === 0) return true;
            const steps = Math.ceil(Math.hypot(stand.x - me.x, stand.y - me.y) / 25);
            for (let i = 1; i < steps; i++) {
                if (boxDist({ x: me.x + (stand.x - me.x) * i / steps, y: me.y + (stand.y - me.y) * i / steps }, z.b) === 0) return true;
            }
            return false;
        });
        if (!hit) return null;
        if (Date.now() - (rageLogged[hit.key] || 0) > 2 * 60 * 1000) {
            rageLogged[hit.key] = Date.now();
            util.log("target", "not going into the " + hit.type + " rage zone: " + zoneVerdict(hit).why, "orange");
        }
        return hit;
    }

    // Free monsters of this type that we may hit (damage return, live level check).
    function safeCandidates(type) {
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.mtype !== type || e.dead || !e.visible || e.target) return false;
            if (party.nearLeader && !party.nearLeader(e)) return false; // member: only within the farm radius of the leader
            return !util.tooSpiky(config, e) && liveSafe(e);
        });
    }
    // Nearest of them that stands alone (see isolated).
    function nearestSafe(type) {
        let best = null;
        let bestD = Infinity;
        safeCandidates(type).forEach(function (e) {
            if (!isolated(e)) return;
            if (!e.target && inOccupied(e)) return; // another player's spot
            const d = util.distanceTo(e);
            if (d < bestD && !skipDoomed(e) && !rageBlocks(e)) { bestD = d; best = e; }
        });
        return best;
    }
    // Why none of the farm target's monsters in sight was picked (player request 2026-11-20: the
    // warrior stood idle among free crocs and nothing said why) - once a minute per type.
    const noneLogged = {};
    const noneSeen = {}; // type -> { at, seen, unsafe, taken } of the last explainNone (too-strong spots, 2026-11-21)
    function explainNone(type) {
        const now = Date.now();
        if (now - (noneLogged[type] || 0) < 60 * 1000) return;
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === type && !e.dead && e.visible;
        });
        if (!seen.length) return;
        noneLogged[type] = now;
        let busy = 0, unsafe = 0, notAlone = 0, occupied = 0;
        seen.forEach(function (e) {
            if (e.target) busy++;
            else if (util.tooSpiky(config, e) || !liveSafe(e) || rageBlocks(e)) unsafe++; // a failing rage zone counts as too strong
            else if (!isolated(e)) notAlone++;
            else if (inOccupied(e)) occupied++;
        });
        const parts = [];
        if (busy) parts.push(busy + " already fighting");
        if (unsafe) parts.push(unsafe + " too strong");
        if (notAlone) parts.push(notAlone + " not alone");
        if (occupied) parts.push(occupied + " on another player's spot");
        noneSeen[type] = { at: now, seen: seen.length, unsafe: unsafe, taken: busy + occupied };
        util.log("target", seen.length + " " + type + " in sight, none picked: " + (parts.join(", ") || "no reason found"), "orange");
    }
    // We see monsters of this type but none stands alone: hold position until one does,
    // instead of walking on into the pack (waitForLone below).
    // Where to wait for a lone one (player request 2026-11-19): just outside the edge of the
    // nearest spawn box of the kind on our map, isolation.watchMargin px out - close enough to see
    // the whole box, far enough not to draw aggro. Null when no box of it is on this map.
    function watchPoint(type) {
        const me = util.xy(character);
        const margin = icfg.watchMargin || 150;
        let best = null, bestD = Infinity;
        ((G.maps[character.map] || {}).monsters || []).forEach(function (pack) {
            if (pack.type !== type) return;
            // A spawn with a rage zone (map data "rage", 2026-11-19: the mummies): every 4.2 s each
            // free monster of that spawn goes for a player standing inside it - wait outside that.
            const boxes = pack.rage ? [pack.rage] : util.spawnBoxes(pack, character.map);
            boxes.forEach(function (b) {
                const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
                // Nearest point of the box, then margin px further out along the way from its center.
                const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
                let dx = nx - cx, dy = ny - cy;
                const len = Math.hypot(dx, dy) || 1;
                const p = { map: character.map, x: Math.round(nx + dx / len * margin), y: Math.round(ny + dy / len * margin) };
                const d = Math.hypot(p.x - me.x, p.y - me.y);
                if (d < bestD && can_move_to(p.x, p.y)) { bestD = d; best = p; }
            });
        });
        return best;
    }
    // Returns "lone" (only packs in sight), "strong" (only ones above our level check in
    // sight – skipped, but walking on towards the spawn's middle ran the team into the
    // level-12 White Wolves, 2026-11-17) or null (walk on).
    function waitForLone(type) {
        if (!icfg.enabled) return null;
        let why = null;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (why === "lone" || !e || e.type !== "monster" || e.mtype !== type || e.dead || !e.visible || e.target) return;
            // A spot already given up (taken, or too strong by the spot check) holds nobody back - the priest stood
            // still next to the big booboo spawn instead of walking on to the other one (2026-11-22).
            if (inOccupied(e)) return;
            if (!aggressive(e)) return;
            if (util.tooSpiky(config, e) || !liveSafe(e)) {
                // Only close ones stop us: holding as soon as the first one came into sight
                // left the team standing among the Wolfies below the White Wolves (2026-11-17).
                if (util.distanceTo(e) < (icfg.strongHold || 300)) why = why || "strong";
            }
            else if (!isolated(e)) why = "lone";
        });
        return why;
    }

    // ---- spot check from the edge (2026-11-22) -------------------------------------
    // The guide calls a route safe from level-1 stats, and our own checks only judged the monster we
    // pick - but walking to the middle of the spot pulls whatever is there. 05:31Z: the warrior walked
    // into the grown booboo pack (aggro 1.5, range 420, faster than us) his own check had just refused
    // ("skipping booboo level 17") and died; 05:34Z level-15 bbpompoms at the next spot. So the one who
    // picks the spot (solo, leader) first stops at the edge - its spawn box (the rage box where there is
    // one) plus the monster's range + 50 px (spotCheck.margin .. maxMargin) - looks for spotCheck.watchMs
    // and judges what is there:
    //   aggressive kinds (they join fights, or a rage zone): all free ones in sight come at once - the
    //   pack check (team model as leader, our own hits and sustain solo) with the strongest of them;
    //   passive kinds: at least one of them passes our live check.
    // Fails: the spot is blocked like a too-strong one (until the Cavalry is ready, see markCrowded) and
    // another target is picked. Passed: no new check until we leave the map or the target changes.
    // While the check is open no free monster of the kind is picked (ones on us are still fought).
    const gcfg = cfg.spotCheck || {};
    let gate = null; // { key, state: "walk" | "watch" | "ok", since }
    function spotBox(type, spot) {
        const map = G.maps[spot.map];
        let box = null;
        ((map && map.monsters) || []).forEach(function (pack) {
            if (box || pack.type !== type) return;
            const boxes = util.spawnBoxes(pack, spot.map);
            boxes.forEach(function (b) {
                if (box || Math.round((b[0] + b[2]) / 2) !== spot.x || Math.round((b[1] + b[3]) / 2) !== spot.y) return;
                // Spawn box and rage box together, whichever reaches farther out (player request 2026-11-22).
                const r = pack.rage;
                const u = r ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : b;
                box = { b: u, rage: !!r, count: pack.count || 1 };
            });
        });
        return box;
    }
    function boxDist(p, b) {
        const dx = Math.max(b[0] - p.x, 0, p.x - b[2]), dy = Math.max(b[1] - p.y, 0, p.y - b[3]);
        return Math.hypot(dx, dy);
    }
    // Is p (on our map) within the spot check's edge of a spawn of this type? (party.travelDest)
    function inSpotArea(p, type) {
        const def = G.monsters[type];
        if (!def || !p) return false;
        const margin = Math.max(gcfg.margin || 150, Math.min((def.range || 0) + 50, gcfg.maxMargin || 450));
        const mapName = p.map || character.map; // also a route end on another map (2026-11-22)
        return ((G.maps[mapName] || {}).monsters || []).some(function (pk) {
            if (pk.type !== type) return false;
            const boxes = util.spawnBoxes(pk, mapName);
            if (pk.rage) boxes.push(pk.rage);
            return boxes.some(function (b) { return boxDist(p, b) < margin; });
        });
    }
    function gateApplies(f) {
        if (!gcfg.enabled || !f || !f.monster || f.any || f.dest || !G.monsters[f.monster] || G.monsters[f.monster].cooperative) return false;
        if (party.enabled && (party.isMember && !party.detached())) return false;
        if (party.enabled && gcfg.party === false) return false;
        const src = String(f.source || "");
        return !src.startsWith("event") && !src.startsWith("cavalry");
    }
    // null: no restriction. { walk: true }: keep walking to the spot, pick nothing of the kind yet.
    // { hold: true, why }: stand here and watch.
    function spotGate(f) {
        if (!gateApplies(f)) { gate = null; return null; }
        const spot = spotFor(f.monster, f.map);
        if (!spot) return null;
        const key = f.monster + "|" + spotKey(spot);
        if (!gate || gate.key !== key) gate = { key: key, state: "walk", since: Date.now() };
        // Away from the spot's map: whatever state the gate was in, a new arrival is checked again (2026-11-22: a
        // "watch" left over from an earlier visit judged at once on arrival, with nothing in sight).
        if (character.map !== spot.map) { gate = { key: key, state: "walk", since: Date.now() }; return { walk: true }; }
        if (gate.state === "ok") return null;
        const box = spotBox(f.monster, spot);
        if (!box) { gate.state = "ok"; return null; }
        const def = G.monsters[f.monster];
        const margin = Math.max(gcfg.margin || 150, Math.min((def.range || 0) + 50, gcfg.maxMargin || 450));
        const me = util.xy(character);
        if (gate.state === "walk") {
            if (boxDist(me, box.b) > margin) return { walk: true };
            gate.state = "watch";
            gate.since = Date.now();
        }
        if (Date.now() - gate.since < (gcfg.watchMs || 3000)) return { hold: true, why: "checking the " + f.monster + " spot" };
        // Judge what we see in and around the box.
        const near = [box.b[0] - 150, box.b[1] - 150, box.b[2] + 150, box.b[3] + 150];
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === f.monster && !e.dead && boxDist(util.xy(e), near) === 0;
        });
        // Nothing of an aggressive / rage spawn in sight from farther than the edge: walk on and look again from the
        // edge - "none in sight, level 1 assumed" must come from up close (2026-11-22).
        if (!seen.length && boxDist(me, box.b) > margin + 20 && (joinsFights(def) || box.rage)) {
            gate.state = "walk";
            return { walk: true };
        }
        const verdict = judgeSpot(f.monster, seen, box);
        // Team stats not in yet: keep watching, at most gcfg.maxWaitMs - then the usual checks decide.
        if (verdict.wait && Date.now() - gate.since < (gcfg.maxWaitMs || 30000)) return { hold: true, why: "checking the " + f.monster + " spot (team stats)" };
        if (verdict.ok || verdict.wait) {
            gate.state = "ok";
            util.log("target", "spot check " + f.monster + ": OK - " + (verdict.why || "no team stats yet"), "green");
            return null;
        }
        gate = null;
        // Only this spot first (2026-11-22): another spawn of the kind may be fine (booboos: 5 no, 4 yes).
        const until = (config.cavalry || {}).enabled ? Math.max(cavalryNext(), Date.now() + 10 * 60 * 1000) : Date.now() + (cfg.crowdedForMs || 20 * 60 * 1000);
        strongSpotUntil[spotKey(spot)] = until;
        if (allSpotsTaken(f.monster)) markCrowded(verdict.why, true);
        else {
            nextPickAt = 0;
            util.log("target", f.monster + " spot " + spot.map + " " + spot.x + "," + spot.y + " too strong (" + verdict.why + ") - trying another " + f.monster + " spot", "orange");
        }
        return { hold: true, why: "spot too strong" };
    }
    // Held back by monsters too strong nearby (waitForLone "strong") before the edge (2026-11-22): the check starts
    // right there - otherwise neither rule moved and the priest stood 170 px from the booboo spawn for good.
    function spotGateWatchNow(f) {
        if (!gate || !f || !gateApplies(f)) return;
        const spot = spotFor(f.monster, f.map);
        if (!spot || gate.key !== f.monster + "|" + spotKey(spot) || gate.state !== "walk" || character.map !== spot.map) return;
        // Only near THIS spot (the strong ones may stand at another spawn of the kind - the next spot was judged
        // "none in sight" from 800 px away right after the big booboo spawn failed).
        const box = spotBox(f.monster, spot);
        if (!box || boxDist(util.xy(character), box.b) > (icfg.strongHold || 300) + 50) return;
        gate.state = "watch";
        gate.since = Date.now();
    }
    // n of this kind at once: the team model (leader), a member trusting its leader, or our own pack check (solo, or
    // a detached member - 2026-11-22: the warrior ran ahead into the 5-booboo spawn).
    function pullVerdict(type, strongest, n) {
        if (teamModelOn()) return teamVerdict(type, strongest, { pull: n });
        if (party.enabled && party.isMember && !party.detached()) return { ok: true };
        return packVerdict(strongest, n);
    }
    function judgeSpot(type, seen, box) {
        const def = G.monsters[type];
        // None in sight: fine - except where the whole spawn comes anyway (aggressive or a rage zone, 2026-11-22):
        // judged with its count at level 1.
        const none = !seen.length;
        // The whole spawn comes at once only in a map rage zone (v1.235.4, player report + server code 2026-11-24): a
        // monster's aggro means it attacks a player it touches (32 px), rage how long it pursues - the stoneworms
        // (aggro 1, rage 1, no rage zone) were judged as a pack of 4 although they come one by one.
        // spotCheck.aggroPack true brings the old rule back (aggressive kinds judged as a pack everywhere).
        const pack = box.rage || (gcfg.aggroPack === true && joinsFights(def));
        if (none && !pack) return { ok: true, why: "none in sight" };
        const free = seen.filter(function (e) { return !e.target; });
        const levels = none ? [1] : seen.map(function (e) { return e.level || 1; });
        const lv = (none ? "none in sight, level 1 assumed" : "levels " + Math.min.apply(null, levels) + "-" + Math.max.apply(null, levels));
        if (pack) {
            if (!none && !free.length) return { ok: true, why: "all " + seen.length + " busy" };
            const strongest = none ? { mtype: type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 }
                : free.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0) || (b.max_hp || 0) - (a.max_hp || 0); })[0];
            // No "harmless" shortcut (2026-11-22): it only means 20 single hits - 3 booboos (1.2 hits/s each,
            // pure) passed as harmless and killed the warrior in 10 s. The pack check counts the rate too.
            // The whole spawn, not just what we see from the edge (2026-11-22): the check saw 2 free booboos,
            // 5 came at once out of the rage zone (4x level 2, 1x level 8) - terrified, dead in 7 s.
            const n = Math.max(free.length, box.count || 0);
            const v = pullVerdict(type, strongest, n);
            if (!v.ok && /waiting for the team/.test(v.why || "")) return { wait: true };
            return v.ok ? { ok: true, why: n + " at once fine (" + free.length + " free in sight, " + lv + ")" }
                : { ok: false, why: n + " in the " + (box.rage ? "rage zone" : "pack") + " (" + free.length + " free in sight, " + lv + ") would come at once: " + v.why };
        }
        const fine = free.filter(function (e) { return !util.tooSpiky(config, e) && liveSafe(e); });
        if (!fine.length && free.length) return { ok: false, why: "none of " + seen.length + " passes the live check (" + lv + ")" };
        // A tight group comes together (2026-11-22): one at a time each X-scorpion was fine ("6 of 6 fine",
        // levels 10-11), but they stood close - the warrior's splash (and anything else hitting the group) pulled
        // their neighbours, 6 came at once and killed him. The largest group of free ones chained within
        // spotCheck.groupGap px (edge to edge, the splash radius plus walking in) is judged as one pull.
        const gap = gcfg.groupGap || 60;
        let group = [];
        // spotCheck.groupRule false (v1.233.1): no group judging here - the splash users check their pull live.
        if (gcfg.groupRule !== false) free.forEach(function (e) {
            if (group.indexOf(e) !== -1) return;
            const g = [e];
            for (let i = 0; i < g.length; i++) {
                free.forEach(function (o) {
                    if (g.indexOf(o) === -1 && Math.max(0, Math.hypot(o.real_x - g[i].real_x, o.real_y - g[i].real_y) - 20) < gap) g.push(o);
                });
            }
            if (g.length > group.length) group = g;
        });
        if (group.length >= 2) {
            const strongest = group.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0) || (b.max_hp || 0) - (a.max_hp || 0); })[0];
            const v = pullVerdict(type, strongest, group.length);
            if (!v.ok && /waiting for the team/.test(v.why || "")) return { wait: true };
            if (!v.ok) return { ok: false, why: "a group of " + group.length + " stands together (" + lv + ") and would come at once: " + v.why };
        }
        return { ok: true, why: fine.length + " of " + seen.length + " fine" + (group.length >= 2 ? ", group of " + group.length + " too" : "") + " (" + lv + ")" };
    }

    // Leader command "/safety [map]": every monster of the map (default: ours) with each
    // member's own guide verdict and the team model's verdict – to see why a spot is closed.
    function safetyReport(mapName) {
        const mapId = (mapName || "").trim() || character.map;
        const map = G.maps[mapId];
        if (!map) { util.log("safety", "unknown map " + mapId, "orange"); return; }
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        const types = Array.from(new Set((map.monsters || []).map(function (p) { return p.type; }))).filter(function (t) { return G.monsters[t]; });
        util.log("safety", mapId + ": " + types.length + " monster types" + (ts.enabled ? "" : " (team model is off)"), "yellow");
        types.forEach(function (t) {
            const members = [];
            if (own) members.push(character.name + ":" + (own.safe.has(t) ? (own.sure.has(t) ? "safe" : "trial") : own.listed.has(t) ? "UNSAFE" : "?"));
            Object.keys(reports).forEach(function (n) {
                const r = reports[n];
                if (!party.inParty(n)) return;
                members.push(n + ":" + (r.safe.includes(t) ? (r.sure.includes(t) ? "safe" : "trial") : r.listed && r.listed.includes(t) ? "UNSAFE" : "?"));
            });
            const v = teamVerdict(t);
            util.log("safety", t + " | " + members.join(" ") + " | team: " + (v.ok ? "OK - " : "no - ") + v.why, v.ok ? "green" : "white");
            // Its rage zones (2026-11-22): the whole spawn at once, as the bot decides there (level 1 stats here).
            rageZones(mapId).filter(function (z) { return z.type === t; }).forEach(function (z) {
                const rv = teamVerdict(t, null, { pull: z.count });
                util.log("safety", "  " + t + " rage zone (" + z.count + " at once): " + (rv.ok ? "OK - " : "no - ") + rv.why, rv.ok ? "green" : "orange");
            });
        });
        // Learned hit factors (real / predicted damage per hit, 2026-11-22), strongest first.
        const hf = util.hitFactors().slice(0, 12).map(function (x) { return x[0] + " " + x[1].toFixed(2) + " (" + x[2] + " hits)"; });
        if (hf.length) util.log("safety", "hit factors: " + hf.join(", "), "white");
    }

    // Who (if anyone) is not safe at this monster.
    function objector(monster, own) {
        if (recentDeath(monster)) return "the team (recent death)";
        // A melee leader cannot farm a damage-return monster at all (members just stand by).
        if (util.tooSpiky(config, monster)) return character.name + " (melee vs. damage return)";
        // Team model: the party as a whole can take it – no single member's veto.
        if (teamModelOn() && teamVerdict(monster).ok) return null;
        // A "trial" spot only waits for proof when it could hurt: a monster every fighter
        // survives 20+ hits of (e.g. armadillos, 20 attack) is fine to try right away –
        // otherwise such a spot is never farmed and so never proven.
        const proven = !cfg.avoidTrial || provenByUs(monster) || harmless(monster);
        let unlisted = 0; // fighters whose guide doesn't know the monster
        if (own) {
            if (!own.listed.has(monster)) unlisted++;
            else if (soloRouteSafe(monster)) { /* alone: our own solo check (with kiting) overrides the guide (v1.226.8) */ }
            else if (!own.safe.has(monster) || (!proven && !own.sure.has(monster))) return character.name;
        }
        const now = Date.now();
        const member = Object.keys(reports).find(function (name) {
            const r = reports[name];
            if (!party.inParty(name) || now - r.at > 3 * 60 * 1000) return false;
            if (r.listed && !r.listed.includes(monster)) { unlisted++; return false; }
            return !r.safe.includes(monster) || (!proven && !r.sure.includes(monster));
        });
        if (member) return member;
        if (unlisted && !harmless(monster)) return "the team (" + monster + " unknown to the guide, not harmless)";
        return null;
    }

    // Like objector(), but the spot we farm right now is only given up when an
    // objection lasts objectionGraceMs: a guide verdict near the edge flips with HP,
    // buffs and gear, and each flip used to send the team across the map. A death
    // there still counts at once.
    const objectedSince = {}; // monster -> first objection in the current streak
    function lastingObjector(monster, own) {
        const who = objector(monster, own);
        if (!who) { delete objectedSince[monster]; return null; }
        const here = farm && farm.monster === monster && String(farm.source).startsWith("guide");
        if (!here || recentDeath(monster)) return who;
        const now = Date.now();
        if (!objectedSince[monster]) {
            objectedSince[monster] = now;
            util.log("target", monster + " looks unsafe for " + who + " - staying unless that lasts " +
                Math.round((cfg.objectionGraceMs || 0) / 60000) + " min", "white");
        }
        return now - objectedSince[monster] >= (cfg.objectionGraceMs || 0) ? who : null;
    }

    // For bot_hunts: is this monster safe for the whole team right now?
    function isTeamSafe(monster) {
        return !whyUnsafe(monster);
    }
    // null when safe, else who/what objects (for logs).
    function whyUnsafe(monster) {
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (!own) return "no guide data yet";
        // Every spot of it taken or found too strong by the spot check (2026-11-22: hunts kept the team there).
        if (allSpotsTaken(monster)) return "every " + monster + " spot taken or too strong";
        const who = objector(monster, own);
        return who ? "not safe for " + who : null;
    }

    // The guide's computed XP per second for a route: the monster's XP over the route's cycle
    // (player decision 2026-11-18, "nur Rechnung"). A route the guide has observed carries the
    // measured XP instead - with Agitate and the Welcome Back bonus in it goo showed 1426 XP/s
    // against ~800 computed for the others, and the warrior farmed goos.
    function calcXp(r) {
        const d = r && G.monsters[r.monster];
        return d && r.cycle > 0 ? (d.xp || 0) / r.cycle : ((r && r.xp) || 0);
    }
    // Routes we can walk to (2026-11-21): the guide also lists monsters that only live in an instance
    // (a4 = Orlok in the crypt) - the leader picked it after the squigtoads were taken on EU IV, and
    // every route to "a4" failed ("Unrecognized location").
    const walkableSeen = {}; // monster -> it spawns on a map outside instances
    function walkable(r) {
        if (r.map) {
            const m = G.maps[r.map];
            if (!m || m.instance || m.ignore) return false;
        }
        if (walkableSeen[r.monster] === undefined) {
            walkableSeen[r.monster] = Object.keys(G.maps).some(function (k) {
                const m = G.maps[k];
                return !m.instance && !m.ignore && (m.monsters || []).some(function (p) { return p.type === r.monster; });
            });
        }
        return walkableSeen[r.monster];
    }
    // The team's XP ranking - the same list the farm pick walks (guide routes by XP/s, every
    // monster the team may take), crowded spots not left out. Monster names, best first; null
    // while the guide has no routes. Cached 60 s. For hunts.xpTop (player decision 2026-11-20).
    let rankCache = null;
    function teamXpRanking() {
        if (rankCache && Date.now() - rankCache.at < 60 * 1000) return rankCache.list;
        let advice = null;
        try { advice = get_progression(); } catch (e) { return null; }
        if (!advice || !Array.isArray(advice.routes)) return null;
        const own = ownSafe(advice);
        const model = teamModelOn();
        const seen = {};
        const list = advice.routes
            .filter(function (r) { return r && G.monsters[r.monster] && walkable(r) && (model || r.safe || soloRouteSafe(r.monster)) && !lastingObjector(r.monster, own); })
            .sort(function (a, b) { return calcXp(b) - calcXp(a); })
            .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
            .map(function (r) { return r.monster; });
        rankCache = { at: Date.now(), list: list };
        return list;
    }

    // The guide's farm choices (up to three safe routes, best first) that are safe
    // for the whole team, skipping monsters whose spot was recently found crowded.
    function fromProgression() {
        let list = [];
        let spare = []; // other safe routes, for when every choice is crowded
        try {
            const advice = get_progression();
            if (!advice) return null;
            const own = ownSafe(advice);
            // Team model: the guide's routes (for the leader alone) ranked by XP, keeping
            // every monster the team can take – also ones the guide calls unsafe solo.
            if (teamModelOn() && Array.isArray(advice.routes)) {
                const seen = {};
                const teamList = advice.routes
                    .filter(function (r) { return r && G.monsters[r.monster] && walkable(r) && !lastingObjector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team model" }; });
                if (teamList.length) {
                    // The best one not crowded/occupied, however far down the list (2026-11-19: with the
                    // top three only, squigtoads and giant scorpions both taken sent the team straight
                    // back to the taken squigtoads); every one blocked: the best one.
                    const now = Date.now();
                    return teamList.find(function (c) { return !(crowdedUntil[c.monster] > now); }) || teamList[0];
                }
            }
            // The guide's safe routes ranked by its XP number (XP/s), best three monsters
            // (player decision 2026-11-18): its own short list (advice.choices) is not ranked by
            // XP - a level-71 warrior on his own got goo, irritated goo and poisio.
            const seenRaw = {};
            const ranked = Array.isArray(advice.routes) ? advice.routes
                .filter(function (r) { return r && (r.safe || soloRouteSafe(r.monster)) && G.monsters[r.monster] && walkable(r); })
                .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                .filter(function (r) { if (seenRaw[r.monster]) return false; seenRaw[r.monster] = true; return true; })
                .slice(0, 3)
                .map(function (r) { return { kind: "farm", monster: r.monster, map: r.map }; }) : [];
            const raw = ranked.length ? ranked : (advice.choices || [])
                .filter(function (c) { return c.kind === "farm" && G.monsters[c.monster]; });
            list = raw
                .filter(function (c) { return !lastingObjector(c.monster, own); })
                .map(function (c) { return { monster: c.monster, map: c.map, source: "guide" }; });
            if (raw.length && list.length < raw.length) {
                // The guide's best pick is too risky for someone: say so once.
                const first = raw[0];
                const who = objector(first.monster, own);
                const msg = who ? first.monster + " is not safe for " + who + (list.length ? " - " + list[0].monster + " instead" : "") : "";
                if (msg && msg !== lastSkipLog) { lastSkipLog = msg; util.log("target", msg, "orange"); }
            }
            if (!list.length && Array.isArray(advice.routes)) {
                // None of the top three is safe for everyone: best other safe route.
                const seen = {};
                list = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && walkable(r) && !objector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .slice(0, 3)
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team-safe" }; });
            }
            if (Array.isArray(advice.routes)) {
                const seen = {};
                spare = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && walkable(r) && !objector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, next free spot" }; });
            }
            if (!list.length && !raw.length) {
                const row = (advice.rows || []).find(function (r) {
                    return r.action && r.action.kind === "farm" && r.action.route && G.monsters[r.action.route.monster];
                });
                if (row) list = [{ monster: row.action.route.monster, map: row.action.route.map, source: "guide task" }];
            }
        } catch (e) {
            util.log("target", "get_progression failed: " + util.errReason(e), "red");
        }
        if (!list.length) return null;
        const now = Date.now();
        const free = list.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (free) return free;
        // Every choice is crowded: the best other safe route that isn't...
        const other = spare.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (other) return other;
        // ...else the one that frees up first.
        return list.slice().sort(function (a, b) { return crowdedUntil[a.monster] - crowdedUntil[b.monster]; })[0];
    }

    // Called by the fighter every combat tick. If we stand on the farm map for
    // a while without any free target (other players clear the spot), mark the
    // spot as crowded and move on to the guide's next choice (or the next drop route).
    // Besides a long gap without any target, a spot where other players leave us only
    // the odd monster is crowded too: we measure the share of time without a target over
    // a sliding window (crowdedWindowMs) and give up above crowdedIdleShare.
    let win = null; // { monster, start, last, idle }
    // A spot found crowded again soon after the last time is skipped longer each time
    // (crowdedForMs, doubled per repeat up to crowdedMaxMs). Kept across restarts.
    const CROWD_KEY = "bot_crowded:" + character.name;
    const crowdHistory = (function () { try { return get(CROWD_KEY) || {}; } catch (e) { return {}; } })(); // monster -> { n, at, until }
    Object.keys(crowdHistory).forEach(function (m) { if (crowdHistory[m].until > Date.now()) crowdedUntil[m] = crowdHistory[m].until; });
    // Too strong, not taken (player decision 2026-11-21): grown monsters (booboos at level 3-19) made
    // the spot "crowded" for 4 h and the team came back to the same grown pack. Now it waits for the
    // Cavalry: blocked until the Cavalry is ready, then cavalryPlan resets it (sentries kill the grown
    // ones, they respawn at level 1) and the block is gone.
    const STRONG_KEY = "bot_strong_spots:" + character.name;
    const strongSpots = (function () { try { return get(STRONG_KEY) || {}; } catch (e) { return {}; } })(); // monster -> since
    Object.keys(strongSpots).forEach(function (m) { crowdedUntil[m] = Math.max(crowdedUntil[m] || 0, cavalryNext()); }); // after a restart too
    function saveStrong() { try { set(STRONG_KEY, strongSpots); } catch (e) { /* storage unavailable */ } }
    function cavalryNext() { try { return get("bot_cavalry_next") || 0; } catch (e) { return 0; } }
    function tooStrongHere(m) {
        const ns = noneSeen[m];
        return !!(ns && Date.now() - ns.at < 3 * 60 * 1000 && ns.unsafe > 0 && ns.taken === 0);
    }
    // strong (spot check, 2026-11-22): too strong, judged from the edge - `why` says what we saw.
    function markCrowded(why, strong) {
        const now = Date.now();
        // Without the Cavalry a too-strong spot is skipped like a crowded one (crowdedForMs, doubling on repeats).
        if ((config.cavalry || {}).enabled && (strong || tooStrongHere(farm.monster))) {
            const until = Math.max(cavalryNext(), now + 10 * 60 * 1000);
            crowdedUntil[farm.monster] = until;
            strongSpots[farm.monster] = now;
            saveStrong();
            const what = strong ? "spot check: " + why : noneSeen[farm.monster].unsafe + " of " + noneSeen[farm.monster].seen + " in sight";
            // The ~10 min were only the fallback block when the Cavalry is ready already (v1.235.4): then the reset comes
            // right away (cavalryPlan) and lifts the block.
            util.log("target", farm.monster + " too strong here (" + what + ") - " + (cavalryNext() <= now ? "the Cavalry is ready: reset first" :
                "blocked until the Cavalry is ready (~" + Math.max(1, Math.round((until - now) / 60000)) + " min), then reset"), "orange");
            idleSince = 0;
            win = null;
            nextPickAt = 0;
            return;
        }
        const h = crowdHistory[farm.monster];
        // A repeat within a day of the last time counts up; otherwise start over.
        const n = h && now - h.at < 24 * 60 * 60 * 1000 ? h.n + 1 : 1;
        const ms = Math.min(cfg.crowdedMaxMs || cfg.crowdedForMs, cfg.crowdedForMs * Math.pow(2, n - 1));
        crowdedUntil[farm.monster] = now + ms;
        crowdHistory[farm.monster] = { n: n, at: now, until: now + ms };
        try { set(CROWD_KEY, crowdHistory); } catch (e) { /* storage unavailable */ }
        util.log("target", farm.monster + (strong ? " too strong (spot check: " : " spot looks crowded (") + why + ") - trying another target for " + Math.round(ms / 60000) + " min", "orange");
        idleSince = 0;
        win = null;
        nextPickAt = 0; // pick again right away
    }
    let lastFoundAt = 0; // last time we had a target at our farm spot (cavalryPlan)
    function reportSearch(found) {
        const src = farm ? String(farm.source) : "";
        const now = Date.now();
        if (found) lastFoundAt = now;
        // Only on the spot of our farm target (walking there is no idle time on the spot).
        const sp = lastSpot;
        if (sp && farm && sp.type === farm.monster && character.map === sp.map && Math.hypot(character.real_x - sp.x, character.real_y - sp.y) <= 400) busyLog.push([now, !!found]);
        else busyLog.length = 0;
        if (busyLog.length > 2000) busyLog.splice(0, busyLog.length - 2000);
        if (!farm || !(src.startsWith("guide") || src.startsWith("drop") || src === "config list") || character.map !== farm.map) {
            idleSince = 0;
            win = null;
            return;
        }
        // Idle share over the window.
        if (!win || win.monster !== farm.monster) win = { monster: farm.monster, start: now, last: now, idle: 0 };
        const dt = Math.min(5000, now - win.last);
        win.last = now;
        if (!found) win.idle += dt;
        if (cfg.crowdedWindowMs && now - win.start >= cfg.crowdedWindowMs) {
            const share = win.idle / (now - win.start);
            if (share >= (cfg.crowdedIdleShare || 0.6)) { markCrowded(Math.round(share * 100) + "% of " + Math.round(cfg.crowdedWindowMs / 60000) + " min without a target"); return; }
            win = { monster: farm.monster, start: now, last: now, idle: 0 };
        }
        if (found) { idleSince = 0; return; }
        if (!idleSince) idleSince = now;
        if (now - idleSince >= cfg.crowdedAfterMs) markCrowded("no free target for " + Math.round(cfg.crowdedAfterMs / 1000) + " s");
    }

    // Monster types an event spawns in waves (G.events[name].waves), or null for "anything".
    function eventMonsters(name) {
        // Configured types first (events.joinTypes, e.g. the Giga Crab and its Huge Crabs on the main map).
        const jt = (config.events && config.events.joinTypes) || {};
        if (Array.isArray(jt[name])) return jt[name].slice();
        const waves = G.events[name] && G.events[name].waves;
        if (!Array.isArray(waves)) return null;
        const types = {};
        waves.forEach(function (w) { Object.keys((w && w[1]) || {}).forEach(function (t) { types[t] = true; }); });
        return Object.keys(types);
    }

    // Source kind of a farm target ("leader", "hunt", "drop", "guide" ...): the log line
    // also shows a change of source, not only of the monster (2026-11-18: a member farming on
    // its own kept the leader's mole without a line and died there three times).
    function srcKind(f) { return f ? String(f.source || "").split(",")[0].replace(/ of .*/, "") : ""; }
    function currentFarm() {
        // Cave of Many Dreams, manual mode (bot_cave, v1.231.0): no spot, no travel - pickInner fights only what the
        // player starts or what attacks the party.
        // /manual (v1.231.1) the same outside the cave: the player walks the leader.
        if (ctx.cave && ctx.cave.active()) {
            const src = ctx.cave.caveManual() ? "cave" : "manual";
            if (!farm || farm.source !== src) util.log("target", "now: " + src + " (the player walks the leader; fights only what it starts or what attacks us)", "yellow");
            farm = { monster: null, any: true, types: [], cave: true, source: src };
            nextPickAt = 0; // v1.231.2: after /manual off a fresh pick at once (the manual farm stuck until refreshMs)
            return farm;
        }
        shareSafe(); // members: tell the leader where we can fight safely
        clock();     // leader: our own experience with the current farm target
        // Events and world bosses come first (bot_events; members get it from the leader).
        const ev = ctx.events ? ctx.events.current() : null;
        if (ev) {
            const next = ev.join
                ? { monster: null, any: true, types: eventMonsters(ev.name), source: "event " + ev.name }
                : { monster: ev.monster || ev.name, dest: ev.dest || ev.monster || ev.name, source: "event " + ev.name };
            if (!farm || farm.source !== next.source) util.log("target", "now: " + next.source, "yellow");
            farm = next;
            nextPickAt = 0;
            return farm;
        }

        const lead = party.leaderInfo();
        if (lead && lead.farm && !party.detached()) {
            if (!farm || farm.monster !== lead.farm || srcKind(farm) !== "leader") util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            farm = { monster: lead.farm, source: "leader" };
            nextPickAt = 0;
            return farm;
        }
        // A member without the leader's farm target yet (right after a restart) waits for it instead of choosing its
        // own (2026-11-22: warrior and ranger ran off to the CGoos in the desert while the leader went to the booboos).
        if (party.enabled && party.isMember && !party.detached()) {
            if (!farm || farm.source !== "waiting for the leader") util.log("target", "waiting for the leader's farm target", "white");
            farm = { monster: null, source: "waiting for the leader" };
            nextPickAt = 0;
            return farm;
        }

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;

        // Witch's Cipher gathering (events.witchCipher, 2026-11-23, player decision): the scarcest ingredient's spot
        // list, the first one not blocked - above hunts, drop routes, the config target and the guide.
        const cf = ctx.events && ctx.events.cipherFarm ? ctx.events.cipherFarm() : null;
        if (cf && cf.list.length) {
            const pickC = cf.list.find(function (m) { return G.monsters[m] && !farmBlocked(m); });
            if (pickC) {
                const nextC = { monster: pickC, source: "witch's cipher: " + cf.ingredient };
                if (!farm || farm.monster !== nextC.monster || farm.source !== nextC.source) util.log("target", "farm target: " + pickC + " (" + nextC.source + ")", "yellow");
                farm = nextC;
                nextPickAt = 0; // the normal choice right after the window
                return farm;
            }
        }

        // An open, safe Monster Hunt beats both the guide and a configured farm target;
        // the configured target only replaces the guide's choice.
        // A hunt whose kind is blocked (too strong here, waiting for the Cavalry - or crowded) waits too (v1.235.3): the
        // stoneworm hunt was picked again every 3 s, the spot check blocked it again, and the team stood idle there.
        const huntPick = ctx.hunts ? ctx.hunts.target() : null;
        const hunt = huntPick && !(crowdedUntil[huntPick.monster] > Date.now()) ? huntPick : null;
        if (huntPick && !hunt && Date.now() - huntBlockLogAt > 5 * 60 * 1000) {
            huntBlockLogAt = Date.now();
            util.log("hunt", huntPick.monster + " hunt waits: the spot is blocked for " + Math.max(1, Math.round((crowdedUntil[huntPick.monster] - Date.now()) / 60000)) + " min - farming meanwhile", "white");
        }
        if (hunt) {
            if (!farm || farm.monster !== hunt.monster || srcKind(farm) !== srcKind(hunt)) util.log("target", "farm target: " + hunt.monster + " (" + hunt.source + ")", "yellow");
            farm = hunt;
            nextPickAt = 0; // re-evaluate the guide as soon as the hunt is over
            return farm;
        }

        const now = Date.now();

        // Items that can't be bought come before XP: the merchant reports what is
        // missing, the guide names the drop route (bot_drops).
        const drop = !override && ctx.drops ? ctx.drops.target(function (m) { return crowdedUntil[m] > now; }) : null;
        if (drop) {
            if (!farm || farm.monster !== drop.monster || srcKind(farm) !== srcKind(drop)) util.log("target", "farm target: " + drop.monster + " (" + drop.source + ")", "yellow");
            farm = drop;
            nextPickAt = 0; // back to the guide as soon as the item is complete
            return farm;
        }

        // Cavalry plan (player design 2026-11-19): the first farm target too strong (skipped as
        // crowded) -> go there and reset it with the Cavalry; the first one fine -> nuke the first
        // spot of cavalry.targets (e.g. dinos: loot at high level) and come back.
        const plan = cavalryPlan(override);
        if (plan) {
            if (!farm || farm.monster !== plan.monster || farm.source !== plan.source) util.log("target", "farm target: " + plan.monster + " (" + plan.source + ")", "yellow");
            farm = plan;
            nextPickAt = 0;
            return farm;
        }

        if (farm && now < nextPickAt) return farm; // hunt/leader/drop targets reset nextPickAt to 0

        // config.targeting.farm: one monster or a list - the first one not skipped (crowded or too
        // strong, every spot taken, a recent death), else the guide's choice (2026-11-19).
        const list = farmList(override);
        const listed = list.find(function (m) { return !farmBlocked(m); });
        let next = listed ? { monster: listed, source: list.length > 1 ? "config list" : "config" } : (list.length === 1 ? { monster: list[0], source: "config" } : null);
        if (!next) next = fromProgression();
        if (!next) next = { monster: config.targeting.fallback, source: "fallback" };

        // The guide may not be ready right after login: retry soon instead of waiting minutes.
        nextPickAt = now + (next.source === "fallback" ? 30 * 1000 : config.targeting.refreshMs);

        if (!farm || farm.monster !== next.monster || srcKind(farm) !== srcKind(next)) {
            util.log("target", "farm target: " + next.monster + " (" + next.source + ")", "yellow");
        }
        farm = next;
        return farm;
    }

    function farmList(override) {
        return override ? (Array.isArray(override) ? override.slice() : [override]) : [];
    }
    function farmBlocked(m) {
        return crowdedUntil[m] > Date.now() || recentDeath(m) || allSpotsTaken(m);
    }
    // Cavalry readiness as the fighter records it (account-wide, see fighter.cavalryTick).
    function cavalryReady() {
        let next = 0;
        try { next = get("bot_cavalry_next") || 0; } catch (e) { /* storage unavailable */ }
        return Date.now() >= next;
    }
    function cavalryCalledAt() {
        try { return get("bot_cavalry_called") || 0; } catch (e) { return 0; }
    }
    let cavPlan = null; // { monster, mode: "reset" | "nuke", since }
    // A spot of `type` found too strong that the team could take with fresh level-1 monsters (the Cavalry's reset
    // brings them back at level 1): the whole spawn at once where it comes at once (aggressive / rage), else one.
    // { map, x, y, why } of the cheapest such spot, or null. Spots other players hold are left out.
    function huntResetSpot(type) {
        const def = G.monsters[type];
        if (!def) return null;
        const now = Date.now();
        let best = null;
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pk) {
                if (pk.type !== type) return;
                const boxes = pk.boundaries ? pk.boundaries : pk.boundary ? [[m].concat(pk.boundary)] : [];
                boxes.forEach(function (b) {
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) };
                    const k = spotKey(spot);
                    if (!(strongSpotUntil[k] > now) || occupiedUntil[k] > now) return;
                    const n = joinsFights(def) || pk.rage ? (pk.count || 1) : 1;
                    const fresh = { mtype: type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 };
                    const v = teamModelOn() ? teamVerdict(type, fresh, { pull: n }) : packVerdict(fresh, n);
                    if (!v.ok) return;
                    if (!best || n < best.n) best = { map: spot.map, x: spot.x, y: spot.y, n: n, why: n + " at level 1: " + v.why };
                });
            });
        });
        return best;
    }
    // Cavalry reset at a spot with a rage box (2026-11-22): we call from just outside the box, never from inside
    // (inside, the whole spawn targets us, and the sentries only take level 3+). { hold, why } or null (walk on).
    function cavalryEdge(f) {
        if (!f || !String(f.source || "").startsWith("cavalry") || !cavPlan || !cavPlan.spot || character.map !== cavPlan.spot.map) return null;
        const box = spotBox(f.monster, cavPlan.spot);
        if (!box || !box.rage) return null;
        const gap = boxDist(util.xy(character), box.b);
        return gap <= (cfg.cavalryEdge || 90) ? { hold: true, why: "waiting at the " + f.monster + " zone for the Cavalry" } : null;
    }
    function cavalryPlan(override) {
        const cv = config.cavalry || {};
        const list = farmList(override);
        // Without a config list: only resets of too-strong spots from the guide's XP list (2026-11-21).
        if (!cv.enabled || (party.enabled && party.isMember && !party.detached())) { cavPlan = null; return null; }
        const huntsBlocked = !cavPlan && cavalryReady() && ctx.hunts && ctx.hunts.blocked ? ctx.hunts.blocked() : [];
        if (!cavPlan && !list.length && !Object.keys(strongSpots).length && !huntsBlocked.length) return null;
        const now = Date.now();
        if (cavPlan) {
            const called = cavalryCalledAt();
            let done = called > cavPlan.since && now - called > (cv.planStayMs || 100 * 1000);
            // Any reset: at the spot with nothing of level 3+ there, there is nothing to reset - the spot check
            // judges it again as it is (2026-11-22 for hunts, v1.227.2 for every reset: the solo mage stood among
            // level-1 Huge Crabs for minutes, "none picked: on another player's spot", because the reset kept the
            // too-strong block on the spot it was meant to clear). Without a spot of its own the plan uses the
            // spot we farm there (lastSpot).
            const planSpot = cavPlan.spot || (lastSpot && lastSpot.type === cavPlan.monster ? lastSpot : null);
            if (!done && cavPlan.mode === "reset" && planSpot && character.map === planSpot.map && !(called > cavPlan.since)) {
                const box = spotBox(cavPlan.monster, planSpot);
                if (box && boxDist(util.xy(character), box.b) <= 200) {
                    const near = [box.b[0] - 200, box.b[1] - 200, box.b[2] + 200, box.b[3] + 200];
                    const grown = Object.values(parent.entities || {}).some(function (e) {
                        return e && e.type === "monster" && e.mtype === cavPlan.monster && !e.dead && (e.level || 1) >= 3 && boxDist(util.xy(e), near) === 0;
                    });
                    if (!grown && now - cavPlan.since > 20 * 1000) {
                        util.log("target", "cavalry reset at " + cavPlan.monster + ": nothing of level 3+ there - the spot check decides", "white");
                        delete strongSpotUntil[spotKey(planSpot)];
                        // No new reset here for 10 min: should the spot check block it again, the ready Cavalry
                        // would plan the same pointless reset every 20 s.
                        noResetUntil[cavPlan.monster] = now + 10 * 60 * 1000;
                        cavPlan = null;
                        nextPickAt = 0;
                        return null;
                    }
                }
            }
            const tooLong = now - cavPlan.since > (cv.planMaxMs || 10 * 60 * 1000);
            if (done || tooLong) {
                util.log("target", "cavalry " + cavPlan.mode + " at " + cavPlan.monster + (done ? " done" : " gave up") + " - back to the farm list", done ? "green" : "orange");
                if (!done && strongSpots[cavPlan.monster]) crowdedUntil[cavPlan.monster] = Math.max(cavalryNext(), now + 30 * 60 * 1000); // try again with the next Cavalry
                if (done && cavPlan.mode === "reset") {
                    if (cavPlan.spot) delete strongSpotUntil[spotKey(cavPlan.spot)];
                    delete crowdedUntil[cavPlan.monster];
                    delete crowdHistory[cavPlan.monster];
                    if (strongSpots[cavPlan.monster]) { delete strongSpots[cavPlan.monster]; saveStrong(); }
                    try { set(CROWD_KEY, crowdHistory); } catch (e) { /* storage unavailable */ }
                    // A death block goes too (player decision 2026-11-19): the reset spot is fresh.
                    if (experience[cavPlan.monster] && experience[cavPlan.monster].bad) { delete experience[cavPlan.monster].bad; saveExperience(); }
                }
                cavPlan = null;
                nextPickAt = 0;
                return null;
            }
            return { monster: cavPlan.monster, source: "cavalry " + cavPlan.mode, map: cavPlan.spot ? cavPlan.spot.map : undefined };
        }
        if (!cavalryReady()) return null;
        // An open hunt held back only by too-strong spots (player decision 2026-11-22): the Cavalry resets the spot
        // that the team could take with fresh level-1 monsters, then the hunt is done there.
        for (const m of huntsBlocked) {
            if (recentDeath(m)) continue;
            const spot = huntResetSpot(m);
            if (!spot) continue;
            cavPlan = { monster: m, mode: "reset", since: now, spot: spot, hunt: true };
            util.log("target", "Cavalry ready: reset at the " + m + " spot " + spot.map + " " + spot.x + "," + spot.y + " for the hunt (" + spot.why + ")", "yellow");
            return { monster: m, source: "cavalry reset", map: spot.map };
        }
        if (!list.length) {
            // Guide list: the best too-strong spot that ranks above where we farm now.
            const rank = teamXpRanking() || [];
            const cur = farm ? rank.indexOf(farm.monster) : -1;
            const m = rank.find(function (x) { return strongSpots[x] && !allSpotsTaken(x, true) && !recentDeath(x) && !(noResetUntil[x] > now); });
            if (m && (cur === -1 || rank.indexOf(m) < cur)) cavPlan = { monster: m, mode: "reset", since: now };
            if (cavPlan) util.log("target", "Cavalry ready: reset at " + cavPlan.monster + " (too strong before)", "yellow");
            return cavPlan ? { monster: cavPlan.monster, source: "cavalry " + cavPlan.mode } : null;
        }
        // The first target skipped as too strong OR closed by a death (player decision 2026-11-19):
        // the Cavalry resets it, then it is farmed again.
        if ((crowdedUntil[list[0]] > now || recentDeath(list[0])) && !allSpotsTaken(list[0], true) && !(noResetUntil[list[0]] > now)) cavPlan = { monster: list[0], mode: "reset", since: now };
        // Nuke only while we actually farm the first target (fighting there within the last
        // minute) - arriving at grown booboos must lead to their reset, not to the dinos.
        else if (!farmBlocked(list[0]) && farm && farm.monster === list[0] && now - lastFoundAt < 60 * 1000) {
            const t = (cv.targets || []).find(function (m) { return G.monsters[m] && !recentDeath(m) && !allSpotsTaken(m, true); });
            if (t) cavPlan = { monster: t, mode: "nuke", since: now };
        }
        if (cavPlan) util.log("target", "Cavalry ready: " + cavPlan.mode + " at " + cavPlan.monster, "yellow");
        return cavPlan ? { monster: cavPlan.monster, source: "cavalry " + cavPlan.mode } : null;
    }

    function isOurs(name) {
        return name === character.name || party.inParty(name);
    }

    // A monster we can safely handle alone: dies in a few of our hits and barely
    // scratches us (config.party.spread).
    function isEasy(type) {
        const s = config.party.spread;
        const def = G.monsters[type];
        if (!s || !s.enabled || !def || def.cooperative) return false;
        // Harmless ones (at most s.harmlessRatio of our HP per hit) are easy however long they take:
        // the warrior (98 attack) needed 4 hits for a bee (300 HP) and only assisted while the
        // ranger took his own - a bee hits him for 1 % of his HP (2026-11-19).
        if (s.harmlessRatio && def.attack <= character.max_hp * s.harmlessRatio) return true;
        // Kiteable for us (ranger, priest): its hits count with the residual kite risk, and how long the
        // kill takes doesn't matter (2026-11-21: giant scorpions, speed 24, range 32, for the ranger).
        const risk = util.kiteRisk(def, null, { speed: character.speed, range: character.range });
        if (risk < 1) return def.attack * risk <= character.max_hp * s.maxDamageRatio;
        return def.hp <= character.attack * s.maxHits && def.attack <= character.max_hp * s.maxDamageRatio;
    }

    // Cooperative monsters (event bosses, Phoenix, ...) reward every contributor,
    // so fighting them alongside other players is fine.
    function isCoop(t) {
        const def = G.monsters[t.mtype];
        return !!(def && def.cooperative);
    }

    // ---- doomed targets (player decision 2026-11-20, from earthiverse's bot) ---------
    // Every attack the server announces ("action": attacker, target, raw damage, flight time)
    // is noted until its "hit" lands. A monster the damage already in the air will kill is
    // skipped: the warrior no longer walks to a bee that dies on the way, the ranger no longer
    // shoots one the warrior's swing finishes. Minimum damage only (raw x armor/resistance
    // multiplier x 0.9); evasion, reflection and avoidance count as "may miss" (no damage).
    // The listeners live on the game page and are swapped on each load (like the hit log).
    const PAGE = parent;
    try {
        if (PAGE.__botActFn) PAGE.socket.off("action", PAGE.__botActFn);
        if (PAGE.__botActHitFn) PAGE.socket.off("hit", PAGE.__botActHitFn);
        PAGE.__botInflight = {};
        PAGE.__botDoomedSkips = PAGE.__botDoomedSkips || 0;
        PAGE.__botActFn = function (d) {
            try {
                if (!d || !d.damage || d.heal || !d.target || !d.pid) return;
                const t = PAGE.entities && PAGE.entities[d.target];
                if (!t || t.type !== "monster") return;
                PAGE.__botInflight[d.pid] = { target: d.target, attacker: d.attacker, type: d.type, damage: d.damage, until: Date.now() + (d.eta || 0) + 600 };
            } catch (e) { /* estimate only */ }
        };
        PAGE.__botActHitFn = function (d) {
            try { if (d && d.pid && PAGE.__botInflight) delete PAGE.__botInflight[d.pid]; } catch (e) { /* estimate only */ }
        };
        PAGE.socket.on("action", PAGE.__botActFn);
        PAGE.socket.on("hit", PAGE.__botActHitFn);
    } catch (e) { /* no socket */ }
    // Dies within `hits` hits of our strongest fighter (or the damage on its way kills it already). For the luck catch
    // (2026-11-22, player decision): drops are rolled with the luck of the character the monster TARGETS when it dies.
    function diesSoon(m, hits) {
        if (!m || m.dead) return false;
        if (doomed(m)) return true;
        const def = G.monsters[m.mtype] || {};
        const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [util.combatStats()];
        let best = 0;
        team.forEach(function (f) {
            const hit = (f.attack || 0) * util.hitMultiplier(def, f.damage_type, f);
            if (hit > best) best = hit;
        });
        return best > 0 && (m.hp || 0) <= best * (hits || 1);
    }
    // A party member that catches dying monsters for its luck (Absorb Sins, classes.priest.luckCatch) within `range` px
    // of p (default: us), or null. Any class that has the skill counts.
    function luckCatcherNear(p, range) {
        const lc = ((config.classes || {}).priest || {}).luckCatch || {};
        if (!lc.enabled || !party.enabled) return null;
        const at = p ? util.xy(p) : util.xy(character);
        const skillClasses = (G.skills.absorb && G.skills.absorb.class) || [];
        const names = party.memberNames();
        for (const n of names) {
            const pl = n === character.name ? character : get_player(n);
            if (!pl || pl.rip || !skillClasses.includes(pl.ctype)) continue;
            if (pl.level < ((G.skills.absorb && G.skills.absorb.level) || 0)) continue;
            const q = util.xy(pl);
            if (Math.hypot(q.x - at.x, q.y - at.y) <= (range || 400)) return pl;
        }
        return null;
    }
    // Will the damage already on its way kill this monster? (armor/resistance via util.damageMultiplier)
    function doomed(t) {
        const fl = PAGE.__botInflight;
        if (!t || !fl) return false;
        const def = G.monsters[t.mtype] || {};
        if (t.avoidance || def.avoidance) return false;
        const now = Date.now();
        let sum = 0;
        for (const pid in fl) {
            const p = fl[pid];
            if (p.until < now) { delete fl[pid]; continue; }
            if (p.target !== t.id) continue;
            const a = p.attacker === character.id ? character : (PAGE.entities && PAGE.entities[p.attacker]);
            const mh = a && a.slots && a.slots.mainhand && G.items[a.slots.mainhand.name];
            const dtype = (p.type !== "attack" && G.skills[p.type] && G.skills[p.type].damage_type) ||
                (mh && mh.damage_type) || (a && G.classes[a.ctype] && G.classes[a.ctype].damage_type) || "physical";
            if (dtype === "magical" && (t.reflection || def.reflection)) continue;
            if (dtype === "physical" && (t.evasion || def.evasion)) continue;
            const defense = dtype === "magical" ? (t.resistance != null ? t.resistance : (def.resistance || 0)) : (t.armor != null ? t.armor : (def.armor || 0));
            sum += def["1hp"] ? 1 : p.damage * util.damageMultiplier(defense) * 0.9;
            if (sum >= t.hp) return true;
        }
        return false;
    }
    function skipDoomed(t) {
        if (!doomed(t)) return false;
        PAGE.__botDoomedSkips = (PAGE.__botDoomedSkips || 0) + 1;
        return true;
    }

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (util.tooSpiky(config, t)) return false; // melee vs. damage return: our own hit kills us
        if (t.target && !isOurs(t.target) && !isCoop(t)) return false;
        // Giga Crab (events.foreignOnly): only while a foreign player holds it and it takes damage (2026-11-23).
        if (util.foreignOnlyBlocks(config, t)) return false;
        return true;
    }

    // Nearest monster attacking us or any party member (V1's party-aggro priority).
    // Doomed ones (dying to damage already in the air) are passed over (2026-11-20).
    function nearestPartyAttacker() {
        const names = party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        let best = null;
        let bestDistance = Infinity;
        Object.values(parent.entities || {}).forEach(function (m) {
            if (!m || m.type !== "monster" || m.dead || !m.target || !names.includes(m.target)) return;
            if (util.foreignOnlyBlocks(config, m)) return; // a Giga Crab on one of us: never hit it (2026-11-23)
            const d = util.distanceTo(m);
            if (d >= bestDistance || skipDoomed(m)) return;
            best = m;
            bestDistance = d;
        });
        return best;
    }

    // Rare monsters (player decision 2026-11-20, from earthiverse's bot): a golden bat, cutebee,
    // tiny pinky or a seasonal one in sight goes first - before the current target. Only ones we
    // get credit for (no target, or on us or a member), within rare.range px, and not invulnerable.
    function rareTarget() {
        const rc = config.targeting.rare || {};
        if (!rc.enabled || !(rc.types || []).length) return null;
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        let best = null, bestD = Infinity;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || !rc.types.includes(e.mtype)) return;
            if (e.target && !ours.includes(e.target)) return;
            if (e.s && (e.s.fullguard || e.s.fullguardx || e.s.invincible)) return;
            const d = util.distanceTo(e);
            if (d <= (rc.range || 400) && d < bestD) { best = e; bestD = d; }
        });
        if (best && best.id !== lastRareId) {
            lastRareId = best.id;
            util.log("target", "rare monster: " + best.mtype + " (" + Math.round(bestD) + " px) - attacking", "yellow");
        }
        return best;
    }
    let lastRareId = null;

    // No first hit on a roaming boss (events.search / engage) before the whole team is there (player
    // decision 2026-11-21): with the parallel search one fighter may find it alone - a later rogue would
    // not survive the Phoenix on its own. A boss already fighting (anyone, e.g. another player) is fair game.
    function bossList() {
        const ev = config.events || {};
        return (ev.search || []).concat(ev.engage || []);
    }
    // Hold ring of an aggressive boss (2026-11-22): the ranger waited for the team inside Jr.'s spawn box
    // (Jr.: aggro 1, rage 1, roams the box at 40, charges at 90) - Jr. walked into him and the fight began
    // without the team. A boss with aggro or rage >= 0.3 is waited for outside its spawn box on our map, by
    // its range + its charge (or speed) + 50 px. { box, margin } or null (passive boss, or no box near it).
    function bossBox(t) {
        const map = G.maps[character.map] || {};
        let best = null, bd = Infinity;
        (map.monsters || []).forEach(function (pk) {
            if (pk.type !== t.mtype) return;
            const boxes = util.spawnBoxes(pk, character.map);
            boxes.forEach(function (b) { const d = boxDist(util.xy(t), b); if (d < bd) { bd = d; best = b; } });
        });
        return best && bd < 300 ? best : null;
    }
    function bossHoldRing(t) {
        const def = t && G.monsters[t.mtype];
        if (!def || !((def.aggro || 0) >= 0.3 || (def.rage || 0) >= 0.3)) return null;
        const box = bossBox(t);
        if (!box) return null;
        return { box: box, margin: (t.range || def.range || 30) + Math.max(def.charge || 0, def.speed || 0) + 50 };
    }
    function teamAt(t) {
        const fighters = (config.team && config.team.fighters) || [];
        const p = util.xy(t);
        const r = (config.events && config.events.holdRange) || 350;
        const ring = bossHoldRing(t);
        return fighters.every(function (n) {
            if (n !== character.name && !party.inParty(n)) return true; // not with us (offline)
            const f = n === character.name ? character : get_player(n);
            // A dead member is not waited for (2026-11-21: the warrior died at the level-8 Phoenix).
            if (f && f.rip) return true;
            if (!f) return n === character.name;
            const q = util.xy(f);
            // On the hold ring of an aggressive boss counts as "here" too (it may be farther than holdRange).
            return Math.hypot(q.x - p.x, q.y - p.y) <= r || (!!ring && f.map === character.map && boxDist(q, ring.box) <= ring.margin + 120);
        });
    }
    let holdLogged = 0;
    // holdForTeam for every boss, or only for events.holdFor (Dracul: a runner finds him alone, 2026-11-21).
    function holdsFor(mtype) {
        const ev = config.events || {};
        return ev.holdForTeam !== false || (ev.holdFor || []).includes(mtype);
    }
    // Too strong for us alone at its real level (events.soloOk, player decision 2026-11-21): held
    // like an events.holdFor boss until the team is there - not when it is on one of us already.
    function tooStrongAlone(t) {
        if (!t || !party.enabled || !bossList().includes(t.mtype) || !ctx.events || !ctx.events.soloOk) return false;
        if (t.target && isOurs(t.target)) return false;
        return !ctx.events.soloOk(t);
    }
    function holdBoss(t) {
        if (!t || !party.enabled) return false;
        const strong = tooStrongAlone(t);
        if (!strong && (!holdsFor(t.mtype) || t.target || !bossList().includes(t.mtype))) return false;
        if (teamAt(t)) return false;
        if (Date.now() - holdLogged > 60 * 1000) { holdLogged = Date.now(); util.log("target", t.mtype + (strong ? " too strong for me alone" : " not engaged yet") + " - holding until the team is here", "white"); }
        util.status("holding at " + t.mtype, "yellow");
        return true;
    }
    // A held boss within range px (warrior: no Agitate that would pull it).
    function heldBossNear(range) {
        return Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range && holdBossQuiet(e);
        });
    }
    function holdBossQuiet(t) {
        return !!t && party.enabled && !teamAt(t) && (tooStrongAlone(t) || (holdsFor(t.mtype) && !t.target && bossList().includes(t.mtype)));
    }
    let fearLogged = 0; // last fear-guard log (see pick)
    // ---- mobbing guard and live danger (2026-11-22, see util.mobbing) ----------------
    // More than 3 monsters on one of us multiply every hit on that one. So no new free monster while
    // one of our fighters already has mobbing.maxOnOne (3) on it - unless the new one hits so hard that
    // mobbing adds at most guardMinMult (strong monsters: 300 / attack is small). Monsters already
    // on us or a member are fought as usual. Agitate decides with its own pack check.
    const mcfg = cfg.mobbing || {};
    let mobLogged = 0;
    function onFighter(name) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === name;
        }).length;
    }
    function mobGuard(t) {
        if (mcfg.enabled === false || mcfg.guard === false || !t || t.target) return false;
        if (util.mobCap(t.attack || (G.monsters[t.mtype] || {}).attack) <= (mcfg.guardMinMult || 1.25)) return false;
        const names = [character.name].concat(party.enabled ? party.memberNames() : []);
        const most = names.reduce(function (best, n) {
            const c = onFighter(n);
            return c > best.c ? { n: n, c: c } : best;
        }, { n: null, c: 0 });
        if (most.c < (mcfg.maxOnOne || 3)) return false;
        if (Date.now() - mobLogged > 60 * 1000) {
            mobLogged = Date.now();
            util.log("target", "not pulling " + t.mtype + ": " + most.c + " already on " + most.n + " (a 4th starts the mobbing bonus)", "white");
        }
        return true;
    }
    // What the monsters on us deal right now, with the live mobbing combo (util.mobNow) carried
    // mobbing.projectSec ahead: { dps, sustain, ttd (s until dead, Infinity if we gain), onMe, mult }.
    function liveDanger() {
        const me = character;
        const on = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === me.name;
        });
        if (!on.length) return { dps: 0, sustain: 0, ttd: Infinity, onMe: 0, mult: 1 };
        const now = util.mobNow(0);
        let dps = 0, hps = 0, maxMult = 1;
        on.forEach(function (e) {
            const def = G.monsters[e.mtype] || {};
            const reach = (e.range || def.range || 30) + 60;
            if (util.distanceTo(e) > reach) return; // still on its way - no hits yet
            hps += e.frequency || def.frequency || 1;
        });
        // The combo the next projectSec of hits will reach (only while more than 3 target us).
        const combo = on.length > 3 ? Math.max(now.combo, 1) + Math.round(hps * (mcfg.projectSec || 4)) : 0;
        on.forEach(function (e) {
            const def = G.monsters[e.mtype] || {};
            if (util.distanceTo(e) > (e.range || def.range || 30) + 60) return;
            const att = e.attack || def.attack || 0;
            const mult = combo ? Math.min(combo > 10 ? combo / 4 : 2, util.mobCap(att)) : 1;
            maxMult = Math.max(maxMult, mult);
            dps += util.predictedHit(e, me) * util.hitFactor(e.mtype) * mult * (e.frequency || def.frequency || 1);
        });
        // Party (2026-11-22): every living healer within its range of us heals too - its heal per second
        // (reported stats) x mobbing.healShare, as it heals others now and then.
        let healing = 0;
        if (party.enabled) {
            const team = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [];
            team.forEach(function (f) {
                if (!f || !(f.heal > 0) || f.name === me.name) return;
                const p = get_player(f.name);
                if (!p || p.rip || util.distanceTo(p) > (f.range || p.range || 0) + 20) return;
                healing += f.heal * (f.frequency || 1) * (mcfg.healShare || 0.8);
            });
        }
        const sustain = potionHps() + healing;
        const net = dps - sustain;
        return { dps: dps, sustain: sustain, healing: healing, ttd: net > 0 ? me.hp / net : Infinity, onMe: on.length, mult: maxMult };
    }
    // The next target (pickInner), then the guards: the mobbing guard, and the fear guard (earthiverse's
    // courage check, player decision 2026-11-21): no new free monster while the attackers of its damage
    // type on us already reach our courage for it - fear would cut our attack to 60/40/20 %. Monsters
    // already on us or a member are fought as usual. Last, a boss held for the team (holdBoss).
    function pick(farmTarget) {
        const t = pickInner(farmTarget);
        if (t && mobGuard(t)) {
            util.status("mobbing: no new pull", "white");
            return null;
        }
        if (t && util.wouldScare(t)) {
            if (Date.now() - fearLogged > 60 * 1000) {
                fearLogged = Date.now();
                util.log("target", "not pulling " + t.mtype + ": " + util.damageTypeOf(t) + " attackers on me reach my courage (" + util.courageOf(util.damageTypeOf(t)) + ")", "white");
            }
            util.status("fear: waiting with " + t.mtype, "white");
            return null;
        }
        return t && holdBoss(t) ? null : t;
    }
    function pickInner(farmTarget) {
        // Cave, manual mode (v1.231.0, player decision 2026-11-24): our current target (on the leader: set by the
        // player's click or attack), a monster attacking the party, and for members the leader's target - nothing
        // else, no rare monsters, no free pulls.
        if (farmTarget && farmTarget.cave) {
            const cur = get_targeted_monster();
            if (isValid(cur) && ctx.cave.mayFight(cur) && !skipDoomed(cur)) return cur;
            const attacker = nearestPartyAttacker();
            if (attacker && ctx.cave.mayFight(attacker) && !util.tooSpiky(config, attacker)) return attacker;
            if (party.isMember) {
                const lead = party.leaderInfo();
                const assist = lead && lead.target ? get_monster(lead.target) : null;
                if (isValid(assist) && ctx.cave.mayFight(assist) && !skipDoomed(assist)) return assist;
            }
            return null;
        }
        checkOccupied();
        const rare = rareTarget();
        if (rare) return rare;
        const current = get_targeted_monster();
        // A lone pull we are still walking up to must stay alone until it is engaged: the
        // White Wolf wandered deeper into the pack while the priest followed it (2026-11-17).
        // Dropped, we hold (waitForLone) until it – or another one – stands alone again.
        // A current target the damage in the air already kills is let go (2026-11-20).
        if (isValid(current) && !(!current.target && aggressive(current) && !isolated(current)) && !skipDoomed(current)) return current;

        const attacker = nearestPartyAttacker();
        // Easy monsters (spread): help only with ones in our range or on us - the rest walk to
        // whoever they chase. After the warrior's Agitate the priest and the ranger waited for
        // the slow bees to reach him instead of taking free ones (2026-11-18).
        const spreading = party.enabled && farmTarget && farmTarget.monster && isEasy(farmTarget.monster);
        if (attacker && !util.tooSpiky(config, attacker) &&
            (!spreading || attacker.target === character.name || is_in_range(attacker))) return attacker;

        // Join event (e.g. Goo Brawl): anything in the event map is fair game, and
        // everyone picks its own nearest monster – waiting for the leader's pick
        // (a melee paladin) left most kills to other players.
        if (farmTarget.any) {
            // Events with waves (e.g. Graveyard Rising in Spooky Town) share the map with other
            // monsters (mummies): only the event's own monsters count.
            if (farmTarget.types && farmTarget.types.length) {
                let best = null;
                farmTarget.types.forEach(function (type) {
                    const m = get_nearest_monster({ type: type });
                    if (isValid(m) && (!best || util.distanceTo(m) < util.distanceTo(best))) best = m;
                });
                return best;
            }
            const m = get_nearest_monster({});
            return isValid(m) ? m : null;
        }

        if (party.isMember && !party.detached()) {
            // The event's boss in our own sight: take it without waiting for the leader's target
            // (player decision 2026-11-21: anyone may open on a boss alone). The warrior found the
            // Phoenix twice and only attacked once the priest saw it - members only assisted the
            // leader's target. Held bosses (events.holdFor) are still held by pick().
            if (farmTarget && farmTarget.monster && String(farmTarget.source || "").indexOf("event ") === 0) {
                const boss = get_nearest_monster({ type: farmTarget.monster });
                if (isValid(boss)) return boss;
            }
            const lead = party.leaderInfo();
            // Easy farm targets (e.g. goos for a hunt): everyone fights its own monster - our nearest
            // one, no leash to the leader any more (player decision 2026-11-21).
            const own = lead && lead.farm && isEasy(lead.farm) ? nearestSafe(lead.farm) : null;
            if (own) return own;
            // Otherwise only assist the leader, never pull new monsters –
            // and never wander off to a farm spot of our own.
            const assist = lead && lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && (assist.target || isCoop(assist)) && !skipDoomed(assist) ? assist : null;
        }

        const type = farmTarget.monster;
        if (G.monsters[type] && G.monsters[type].cooperative) {
            const boss = get_nearest_monster({ type: type }); // bosses never die to one volley
            if (isValid(boss)) return boss;
        }
        // Spot check from the edge still open: nothing of the kind picked yet (2026-11-22).
        if (spotGate(farmTarget)) return null;
        const best = nearestSafe(type);
        if (!best) explainNone(type);
        return best;
    }

    return { currentFarm: currentFarm, farmNow: function () { return farm; }, pick: pick, xpRanking: teamXpRanking, heldBossNear: heldBossNear, doomed: doomed, reportSearch: reportSearch, isTeamSafe: isTeamSafe, whyUnsafe: whyUnsafe,
        diesSoon: diesSoon, luckCatcherNear: luckCatcherNear,
        teamModelOn: teamModelOn, teamVerdict: teamVerdict, spotGate: spotGate, liveDanger: liveDanger, rageZoneHere: rageZoneHere, failingZoneAt: failingZoneAt, bossHoldRing: bossHoldRing, holdingBoss: holdBossQuiet, inSpotArea: inSpotArea, cavalryEdge: cavalryEdge, spotGateWatchNow: spotGateWatchNow, rageBoxes: rageBoxes, failingZoneNear: failingZoneNear, safetyReport: safetyReport, waitForLone: waitForLone, watchPoint: watchPoint, standPoint: standPoint, aggressive: aggressive, diedAt: diedAt, deathAt: deathAt, spotFor: spotFor, inOccupied: inOccupied, packVerdict: packVerdict, 
        // HP a solo fight against this monster costs (0 if it was never checked: harmless or low level).
        soloCost: function (e) { return (e && soloCostById[e.id]) || 0; } };
};
