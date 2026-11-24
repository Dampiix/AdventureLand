// =====================================================================
// classes/rogue/stealth.js - Assassin's Smoke as an escape: below smokeBelow with monsters on us we go invisible (the
// monsters lose us), stop attacking (a hit would show us again), walk to a quiet spot - no monster within smokeClear
// px - and drink there until smokeUntil of max HP, then fight on. In a party, following the leader, we show ourselves
// again once done hiding (invisible, the priest can't see or heal us and the leader waits for us).
// Interface: createStealth(deps, options) -> { tick(), survive(), hide() -> true while hiding (no fight, no pull) }
//   deps: game, xy(e), distanceTo(e), attackersOnMe(), quiet(promise), isMember(), detached(), log, status(text, color)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    smokeBelow: 0.25,    // smoke below this HP share with monsters on us (0 = never)
    smokeUntil: 0.6,     // hide until this HP share
    smokeClear: 200,     // a quiet spot has no monster this close
};

module.exports = function createStealth(deps, options) {
    const game = deps.game;
    const c = Object.assign({}, DEFAULTS, options || {});
    let hiding = false, hideSpot = null, hideSince = 0, lastUnhide = 0;

    function invisible() {
        const me = game.me();
        return !!(me.s && me.s.invis);
    }
    function quietSpot() {
        const me = deps.xy(game.me());
        const monsters = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead;
        }).map(deps.xy);
        const clear = c.smokeClear || 200;
        let best = null, bestD = Infinity;
        for (const r of [150, 220, 300, 400]) {
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
                if (monsters.some(function (p) { return Math.hypot(p.x - x, p.y - y) < clear; })) continue;
                if (r < bestD) { bestD = r; best = { x: x, y: y }; }
            }
            if (best) break; // the nearest ring with a quiet point
        }
        return best;
    }
    function hide() {
        if (!hiding) return false;
        const done = game.hpRatio() >= (c.smokeUntil || 0.6) || (!invisible() && Date.now() - hideSince > 3000) ||
            Date.now() - hideSince > 60 * 1000;
        if (done) {
            hiding = false;
            deps.log("rogue", "back to the fight at " + Math.round(game.hpRatio() * 100) + "% HP", "green");
            return false;
        }
        if (!hideSpot || (!game.isMoving(game.me()) && deps.distanceTo(hideSpot) > 30 &&
            Object.values(game.entities()).some(function (e) { return e && e.type === "monster" && !e.dead && deps.distanceTo(e) < (c.smokeClear || 200); }))) {
            hideSpot = quietSpot();
            if (hideSpot) deps.quiet(game.moveTo(hideSpot.x, hideSpot.y));
        }
        deps.status("smoke: hiding " + Math.round(game.hpRatio() * 100) + "%", "orange");
        return true;
    }
    // Every tick: in a party, visible again once done hiding.
    function tick() {
        if (!hiding && invisible() && deps.isMember() && !deps.detached() && Date.now() - lastUnhide > 3000) {
            lastUnhide = Date.now();
            game.stopAction("invis").catch(function () {});
            deps.log("rogue", "visible again for the party", "white");
        }
    }
    // Assassin's Smoke: monsters lose us (its cooldown starts when we show again).
    function survive() {
        if (!hiding && c.smokeBelow && game.hpRatio() < c.smokeBelow && deps.attackersOnMe().length && game.canCast("invis") && !invisible()) {
            game.useSkill("invis").catch(function () {});
            hiding = true;
            hideSpot = null;
            hideSince = Date.now();
            deps.log("rogue", "Assassin's Smoke at " + Math.round(game.hpRatio() * 100) + "% HP - hiding", "yellow");
        }
        return false; // potions as usual
    }

    return { tick: tick, survive: survive, hide: hide };
};
