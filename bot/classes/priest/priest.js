// =====================================================================
// classes/priest/priest.js (slot bot_class_priest) - the priest class (module plan, stage 2).
// A healer that fights with its heal power; works solo too (then it only looks at itself). It knows which skill modules
// it has; how each works is in its module:
//   heal.js           heal the most hurt member, Party Heal          (survive, support, supportInPlace)
//   absorb.js         Absorb Sins as an emergency                    (support)
//   luck-catch.js     Absorb Sins on dying monsters, with the luck gear (support)
//   revive.js         revive a fallen member (Essence of Life)       (support)
//   curse.js          Curse on sturdy targets                        (fight)
//   dark-blessing.js  Dark Blessing on long fights                   (fight)
// Interface for the fighter as before: name, survive(), supportInPlace(), support(), fight(target).
// Stateful helpers come from the one shared ctx.util; lib/game.js is stateless and loaded directly. ctx.targeting,
// ctx.gear and ctx.strike are created after the class: they are reached through getters.
// =====================================================================

const game = require("../../lib/game.js");
const createHeal = require("./heal.js");
const createAbsorb = require("./absorb.js");
const createLuckCatch = require("./luck-catch.js");
const createRevive = require("./revive.js");
const createCurse = require("./curse.js");
const createDarkBlessing = require("./dark-blessing.js");

module.exports = function createPriest(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.priest;

    const members = function () { return ctx.party.memberNames(); };
    const partyEnabled = function () { return !!ctx.party.enabled; };
    const noArea = function (m) { return util.noArea(ctx.config, m); };
    const tankClasses = function () { return (ctx.config.targeting.teamSafety && ctx.config.targeting.teamSafety.tankClasses) || ["warrior", "paladin"]; };

    const heal = createHeal({
        game: game, members: members, partyEnabled: partyEnabled,
        strikeHeal: function (e) { return ctx.strike.heal(e); }, moveToEntity: util.moveToEntity,
    }, { partyHealBelow: c.partyHealBelow, partyHealDanger: c.partyHealDanger, partyHealOne: c.partyHealOne });
    const absorb = createAbsorb({
        game: game, members: members, partyEnabled: partyEnabled, distanceTo: util.distanceTo, noArea: noArea,
        tankClasses: tankClasses, log: util.log,
    }, Object.assign({ enabled: false }, c.absorb || {}));
    const luckCatch = createLuckCatch({
        game: game, members: members, partyEnabled: partyEnabled, distanceTo: util.distanceTo,
        attackersOnMe: util.attackersOnMe, damageTypeOf: util.damageTypeOf, courageOf: util.courageOf, noArea: noArea,
        canPredictDeaths: function () { return !!(ctx.targeting && ctx.targeting.diesSoon); },
        diesSoon: function (m, hits) { return ctx.targeting.diesSoon(m, hits); },
        luckOn: function () { if (ctx.gear && ctx.gear.luckOn) ctx.gear.luckOn(); },
        log: util.log,
    }, Object.assign({ enabled: false }, c.luckCatch || {}));
    const revive = createRevive({
        game: game, members: members, countItem: util.countItem, xy: util.xy, moveToEntity: util.moveToEntity,
        rageBoxes: function (map) { return ctx.targeting && ctx.targeting.rageBoxes ? ctx.targeting.rageBoxes(map) : []; },
        send: function (name, type, data) { return ctx.comms.send(name, type, data); },
        heal: heal.heal, log: util.log,
    }, { enabled: !!c.useRevive });
    const curse = createCurse({ game: game }, { enabled: !!c.useCurse, mpReserveRatio: c.mpReserveRatio });
    const darkBlessing = createDarkBlessing({ game: game, log: util.log },
        Object.assign({ enabled: false }, c.darkBlessing || {}, { mpReserveRatio: c.mpReserveRatio }));

    return {
        name: "priest",

        survive: function () {
            if (game.hpRatio() < c.selfHealBelow) return heal.heal(game.me(), false);
            return false;
        },

        // Busy phases (following, waiting, trips): Party Heal and heals on members already in range - never a step.
        // True when a heal is planned.
        supportInPlace: function () {
            const hurt = heal.hurtMembers();
            if (heal.partyHeal(hurt)) return false;
            const me = game.me();
            const worst = hurt.find(function (m) { return m.ratio < c.healBelow && (m.entity === me || game.inRange(m.entity, "heal")); });
            if (!worst) return false;
            ctx.strike.heal(worst.entity);
            return true;
        },

        support: function () {
            if (revive.tryRevive()) return true;
            const hurt = heal.hurtMembers();
            if (heal.partyHeal(hurt)) return false; // Party Heal is a skill: the heal/attack stays available
            if (!luckCatch.tryLuckCatch()) absorb.tryAbsorb(hurt); // skills too: the heal below still runs
            const worst = hurt[0];
            if (worst && worst.ratio < c.healBelow) return heal.heal(worst.entity, true);
            return false;
        },

        fight: function (target) {
            curse.tick(target);
            darkBlessing.tick(target);
            return false;
        },
    };
};
