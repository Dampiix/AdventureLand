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
// Worn:    the wishes message also carries what we wear, so the merchant
//          can work on gear goals (stronger copies of our worn pieces).
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

    // Equipment the guide wants us to obtain, best rows first. A wish carries the
    // stat the guide asks for (str/int/dex scroll on armor). A "stat" row ("Add STR
    // to Helmet") becomes a wish for a copy of that piece with the stat: the merchant
    // builds it, we equip it and hand the old piece back.
    function readWishes(advice) {
        const seen = {};
        const list = [];
        (advice.rows || []).forEach(function (row) {
            let req = row.request;
            const a = row.action;
            if (a && a.kind === "stat" && a.name && G.items[a.scroll] && G.items[a.scroll].stat) {
                const own = (a.slot && character.slots[a.slot]) || character.items[a.num];
                req = { name: a.name, level: own && own.name === a.name ? (own.level || 0) : 0, stat_type: G.items[a.scroll].stat };
            }
            if (!req || !req.name || !G.items[req.name]) return;
            if (!WEARABLE.includes(G.items[req.name].type)) return;
            const level = req.level || 0;
            if (seen[req.name] !== undefined && seen[req.name] >= level) return;
            seen[req.name] = level;
            const stat = req.stat_type && G.items[req.name].stat ? req.stat_type : null;
            list.push(stat ? { name: req.name, level: level, stat: stat } : { name: req.name, level: level });
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
                util.log("gear", "wishes: " + wishes.map(function (w) { return w.name + " +" + w.level + (w.stat ? " " + w.stat : ""); }).join(", "), "yellow");
            }
        }
        comms.send(merchant, "wishes", { list: wishes, worn: worn(), ctype: character.ctype });
    }

    // What we wear, for the merchant's gear goals (config.workshop.gearGoals).
    function worn() {
        const out = {};
        Object.keys(character.slots || {}).forEach(function (slot) {
            const item = character.slots[slot];
            if (item && item.name) out[slot] = { name: item.name, level: item.level || 0, stat: item.stat_type || null };
        });
        return out;
    }

    function bagKey() {
        return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) : "-"; }).join("|");
    }

    // Follow the guide's "equip" rows after the bag changed. The guide only suggests
    // owned items that add attack or 10+ armor, so a +0 piece for an EMPTY slot
    // (gloves, amulet, ...) is never equipped by it – we do that ourselves: anything
    // usable beats an empty slot.
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
                return; // the bag changed – re-read the guide next time
            }
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !usable(def)) continue;
                const slot = (SLOTS_BY_TYPE[def.type] || []).find(function (s) { return !(character.slots && character.slots[s]); });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + slot + " (slot was empty)", "green");
                return;
            }
        } catch (e) {
            util.log("gear", "equip failed: " + util.errReason(e), "red");
        } finally {
            equipping = false;
        }
    }

    // When each bag item ("name:level") first showed up – new equipment gets a few
    // minutes for the equip pass before it could be handed to the merchant.
    const firstSeen = {};
    function trackBag() {
        const now = Date.now();
        const present = {};
        character.items.forEach(function (i) {
            if (!i) return;
            const k = i.name + ":" + (i.level || 0);
            present[k] = true;
            if (!firstSeen[k]) firstSeen[k] = now;
        });
        Object.keys(firstSeen).forEach(function (k) { if (!present[k]) delete firstSeen[k]; });
    }

    // Slots an item of this type can go into.
    const SLOTS_BY_TYPE = {
        weapon: ["mainhand"], shield: ["offhand"], source: ["offhand"], quiver: ["offhand"], misc_offhand: ["offhand"],
        helmet: ["helmet"], chest: ["chest"], pants: ["pants"], gloves: ["gloves"], shoes: ["shoes"], cape: ["cape"],
        amulet: ["amulet"], belt: ["belt"], orb: ["orb"], ring: ["ring1", "ring2"], earring: ["earring1", "earring2"],
    };
    // Can our class wear it at all (class-bound items, weapon and offhand types)?
    function usable(def) {
        const cls = G.classes[character.ctype] || {};
        if (def.class && !def.class.includes(character.ctype)) return false;
        if (def.type === "weapon") return !!((cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype]);
        if (["shield", "source", "quiver", "misc_offhand"].includes(def.type)) return !!(cls.offhand || {})[def.type];
        return true;
    }
    function fillsEmptySlot(def) {
        const slots = SLOTS_BY_TYPE[def.type] || [];
        return slots.some(function (s) { return !(character.slots && character.slots[s]); });
    }

    function tick() {
        if (!cfg.enabled) return;
        sendWishes();
        const key = bagKey();
        if (key !== lastBag) trackBag();
        if (!equipping && key !== lastBag && Date.now() >= nextEquipAt) {
            lastBag = key;
            nextEquipAt = Date.now() + 3000;
            equipPass();
        }
    }

    // Items the supply module must not hand to the merchant.
    function isReserved(item) {
        if (wishes.some(function (w) { return w.name === item.name && (item.level || 0) >= w.level; })) return true;
        // A stronger copy of something we wear (e.g. a finished gear goal) stays
        // with us until the equip pass puts it on.
        const slots = character.slots || {};
        if (Object.keys(slots).some(function (s) {
            return slots[s] && slots[s].name === item.name && (item.level || 0) > (slots[s].level || 0);
        })) return true;
        // Equipment for a slot we leave empty, or that just arrived (the merchant's
        // delivery may no longer be among our top wishes): give the equip pass a chance.
        const def = G.items[item.name];
        if (!def || !WEARABLE.includes(def.type) || !usable(def)) return false;
        if (fillsEmptySlot(def)) return true;
        const seen = firstSeen[item.name + ":" + (item.level || 0)];
        return !seen || Date.now() - seen < 3 * 60 * 1000;
    }

    return { tick: tick, isReserved: isReserved };
};
