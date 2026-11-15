// =====================================================================
// Gear handoff – RECEIVER side (one-off tool)
// ---------------------------------------------------------------------
// Run this on the character that RECEIVES gear (DmpxPalTank) while the
// sender runs handoff-send.js.
//
// Steps:
//   1. Travel to the meeting point in town and wait there
//   2. Whenever new items arrive, equip everything that is an upgrade
//   3. Stop once nothing new arrived for a while
//
// "Upgrade" is a simple heuristic:
//   - weapons: estimated attack (base + per-level gain), only weapon types
//     this class can wield, including the class speed/output penalty
//   - everything else: item level, +10 if the stat roll matches the class
//     main stat, plus the item's own main-stat bonus
// Nothing is sold, dropped or destroyed – replaced gear stays in the bag.
// =====================================================================

const EQUIP = {
    sender: "DampiixWar",
    meet: { map: "main", x: 0, y: 0 },
    idleStopMs: 30 * 1000,       // stop after this long without new items (once something arrived)
    maxRuntimeMs: 10 * 60 * 1000,
};

// Equipment slot -> item types that fit there
const SLOT_TYPES = {
    mainhand: ["weapon"],
    helmet: ["helmet"],
    chest: ["chest"],
    pants: ["pants"],
    shoes: ["shoes"],
    gloves: ["gloves"],
    amulet: ["amulet"],
    belt: ["belt"],
    orb: ["orb"],
    cape: ["cape"],
    earring1: ["earring"],
    earring2: ["earring"],
    ring1: ["ring"],
    ring2: ["ring"],
};

function info(text, color) {
    set_message(text, color || "white");
    game_log("[equip] " + text, color || "white");
}

function errReason(e) {
    return (e && (e.reason || e.message)) || String(e);
}

function mainStat() {
    return G.classes[character.ctype].main_stat;
}

function itemScore(item, slot) {
    if (!item) return -1;
    const def = G.items[item.name];
    if (!def) return -1;
    const level = item.level || 0;

    if (slot === "mainhand") {
        const allowed = G.classes[character.ctype].mainhand || {};
        if (!def.wtype || !allowed[def.wtype]) return -1;
        const perLevel = (def.upgrade && def.upgrade.attack) || 0;
        const output = 1 + ((allowed[def.wtype].output || 0) / 100);
        return ((def.attack || 0) + perLevel * level) * output;
    }

    let score = level + (def[mainStat()] || 0);
    if (item.stat_type && item.stat_type === mainStat()) score += 10;
    return score;
}

function bestCandidate(slot) {
    const types = SLOT_TYPES[slot];
    let best = null;
    character.items.forEach(function (item, index) {
        if (!item) return;
        const def = G.items[item.name];
        if (!def || !types.includes(def.type)) return;
        const score = itemScore(item, slot);
        if (score < 0) return;
        if (!best || score > best.score) best = { index: index, item: item, score: score };
    });
    return best;
}

// One pass over all slots; returns how many items were equipped.
async function equipPass() {
    let equipped = 0;
    for (const slot of Object.keys(SLOT_TYPES)) {
        if (!(slot in character.slots)) continue;
        const current = character.slots[slot];
        const candidate = bestCandidate(slot);
        if (!candidate || candidate.score <= itemScore(current, slot)) continue;
        try {
            await equip(candidate.index, slot);
            equipped++;
            info("equipped " + candidate.item.name + " +" + (candidate.item.level || 0) + " -> " + slot, "green");
        } catch (e) {
            info("could not equip " + candidate.item.name + " in " + slot + ": " + errReason(e), "red");
        }
    }
    return equipped;
}

function inventoryFingerprint() {
    return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) + ":" + (i.q || 1) : "-"; }).join("|");
}

async function runEquip() {
    try {
        info("receiver ready, waiting for " + EQUIP.sender, "orange");
        if (character.map !== EQUIP.meet.map || Math.hypot(character.real_x - EQUIP.meet.x, character.real_y - EQUIP.meet.y) > 150) {
            await smart_move(EQUIP.meet);
        }

        const start = Date.now();
        let lastPrint = inventoryFingerprint();
        let lastChange = 0; // 0 = nothing received yet
        let total = 0;

        while (Date.now() - start < EQUIP.maxRuntimeMs) {
            const print = inventoryFingerprint();
            if (print !== lastPrint) {
                lastPrint = print;
                lastChange = Date.now();
                total += await equipPass();
                lastPrint = inventoryFingerprint(); // equipping changes the bag too
            } else if (lastChange && Date.now() - lastChange > EQUIP.idleStopMs) {
                break;
            }
            await sleep(2000);
        }

        total += await equipPass(); // final sweep
        info("equip done - " + total + " items equipped", "green");
    } catch (e) {
        info("equip failed: " + errReason(e), "red");
    }
}

runEquip();
