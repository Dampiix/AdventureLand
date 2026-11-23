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
            // The guide reads the weapons in hand: during a splash mode (Lolipops) it asked for
            // a Blade +7 and the merchant burned Blades at +3 (2026-11-18). No weapon wishes
            // from the guide while a splash weapon is in hand - our usual weapons are not.
            if (G.items[req.name].type === "weapon" && ["mainhand", "offhand"].some(function (s) {
                return isSplashWeapon(character.slots && character.slots[s]);
            })) return;
            // A two-hander in hand (the mage's Blaster): no wishes for an offhand-only piece (books, shields, quivers) -
            // the guide saw an empty offhand and asked for book after book (2026-11-23).
            if (twoHanded() && (SLOTS_BY_TYPE[G.items[req.name].type] || []).every(function (s) { return s === "offhand"; })) return;
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
        // classWishesEnabled: false pauses them for every class (used 2026-11-16 while the shop gear went to +9; on now).
        if (cfg.classWishesEnabled === false) return [];
        // From the gear plan (config.gearPlan, 2026-11-19); the old per-class table as a fallback.
        const plan = config.gearPlan;
        const table = cfg.classWishes || {};
        const entries = plan && plan.chainsFor
            ? plan.chainsFor(character.ctype, G.classes[character.ctype] && G.classes[character.ctype].main_stat)
            : (table.all || []).concat(table[character.ctype] || []);
        return entries.map(function (e) {
            const steps = (e && e.steps ? e.steps : [e]).filter(function (s) {
                return s && G.items[s.name] && usable(G.items[s.name]);
            });
            steps.replace = !!(e && e.replace);
            steps.anytime = !!(e && e.anytime); // replace right away, not only after the shop gear
            // carry: kept in the bag, never equipped by us (e.g. a Cleave axe next to dual
            // wield); whenWorn: { slot: level } – wished only once those worn slots reach it.
            steps.carry = !!(e && e.carry);
            steps.whenWorn = (e && e.whenWorn) || null;
            steps.count = (e && e.count) || 1; // carried copies wanted (e.g. two maces for dual wield)
            steps.insteadOf = (e && e.insteadOf) || null; // stand-in for this carried item's missing copies
            steps.alts = (e && e.alts) || []; // alternatives: while one is worn, this chain pauses (gear plan)
            steps.slots = (e && e.slots) || null; // slots the chain fills (both hands for the dual-wielding warrior)
            return steps;
        }).filter(function (steps) { return steps.length; });
    }
    // How many steps of the chain this piece covers (0 = none or not part of it).
    // The first step of its name the piece does not reach ends the count: with three steps
    // of one item (belts +2/+3/+4) a +2 counted as "at the +4 step" and the next wish
    // jumped straight to +4 (2026-11-19).
    function chainProgress(steps, item) {
        if (!item) return 0;
        let best = -1;
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            if (s.name !== item.name) continue;
            if ((item.level || 0) >= (s.level || 0)) { best = i + 1; continue; }
            // Reached an earlier step of its name: that is where it stands (2026-11-21: the priest's chain
            // Staff of the Dead +6 -> firestaff +7 -> Staff of the Dead +7 - a +6 counted as far as a firestaff +7).
            return best >= 0 ? best : i;
        }
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
        // Armor counts as done at the last stage (e.g. +8), the mainhand (and a dual-wield offhand) at upTo (8 now).
        const lastStage = goals.stages && goals.stages.length ? Math.max.apply(null, goals.stages) : (goals.upTo || 7);
        return (goals.slots || []).every(function (s) {
            const w = character.slots && character.slots[s];
            // Offhand: only a second shop weapon counts (dual wield); empty, a shield, book
            // or quiver is no gear goal.
            if (s === "offhand" && !(w && G.items[w.name] && G.items[w.name].type === "weapon")) return true;
            const need = s === "mainhand" || s === "offhand" ? (goals.upTo || 7) : lastStage;
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
    // Carried class-wish items (see classChains): never equipped by the equip pass.
    function isCarry(name) {
        const steps = chainOf(name);
        return !!(steps && steps.carry);
    }
    function wornReaches(whenWorn) {
        return Object.keys(whenWorn || {}).every(function (slot) {
            const w = character.slots && character.slots[slot];
            return !!w && (w.level || 0) >= whenWorn[slot];
        });
    }
    // Copies of a carried chain we hold: the bag, and worn copies too: a class mode (warrior Agitate) wears the carried maces for a
    // while, and the wish report sent right after the pull asked the merchant for two more
    // green Lolipops +7 (2026-11-18).
    function carriedItems() {
        const worn = Object.keys(character.slots || {}).map(function (s) { return character.slots[s]; });
        return character.items.concat(worn).filter(Boolean);
    }
    // Finished copies of a carried chain in the bag (or worn).
    function carriedDone(steps) {
        return carriedItems().filter(function (item) { return chainProgress(steps, item) >= steps.length; }).length;
    }
    // How many copies of this carried chain are still needed: a stand-in (insteadOf) only
    // covers what the preferred item does not have finished yet.
    function carryNeed(steps) {
        if (!steps.insteadOf) return steps.count;
        const preferred = chainOf(steps.insteadOf);
        return Math.max(0, steps.count - (preferred && preferred.carry ? carriedDone(preferred) : 0));
    }
    // Wish for a carried chain: the first step no copy in the bag reaches yet.
    function carryWish(steps) {
        if (steps.whenWorn && !wornReaches(steps.whenWorn)) return null;
        // Finished copies in the bag; below the needed count the next copy is wished.
        const progress = carriedItems().map(function (item) { return chainProgress(steps, item); })
            .sort(function (a, b) { return b - a; });
        const done = progress.filter(function (p) { return p >= steps.length; }).length;
        if (done >= carryNeed(steps)) return null;
        const best = Math.max(0, progress[done] || 0); // the furthest copy that is not finished yet
        const w = steps[Math.min(best, steps.length - 1)];
        const wish = { name: w.name, level: w.level || 0, full: true }; // only the finished piece is useful
        if (carryNeed(steps) > 1) wish.count = carryNeed(steps);
        return wish;
    }
    function classWishes(have) {
        const list = [];
        const mainStat = config.workshop && config.workshop.mainStatOnArmor && G.classes[character.ctype]
            ? G.classes[character.ctype].main_stat : null;
        classChains().forEach(function (steps) {
            if (steps.carry) {
                const cw = carryWish(steps);
                if (cw && !have.some(function (x) { return x.name === cw.name; })) list.push(cw);
                return;
            }
            const slots = steps.slots || SLOTS_BY_TYPE[G.items[steps[0].name].type] || [];
            // A worn alternative (e.g. a Loaded Die over the class orb) pauses the chain (gear plan).
            if (steps.alts.length && slots.some(function (s) { const w = character.slots && character.slots[s]; return w && steps.alts.includes(w.name); })) return;
            // The least advanced slot of this type (an empty one first); a slot holding
            // something outside the chain is left alone.
            let progress = null;
            slots.forEach(function (s) {
                const worn = character.slots && character.slots[s];
                let p = worn ? chainProgress(steps, worn) : 0;
                if (p < 0 && !steps.replace) return;
                // Replace chains come after the shop progression (player decision
                // 2026-11-16): only once ALL shop gear is at the gear goals' level.
                // An empty slot too (2026-11-19: the fresh Viz warrior wished Rugged +7 pieces at level 21,
                // and the merchant looked for them at Ponty) - an empty slot gets shop gear first.
                if ((p < 0 || (!worn && steps.replace)) && !steps.anytime && !shopGearDone()) return;
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
    function chainUpgrade(slotOk) {
        for (let num = 0; num < character.items.length; num++) {
            const item = character.items[num];
            const steps = item && chainOf(item.name);
            if (!steps || steps.carry || (steps.replace && !reachedStep(steps, item))) continue;
            const mine = chainProgress(steps, item);
            const slot = (steps.slots || SLOTS_BY_TYPE[G.items[item.name].type] || []).find(function (s) {
                if (slotOk && !slotOk(s)) return false;
                if (equipBlocked(item, s)) return false;
                const worn = character.slots && character.slots[s];
                if (!worn || steps.alts.includes(worn.name)) return false; // a worn alternative stays
                // Never trade a worn stat scroll away (a stat-less Wanderer's Cap over a DEX helmet).
                if (worn.stat_type && G.items[item.name].stat && item.stat_type !== worn.stat_type) return false;
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
        // Value report (stage 1, 2026-11-19): each wish carries its gain (% more power), and our
        // XP rate tells the merchant what an hour of farming is worth in levels.
        const list = wishes.map(function (w) { const g = gainOf(w); return g === null ? w : Object.assign({}, w, { gain: g }); });
        comms.send(merchant, "wishes", { list: list, worn: worn(), ctype: character.ctype, has: has, value: xpValue() });
    }

    // What we wear, for the merchant's gear goals (config.workshop.gearGoals).
    function worn() {
        const out = {};
        Object.keys(character.slots || {}).forEach(function (slot) {
            const item = character.slots[slot];
            if (item && item.name) out[slot] = { name: item.name, level: item.level || 0, stat: item.stat_type || null };
        });
        if (usualWeapons) Object.keys(usualWeapons).forEach(function (s) { out[s] = usualWeapons[s]; });
        // Luck gear on: report what goes back afterwards (the merchant must not see the swap set as our gear).
        if (luck) luck.back.forEach(function (b) { if (b.name) out[b.slot] = { name: b.name, level: b.level, stat: null }; else delete out[b.slot]; });
        // A splash weapon in hand without a remembered set (a restart mid-mode, or half-way
        // through the swap back): report the bag's best normal weapon for that hand - each
        // restart at the bats sent a Lolipop and the merchant crafted Fireblades (2026-11-18).
        const taken = [];
        ["mainhand", "offhand"].forEach(function (s) {
            if (!isSplashWeapon(character.slots && character.slots[s]) || (usualWeapons && usualWeapons[s])) return;
            const u = usualFor(s, taken);
            if (!u || u.num < 0) return;
            taken.push(u.num);
            out[s] = { name: u.item.name, level: u.item.level || 0, stat: u.item.stat_type || null };
        });
        // A carried two-hander still reported for the main hand (the mage's Blaster, no other weapon in the bag): report the
        // single-target loadout instead - the best other one-hander and the best book in the bag, or nothing - so the
        // merchant builds and delivers the staff line (Staff of the Dead) although the Blaster is stronger (v1.226.0,
        // player decision 2026-11-23: staff + book for bosses and whenever the Blaster must not fire).
        const om = out.mainhand;
        if (om && isCarry(om.name) && util.isDoublehand(om.name, character.ctype)) {
            let w = null, wPow = 0, b = null, bVal = -1;
            character.items.forEach(function (it) {
                const d = it && G.items[it.name];
                if (!d || isCarry(it.name)) return;
                if (d.type === "weapon" && !util.isDoublehand(it.name, character.ctype)) {
                    const p = util.weaponPower(it.name, it.level || 0, character.ctype);
                    if (p > wPow) { wPow = p; w = it; }
                } else if (d.type === "source" && bookValue(it) > bVal) { bVal = bookValue(it); b = it; }
            });
            if (w) out.mainhand = { name: w.name, level: w.level || 0, stat: w.stat_type || null }; else delete out.mainhand;
            if (!out.offhand || out.offhand.name === "_twohand") {
                if (b) out.offhand = { name: b.name, level: b.level || 0, stat: null }; else delete out.offhand;
            }
            return out;
        }
        // A two-hander in hand and nothing reported for the offhand (the mage's Blaster): the offhand counts as taken. The
        // merchant saw an empty offhand and brought book after book (2026-11-23). "_twohand" is no item - every check
        // that looks the name up in G.items skips it.
        if (!out.offhand && twoHanded()) out.offhand = { name: "_twohand", level: 0, stat: null };
        return out;
    }

    function bagKey() {
        return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) : "-"; }).join("|");
    }

    // Follow the guide's "equip" rows after the bag changed. The guide only suggests
    // owned items that add attack or 10+ armor, so a +0 piece for an EMPTY slot
    // (gloves, amulet, ...) is never equipped by it – we do that ourselves: anything
    // usable beats an empty slot.
    // A wrong scroll stat (player rule 2026-11-18): a piece with a stat slot (shop armor,
    // Rugged ...) carrying another main stat than ours counts as weaker than the same kind of
    // piece with our stat up to one level lower - helmet +7 DEX beats helmet +8 STR for a rogue.
    // Built-in stats (Dagger of the Dead +20 STR) and pieces without a stat slot are not affected.
    function wrongStat(it) {
        const def = it && G.items[it.name];
        const own = G.classes[character.ctype] && G.classes[character.ctype].main_stat;
        return !!(def && def.stat && it.stat_type && ["str", "int", "dex"].includes(it.stat_type) && it.stat_type !== own);
    }
    function ownStat(it) {
        const own = G.classes[character.ctype] && G.classes[character.ctype].main_stat;
        return !!(it && it.stat_type && it.stat_type === own);
    }
    async function equipPass(weaponsLocked) {
        const slotOk = function (s) { return !(weaponsLocked && (s === "mainhand" || s === "offhand")); };
        equipping = true;
        const wornBefore = JSON.stringify(worn());
        try {
            const rows = (guide().rows || []).filter(function (r) { return r.action && r.action.kind === "equip"; });
            for (const row of rows) {
                const a = row.action;
                const item = character.items[a.num];
                if (!item || item.name !== a.name || (item.level || 0) !== (a.level || 0)) continue; // bag changed meanwhile
                if (!slotOk(a.slot)) continue;
                if (isCarry(item.name)) continue; // carried for a later mode, not worn
                if (NO_EQUIP.has(G.items[item.name])) continue;
                if (equipBlocked(item, a.slot)) continue; // min level, max worn, luck-swap piece (2026-11-22)
                if (chainDowngrade(item, a.slot)) continue;
                const there = character.slots && character.slots[a.slot];
                if (wrongStat(item) && ownStat(there) && (there.level || 0) >= (item.level || 0) - 1) continue; // our stat wins
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
                    if (!slotOk(s)) return false;
                    if (equipBlocked(item, s)) return false;
                    const w = character.slots && character.slots[s];
                    if (w && equivalentOf(item, w)) return true;
                    if (!w || w.name !== item.name) return false;
                    const lvl = item.level || 0, wl = w.level || 0;
                    if (wrongStat(w) && ownStat(item)) return lvl >= wl - 1; // our stat over a wrong one
                    if (wrongStat(item)) return false;
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
            const up = chainUpgrade(slotOk);
            if (up) {
                const item = character.items[up.num];
                await equip(up.num, up.slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + up.slot + " (next class wish step)", "green");
                return;
            }
            // Two one-handers that together beat the worn two-hander: mainhand first (the
            // two-hander goes to the bag), the empty offhand is filled on the next pass.
            const pair = weaponsLocked ? null : pairInBag();
            if (pair) {
                const item = character.items[pair.main];
                await equip(pair.main, "mainhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> mainhand (weapon pair, " + Math.round(pair.power) + " together)", "green");
                return;
            }
            // A stronger weapon (e.g. a Phoenix weapon the merchant upgraded for us): the
            // guide only suggests weapons it planned itself.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (weaponsLocked || !item || !strongerWeapon(item)) continue;
                await equip(num, "mainhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> mainhand (stronger weapon)", "green");
                return;
            }
            // Dual wield (warrior): a bag weapon clearly stronger than the one in the offhand.
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                if (weaponsLocked || !item || !strongerOffhand(item)) continue;
                await equip(num, "offhand");
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> offhand (stronger weapon)", "green");
                return;
            }
            for (let num = 0; num < character.items.length; num++) {
                const item = character.items[num];
                const def = item && G.items[item.name];
                if (!def || !WEARABLE.includes(def.type) || !usable(def)) continue;
                if (isCarry(item.name)) continue;
                const slot = slotsFor(def).find(function (s) { return slotOk(s) && !(character.slots && character.slots[s]) && !equipBlocked(item, s); });
                if (!slot) continue;
                await equip(num, slot);
                util.log("gear", "equipped " + item.name + " +" + (item.level || 0) + " -> " + slot + " (slot was empty)", "green");
                return;
            }
            // Off-stat jewelry we put on earlier, or a piece on the noEquip list: take it off,
            // the merchant passes it on (and fills the slot with something else).
            if (character.esize > 1) {
                const slot = Object.keys(character.slots || {}).find(function (sl) {
                    if (!slotOk(sl)) return false;
                    const w = character.slots[sl];
                    return w && G.items[w.name] && (offStat(G.items[w.name]) || NO_EQUIP.has(G.items[w.name]));
                });
                if (slot) {
                    const w = character.slots[slot];
                    await unequip(slot);
                    util.log("gear", "took off " + w.name + " +" + (w.level || 0) + " (" + slot + ") - " + (NO_EQUIP.has(G.items[w.name]) ? "on the noEquip list" : "not our main stat"), "yellow");
                    return;
                }
            }
        } catch (e) {
            util.log("gear", "equip failed: " + util.errReason(e), "red");
        } finally {
            // Tell the merchant right away what we wear now: with the 5-min report it still
            // saw the old helmet +7 and started another +8 for us (2026-11-17).
            if (JSON.stringify(worn()) !== wornBefore) nextWishAt = 0;
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
    // config.gear.noEquip (player decision 2026-11-18): never put on automatically, and taken off
    // when worn - e.g. Hand of Midas (-20 speed).
    const NO_EQUIP = new Set(((cfg.noEquip) || []).map(function (n) { return G.items[n]; }).filter(Boolean));
    // config.gear.minLevel / maxWorn (2026-11-22, gear plan v2): never put on below that level (Dracul's Attire from +7),
    // and at most that many copies worn at once (one Zapper). slot: where it would go (a copy there is replaced).
    function belowMin(item) {
        const min = (cfg.minLevel || {})[item.name];
        return typeof min === "number" && (item.level || 0) < min;
    }
    function overMax(item, slot) {
        const max = (cfg.maxWorn || {})[item.name];
        if (typeof max !== "number") return false;
        const slots = character.slots || {};
        return Object.keys(slots).filter(function (sl) { return sl !== slot && slots[sl] && slots[sl].name === item.name; }).length >= max;
    }
    function equipBlocked(item, slot) { return belowMin(item) || overMax(item, slot) || isLuckOnly(item.name); }

    // ---- luck swap (classes.<ctype>.luckSwap; priest, 2026-11-22 player decision) --------------------------
    // The INT gear in normal fights; right before Absorb Sins (luck catch, classes/priest.js) the luck pieces go on with
    // ONE equip_batch call (one server round trip), and backMs after the last catch the worn pieces come back. While the
    // luck gear is on, the equip pass and the wish report pause (the merchant keeps seeing the normal gear), and the
    // swapped-out pieces stay in the bag. The best copy of each luck piece is never handed to the merchant.
    const LS = ((config.classes || {})[character.ctype] || {}).luckSwap || null;
    let luck = null;      // { until, back: [{ slot, name, level }] } while the luck gear is on
    let lockedUntil = 0;  // equip pass and wish report pause until then
    function luckNames() { return LS && LS.enabled ? (LS.items || []) : []; }
    // Luck pieces that are only worn by the swap (not the Wanderer's pieces, which are normal gear until replaced).
    function isLuckOnly(name) {
        if (!luckNames().includes(name)) return false;
        const steps = chainOf(name);
        return !!(steps && steps.carry);
    }
    function bestBagIndex(name, skip) {
        let best = -1;
        character.items.forEach(function (it, i) {
            if (!it || it.name !== name || (skip && skip.includes(i))) return;
            if (best === -1 || (it.level || 0) > (character.items[best].level || 0)) best = i;
        });
        return best;
    }
    // How often a luck piece is listed (2026-11-23: two Clover Studs, one for each earring slot).
    function luckCount(name) { return luckNames().filter(function (n) { return n === name; }).length; }
    function luckOn(ms) {
        const names = luckNames();
        if (!names.length) return false;
        const batch = [], back = [];
        names.filter(function (n, i) { return names.indexOf(n) === i; }).forEach(function (name) {
            const def = G.items[name];
            const slots = def && SLOTS_BY_TYPE[def.type];
            if (!slots || !usable(def)) return;
            const wearing = function (sl) { return !!(character.slots && character.slots[sl] && character.slots[sl].name === name); };
            // Listed twice: both paired slots (earring2 first, then earring1); once: the last slot (ring2 / earring2).
            let need = Math.min(luckCount(name), slots.length) - slots.filter(wearing).length;
            const free = slots.slice().reverse().filter(function (sl) { return !wearing(sl); });
            for (const slot of free) {
                if (need <= 0) break;
                if (batch.some(function (b) { return b.slot === slot; })) continue;
                const num = bestBagIndex(name, batch.map(function (b) { return b.num; }));
                if (num === -1) break; // not there yet
                const was = character.slots && character.slots[slot];
                batch.push({ num: num, slot: slot });
                back.push({ slot: slot, name: was ? was.name : null, level: was ? (was.level || 0) : 0 });
                need--;
            }
        });
        if (batch.length) {
            quiet(equip_batch(batch));
            if (!luck) util.log("gear", "luck gear on: " + batch.map(function (b) { return character.items[b.num].name; }).join(", "), "white");
        }
        if (!batch.length && !luck) return false;
        luck = { until: Date.now() + (ms || LS.backMs || 3000), back: (luck ? luck.back : []).concat(back) };
        lockedUntil = luck.until + 2000;
        return true;
    }
    function luckBack() {
        const batch = [], used = [];
        luck.back.forEach(function (b) {
            if (!b.name) return; // the slot was empty: the luck piece stays (nothing to put back)
            let num = -1;
            character.items.forEach(function (it, i) {
                if (num === -1 && it && it.name === b.name && (it.level || 0) === b.level && !used.includes(i)) num = i;
            });
            if (num === -1) return;
            used.push(num);
            batch.push({ num: num, slot: b.slot });
        });
        if (batch.length) quiet(equip_batch(batch));
        luck = null;
        lockedUntil = Date.now() + 1500; // the bag settles before the next equip pass
    }
    function quiet(p) { if (p && typeof p.catch === "function") p.catch(function () {}); return p; }
    function usable(def) {
        if (NO_EQUIP.has(def)) return false;
        const cls = G.classes[character.ctype] || {};
        if (def.class && !def.class.includes(character.ctype)) return false;
        if (offStat(def)) return false;
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
        return !!(def && def.type === "weapon" && usable(def) && !isCarry(item.name) && !util.isDoublehand(item.name, character.ctype) &&
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
        if (!def || def.type !== "weapon" || !usable(def) || isCarry(item.name)) return false;
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
        if (!def || def.type !== "weapon" || isCarry(item.name) || util.isDoublehand(item.name, character.ctype) || !twoHanded()) return false;
        let best = null, bestPow = 0;
        character.items.forEach(function (it) {
            const d = it && G.items[it.name];
            if (!d || d.type !== "weapon" || isCarry(it.name) || util.isDoublehand(it.name, character.ctype)) return;
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
        if (!slotsFor(def).includes("offhand") || isCarry(item.name)) return false;
        const bw = config.workshop && config.workshop.betterWeapons;
        const bar = util.weaponPower(o.name, o.level || 0, character.ctype) * (1 + ((bw && bw.margin) || 0));
        return util.weaponPower(item.name, item.level || 0, character.ctype) > bar;
    }
    function fillsEmptySlot(def) {
        return slotsFor(def).some(function (s) { return !(character.slots && character.slots[s]); });
    }

    // A class mode wears other weapons for a while (warrior Agitate: splash maces): no equip
    // pass would put the usual ones back, and no wish report would tell the merchant we wear
    // the mode's weapons (it would start building our usual ones again from essence).
    // When the hold ends, the next equip pass puts the stronger weapons back on.
    let heldUntil = 0;
    // The weapons we usually wear, while a mode wears others: the wish report shows these
    // (2026-11-18: right after a pull the merchant saw a Lolipop in the offhand and brought
    // a spare Fireblade +7). Dropped once we wear them again.
    let usualWeapons = null;
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
        if (ms && !usualWeapons && !weaponsHeld()) {
            usualWeapons = {};
            const taken = [];
            ["mainhand", "offhand"].forEach(function (s) {
                const u = usualFor(s, taken);
                // Never a mode's weapon as the usual one (v1.226.1): the mage held the Blaster with no staff in the bag, the
                // Blaster became "usual", and after the staff came the gear module kept trying to put the Blaster back
                // ("Unequip your offhand item to use this two-handed weapon" all through the Phoenix fight).
                if (!u || isSplashWeapon(u.item) || isCarry(u.item.name)) return;
                if (u.num >= 0) taken.push(u.num);
                usualWeapons[s] = { name: u.item.name, level: u.item.level || 0, stat: u.item.stat_type || null };
            });
        }
        heldUntil = ms ? Date.now() + ms : 0;
        if (!ms) lastBag = ""; // released: re-check the bag at once
    }
    function weaponsHeld() {
        return Date.now() < heldUntil;
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
            const u = usualWeapons[s];
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
        if (missing) usualWeapons = null;
        if (!batch.length) return false;
        equipBatch(batch).then(function (r) {
            // A piece the game refused (cant_equip): forget the remembered set instead of retrying it every 1.5 s (v1.226.1).
            if (((r && r.slots) || []).some(function (x) { return typeof x === "string"; })) { usualWeapons = null; return; }
            util.log("gear", "usual weapons back: " + batch.map(function (b) {
                const i = character.slots && character.slots[b.slot]; return b.slot + " " + (i ? i.name + " +" + (i.level || 0) : "-");
            }).join(", "), "green");
        }).catch(function (e) { usualWeapons = null; util.log("gear", "usual weapons back: " + util.errReason(e), "orange"); });
        nextEquipAt = Date.now() + 1500; // the bag settles before the next equip pass
        lastBag = "";
        return true;
    }

    // ---- value (stage 1, player request 2026-11-19) ----------------------------------
    // Power = attack x attack speed (priest healing scales with attack as well). Server:
    // attack ~ weapon attack x main stat / 20; frequency += dex / 640 + int / 1575 + level / 164.
    // A wish's gain: the relative power change when it replaces the weakest worn piece of its
    // slot type (first order). XP: levels per hour x what one level adds (class lstats).
    const xpSamples = [];
    function trackXp() {
        const now = Date.now();
        const last = xpSamples[xpSamples.length - 1];
        if (last && now - last.t < 60 * 1000) return;
        xpSamples.push({ t: now, xp: character.xp, level: character.level });
        while (xpSamples.length && now - xpSamples[0].t > 60 * 60 * 1000) xpSamples.shift();
    }
    function xpPerHour() {
        if (xpSamples.length < 10) return null;
        const a = xpSamples[0], b = xpSamples[xpSamples.length - 1];
        let gained = b.xp - a.xp;
        if (b.level > a.level) {
            gained = (G.levels[a.level] || 0) - a.xp + b.xp;
            for (let l = a.level + 1; l < b.level; l++) gained += G.levels[l] || 0;
        }
        const h = (b.t - a.t) / 3600000;
        return h > 0 ? Math.max(0, gained) / h : null;
    }
    function mainStat() { return (G.classes[character.ctype] || {}).main_stat || "str"; }
    function levelPower() {
        const ls = (G.classes[character.ctype] || {}).lstats || {};
        const main = mainStat();
        const freq = (character.level < 80 ? 1 / 164 : 0) + (ls.dex || 0) / 640 + (ls.int || 0) / 1575;
        return (ls[main] || 1) / Math.max(1, character[main] || 1) + freq / Math.max(0.1, character.frequency || 1);
    }
    function xpValue() {
        const xph = xpPerHour();
        const lp = levelPower();
        return { xpPerHour: xph === null ? null : Math.round(xph), levelPower: Math.round(lp * 10000) / 100,
            xpPower: xph === null ? null : Math.round(xph / Math.max(1, character.max_xp) * lp * 10000) / 100,
            // for the merchant's gain estimates of items we don't wish for (Ponty finds)
            base: { stat: mainStat(), mainVal: character[mainStat()] || 1, atk: weaponAttack(), freq: character.frequency || 1 } };
    }
    function propsOf(it) {
        try { return calculate_item_properties(it) || {}; } catch (e) { return {}; }
    }
    function weaponAttack() {
        const m = character.slots && character.slots.mainhand, o = character.slots && character.slots.offhand;
        let a = m ? (propsOf(m).attack || 0) : 0;
        if (o && G.items[o.name] && G.items[o.name].type === "weapon") a += 0.7 * (propsOf(o).attack || 0);
        return Math.max(5, a);
    }
    function powerParts(p, main) {
        return { stat: p[main] || 0, atk: p.attack || 0, freq: (p.frequency || 0) / 100 + (p.dex || 0) / 640 + (p.int || 0) / 1575 };
    }
    // % more power from the wished piece, or null (carried mode weapons, unknown slots).
    function gainOf(w) {
        const def = G.items[w.name];
        if (!def || isCarry(w.name)) return null;
        const slots = SLOTS_BY_TYPE[def.type] || [];
        if (!slots.length) return null;
        const main = mainStat();
        const cand = { name: w.name, level: w.level || 0 };
        if (w.stat) cand.stat_type = w.stat;
        const pn = powerParts(propsOf(cand), main);
        let best = null;
        slots.forEach(function (s) {
            const it = character.slots && character.slots[s];
            const pw = it ? powerParts(propsOf(it), main) : { stat: 0, atk: 0, freq: 0 };
            const g = (pn.stat - pw.stat) / Math.max(1, character[main] || 1) +
                (pn.atk - pw.atk) * (s === "offhand" ? 0.7 : 1) / weaponAttack() +
                (pn.freq - pw.freq) / Math.max(0.1, character.frequency || 1);
            if (best === null || g > best) best = g;
        });
        return best === null ? null : Math.round(best * 10000) / 100;
    }

    function tick() {
        trackXp();
        if (!cfg.enabled) return;
        // A weapon hold (warrior Agitate maces) only locks the weapon slots: it used to stop
        // the whole equip pass, the warrior never put on a STR belt the guide wanted and kept
        // 27 copies in the bag over night (2026-11-19).
        const held = weaponsHeld();
        if (!held) {
            if (heldUntil) { heldUntil = 0; lastBag = ""; } // the hold ran out on its own
            if (usualWeapons && Object.keys(usualWeapons).every(function (s) {
                const i = character.slots && character.slots[s];
                return i && i.name === usualWeapons[s].name && (i.level || 0) >= usualWeapons[s].level;
            })) usualWeapons = null; // back in our usual weapons
        }
        if (luck && Date.now() >= luck.until) luckBack();
        if (Date.now() < lockedUntil) return; // luck swap: no equip pass, no wish report (they would undo or misreport it)
        if (!held && usualWeapons && !equipping && Date.now() >= nextEquipAt && !util.townChannel() && restoreUsual()) return;
        sendWishes(); // reports our usual weapons during a hold
        const key = bagKey();
        if (key !== lastBag) trackBag();
        if (!equipping && key !== lastBag && Date.now() >= nextEquipAt && !util.townChannel()) { // an equip cancels Town
            lastBag = key;
            nextEquipAt = Date.now() + 3000;
            equipPass(held);
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
        const usual = (usualWeapons && usualWeapons.mainhand) || slots.mainhand;
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
        if (luckNames().includes(item.name)) {
            const keep = [];
            const worn = Object.keys(character.slots || {}).filter(function (sl) { return character.slots[sl] && character.slots[sl].name === item.name; }).length;
            for (let k = 0; k < luckCount(item.name) - worn; k++) { const i = bestBagIndex(item.name, keep); if (i === -1) break; keep.push(i); }
            if (keep.some(function (i) { return character.items[i] === item; })) return true;
        }
        if (luck && luck.back.some(function (b) { return b.name === item.name && b.level === (item.level || 0); })) return true;
        if (swapSword(item)) return true;
        if (pairPart(item)) return true; // half of a weapon pair that beats our two-hander
        if (keptBook(item) || keptStaff(item)) return true;
        if (wishes.some(function (w) { return w.name === item.name && (item.level || 0) >= w.level; })) return true;
        const carried = chainOf(item.name);
        // A finished carried piece – a stand-in only while the preferred copies are missing.
        if (carried && carried.carry && reachedStep(carried, item) && carryNeed(carried) > 0) return true;
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
        if (strongerWeapon(item) || strongerOffhand(item)) return true;
        // Further along a class wish chain than what we wear: the equip pass takes it.
        // Only the slots this piece goes into: with every slot, a replace chain counted any
        // other worn item (a helmet ...) as "behind", and the warrior kept a spare STR
        // earring +2 next to his two +3 for good (2026-11-17).
        const steps = chainOf(item.name);
        const ownSlots = SLOTS_BY_TYPE[G.items[item.name].type] || [];
        if (steps && !steps.carry && !(steps.replace && !reachedStep(steps, item)) && ownSlots.some(function (s) {
            const w = slots[s];
            if (!w) return false;
            const p = chainProgress(steps, w);
            return (p >= 0 || steps.replace) && chainProgress(steps, item) > p;
        })) return true;
        // Equipment for a slot we leave empty, or that just arrived (the merchant's
        // delivery may no longer be among our top wishes): give the equip pass a chance.
        const def = G.items[item.name];
        if (!def || !WEARABLE.includes(def.type) || !usable(def)) return false;
        if (fillsEmptySlot(def)) return true;
        // A new piece is held only while the guide would put it on (plus a short moment
        // for the guide to see it). Holding every wearable drop for 3 min – and again after
        // each restart – kept Rings of Joy, HP belts and the old helmet from the merchant.
        const seen = firstSeen[item.name + ":" + (item.level || 0)];
        if (!seen || Date.now() - seen < 20 * 1000) return true;
        // Only one copy: every STR belt the guide wanted on was held, 27 in the bag (2026-11-19).
        if (character.items.find(function (i) { return i && i.name === item.name && (i.level || 0) === (item.level || 0); }) !== item) return false;
        return guideWantsOn(item);
    }
    let equipRows = { at: 0, rows: [] };
    function guideWantsOn(item) {
        if (Date.now() - equipRows.at > 5000) {
            equipRows = { at: Date.now(), rows: (guide().rows || []).filter(function (r) { return r.action && r.action.kind === "equip"; }) };
        }
        return equipRows.rows.some(function (r) { return r.action.name === item.name && (r.action.level || 0) === (item.level || 0); });
    }

    return { tick: tick, isReserved: isReserved, holdWeapons: holdWeapons, weaponsHeld: weaponsHeld, luckOn: luckOn, equipBatch: equipBatch,
        luckActive: function () { return !!luck; } };
};
