// =====================================================================
// classes/priest/revive.js - Revive (consumes an Essence of Life): heal a fallen member's gravestone to full, then
// revive it. The dead fighter is told to wait instead of respawning in town. Not next to a rage zone: the walk to the
// gravestone would take us into it (the warrior died 9 px from the big booboo zone) - it respawns in town then.
// Interface: createRevive(deps, options) -> { tryRevive() -> true when this tick's action was used }
//   deps: game, members(), countItem(name), rageBoxes(map) -> [{ type, b: [x1, y1, x2, y2] }], xy(e),
//         send(name, type, data), moveToEntity(e), heal(entity, whileCooling) (heal.js), log
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
};

module.exports = function createRevive(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});
    let lastWaitSent = 0;

    function tryRevive() {
        const me = game.me();
        if (!o.enabled || deps.countItem("essenceoflife") < 1) return false;
        const dead = deps.members()
            .filter(function (n) { return n !== me.name; })
            .map(function (n) { return game.player(n); })
            .find(function (p) { return p && p.rip; });
        if (!dead) return false;
        const boxes = deps.rageBoxes(me.map);
        const dp = deps.xy(dead);
        const nearZone = boxes.find(function (z) {
            const b = z.b;
            return Math.hypot(Math.max(b[0] - dp.x, 0, dp.x - b[2]), Math.max(b[1] - dp.y, 0, dp.y - b[3])) < 150;
        });
        if (nearZone) {
            if (Date.now() - lastWaitSent > 60 * 1000) {
                lastWaitSent = Date.now();
                deps.log("priest", "not reviving " + dead.name + ": the gravestone lies at the " + nearZone.type + " rage zone", "orange");
            }
            return false;
        }
        if (Date.now() - lastWaitSent > 5000) {
            lastWaitSent = Date.now();
            deps.send(dead.name, "revive_wait", {});
        }
        if (!game.inRange(dead, "revive")) {
            if (!game.isMoving(me)) deps.moveToEntity(dead);
            return true;
        }
        if (dead.hp < dead.max_hp) return deps.heal(dead, true);
        if (game.canCast("revive")) {
            game.useSkill("revive", dead.name).catch(function () {});
            deps.log("priest", "reviving " + dead.name, "green");
        }
        return true;
    }

    return { tryRevive: tryRevive };
};
