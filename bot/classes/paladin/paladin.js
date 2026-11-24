// =====================================================================
// classes/paladin/paladin.js (slot bot_class_paladin) - the paladin class (module plan, stage 2): a tank that heals
// itself. Its skill modules:
//   mana-shield.js  Mana Shield toggle                         (survive)
//   oath.js         Guardian's Oath on a hurt ally             (support)
//   cleansing.js    Cleansing Light on an ally                 (support)
// Self-heal (20 MP, below selfHealBelow) and Smash (level 10, 380 MP, needs a mace; on targets taking more than a couple
// of hits, keeping mpReserve MP) are a few lines and stay here.
// Interface for the fighter as before: name, survive(), support(), fight(target).
// =====================================================================

const game = require("../../lib/game.js");
const createManaShield = require("./mana-shield.js");
const createOath = require("./oath.js");
const createCleansing = require("./cleansing.js");

module.exports = function createPaladin(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.paladin;
    const members = function () { return ctx.party.memberNames(); };

    const manaShield = createManaShield({ game: game, log: util.log }, c.manaShield || null);
    const oath = createOath({ game: game, members: members }, { oathBelow: c.oathBelow });
    const cleansing = createCleansing({ game: game, members: members, log: util.log }, { enabled: !!c.useCleansingLight });

    return {
        name: "paladin",

        survive: function () {
            manaShield.tick();
            if (game.hpRatio() < c.selfHealBelow && game.canCast("selfheal")) {
                game.useSkill("selfheal").catch(function () {});
                return true;
            }
            return false;
        },

        support: function () {
            oath.tick();
            cleansing.tick();
            return false;
        },

        fight: function (target) {
            const me = game.me(), smash = game.data().skills.smash;
            if (c.useSmash && game.canCast("smash") &&
                me.mp - smash.mp >= c.mpReserve &&
                target.hp > me.attack * 2) {
                game.useSkill("smash", target).catch(function () {});
            }
            return false; // basic attack as well
        },
    };
};
