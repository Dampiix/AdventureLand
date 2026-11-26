// =====================================================================
// classes/priest/luck-catch.js - luck catch: drops are rolled with the luck of the character a monster TARGETS when it
// dies. The priest carries the luck gear: when a monster on an ally dies within `hits` hits, Absorb Sins pulls
// everything off that ally - the dying ones die on the priest, with the luck gear put on in the same moment (luckOn).
// A tank in the party (Taunt/Agitate) within tankRange takes the longer-living ones back; without one, the priest only
// absorbs what its courage holds without fear. Bosses too, never a no-area monster (Giga Crab).
// Interface: createLuckCatch(deps, options) -> { tryLuckCatch() -> true when cast }
//   deps: game, members(), partyEnabled(), distanceTo(e), attackersOnMe(), damageTypeOf(m), courageOf(type),
//         noArea(m), canPredictDeaths() -> diesSoon is available, diesSoon(m, hits), luckOn(ids of the dying ones), log
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    hits: 2,                       // a monster that dies within this many hits of our strongest fighter
    maxPull: 5,                    // at most this many monsters on that ally
    minHp: 0.6,                    // only while we are above this HP ratio
    everyMs: 1500,                 // once per ally this often
    tankRange: 400,                // a Taunt/Agitate class this close takes the rest back
    logEveryMs: 10 * 60 * 1000,    // a summary line this often
};

module.exports = function createLuckCatch(deps, options) {
    const game = deps.game;
    const lc = Object.assign({}, DEFAULTS, options || {});
    const lastCatch = {}; // ally -> ms
    const catchStats = { n: 0, monsters: 0, since: Date.now(), logAt: Date.now() };

    function tankNear() {
        const me = game.me(), G = game.data();
        const pullers = ((G.skills.taunt && G.skills.taunt.class) || []).concat((G.skills.agitate && G.skills.agitate.class) || []);
        return deps.members().some(function (n) {
            if (n === me.name) return false;
            const p = game.player(n);
            return !!p && !p.rip && pullers.includes(p.ctype) && deps.distanceTo(p) <= (lc.tankRange || 400);
        });
    }
    function tryLuckCatch() {
        const me = game.me(), G = game.data();
        if (!lc.enabled || !deps.partyEnabled() || !game.canCast("absorb") || !deps.canPredictDeaths()) return false;
        if (game.hpRatio() < (lc.minHp || 0.6)) return false;
        const range = (G.skills.absorb && G.skills.absorb.range) || 240;
        const mine = deps.attackersOnMe();
        const now = Date.now();
        for (const n of deps.members()) {
            if (n === me.name || now - (lastCatch[n] || 0) < (lc.everyMs || 1500)) continue;
            const ally = game.player(n);
            if (!ally || ally.rip || deps.distanceTo(ally) > range) continue;
            const on = Object.values(game.entities()).filter(function (e) {
                return e && e.type === "monster" && !e.dead && e.target === n;
            });
            if (!on.length || on.length > (lc.maxPull || 5)) continue;
            if (on.some(function (m) { return deps.noArea(m); })) continue; // never a Giga Crab
            const dying = on.filter(function (m) { return deps.diesSoon(m, lc.hits || 2); });
            if (!dying.length) continue;
            // Without a tank to take the rest back: only what our courage holds per damage type (no fear).
            if (!tankNear()) {
                const count = {};
                mine.concat(on).forEach(function (m) { const t = deps.damageTypeOf(m); count[t] = (count[t] || 0) + 1; });
                if (Object.keys(count).some(function (t) { return count[t] > deps.courageOf(t); })) continue;
            }
            lastCatch[n] = now;
            // Luck swap: the luck gear goes on in the same moment (one equip_batch call) - the dying ones die on us a
            // moment later with our luck; the gear module changes back once they died (luckSwap.backMs at the latest).
            // v1.238.8: with the dying ones' ids - the gear comes back once they are dead (backMs at the latest).
            if (deps.luckOn) deps.luckOn(dying.map(function (m) { return m.id; }));
            game.useSkill("absorb", ally).catch(function () {});
            catchStats.n++;
            catchStats.monsters += on.length;
            if (now - catchStats.logAt > (lc.logEveryMs || 10 * 60 * 1000)) {
                deps.log("priest", "luck catch: " + catchStats.n + " absorbs (" + catchStats.monsters + " monsters) in " +
                    Math.round((now - catchStats.since) / 60000) + " min", "white");
                catchStats.logAt = now;
            }
            return true;
        }
        return false;
    }

    return { tryLuckCatch: tryLuckCatch };
};
