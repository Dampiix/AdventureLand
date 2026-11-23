// =====================================================================
// bot_main – entry point for EVERY character (slot "bot_main").
//
// Run it on the team's leader in the client. The leader starts the
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
let botEvents = null; // on_magiport (v1.228.1)

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

// Chat commands for the player (player request 2026-11-21), typed in the leader's chat:
//   /phoenix, /jr, /greenjr, /mvampire, /fvampire, /skeletor (also /phönix, /vampir, /dracul, /gjr, /msdracul) - search that boss now (lifts a pause)
//   /search <boss>               - the same for another watched boss (mvampire, jr, greenjr)
// The game hands every command it doesn't know to handle_command(command, args) of the running
// CODE ("Command not found. You can add a handle_command function..."); -1 = not ours.
// 1.182.3-1.182.5 wrapped the game's say() instead - a wrapper from an earlier code load stopped
// working after a reload, so that wrapper is taken out again here.
function installChatCommands(ctx) {
    try {
        const page = parent;
        if (page.__dmpxSayOriginal) page.say = page.__dmpxSayOriginal;
        delete page.__dmpxChatCmd;
    } catch (e) { /* nothing to undo */ }
    // The commands themselves live in handle_command (below); it reads the bot's context from here.
    // 2026-11-21 (evening): this used to replace window.handle_command with a boss-only version, which
    // dropped /pickup, /agitate, /dps and /safety ("command not found").
    BOT_CMD_CTX = ctx;
}
var BOT_CMD_CTX = null;
// Every boss by its own name (/phoenix, /jr, /greenjr, /mvampire, /fvampire) plus a few short or German
// names (player request 2026-11-21); /search <boss> as before. true when handled.
const BOSS_ALIASES = { "phönix": "phoenix", phonix: "phoenix", vampire: "mvampire", vampir: "mvampire", dracul: "mvampire", gjr: "greenjr",
    msdracul: "fvampire", missdracul: "fvampire" }; // Ms. Dracul (2026-11-22)
