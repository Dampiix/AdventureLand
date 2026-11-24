// =====================================================================
// classes/priest/absorb.js - Absorb Sins (level 55, 200 MP) as an emergency: a member (not the tank) is below `below`
// with monsters on it and no tank stands within Taunt range of it (dead, elsewhere, farming alone) - we take them
// over, while we are above selfAbove. Never when a no-area monster (Giga Crab) is on that member.
// Interface: createAbsorb(deps, options) -> { tryAbsorb(hurt) -> true when cast }
//   hurt: heal.hurtMembers()
//   deps: game, members(), partyEnabled(), distanceTo(e), noArea(m), tankClasses(), log
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    below: 0.35,      // a member below this HP ratio ...
    selfAbove: 0.6,   // ... while we are above this
};

module.exports = function createAbsorb(deps, options) {
    const game = deps.game;
    const a = Object.assign({}, DEFAULTS, options || {});
    let lastAbsorbLog = 0;

    function tryAbsorb(hurt) {
        const me = game.me(), G = game.data();
        if (!a.enabled || !deps.partyEnabled() || !game.canCast("absorb")) return false;
        if (game.hpRatio() < (a.selfAbove || 0.6)) return false;
        const tankClasses = deps.tankClasses();
        const tanks = deps.members()
            .map(function (n) { return n === me.name ? null : game.player(n); })
            .filter(function (p) { return p && !p.rip && tankClasses.includes(p.ctype); });
        const tauntRange = (G.skills.taunt && G.skills.taunt.range) || 200;
        const victim = hurt.find(function (m) {
            const p = m.entity;
            if (p === me || m.ratio >= (a.below || 0.35) || tankClasses.includes(p.ctype)) return false;
            if (deps.distanceTo(p) > G.skills.absorb.range) return false;
            const onIt = Object.values(game.entities()).some(function (e) {
                return e && e.type === "monster" && !e.dead && e.target === p.name;
            });
            if (!onIt) return false;
            // Absorb takes every monster on that ally - never a Giga Crab (events.noArea).
            if (Object.values(game.entities()).some(function (e) { return e && !e.dead && e.target === p.name && deps.noArea(e); })) return false;
            return !tanks.some(function (t) { return Math.hypot(t.x - p.x, t.y - p.y) <= tauntRange; });
        });
        if (!victim) return false;
        game.useSkill("absorb", victim.entity).catch(function () {});
        if (Date.now() - lastAbsorbLog > 10000) {
            lastAbsorbLog = Date.now();
            deps.log("priest", "Absorb Sins: monsters off " + victim.entity.name + " (" + Math.round(victim.ratio * 100) + "% HP, no tank near)", "yellow");
        }
        return true;
    }

    return { tryAbsorb: tryAbsorb };
};
