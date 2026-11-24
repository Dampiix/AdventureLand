// =====================================================================
// classes/ranger/sturdy-shots.js - single-target skills on sturdy targets (more than sturdyHits of our hits in HP),
// always keeping an MP reserve:
//   Hunter's Mark (+10 % damage taken), Supershot (1.5x, 30 s cooldown, needs a bow),
//   Poison Arrow (consumes a Poison Sack): poisoned monsters attack 10 % slower and heal less.
// Bow requirements are checked by game.canCast via the skill's wtype.
// Interface: createSturdyShots(deps, options) -> { fight(target) }
//   deps: game, countItem(name)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    sturdyHits: 3,          // only on targets needing this many hits or more
    mpReserveRatio: 0.3,    // MP share kept after each skill
    usePoisonArrow: true,   // consumes a Poison Sack
};

module.exports = function createSturdyShots(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function sturdy(target) {
        return target.hp > game.me().attack * o.sturdyHits;
    }
    function fight(target) {
        const reserve = game.me().max_mp * o.mpReserveRatio;
        if (sturdy(target) && !(target.s && target.s.marked) &&
            game.canCast("huntersmark") && game.mpLeftAfter("huntersmark") >= reserve) {
            game.useSkill("huntersmark", target).catch(function () {});
        }
        if (sturdy(target) && game.canCast("supershot") && game.mpLeftAfter("supershot") >= reserve) {
            game.useSkill("supershot", target).catch(function () {});
        }
        if (o.usePoisonArrow && sturdy(target) && !(target.s && target.s.poisoned) &&
            deps.countItem("poison") > 0 && game.canCast("poisonarrow") && game.mpLeftAfter("poisonarrow") >= reserve) {
            game.useSkill("poisonarrow", target).catch(function () {});
        }
    }

    return { fight: fight };
};
