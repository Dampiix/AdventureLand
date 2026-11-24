// =====================================================================
// classes/warrior/agitate-mode.js - Agitate mode and the automatic decision: mode (off/swords/splash/...), what may be pulled and how many, learned splash per hit and too-hot moments per monster kind, the pack around us.
// Part of the warrior (module plan, stage 2): moved verbatim from the old single-file warrior.js. The warrior's parts
// share one internal state (w: the pack, the auto decision, the last Agitate, the speed reference) and call each
// other through w; outside dependencies come in deps (game, util, config, party, targeting, gear, strike, events).
// =====================================================================

module.exports = function install(w, deps) {
    const game = deps.game;
    const util = deps.util;
    const quiet = util.quiet;
    const c = deps.config.classes.warrior;
    const ag = c.agitate || {};
    const mpLeftAfter = util.mpLeftAfter;

    // ---- Agitate pack mode (config.classes.warrior.agitate, test since 2026-11-18) ----------
    //
    // Solo: when enough free monsters stand within Agitate range, the warrior puts on his
    // splash weapons (explosion, e.g. Lolipop Maces), casts War Cry and Agitate, walks a step
    // away so the pack follows from one side and bunches up, then always hits the monster with
    // the most others inside the splash radius (explosion / 3.6 px, hitbox edge to edge -
    // server.js). When the pack spreads around him he steps away again. Each pull ends with
    // a summary line (pulled, time, splash neighbours per hit, HP used) to judge the mode.
    w.pack = { state: "idle", busy: false, since: 0, pulled: [], startHp: 0, attacks: 0, neighborSum: 0,
        recent: [], lastRegroup: 0, gatherAt: 0, noWeaponsLogged: false };

    // Mode: "off" (single targets), "swords" (Agitate, usual weapons - pull everything, kill one
    // by one, no walking) or "splash" (Agitate with the splash weapons). From the config
    // (enabled + weapons "keep"/"splash"), or switched at runtime with the chat command
    // "/agitate off|swords|splash|chain|splashstream|config" (kept across restarts; for A/B tests, 2026-11-18).
    const MODE_KEY = "agitate_mode:" + game.me().name;
    let modeCache = { at: 0, v: null }, lastMode = null;
    function agOverride() { agMode(); return !!modeCache.v; }
    function agMode() {
        if (Date.now() - modeCache.at > 2000) {
            let v = null;
            try { v = game.storageGet(MODE_KEY) || null; } catch (e) { /* storage unavailable */ }
            modeCache = { at: Date.now(), v: v };
        }
        const m = modeCache.v || (!ag.enabled ? "off" : ag.monsters === "auto" ? autoMode() : ag.weapons === "keep" ? "swords" : "splash");
        if (m !== lastMode) {
            if (lastMode !== null) {
                util.log("warrior", "agitate mode: " + m, "yellow");
                if (!SPLASH_MODES.includes(m)) deps.gear.holdWeapons(0); // usual weapons back at once
                w.pack.state = "idle";
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
        return deps.party.enabled && ["splashstream", "swords", "auto"].includes(ag.partyMode || "off");
    }
    function effectiveMode() {
        if (!deps.party.enabled) return agMode();
        if (!partyStream()) return "off";
        if (ag.partyMode !== "auto") return ag.partyMode;
        const m = autoMode();
        return m === "off" ? "off" : SPLASH_MODES.includes(m) ? "splashstream" : "swords";
    }
    // True when the automatic decision picks the mode (no /agitate override).
    function autoDecides() {
        if (deps.party.enabled) return partyStream() && ag.partyMode === "auto";
        agMode(); // refreshes the override cache
        return !modeCache.v && !!ag.enabled && ag.monsters === "auto";
    }
    function packOn() {
        if (deps.party.enabled ? effectiveMode() === "off" : agMode() === "off") return false;
        return !!game.data().skills.agitate && game.me().level >= (game.data().skills.agitate.level || 68);
    }
    function isSplash(item) {
        const def = item && game.data().items[item.name];
        return !!(def && def.type === "weapon" && def.explosion > 0);
    }
    // Bag weapons with splash that our class can hold, highest level first.
    function splashWeapons() {
        return game.me().items.map(function (it, num) { return { it: it, num: num }; }).filter(function (x) {
            return isSplash(x.it) && util.weaponPower(x.it.name, 0, game.me().ctype) > 0;
        }).sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    }
    function wearingSplash() {
        return isSplash(game.me().slots && game.me().slots.mainhand);
    }
    function packWanted(e) {
        // Auto: the farm target, and any other kind in reach that passes the same safety check
        // (player decision 2026-11-18: pull the plain snakes along with the slow O-Snakes).
        if (ag.monsters === "auto") return !!w.auto.type && w.auto.mode !== "off" && (e.mtype === w.auto.type || kindOk(e.mtype));
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
    const STATS_KEY = "agitate_stats:" + game.me().name;
    const stats = (function () { try { return game.storageGet(STATS_KEY) || {}; } catch (e) { return {}; } })();
    let statsSavedAt = 0;
    function saveStats(force) {
        if (!force && Date.now() - statsSavedAt < 30 * 1000) return;
        statsSavedAt = Date.now();
        try { game.storageSet(STATS_KEY, stats); } catch (e) { /* storage unavailable */ }
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
        Object.keys(game.data().maps).forEach(function (m) {
            (game.data().maps[m].monsters || []).forEach(function (p) {
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
        const def = game.data().monsters[type] || {};
        // Only those Agitate would reach (plus levelMargin px for ones walking in), not every one in sight.
        const reach = game.data().skills.agitate.range + (ag.levelMargin || 80);
        const live = Object.values(game.entities()).filter(function (e) { return e && e.type === "monster" && e.mtype === type && !e.dead && util.distanceTo(e) <= reach; })
            .sort(function (a, b) { return (b.level || 1) - (a.level || 1); })[0];
        const e = live || { mtype: type, attack: def.attack, hp: def.hp, max_hp: def.hp, frequency: def.frequency, level: 1 };
        let n = 0;
        // A safety share on top (2026-11-18): the pack check assumes an HP potion on every
        // cooldown, but Agitate burns MP and both potions share one cooldown - a pull only counts
        // as safe at safetyShare of the HP the check allows.
        const allowed = game.me().max_hp * (((deps.config.targeting || {}).live || {}).soloHpUse || 0.5) * (ag.safetyShare || 0.5);
        for (let k = ag.maxOnMe || 8; k >= 1; k--) {
            // Mana: about one Agitate every agitateEverySec while the stream runs; splash: the
            // learned (or guessed 1.0) extra targets per hit.
            const st = statOf(type);
            const v = deps.targeting.packVerdict ? deps.targeting.packVerdict(e, k, {
                mpPerSec: game.data().skills.agitate.mp / (ag.agitateEverySec || 6),
                splash: st.hits >= (ag.learnHits || 40) ? st.nsum / st.hits : (spawnDense(type) ? 1 : 0),
            }) : { ok: true, lost: 0 };
            if (v.ok && (v.lost || 0) <= allowed) { n = k; break; }
        }
        // Fear (server.js): more attackers of one damage type than our courage for it cuts our
        // attack to 60/40/20 % (2026-11-18: booboos deal pure damage, warrior pure courage 2 -
        // "You are getting scared" / "terrified"). Never more of them than courage + fearMax.
        const dtype = e.damage_type || def.damage_type || "physical";
        const courage = dtype === "pure" ? game.me().pcourage : dtype === "magical" ? game.me().mcourage : game.me().courage;
        if (typeof courage === "number") n = Math.min(n, courage + (ag.fearMax || 0));
        safeLevel[type] = live ? (live.level || 1) : 1;
        safeCache[type] = { at: Date.now(), n: n };
        return n;
    }
    function autoAllowed(type) {
        const def = game.data().monsters[type];
        if (!def || (ag.deny || []).includes(type) || def.cooperative) return { ok: false, why: "not for this kind" };
        if ((statOf(type).denyUntil || 0) > Date.now()) return { ok: false, why: "died here recently" };
        if (def.dreturn > 0 || (def.hp || 0) > (ag.maxHp || 50000)) return { ok: false, why: "damage return or boss" };
        const abil = Object.keys(def.abilities || {}).filter(function (a) { return !(ag.abilities || []).includes(a); });
        if (abil.length) return { ok: false, why: "abilities " + abil.join(",") };
        // Our usual speed, not the current one: Hard Shell slows us, and the decision flipped
        // to "off" mid-pull and swapped weapons (2026-11-18).
        w.speedRef = Math.max(w.speedRef, game.me().speed || 0);
        if ((def.speed || 0) >= w.speedRef * 0.9) return { ok: false, why: "as fast as we are" };
        const n = safeLimit(type);
        // No fixed level cap (player decision 2026-11-18): safeLimit judges the strongest one in
        // reach with its real stats - grown monsters fail it by themselves when they are too much.
        // agitate.maxLevel (a number) can still cap it by hand.
        if (typeof ag.maxLevel === "number" && (safeLevel[type] || 1) > ag.maxLevel) return { ok: false, live: true, why: "level " + safeLevel[type] + " in reach (max " + ag.maxLevel + ")" };
        if (n < 2) return { ok: false, live: true, why: "pack check allows " + n };
        return { ok: true, n: n };
    }
    w.auto = { at: 0, type: null, mode: "off", why: "" };
    function farmType() {
        try { const fm = deps.targeting.currentFarm(); return fm && !fm.any ? fm.monster : null; } catch (e) { return null; }
    }
    w.speedRef = 0;
    function autoMode() {
        if (Date.now() - w.auto.at < 15 * 1000) return w.auto.mode;
        // While monsters are on us the decision stands (no weapon swap mid-fight) - only a
        // denied kind (death) ends it at once.
        // ...but not once the farm target changed (2026-11-19: the leader left for the mummies, the
        // warrior kept its booboo decision while booboos hit it and agitated more of them).
        if (w.auto.type && w.onMe().length && !((statOf(w.auto.type).denyUntil || 0) > Date.now()) && w.auto.type === farmType()) return w.auto.mode;
        w.auto.at = Date.now();
        const type = farmType();
        const a = type ? autoAllowed(type) : { ok: false, why: "no farm target" };
        // Steadier (2026-11-22): at the CGoos the decision flipped swords <-> off every 15 s - the pack check judges
        // the strongest one in reach, and grown and fresh ones walked in and out of it. A live "no" (the pack check
        // or the level cap) switches a running mode off only after it held for agitate.offAfterMs; every single
        // Agitate checks what is in reach anyway (autoCap, maxLevel). Fixed reasons (death, damage return,
        // abilities, speed, a new farm target) switch at once.
        if (!a.ok && a.live && type && type === w.auto.type && w.auto.mode !== "off") {
            if (!w.auto.liveNoSince) w.auto.liveNoSince = Date.now();
            if (Date.now() - w.auto.liveNoSince < (ag.offAfterMs || 60 * 1000)) return w.auto.mode;
        } else w.auto.liveNoSince = 0;
        const mode = !a.ok ? "off" : splashWorth(type) ? "splashstream" : "swords";
        const st = type ? statOf(type) : null;
        const why = !a.ok ? a.why : "up to " + Math.max(1, Math.floor(a.n * scaleOf(type))) + " at once, splash " +
            (st && st.hits >= (ag.learnHits || 40) ? (st.nsum / st.hits).toFixed(2) + " learned" : "guessed");
        if (type !== w.auto.type || mode !== w.auto.mode) util.log("warrior", "agitate auto: " + (type || "-") + " -> " + mode + " (" + why + ")", "yellow");
        w.auto.type = type; w.auto.mode = mode; w.auto.why = why;
        return mode;
    }
    // Other kinds pulled along: each must pass the safety check itself (cached 10 s).
    const kindCache = {};
    function kindOk(type) {
        const c = kindCache[type];
        if (c && Date.now() - c.at < 10 * 1000) return c.ok;
        const ok = autoAllowed(type).ok;
        kindCache[type] = { at: Date.now(), ok: ok };
        return ok;
    }
    // The current type's safe count, for the stream limit (null = no automatic cap): for what is
    // in reach now, the most careful of all kinds there.
    function autoCap() {
        if (ag.monsters !== "auto" || !w.auto.type) return null;
        const kinds = {};
        kinds[w.auto.type] = true;
        Object.values(game.entities()).forEach(function (e) {
            if (e && e.type === "monster" && !e.dead && util.distanceTo(e) <= game.data().skills.agitate.range && packWanted(e)) kinds[e.mtype] = true;
        });
        return Math.max(1, Math.min.apply(null, Object.keys(kinds).map(function (t) { return Math.floor(safeLimit(t) * scaleOf(t)); })));
    }
    // Auto: an Agitate needs the farm target among the free ones in reach (player decision
    // 2026-11-18): other kinds only come along. Plain snakes alone kept the warrior agitating at
    // the snake spot after the O-Snakes were gone, and the party came back instead of moving on.
    function farmTargetIn(list) {
        if (ag.monsters !== "auto" || !w.auto.type) return true;
        return list.some(function (m) { return m.mtype === w.auto.type; });
    }
    // A monster standing in a rage zone the team can't take (2026-11-22): the stream walked to the level-17 booboos
    // and Agitated them - warrior and ranger died before the leader had looked at the spot.
    function inBadZone(e) {
        return !!(deps.targeting.failingZoneAt && deps.targeting.failingZoneAt(util.xy(e)));
    }
    // Free monsters of the wanted kind around us (not fighting another player).
    function packAround(range) {
        return Object.values(game.entities()).filter(function (e) {
            if (e && !e.target && deps.party.nearLeader && !deps.party.nearLeader(e)) return false; // member: farm radius
            return e && e.type === "monster" && !e.dead && e.visible && packWanted(e) &&
                util.distanceTo(e) <= range && (!e.target || e.target === game.me().name) &&
                !(deps.targeting.inOccupied && deps.targeting.inOccupied(e)) && // another player's spot
                (e.target === game.me().name || !inBadZone(e));
        });
    }
    // Monsters Agitate would pull as well although we don't want them: other kinds (when
    // agitate.monsters lists some) and anything that returns damage - Agitate taunts all
    // within 320 px, at the crocs it pulled armadillos (dreturn 30) too (2026-11-18).
    function unwantedAround(range) {
        return Object.values(game.entities()).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || util.distanceTo(e) > range) return false;
            if (e.target && e.target !== game.me().name) return false; // busy with another player
            const def = game.data().monsters[e.mtype] || {};
            return !packWanted(e) || def.dreturn > 0 || util.tooSpiky(deps.config, e) || (e.target !== game.me().name && inBadZone(e));
        });
    }

    Object.assign(w, {
        agOverride: agOverride,
        agMode: agMode,
        splashMode: splashMode,
        partyStream: partyStream,
        effectiveMode: effectiveMode,
        autoDecides: autoDecides,
        packOn: packOn,
        isSplash: isSplash,
        splashWeapons: splashWeapons,
        wearingSplash: wearingSplash,
        packWanted: packWanted,
        saveStats: saveStats,
        statOf: statOf,
        noteHit: noteHit,
        noteLowHp: noteLowHp,
        scaleOf: scaleOf,
        spawnDense: spawnDense,
        splashWorth: splashWorth,
        safeLimit: safeLimit,
        autoAllowed: autoAllowed,
        farmType: farmType,
        autoMode: autoMode,
        kindOk: kindOk,
        autoCap: autoCap,
        farmTargetIn: farmTargetIn,
        inBadZone: inBadZone,
        packAround: packAround,
        unwantedAround: unwantedAround,
    });
};
