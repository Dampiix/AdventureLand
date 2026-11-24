// =====================================================================
// classes/mage/mage.js (slot bot_class_mage) - the mage class (module plan, pilot step 4).
// The class only knows what it is - a ranged magical fighter that kites - and which skill modules it has; how each
// skill works is in its own module, which takes its dependencies from here and nothing from the rest of the bot:
//   energize.js   MP to a member / speed burst          (support)
//   reflect.js    Reflective Shield on the most magical damage taken   (support)
//   blaster.js    Blaster mode, aim and splash safety  (always, fight)
//   blink.js      Blink on routes                       (always)
//   team-port.js  Team Magiport at the team goal        (always)
// Mana Burst (off in config) stays here. The interface for the fighter is the same as before the split:
// name, survive(), always(), support(), fight(target).
// Stateful helpers (log/journal, hit factors) come from the one shared ctx.util; lib/game.js is stateless and loaded
// directly. ctx.targeting and ctx.gear are created after the class: they are reached through getters.
// =====================================================================

const game = require("../../lib/game.js");
const createEnergize = require("./energize.js");
const createReflect = require("./reflect.js");
const createBlaster = require("./blaster.js");
const createBlink = require("./blink.js");
const createTeamPort = require("./team-port.js");
const createTeamView = require("../../team/team-view.js");

module.exports = function createMage(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.mage;
    const policy = function () { return (ctx.config.events && ctx.config.events.policy) || {}; };

    // Shared deps.
    const members = function () { return ctx.party.memberNames(); };
    const manual = function () { return !!(ctx.cave && ctx.cave.active()); };
    // A boss: cooperative or one of our events.policy names (against bosses always staff + book).
    const isBoss = function (m) {
        const def = (m && game.data().monsters[m.mtype]) || {};
        return !!(m && (def.cooperative || policy()[m.mtype] !== undefined));
    };

    const energize = createEnergize({ game: game, members: members, log: util.log, errReason: util.errReason }, {
        enabled: c.energize !== false, energizeBelow: c.energizeBelow, energizeAbove: c.energizeAbove, burstLeadMs: c.burstLeadMs,
    });
    const reflect = createReflect({ game: game, members: members, log: util.log }, {
        enabled: c.reflect !== false, keepMp: c.reflectKeepMp, minAttack: c.reflectMinAttack,
    });
    const blaster = createBlaster({
        game: game, members: members, log: util.log, errReason: util.errReason, distanceTo: util.distanceTo,
        kiteRisk: util.kiteRisk, attackersOnMe: util.attackersOnMe, courageOf: util.courageOf,
        weaponPower: util.weaponPower, isDoublehand: util.isDoublehand,
        noArea: function (m) { return util.noArea(ctx.config, m); },
        foreignOnlyBlocks: function (m) { return util.foreignOnlyBlocks(ctx.config, m); },
        isBoss: isBoss,
        bossEventActive: function () { return !!(ctx.events && ctx.events.current && ctx.events.current()); },
        // /manual outside the cave switches the Blaster off; inside the cave it is allowed (small groups, far apart).
        manualBlocks: function () { return !!(ctx.cave && ctx.cave.active() && !ctx.cave.caveManual()); },
        packVerdict: function (strongest, n) { return ctx.targeting && ctx.targeting.packVerdict ? ctx.targeting.packVerdict(strongest, n) : null; },
        holdWeapons: function (ms) { return ctx.gear.holdWeapons(ms); },
        equipBatch: function (batch) { return ctx.gear.equipBatch(batch); },
    }, c.blaster);
    const blink = createBlink({
        game: game, log: util.log, errReason: util.errReason, attackersOnMe: util.attackersOnMe, manual: manual,
        // Never into a farm spot: the team goal's spot first, else the leader's or our own farm target.
        farmType: function () {
            const goal = ctx.party.teamGoal ? ctx.party.teamGoal() : null;
            const leadInfo = ctx.party.leaderInfo ? ctx.party.leaderInfo() : null;
            const farmNow = ctx.targeting && ctx.targeting.farmNow ? ctx.targeting.farmNow() : null;
            return (goal && goal.kind === "spot" && goal.name) || (leadInfo && leadInfo.farm) || (farmNow && farmNow.monster) || null;
        },
        inSpotArea: function (p, type) { return !!(ctx.targeting.inSpotArea && ctx.targeting.inSpotArea(p, type)); },
    }, c.blinkTravel);
    // Team view (step 1): the members' live positions when they run in our client.
    const teamView = createTeamView({ game: game });
    const teamPort = createTeamPort({
        game: game, log: util.log, errReason: util.errReason, distanceTo: util.distanceTo,
        partyEnabled: function () { return !!ctx.party.enabled; },
        members: members,
        teamGoal: function () { return ctx.party.teamGoal(); },
        atGoal: function (g) { return ctx.party.atGoal(g); },
        goalLabel: function (g) { return ctx.party.goalLabel(g); },
        manual: manual,
        searchActive: function () { return !!(ctx.events && ctx.events.searchJob && ctx.events.searchJob()); },
        fighters: function () { return (ctx.config.team && ctx.config.team.fighters) || []; },
        tankClasses: function () { return ((ctx.config.targeting && ctx.config.targeting.teamSafety) || {}).tankClasses || ["warrior", "paladin"]; },
        memberPos: function (n) {
            try {
                const e = teamView.member(n), p = e && e.game();
                return p ? { map: p.map, x: p.real_x, y: p.real_y, rip: p.rip, type: p.ctype } : null;
            } catch (x) { return null; }
        },
    }, c.magiport);

    return {
        name: "mage",

        survive: function () { return false; },

        always: function () { teamPort.tick(); blaster.tick(); blink.tick(); },

        support: function () {
            reflect.tick();
            energize.tick();
            return false; // neither replaces the attack
        },

        fight: function (target) {
            if (blaster.fight(target)) return true;
            // Mana Burst: the whole MP pool as damage - off in config (it empties the mage).
            if (c.useBurst && game.canCast("burst") && game.mpRatio() > 0.95 &&
                target.hp > game.me().mp * game.data().skills.burst.ratio) {
                game.useSkill("burst", target).catch(function () {});
            }
            return false;
        },
    };
};
