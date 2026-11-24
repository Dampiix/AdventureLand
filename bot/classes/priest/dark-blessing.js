// =====================================================================
// classes/priest/dark-blessing.js - Dark Blessing (level 70, 900 MP, 60 s): +25 % damage for the party for 8 s - worth
// it on long fights: targets needing sturdyHits+ of our hits, and bosses (cooperative). Only while mpReserveRatio of our
// MP stays after the cast.
// Interface: createDarkBlessing(deps, options) -> { tick(target) }
//   deps: game, log
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    sturdyHits: 10,        // targets with more than this many of our hits in HP
    mpReserveRatio: 0.4,   // MP share kept after the cast
};

module.exports = function createDarkBlessing(deps, options) {
    const game = deps.game;
    const db = Object.assign({}, DEFAULTS, options || {});

    function tick(target) {
        const me = game.me(), G = game.data();
        const def = G.monsters[target.mtype] || {};
        if (db.enabled && game.canCast("darkblessing") &&
            me.mp - G.skills.darkblessing.mp >= me.max_mp * db.mpReserveRatio &&
            (def.cooperative || target.hp > me.attack * (db.sturdyHits || 10)) &&
            game.inRange(target)) {
            game.useSkill("darkblessing").catch(function () {});
            deps.log("priest", "Dark Blessing on " + target.mtype, "yellow");
        }
    }

    return { tick: tick };
};
