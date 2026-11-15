// =====================================================================
// bot_main – entry point for EVERY character (slot "bot_main").
//
// Run it on the leader (DmpxPalTank) in the client. The leader starts the
// other characters of the current phase as CODE-only characters in the
// same client, each running this same slot. Every character looks itself
// up in bot_config and loads its role:
//   fighter  -> bot_fighter + its class module + party + targeting + supply
//   merchant -> bot_merchant
// =====================================================================

const BOT_CONFIG = require_code("bot_config");
const BOT_UTIL = require_code("bot_util");
const createBotComms = require_code("bot_comms");

const BOT_CLASS_SLOTS = {
    paladin: "bot_class_paladin",
    mage: "bot_class_mage",
    priest: "bot_class_priest",
};

let botRunner = null;
let botComms = null;
let botParty = null;

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

function startBot() {
    if (typeof code_settings !== "undefined") code_settings.log_cm = false;

    const me = BOT_CONFIG.characters[character.name];
    if (!me) {
        BOT_UTIL.status("not configured", "red");
        BOT_UTIL.log("bot", character.name + " is not in bot_config - not starting", "red");
        return;
    }

    botComms = createBotComms(BOT_CONFIG, BOT_UTIL);
    const ctx = { config: BOT_CONFIG, util: BOT_UTIL, comms: botComms, me: me };

    if (me.role === "merchant") {
        botRunner = require_code("bot_merchant")(ctx);
    } else {
        ctx.party = require_code("bot_party")(ctx);
        botParty = ctx.party;
        const classSlot = BOT_CLASS_SLOTS[character.ctype];
        const cls = classSlot ? require_code(classSlot)(ctx) : noClassModule();
        ctx.targeting = require_code("bot_targeting")(ctx);
        ctx.supply = require_code("bot_supply")(ctx);
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

// Called by the game when CODE is stopped
function on_destroy() {
    if (botRunner) botRunner.stop();
    if (botComms) botComms.stop();
    set_message("bot stopped", "gray");
}

startBot();
