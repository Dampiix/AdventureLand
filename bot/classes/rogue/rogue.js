// =====================================================================
// classes/rogue/rogue.js (slot bot_class_rogue) - the rogue class (module plan, stage 2): a fast melee fighter, solo
// farmer and party helper. Its skill modules:
//   swiftness.js    Rogue Swiftness on us and members            (always)
//   stealth.js      Assassin's Smoke as an escape, hiding        (always, survive, support)
//   fanofknives.js  Fan of Knives - the Knife Belt's skill       (fight)
//   strikes.js      Quick Stab/Punch, Mental Burst, Poisonous Touch (fight)
// Interface for the fighter as before: name, always(), survive(), support(), fight(target).
// =====================================================================

const game = require("../../lib/game.js");
const createSwiftness = require("./swiftness.js");
const createStealth = require("./stealth.js");
const createFanOfKnives = require("./fanofknives.js");
const createStrikes = require("./strikes.js");

module.exports = function createRogue(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.rogue || {};
    const reserve = function () { return game.me().max_mp * (c.mpReserveRatio || 0.25); };

    const swiftness = createSwiftness({
        game: game, members: function () { return ctx.party.memberNames(); }, partyEnabled: function () { return !!ctx.party.enabled; },
        distanceTo: util.distanceTo, reserve: reserve,
    }, { enabled: !!c.swiftness });
    const stealth = createStealth({
        game: game, xy: util.xy, distanceTo: util.distanceTo, attackersOnMe: util.attackersOnMe, quiet: util.quiet,
        isMember: function () { return !!ctx.party.isMember; },
        detached: function () { return !!(ctx.party.detached && ctx.party.detached()); },
        log: util.log, status: util.status,
    }, { smokeBelow: c.smokeBelow, smokeUntil: c.smokeUntil, smokeClear: c.smokeClear });
    const fan = createFanOfKnives({
        game: game, distanceTo: util.distanceTo, tooSpiky: function (m) { return util.tooSpiky(ctx.config, m); }, reserve: reserve,
    }, { fanFrom: c.fanFrom });
    const strikes = createStrikes({ game: game, countItem: util.countItem, reserve: reserve },
        { mentalBurst: !!c.mentalBurst, poisonCoat: c.poisonCoat || {} });

    return {
        name: "rogue",

        always: function () {
            swiftness.tick();
            stealth.tick();
        },

        survive: function () { return stealth.survive(); },

        // While hiding we neither fight nor pull: the combat waits until we are healed up.
        support: function () { return stealth.hide(); },

        fight: function (target) {
            fan.fight(target);
            strikes.fight(target);
            return false; // basic attack as well
        },
    };
};
