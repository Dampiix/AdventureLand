// =====================================================================
// roles/workshop/gear-goals.js - gear-goal stages (team stage, final stage, the shop weapon goal), filling empty slots and
// delivering better copies (the goal work itself: off-plan-armor.js workOnGoals).
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    function goalsOn() {
        return !!(cfg.gearGoals && cfg.gearGoals.enabled);
    }

    // "Weapon done" for the full +7 gate: the worn weapon is at gearGoals.upTo, or at
    // least as strong as the class's shop weapon at upTo (a fire weapon at +5 can be).
    function weaponAtGoal(f) {
        const m = wks.worn[f] && wks.worn[f].mainhand;
        const ctype = wks.classes[f];
        if (!m) return false;
        if ((m.level || 0) >= cfg.gearGoals.upTo) return true;
        const base = ctype && G.classes[ctype] && G.classes[ctype].base_slots && G.classes[ctype].base_slots.mainhand;
        const name = base && base.name;
        if (!name || !G.items[name]) return false;
        return util.weaponPower(m.name, m.level || 0, ctype) >= util.weaponPower(name, cfg.gearGoals.upTo, ctype);
    }

    // The shop weapon to build for a fighter that wears a drop weapon, or null: the
    // class's starting weapon (staff, mace, bow), if at upTo it beats the worn one.
    function shopWeaponGoal(f) {
        const m = wks.worn[f] && wks.worn[f].mainhand;
        const ctype = wks.classes[f];
        if (!m || !ctype || wks.sellerOf(m.name)) return null; // nothing or a shop weapon in hand: normal goals
        const base = G.classes[ctype] && G.classes[ctype].base_slots && G.classes[ctype].base_slots.mainhand;
        const name = base && base.name;
        if (!name || !G.items[name] || !G.items[name].upgrade || !wks.sellerOf(name)) return null;
        const bar = util.weaponPower(m.name, m.level || 0, ctype) * (1 + ((cfg.betterWeapons && cfg.betterWeapons.margin) || 0));
        return util.weaponPower(name, cfg.gearGoals.upTo, ctype) > bar ? name : null;
    }

    // Staged goals (player decisions 2026-11-16/19): ALL of a fighter's shop armor AND shop
    // weapons reach one stage before any piece goes on to the next (gearGoals.stages, e.g.
    // 7 -> 8). Returns the stage this fighter's gear is working on, or null. Weapons were
    // aimed straight at upTo (+8) before 2026-11-19 - a bought staff +7 waited for +8.
    function armorStage(f) {
        const g = cfg.gearGoals;
        const stages = (g.stages && g.stages.length ? g.stages : [g.upTo]).slice().sort(function (a, b) { return a - b; });
        const levels = g.slots.map(function (s) {
            const w = wks.worn[f] && wks.worn[f][s];
            const def = w && G.items[w.name];
            if (!def || !def.upgrade) return null;
            if (s === "mainhand" || s === "offhand") return def.type === "weapon" && wks.sellerOf(w.name) ? (w.level || 0) : null;
            return wks.sellerOf(w.name) || (wks.parallelFor(f) && wks.equivMap()[w.name]) ? (w.level || 0) : null;
        }).filter(function (l) { return l !== null; });
        if (!levels.length) return null;
        const low = Math.min.apply(null, levels);
        return stages.find(function (s) { return low < s; }) || null;
    }
    // The whole team reaches a stage before anyone goes on to the next (player decision
    // 2026-11-20): the priest was nearly all +8 while warrior and ranger still wore +5 pieces,
    // because the fighters are worked on in team order. The lowest stage any fighter is on.
    function teamStage() {
        let low = null;
        wks.activeTeam().forEach(function (f) {
            const s = armorStage(f);
            if (s !== null && (low === null || s < low)) low = s;
        });
        return low;
    }
    function finalStage() {
        const g = cfg.gearGoals;
        return g.stages && g.stages.length ? Math.max.apply(null, g.stages) : g.upTo;
    }

    // A piece some team fighter could put into an EMPTY slot of its own (player decision
    // 2026-11-18): never sold - a new character (the rogue) takes it. Any stat: a stat scroll
    // overwrites the old stat (server.js), so a STR piece can become DEX for 1-10 scrolls.
    // Once the slot is filled the usual selling rules apply again. A fighter we know nothing
    // about yet counts as all empty.
    function fillsEmptySlot(item) {
        const def = item && G.items[item.name];
        const slots = def && wks.SLOTS_BY_TYPE[def.type];
        if (!slots) return false;
        return config.team.fighters.some(function (f) {
            const cls = wks.fighterClass(f);
            if (!cls || !usableBy(def, cls)) return false;
            const eq = wks.worn[f] || {};
            return slots.some(function (s) { return !eq[s]; });
        });
    }
    function usableBy(def, ctype) {
        if (wks.NO_EQUIP.has(def)) return false; // config.gear.noEquip: never handed out to wear
        const cls = G.classes[ctype] || {};
        if (def.class && !def.class.includes(ctype)) return false;
        if (def.type === "weapon") return !!((cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype]);
        if (["shield", "source", "quiver", "misc_offhand"].includes(def.type)) return !!(cls.offhand || {})[def.type];
        // Jewelry for another class's main stat (e.g. an STR amulet for a priest) is no help.
        const own = cls.main_stat;
        if (def[own] > 0) return true; // e.g. Ring of Small Joys: a bit of every stat
        return !wks.MAIN_STATS.some(function (s) { return s !== own && def[s] > 0; });
    }

    function fillEmptySlots() {
        const fightersList = wks.activeTeam().filter(function (f) { return wks.worn[f] && wks.classes[f]; });
        if (!fightersList.length) return;
        // Copies we hold, minus those already earmarked.
        const wished = {};
        wks.allFighters().forEach(function (f) { wks.wishList(f).forEach(function (w) { wished[w.name] = true; }); });
        const pool = [];
        character.items.forEach(function (it) { if (it && !it.l && !it.p && !wished[it.name]) pool.push({ name: it.name, level: it.level || 0, stat: it.stat_type || null }); });
        (wks.bankSnapshot ? wks.bankSnapshot.items : []).forEach(function (b) { if (!wished[b.name]) pool.push({ name: b.name, level: b.level, stat: b.stat || null }); });
        wks.activeEarmarks().forEach(function (e) {
            const i = pool.findIndex(function (p) { return p.name === e.name && p.level >= e.level && (!e.stat || p.stat === e.stat); });
            if (i !== -1) pool.splice(i, 1);
        });
        fightersList.forEach(function (f) {
            const eq = wks.worn[f];
            Object.keys(wks.SLOTS_BY_TYPE).forEach(function (type) {
                // Just delivered something of this type: wait for the fighter's next report.
                if (Date.now() - (wks.filledAt[f + "|" + type] || 0) < 10 * 60 * 1000) return;
                const empty = wks.SLOTS_BY_TYPE[type].filter(function (s) { return !eq[s]; }).length;
                const pending = wks.activeEarmarks().filter(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === type; }).length;
                for (let n = pending; n < empty; n++) {
                    // A piece with a stat scroll only goes to a fighter with that main stat
                    // (three Horse Leather Capes with STR/INT/DEX, 2026-11-17); among the fitting
                    // ones our stat first, then the highest level (2026-11-18: the rogue got Hand
                    // of Midas while gloves +7 DEX lay in the bank).
                    const own = G.classes[wks.classes[f]] && G.classes[wks.classes[f]].main_stat;
                    let i = -1, iScore = -Infinity;
                    pool.forEach(function (p, k) {
                        const def = G.items[p.name];
                        if (!(def && def.type === type && usableBy(def, wks.classes[f]) && !wks.isGoalStock(p) &&
                            (!p.stat || !wks.MAIN_STATS.includes(p.stat) || p.stat === own))) return;
                        const score = (p.stat === own ? 1000 : 0) + (p.level || 0);
                        if (score > iScore) { iScore = score; i = k; }
                    });
                    if (i === -1) return;
                    const p = pool.splice(i, 1)[0];
                    // Key by name: a second copy for the other ring/earring slot waits for the next round.
                    if (wks.earmarks[f + "|" + p.name]) return;
                    wks.earmark(f, p.name, p.level, p.stat);
                    util.log("workshop", p.name + " +" + p.level + (p.stat ? " " + p.stat : "") + " goes to " + f + " (empty " + type + " slot)", "yellow");
                }
            });
            // Two one-handed weapons over a two-handed one (player request 2026-11-18: two Stingers
            // +7/+5 beat the rogue's Fireblade +7). Both are earmarked; the second copy of the same
            // name under its own key, delivered after the first.
            if (eq.mainhand && util.isDoublehand(eq.mainhand.name, wks.classes[f]) && !eq.offhand &&
                Date.now() - (wks.filledAt[f + "|pair"] || 0) >= 10 * 60 * 1000 &&
                !wks.activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) {
                const pc = G.classes[wks.classes[f]] || {};
                const pbw = cfg.betterWeapons || {};
                const pbar = util.weaponPower(eq.mainhand.name, eq.mainhand.level || 0, wks.classes[f]) * (1 + (pbw.margin || 0));
                const one = function (p) { const d = G.items[p.name]; return d && d.type === "weapon" && !wks.NO_EQUIP.has(d) && !util.isDoublehand(p.name, wks.classes[f]); };
                let ai = -1, ap = 0;
                pool.forEach(function (p, i) { if (!one(p) || !(pc.mainhand || {})[G.items[p.name].wtype]) return; const pw = util.weaponPower(p.name, p.level, wks.classes[f]); if (pw > ap) { ap = pw; ai = i; } });
                let bi = -1, bp = 0;
                pool.forEach(function (p, i) { if (i === ai || !one(p) || !(pc.offhand || {})[G.items[p.name].wtype]) return; const pw = util.weaponPower(p.name, p.level, wks.classes[f]); if (pw > bp) { bp = pw; bi = i; } });
                // The offhand weapon counts 70 % of its attack (server.js: item_attack += prop.attack * 0.7).
                if (ai !== -1 && bi !== -1 && ap + 0.7 * bp > pbar) {
                    const a = pool[ai], b = pool[bi];
                    wks.earmark(f, a.name, a.level);
                    if (b.name === a.name) wks.earmarks[f + "|" + b.name + "|2"] = { fighter: f, name: b.name, level: b.level, stat: null, at: Date.now() };
                    else wks.earmark(f, b.name, b.level);
                    wks.saveEarmarks();
                    pool.splice(Math.max(ai, bi), 1); pool.splice(Math.min(ai, bi), 1);
                    wks.filledAt[f + "|pair"] = Date.now();
                    util.log("workshop", a.name + " +" + a.level + " and " + b.name + " +" + b.level + " go to " + f + " (" + Math.round(ap + 0.7 * bp) +
                        " together beat its " + eq.mainhand.name + " +" + (eq.mainhand.level || 0) + ")", "yellow");
                    return;
                }
            }
            // Dual wield (warrior): an empty offhand next to a one-handed weapon – or one
            // holding a clearly weaker weapon (e.g. the guide's blade) – gets the strongest
            // offhand-capable weapon we hold. Waits while a weapon is on its way.
            const cls = G.classes[wks.classes[f]] || {};
            const offTypes = cls.offhand || {};
            if (!eq.mainhand || util.isDoublehand(eq.mainhand.name, wks.classes[f])) return;
            const off = eq.offhand;
            if (off && !(G.items[off.name] && G.items[off.name].type === "weapon")) return; // a shield etc. stays
            const bw = cfg.betterWeapons || {};
            const bar = off ? util.weaponPower(off.name, off.level || 0, wks.classes[f]) * (1 + (bw.margin || 0)) : 0;
            if (Date.now() - (wks.filledAt[f + "|offhand"] || 0) < 10 * 60 * 1000) return;
            if (wks.activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) return;
            let best = -1, bestPower = bar;
            pool.forEach(function (p, i) {
                const def = G.items[p.name];
                if (!def || def.type !== "weapon" || !offTypes[def.wtype] || wks.earmarks[f + "|" + p.name]) return;
                const power = util.weaponPower(p.name, p.level, wks.classes[f]);
                if (power > bestPower) { best = i; bestPower = power; }
            });
            if (best === -1) return;
            const p = pool.splice(best, 1)[0];
            wks.earmark(f, p.name, p.level);
            wks.filledAt[f + "|offhand"] = Date.now();
            util.log("workshop", p.name + " +" + p.level + " goes to " + f + " (" +
                (off ? "stronger than its offhand " + off.name + " +" + (off.level || 0) : "empty offhand") + " - dual wield)", "yellow");
        });
        deliverBetterCopies(fightersList, wished);
    }

    // A copy we hold that beats a worn piece (same item, higher level, the worn stat
    // kept) goes to that fighter – e.g. a coat +4 DEX left over from a gear goal while
    // the ranger still wears +0. Pieces another fighter wishes for are left alone.
    function deliverBetterCopies(fightersList, wished) {
        const pool = [];
        character.items.forEach(function (it) {
            if (it && !it.l && !it.p) pool.push({ name: it.name, level: it.level || 0, stat: it.stat_type || null });
        });
        (wks.bankSnapshot ? wks.bankSnapshot.items : []).forEach(function (b) { pool.push({ name: b.name, level: b.level, stat: b.stat || null }); });
        wks.activeEarmarks().forEach(function (e) {
            const i = pool.findIndex(function (p) { return p.name === e.name && p.level >= e.level && (!e.stat || p.stat === e.stat); });
            if (i !== -1) pool.splice(i, 1);
        });
        fightersList.forEach(function (f) {
            const eq = wks.worn[f];
            Object.keys(eq).forEach(function (slot) {
                const w = eq[slot];
                const def = w && G.items[w.name];
                if (!def || wks.earmarks[f + "|" + w.name]) return;
                if (Date.now() - (wks.filledAt[f + "|" + def.type] || 0) < 10 * 60 * 1000) return;
                const others = wks.allFighters().some(function (o) { return o !== f && wks.wishList(o).some(function (x) { return x.name === w.name; }); });
                if (others) return;
                // Scroll stats (player rule 2026-11-18): never a copy with another main stat than
                // the fighter's; a worn piece with a wrong stat is replaced by one with the right
                // stat up to one level lower (the rogue got helmet +8 STR over helmet +7 DEX).
                const own = G.classes[wks.classes[f]] && G.classes[wks.classes[f]].main_stat;
                const wrong = function (x) { return !!(def.stat && x && x.stat && wks.MAIN_STATS.includes(x.stat) && x.stat !== own); };
                if (wks.NO_EQUIP.has(def)) return;
                let best = -1;
                pool.forEach(function (p, i) {
                    if (p.name !== w.name || wrong(p)) return;
                    if (wrong(w)) { if (p.stat !== own || p.level < (w.level || 0) - 1) return; }
                    else {
                        if (p.level <= (w.level || 0)) return;
                        if (w.stat && p.stat !== w.stat) return;
                    }
                    if (best === -1 || p.level > pool[best].level) best = i;
                });
                if (best === -1) return;
                const p = pool.splice(best, 1)[0];
                wks.earmark(f, p.name, p.level, p.stat);
                util.log("workshop", p.name + " +" + p.level + (p.stat ? " " + p.stat : "") + " goes to " + f + " (better than its +" + (w.level || 0) + ")", "yellow");
            });
        });
    }

    Object.assign(wks, {
        goalsOn: goalsOn,
        weaponAtGoal: weaponAtGoal,
        shopWeaponGoal: shopWeaponGoal,
        armorStage: armorStage,
        teamStage: teamStage,
        finalStage: finalStage,
        fillsEmptySlot: fillsEmptySlot,
        usableBy: usableBy,
        fillEmptySlots: fillEmptySlots,
        deliverBetterCopies: deliverBetterCopies,
    });
};
