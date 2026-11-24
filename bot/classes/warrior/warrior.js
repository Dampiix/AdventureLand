// =====================================================================
// classes/warrior/warrior.js (slot bot_class_warrior) - the warrior class (module plan, stage 2).
// A melee tank. Its parts (one feature each; the Agitate parts share one internal state):
//   common.js          shared helpers (MP reserve, monsters on allies / around us, distances)
//   protect.js         Taunt and the protective Agitate for allies             (support)
//   mobility.js        Charge on the way, Dash in a fight                       (always, move)
//   agitate-mode.js    Agitate mode and automatic decision, learned values
//   agitate-point.js   where to Agitate from, splash weapons on
//   agitate-stream.js  the stream: Agitate on cooldown, stream fight, gap step
//   agitate.js         the pack tick that drives the Agitate parts            (support)
//   splash.js          splash weapons outside the Agitate modes, off on the way (always)
//   escape.js          run from a losing fight                                 (support)
//   sword-swap.js      Swords of the Dead on quick targets, fire blades on long ones (always)
// Hard Shell (survive), War Cry, Cleave and Stomp (fight) are a few lines each and stay here.
//   survive: Hard Shell (lvl 60, 480 MP) when the predicted next physical hits on us x hardShell.factor reach our HP
//   support: escape; the Agitate pack mode; Taunt / Agitate for allies
//   fight:   War Cry (lvl 70) on sturdy fights; Cleave (lvl 52, axe/scythe) when several monsters stand around us,
//            Stomp (lvl 52, basher) when several attack the team
//   move:    Charge whenever we walk; Dash only with dash.enabled (off in the config)
// Outside dependencies come in through `deps` only (game, util, config, party, targeting, gear, strike, events); party,
// targeting, gear, strike and events are created after the class, so they are read when used.
// =====================================================================

const game = require("../../lib/game.js");
const PARTS = [
    require("./common.js"), require("./protect.js"), require("./mobility.js"), require("./agitate-mode.js"),
    require("./agitate-point.js"), require("./agitate-stream.js"), require("./escape.js"), require("./splash.js"),
    require("./agitate.js"), require("./sword-swap.js"),
];

module.exports = function createWarrior(ctx) {
    const deps = {
        game: game, util: ctx.util, config: ctx.config,
        get party() { return ctx.party; },
        get targeting() { return ctx.targeting; },
        get gear() { return ctx.gear; },
        get strike() { return ctx.strike; },
        get events() { return ctx.events; },
    };
    const util = ctx.util;
    const c = ctx.config.classes.warrior;
    const ag = c.agitate || {};
    // The warrior's internal state, shared by its parts: they put their functions here too.
    const w = { lastAgitate: { at: 0, type: null } };
    PARTS.forEach(function (install) { install(w, deps); });

    return {
        name: "warrior",

        // Charge (+30 speed for 3.2 s, 40 s cooldown, no MP) whenever we walk - farm trips, boss searches and Daisy trips too.
        always: function () {
            if (c.useCharge && game.isMoving(game.me())) w.tryCharge();
            w.dropSplashOnTheWay();
            w.swordSwap();
        },

        // Called once by the fighter when we die, with the killer it blames (the kind that did the most damage in the last
        // seconds). A death within 90 s of an Agitate: no Agitate on the KILLER's kind for agitate.deathDenyMs. Killer
        // unknown: no block.
        onDeath: function (killer) {
            if (!w.lastAgitate.type || Date.now() - w.lastAgitate.at > 90 * 1000) return;
            if (!killer || !game.data().monsters[killer]) {
                util.log("warrior", "agitate: died within 90 s of an Agitate (" + w.lastAgitate.type + "), killer unknown - no block", "orange");
                return;
            }
            w.statOf(killer).denyUntil = Date.now() + (ag.deathDenyMs || 2 * 60 * 60 * 1000);
            w.saveStats(true);
            w.auto.at = 0;
            w.pack.state = "idle";
            util.log("warrior", "agitate: killed by " + killer + " within 90 s of an Agitate (" + w.lastAgitate.type + ") - no Agitate on " +
                killer + " for " + Math.round((ag.deathDenyMs || 2 * 60 * 60 * 1000) / 60000) + " min", "red");
        },

        survive: function () {
            // Hard Shell on predicted damage: when the next physical hits of everything on us, x factor, reach our HP.
            const h = c.hardShell || {};
            if (h.enabled && util.canCast("hardshell") &&
                util.incomingDamage("physical") * (h.factor || 3) >= game.me().hp) {
                game.useSkill("hardshell").catch(function () {});
                util.log("warrior", "Hard Shell", "yellow");
            }
            return false; // potions as usual
        },

        // Agitate "stream": while Agitate can't be cast, walk to the incoming monsters instead of waiting for them.
        meetIncoming: function () {
            return w.packOn() && !ctx.party.enabled && w.agMode() === "swords" && (ag.swords || "stream") === "stream" &&
                (!util.canCast("agitate") || game.me().mp < game.data().skills.agitate.mp + w.reserve());
        },

        support: function () {
            if (w.escapeTick()) return true; // solo and party: run from a losing fight
            // In a party the protective Taunt/Agitate for allies comes first, then the stream.
            if (!ctx.party.enabled && w.packTick()) return true; // Agitate pack mode (solo)
            if (ctx.party.enabled && w.onOthers().length === 0 && w.packTick()) return true;
            return w.allies();
        },

        fight: function (target) {
            const me = game.me(), G = game.data();
            const sturdy = target.hp > me.attack * (c.sturdyHits || 4);
            if (sturdy && util.canCast("warcry") && util.mpLeftAfter("warcry") >= w.reserve() && ctx.party.enabled) {
                game.useSkill("warcry").catch(function () {});
            }
            // Cleave and Stomp hit everything around: never with a Giga Crab in reach (events.noArea).
            const giga = util.noAreaNear(ctx.config, Math.max(G.skills.cleave.range, G.skills.stomp ? G.skills.stomp.range : 0) + 40);
            if (!giga && util.canCast("cleave") && util.mpLeftAfter("cleave") >= w.reserve() && !w.spikyNear(G.skills.cleave.range) &&
                w.around(G.skills.cleave.range, false).length >= (c.cleaveFrom || 3)) {
                game.useSkill("cleave").catch(function () {});
            }
            if (!giga && util.canCast("stomp") && util.mpLeftAfter("stomp") >= w.reserve() && !w.spikyNear(G.skills.stomp.range) &&
                w.around(G.skills.stomp.range, true).length >= (c.stompFrom || 2)) {
                game.useSkill("stomp").catch(function () {});
            }
            return false; // basic attack as well
        },

        // Called while we walk: towards `target` (chase) or along a route (target null).
        move: function (target) {
            w.tryCharge();
            return target ? w.tryDash(target) : false;
        },
    };
};
