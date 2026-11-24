// =====================================================================
// gear/wishes.js - the fighter's wishes from its progression guide (class chains, carried items) and the worn report to the merchant.
// Part of bot_gear (module plan, stage 7a): moved verbatim from the old single-file core/gear.js. The parts share
// one internal state (gr: wishes, the luck swap, held weapons, timers) and call each other through gr; outside
// dependencies come in deps (config, util, comms, WEARABLE).
// =====================================================================

module.exports = function install(gr, deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const cfg = config.gear;
    const WEARABLE = deps.WEARABLE;
    const merchant = config.merchant && config.characters[config.merchant] ? config.merchant : null;

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
                return gr.isSplashWeapon(character.slots && character.slots[s]);
            })) return;
            // A two-hander in hand (the mage's Blaster): no wishes for an offhand-only piece (books, shields, quivers) -
            // the guide saw an empty offhand and asked for book after book (2026-11-23).
            if (gr.twoHanded() && (gr.SLOTS_BY_TYPE[G.items[req.name].type] || []).every(function (s) { return s === "offhand"; })) return;
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
                return s && G.items[s.name] && gr.usable(G.items[s.name]);
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
            return !!w && (!gr.npcSold.has(w.name) || (w.level || 0) >= need);
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
            const slots = steps.slots || gr.SLOTS_BY_TYPE[G.items[steps[0].name].type] || [];
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
            const slot = (steps.slots || gr.SLOTS_BY_TYPE[G.items[item.name].type] || []).find(function (s) {
                if (slotOk && !slotOk(s)) return false;
                if (gr.equipBlocked(item, s)) return false;
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
        if (!merchant || !cfg.enabled || Date.now() < gr.nextWishAt) return;
        gr.nextWishAt = Date.now() + cfg.wishEveryMs;
        gr.wishes = readWishes(guide());
        gr.wishes = gr.wishes.concat(classWishes(gr.wishes));
        const key = JSON.stringify(gr.wishes);
        if (key !== gr.lastWishSent) {
            gr.lastWishSent = key;
            if (gr.wishes.length) {
                util.log("gear", "wishes: " + gr.wishes.map(function (w) { return w.name + " +" + w.level + (w.stat ? " " + w.stat : ""); }).join(", "), "yellow");
            }
        }
        // Which one-per-character items (e.g. Tracktrix) we already carry.
        const has = {};
        ((config.merchantRole && config.merchantRole.onePerCharacter) || []).forEach(function (n) { has[n] = util.countItem(n) > 0; });
        // Value report (stage 1, 2026-11-19): each wish carries its gain (% more power), and our
        // XP rate tells the merchant what an hour of farming is worth in levels.
        const list = gr.wishes.map(function (w) { const g = gr.gainOf(w); return g === null ? w : Object.assign({}, w, { gain: g }); });
        comms.send(merchant, "wishes", { list: list, worn: worn(), ctype: character.ctype, has: has, value: gr.xpValue() });
    }

    // What we wear, for the merchant's gear goals (config.workshop.gearGoals).
    function worn() {
        const out = {};
        Object.keys(character.slots || {}).forEach(function (slot) {
            const item = character.slots[slot];
            if (item && item.name) out[slot] = { name: item.name, level: item.level || 0, stat: item.stat_type || null };
        });
        if (gr.usualWeapons) Object.keys(gr.usualWeapons).forEach(function (s) { out[s] = gr.usualWeapons[s]; });
        // Luck gear on: report what goes back afterwards (the merchant must not see the swap set as our gear).
        if (gr.luck) gr.luck.back.forEach(function (b) { if (b.name) out[b.slot] = { name: b.name, level: b.level, stat: null }; else delete out[b.slot]; });
        // A splash weapon in hand without a remembered set (a restart mid-mode, or half-way
        // through the swap back): report the bag's best normal weapon for that hand - each
        // restart at the bats sent a Lolipop and the merchant crafted Fireblades (2026-11-18).
        const taken = [];
        ["mainhand", "offhand"].forEach(function (s) {
            if (!gr.isSplashWeapon(character.slots && character.slots[s]) || (gr.usualWeapons && gr.usualWeapons[s])) return;
            const u = gr.usualFor(s, taken);
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
                } else if (d.type === "source" && gr.bookValue(it) > bVal) { bVal = gr.bookValue(it); b = it; }
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
        if (!out.offhand && gr.twoHanded()) out.offhand = { name: "_twohand", level: 0, stat: null };
        return out;
    }

    Object.assign(gr, {
        guide: guide,
        readWishes: readWishes,
        classChains: classChains,
        chainProgress: chainProgress,
        shopGearDone: shopGearDone,
        reachedStep: reachedStep,
        chainOf: chainOf,
        isCarry: isCarry,
        wornReaches: wornReaches,
        carriedItems: carriedItems,
        carriedDone: carriedDone,
        carryNeed: carryNeed,
        carryWish: carryWish,
        classWishes: classWishes,
        chainUpgrade: chainUpgrade,
        chainDowngrade: chainDowngrade,
        sendWishes: sendWishes,
        worn: worn,
    });
};
