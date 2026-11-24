// =====================================================================
// lib/status.js - The status box (short forms, ~13 characters) and the log with its journal tags.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

const names = require("./names.js");
const { JOURNAL_TAGS, journal } = require("./storage.js");

// The game's status box shows only ~13 characters (player request 2026-11-17): every status is shortened here, the
// details stay in the log. v1.236.2 (player decision 2026-11-24): the important word first; ">" walks to, "@" is there
// and waits, "?" searches. The long texts stay in the code as explanations. Applied in order, each rule once; specific
// rules before the general ones.
const SHORT = [
    [/ \([^)]*\)/g, ""],                     // details in brackets
    // character names without their team prefix: see shortStatus (v1.233.0, no account names in the code any more)
    [/^dead - a priest is reviving me$/, "dead: revive"],
    [/^dead - waiting to respawn$/, "dead: respawn"],
    [/^dead in the cave - your call$/, "dead: Nera?"],
    [/^leader on another cave map - waiting$/, "cave: wait"],
    // team goal and routes (party.js)
    [/^to goal: the (\S+) spot$/, "> $1"],
    [/^to goal: (?:the )?(.+)$/, "> $1"],
    [/^at goal, waiting: the (\S+) spot$/, "@$1"],
    [/^at goal, waiting: (?:the )?(.+)$/, "@$1"],
    [/^going ahead to /, "> "],
    [/^to (\S+) for heals$/, "> $1 heal"],
    [/^passing /, "pass "],
    // bosses and searches
    [/^searching (\S+) - waiting for .*$/, "?$1 wait"],
    [/^searching /, "? "],                // "? booboo" (player request 2026-11-18)
    [/^scouting: (\S+) found.*$/, "found $1"],
    [/^scouting ([^/\s]+)\S*$/, "scout $1"],    // the first boss of the round only
    [/^closing in on /, "> "],
    [/^holding at /, "hold "],
    [/^waiting at the (\S+) zone for the Cavalry$/, "cav $1"],
    [/^waiting at /, "@"],
    // farm spot
    [/^waiting for monsters$/, "wait mobs"],
    [/^waiting for a lone /, "lone? "],
    [/^too strong: /, "strong "],
    [/^checking the (\S+) spot$/, "check $1"],
    [/^spot too strong$/, "spot strong"],
    [/^waiting outside the (\S+) spawn$/, "out $1"],
    [/^leaving the (\S+) rage zone$/, "leave $1"],
    [/^away from the (\S+) zone$/, "leave $1"],
    // combat
    [/^kiting (\S+).*$/, "kite $1"],
    [/^keeping distance from /, "dist "],
    [/^escaped, healing /, "heal "],
    [/^smoke: hiding /, "hide "],
    [/^heal up (\d+%).*$/, "heal $1"],
    [/^to taunt /, "taunt "],
    [/^fear: waiting with /, "fear "],
    [/^mobbing: no new pull$/, "mobbed"],
    [/^mobbed x([\d.]+): no Agitate$/, "mob x$1"],
    [/^fleeing crabxx$/, "flee crab"],
    [/^fleeing /, "flee "],
    [/^agitate stream: to (?:the nearest|a clump of) /, "agi > "],
    [/^agitate stream: /, "agi "],
    [/^agitate: backing off$/, "agi back"],
    [/^agitate: gathering the pack$/, "agi gather"],
    [/^agitate: waiting for the pack$/, "agi wait"],
    [/^agitate: waiting - \d+x \S+ in reach$/, "agi wait"],
    [/^agitate: to the next one$/, "agi > next"],
    [/^agitate: to the pull point$/, "agi > pull"],
    [/^agitate: stepping .*$/, "agi step"],
    [/^agitate: Giga Crab in reach$/, "agi crab"],
    [/^agitate: \d+x ([^,\s]+).* in reach$/, "agi no $1"],  // other kinds in reach, no clear point
    [/^agitate: (\d+) on us, splash .*$/, "agi $1 on us"],
    [/^agitate: (\d+\/\d+) here$/, "agi $1"],
    [/^agitate: /, "agi "],
    [/^gap step: (\d+) on us.*$/, "gap $1 on us"],
    [/^(warrior|priest|ranger|paladin|rogue|mage): /, "hit "],
    [/^moving to /, "> "],
    // party
    [/^visiting Daisy$/, "Daisy"],
    [/^at Daisy, waiting for .*/, "Daisy: wait"],
    [/^walking to Daisy$/, "> Daisy"],
    [/^following /, "follow "],
    [/^waiting near /, "near "],
    [/^waiting for (\S+) (?:ahead|at the spot)$/, "wait $1"],
    [/^waiting for /, "wait "],
    [/^wait (\w+), /, "wait $1,"],           // the leader's team wait: "wait War,Mage"
    // "... for Pri" - after the waiting rules: first, it cut "waiting for VizWar" down to
    // "waiting" and the leader's team wait showed no name (2026-11-20).
    [/ for [A-Z]\w*$/, ""],
    // merchant
    [/^checking Ponty$/, "Ponty?"],
    [/^Ponty on .*$/, "Ponty"],
    [/^buying from /, "buy "],
    [/^selling to /, "sell "],
    [/^dismantling /, "dism "],
    [/^not configured$/, "no config"],
    [/^buying potions$/, "buy pots"],
    [/^going to town$/, "> town"],
    [/^delivering to /, "give "],
    [/^collecting from /, "collect "],
    [/^ready in town$/, "ready"],
    [/^compounding /, "cmp "],
    [/^bank full - not exchanging$/, "bank full!"],
    [/^exchanging /, "exch "],
    [/^upgrading (a )?spare /, "up "],
    [/^upgrading /, "up "],
    [/ towards \+/, ">+"],
    [/ to \+/, " +"],
    [/^(\w+) scroll for /, "$1 "],            // "str scroll for coat1"
    [/^trying /, "try "],
    [/^gear goal: /, ""],                    // just the item (player request 2026-11-17)
    [/^crafting /, "craft "],
    [/^buying /, "buy "],
    [/^checking the bank$/, "check bank"],
    [/^working on /, ""],
    [/^up (\S+) \+(\d+)>\+(\d+)$/, "$1 $2>$3"], // "helmet1 3>7"
    [/ \+(\d)/g, "+$1"],                // "intring+3"
];
// Still longer than the box: monster names of 8+ letters down to 6 ("gscorpion" -> "gscorp", v1.236.2).
const STATUS_MAX = 13;

function shortStatus(text) {
    let t = String(text);
    names.prefixes().forEach(function (p) { t = t.replace(new RegExp("\\b" + p + "(\\w+)", "g"), "$1"); });
    t = SHORT.reduce(function (s, r) { return s.replace(r[0], r[1]); }, t);
    if (t.length > STATUS_MAX && typeof G !== "undefined" && G.monsters) {
        t = t.replace(/[a-z]{8,}/g, function (w) { return G.monsters[w] ? w.slice(0, 6) : w; });
    }
    return t;
}

let lastStatus = "";
function status(text, color) {
    const short = shortStatus(text);
    if (short === lastStatus) return;
    lastStatus = short;
    set_message(short, color || "white");
}

function log(tag, text, color) {
    game_log("[" + tag + "] " + text, color || "white");
    if (JOURNAL_TAGS.includes(tag)) journal("[" + tag + "] " + text);
}

module.exports = {
    shortStatus: shortStatus,
    status: status,
    log: log,
};
