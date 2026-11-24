// =====================================================================
// classes/warrior/protect.js - protecting allies: Taunt (walk up first, from afar only when urgent) and the protective Agitate for several monsters on allies; monsters dying for the priest's luck catch are left alone.
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

    // A monster on an ally is worth taunting when the ally is hurt or the monster hits hard -
    // and always (player decision 2026-11-20) when it is a boss, or when it is on our healer:
    // the Phoenix (attack 125, under 5 % of the priest's HP) stayed on the kiting priest, who
    // walked it around the map while the warrior never took it.
    let tauntWalk = null; // where we last walked to for a taunt (a new order when it moved 30+ px)
    // Luck catch (2026-11-22): a monster on an ally that dies within luckCatch.hits hits is left there while a luck
    // catcher (Absorb Sins) is near - it should die on the catcher. Neither Taunt nor Agitate takes it.
    function spareForLuck(m) {
        if (!m || m.target === game.me().name || !deps.targeting.luckCatcherNear || !deps.targeting.diesSoon) return false;
        const lc = ((deps.config.classes || {}).priest || {}).luckCatch || {};
        return !!deps.targeting.luckCatcherNear() && deps.targeting.diesSoon(m, lc.hits || 2);
    }
    function worthTaunting(m) {
        if (spareForLuck(m)) return false;
        if (util.noArea(deps.config, m)) return false; // never the Giga Crab (events.noArea, 2026-11-23)
        const p = game.player(m.target);
        if (!p || p.rip) return false;
        const t = c.taunt || {};
        if (p.hp / p.max_hp < (t.allyHpBelow || 0.8) || (m.attack || 0) >= p.max_hp * (t.hitRatio || 0.05)) return true;
        const def = game.data().monsters[m.mtype] || {};
        const ev = deps.config.events || {};
        const bosses = (ev.search || []).concat(ev.engage || []);
        if (t.bosses !== false && (def.cooperative || bosses.includes(m.mtype) || (m.max_hp || def.hp || 0) >= (t.bossHp || 20000))) return true;
        return t.offHealer !== false && util.isHealer(p);
    }

    // Protective Agitate (2026-11-22): Agitate takes EVERY monster within 320 px, not only those on our allies.
    // Only when the team model (mobbing, fear, the priest's healing) says we can hold all of them at once -
    // the ones already on us included; otherwise Taunt takes them one by one. Logged once a minute.
    let protLogged = 0;
    function protectiveAgitateOk() {
        if (!deps.targeting || !deps.targeting.teamVerdict) return true;
        const all = Object.values(game.entities()).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead) return false;
            if (e.target === game.me().name) return true;
            return util.distanceTo(e) <= game.data().skills.agitate.range && (!e.target || deps.party.memberNames().includes(e.target));
        });
        if (!all.length) return true;
        const strongest = all.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
        const v = deps.targeting.teamVerdict(strongest.mtype, strongest, { pull: all.length });
        if (v.ok || /waiting for the team/.test(v.why || "")) return true; // no stats yet: as before
        if (Date.now() - protLogged > 60 * 1000) {
            protLogged = Date.now();
            util.log("warrior", "no protective Agitate: " + all.length + " would be on us (" + v.why + ") - taunting one by one", "white");
        }
        return false;
    }

    // The support hook's ally part (was inline in support()): true when this tick is taken, false otherwise.
    function allies() {
            const others = w.onOthers();
            if (!others.length) return false;
            // Agitate: everything nearby comes to us when several monsters are on allies.
            // ...but not with other kinds in reach that are not on us or allies (2026-11-19: it pulled
            // a booboo - pure damage, fear - into a mummy fight): Taunt then takes them one by one.
            const onAllies = others.map(function (m) { return m.id; });
            const bystanders = Object.values(game.entities()).some(function (e) {
                return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= game.data().skills.agitate.range &&
                    e.target !== game.me().name && !onAllies.includes(e.id) && !others.some(function (o) { return o.mtype === e.mtype; }) &&
                    w.ourKind(e, true); // other kinds: agitateClear steps clear of them (2026-11-23)
            });
            // Only the farm kind (2026-11-22, player decision): a Fire Spirit on an ally made the other Fire Spirits in
            // reach "not bystanders" (same kind as one on an ally) and Agitate pulled three of them - the warrior died.
            // Now every monster in reach that is not on us yet must be of the farm kind (event types count); other
            // kinds on allies are taunted one by one.
            let fmNow = null;
            try { fmNow = deps.targeting.farmNow ? deps.targeting.farmNow() : null; } catch (e) { fmNow = null; }
            const ourKinds = !fmNow ? null : fmNow.any ? (Array.isArray(fmNow.types) ? fmNow.types : null) : (fmNow.monster ? [fmNow.monster] : null);
            // Foreign kinds on an ally block it at ANY distance (2026-11-22, player decision): at 20:51 Agitate pulled Fire
            // Spirits that already targeted the priest/ranger from just outside the 320 px check.
            const allies = deps.party.memberNames();
            const foreignOnAllies = !!ourKinds && Object.values(game.entities()).some(function (e) {
                if (!e || e.type !== "monster" || e.dead || e.target === game.me().name || ourKinds.includes(e.mtype)) return false;
                return !!e.target && allies.includes(e.target);
            });
            // Agitate takes every monster in reach - not while one on an ally is about to die for the luck catcher.
            const sparing = others.some(function (m) { return util.distanceTo(m) <= game.data().skills.agitate.range && spareForLuck(m); });
            // Taunt first (taunt.first, 2026-11-22 player test): Agitate only for more than Taunt can take one by one
            // (taunt.agitateOver on allies) - it also pulls the free monsters around.
            const tf = c.taunt || {};
            const crowd = !tf.first || others.length >= (tf.agitateOver || 6);
            // Other kinds in reach that are not on allies (a roaming Fire Spirit, 2026-11-23): step clear of them first
            // (agitateClear) - the ones on allies stay in reach where possible. Only when Agitate would go out otherwise.
            if (!bystanders && !foreignOnAllies && !sparing && crowd && others.length >= (c.agitateFrom || 3) && util.canCast("agitate") && mpLeftAfter("agitate") >= w.reserve() &&
                others.filter(function (m) { return util.distanceTo(m) <= game.data().skills.agitate.range; }).length >= (c.agitateFrom || 3) &&
                protectiveAgitateOk()) {
                const clear = w.agitateClear(others.filter(function (m) { return w.ourKind(m, true); }), [], true);
                if (clear === "step") return true; // walking clear: no fight elsewhere meanwhile
                if (clear === "go") {
                    game.useSkill("agitate").catch(function () {});
                    util.log("warrior", "Agitate (" + others.length + " monsters on allies)", "yellow");
                    return false;
                }
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
            const ally = game.player(m.target);
            const urgent = !!ally && ally.hp / ally.max_hp < (t.urgentHpBelow || 0.5);
            const close = d <= (game.me().range || 20) + (t.closeBy || 25);
            if (close || ((t.walkFirst === false || urgent || util.tooSpiky(deps.config, m)) && d <= game.data().skills.taunt.range)) {
                if (util.canCast("taunt")) game.useSkill("taunt", m).catch(function () {});
                return false; // taunting doesn't use the attack
            }
            if (t.walkFirst === false || util.tooSpiky(deps.config, m)) return false;
            util.status("to taunt " + m.mtype, "orange");
            const p = util.xy(m);
            if (!game.isMoving(game.me()) || !tauntWalk || Math.hypot(tauntWalk.x - p.x, tauntWalk.y - p.y) > 30) {
                tauntWalk = { x: p.x, y: p.y };
                try { Promise.resolve(game.moveTo(p.x, p.y)).catch(function () {}); } catch (e) { /* next tick */ }
            }
            return true; // walking to it: no fight elsewhere meanwhile
    }

    Object.assign(w, {
        spareForLuck: spareForLuck,
        worthTaunting: worthTaunting,
        protectiveAgitateOk: protectiveAgitateOk,
        allies: allies,
    });
};
