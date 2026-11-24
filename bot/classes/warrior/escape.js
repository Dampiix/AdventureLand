// =====================================================================
// classes/warrior/escape.js - escape from a losing fight (solo and in a party): when, where to step (away from them, within the healer's reach, not into other dangers), until when.
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

    // Escape (solo and in a party - see escapeTick; 2026-11-18 after three deaths at the bats): below escapeHp with
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
        return Math.max(ag.escapeClear || 250, (e.range || (game.data().monsters[e.mtype] || {}).range || 0) + (ag.escapeMargin || 100));
    }

    // In a party, the nearest living healer (heal stat) and its reach: escape steps stay within it.
    function healerNear() {
        if (!deps.party.enabled) return null;
        let best = null;
        deps.party.memberNames().forEach(function (n) {
            if (n === game.me().name) return;
            const p = game.player(n);
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
        const mons = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead && list.indexOf(e) === -1 && e.target !== game.me().name;
        }).map(function (e) {
            const d = game.data().monsters[e.mtype] || {};
            const p = util.xy(e);
            const danger = (d.aggro || 0) > 0 || (d.rage || 0) > 0 || !!(d.abilities && Object.keys(d.abilities).length);
            return { x: p.x, y: p.y, r: danger ? Math.max(150, (e.range || d.range || 20) + keep) : 60 };
        });
        const onTypes = {};
        list.forEach(function (m) { onTypes[m.mtype] = true; });
        const boxes = [];
        ((game.data().maps[game.me().map] || {}).monsters || []).forEach(function (p) {
            const d = game.data().monsters[p.type] || {};
            if (onTypes[p.type] || !((d.aggro || 0) > 0 || (d.rage || 0) > 0) || d.cooperative) return;
            util.spawnBoxes(p, game.me().map).forEach(function (b) {
                boxes.push([b[0] - keep, b[1] - keep, b[2] + keep, b[3] + keep]);
            });
        });
        return function (x, y) {
            if (mons.some(function (m) { return Math.hypot(m.x - x, m.y - y) < m.r; })) return true;
            return boxes.some(function (b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; });
        };
    }
    // A step away from them, all around (2026-11-22: in the bat cave five directions within 70° of
    // "straight away" at 200 px were all blocked - "cornered" four times, then dead). 16 directions,
    // 200/120/70 px; the step that leaves the most room to the nearest of them wins. Steps out of the
    // healer's reach or towards other dangers (escapeDangers) only count as a last resort.
    function escapeStep(list) {
        const me = util.xy(game.me());
        const pts = list.map(util.xy);
        const healer = healerNear();
        const risky = escapeDangers(list);
        let best = null, bestRoom = -Infinity;
        [ag.escapeStep || 200, 120, 70].forEach(function (step) {
            if (best && bestRoom > -500) return; // a longer step that works beats a shorter one (not a risky one)
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * step, y = me.y + Math.sin(a) * step;
                if (!game.canMoveTo(x, y)) continue;
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
        quiet(game.walkStraight(best.x, best.y));
        return true;
    }
    // Party (2026-11-22, player decision): the warrior holds every monster, so when the priest's healing can't
    // keep up he runs too - they all follow him, the mobbing combo runs out after 5 s without a hit, and the
    // priest heals him meanwhile (the step stays within the healer's range where it can). Only when the live
    // check - healing included - says we die within escapeTtdSec, never just for low HP the priest covers.
    // Our real HP over the last seconds (2026-11-22): one Fire Spirit (stacking burn, 1,726 damage/s) killed the
    // warrior at the Giant Scorpions - the live check works with the hit formula, knows no burn and saw "1 on us".
    // The HP we really lose (every hit, burn, heal and potion included) tells the time until death directly.
    const hpHist = [];
    function noteHp() {
        const now = Date.now();
        if (!hpHist.length || now - hpHist[hpHist.length - 1].t >= 250) hpHist.push({ t: now, hp: game.me().hp });
        while (hpHist.length && now - hpHist[0].t > 6000) hpHist.shift();
    }
    // Seconds until death at the HP loss of the last escapeLossSec (Infinity while we hold or gain), and the loss/s.
    function lossTtd() {
        const now = Date.now(), win = (ag.escapeLossSec || 3) * 1000;
        const old = hpHist.find(function (x) { return now - x.t <= win; });
        if (!old || now - old.t < win * 0.6) return { ttd: Infinity, rate: 0 };
        const rate = (old.hp - game.me().hp) / ((now - old.t) / 1000);
        return rate > 0 ? { ttd: game.me().hp / rate, rate: rate } : { ttd: Infinity, rate: rate };
    }
    // A monster on us that the team model (party) or our pack check (solo) rejects even alone (2026-11-22): the Fire
    // Spirit has a burn ability - nothing we should stand and fight. Cached 10 s per monster.
    const rejectCache = {};
    function rejectedAlone(m) {
        // Bosses are fought on purpose (the boss checks decide there): never "rejected" here.
        const ev = deps.config.events || {};
        if ((game.data().monsters[m.mtype] || {}).cooperative || (ev.search || []).concat(ev.engage || []).includes(m.mtype)) return null;
        const c = rejectCache[m.id];
        if (c && Date.now() - c.at < 10 * 1000) return c.why;
        let v = null;
        if (deps.party.enabled && deps.targeting.teamVerdict) {
            v = deps.targeting.teamVerdict(m.mtype, m, { pull: 1 });
            if (!v.ok && /waiting for the team|not in yet|no team stats/.test(v.why || "")) v = null;
        }
        if (!v && deps.targeting.packVerdict) v = deps.targeting.packVerdict(m, 1);
        const why = v && !v.ok ? (v.why || "rejected") : null;
        rejectCache[m.id] = { at: Date.now(), why: why };
        return why;
    }
    function escapeTick() {
        const inParty = deps.party.enabled;
        if (inParty && ag.partyEscape === false) return false;
        const now = Date.now();
        const on = w.onMe();
        w.speedRef = Math.max(w.speedRef, game.me().speed || 0);
        noteHp();
        if (!esc.on) {
            if (!on.length || now < (esc.retryAt || 0)) return false;
            // Also above escapeHp when a mob (more than 3 on us, util.mobbing) would kill us within
            // escapeTtdSec at the live combo (2026-11-22).
            let mobbed = null;
            const low = util.hpRatio() < (ag.escapeHp || 0.3);
            if ((on.length > 3 && util.hpRatio() < (ag.escapeMobHp || 0.7)) || (inParty && low)) {
                const dz = deps.targeting.liveDanger ? deps.targeting.liveDanger() : null;
                if (dz && dz.ttd < (ag.escapeTtdSec || 8)) mobbed = dz;
            }
            // A (2026-11-22): the HP we really lose would kill us within escapeTtdSec - whatever the formula says.
            const loss = lossTtd();
            const losing = loss.ttd < (ag.escapeTtdSec || 8) ? loss : null;
            // B (2026-11-22): a monster on us the checks reject even alone - away from it at once (when it is slower).
            let rejected = null;
            for (const m of on) {
                const why = rejectedAlone(m);
                if (why) { rejected = { m: m, why: why }; break; }
            }
            if (inParty ? !(mobbed || losing || rejected) : (!low && !mobbed && !losing && !rejected)) return false;
            // Scared (fear, 2026-11-22): the server takes 20/40/70+ off our speed - then our real speed counts.
            const mySpeed = game.me().fear ? Math.min(w.speedRef, game.me().speed || 0) : w.speedRef;
            if (on.some(function (m) { return (m.speed || (game.data().monsters[m.mtype] || {}).speed || 0) >= mySpeed * 0.8; })) return false;
            esc.on = true;
            esc.start = now;
            util.log("warrior", "escaping at " + Math.round(util.hpRatio() * 100) + "% HP from " + on.length + "x " + on[0].mtype +
                (mobbed ? " (" + (mobbed.mult > 1 ? "mobbed x" + mobbed.mult.toFixed(1) + ", " : "") + Math.round(mobbed.dps) + " dmg/s vs " +
                    Math.round(mobbed.sustain) + " healed/s - dead in ~" + Math.round(mobbed.ttd) + " s)"
                : losing ? " (losing " + Math.round(losing.rate) + " HP/s for real - dead in ~" + Math.round(losing.ttd) + " s)"
                : rejected ? " (" + rejected.m.mtype + " rejected even alone: " + rejected.why + ")" : ""), "red");
        }
        const inReach = on.filter(function (e) { return util.distanceTo(e) < reachOf(e); });
        // Healed: back at escapeUntilHp and the mobbing combo has run out (5 s without a mobbed hit).
        const healed = util.hpRatio() >= (ag.escapeUntilHp || 0.6) && !util.mobNow(0).combo;
        const why = !on.length ? "nobody on us" : !inReach.length && healed ? "out of reach, healed" :
            now - esc.start > (ag.escapeMaxMs || 45000) ? "time up" : null;
        if (why) {
            esc.on = false;
            if (game.isMoving(game.me())) game.stopAction();
            util.log("warrior", "escape done (" + why + ") at " + Math.round(util.hpRatio() * 100) + "% HP after " + Math.round((now - esc.start) / 1000) + " s", "yellow");
            return false;
        }
        // Out of their reach but still low: no swing, the potions work; we step on when one comes close.
        if (!inReach.length) {
            util.status("escaped, healing " + Math.round(util.hpRatio() * 100) + "%", "orange");
            return true;
        }
        if (!game.isMoving(game.me()) && !escapeStep(inReach)) {
            esc.on = false; // cornered: fight (a new try in 5 s)
            esc.retryAt = now + 5000;
            util.log("warrior", "escape: cornered at " + Math.round(util.hpRatio() * 100) + "% HP - fighting on", "orange");
            return false;
        }
        util.status("escaping " + Math.round(util.hpRatio() * 100) + "%", "red");
        return true;
    }

    Object.assign(w, {
        reachOf: reachOf,
        healerNear: healerNear,
        escapeDangers: escapeDangers,
        escapeStep: escapeStep,
        noteHp: noteHp,
        lossTtd: lossTtd,
        rejectedAlone: rejectedAlone,
        escapeTick: escapeTick,
    });
};
