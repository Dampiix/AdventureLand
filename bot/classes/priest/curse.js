// =====================================================================
// classes/priest/curse.js - Curse (400 MP, 5 s) on sturdy targets (more than 5x our attack in HP, not cursed yet):
// they take 20 % more damage and deal 20 % less. Only while mpReserveRatio of our MP stays after the cast.
// Interface: createCurse(deps, options) -> { tick(target) }
//   deps: game
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    mpReserveRatio: 0.4,   // MP share kept after the cast
};

module.exports = function createCurse(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function tick(target) {
        const me = game.me(), G = game.data();
        if (o.enabled && game.canCast("curse") &&
            me.mp - G.skills.curse.mp >= me.max_mp * o.mpReserveRatio &&
            target.hp > me.attack * 5 && !(target.s && target.s.cursed) &&
            game.inRange(target, "curse")) {
            game.useSkill("curse", target).catch(function () {});
        }
    }

    return { tick: tick };
};
