// =====================================================================
// bot_main – entry point for EVERY character (slot "bot_main").
//
// Run it on the leader (DmpxPalTank) in the client. The leader starts the
// other characters of the current phase as CODE-only characters in the
// same client, each running this same slot. Every character looks itself
// up in bot_config and loads its role:
//   fighter  -> bot_fighter + its class module + party + hunts + events + drops + targeting + gear + supply
//   merchant -> bot_merchant + bot_workshop
// =====================================================================

const BOT_CONFIG = require_code("bot_config");
const BOT_UTIL = require_code("bot_util");
BOT_UTIL.deriveTeam(BOT_CONFIG);
const createBotComms = require_code("bot_comms");

const BOT_CLASS_SLOTS = {
    paladin: "bot_class_paladin",
    mage: "bot_class_mage",
    priest: "bot_class_priest",
    ranger: "bot_class_ranger",
    warrior: "bot_class_warrior",
    rogue: "bot_class_rogue",
};

let botRunner = null;
let botComms = null;
let botParty = null;
let botSupply = null;
let botTargeting = null;

function noClassModule() {
    return {
        name: character.ctype,
        survive: function () { return false; },
        support: function () { return false; },
        fight: function () { return false; },
    };
}

function startTeam() {
    const phase = BOT_CONFIG.phases[BOT_CONFIG.phase] || {};
    (phase.startWithLeader || []).forEach(function (name) {
        start_character(name, "bot_main")
            .then(function () { BOT_UTIL.log("bot", "started " + name, "green"); })
            .catch(function (e) { BOT_UTIL.log("bot", "could not start " + name + ": " + BOT_UTIL.errReason(e), "red"); });
    });
}

// The game logs every gold pickup ("123 gold") and every kill ("X killed a Bee").
// It has no switch for that, so in the client a filter in front of its log function
// drops those lines (config.ui.hideGoldLogs / hideKillLogs). Installed once per
// window; everything else passes.
function hideGoldLogs() {
    try {
        const ui = BOT_CONFIG.ui || {};
        if (!ui.hideGoldLogs && !ui.hideKillLogs) return;
        if (typeof parent === "undefined" || !parent || typeof parent.add_log !== "function" || parent.dmpxLogFilter) return;
        const original = parent.add_log;
        parent.add_log = function (message, color) {
            if (typeof message === "string") {
                const text = message.replace(/<[^>]*>/g, "").trim();
                if (ui.hideGoldLogs && /^[\d,.]+ gold$/i.test(text)) return;
                if (ui.hideKillLogs && /^\S+ killed an? .+$/i.test(text)) return;
            }
            return original.apply(this, arguments);
        };
        parent.dmpxLogFilter = true;
    } catch (e) {
        // not in a browser client (headless): nothing to filter
    }
}

function startBot() {
    if (typeof code_settings !== "undefined") {
        code_settings.log_cm = false;               // no "received CM" lines
        code_settings.log_smart_move = false;       // no "Searching for a path... / Path found!"
        code_settings.show_smart_move_text = false; // no floating pathfinding text
    }
    // Town teleport in route planning (player decision 2026-11-18): smart_move may channel
    // "Town" to the map's center when that is shorter than walking. Off by default in the game.
    // Only from far away (2026-11-18): the route search counts Town as a single step, so a
    // character two steps from the center took it again and again while following a moving
    // leader (3 s channel each time). Town is offered only beyond movement.townMinDistance px
    // from the map's center.
    if (typeof smart !== "undefined") {
        const mv = BOT_CONFIG.movement || {};
        let townWanted = !!mv.useTown;
        try {
            Object.defineProperty(smart, "use_town", {
                configurable: true,
                get: function () {
                    if (!townWanted) return false;
                    const m = G.maps[character.map];
                    const s = m && m.spawns && m.spawns[0];
                    return !!s && Math.hypot(character.x - s[0], character.y - s[1]) > (mv.townMinDistance || 600);
                },
                set: function (v) { townWanted = !!v; },
            });
        } catch (e) {
            smart.use_town = townWanted;
        }
    }
    hideGoldLogs();

    const me = BOT_CONFIG.characters[character.name];
    if (!me) {
        BOT_UTIL.status("not configured", "red");
        BOT_UTIL.log("bot", character.name + " is not in bot_config - not starting", "red");
        return;
    }

    botComms = createBotComms(BOT_CONFIG, BOT_UTIL);
    const ctx = { config: BOT_CONFIG, util: BOT_UTIL, comms: botComms, me: me };

    if (me.role === "merchant") {
        ctx.workshop = require_code("bot_workshop")(ctx);
        botRunner = require_code("bot_merchant")(ctx);
    } else {
        ctx.party = require_code("bot_party")(ctx);
        botParty = ctx.party;
        ctx.hunts = require_code("bot_hunts")(ctx);
        ctx.events = require_code("bot_events")(ctx);
        ctx.drops = require_code("bot_drops")(ctx);
        const classSlot = BOT_CLASS_SLOTS[character.ctype];
        const cls = classSlot ? require_code(classSlot)(ctx) : noClassModule();
        ctx.targeting = require_code("bot_targeting")(ctx);
        botTargeting = ctx.targeting;
        ctx.gear = require_code("bot_gear")(ctx);
        ctx.supply = require_code("bot_supply")(ctx);
        botSupply = ctx.supply;
        botRunner = require_code("bot_fighter")(ctx, cls);
    }

    BOT_UTIL.log("bot", "v" + BOT_CONFIG.version + " " + character.name + " as " + me.role + " (phase: " + BOT_CONFIG.phase + ")", "green");
    botRunner.start();

    if (character.name === BOT_CONFIG.leader) startTeam();
}

// Called by the game when a party invite arrives – bot_party only accepts the leader
function on_party_invite(name) {
    if (botParty) botParty.onInvite(name);
}

// Chat commands typed in this character's client, e.g. "/pickup".
// Returning -1 lets the game handle unknown commands as usual.
function handle_command(command, args) {
    if (command === "pickup" && botSupply) {
        botSupply.requestNow();
        return true;
    }
    // "/agitate off|swords|splash|chain|splashstream|config": the warrior's Agitate mode, kept across restarts
    // ("config" = back to config.classes.warrior.agitate).
    if (command === "agitate") {
        const v = (Array.isArray(args) ? args[0] : args) || "";
        if (["off", "swords", "splash", "chain", "splashstream", "config"].includes(v)) {
            set("agitate_mode:" + character.name, v === "config" ? null : v);
            game_log("[warrior] agitate mode set to " + v, "yellow");
        } else {
            game_log("usage: /agitate off|swords|splash|chain|splashstream|config", "orange");
        }
        return true;
    }
    // "/safety [map]": per-member guide verdicts and the team model for every monster there.
    if (command === "safety" && botTargeting) {
        botTargeting.safetyReport(Array.isArray(args) ? args.join(" ") : (args || ""));
        return true;
    }
    return -1;
}

// Called by the game when CODE is stopped
function on_destroy() {
    if (botRunner) botRunner.stop();
    if (botComms) botComms.stop();
    set_message("bot stopped", "gray");
}

startBot();
