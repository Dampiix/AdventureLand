// =====================================================================
// bot_gear – fighter side of equipment progression.
//
// Wishes:  every few minutes the fighter asks its own progression guide
//          which equipment it should get (rows with a `request`, e.g.
//          "mace +4") and sends the top wishes to the merchant.
// Equip:   whenever the bag changes, the guide's "equip" rows say which
//          owned item is an upgrade and where it goes – we follow them.
// Reserve: wished items and items the guide wants equipped are never
//          handed back to the merchant.
// The merchant pings us with "ready" when something waits for us; we then
//          request a pickup right away.
// =====================================================================

const WEARABLE = [
    "weapon", "shield", "source", "quiver", "misc_offhand",
    "helmet", "chest", "pants", "gloves", "shoes", "cape",
    "amulet", "ring", "earring", "belt", "orb",
];

module.exports = function createGear(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.gear;
    const merchant = config.merchant && config.characters[config.merchant] ? config.merchant : null;

    let wishes = [];          // [{ name, level }]
    let lastWishSent = "";
    let nextWishAt = Date.now() + 20 * 1000; // let the guide warm up after login
    let lastBag = "";
    let nextEquipAt = 0;
    let equipping = false;
    let lastReadyPing = 0;

    comms.on("ready", function () {
        if (Date.now() - lastReadyPing < 30 * 1000) return;
        lastReadyPing = Date.now();
        util.log("gear", "merchant has something for us - calling it", "yellow");
        if (ctx.supply) ctx.supply.requestNow();
    });

    function guide() {
        try {
            return get_progression() || {};
        } catch (e) {
            util.log("gear", "get_progression failed: " + util.errReason(e), "red");
            return {};
        }
    }

    // Equipment the guide wants us to obtain, best rows first.
    function readWishes(advice) {
        const seen = {};
        const list = [];
        (advice.rows || []).forEach(function (row) {
            const req = row.request;
            if (!req || !req.name || !G.items[req.name]) return;
            if (!WEARABLE.includes(G.items[req.name].type)) return;
            const level = req.level || 0;
            if (seen[req.name] !== undefined && seen[req.name] >= level) return;
            seen[req.name] = level;
            list.push({ name: req.name, level: level });
        });
        return list.slice(0, cfg.maxWishes);
    }

    function sendWishes() {
        if (!merchant || !cfg.enabled || Date.now() < nextWishAt) return;
        nextWishAt = Date.now() + cfg.wishEveryMs;
        wishes = readWishes(guide());
        const key = JSON.stringify(wishes);
        if (key !== lastWishSent) {
            lastWishSent = key;
            if (wishes.length) {
                util.log("gear", "wishes: " + wishes.map(function (w) { return w.name + " +" + w.level; }).join(", "), "yellow");
            }
        }
        comms.send(merchant, "wishes", { list: wishes });
    }

    function bagKey() {
        return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) : "-"; }).join("|");
    }

    // Follow the guide's "equip" rows after the bag changed.
    async function equipPass() {
        equipping = true;
        try {
            const rows = (guide().rows || []).filter(function (r) { return r.action && r.action.kind === "equip"; });
            for (const row of rows) {
                const a = row.action;
                const item = character.items[a.num];
                if (!item || item.name !== a.name || (item.level || 0) !== (a.level || 0)) continue; // bag changed meanwhile
                await equip(a.num, a.slot);
                util.log("gear", "equipped " + a.name + " +" + (a.level || 0) + " -> " + a.slot, "green");
                break; // the bag changed – re-read the guide next time
            }
        } catch (e) {
            util.log("gear", "equip failed: " + util.errReason(e), "red");
        } finally {
            equipping = false;
        }
    }

    function tick() {
        if (!cfg.enabled) return;
        sendWishes();
        const key = bagKey();
        if (!equipping && key !== lastBag && Date.now() >= nextEquipAt) {
            lastBag = key;
            nextEquipAt = Date.now() + 3000;
            equipPass();
        }
    }

    // Items the supply module must not hand to the merchant.
    function isReserved(item) {
        return wishes.some(function (w) { return w.name === item.name && (item.level || 0) >= w.level; });
    }

    return { tick: tick, isReserved: isReserved };
};
