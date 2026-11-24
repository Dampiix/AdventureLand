// =====================================================================
// classes/ranger/ranger.js (slot bot_class_ranger) - the ranger class (module plan, stage 2): a ranged physical fighter
// that kites. Its skill modules:
//   three-shot.js    3-Shot on three monsters (replaces the attack)   (fight)
//   sturdy-shots.js  Hunter's Mark, Supershot, Poison Arrow           (fight)
// Interface for the fighter as before: name, survive(), support(), fight(target).
// =====================================================================

const game = require("../../lib/game.js");
const createThreeShot = require("./three-shot.js");
const createSturdyShots = require("./sturdy-shots.js");

module.exports = function createRanger(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.ranger;

    const threeShot = createThreeShot({
        game: game, members: function () { return ctx.party.memberNames(); }, hitMultiplier: util.hitMultiplier,
        tooSpiky: function (m) { return util.tooSpiky(ctx.config, m); }, noArea: function (m) { return util.noArea(ctx.config, m); },
        damageTypeOf: util.damageTypeOf, fearRoom: util.fearRoom, distanceTo: util.distanceTo,
        strikeSkill: function (name, targets) { return ctx.strike.skill(name, targets); },
    }, { mpReserveRatio: c.mpReserveRatio });
    const sturdyShots = createSturdyShots({ game: game, countItem: util.countItem },
        { sturdyHits: c.sturdyHits, mpReserveRatio: c.mpReserveRatio, usePoisonArrow: !!c.usePoisonArrow });

    return {
        name: "ranger",

        survive: function () { return false; },
        support: function () { return false; },

        fight: function (target) {
            if (threeShot.fight(target)) return true;
            sturdyShots.fight(target);
            return false;
        },
    };
};