function bossCommand(c, args) {
    const a = (Array.isArray(args) ? args.join(" ") : String(args || "")).trim().toLowerCase();
    const name = c === "search" ? (BOSS_ALIASES[a] || a || "phoenix") : (BOSS_ALIASES[c] || c);
    if (!G.monsters[name]) return false;
    const ev = BOT_CMD_CTX && BOT_CMD_CTX.events;
    const r = ev && ev.searchNow ? ev.searchNow(name) : "not ready";
    try { parent.add_chat("", "[bot] " + r, "#9be36d"); } catch (e) { /* chat only */ }
    return true;
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

var BOT_DPS_REPORT = null;  // damage meter report (set by bot_fighter)
var BOT_KILLS_REPORT = null; // kills by target at death (set by bot_fighter, 2026-11-22)
var BOT_FOLLOWS_LEADER = null; // party member following its leader (set in startBot)

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
        const followsLeader = function () { return typeof BOT_FOLLOWS_LEADER === "function" && BOT_FOLLOWS_LEADER(); };
        let townWanted = !!mv.useTown;
        try {
            Object.defineProperty(smart, "use_town", {
                configurable: true,
                get: function () {
                    if (!townWanted) return false;
                    // A party moving as a group walks - leader and members (player reports 2026-11-18).
                    if (followsLeader()) return false;
                    // Not while monsters attack us: every hit cancels the channel, and the server
                    // refuses it with more than 5 on us ("can't escape") - a warrior following the
                    // leader home stood in place until the last tortoise let go (2026-11-18).
                    if (BOT_UTIL.attackersOnMe().length) return false;
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
        ctx.scout = require_code("bot_scout")(ctx); // boss search + safe walking (2026-11-23)
        botRunner = require_code("bot_merchant")(ctx);
    } else {
        ctx.party = require_code("bot_party")(ctx);
        // The whole group walks (2026-11-18): members following the leader re-planned on every
        // move and teleported back and forth; a leader alone on Town then waited in the map's
        // center for the walking members. Town stays for the merchant, solo play and members
        // farming on their own.
        BOT_FOLLOWS_LEADER = function () {
            if (!ctx.party.enabled || ctx.party.detached()) return false;
            const fighters = (BOT_CONFIG.team && BOT_CONFIG.team.fighters) || [];
            return ctx.party.memberNames().some(function (n) { return n !== character.name && fighters.includes(n); });
        };
        botParty = ctx.party;
        ctx.hunts = require_code("bot_hunts")(ctx);
        ctx.events = require_code("bot_events")(ctx);
        botEvents = ctx.events;
        installChatCommands(ctx);
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

    // Our server into the storage before the team starts (2026-11-21): the merchant takes the
    // leader's last heartbeat as its home (util.teamServer) - started together with the leader
    // after a move to another server, it would have read the old server and hopped back.
    BOT_UTIL.heartbeat();
    if (character.name === BOT_CONFIG.leader) startTeam();
    // A solo fighter (team.solo) brings the merchant along (2026-11-18: the rogue alone had no merchant
    // after its window was closed); already running is fine.
    else if ((BOT_CONFIG.team.solo || []).includes(character.name) && BOT_CONFIG.merchant) {
        start_character(BOT_CONFIG.merchant, "bot_main")
            .then(function () { BOT_UTIL.log("bot", "started " + BOT_CONFIG.merchant, "green"); })
            .catch(function () { /* already running or not possible */ });
    }
    startHopWatcher();
    startWatchdog();
}

// Server hop for the merchant (player decision 2026-11-20, tested EU III -> EU IV -> EU III):
// the client that hosts the merchant's bot window (start_character puts it into #iframelist)
// does the hop the merchant asks for in the shared storage: stop its runner, then re-create the
// same window with another server in the address (js/functions.js start_character_runner).
// change_server is never used - from a bot window it loaded a full game (extra Steam window).
// Watchdog: a merchant away on a Ponty round that stays silent for 6 min is brought home.
// Stop a bot window this client hosts and open it again on server `to` ("EU III"): the game's own
// start_character_runner markup (js/functions.js) with that server in the address. Used by the
// merchant's server hop and the member watchdog. False when `to` is not "REGION ID".
// One reopen per window at a time (review 2026-11-20): the watchdog and the hop watcher's
// "bring home" could both reopen the merchant within the 6 s gap.
const reopening = {};
async function reopenRunner(name, to) {
    const parts = String(to || "").split(" ");
    if (parts.length !== 2 || reopening[name]) return false;
    reopening[name] = true;
    try { return await reopenRunnerNow(name, parts); } finally { delete reopening[name]; }
}
async function reopenRunnerNow(name, parts) {
    const rid = "ichar" + name.toLowerCase();
    try { parent.stop_character_runner(name); } catch (e) { /* not running */ }
    await sleep(6000); // the old session has to end before the new one logs in
    parent.$("#" + rid).parent(".clickable").remove();
    parent.$("#" + rid).remove();
    const url = "/character/" + name + "/in/" + parts[0] + "/" + parts[1] + "/?no_html=true&is_bot=1&code=bot_main";
    parent.$("#iframelist").append('<div class="clickable" onclick="show_character_snippet(\'' + name + '\')"><iframe src="' + url + '" id="' + rid +
        '" style="border: 5px solid gray; background-color: black; margin-top: -5px; height: 60px; width: 128px; overflow: hidden; pointer-events: none" data-name="' + name + '"></iframe></div>');
    parent.$("#iframelist").css("display", "inline-block");
    return true;
}

// Member watchdog (player decision 2026-11-20, earthiverse idea #8): every bot writes a heartbeat
// (util.heartbeat, "dmpx_beat:<name>") after each loop step. The client that hosts a bot window
// restarts it when the beat is silentMs old or the window is gone: the leader for the fighters it
// starts (startWithLeader), any client for a window it hosts (the merchant). Never a window another
// client hosts - two hosts would both answer the merchant's hop requests. Brakes: gapMs between
// restarts of one character, at most maxPerHour, then it gives up (red log). The leader's own
// window is not covered (the player's game window).
let watchdogOn = false;
function startWatchdog() {
    const wd = BOT_CONFIG.watchdog || {};
    if (watchdogOn || !wd.enabled) return;
    watchdogOn = true;
    const startedAt = Date.now();
    const restarts = {}; // name -> [times]
    const gaveUp = {};   // name -> true once maxPerHour was hit (logged once)
    let busy = false;
    const phase = BOT_CONFIG.phases[BOT_CONFIG.phase] || {};
    const fighters = (BOT_CONFIG.team && BOT_CONFIG.team.fighters) || [];
    const mine = character.name === BOT_CONFIG.leader
        ? (phase.startWithLeader || []).filter(function (n) { return n !== character.name && fighters.includes(n); }) : [];
    const hosted = {}; // windows seen in this client
    setInterval(async function () {
        if (busy) return;
        busy = true;
        try {
            const now = Date.now();
            Object.keys(BOT_CONFIG.characters).forEach(function (n) {
                if (n !== character.name && parent.document.getElementById("ichar" + n.toLowerCase())) hosted[n] = true;
            });
            const watch = mine.concat(Object.keys(hosted).filter(function (n) { return !mine.includes(n); }));
            for (const n of watch) {
                const beat = get("dmpx_beat:" + n) || {};
                if (reopening[n]) continue; // a hop or restart of it is under way
                const hasWindow = !!parent.document.getElementById("ichar" + n.toLowerCase());
                const list = (restarts[n] || []).filter(function (t) { return now - t < 60 * 60 * 1000; });
                restarts[n] = list;
                const last = list.length ? list[list.length - 1] : 0;
                const since = Math.max(beat.at || 0, last, startedAt);
                // A hop of the merchant in progress (request open or done < 2 min ago) is no silence.
                const hop = get("dmpx_hop_request:" + n);
                if (hop && (!hop.done || now - hop.done < 2 * 60 * 1000)) continue;
                const silent = now - since > (wd.silentMs || 120000);
                if (!silent && hasWindow) continue;
                if (!hasWindow && now - startedAt < (wd.silentMs || 120000)) continue; // still starting up
                if (now - last < (wd.gapMs || 600000)) continue;
                if (list.length >= (wd.maxPerHour || 3)) {
                    if (!gaveUp[n]) BOT_UTIL.log("bot", "watchdog: " + n + " restarted " + list.length + " times this hour - giving up, please check it", "red");
                    gaveUp[n] = true;
                    continue;
                }
                // Fighters join this (the leader's) server; the merchant goes back where it was (a hop).
                const here = parent.server_region + " " + parent.server_identifier;
                const to = mine.includes(n) ? here : (beat.server || here);
                BOT_UTIL.log("bot", "watchdog: " + n + (hasWindow ? " silent for " + Math.round((now - since) / 60000) + " min" : " window gone") + " - restarting on " + to, "orange");
                list.push(now);
                gaveUp[n] = false;
                await reopenRunner(n, to);
            }
        } catch (e) {
            BOT_UTIL.log("bot", "watchdog: " + BOT_UTIL.errReason(e), "red");
        } finally {
            busy = false;
        }
    }, wd.checkEveryMs || 15000);
}

let hopWatcherOn = false;
function startHopWatcher() {
    const merch = BOT_CONFIG.merchant;
    if (hopWatcherOn || !merch || character.name === merch) return;
    hopWatcherOn = true;
    const rid = "ichar" + merch.toLowerCase();
    const HOP_KEY = "dmpx_hop_request:" + merch, ROUND_KEY = "dmpx_ponty_round:" + merch, TRIP_KEY = "dmpx_trade_trip:" + merch;
    let home =BOT_UTIL.teamServer(BOT_CONFIG); // where the leader runs, read again each check (2026-11-21)
    let hosting = false, handled = null, hopping = false;
    async function hopTo(to) {
        if (!(await reopenRunner(merch, to))) return false;
        BOT_UTIL.log("bot", merch + " hopped to " + to, "yellow");
        return true;
    }
    setInterval(async function () {
        if (hopping) return;
        try {
            home = BOT_UTIL.teamServer(BOT_CONFIG);
            if (parent.document.getElementById(rid)) hosting = true;
            if (!hosting) return;
            const req = get(HOP_KEY);
            const st = get(ROUND_KEY);
            const trip = get(TRIP_KEY);
            // A sell trip on the home server is no away trip (review 2026-11-20: a long walk there
            // got it restarted and cleared).
            const tripAway = trip && trip.phase !== "fetch" && trip.beat && !(trip.deal && trip.deal.server === home);
            const away = (st && st.phase !== "prep" && st.beat) ? st : (tripAway ? trip : null);
            if (away && Date.now() - away.beat > 6 * 60 * 1000 && !(req && !req.done)) {
                hopping = true;
                BOT_UTIL.log("bot", merch + " silent for 6 min on its " + (away === st ? "Ponty round" : "sell trip") + " - bringing it home", "orange");
                set(ROUND_KEY, null);
                set(TRIP_KEY, null);
                await hopTo(home);
                return;
            }
            if (!req || req.done || req.id === handled) return;
            if (req.retryAt && Date.now() < req.retryAt) return; // a failed hop waits 30 s before the next try
            handled = req.id;
            hopping = true;
            // Not done when no hop happened (2026-11-22 review): the watchdog was reopening the merchant, or the
            // target was malformed - it was marked done anyway and never retried. Up to 5 tries, then given up.
            if (!(await hopTo(req.to))) {
                req.tries = (req.tries || 0) + 1;
                if (req.tries < 5) { handled = null; req.retryAt = Date.now() + 30 * 1000; set(HOP_KEY, req); return; }
                BOT_UTIL.log("bot", "hop of " + merch + " to " + req.to + " failed 5 times - given up", "orange");
                req.failed = true;
            }
            req.done = Date.now();
            set(HOP_KEY, req);
        } catch (e) {
            BOT_UTIL.log("bot", "hop watcher: " + BOT_UTIL.errReason(e), "red");
        } finally {
            hopping = false;
        }
    }, 2000);
}

// Called by the game when a party invite arrives – bot_party only accepts the leader
function on_party_invite(name) {
    if (botParty) botParty.onInvite(name);
}

// Called by the game when a mage wants to magiport us (PvE: consent) - bot_events accepts only our own mage during a
// boss fight (v1.228.1).
function on_magiport(name) {
    if (botEvents && botEvents.acceptMagiport) botEvents.acceptMagiport(name);
}

// Chat commands typed in this character's client, e.g. "/pickup".
// Returning -1 lets the game handle unknown commands as usual.
function handle_command(command, args) {
    command = String(command || "").toLowerCase();
    // /ponty (player request 2026-11-21): the merchant starts a Ponty round on its next check, from
    // any of our windows (shared storage; the merchant's round reads and clears the flag).
    if (command === "ponty" || command === "ponti") {
        try { set("dmpx_ponty_force", Date.now()); } catch (e) { /* storage unavailable */ }
        try { parent.add_chat("", "[bot] Ponty round requested - the merchant starts it on its next check", "#9be36d"); } catch (e) { /* chat only */ }
        return true;
    }
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
    // "/dps": the damage meter now (bot_fighter, the leader counts the whole party).
    if (command === "kills") {
        if (typeof BOT_KILLS_REPORT === "function") BOT_KILLS_REPORT(); else game_log("no kill log here", "orange");
        return true;
    }
    if (command === "dps") {
        if (typeof BOT_DPS_REPORT === "function") BOT_DPS_REPORT(); else game_log("no damage meter here", "orange");
        return true;
    }
    // "/safety [map]": per-member guide verdicts and the team model for every monster there.
    if (command === "safety" && botTargeting) {
        botTargeting.safetyReport(Array.isArray(args) ? args.join(" ") : (args || ""));
        return true;
    }
    if (bossCommand(command, args)) return true;
    return -1;
}

// Called by the game when CODE is stopped
function on_destroy() {
    if (botRunner) botRunner.stop();
    if (botComms) botComms.stop();
    set_message("bot stopped", "gray");
}

startBot();
