// =====================================================================
// bot_class_warrior – Warrior skills.
//   survive: Hard Shell (lvl 60, 480 MP) when HP gets low while physical
//            monsters hit us
//   support: Taunt (40 MP, 3 s, range 200) pulls a monster off a party
//            member when it hits hard or the member is hurt;
//            Agitate (lvl 68, 420 MP) taunts everything nearby when several
//            monsters are on other members; War Cry (lvl 70) on sturdy fights
//   fight:   Cleave (lvl 52, axe/scythe) when several monsters stand around
//            us, Stomp (lvl 52, basher) when several attack the team
//   move:    Charge (+30 speed, 3.2 s, 40 s cooldown, no MP) on longer walks
//            and chases; Dash (120 MP) closes the last gap to a target when
//            the straight line is free
// Solo, support only protects the warrior itself (nothing to taunt off).
// =====================================================================

module.exports = function createWarrior(ctx) {
    // A move promise rejects when the next move interrupts it: swallow it (the log filled with "{}", 2026-11-18).
    const quiet = ctx.util.quiet;
    const util = ctx.util;
    const c = ctx.config.classes.warrior;

    const mpLeftAfter = util.mpLeftAfter;
    function reserve() {
        return character.max_mp * (c.mpReserveRatio || 0);
    }

    // Monsters attacking a party member other than us, nearest first.
    function onOthers() {
        const names = ctx.party.memberNames().filter(function (n) { return n !== character.name; });
        if (!names.length) return [];
        return Object.values(parent.entities || {})
            .filter(function (e) { return e && e.type === "monster" && !e.dead && e.visible && names.includes(e.target); })
            .sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
    }

    // Monsters standing within `range` of us (for Cleave / Stomp).
    function around(range, attackingOnly) {
        const names = ctx.party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible || util.distanceTo(e) > range) return false;
            if (util.tooSpiky(ctx.config, e)) return false; // Cleave/Stomp would hit a porcupine
            if (attackingOnly && !names.includes(e.target)) return false;
            // Never pull monsters that fight other players.
            return !e.target || names.includes(e.target);
        });
    }

    // Cleave and Stomp hit everything around us: never with a damage-return monster in reach.
    function spikyNear(range) {
        return Object.values(parent.entities || {}).some(function (e) {
            // Any damage return counts here: Cleave/Stomp hit them all, each one returns.
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range + 20 &&
                ((G.monsters[e.mtype] || {}).dreturn > 0 || util.tooSpiky(ctx.config, e));
        });
    }

    // A monster on an ally is worth taunting when the ally is hurt or the monster hits hard -
    // and always (player decision 2026-11-20) when it is a boss, or when it is on our healer:
    // the Phoenix (attack 125, under 5 % of the priest's HP) stayed on the kiting priest, who
    // walked it around the map while the warrior never took it.
    let tauntWalk = null; // where we last walked to for a taunt (a new order when it moved 30+ px)
    function worthTaunting(m) {
        const p = get_player(m.target);
        if (!p || p.rip) return false;
        const t = c.taunt || {};
        if (p.hp / p.max_hp < (t.allyHpBelow || 0.8) || (m.attack || 0) >= p.max_hp * (t.hitRatio || 0.05)) return true;
        const def = G.monsters[m.mtype] || {};
        const ev = ctx.config.events || {};
        const bosses = (ev.search || []).concat(ev.engage || []);
        if (t.bosses !== false && (def.cooperative || bosses.includes(m.mtype) || (m.max_hp || def.hp || 0) >= (t.bossHp || 20000))) return true;
        return t.offHealer !== false && util.isHealer(p);
    }

    // Dash: a short jump towards a point ([x, y]). It has no cooldown, so we space the
    // jumps ourselves (dash.everyMs) – otherwise every tick jumps and drains the MP.
    // A failure pauses it instead of retrying every tick.
    // Combat dash (player decision 2026-11-21, earthiverse's useWarriorDash): only when we go for a
    // monster in a fight - our target, or the member it hits (the priest pulled it, we meet it there
    // and taunt it off) - never on a route (fighter.travel passes no target). The server jumps at
    // most 50 px (farther fails and the MP is gone) at speed 500 and finds a safe landing spot itself
    // (also at 80 % / 60 % of the way) - ~0.5 s saved per jump at our speed. The jump lands short of
    // the monster (range x 0.8), only above minMpRatio MP (the reserve for Taunt and Cleave stays),
    // one per everyMs (the server's dash state lasts 1 s). After it lands we walk on at once - the
    // old dash stood still after the hop because no move followed in the same tick.
    let dashPausedUntil = 0;
    let lastDash = 0;
    function tryDash(target) {
        const d = c.dash || {};
        if (!d.enabled || !target || Date.now() < dashPausedUntil || Date.now() - lastDash < (d.everyMs || 1000)) return false;
        if (character.s && character.s.dash) return false;
        if (typeof smart !== "undefined" && smart.moving) return false; // routes: Charge only
        if (!util.canCast("dash") || util.mpRatio() < (d.minMpRatio || 0.5) || mpLeftAfter("dash") < reserve()) return false;
        const dist = util.distanceTo(target);
        if (dist < (d.from || 80)) return false;
        const p = util.xy(target);
        const step = Math.min(d.max || 49, dist - (character.range || 20) * 0.8);
        if (step < 20) return false;
        const k = step / dist;
        const to = [character.real_x + (p.x - character.real_x) * k, character.real_y + (p.y - character.real_y) * k];
        lastDash = Date.now();
        use_skill("dash", to).then(function () {
            // Landed (~0.1 s): on towards the monster right away.
            setTimeout(function () {
                try { const q = util.xy(target); if (!target.dead) move(q.x, q.y); } catch (e) { /* gone */ }
            }, 150);
        }).catch(function (e) {
            dashPausedUntil = Date.now() + (d.pauseMs || 10 * 1000);
            util.log("warrior", "dash failed: " + util.errReason(e) + " - pausing it for " + Math.round((d.pauseMs || 10000) / 1000) + " s", "orange");
        });
        return true;
    }

    // ---- Agitate pack mode (config.classes.warrior.agitate, test since 2026-11-18) ----------
    //
    // Solo: when enough free monsters stand within Agitate range, the warrior puts on his
    // splash weapons (explosion, e.g. Lolipop Maces), casts War Cry and Agitate, walks a step
    // away so the pack follows from one side and bunches up, then always hits the monster with
    // the most others inside the splash radius (explosion / 3.6 px, hitbox edge to edge -
    // server.js). When the pack spreads around him he steps away again. Each pull ends with
    // a summary line (pulled, time, splash neighbours per hit, HP used) to judge the mode.
    const ag = c.agitate || {};
    const pack = { state: "idle", busy: false, since: 0, pulled: [], startHp: 0, attacks: 0, neighborSum: 0,
        recent: [], lastRegroup: 0, gatherAt: 0, noWeaponsLogged: false };

    // Mode: "off" (single targets), "swords" (Agitate, usual weapons - pull everything, kill one
    // by one, no walking) or "splash" (Agitate with the splash weapons). From the config
    // (enabled + weapons "keep"/"splash"), or switched at runtime with the chat command
    // "/agitate off|swords|splash|config" (kept across restarts; for A/B tests, 2026-11-18).
    const MODE_KEY = "agitate_mode:" + character.name;
    let modeCache = { at: 0, v: null }, lastMode = null;
    function agOverride() { agMode(); return !!modeCache.v; }
    function agMode() {
        if (Date.now() - modeCache.at > 2000) {
            let v = null;
            try { v = get(MODE_KEY) || null; } catch (e) { /* storage unavailable */ }
            modeCache = { at: Date.now(), v: v };
        }
        const m = modeCache.v || (!ag.enabled ? "off" : ag.monsters === "auto" ? autoMode() : ag.weapons === "keep" ? "swords" : "splash");
        if (m !== lastMode) {
            if (lastMode !== null) {
                util.log("warrior", "agitate mode: " + m, "yellow");
                if (!SPLASH_MODES.includes(m)) ctx.gear.holdWeapons(0); // usual weapons back at once
                pack.state = "idle";
            }
            lastMode = m;
        }
        return m;
    }
    const SPLASH_MODES = ["splash", "chain", "splashstream"];
    function splashMode() {
        const m = effectiveMode();
        return SPLASH_MODES.includes(m); // "chain": splash pulls that start the next pull early; "splashstream": stream with splash
    }
    // In a party only the stream modes run (player decision 2026-11-18): the leader picks the
    // spot and walks, we stay on the leash - Agitate where we stand, fight what comes.
    // agitate.partyMode decides which ("splashstream", "swords" or "off").
    // "auto" (2026-11-18): the automatic decision for the leader's farm target - a pull-point
    // result becomes its stream counterpart (no own walking in a party).
    function partyStream() {
        return ctx.party.enabled && ["splashstream", "swords", "auto"].includes(ag.partyMode || "off");
    }
    function effectiveMode() {
        if (!ctx.party.enabled) return agMode();
        if (!partyStream()) return "off";
        if (ag.partyMode !== "auto") return ag.partyMode;
        const m = autoMode();
        return m === "off" ? "off" : SPLASH_MODES.includes(m) ? "splashstream" : "swords";
    }
    // True when the automatic decision picks the mode (no /agitate override).
    function autoDecides() {
        if (ctx.party.enabled) return partyStream() && ag.partyMode === "auto";
        agMode(); // refreshes the override cache
        return !modeCache.v && !!ag.enabled && ag.monsters === "auto";
    }
    function packOn() {
        if (ctx.party.enabled ? effectiveMode() === "off" : agMode() === "off") return false;
        return !!G.skills.agitate && character.level >= (G.skills.agitate.level || 68);
    }
    function isSplash(item) {
        const def = item && G.items[item.name];
        return !!(def && def.type === "weapon" && def.explosion > 0);
    }
    // Bag weapons with splash that our class can hold, highest level first.
    function splashWeapons() {
        return character.items.map(function (it, num) { return { it: it, num: num }; }).filter(function (x) {
            return isSplash(x.it) && util.weaponPower(x.it.name, 0, character.ctype) > 0;
        }).sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    }
    function wearingSplash() {
        return isSplash(character.slots && character.slots.mainhand);
    }
    function packWanted(e) {
        // Auto: the farm target, and any other kind in reach that passes the same safety check
        // (player decision 2026-11-18: pull the plain snakes along with the slow O-Snakes).
        if (ag.monsters === "auto") return !!auto.type && auto.mode !== "off" && (e.mtype === auto.type || kindOk(e.mtype));
        return !ag.monsters || !ag.monsters.length || ag.monsters.includes(e.mtype);
    }

    // ---- automatic Agitate decision (agitate.monsters "auto", player decisions 2026-11-18) ----
    //   allowed:  only safety decides - the farm target, not denied, no damage return, no boss
    //             (maxHp), no unknown abilities, slower than us, and the pack check
    //             (targeting.packVerdict) passes for at least 2 at once
    //   how many: the most the pack check allows (up to maxOnMe), scaled down by experience
    //   weapons:  splash when the learned splash neighbours per hit reach splashMin (measured
    //             with the usual weapons too: "would have hit"), until learnHits a guess from the
    //             spawn density; else the usual weapons
    //   learning: per monster kind, kept across restarts - splash per hit (rolling), low-HP
    //             moments (3 in 10 min: fewer at once), a death while agitating: no Agitate
    //             there for deathDenyMs
    const STATS_KEY = "agitate_stats:" + character.name;
    const stats = (function () { try { return get(STATS_KEY) || {}; } catch (e) { return {}; } })();
    let statsSavedAt = 0;
    function saveStats(force) {
        if (!force && Date.now() - statsSavedAt < 30 * 1000) return;
        statsSavedAt = Date.now();
        try { set(STATS_KEY, stats); } catch (e) { /* storage unavailable */ }
    }
    function statOf(type) {
        return stats[type] = stats[type] || { hits: 0, nsum: 0, scale: 1, lows: [], denyUntil: 0, calmSince: Date.now() };
    }
    function noteHit(type, neighbours) {
        if (!type) return;
        const st = statOf(type);
        st.hits = st.hits * 0.995 + 1;      // about the last 200 hits count
        st.nsum = st.nsum * 0.995 + neighbours;
        saveStats(false);
    }
    function noteLowHp(type) {
        if (!type) return;
        const st = statOf(type), now = Date.now();
        st.lows = (st.lows || []).filter(function (t) { return now - t < 10 * 60 * 1000; });
        if (st.lows.length && now - st.lows[st.lows.length - 1] < 20 * 1000) return;
        st.lows.push(now);
        st.calmSince = now;
        if (st.lows.length >= 3) {
            st.scale = Math.max(0.3, (st.scale || 1) * 0.7);
            st.lows = [];
            util.log("warrior", "agitate: " + type + " too hot - fewer at once (x" + st.scale.toFixed(2) + ")", "orange");
        }
        saveStats(true);
    }
    function scaleOf(type) {
        const st = statOf(type), now = Date.now();
        // Calm for 10 min: back up by 0.1.
        if ((st.scale || 1) < 1 && now - (st.calmSince || 0) > 10 * 60 * 1000) {
            st.scale = Math.min(1, st.scale + 0.1);
            st.calmSince = now;
            saveStats(true);
        }
        return st.scale || 1;
    }
    function spawnDense(type) {
        let dense = false;
        Object.keys(G.maps).forEach(function (m) {
            (G.maps[m].monsters || []).forEach(function (p) {
                if (p.type !== type || !p.boundary || (p.count || 1) < (ag.denseCount || 5)) return;
                const b = p.boundary, area = (b[2] - b[0]) * (b[3] - b[1]);
                if (Math.sqrt(area / (p.count || 1)) <= (ag.denseSpacing || 130)) dense = true;
            });
        });
        return dense;
    }
    function splashWorth(type) {
        const st = statOf(type);
        if (st.hits >= (ag.learnHits || 40)) return st.nsum / st.hits >= (ag.splashMin || 1);
        return spawnDense(type);
    }
    const safeCache = {}; // type -> { at, n }
    const safeLevel = {}; // type -> level of the strongest one in sight at the last check
    function safeLimit(type) {
        // Monsters level up while we fight them (2026-11-18: bats went from level 5 to 9 during
        // the pull and killed the warrior): judged by the strongest one in sight, every 10 s.
        const c = safeCache[type];
        if (c && Date.now() - c.at < 10 * 1000) return c.n;
        const def = G.monsters[type] || {};
        // Only those Agitate would reach (plus levelMargin px for ones walking in), not every one in sight.
        const reach = G.skills.agitate.range + (ag.levelMargin || 80);
        const live = Object.values(parent.entities || {}).filter(function (e) { return e && e.type === "monster" && e.mtype === type && !e.dead && util.distanceTo(e) <= reach; })
            .sort(function (a, b) { return (b.level || 1) - (a.level || 1); })[0];
        const e = live || { mtype: type, attack: def.attack, hp: def.hp, max_hp: def.hp, frequency: def.frequency, level: 1 };
        let n = 0;
        // A safety share on top (2026-11-18): the pack check assumes an HP potion on every
        // cooldown, but Agitate burns MP and both potions share one cooldown - a pull only counts
        // as safe at safetyShare of the HP the check allows.
        const allowed = character.max_hp * (((ctx.config.targeting || {}).live || {}).soloHpUse || 0.5) * (ag.safetyShare || 0.5);
        for (let k = ag.maxOnMe || 8; k >= 1; k--) {
            // Mana: about one Agitate every agitateEverySec while the stream runs; splash: the
            // learned (or guessed 1.0) extra targets per hit.
            const st = statOf(type);
            const v = ctx.targeting.packVerdict ? ctx.targeting.packVerdict(e, k, {
                mpPerSec: G.skills.agitate.mp / (ag.agitateEverySec || 6),
                splash: st.hits >= (ag.learnHits || 40) ? st.nsum / st.hits : (spawnDense(type) ? 1 : 0),
            }) : { ok: true, lost: 0 };
            if (v.ok && (v.lost || 0) <= allowed) { n = k; break; }
        }
        // Fear (server.js): more attackers of one damage type than our courage for it cuts our
        // attack to 60/40/20 % (2026-11-18: booboos deal pure damage, warrior pure courage 2 -
        // "You are getting scared" / "terrified"). Never more of them than courage + fearMax.
        const dtype = e.damage_type || def.damage_type || "physical";
        const courage = dtype === "pure" ? character.pcourage : dtype === "magical" ? character.mcourage : character.courage;
        if (typeof courage === "number") n = Math.min(n, courage + (ag.fearMax || 0));
        safeLevel[type] = live ? (live.level || 1) : 1;
        safeCache[type] = { at: Date.now(), n: n };
        return n;
    }
    function autoAllowed(type) {
        const def = G.monsters[type];
        if (!def || (ag.deny || []).includes(type) || def.cooperative) return { ok: false, why: "not for this kind" };
        if ((statOf(type).denyUntil || 0) > Date.now()) return { ok: false, why: "died here recently" };
        if (def.dreturn > 0 || (def.hp || 0) > (ag.maxHp || 50000)) return { ok: false, why: "damage return or boss" };
        const abil = Object.keys(def.abilities || {}).filter(function (a) { return !(ag.abilities || []).includes(a); });
        if (abil.length) return { ok: false, why: "abilities " + abil.join(",") };
        // Our usual speed, not the current one: Hard Shell slows us, and the decision flipped
        // to "off" mid-pull and swapped weapons (2026-11-18).
        speedRef = Math.max(speedRef, character.speed || 0);
        if ((def.speed || 0) >= speedRef * 0.9) return { ok: false, why: "as fast as we are" };
        const n = safeLimit(type);
        // No fixed level cap (player decision 2026-11-18): safeLimit judges the strongest one in
        // reach with its real stats - grown monsters fail it by themselves when they are too much.
        // agitate.maxLevel (a number) can still cap it by hand.
        if (typeof ag.maxLevel === "number" && (safeLevel[type] || 1) > ag.maxLevel) return { ok: false, why: "level " + safeLevel[type] + " in reach (max " + ag.maxLevel + ")" };
        if (n < 2) return { ok: false, why: "pack check allows " + n };
        return { ok: true, n: n };
    }
    const auto = { at: 0, type: null, mode: "off", why: "" };
    function farmType() {
        try { const fm = ctx.targeting.currentFarm(); return fm && !fm.any ? fm.monster : null; } catch (e) { return null; }
    }
    let speedRef = 0;
    function autoMode() {
        if (Date.now() - auto.at < 15 * 1000) return auto.mode;
        // While monsters are on us the decision stands (no weapon swap mid-fight) - only a
        // denied kind (death) ends it at once.
        // ...but not once the farm target changed (2026-11-19: the leader left for the mummies, the
        // warrior kept its booboo decision while booboos hit it and agitated more of them).
        if (auto.type && onMe().length && !((statOf(auto.type).denyUntil || 0) > Date.now()) && auto.type === farmType()) return auto.mode;
        auto.at = Date.now();
        const type = farmType();
        const a = type ? autoAllowed(type) : { ok: false, why: "no farm target" };
        const mode = !a.ok ? "off" : splashWorth(type) ? "splashstream" : "swords";
        const st = type ? statOf(type) : null;
        const why = !a.ok ? a.why : "up to " + Math.max(1, Math.floor(a.n * scaleOf(type))) + " at once, splash " +
            (st && st.hits >= (ag.learnHits || 40) ? (st.nsum / st.hits).toFixed(2) + " learned" : "guessed");
        if (type !== auto.type || mode !== auto.mode) util.log("warrior", "agitate auto: " + (type || "-") + " -> " + mode + " (" + why + ")", "yellow");
        auto.type = type; auto.mode = mode; auto.why = why;
        return mode;
    }
    // The current type's safe count, for the stream limit (null = no automatic cap).
    // Other kinds pulled along: each must pass the safety check itself (cached 10 s).
    const kindCache = {};
    function kindOk(type) {
        const c = kindCache[type];
        if (c && Date.now() - c.at < 10 * 1000) return c.ok;
        const ok = autoAllowed(type).ok;
        kindCache[type] = { at: Date.now(), ok: ok };
        return ok;
    }
    // The safe count for what is in reach now: the most careful of all kinds there.
    function autoCap() {
        if (ag.monsters !== "auto" || !auto.type) return null;
        const kinds = {};
        kinds[auto.type] = true;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (e && e.type === "monster" && !e.dead && util.distanceTo(e) <= G.skills.agitate.range && packWanted(e)) kinds[e.mtype] = true;
        });
        return Math.max(1, Math.min.apply(null, Object.keys(kinds).map(function (t) { return Math.floor(safeLimit(t) * scaleOf(t)); })));
    }
    // Auto: an Agitate needs the farm target among the free ones in reach (player decision
    // 2026-11-18): other kinds only come along. Plain snakes alone kept the warrior agitating at
    // the snake spot after the O-Snakes were gone, and the party came back instead of moving on.
    function farmTargetIn(list) {
        if (ag.monsters !== "auto" || !auto.type) return true;
        return list.some(function (m) { return m.mtype === auto.type; });
    }
    // A monster standing in a rage zone the team can't take (2026-11-22): the stream walked to the level-17 booboos
    // and Agitated them - warrior and ranger died before the leader had looked at the spot.
    function inBadZone(e) {
        return !!(ctx.targeting.failingZoneAt && ctx.targeting.failingZoneAt(util.xy(e)));
    }
    // Free monsters of the wanted kind around us (not fighting another player).
    function packAround(range) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.visible && packWanted(e) &&
                util.distanceTo(e) <= range && (!e.target || e.target === character.name) &&
                !(ctx.targeting.inOccupied && ctx.targeting.inOccupied(e)) && // another player's spot
                (e.target === character.name || !inBadZone(e));
        });
    }
    // Monsters Agitate would pull as well although we don't want them: other kinds (when
    // agitate.monsters lists some) and anything that returns damage - Agitate taunts all
    // within 320 px, at the crocs it pulled armadillos (dreturn 30) too (2026-11-18).
    function unwantedAround(range) {
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || util.distanceTo(e) > range) return false;
            if (e.target && e.target !== character.name) return false; // busy with another player
            const def = G.monsters[e.mtype] || {};
            return !packWanted(e) || def.dreturn > 0 || util.tooSpiky(ctx.config, e) || (e.target !== character.name && inBadZone(e));
        });
    }
    const onMe = util.attackersOnMe;
    // Hitbox edge to edge, like the server's splash check.
    function edge(a, b) {
        try { return parent.distance(a, b); } catch (e) {
            return Math.max(0, Math.hypot(a.real_x - b.real_x, a.real_y - b.real_y) - 20);
        }
    }
    // The splash radius we have - or, with our usual weapons ("swords"), the one the splash
    // weapons in the bag would give: the neighbour count then says what splash would have hit.
    function splashRadius() {
        if (character.explosion) return character.explosion / 3.6;
        let sum = 0;
        splashWeapons().slice(0, 2).forEach(function (x) {
            try { sum += parent.calculate_item_properties(x.it).explosion || 0; } catch (e) { sum += G.items[x.it.name].explosion || 0; }
        });
        return sum / 3.6;
    }
    function splashNeighbours(t, list) {
        const r = splashRadius();
        return list.filter(function (m) { return m !== t && edge(m, t) < r; }).length;
    }

    async function putOnSplash() {
        if (travelling()) return; // never on the way (see dropSplashOnTheWay)
        pack.busy = true;
        try {
            ctx.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            let w = splashWeapons();
            if (w[0]) await equip(w[0].num, "mainhand");
            w = splashWeapons(); // the bag changed: look again
            const off = character.slots && character.slots.offhand;
            if (w[0] && (!off || G.items[off.name].type === "weapon")) await equip(w[0].num, "offhand");
            util.log("warrior", "splash weapons on: " + ["mainhand", "offhand"].map(function (s) {
                const i = character.slots[s]; return i ? i.name + " +" + (i.level || 0) : "-";
            }).join(", ") + " (splash radius " + Math.round(splashRadius()) + " px)", "yellow");
        } catch (e) {
            util.log("warrior", "splash weapons: " + util.errReason(e), "orange");
        } finally {
            pack.busy = false;
        }
    }

    function centerOf(list) {
        let x = 0, y = 0;
        list.forEach(function (m) { const p = util.xy(m); x += p.x; y += p.y; });
        return { x: x / list.length, y: y / list.length };
    }
    // The point to Agitate from (player idea 2026-11-18): as many free pack monsters within
    // reach as possible, no unwanted one in reach, then the shortest walk - so we only go as
    // far into the pack as needed. Candidates on a grid around us (agitate.searchRadius,
    // gridStep), reachable in a straight line. { x, y, count, here } or null below minPack.
    function bestPullPoint() {
        const reach = G.skills.agitate.range - 10; // centre distance, a little inside the edge-to-edge 320
        const search = ag.searchRadius || 200, grid = ag.gridStep || 40;
        const me = util.xy(character);
        const pool = packAround(reach + search).map(util.xy);
        if (pool.length < (ag.minPack || 3)) return null;
        const bad = unwantedAround(reach + search + 40).map(util.xy);
        let best = null;
        for (let gx = -search; gx <= search; gx += grid) {
            for (let gy = -search; gy <= search; gy += grid) {
                const d = Math.hypot(gx, gy);
                if (d > search) continue;
                const x = me.x + gx, y = me.y + gy;
                const dists = pool.map(function (p) { return Math.hypot(p.x - x, p.y - y); }).filter(function (v) { return v <= reach; });
                const count = dists.length;
                if (count < (ag.minPack || 3)) continue;
                // Count against the average way of the pulled monsters (player decision 2026-11-18:
                // short, even ways so they arrive together, weighted more than one more monster):
                // one monster more is worth agitate.avgPerMonster px less average way. Our own walk
                // only breaks ties.
                const avg = dists.reduce(function (s, v) { return s + v; }, 0) / count;
                const score = count - avg / (ag.avgPerMonster || 60);
                if (best && (score < best.score - 0.02 || (Math.abs(score - best.score) <= 0.02 && d >= best.d))) continue;
                if (bad.some(function (p) { return Math.hypot(p.x - x, p.y - y) <= reach + 20; })) continue;
                if (d > 0 && !can_move_to(x, y)) continue; // checked last: the costly one
                best = { x: x, y: y, count: count, d: d, avg: avg, score: score };
            }
        }
        if (best) best.here = best.d <= (ag.centerWithin || 20);
        return best;
    }

    // ---- gap step (player idea 2026-11-22) ---------------------------------------------------
    // The splash hits what stands around the TARGET (server: within explosion / 3.6 px, hitbox to hitbox),
    // there is no facing. With 3 scorpions on one side and 1 behind us, the one behind never takes splash.
    // A step into the emptiest direction - the middle of the largest angle gap between the monsters on us -
    // puts them all on the side we came from: they follow and bunch up there. Splash weapons on, at least
    // gapStep.minOnMe on us, and the best target's splash misses one of those in our range; at most every
    // everyMs, earlier (from minMs) only when all of them are in range again. Not into free monsters, a
    // failing rage zone, or (member) off the leash.
    const gs = ag.gapStep || {};
    let lastGap = 0, gapSteps = 0, gapLogAt = Date.now();
    function gapStep(mine, covered) {
        if (gs.enabled === false || is_moving(character)) return false;
        const inRange = mine.filter(function (m) { return is_in_range(m); });
        if (mine.length < (gs.minOnMe || 3) || covered >= inRange.length) return false;
        const now = Date.now();
        const since = now - lastGap;
        if (since < (gs.minMs || 2500) || (since < (gs.everyMs || 4000) && inRange.length < mine.length)) return false;
        const me = util.xy(character);
        const angles = mine.map(function (m) { const p = util.xy(m); return Math.atan2(p.y - me.y, p.x - me.x); }).sort(function (a, b) { return a - b; });
        const gaps = angles.map(function (a, i) {
            const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
            return { size: next - a, mid: a + (next - a) / 2 };
        }).sort(function (a, b) { return b.size - a.size; });
        const step = gs.step || 50;
        const free = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        }).map(util.xy);
        const lead = ctx.party.enabled && ctx.party.isMember && !ctx.party.detached() ? ctx.party.leaderInfo() : null;
        const leash = (ctx.config.party && ctx.config.party.leash) || 300;
        for (const g of gaps) {
            const x = me.x + Math.cos(g.mid) * step, y = me.y + Math.sin(g.mid) * step;
            if (!can_move_to(x, y)) continue;
            if (free.some(function (q) { return Math.hypot(q.x - x, q.y - y) < 80; })) continue; // would pull a free one
            if (ctx.targeting.failingZoneAt && ctx.targeting.failingZoneAt({ x: x, y: y })) continue;
            if (lead && lead.map === character.map && Math.hypot(lead.x - x, lead.y - y) > leash) continue;
            lastGap = now;
            gapSteps++;
            quiet(move(x, y));
            if (now - gapLogAt > 10 * 60 * 1000) {
                util.log("warrior", "gap steps: " + gapSteps + " in " + Math.round((now - gapLogAt) / 60000) + " min (splash per hit " + splashAvg() + ")", "white");
                gapLogAt = now; gapSteps = 0;
            }
            util.status("gap step: " + mine.length + " on us, splash took " + covered, "orange");
            return true;
        }
        return false;
    }
    function splashAvg() {
        const st = auto.type ? statOf(auto.type) : null;
        return st && st.hits ? (st.nsum / st.hits).toFixed(2) : "?";
    }

    // A step away from the pack's middle: it follows from one side and bunches up.
    function stepAway(list, stepPx) {
        const me = util.xy(character);
        const mid = centerOf(list);
        const cx = mid.x, cy = mid.y;
        let dx = me.x - cx, dy = me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const step = stepPx || ag.kiteStep || 120;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
            const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
            const x = me.x + ux * step, y = me.y + uy * step;
            if (can_move_to(x, y)) {
                quiet(move(x, y));
                pack.lastRegroup = pack.gatherAt = Date.now();
                return true;
            }
        }
        return false;
    }

    function finishPull(reason) {
        const secs = Math.round((Date.now() - pack.since) / 1000);
        const dead = pack.pulled.filter(function (id) { const e = parent.entities[id]; return !e || e.dead; }).length;
        const avg = pack.attacks ? (pack.neighborSum / pack.attacks).toFixed(2) : "0";
        const hpUsed = Math.round((pack.startHp - character.hp) / character.max_hp * 100);
        util.log("warrior", "pull done [" + agMode() + "] (" + reason + "): " + pack.pulled.length + " pulled, " + dead + " dead, " + secs + " s, " +
            pack.attacks + " hits, " + avg + " splash neighbours per hit, HP used " + hpUsed + "%", "green");
        pack.state = "idle";
        // Keep the splash weapons a little while for the next pull, then the usual ones go back on.
        if (splashMode()) ctx.gear.holdWeapons(ag.keepMs || 60 * 1000);
    }

    // Returns true while the pack mode runs this tick (the normal combat waits).
    // "swords": no pull point, no waiting - normal combat where we stand, and Agitate on every
    // cooldown that finds free monsters, so a steady stream walks to us (player idea
    // 2026-11-18: the pull-point version lost 15% to single targets at the arctic bees, its
    // waiting cost more than the walking it saved). Only while few are on us already.
    let lastStreamLog = 0;
    // How many may be on us before the next Agitate (player decision 2026-11-18): with splash
    // more pay off (splashOnMe), during Sugar Rush (3x attack speed) sugarBonus more; low HP
    // fewer (below lowHp: 2, below minHp of the pull mode none) - also saves potions.
    function streamLimit(splash) {
        // Auto swords use the splash count too (player decision 2026-11-18): the splash per hit is
        // measured with the swords as well, and with only 3 on us at most 2 neighbours were possible
        // - the learned value stayed too low to ever switch (snakes: 0.46). The pack check (autoCap)
        // still caps it.
        let n = (splash || autoDecides()) ? (ag.splashOnMe || 5) : (ag.streamOnMe || 3);
        const cap = autoCap(); // auto: what the pack check and experience allow (party too, 2026-11-18)
        if (splash && character.s && character.s.sugarrush) n += (ag.sugarBonus || 2);
        // A party uses the same limits as solo (player decision 2026-11-18, no partyOnMe boost).
        const hp = util.hpRatio();
        if (hp < (ag.streamStopHp || 0.4)) return 0;
        if (hp < (ag.streamLowHp || 0.6)) n = Math.min(n, 2);
        if (cap !== null) n = Math.min(n, cap);
        return n;
    }
    function streamAgitate(splash) {
        if (!util.canCast("agitate") || character.mp < G.skills.agitate.mp + reserve()) return;
        // Not on the way: a route walk (smart_move) pulled bats before we reached the spot (2026-11-18).
        if (typeof smart !== "undefined" && smart.moving) return;
        const coming = onMe().length;
        if (coming >= streamLimit(splash)) return; // Agitate only while fewer than the limit attack us
        const fresh = packAround(G.skills.agitate.range).filter(function (m) { return m.target !== character.name; });
        if (fresh.length < (ag.streamFrom || 1) || unwantedAround(G.skills.agitate.range).length) return;
        if (!farmTargetIn(fresh)) return;
        // Agitate taunts everything in reach, not just up to our limit: the safe count must cover
        // all of them (2026-11-18: "up to 2" booboos, but 5 stood in reach - the warrior died).
        const cap = autoCap();
        if (cap !== null && coming + fresh.length > cap) return;
        // Auto: every single cast checks the levels too - the decision is held during fights, and
        // two grown bats came along with a stream pull (2026-11-18).
        if (ag.monsters === "auto" && typeof ag.maxLevel === "number" && fresh.some(function (m) { return (m.level || 1) > ag.maxLevel; })) return;
        use_skill("agitate").catch(function () {});
        lastAgitate = { at: Date.now(), type: fresh[0].mtype };
        if (Date.now() - lastStreamLog > 5 * 60 * 1000) {
            lastStreamLog = Date.now();
            util.log("warrior", "agitate stream: " + fresh.length + " more on the way (" + coming + " on us)", "white");
        }
    }

    // "stream" fighting (player rules 2026-11-18): hit what is in range (ones on us first,
    // nearest first); with nobody in range, walk to the nearest monster - on its way to us
    // or free - instead of waiting. False when nothing is around (normal search takes over).
    let streamWalkTo = null;
    function streamFight(splash) {
        const inParty = ctx.party.enabled;
        const around = Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible) return false;
            if (e.target === character.name) return true;
            // Free ones only of the farm target: other kinds come along through Agitate and are
            // fought once they are on us (2026-11-18: following the priest through the goo field
            // the warrior kept hitting goos and fell behind).
            if (ag.monsters === "auto" && auto.type && e.mtype !== auto.type) return false;
            return packWanted(e) && !e.target && !(ctx.targeting.inOccupied && ctx.targeting.inOccupied(e)) &&
                !util.tooSpiky(ctx.config, e) && util.distanceTo(e) <= 600 && !inBadZone(e);
        }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
        if (!around.length) return false;
        const inRange = around.filter(function (m) { return is_in_range(m); });
        // In a party we never walk off on our own: the normal combat (follow, assist) takes over.
        if (inRange.length) {
            let t = inRange.find(function (m) { return m.target === character.name; }) || inRange[0];
            if (splash) {
                // Splash stream: the one in range with the most others in the splash radius.
                const mine = onMe();
                let bestN = -1;
                inRange.forEach(function (m) { const n = splashNeighbours(m, mine); if (n > bestN) { bestN = n; t = m; } });
                // Some on us out of that splash (e.g. one behind us): a step into the emptiest direction first.
                if (gapStep(mine, bestN + 1)) return true;
            }
            if (get_targeted_monster() !== t) change_target(t);
            // Fired by the strike loop the moment the cooldown ends (2026-11-20).
            ctx.strike.attack(t, function (m) { noteHit(m.mtype, splashNeighbours(m, onMe())); }); // learning: (would-have) splash per hit
            streamWalkTo = null;
            util.status("agitate stream: " + t.mtype + " (" + onMe().length + " on us)", "green");
            return true;
        }
        // Splash: not simply the nearest one, the one with the most others around it (a clump
        // is worth a few steps more - player idea 2026-11-18): neighbours within clumpRadius
        // count clumpStep px of way each.
        let goal = around[0];
        if (splash && ag.streamToClump !== false) {
            let bestScore = -Infinity;
            around.forEach(function (m) {
                const q = util.xy(m);
                const n = around.filter(function (o) { return o !== m && Math.hypot(util.xy(o).x - q.x, util.xy(o).y - q.y) <= (ag.clumpRadius || 60); }).length;
                const score = n * (ag.clumpStep || 80) - util.distanceTo(m);
                if (score > bestScore) { bestScore = score; goal = m; }
            });
        }
        // Only goals we can walk to in a straight line: path finding to unreachable ones in the
        // cave ("Lost the path..." x12) left us standing while the bats hit us (2026-11-18).
        if (!can_move_to(util.xy(goal).x, util.xy(goal).y)) {
            goal = around.find(function (m) { const q = util.xy(m); return can_move_to(q.x, q.y); });
            if (!goal) return false; // nothing reachable: the normal combat decides
        }
        const p = util.xy(goal);
        // In a party like solo (player request 2026-11-18), but only where it is safe: every free
        // monster within Agitate reach of the goal plus the ones on us must fit the safe count,
        // and the goal stays on the leash - the warrior walked into the middle of 5 booboos.
        if (inParty && ctx.party.isMember && !ctx.party.detached()) {
            const cap = autoCap();
            const free = Object.values(parent.entities || {}).filter(function (e) {
                return e && e.type === "monster" && !e.dead && !e.target && Math.hypot(util.xy(e).x - p.x, util.xy(e).y - p.y) <= G.skills.agitate.range;
            }).length;
            const lead = ctx.party.leaderInfo();
            const leash = (ctx.config.party && ctx.config.party.leash) || 300;
            if (cap === null || free + onMe().length > cap) return false;
            if (lead && (lead.map !== character.map || Math.hypot(lead.x - p.x, lead.y - p.y) > leash)) return false;
        }
        if (!is_moving(character) || !streamWalkTo || Math.hypot(streamWalkTo.x - p.x, streamWalkTo.y - p.y) > 25) {
            streamWalkTo = p;
            quiet(move(p.x, p.y));
        }
        util.status("agitate stream: to " + (goal === around[0] ? "the nearest " : "a clump of ") + goal.mtype, "orange");
        return true;
    }

    let lastAgitate = { at: 0, type: null };

    // Escape (solo, any mode; 2026-11-18 after three deaths at the bats): below escapeHp with
    // monsters on us that are all slower than we are, run - and keep running - away from them;
    // no swings meanwhile (monsters drop a chase that gets too long). Then the normal rest heals
    // us up. Cornered (no free step) or facing faster monsters: fight on with Hard Shell and potions.
    // Out of reach, not just out of melee (2026-11-22: two level-15 bbpompoms shoot 280 px; the escape
    // ended at 250 px as "nobody close", the warrior fought back at 6 % HP and the next escape ended the
    // same way - ten times until he died). So the escape lasts while anyone is on us and we are low:
    //   done when nobody targets us any more, or nobody can reach us (its range + escapeMargin, at least
    //   escapeClear) and the potions brought us back to escapeUntilHp, or after escapeMaxMs.
    const esc = { on: false, start: 0 };
    function reachOf(e) {
        return Math.max(ag.escapeClear || 250, (e.range || (G.monsters[e.mtype] || {}).range || 0) + (ag.escapeMargin || 100));
    }
    // A step away from them, all around (2026-11-22: in the bat cave five directions within 70° of
    // "straight away" at 200 px were all blocked - "cornered" four times, then dead). 16 directions,
    // 200/120/70 px; the step that leaves the most room to the nearest of them wins.
    // Protective Agitate (2026-11-22): Agitate takes EVERY monster within 320 px, not only those on our allies.
    // Only when the team model (mobbing, fear, the priest's healing) says we can hold all of them at once -
    // the ones already on us included; otherwise Taunt takes them one by one. Logged once a minute.
    let protLogged = 0;
    function protectiveAgitateOk() {
        if (!ctx.targeting || !ctx.targeting.teamVerdict) return true;
        const all = Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead) return false;
            if (e.target === character.name) return true;
            return util.distanceTo(e) <= G.skills.agitate.range && (!e.target || ctx.party.memberNames().includes(e.target));
        });
        if (!all.length) return true;
        const strongest = all.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
        const v = ctx.targeting.teamVerdict(strongest.mtype, strongest, { pull: all.length });
        if (v.ok || /waiting for the team/.test(v.why || "")) return true; // no stats yet: as before
        if (Date.now() - protLogged > 60 * 1000) {
            protLogged = Date.now();
            util.log("warrior", "no protective Agitate: " + all.length + " would be on us (" + v.why + ") - taunting one by one", "white");
        }
        return false;
    }
    // In a party, the nearest living healer (heal stat) and its reach: escape steps stay within it.
    function healerNear() {
        if (!ctx.party.enabled) return null;
        let best = null;
        ctx.party.memberNames().forEach(function (n) {
            if (n === character.name) return;
            const p = get_player(n);
            if (!p || p.rip || !util.isHealer(p)) return;
            if (!best || util.distanceTo(p) < util.distanceTo(best)) best = p;
        });
        return best ? { x: util.xy(best).x, y: util.xy(best).y, reach: Math.max(80, (best.range || 150) * 0.9) } : null;
    }
    // Other dangers an escape must not run into (2026-11-22): twice the warrior died to Fire Spirits (range 280,
    // 320 magical with rpiercing 320, burn) ~300 px south of the Giant Scorpions - the step only looked at the
    // monsters on us. Free monsters not on us keep their range + escapeKeepOff px (at least 150) clear; aggressive
    // spawns of other kinds on this map (their boxes) escapeKeepOff px. A point inside counts as a last resort only.
    function escapeDangers(list) {
        const keep = ag.escapeKeepOff || 80;
        const mons = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && list.indexOf(e) === -1 && e.target !== character.name;
        }).map(function (e) {
            const d = G.monsters[e.mtype] || {};
            const p = util.xy(e);
            const danger = (d.aggro || 0) > 0 || (d.rage || 0) > 0 || !!(d.abilities && Object.keys(d.abilities).length);
            return { x: p.x, y: p.y, r: danger ? Math.max(150, (e.range || d.range || 20) + keep) : 60 };
        });
        const onTypes = {};
        list.forEach(function (m) { onTypes[m.mtype] = true; });
        const boxes = [];
        ((G.maps[character.map] || {}).monsters || []).forEach(function (p) {
            const d = G.monsters[p.type] || {};
            if (onTypes[p.type] || !((d.aggro || 0) > 0 || (d.rage || 0) > 0) || d.cooperative) return;
            util.spawnBoxes(p, character.map).forEach(function (b) {
                boxes.push([b[0] - keep, b[1] - keep, b[2] + keep, b[3] + keep]);
            });
        });
        return function (x, y) {
            if (mons.some(function (m) { return Math.hypot(m.x - x, m.y - y) < m.r; })) return true;
            return boxes.some(function (b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; });
        };
    }
    function escapeStep(list) {
        const me = util.xy(character);
        const pts = list.map(util.xy);
        const healer = healerNear();
        const risky = escapeDangers(list);
        let best = null, bestRoom = -Infinity;
        [ag.escapeStep || 200, 120, 70].forEach(function (step) {
            if (best && bestRoom > -500) return; // a longer step that works beats a shorter one (not a risky one)
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * step, y = me.y + Math.sin(a) * step;
                if (!can_move_to(x, y)) continue;
                let room = Math.min.apply(null, pts.map(function (p) { return Math.hypot(p.x - x, p.y - y); }));
                const now = Math.min.apply(null, pts.map(function (p) { return Math.hypot(p.x - me.x, p.y - me.y); }));
                if (room <= now) continue; // not away from them
                // Party: out of the healer's reach only if nothing else is left (2026-11-22).
                if (healer && Math.hypot(healer.x - x, healer.y - y) > healer.reach) room -= 1000;
                // Towards other dangers (the point or the middle of the way): only if nothing else is left.
                if (risky(x, y) || risky((me.x + x) / 2, (me.y + y) / 2)) room -= 2000;
                if (room > bestRoom) { bestRoom = room; best = { x: x, y: y }; }
            }
        });
        if (!best) return false;
        quiet(move(best.x, best.y));
        return true;
    }
    // Party (2026-11-22, player decision): the warrior holds every monster, so when the priest's healing can't
    // keep up he runs too - they all follow him, the mobbing combo runs out after 5 s without a hit, and the
    // priest heals him meanwhile (the step stays within the healer's range where it can). Only when the live
    // check - healing included - says we die within escapeTtdSec, never just for low HP the priest covers.
    function escapeTick() {
        const inParty = ctx.party.enabled;
        if (inParty && ag.partyEscape === false) return false;
        const now = Date.now();
        const on = onMe();
        speedRef = Math.max(speedRef, character.speed || 0);
        if (!esc.on) {
            if (!on.length || now < (esc.retryAt || 0)) return false;
            // Also above escapeHp when a mob (more than 3 on us, util.mobbing) would kill us within
            // escapeTtdSec at the live combo (2026-11-22).
            let mobbed = null;
            const low = util.hpRatio() < (ag.escapeHp || 0.3);
            if ((on.length > 3 && util.hpRatio() < (ag.escapeMobHp || 0.7)) || (inParty && low)) {
                const dz = ctx.targeting.liveDanger ? ctx.targeting.liveDanger() : null;
                if (dz && dz.ttd < (ag.escapeTtdSec || 8)) mobbed = dz;
            }
            if (inParty ? !mobbed : (!low && !mobbed)) return false;
            // Scared (fear, 2026-11-22): the server takes 20/40/70+ off our speed - then our real speed counts.
            const mySpeed = character.fear ? Math.min(speedRef, character.speed || 0) : speedRef;
            if (on.some(function (m) { return (m.speed || (G.monsters[m.mtype] || {}).speed || 0) >= mySpeed * 0.8; })) return false;
            esc.on = true;
            esc.start = now;
            util.log("warrior", "escaping at " + Math.round(util.hpRatio() * 100) + "% HP from " + on.length + "x " + on[0].mtype +
                (mobbed ? " (" + (mobbed.mult > 1 ? "mobbed x" + mobbed.mult.toFixed(1) + ", " : "") + Math.round(mobbed.dps) + " dmg/s vs " +
                    Math.round(mobbed.sustain) + " healed/s - dead in ~" + Math.round(mobbed.ttd) + " s)" : ""), "red");
        }
        const inReach = on.filter(function (e) { return util.distanceTo(e) < reachOf(e); });
        // Healed: back at escapeUntilHp and the mobbing combo has run out (5 s without a mobbed hit).
        const healed = util.hpRatio() >= (ag.escapeUntilHp || 0.6) && !util.mobNow(0).combo;
        const why = !on.length ? "nobody on us" : !inReach.length && healed ? "out of reach, healed" :
            now - esc.start > (ag.escapeMaxMs || 45000) ? "time up" : null;
        if (why) {
            esc.on = false;
            if (is_moving(character)) stop();
            util.log("warrior", "escape done (" + why + ") at " + Math.round(util.hpRatio() * 100) + "% HP after " + Math.round((now - esc.start) / 1000) + " s", "yellow");
            return false;
        }
        // Out of their reach but still low: no swing, the potions work; we step on when one comes close.
        if (!inReach.length) {
            util.status("escaped, healing " + Math.round(util.hpRatio() * 100) + "%", "orange");
            return true;
        }
        if (!is_moving(character) && !escapeStep(inReach)) {
            esc.on = false; // cornered: fight (a new try in 5 s)
            esc.retryAt = now + 5000;
            util.log("warrior", "escape: cornered at " + Math.round(util.hpRatio() * 100) + "% HP - fighting on", "orange");
            return false;
        }
        util.status("escaping " + Math.round(util.hpRatio() * 100) + "%", "red");
        return true;
    }
    // Splash weapons only where splash is right (player decision 2026-11-18): away from the farm
    // target - travelling, an event, a fight with something else - the usual weapons go back on.
    // On the way to the Phoenix a Big Bird taunted off the priest got the Lolipops, and their
    // splash pulled every Big Bird spawning next to the party.
    // Splash without Agitate (player request 2026-11-19): with splashOnlyFrom or more monsters on
    // us of a kind whose splash pays (measured, or guessed from the spawn density) the Lolipops go
    // on even where Agitate is not allowed - 6-7 mummies stood on the warrior and he hit them with
    // swords. Held a few seconds after the crowd thins out (no swapping back and forth).
    let splashOnlyUntil = 0;
    // What the splash would pull (2026-11-22): the splash hits the free monsters next to our targets, they attack us,
    // and their neighbours get hit next - at the X-scorpions 3 on us became 6 and the warrior died (the team model
    // says no to 6 at once: 2746 dmg/s vs 1492 healing/s). Those on us plus every free monster chained within the
    // splash radius (+ splashPullSlack px for walking in), three rounds deep.
    function splashPull(on) {
        const r = splashRadius() + (ag.splashPullSlack || 40);
        const free = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        });
        const set = on.slice();
        let frontier = on.slice();
        for (let round = 0; round < 3 && frontier.length; round++) {
            const next = free.filter(function (m) {
                return set.indexOf(m) === -1 && frontier.some(function (t) { return edge(m, t) < r; });
            });
            next.forEach(function (m) { set.push(m); });
            frontier = next;
        }
        return set;
    }
    // Would we survive all of them? Party: the team model (healing counts), solo: the pack check's safe count.
    let splashDenyLog = 0;
    function splashPullOk(type, all) {
        const ofType = all.filter(function (m) { return m.mtype === type; });
        const strongest = (ofType.length ? ofType : all).slice().sort(function (a, b) { return (b.level || 1) - (a.level || 1); })[0];
        let v = null;
        if (ctx.party.enabled && ctx.targeting.teamVerdict) {
            v = ctx.targeting.teamVerdict(type, strongest, { pull: all.length });
            if (!v.ok && /waiting for the team|not in yet/.test(v.why || "")) v = null; // no team stats yet: the solo count
        }
        if (!v) {
            const n = safeLimit(type);
            v = all.length <= n ? { ok: true } : { ok: false, why: "pack check allows " + n };
        }
        if (!v.ok && Date.now() - splashDenyLog > 30 * 1000) {
            splashDenyLog = Date.now();
            util.log("warrior", "no splash: it would pull " + all.length + " (" + v.why + ")", "orange");
        }
        return v.ok;
    }
    // On the way (a path walk: an event call, a spot change, following the leader - 2026-11-22): no splash weapons.
    // Leaving the Giant Scorpions for the Phoenix, the scorpions followed, the warrior defended himself with the
    // Lolipops on - their splash could pull the Fire Spirits along the way, and they slow us down too.
    function travelling() {
        return typeof smart !== "undefined" && !!smart.moving;
    }
    let travelOffLog = 0;
    function dropSplashOnTheWay() {
        if (!travelling() || !wearingSplash()) return;
        splashOnlyUntil = 0;
        if (ctx.gear.weaponsHeld()) ctx.gear.holdWeapons(0); // the next equip pass puts the usual weapons back on
        if (Date.now() - travelOffLog > 30 * 1000) {
            travelOffLog = Date.now();
            util.log("warrior", "splash weapons off: on the way", "white");
        }
    }
    function splashOnly() {
        if (travelling()) { splashOnlyUntil = 0; return false; }
        if (ag.monsters !== "auto" || agOverride() || !(ag.splashOnlyFrom > 0)) return false;
        const on = onMe();
        if (on.length >= ag.splashOnlyFrom) {
            const count = {};
            on.forEach(function (m) { count[m.mtype] = (count[m.mtype] || 0) + 1; });
            const type = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
            if (splashWorth(type)) {
                if (splashPullOk(type, splashPull(on))) splashOnlyUntil = Date.now() + (ag.splashOnlyHoldMs || 8000);
                else splashOnlyUntil = 0; // too many would come: the usual weapons (the hold ends at once)
            }
        }
        return Date.now() < splashOnlyUntil;
    }
    function releaseSplash() {
        if (splashOnly()) {
            if (!wearingSplash() && splashWeapons().length && !pack.busy) {
                util.log("warrior", "splash weapons on: " + onMe().length + " on us (without Agitate)", "white");
                putOnSplash();
            }
            if (wearingSplash()) ctx.gear.holdWeapons(ag.keepMs || 60 * 1000);
            return;
        }
        if (ag.monsters === "auto" && !agOverride() && wearingSplash() && ctx.gear.weaponsHeld()) {
            ctx.gear.holdWeapons(0);
            util.log("warrior", "splash weapons off (no farm target around)", "white");
        }
    }
    function packTick() {
        if (splashOnly()) releaseSplash(); // puts the Lolipops on (also in a swords stream)
        if (!packOn()) { releaseSplash(); return false; }
        // A roaming boss waiting for the team in reach: no Agitate (it would open the fight alone, 2026-11-21).
        if (ctx.targeting && ctx.targeting.heldBossNear && ctx.targeting.heldBossNear(G.skills.agitate.range || 300)) return false;
        // Mobbing live (2026-11-22): more than 3 on us and the live combo would kill us within mobStopTtdSec -
        // no Agitate (it only adds to the mob); the normal combat kills those on us until 3 are left.
        if (onMe().length > 3 && ctx.targeting && ctx.targeting.liveDanger) {
            const dz = ctx.targeting.liveDanger();
            if (dz.ttd < (ag.mobStopTtdSec || 20)) {
                util.status("mobbed x" + dz.mult.toFixed(1) + ": no Agitate", "orange");
                return false;
            }
        }
        // Spot check from the edge still open (2026-11-22): no pull before the spot is judged, unless monsters are on us.
        if (ctx.targeting && ctx.targeting.spotGate && !onMe().length) {
            let fm = null;
            try { fm = ctx.targeting.farmNow(); } catch (e) { fm = null; }
            if (fm && ctx.targeting.spotGate(fm)) { releaseSplash(); return false; }
        }
        // Learning: a low-HP moment under attack counts against that monster kind.
        if (util.hpRatio() < (ag.streamStopHp || 0.4)) {
            const on = onMe();
            if (on.length) noteLowHp(on[0].mtype);
        }
        // Auto: the stream runs only where the farm target is (player report 2026-11-18): other
        // harmless kinds only come along. With booboo as the target the stream walked from goo
        // clump to goo clump in town instead of letting the normal combat travel to Spooky Town.
        // Without the farm target around the normal combat fights whatever is on us, with the
        // usual weapons.
        if (ag.monsters === "auto" && auto.type && !Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && !e.dead && e.mtype === auto.type && util.distanceTo(e) <= 600;
        })) { releaseSplash(); return false; }
        // A party member behind the leader catches up first (the leash), unless monsters are on us.
        // (After the farm-target check: following the priest out of the bat cave the Lolipops
        // stayed on until their hold ran out, 2026-11-18.)
        if (ctx.party.isMember && !ctx.party.detached() && !onMe().length) {
            const lead = ctx.party.leaderInfo();
            const leash = (ctx.config.party && ctx.config.party.leash) || 300;
            if (lead && (lead.map !== character.map || Math.hypot(lead.x - character.x, lead.y - character.y) > leash)) return false;
        }
        if (effectiveMode() === "splashstream") {
            // Stream with the splash weapons on (player test 2026-11-18).
            if (!wearingSplash()) {
                if (!splashWeapons().length) return false;
                if (!pack.busy) putOnSplash();
                return true;
            }
            ctx.gear.holdWeapons(ag.keepMs || 60 * 1000);
            streamAgitate(true);
            return streamFight(true);
        }
        if (ctx.party.enabled) {
            if (effectiveMode() === "swords") { streamAgitate(); return streamFight(); }
            return false; // pull-point modes are solo only
        }
        if (agMode() === "swords" && (ag.swords || "stream") === "stream") {
            streamAgitate();
            return streamFight();
        }
        if (pack.busy) return true;
        const now = Date.now();
        if (pack.state === "idle") {
            const free = packAround(G.skills.agitate.range);
            if ((ag.gather || "center") !== "center" && free.length < (ag.minPack || 3)) return false; // "center": bestPullPoint looks wider
            if (util.hpRatio() < (ag.minHp || 0.8) || !util.canCast("agitate") || character.mp < G.skills.agitate.mp) return false;
            // "center": the best place to Agitate from (most pack monsters in reach, nothing
            // unwanted, shortest walk) - see bestPullPoint.
            const spot = (ag.gather || "center") === "center" ? bestPullPoint() : null;
            if ((ag.gather || "center") === "center" && !spot) return false; // no place with a pack and nothing unwanted
            const others = spot ? [] : unwantedAround(G.skills.agitate.range);
            if (others.length) {
                util.status("agitate: waiting - " + others.length + "x " + others[0].mtype + " in reach", "white");
                return false; // normal combat meanwhile; the next round may stand better
            }
            if (splashMode() && !wearingSplash()) {
                if (!splashWeapons().length) {
                    if (!pack.noWeaponsLogged) util.log("warrior", "agitate mode: no splash weapon in the bag", "orange");
                    pack.noWeaponsLogged = true;
                    return false;
                }
                putOnSplash();
                return true;
            }
            // "center" (default since 2026-11-18): walk to the best pull point first - only as
            // far as needed, so aggressive monsters don't start towards us before the Agitate
            // and arrive one by one (the arctic bees came from 50-300 px and died alone).
            if (spot && !spot.here) {
                if (!is_moving(character) || !pack.walkTo || Math.hypot(pack.walkTo.x - spot.x, pack.walkTo.y - spot.y) > 40) {
                    pack.walkTo = { x: spot.x, y: spot.y };
                    quiet(move(spot.x, spot.y));
                }
                util.status("agitate: to the pull point (" + spot.count + ")", "orange");
                return true;
            }
            if (!farmTargetIn(packAround(G.skills.agitate.range))) return false; // only other kinds here
            if (spot && is_moving(character)) stop();
            pack.walkTo = null;
            if (util.canCast("warcry") && character.mp >= G.skills.agitate.mp + G.skills.warcry.mp) use_skill("warcry").catch(function () {});
            use_skill("agitate").catch(function () {});
            lastAgitate = { at: now, type: (spot && auto.type) || (packAround(G.skills.agitate.range)[0] || {}).mtype || null };
            if (splashMode()) ctx.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            const pulledNow = packAround(G.skills.agitate.range);
            pack.pulled = pulledNow.map(function (m) { return m.id; });
            pack.since = now; pack.startHp = character.hp; pack.attacks = 0; pack.neighborSum = 0; pack.recent = [];
            const kinds = {};
            pulledNow.forEach(function (m) { kinds[m.mtype] = (kinds[m.mtype] || 0) + 1; });
            util.log("warrior", "Agitate: " + Object.keys(kinds).map(function (k) { return kinds[k] + "x " + k; }).join(", "), "yellow");
            if ((ag.gather || "center") === "step") pack.state = stepAway(pulledNow) ? "gather" : "fight";
            else {
                // A short step out of the pack: the splash works forward (around the target, the
                // warrior's own body blocks the far side), so they should come from one side.
                pack.state = ag.sideStep && stepAway(pulledNow, ag.sideStep) ? "gather" : "fight";
            }
            pack.lastAdjust = now;
            return true;
        }
        const mine = onMe();
        if (util.hpRatio() < (ag.abortHp || 0.3) && mine.length) {
            // Too hot: walk away from the pack (most pack monsters are slower than us).
            if (!is_moving(character)) stepAway(mine);
            util.status("agitate: backing off", "red");
            return true;
        }
        if (pack.state === "gather") {
            if (is_moving(character) && now - pack.gatherAt < (ag.gatherMs || 2500)) {
                util.status("agitate: gathering the pack", "orange");
                return true;
            }
            if (is_moving(character)) stop();
            pack.state = "fight";
        }
        // fight
        if (!mine.length) {
            if (now - pack.since > 3000) finishPull("no monster left on us");
            return pack.state !== "idle";
        }
        let best = null, bestN = -1;
        mine.forEach(function (m) {
            if (!is_in_range(m)) return;
            const n = splashNeighbours(m, mine);
            if (n > bestN || (n === bestN && best && m.hp < best.hp)) { best = m; bestN = n; }
        });
        if (!best && mine.length > (ag.chaseFrom || 3)) {
            util.status("agitate: waiting for the pack (" + mine.length + ")", "orange");
            return true;
        }
        // "chain" (player idea 2026-11-18): with only stragglers left, the next pull starts at
        // once - new monsters have spawned meanwhile, the stragglers follow us into the new pack
        // and there is no phase of fighting just one or two.
        if (agMode() === "chain" && mine.length <= (ag.chaseFrom || 3) && now - pack.since > 3000 &&
            util.canCast("agitate") && character.mp >= G.skills.agitate.mp + reserve()) {
            const next = bestPullPoint();
            const freshCount = next ? next.count - mine.filter(function (m) { return Math.hypot(util.xy(m).x - next.x, util.xy(m).y - next.y) <= G.skills.agitate.range - 10; }).length : 0;
            if (next && freshCount >= (ag.minPack || 3)) {
                finishPull("chained into the next pull");
                return true; // idle: walks to the pull point and pulls; the stragglers come along
            }
        }
        if (!best) {
            // Only stragglers left (chaseFrom or fewer): meet the nearest one instead of waiting (player request
            // 2026-11-18: the last 2-3 from the far side took long to arrive). Monsters first
            // walk to where we cast Agitate, then to us - so going to them is the shortest.
            const near = mine.slice().sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); })[0];
            const p = util.xy(near);
            if (!is_moving(character) || !pack.chase || Math.hypot(pack.chase.x - p.x, pack.chase.y - p.y) > 30) {
                pack.chase = p;
                if (can_move_to(p.x, p.y)) quiet(move(p.x, p.y));
                else quiet(xmove(p.x, p.y));
            }
            util.status("agitate: to the next one (" + mine.length + " left)", "orange");
            return true;
        }
        pack.chase = null;
        // The first swing waits until most of the pack is here (waitShare of the pulled ones in
        // range, at most waitMs): a lone first arrival would just die alone.
        if (!pack.attacks && now - pack.since < (ag.waitMs || 3000)) {
            const here = mine.filter(function (m) { return is_in_range(m); }).length;
            if (here < Math.ceil(pack.pulled.length * (ag.waitShare || 0.7))) {
                util.status("agitate: " + here + "/" + pack.pulled.length + " here", "orange");
                return true;
            }
        }
        // Spread around us: step away again so they come from one side.
        const avg = pack.recent.length >= 4 ? pack.recent.reduce(function (s, n) { return s + n; }, 0) / pack.recent.length : 99;
        if ((ag.gather || "center") === "step" && mine.length >= 3 && avg < (ag.regroupBelow || 0.5) && now - pack.lastRegroup > (ag.regroupEveryMs || 8000)) {
            pack.recent = [];
            if (stepAway(mine)) { pack.state = "gather"; return true; }
        }
        // Monsters behind us (opposite the pack's main side) take no splash: a small step away
        // from all of them puts them on one side again (at most every adjustEveryMs).
        if ((ag.gather || "center") === "center" && ag.adjustStep && mine.length >= 3 && now - (pack.lastAdjust || 0) > (ag.adjustEveryMs || 4000)) {
            const me = util.xy(character), mid = centerOf(mine);
            const dx = mid.x - me.x, dy = mid.y - me.y;
            const behind = mine.filter(function (m) { const p = util.xy(m); return (p.x - me.x) * dx + (p.y - me.y) * dy < 0; });
            if (behind.length && behind.length < mine.length) {
                pack.lastAdjust = now;
                stepAway(mine, ag.adjustStep);
            }
        }
        if (get_targeted_monster() !== best) change_target(best);
        // Fired by the strike loop the moment the cooldown ends (2026-11-20).
        ctx.strike.attack(best, function (m) {
            const n = splashNeighbours(m, onMe());
            pack.attacks++;
            pack.neighborSum += n;
            noteHit(m.mtype, n);
            pack.recent.push(n);
            if (pack.recent.length > 6) pack.recent.shift();
        });
        util.status("agitate: " + mine.length + " on us, splash " + bestN, "green");
        return true;
    }

    // ---- sword swap (player decision 2026-11-21) ---------------------------------------------
    // Fire blades are the end goal (burn), but burn needs ~5 s and never procs on the killing hit: on
    // a target that falls in classes.warrior.swordSwap.maxHits hits the carried Swords of the Dead
    // (more attack, 10 STR) go on, held like the Agitate maces; a target that takes longer (and every
    // boss / event target) brings the fire blades back. Only once fire blades are worn - before that
    // the swords are our usual weapons anyway.
    const sw = c.swordSwap || {};
    let swordsOn = false, swordBusy = false, swordLogAt = 0;
    function isBurn(i) { return !!(i && G.items[i.name] && G.items[i.name].ability === "burn"); }
    function quickSwords() {
        const names = sw.names || ["swordofthedead"];
        return character.items.map(function (it, num) { return { it: it, num: num }; }).filter(function (x) {
            return x.it && names.includes(x.it.name) && util.weaponPower(x.it.name, 0, character.ctype) > 0;
        }).sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    }
    function hitsToKill(t) {
        let mult = 1;
        mult = util.hitMultiplier(G.monsters[t.mtype] || t, character.damage_type || ((G.classes[character.ctype] || {}).damage_type), character);
        return (t.max_hp || t.hp || 1) / Math.max(1, (character.attack || 1) * mult);
    }
    async function putOn(list, why) {
        swordBusy = true;
        try {
            if (list[0]) await equip(list[0].num, "mainhand");
            const rest = quickSwords();
            const off = character.slots && character.slots.offhand;
            if (rest[0] && (!off || G.items[off.name].type === "weapon")) await equip(rest[0].num, "offhand");
            util.log("warrior", why + ": " + ["mainhand", "offhand"].map(function (s) {
                const i = character.slots[s]; return i ? i.name + " +" + (i.level || 0) : "-";
            }).join(", "), "yellow");
        } catch (e) {
            util.log("warrior", "sword swap: " + util.errReason(e), "orange");
        } finally {
            swordBusy = false;
        }
    }
    function swordSwap() {
        if (!sw.enabled || swordBusy || pack.busy || wearingSplash() || character.rip) return;
        const t = get_targeted_monster();
        if (!t || t.dead || t.type !== "monster") return;
        const def = G.monsters[t.mtype] || {};
        const longFight = !!(ctx.events && ctx.events.current()) || def.cooperative || hitsToKill(t) > (sw.maxHits || 5);
        const main = character.slots && character.slots.mainhand;
        if (!longFight) {
            if (isBurn(main)) {
                const list = quickSwords();
                if (!list.length) return;
                ctx.gear.holdWeapons(sw.holdMs || 60 * 1000); // records the fire blades as our usual weapons first
                swordsOn = true;
                putOn(list, "swords on (" + t.mtype + " falls in ~" + Math.ceil(hitsToKill(t)) + " hits)");
            } else if (swordsOn) {
                ctx.gear.holdWeapons(sw.holdMs || 60 * 1000); // still quick targets: keep the swords
            }
            return;
        }
        if (swordsOn && !isBurn(main)) {
            swordsOn = false;
            ctx.gear.holdWeapons(0); // the equip pass puts the stronger (burn-rated) fire blades back
            if (Date.now() - swordLogAt > 10 * 1000) {
                swordLogAt = Date.now();
                util.log("warrior", "fire blades back (" + t.mtype + ": ~" + Math.ceil(hitsToKill(t)) + " hits" + (def.cooperative ? ", boss" : "") + ")", "yellow");
            }
        }
    }

    function tryCharge() {
        if (!c.useCharge || !util.canCast("charge") || (character.s && character.s.charging)) return;
        use_skill("charge").catch(function () {});
    }

    return {
        name: "warrior",

        // Charge (+30 speed for 3.2 s, 40 s cooldown, no MP) whenever we walk – farm trips,
        // boss searches and Daisy trips too (player request 2026-11-16).
        always: function () {
            if (c.useCharge && is_moving(character)) tryCharge();
            dropSplashOnTheWay();
            swordSwap();
        },

        // Called once by the fighter when we die (the class ticks pause while dead - the check
        // in always() never ran, 2026-11-18). A death within 90 s of an Agitate: no Agitate on
        // that kind for agitate.deathDenyMs.
        onDeath: function () {
            if (!lastAgitate.type || Date.now() - lastAgitate.at > 90 * 1000) return;
            statOf(lastAgitate.type).denyUntil = Date.now() + (ag.deathDenyMs || 2 * 60 * 60 * 1000);
            saveStats(true);
            auto.at = 0;
            pack.state = "idle";
            util.log("warrior", "agitate: died while agitating " + lastAgitate.type + " - no Agitate there for " +
                Math.round((ag.deathDenyMs || 2 * 60 * 60 * 1000) / 60000) + " min", "red");
        },

        survive: function () {
            // Hard Shell on predicted damage (earthiverse, player decision 2026-11-21): when the next
            // physical hits of everything on us, x factor, reach our HP - earlier against big hitters,
            // never for weak ones (was: below 45 % HP with any physical attacker within 200 px).
            const h = c.hardShell || {};
            if (h.enabled && util.canCast("hardshell") &&
                util.incomingDamage("physical") * (h.factor || 3) >= character.hp) {
                use_skill("hardshell").catch(function () {});
                util.log("warrior", "Hard Shell", "yellow");
            }
            return false; // potions as usual
        },

        // Agitate "stream": while Agitate can't be cast, walk to the incoming monsters instead
        // of waiting for them (player request 2026-11-18).
        meetIncoming: function () {
            return packOn() && !ctx.party.enabled && agMode() === "swords" && (ag.swords || "stream") === "stream" &&
                (!util.canCast("agitate") || character.mp < G.skills.agitate.mp + reserve());
        },

        support: function () {
            if (escapeTick()) return true; // solo: run from a losing fight
            // In a party the protective Taunt/Agitate for allies comes first, then the stream.
            if (!ctx.party.enabled && packTick()) return true; // Agitate pack mode (solo)
            if (ctx.party.enabled && onOthers().length === 0 && packTick()) return true;
            const others = onOthers();
            if (!others.length) return false;
            // Agitate: everything nearby comes to us when several monsters are on allies.
            // ...but not with other kinds in reach that are not on us or allies (2026-11-19: it pulled
            // a booboo - pure damage, fear - into a mummy fight): Taunt then takes them one by one.
            const onAllies = others.map(function (m) { return m.id; });
            const bystanders = Object.values(parent.entities || {}).some(function (e) {
                return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= G.skills.agitate.range &&
                    e.target !== character.name && !onAllies.includes(e.id) && !others.some(function (o) { return o.mtype === e.mtype; });
            });
            if (!bystanders && others.length >= (c.agitateFrom || 3) && util.canCast("agitate") && mpLeftAfter("agitate") >= reserve() &&
                others.filter(function (m) { return util.distanceTo(m) <= G.skills.agitate.range; }).length >= (c.agitateFrom || 3) &&
                protectiveAgitateOk()) {
                use_skill("agitate").catch(function () {});
                util.log("warrior", "Agitate (" + others.length + " monsters on allies)", "yellow");
                return false;
            }
            const t = c.taunt || {};
            if (!t.enabled) return false;
            // Walk to it first, then taunt (player decision 2026-11-20): taunted from 200 px, the
            // monster - slowed by the priest's Curse - took ages to come over while the warrior stood
            // waiting next to the priest. Taunted up close, it turns on us right where we stand and the
            // ranged ones keep hitting it. From afar only when the ally is in danger (urgentHpBelow) or
            // the monster returns damage to melee (we don't fight those up close).
            let m = null;
            others.forEach(function (e) {
                if (!worthTaunting(e)) return;
                if (!m || util.distanceTo(e) < util.distanceTo(m)) m = e;
            });
            if (!m) return false;
            const d = util.distanceTo(m);
            const ally = get_player(m.target);
            const urgent = !!ally && ally.hp / ally.max_hp < (t.urgentHpBelow || 0.5);
            const close = d <= (character.range || 20) + (t.closeBy || 25);
            if (close || ((t.walkFirst === false || urgent || util.tooSpiky(ctx.config, m)) && d <= G.skills.taunt.range)) {
                if (util.canCast("taunt")) use_skill("taunt", m).catch(function () {});
                return false; // taunting doesn't use the attack
            }
            if (t.walkFirst === false || util.tooSpiky(ctx.config, m)) return false;
            util.status("to taunt " + m.mtype, "orange");
            const p = util.xy(m);
            if (!is_moving(character) || !tauntWalk || Math.hypot(tauntWalk.x - p.x, tauntWalk.y - p.y) > 30) {
                tauntWalk = { x: p.x, y: p.y };
                try { Promise.resolve(xmove(p.x, p.y)).catch(function () {}); } catch (e) { /* next tick */ }
            }
            return true; // walking to it: no fight elsewhere meanwhile
        },

        fight: function (target) {
            const sturdy = target.hp > character.attack * (c.sturdyHits || 4);
            if (sturdy && util.canCast("warcry") && mpLeftAfter("warcry") >= reserve() && ctx.party.enabled) {
                use_skill("warcry").catch(function () {});
            }
            if (util.canCast("cleave") && mpLeftAfter("cleave") >= reserve() && !spikyNear(G.skills.cleave.range) &&
                around(G.skills.cleave.range, false).length >= (c.cleaveFrom || 3)) {
                use_skill("cleave").catch(function () {});
            }
            if (util.canCast("stomp") && mpLeftAfter("stomp") >= reserve() && !spikyNear(G.skills.stomp.range) &&
                around(G.skills.stomp.range, true).length >= (c.stompFrom || 2)) {
                use_skill("stomp").catch(function () {});
            }
            return false; // basic attack as well
        },

        // Called while we walk: towards `target` (chase) or along a route (target null).
        move: function (target) {
            tryCharge();
            return target ? tryDash(target) : false;
        },
    };
};
