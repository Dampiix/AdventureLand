// =====================================================================
// classes/paladin/cleansing.js - Cleansing Light (level 30): lift harmful conditions (poison, curse, burn, stun, ...)
// from an ally in range - not from ourselves.
// Interface: createCleansing(deps, options) -> { tick() }
//   deps: game, members(), log
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
};

module.exports = function createCleansing(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function cleanseTarget() {
        const me = game.me(), G = game.data();
        return deps.members().find(function (name) {
            if (name === me.name) return false;
            const p = game.player(name);
            if (!p || p.rip || !game.inRange(p, "cleansing_light")) return false;
            return Object.keys(p.s || {}).some(function (k) { return G.conditions[k] && G.conditions[k].cleansable; });
        }) || null;
    }
    function tick() {
        if (o.enabled && game.canCast("cleansing_light")) {
            const name = cleanseTarget();
            if (name) {
                game.useSkill("cleansing_light", name).catch(function () {});
                deps.log("paladin", "Cleansing Light on " + name, "green");
            }
        }
    }

    return { tick: tick };
};
