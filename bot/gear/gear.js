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

const PARTS = [
    require("./wishes.js"),
    require("./equip.js"),
    require("./luck-swap.js"),
    require("./weapons.js"),
    require("./value.js"),
];

module.exports = function createGear(ctx) {
    // Outside dependencies of the parts (module plan, stage 7a). Supply is created after gear; only this facade uses it (ctx.supply).
    const deps = { config: ctx.config, util: ctx.util, comms: ctx.comms, WEARABLE: WEARABLE };
    // The internal state shared by the parts; they put their functions here too (the facade's as well).
    const gr = { tick: tick, equivalentOf: equivalentOf, swapSword: swapSword, isReserved: isReserved, guideWantsOn: guideWantsOn };
    PARTS.forEach(function (install) { install(gr, deps); });

    // ---- state, start-up and the facade's own functions, in the old order (the parts' functions are all there
    // already, as the hoisted functions were) ----
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.gear;

    gr.wishes = [];          // [{ name, level }]
    gr.lastWishSent = "";
    gr.nextWishAt = Date.now() + 20 * 1000; // let the guide warm up after login
    gr.lastBag = "";
    gr.nextEquipAt = 0;
    gr.equipping = false;
    let lastReadyPing = 0;

    comms.on("ready", function () {
        if (Date.now() - lastReadyPing < 30 * 1000) return;
        lastReadyPing = Date.now();
        util.log("gear", "merchant has something for us - calling it", "yellow");
        if (ctx.supply) ctx.supply.requestNow();
    });
    // Items any NPC sells (shop gear).
    gr.npcSold = new Set();
    Object.keys(G.npcs || {}).forEach(function (id) {
        (Array.isArray(G.npcs[id].items) ? G.npcs[id].items : []).forEach(function (n) { if (n) gr.npcSold.add(n); });
    });

    // When each bag item ("name:level") first showed up – new equipment gets a few
    // minutes for the equip pass before it could be handed to the merchant.
    gr.firstSeen = {};

    // Slots an item of this type can go into.
    gr.SLOTS_BY_TYPE = {
        weapon: ["mainhand"], shield: ["offhand"], source: ["offhand"], quiver: ["offhand"], misc_offhand: ["offhand"],
        helmet: ["helmet"], chest: ["chest"], pants: ["pants"], gloves: ["gloves"], shoes: ["shoes"], cape: ["cape"],
        amulet: ["amulet"], belt: ["belt"], orb: ["orb"], ring: ["ring1", "ring2"], earring: ["earring1", "earring2"],
    };
    gr.JEWELRY = ["ring", "earring", "amulet", "belt", "orb"];
    gr.MAIN_STATS = ["str", "int", "dex"];
    // config.gear.noEquip (player decision 2026-11-18): never put on automatically, and taken off
    // when worn - e.g. Hand of Midas (-20 speed).
    gr.NO_EQUIP = new Set(((cfg.noEquip) || []).map(function (n) { return G.items[n]; }).filter(Boolean));

    // ---- luck swap (classes.<ctype>.luckSwap; priest, 2026-11-22 player decision) --------------------------
    // The INT gear in normal fights; right before Absorb Sins (luck catch, classes/priest/) the luck pieces go on with
    // ONE equip_batch call (one server round trip), and backMs after the last catch the worn pieces come back. While the
    // luck gear is on, the equip pass and the wish report pause (the merchant keeps seeing the normal gear), and the
    // swapped-out pieces stay in the bag. The best copy of each luck piece is never handed to the merchant.
    gr.luck = null;      // { until, back: [{ slot, name, level }] } while the luck gear is on
    gr.lockedUntil = 0;  // equip pass and wish report pause until then

    // A class mode wears other weapons for a while (warrior Agitate: splash maces): no equip
    // pass would put the usual ones back, and no wish report would tell the merchant we wear
    // the mode's weapons (it would start building our usual ones again from essence).
    // When the hold ends, the next equip pass puts the stronger weapons back on.
    gr.heldUntil = 0;
    // The weapons we usually wear, while a mode wears others: the wish report shows these
    // (2026-11-18: right after a pull the merchant saw a Lolipop in the offhand and brought
    // a spare Fireblade +7). Dropped once we wear them again.
    gr.usualWeapons = null;

    // ---- value (stage 1, player request 2026-11-19) ----------------------------------
    // Power = attack x attack speed (priest healing scales with attack as well). Server:
    // attack ~ weapon attack x main stat / 20; frequency += dex / 640 + int / 1575 + level / 164.
    // A wish's gain: the relative power change when it replaces the weakest worn piece of its
    // slot type (first order). XP: levels per hour x what one level adds (class lstats).
    gr.xpSamples = [];

    function tick() {
        gr.trackXp();
        if (!cfg.enabled) return;
        // A weapon hold (warrior Agitate maces) only locks the weapon slots: it used to stop
        // the whole equip pass, the warrior never put on a STR belt the guide wanted and kept
        // 27 copies in the bag over night (2026-11-19).
        const held = gr.weaponsHeld();
        if (!held) {
            if (gr.heldUntil) { gr.heldUntil = 0; gr.lastBag = ""; } // the hold ran out on its own
            if (gr.usualWeapons && Object.keys(gr.usualWeapons).every(function (s) {
                const i = character.slots && character.slots[s];
                return i && i.name === gr.usualWeapons[s].name && (i.level || 0) >= gr.usualWeapons[s].level;
            })) gr.usualWeapons = null; // back in our usual weapons
        }
        if (gr.luck && Date.now() >= gr.luck.until) gr.luckBack();
        if (Date.now() < gr.lockedUntil) return; // luck swap: no equip pass, no wish report (they would undo or misreport it)
        if (!held && gr.usualWeapons && !gr.equipping && Date.now() >= gr.nextEquipAt && !util.townChannel() && gr.restoreUsual()) return;
        gr.sendWishes(); // reports our usual weapons during a hold
        const key = gr.bagKey();
        if (key !== gr.lastBag) gr.trackBag();
        if (!gr.equipping && key !== gr.lastBag && Date.now() >= gr.nextEquipAt && !util.townChannel()) { // an equip cancels Town
            gr.lastBag = key;
            gr.nextEquipAt = Date.now() + 3000;
            gr.equipPass(held);
        }
    }

    // An equivalent piece (gearPlan.equivalent, e.g. Wanderer's Cap for the Helmet) that replaces
    // the worn one: at least its level, and the worn stat scroll is not lost.
    function equivalentOf(item, worn) {
        const map = (config.gearPlan && config.gearPlan.equivalent) || cfg.equivalent || {};
        if (!worn) return false;
        if (!worn.stat_type || item.stat_type === worn.stat_type) {
            if (map[item.name] && worn.name === map[item.name] && (item.level || 0) >= (worn.level || 0)) return true;
            // ...and back: the shop piece built higher than the worn equivalent (no spare copy).
            if (map[worn.name] === item.name && (item.level || 0) > (worn.level || 0)) return true;
        }
        return false;
    }
    // Swords carried for the warrior's sword swap (classes.warrior.swordSwap, 2026-11-21): while fire blades
    // are our usual weapons, the best two copies of swordSwap.names (worn or in the bag) stay with us.
    function swapSword(item) {
        const sw = ((config.classes || {})[character.ctype] || {}).swordSwap;
        if (!sw || !sw.enabled || !(sw.names || ["swordofthedead"]).includes(item.name)) return false;
        const slots = character.slots || {};
        const usual = (gr.usualWeapons && gr.usualWeapons.mainhand) || slots.mainhand;
        if (!usual || !G.items[usual.name] || G.items[usual.name].ability !== "burn") return false;
        const names = sw.names || ["swordofthedead"];
        const all = character.items.concat([slots.mainhand, slots.offhand]).filter(function (i) { return i && names.includes(i.name); });
        const better = all.filter(function (i) { return i !== item && (i.level || 0) > (item.level || 0); }).length;
        return better < (sw.count || 2);
    }
    // Items the supply module must not hand to the merchant.
    function isReserved(item) {
        // Luck swap: the best copies of each luck piece (as many as listed), and what was taken off for them, stay in the bag.
        // Copies we wear already count (v1.223.5): the priest wears the Wanderer's cap and shoes +8 - the +0 copies it
        // found stayed in its bag for nothing and never went to the merchant.
        if (gr.luckNames().includes(item.name)) {
            const keep = [];
            const worn = Object.keys(character.slots || {}).filter(function (sl) { return character.slots[sl] && character.slots[sl].name === item.name; }).length;
            for (let k = 0; k < gr.luckCount(item.name) - worn; k++) { const i = gr.bestBagIndex(item.name, keep); if (i === -1) break; keep.push(i); }
            if (keep.some(function (i) { return character.items[i] === item; })) return true;
        }
        if (gr.luck && gr.luck.back.some(function (b) { return b.name === item.name && b.level === (item.level || 0); })) return true;
        if (swapSword(item)) return true;
        if (gr.pairPart(item)) return true; // half of a weapon pair that beats our two-hander
        if (gr.keptBook(item) || gr.keptStaff(item)) return true;
        if (gr.wishes.some(function (w) { return w.name === item.name && (item.level || 0) >= w.level; })) return true;
        const carried = gr.chainOf(item.name);
        // A finished carried piece – a stand-in only while the preferred copies are missing.
        if (carried && carried.carry && gr.reachedStep(carried, item) && gr.carryNeed(carried) > 0) return true;
        // A stronger copy of something we wear (e.g. a finished gear goal) stays
        // with us until the equip pass puts it on.
        const slots = character.slots || {};
        if (Object.keys(slots).some(function (s) { return slots[s] && equivalentOf(item, slots[s]); })) return true;
        if (Object.keys(slots).some(function (s) {
            const w = slots[s];
            if (!w || w.name !== item.name) return false;
            if (w.stat_type && item.stat_type !== w.stat_type) return false; // would lose the stat
            return (item.level || 0) > (w.level || 0) || ((item.level || 0) === (w.level || 0) && !!item.stat_type && !w.stat_type);
        })) return true;
        if (gr.strongerWeapon(item) || gr.strongerOffhand(item)) return true;
        // Further along a class wish chain than what we wear: the equip pass takes it.
        // Only the slots this piece goes into: with every slot, a replace chain counted any
        // other worn item (a helmet ...) as "behind", and the warrior kept a spare STR
        // earring +2 next to his two +3 for good (2026-11-17).
        const steps = gr.chainOf(item.name);
        const ownSlots = gr.SLOTS_BY_TYPE[G.items[item.name].type] || [];
        if (steps && !steps.carry && !(steps.replace && !gr.reachedStep(steps, item)) && ownSlots.some(function (s) {
            const w = slots[s];
            if (!w) return false;
            const p = gr.chainProgress(steps, w);
            return (p >= 0 || steps.replace) && gr.chainProgress(steps, item) > p;
        })) return true;
        // Equipment for a slot we leave empty, or that just arrived (the merchant's
        // delivery may no longer be among our top wishes): give the equip pass a chance.
        const def = G.items[item.name];
        if (!def || !WEARABLE.includes(def.type) || !gr.usable(def)) return false;
        if (gr.fillsEmptySlot(def)) return true;
        // A new piece is held only while the guide would put it on (plus a short moment
        // for the guide to see it). Holding every wearable drop for 3 min – and again after
        // each restart – kept Rings of Joy, HP belts and the old helmet from the merchant.
        const seen = gr.firstSeen[item.name + ":" + (item.level || 0)];
        if (!seen || Date.now() - seen < 20 * 1000) return true;
        // Only one copy: every STR belt the guide wanted on was held, 27 in the bag (2026-11-19).
        if (character.items.find(function (i) { return i && i.name === item.name && (i.level || 0) === (item.level || 0); }) !== item) return false;
        return guideWantsOn(item);
    }
    let equipRows = { at: 0, rows: [] };
    function guideWantsOn(item) {
        if (Date.now() - equipRows.at > 5000) {
            equipRows = { at: Date.now(), rows: (gr.guide().rows || []).filter(function (r) { return r.action && r.action.kind === "equip"; }) };
        }
        return equipRows.rows.some(function (r) { return r.action.name === item.name && (r.action.level || 0) === (item.level || 0); });
    }

    return { tick: tick, isReserved: isReserved, holdWeapons: gr.holdWeapons, weaponsHeld: gr.weaponsHeld, luckOn: gr.luckOn, equipBatch: gr.equipBatch,
        luckActive: function () { return !!gr.luck; } };

};
