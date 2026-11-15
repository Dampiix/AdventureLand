// =====================================================================
// Gear handoff – SENDER side (one-off tool)
// ---------------------------------------------------------------------
// Run this on the character that GIVES its gear away (DampiixWar).
// The receiver must be online on the same server and should run
// handoff-equip.js, which walks to the same meeting point.
//
// Steps:
//   1. Travel to the meeting point in town
//   2. Wait until the receiver is visible, walk next to it
//   3. Unequip every equipment slot
//   4. Send all inventory items (except KEEP) to the receiver
//   5. Optionally send gold
// =====================================================================

const HANDOFF = {
    receiver: "DmpxPalTank",
    meet: { map: "main", x: 0, y: 0 },  // town square spawn
    sendRange: 200,                     // stay well inside the server's send range
    waitForReceiverMs: 5 * 60 * 1000,
    sendPotions: true,                  // hpot1/mpot1 are useful for the receiver too
    sendGold: false,                    // flip to true to also hand over gold
    goldKeep: 0,                        // gold the sender keeps when sendGold is on
    keep: ["tracker"],                  // items that never leave the sender
};

function info(text, color) {
    set_message(text, color || "white");
    game_log("[handoff] " + text, color || "white");
}

function errReason(e) {
    return (e && (e.reason || e.message)) || String(e);
}

async function waitFor(check, timeoutMs, stepMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const value = check();
        if (value) return value;
        await sleep(stepMs || 1000);
    }
    return null;
}

function distanceTo(point) {
    return Math.hypot(character.real_x - point.x, character.real_y - point.y);
}

function isSendable(item) {
    if (!item) return false;
    if (HANDOFF.keep.includes(item.name)) return false;
    const def = G.items[item.name];
    if (!HANDOFF.sendPotions && def && def.type === "pot") return false;
    return true;
}

function equippedSlots() {
    return Object.keys(character.slots).filter(function (slot) {
        return !slot.startsWith("trade") && character.slots[slot];
    });
}

async function goToReceiver() {
    if (character.map !== HANDOFF.meet.map || distanceTo(HANDOFF.meet) > 150) {
        info("travelling to meeting point");
        await smart_move(HANDOFF.meet);
    }

    info("waiting for " + HANDOFF.receiver);
    const receiver = await waitFor(function () { return get_player(HANDOFF.receiver); }, HANDOFF.waitForReceiverMs);
    if (!receiver) throw { reason: HANDOFF.receiver + " not visible after waiting" };

    if (distanceTo({ x: receiver.real_x, y: receiver.real_y }) > HANDOFF.sendRange) {
        info("walking to " + HANDOFF.receiver);
        await smart_move({ map: character.map, x: receiver.real_x, y: receiver.real_y });
    }
}

async function unequipAll() {
    for (const slot of equippedSlots()) {
        if (character.esize < 1) throw { reason: "inventory full while unequipping " + slot };
        await unequip(slot);
        info("unequipped " + slot);
    }
}

async function sendAll() {
    let sent = 0;
    // Re-locate the next item every round: inventory indexes change after each send.
    for (;;) {
        const index = character.items.findIndex(isSendable);
        if (index === -1) break;
        const item = character.items[index];
        await send_item(HANDOFF.receiver, index, item.q || 1);
        sent++;
        info("sent " + item.name + (item.level ? " +" + item.level : "") + (item.q ? " x" + item.q : ""));
    }
    return sent;
}

async function runHandoff() {
    try {
        info("handoff started -> " + HANDOFF.receiver, "orange");
        await goToReceiver();
        await unequipAll();
        const sent = await sendAll();
        if (HANDOFF.sendGold && character.gold > HANDOFF.goldKeep) {
            const amount = character.gold - HANDOFF.goldKeep;
            await send_gold(HANDOFF.receiver, amount);
            info("sent " + amount + " gold");
        }
        info("handoff done - " + sent + " item stacks sent", "green");
    } catch (e) {
        info("handoff failed: " + errReason(e), "red");
    }
}

runHandoff();
