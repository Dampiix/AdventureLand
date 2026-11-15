// =====================================================================
// bot_class_paladin – Paladin skills.
//   survive: self-heal ("selfheal", 20 MP) below the configured HP ratio
//   fight:   Smash (lvl 10, 380 MP) on targets that take more than a couple
//            of hits, keeping an MP reserve for healing
// =====================================================================

module.exports = function createPaladin(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.paladin;

    return {
        name: "paladin",

        survive: function () {
            if (util.hpRatio() < c.selfHealBelow && util.canCast("selfheal")) {
                use_skill("selfheal").catch(function () {});
                return true;
            }
            return false;
        },

        support: function () { return false; },

        fight: function (target) {
            const smash = G.skills.smash;
            if (c.useSmash && util.canCast("smash") &&
                character.mp - smash.mp >= c.mpReserve &&
                target.hp > character.attack * 2) {
                use_skill("smash", target).catch(function () {});
            }
            return false; // basic attack as well
        },
    };
};
