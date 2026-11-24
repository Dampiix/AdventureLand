// =====================================================================
// gear/weapons.js - weapons: one- and two-handers, pairs, offhands, splash weapons, holding a weapon set and restoring the usual one.
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, supply, WEARABLE).
// =====================================================================

module.exports = function install(gr, deps) {
    const config = deps.config;
    const util = deps.util;

    function quiet(p) { if (p && typeof p.catch === "function") p.catch(function () {}); return p; }
    function usable(def) {
        if (gr.NO_EQUIP.has(def)) return false;
        const cls = G.classes[character.ctype] || {};
        if (def.class && !def.class.includes(character.ctype)) return false;
        if (gr.offStat(def)) return false;
        if (def.type === "weapon") return !!((cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype]);
        if (["shield", "source", "quiver", "misc_offhand"].includes(def.type)) return !!(cls.offhand || {})[def.type];
        return true;
    }
    // Two one-handed weapons over a two-handed one (2026-11-18, rogue: Stingers +7/+5 vs
    // Fireblade +7). pairInBag: the best main/off pair in the bag when it beats the worn
    // two-hander; pairPart: a one-hander worth keeping for such a pair (two like it would win).
    function wornTwoHanderPower() {
        const m = character.slots && character.slots.mainhand;
        if (!m || !util.isDoublehand(m.name, character.ctype) || (character.slots && character.slots.offhand)) return 0;
        const bw = config.workshop && config.workshop.betterWeapons;
        return util.weaponPower(m.name, m.level || 0, character.ctype) * (1 + ((bw && bw.margin) || 0));
    }
    function oneHander(item, slot) {
        const def = item && G.items[item.name];
        const cls = G.classes[character.ctype] || {};
        return !!(def && def.type === "weapon" && usable(def) && !gr.isCarry(item.name) && !util.isDoublehand(item.name, character.ctype) &&
            (slot === "offhand" ? cls.offhand : cls.mainhand) && (slot === "offhand" ? cls.offhand : cls.mainhand)[def.wtype]);
    }
    function pairInBag() {
        const bar = wornTwoHanderPower();
        if (!bar) return null;
        let a = -1, ap = 0, b = -1, bp = 0;
        character.items.forEach(function (it, n) { if (oneHander(it, "mainhand")) { const p = util.weaponPower(it.name, it.level || 0, character.ctype); if (p > ap) { ap = p; a = n; } } });
        character.items.forEach(function (it, n) { if (n !== a && oneHander(it, "offhand")) { const p = util.weaponPower(it.name, it.level || 0, character.ctype); if (p > bp) { bp = p; b = n; } } });
        // The offhand weapon counts 70 % of its attack (server.js).
        return a !== -1 && b !== -1 && ap + 0.7 * bp > bar ? { main: a, off: b, power: ap + 0.7 * bp } : null;
    }
    function pairPart(item) {
        const bar = wornTwoHanderPower();
        if (!bar || !(oneHander(item, "mainhand") || oneHander(item, "offhand"))) return false;
        return util.weaponPower(item.name, item.level || 0, character.ctype) * 1.7 > bar; // as main + 0.7 as offhand
    }
    // A bag weapon clearly stronger in our hands than the worn one (same rule as the
    // merchant's config.workshop.betterWeapons).
    function strongerWeapon(item) {
        const def = G.items[item.name];
        if (!def || def.type !== "weapon" || !usable(def) || gr.isCarry(item.name)) return false;
        if (util.isDoublehand(item.name, character.ctype) && character.slots && character.slots.offhand) return false;
        const m = character.slots && character.slots.mainhand;
        const bw = config.workshop && config.workshop.betterWeapons;
        const bar = (m ? util.weaponPower(m.name, m.level || 0, character.ctype) : 0) * (1 + ((bw && bw.margin) || 0));
        return util.weaponPower(item.name, item.level || 0, character.ctype) > bar;
    }
    // Slots this item can go into for our class: a warrior also carries a sword, short
    // sword, fist or mace in the offhand (dual wield) – not next to a two-handed weapon.
    function slotsFor(def) {
        const slots = (gr.SLOTS_BY_TYPE[def.type] || []).slice();
        const cls = G.classes[character.ctype] || {};
        if (def.type === "weapon" && (cls.offhand || {})[def.wtype]) {
            const m = character.slots && character.slots.mainhand;
            if (!(m && util.isDoublehand(m.name, character.ctype))) slots.push("offhand");
        }
        // Next to a two-hander nothing goes into the offhand (a book would push the Blaster off, 2026-11-23).
        return twoHanded() ? slots.filter(function (s) { return s !== "offhand"; }) : slots;
    }
    function twoHanded() {
        const m = character.slots && character.slots.mainhand;
        return !!(m && util.isDoublehand(m.name, character.ctype));
    }
    // The best offhand book stays in the bag while a two-hander is in hand (v1.225.5, player decision 2026-11-23): the mage
    // needs it for staff + book when the Blaster comes off. Only that one; spare books go to the merchant.
    function bookValue(it) {
        const d = it && G.items[it.name];
        return d ? (d.int || 0) + ((d.compound || {}).int || 0) * (it.level || 0) : 0;
    }
    // ...and the best other one-handed weapon (v1.226.0): the Staff of the Dead for bosses and blocked Blaster shots.
    function keptStaff(item) {
        const def = item && G.items[item.name];
        if (!def || def.type !== "weapon" || gr.isCarry(item.name) || util.isDoublehand(item.name, character.ctype) || !twoHanded()) return false;
        let best = null, bestPow = 0;
        character.items.forEach(function (it) {
            const d = it && G.items[it.name];
            if (!d || d.type !== "weapon" || gr.isCarry(it.name) || util.isDoublehand(it.name, character.ctype)) return;
            const p = util.weaponPower(it.name, it.level || 0, character.ctype);
            if (p > bestPow) { bestPow = p; best = it; }
        });
        return best === item;
    }
    function keptBook(item) {
        const def = item && G.items[item.name];
        if (!def || def.type !== "source" || !twoHanded() || (character.slots && character.slots.offhand)) return false;
        let best = null;
        character.items.forEach(function (it) {
            if (it && G.items[it.name] && G.items[it.name].type === "source" && (!best || bookValue(it) > bookValue(best))) best = it;
        });
        return best === item;
    }
    // A bag weapon clearly stronger than the weapon in our offhand (dual wield).
    function strongerOffhand(item) {
        const def = G.items[item.name];
        const o = character.slots && character.slots.offhand;
        if (!def || def.type !== "weapon" || !o || !G.items[o.name] || G.items[o.name].type !== "weapon") return false;
        if (!slotsFor(def).includes("offhand") || gr.isCarry(item.name)) return false;
        const bw = config.workshop && config.workshop.betterWeapons;
        const bar = util.weaponPower(o.name, o.level || 0, character.ctype) * (1 + ((bw && bw.margin) || 0));
        return util.weaponPower(item.name, item.level || 0, character.ctype) > bar;
    }
    function fillsEmptySlot(def) {
        return slotsFor(def).some(function (s) { return !(character.slots && character.slots[s]); });
    }
    function isSplashWeapon(i) {
        const def = i && G.items[i.name];
        return !!(def && def.type === "weapon" && (def.explosion > 0 || def.blast > 0)); // blast: the mage's Blaster (2026-11-23)
    }
    // Our usual weapon for a slot: what we wear there, unless that is a splash weapon (a mode's
    // weapon, e.g. after a restart mid-mode) - then the strongest other bag weapon for it.
    function usualFor(slot, taken) {
        const i = character.slots && character.slots[slot];
        if (i && !isSplashWeapon(i)) return { item: i, num: -1 };
        let best = null, bestPower = 0;
        character.items.forEach(function (it, num) {
            if (!it || taken.includes(num) || isSplashWeapon(it) || !G.items[it.name] || G.items[it.name].type !== "weapon") return;
            if (slot === "offhand" && !((G.classes[character.ctype].offhand || {})[G.items[it.name].wtype])) return;
            const p = util.weaponPower(it.name, it.level || 0, character.ctype);
            if (p > bestPower) { best = { item: it, num: num }; bestPower = p; }
        });
        return best || (i ? { item: i, num: -1 } : null);
    }
    function holdWeapons(ms) {
        if (ms && !gr.usualWeapons && !weaponsHeld()) {
            gr.usualWeapons = {};
            const taken = [];
            ["mainhand", "offhand"].forEach(function (s) {
                const u = usualFor(s, taken);
                // Never a mode's weapon as the usual one (v1.226.1): the mage held the Blaster with no staff in the bag, the
                // Blaster became "usual", and after the staff came the gear module kept trying to put the Blaster back
                // ("Unequip your offhand item to use this two-handed weapon" all through the Phoenix fight).
                if (!u || isSplashWeapon(u.item) || gr.isCarry(u.item.name)) return;
                if (u.num >= 0) taken.push(u.num);
                gr.usualWeapons[s] = { name: u.item.name, level: u.item.level || 0, stat: u.item.stat_type || null };
            });
        }
        gr.heldUntil = ms ? Date.now() + ms : 0;
        if (!ms) gr.lastBag = ""; // released: re-check the bag at once
    }
    function weaponsHeld() {
        return Date.now() < gr.heldUntil;
    }
    // Several pieces in ONE server call (v1.223.6, player request): the warrior's weapon swaps change both hands at once.
    // The server answers per entry; a string entry is a piece that did not go on.
    async function equipBatch(batch) {
        const r = await equip_batch(batch);
        const failed = ((r && r.slots) || []).filter(function (s) { return typeof s === "string"; });
        if (failed.length) util.log("gear", "equip_batch: " + failed.join(", "), "orange");
        return r;
    }
    // The usual weapons back in ONE equip_batch call once a weapon hold ends (v1.223.6, player request): the equip pass
    // put them on one per pass, 3 s apart. A copy of the remembered name, at least the remembered level (and stat).
    // A remembered weapon that is gone (sold, upgraded away) drops the memory: the equip pass picks the rest.
    function restoreUsual() {
        const batch = [], used = [];
        let missing = false;
        ["mainhand", "offhand"].forEach(function (s) {
            const u = gr.usualWeapons[s];
            if (!u) return;
            const worn = character.slots && character.slots[s];
            if (worn && worn.name === u.name && (worn.level || 0) >= u.level) return; // on already
            let num = -1;
            character.items.forEach(function (it, k) {
                if (!it || it.name !== u.name || (it.level || 0) < u.level || used.includes(k)) return;
                if (u.stat && it.stat_type !== u.stat) return;
                if (num === -1 || (it.level || 0) > (character.items[num].level || 0)) num = k;
            });
            if (num === -1) { missing = true; return; }
            used.push(num);
            batch.push({ num: num, slot: s });
        });
        if (missing) gr.usualWeapons = null;
        if (!batch.length) return false;
        equipBatch(batch).then(function (r) {
            // A piece the game refused (cant_equip): forget the remembered set instead of retrying it every 1.5 s (v1.226.1).
            if (((r && r.slots) || []).some(function (x) { return typeof x === "string"; })) { gr.usualWeapons = null; return; }
            util.log("gear", "usual weapons back: " + batch.map(function (b) {
                const i = character.slots && character.slots[b.slot]; return b.slot + " " + (i ? i.name + " +" + (i.level || 0) : "-");
            }).join(", "), "green");
        }).catch(function (e) { gr.usualWeapons = null; util.log("gear", "usual weapons back: " + util.errReason(e), "orange"); });
        gr.nextEquipAt = Date.now() + 1500; // the bag settles before the next equip pass
        gr.lastBag = "";
        return true;
    }

    Object.assign(gr, {
        quiet: quiet,
        usable: usable,
        wornTwoHanderPower: wornTwoHanderPower,
        oneHander: oneHander,
        pairInBag: pairInBag,
        pairPart: pairPart,
        strongerWeapon: strongerWeapon,
        slotsFor: slotsFor,
        twoHanded: twoHanded,
        bookValue: bookValue,
        keptStaff: keptStaff,
        keptBook: keptBook,
        strongerOffhand: strongerOffhand,
        fillsEmptySlot: fillsEmptySlot,
        isSplashWeapon: isSplashWeapon,
        usualFor: usualFor,
        holdWeapons: holdWeapons,
        weaponsHeld: weaponsHeld,
        equipBatch: equipBatch,
        restoreUsual: restoreUsual,
    });
};
