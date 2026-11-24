// =====================================================================
// lib/walking.js - Walking: stand-aware walk, the bank, Town channel, waypoints, Daisy's position.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

const { xy } = require("./geometry.js");

// Opening goes through openStand: a stand that was just asked to open does not show in
// character.stand until the server answers - a walk right after it (the fishing trip
// after keepStand) used to leave with the stand opening on the way (2026-11-17).
let standOpenAt = 0;
function openStand(num) {
    standOpenAt = Date.now();
    const p = typeof open_stand === "function" ? open_stand(num) : parent.open_merchant(num);
    if (p && p.catch) p.catch(function () { /* the next round tries again */ });
    return p;
}
// Walk somewhere with smart_move; a merchant stand is closed first and we wait until the
// server confirms it - with the stand open we crawl at speed 10 (the merchant walked to
// the bank with his stand on, 2026-11-17).
async function walk(dest) {
    while (!character.stand && Date.now() - standOpenAt < 3000) await sleep(100);
    for (let attempt = 0; attempt < 3 && character.stand; attempt++) {
        try {
            const p = typeof close_stand === "function" ? close_stand() : parent.close_merchant();
            if (p && p.catch) p.catch(function () { /* checked below */ });
        } catch (e) { /* checked below */ }
        for (let i = 0; i < 40 && character.stand; i++) await sleep(50);
    }
    return smart_move(dest);
}

// The Town teleport is channeling (3 s). The server drops every channel on an equip - and a
// potion is drunk through equip (server.js "equip": player.c = {}) - so a potion or a gear swap
// in that time cancels the teleport (player report 2026-11-18).
function townChannel() {
    return !!(character.c && character.c.town);
}

// Inside a bank map with its packs loaded. Outside, character.bank is {} (not undefined),
// and right after entering the server sends the packs a moment later. A bank read in
// either state saw no packs, took the bank for empty and full and stopped the exchanges
// ("bank full!", 2026-11-18, walks cut short by a pickup call).
function bankLoaded() {
    return /^bank/.test(character.map) &&
        Object.keys(character.bank || {}).some(function (p) { return /^items\d+$/.test(p); });
}
// Walk into the bank and wait up to 5 s for its packs. False when we did not get in
// (smart_move interrupted by another move): the caller tries again later.
async function walkToBank() {
    try { await walk("bank"); } catch (e) { /* checked below */ }
    for (let i = 0; i < 50 && !bankLoaded() && /^bank/.test(character.map); i++) await sleep(100);
    return bankLoaded();
}

function moveToEntity(e) {
    const p = xy(e);
    return xmove(p.x, p.y);
}

// Daisy (the monster hunter NPC on main): her position, or null (v1.235.1, shared by the travel magiport).
function daisyPos() {
    const npc = ((G.maps.main || {}).npcs || []).find(function (n) { return n.id === "monsterhunter"; });
    return npc ? { map: "main", x: npc.position[0], y: npc.position[1] } : null;
}

// Waypoint before a smart_move (config.travel.via, 2026-11-21): { spookytown: "halloween" } - a map
// reached through a dangerous one is walked to via a safe map (the Vampire Rats in level1 killed the
// ranger twice on its way to Spooky Town). Resolves at once when no waypoint applies.
function viaFirst(dest) {
    const cfg = typeof BOT_CONFIG !== "undefined" && BOT_CONFIG ? BOT_CONFIG : {};
    const via = (cfg.travel && cfg.travel.via) || {};
    const map = dest && typeof dest === "object" ? dest.map : null;
    const v = map && via[map];
    if (!v || character.map === map || character.map === v) return Promise.resolve();
    return smart_move({ map: v });
}

module.exports = {
    openStand: openStand,
    walk: walk,
    townChannel: townChannel,
    bankLoaded: bankLoaded,
    walkToBank: walkToBank,
    moveToEntity: moveToEntity,
    daisyPos: daisyPos,
    viaFirst: viaFirst,
};
