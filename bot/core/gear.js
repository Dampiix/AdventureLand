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
            // Armor that can carry a stat is wished with our main stat (the merchant adds it anyway).
            const mainStat = config.workshop && config.workshop.mainStatOnArmor && G.classes[character.ctype]
                ? G.classes[character.ctype].main_stat : null;
            const stat = G.items[req.name].stat ? (req.stat_type || mainStat || null) : null;
            // Already worn (same item, at least that level, the wished stat): nothing to wish for.
            // The guide lists such steps on its way to a better piece.
            if (Object.keys(character.slots || {}).some(function (s) {
                const w = character.slots[s];
                return w && w.name === req.name && (w.level || 0) >= level && (!stat || w.stat_type === stat);
            })) return;
            list.push(stat ? { name: req.name, level: level, stat: stat } : { name: req.name, level: level });
        });
        return list.slice(0, cfg.maxWishes);
    }

    // Fixed wishes for our class (config.gear.classWishes, "all" for every class) that
    // the guide does not ask for. An entry is one item ({ name, level }) or a chain of
    // steps ({ steps: [...] }, e.g. Orb of Beginnings +0 -> +2 -> Orb of Strength +1):
    // only the first step the worn piece doesn't reach yet is wished. A piece of a later
    // step counts for all earlier ones, so a lucky drop skips ahead. Anything worn there
    // that is not part of the chain stays our choice (no wish) – unless the entry has
    // replace: true (e.g. Monster Hunter armor over shop armor): then a piece of the
    // chain that reached its step level (e.g. +7) is equipped over what is worn, and the
    // merchant delivers such a wish only complete (full), never at a lower level.
    function classChains() {
        // Paused for every class while the shop gear goes to +9 (player decision 2026-11-16).
        if (cfg.classWishesEnabled === false) return [];
        const table = cfg.classWishes || {};
        return (table.all || []).concat(table[character.ctype] || []).map(function (e) {
            const steps = (e && e.steps ? e.steps : [e]).filter(function (s) {
                return s && G.items[s.name] && usable(G.items[s.name]);
            });
            steps.replace = !!(e && e.replace);
            return steps;
        }).filter(function (steps) { return steps.length; });
    }
    // How many steps of the chain this piece covers (0 = none or not part of it).
    function chainProgress(steps, item) {
        if (!item) return 0;
        let best = -1;
        steps.forEach(function (s, i) {
            if (s.name !== item.name) return;
            best = Math.max(best, (item.level || 0) >= (s.level || 0) ? i + 1 : i);
        });
        return best;
    }
    // Items any NPC sells (shop gear).
    const npcSold = new Set();
    Object.keys(G.npcs || {}).forEach(function (id) {
        (Array.isArray(G.npcs[id].items) ? G.npcs[id].items : []).forEach(function (n) { if (n) npcSold.add(n); });
    });
    // Is the whole shop progression done? Every gear-goal slot (helmet, chest, pants,
    // shoes, gloves, mainhand) holds something, and every shop piece in them is at
    // gearGoals.upTo. Pieces that aren't shop gear (e.g. a fireblade) count as done.
    function shopGearDone() {
        const goals = config.workshop && config.workshop.gearGoals;
        if (!goals || !goals.enabled) return true;
        // Armor counts as done at the last stage (e.g. +8), the mainhand at upTo (+7).
        const lastStage = goals.stages && goals.stages.length ? Math.max.apply(null, goals.stages) : (goals.upTo || 7);
        return (goals.slots || []).every(function (s) {
            const w = character.slots && character.slots[s];
            const need = s === "mainhand" ? (goals.upTo || 7) : lastStage;
            return !!w && (!npcSold.has(w.name) || (w.level || 0) >= need);
        });
    }
    // Does this piece reach one of the chain's steps (name and level)?
    function reachedStep(steps, item) {
        return steps.some(function (s) { return s.name === item.name && (item.level || 0) >= (s.level || 0); });
    }
    function chainOf(name) {
        return classChains().find(function (steps) { return steps.some(function (s) { return s.name === name; }); }) || null;
    }
    function classWishes(have) {
        const list = [];
        const mainStat = config.workshop && config.workshop.mainStatOnArmor && G.classes[character.ctype]
            ? G.classes[character.ctype].main_stat : null;
        classChains().forEach(function (steps) {
            const slots = SLOTS_BY_TYPE[G.items[steps[0].name].type] || [];
            // The least advanced slot of this type (an empty one first); a slot holding
            // something outside the chain is left alone.
            let progress = null;
            slots.forEach(function (s) {
                const worn = character.slots && character.slots[s];
                let p = worn ? chainProgress(steps, worn) : 0;
                if (p < 0 && !steps.replace) return;
                // Replace chains come after the shop progression (player decision
                // 2026-11-16): only once ALL shop gear is at the gear goals' level.
                if (p < 0 && !shopGearDone()) return;
                if (progress === null || p < progress) progress = p;
            });
            if (progress === null || progress >= steps.length) return;
            const w = steps[Math.max(0, progress)];
            if (have.some(function (x) { return x.name === w.name; })) return;
            const stat = G.items[w.name].stat ? mainStat : null;
            const wish = { name: w.name, level: w.level || 0 };
            if (stat) wish.stat = stat;
            if (steps.replace) wish.full = true;
            list.push(wish);
        });
        return list;
    }
    // A bag piece that is further along a class chain than the worn one: { num, slot }.
    function chainUpgrade() {
        for (let num = 0; num < character.items.length; num++) {
            const item = character.items[num];
            const steps = item && chainOf(item.name);
            if (!steps || (steps.replace && !reachedStep(steps, item))) continue;
            const mine = chainProgress(steps, item);
            const slot = (SLOTS_BY_TYPE[G.items[item.name].type] || []).find(function (s) {
                const worn = character.slots && character.slots[s];
                if (!worn) return false;
                const p = chainProgress(steps, worn);
                return (p >= 0 || steps.replace) && worn.name !== item.name && mine > p;
            });
            if (slot) return { num: num, slot: slot };
        }
        return null;
    }
    // Would equipping this piece step back on a class chain (guide rows don't know them)?
    function chainDowngrade(item, slot) {
        const worn = character.slots && character.slots[slot];
        const steps = worn && chainOf(worn.name);
        if (!steps) return false;
        const p = chainProgress(steps, item);
        return (p >= 0 || steps.replace) && p < chainProgress(steps, worn);
    }

    function sendWishes() {
        if (!merchant || !cfg.enabled || Date.now() < nextWishAt) return;
        nextWishAt = Date.now() + cfg.wishEveryMs;
        wishes = readWishes(guide());
        wishes = wishes.concat(classWishes(wishes));
        const key = JSON.stringify(wishes);
        if (key !== lastWishSent) {
            lastWishSent = key;
            if (wishes.length) {
                util.log("gear", "wishes: " + wishes.map(function (w) { return w.name + " +" + w.level + (w.stat ? " " + w.stat : ""); }).join(", "), "yellow");
            }
        }
        // Which one-per-character items (e.g. Tracktrix) we already carry.
        const has = {};
        ((config.merchantRole && config.merchantRole.onePerCharacter) || []).forEach(function (n) { has[n] = util.countItem(n) > 0; });
        comms.send(merchant, "wishes", { list: wishes, worn: worn(), ctype: character.ctype, has: has });
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
                if (chainDowngrade(item, a.slot)) continue;
                await equip(a.num, a.slot);
                util.log("gear", "equipped " + a.name + " +" + (a.level || 0) + " -> " + a.slot, "green");
                return; // the bag changed – re-read the guide next time
            }
            // A better copy of a piece we wear (higher level without losing the stat, or
            // the same level with a stat the worn one lacks): the guide skips small gains.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !usable(def)) continue;
                const slot = slotsFor(def).find(function (s) {
                    const w = character.slots && character.slots[s];
                    if (!w || w.name !== item.name) return false;
                    const lvl = item.level || 0, wl = w.level || 0;
                    if (w.stat_type && item.stat_type !== w.stat_type) return false;
                    return lvl > wl || (lvl === wl && !!item.stat_type && !w.stat_type);
                });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + (item.stat_type ? " " + item.stat_type : "") + " -> " + slot + " (better copy)", "green");
                return;
            }
            // A piece further along a class wish chain (e.g. Orb of Strength +1 over
            // Orb of Beginnings +2): the guide doesn't know our chains.
            const up = chainUpgrade();
            if (up) {
                const item = character.items[up.num];
                await equip(up.num, up.slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + up.slot + " (next class wish step)", "green");
                return;
            }
            // A stronger weapon (e.g. a Phoenix weapon the merchant upgraded for us): the
            // guide only suggests weapons it planned itself.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (!item || !strongerWeapon(item)) continue;
                await equip(num, "mainhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> mainhand (stronger weapon)", "green");
                return;
            }
            // Dual wield (warrior): a bag weapon clearly stronger than the one in the offhand.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (!item || !strongerOffhand(item)) continue;
                await equip(num, "offhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> offhand (stronger weapon)", "green");
                return;
            }
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !usable(def)) continue;
                const slot = slotsFor(def).find(function (s) { return !(character.slots && character.slots[s]); });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + slot + " (slot was empty)", "green");
                return;
            }
            // Off-stat jewelry we put on earlier: take it off, the merchant passes it on.
            if (character.esize > 1) {
                const slot = Object.keys(character.slots || {}).find(function (sl) {
                    const w = character.slots[sl];
                    return w && G.items[w.name] && offStat(G.items[w.name]);
                });
                if (slot) {
                    const w = character.slots[slot];
                    await unequip(slot);
                    util.log("gear", "took off " + w.name + " +" + (w.level || 0) + " (" + slot + ") - not our main stat", "yellow");
                    return;
                }
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
    // Jewelry that only raises another class's main stat (e.g. a DEX earring on a
    // paladin) is no help, and its copy is worth more to that class (compounds).
    const JEWELRY = ["ring", "earring", "amulet", "belt", "orb"];
    const MAIN_STATS = ["str", "int", "dex"];
    function offStat(def) {
        if (!JEWELRY.includes(def.type)) return false;
        const own = (G.classes[character.ctype] || {}).main_stat;
        if (def[own] > 0) return false;
        return MAIN_STATS.some(function (s) { return s !== own && def[s] > 0; });
    }
    function usable(def) {
        const cls = G.classes[character.ctype] || {};
        if (def.class && !def.class.includes(character.ctype)) return false;
        if (offStat(def)) return false;
        if (def.type === "weapon") return !!((cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype]);
        if (["shield", "source", "quiver", "misc_offhand"].includes(def.type)) return !!(cls.offhand || {})[def.type];
        return true;
    }
    // A bag weapon clearly stronger in our hands than the worn one (same rule as the
    // merchant's config.workshop.betterWeapons).
    function strongerWeapon(item) {
        const def = G.items[item.name];
        if (!def || def.type !== "weapon" || !usable(def)) return false;
        if (util.isDoublehand(item.name, character.ctype) && character.slots && character.slots.offhand) return false;
        const m = character.slots && character.slots.mainhand;
        const bw = config.workshop && config.workshop.betterWeapons;
        const bar = (m ? util.weaponPower(m.name, m.level || 0, character.ctype) : 0) * (1 + ((bw && bw.margin) || 0));
        return util.weaponPower(item.name, item.level || 0, character.ctype) > bar;
    }
    // Slots this item can go into for our class: a warrior also carries a sword, short
    // sword, fist or mace in the offhand (dual wield) – not next to a two-handed weapon.
    function slotsFor(def) {
        const slots = (SLOTS_BY_TYPE[def.type] || []).slice();
        const cls = G.classes[character.ctype] || {};
        if (def.type === "weapon" && (cls.offhand || {})[def.wtype]) {
            const m = character.slots && character.slots.mainhand;
            if (!(m && util.isDoublehand(m.name, character.ctype))) slots.push("offhand");
        }
        return slots;
    }
    // A bag weapon clearly stronger than the weapon in our offhand (dual wield).
    function strongerOffhand(item) {
        const def = G.items[item.name];
        const o = character.slots && character.slots.offhand;
        if (!def || def.type !== "weapon" || !o || !G.items[o.name] || G.items[o.name].type !== "weapon") return false;
        if (!slotsFor(def).includes("offhand")) return false;
        const bw = config.workshop && config.workshop.betterWeapons;
        const bar = util.weaponPower(o.name, o.level || 0, character.ctype) * (1 + ((bw && bw.margin) || 0));
        return util.weaponPower(item.name, item.level || 0, character.ctype) > bar;
    }
    function fillsEmptySlot(def) {
        return slotsFor(def).some(function (s) { return !(character.slots && character.slots[s]); });
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
            const w = slots[s];
            if (!w || w.name !== item.name) return false;
            if (w.stat_type && item.stat_type !== w.stat_type) return false; // would lose the stat
            return (item.level || 0) > (w.level || 0) || ((item.level || 0) === (w.level || 0) && !!item.stat_type && !w.stat_type);
        })) return true;
        if (strongerWeapon(item) || strongerOffhand(item)) return true;
        // Further along a class wish chain than what we wear: the equip pass takes it.
        const steps = chainOf(item.name);
        if (steps && !(steps.replace && !reachedStep(steps, item)) && Object.keys(slots).some(function (s) {
            const w = slots[s];
            if (!w || w.name === item.name) return false;
            const p = chainProgress(steps, w);
            return (p >= 0 || steps.replace) && chainProgress(steps, item) > p;
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
