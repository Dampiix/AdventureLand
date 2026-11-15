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
};

let botRunner = null;
let botComms = null;
let botParty = null;
let botSupply = null;

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

// The game logs every gold pickup ("123 gold"). The game has no switch for it, so in
// the client a filter in front of its log function drops those lines
// (config.ui.hideGoldLogs). Installed once per window; everything else passes.
function hideGoldLogs() {
    try {
        if (!BOT_CONFIG.ui || !BOT_CONFIG.ui.hideGoldLogs) return;
        if (typeof parent === "undefined" || !parent || typeof parent.add_log !== "function" || parent.dmpxGoldFilter) return;
        const original = parent.add_log;
        parent.add_log = function (message, color) {
            if (typeof message === "string" && /^[\d,.]+ gold$/i.test(message.replace(/<[^>]*>/g, "").trim())) return;
            return original.apply(this, arguments);
        };
        parent.dmpxGoldFilter = true;
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
function handle_command(command) {
    if (command === "pickup" && botSupply) {
        botSupply.requestNow();
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
