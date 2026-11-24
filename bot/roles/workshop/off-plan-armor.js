// =====================================================================
// roles/workshop/off-plan-armor.js - off-plan armor: armor outside the gear plan.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    function inPlanGroup(spec, cls) {
        if (!spec) return true;
        const groups = (config.gearPlan || {}).groups || {};
        return (Array.isArray(spec) ? spec : [spec]).some(function (x) { return x === cls || (groups[x] || []).includes(cls); });
    }
    function planItems(f, slot) {
        const plan = config.gearPlan || {};
        const cls = wks.fighterClass(f);
        const main = cls && G.classes[cls] ? G.classes[cls].main_stat : "";
        const set = new Set();
        const shop = (plan.shop || {})[slot];
        if (shop) set.add(shop);
        if (wks.parallelFor(f)) Object.keys(plan.equivalent || {}).forEach(function (n) { if (plan.equivalent[n] === shop) set.add(n); });
        (plan.wishes || []).forEach(function (w) {
            if (w.slot !== slot || !inPlanGroup(w.for, cls)) return;
            if (w.item) set.add(String(w.item).replace("{stat}", main));
            (w.steps || []).forEach(function (s) { set.add(String(s[0]).replace("{stat}", main)); });
            (w.alts || []).forEach(function (a) { if (inPlanGroup(a.for, cls)) set.add(a.item); });
        });
        ((plan.found || {})[slot] || []).forEach(function (x) { if (inPlanGroup(x.for, cls)) set.add(x.item); });
        return set;
    }
    function chainReplaces(f, slot) {
        const cls = wks.fighterClass(f);
        return ((config.gearPlan || {}).wishes || []).some(function (w) { return w.slot === slot && w.replace && inPlanGroup(w.for, cls); });
    }
    function itemProps(it) {
        try { return parent.calculate_item_properties(it) || {}; } catch (e) { return G.items[it.name] || {}; }
    }
    function atLeastAsGood(a, b, main) {
        const pa = itemProps(a), pb = itemProps(b);
        const m = function (p) { return (main && p[main]) || 0; };
        const d = function (p) { return (p.armor || 0) + (p.resistance || 0); };
        return m(pa) >= m(pb) && d(pa) >= d(pb) && (m(pa) > m(pb) || d(pa) > d(pb));
    }
    // The shop piece an off-plan slot gets (name, without the comparison), or null.
    function offPlanShop(f, slot) {
        if (!wks.ARMOR_SLOTS.includes(slot) || !wks.worn[f]) return null; // unknown gear (offline since the restart): no guess
        const w = wks.worn[f][slot];
        if (w && planItems(f, slot).has(w.name)) return null;
        if (chainReplaces(f, slot)) return null;
        const shop = ((config.gearPlan || {}).shop || {})[slot];
        return shop && G.items[shop] ? shop : null;
    }
    function offPlanNeed(f, slot, target) {
        const shop = target ? offPlanShop(f, slot) : null;
        if (!shop) return null;
        const w = wks.worn[f] && wks.worn[f][slot];
        const cls = wks.fighterClass(f);
        const main = cls && G.classes[cls] ? G.classes[cls].main_stat : null;
        const stat = G.items[shop].stat ? main : null;
        if (w && !atLeastAsGood({ name: shop, level: target, stat_type: stat || undefined }, { name: w.name, level: w.level || 0, stat_type: w.stat || undefined }, main)) return null;
        const k = f + ":" + slot + ":" + (w ? w.name + (w.level || 0) : "-") + ":" + target;
        if (!wks.offPlanLogged[k]) {
            wks.offPlanLogged[k] = true;
            util.log("workshop", f + " " + slot + ": " + (w ? w.name + " +" + (w.level || 0) + " is outside the gear plan" : "empty") + " - building " + shop + " +" + target + (stat ? " " + stat : ""), "white");
        }
        return { fighter: f, slot: slot, name: shop, stat: stat, weapon: null, level: target, offPlan: true };
    }

    function goalNeeds() {
        return goalNeedsAll().filter(function (n) { return Date.now() - (wks.goalSentAt[n.fighter + ":" + n.slot] || 0) > 15 * 60 * 1000; });
    }
    // What each fighter should get, in team order (leader first).
    function goalNeedsAll() {
        const g = cfg.gearGoals;
        const list = [];
        const team = wks.teamStage();
        wks.activeTeam().forEach(function (f) {
            const eq = wks.worn[f];
            if (!eq) return;
            const own = wks.armorStage(f);
            const stage = own === null ? null : Math.min(own, team); // team-wide stages (2026-11-20)
            // A drop weapon in hand (e.g. a Phoenix weapon): the class's shop weapon at
            // upTo may beat it – build that, the fighter switches, and the drop weapon is
            // then upgraded until it wins again (weapon lists / material goals). Player idea 2026-11-15.
            const shopWeapon = wks.shopWeaponGoal(f);
            if (shopWeapon) list.push({ fighter: f, slot: "mainhand", name: shopWeapon, stat: null, weapon: null, level: g.upTo });
            g.slots.forEach(function (slot) {
                const w = eq[slot];
                const def = w && G.items[w.name];
                // Offhand: only a second shop weapon (dual wield) – shields, books and
                // quivers stay out (player decision 2026-11-17); it goes to the weapon level.
                if (slot === "offhand" && (!def || def.type !== "weapon")) return;
                // Weapons follow the stages too, never above upTo (the shop weapon cap).
                const target = slot === "mainhand" || slot === "offhand" ? (stage === null ? null : Math.min(stage, g.upTo)) : stage;
                const cls0 = wks.classes[f] && G.classes[wks.classes[f]];
                const statOf = function (d) { return d && d.stat ? (w.stat || (cfg.mainStatOnArmor && cls0 ? cls0.main_stat : null)) : null; };
                // Empty, or a piece outside the class's gear plan: the plan's next step (2026-11-22).
                // A fighter whose shop armor is done (all +8) has no stage of its own any more - the off-plan slot still
                // gets the team stage, or the last one (2026-11-22: the ranger kept the T-Shirt +3, no Coat +8 was built).
                const off = offPlanNeed(f, slot, target !== null ? target : (team !== null ? team : wks.finalStage()));
                if (off) { list.push(off); return; }
                if (w && def && def.upgrade && wks.parallelFor(f) && slot !== "mainhand" && slot !== "offhand") {
                    const map = wks.equivMap();
                    const equiv = Object.keys(map).find(function (n) { return map[n] === w.name; });
                    // Worn shop piece + a copy of its equivalent in hand: build that to the same
                    // level (or the stage being worked on) - it takes the slot.
                    if (equiv && wks.sellerOf(w.name) && (wks.unlockedCopies(equiv).length || wks.craftableFromStock(equiv))) {
                        const lvl = target && target > (w.level || 0) ? target : (w.level || 0);
                        list.push({ fighter: f, slot: slot, name: equiv, stat: statOf(G.items[equiv]), weapon: null, level: lvl, noCraft: !wks.craftableFromStock(equiv) });
                        return;
                    }
                    // Worn equivalent: upgraded like shop armor from a spare copy; without one the
                    // shop piece is built to the stage and takes the slot back.
                    if (map[w.name]) {
                        if (!target || (w.level || 0) >= target) return;
                        const spare = wks.unlockedCopies(w.name).some(function (l) { return l < target; });
                        const craft = !spare && wks.craftableFromStock(w.name);
                        list.push({ fighter: f, slot: slot, name: spare || craft ? w.name : map[w.name], stat: statOf(def), weapon: null, level: target, noCraft: !craft });
                        return;
                    }
                }
                // Per-piece caps (gearGoals.capBy, 2026-11-22): once the whole team is through the stages, this worn shop
                // piece goes on to its own cap (the ranger's coat to +9).
                const cap = ((g.capBy || {})[wks.fighterClass(f)] || {})[slot];
                if (cap && team === null && def && def.upgrade && wks.sellerOf(w.name) && (w.level || 0) >= wks.finalStage() && (w.level || 0) < cap) {
                    const cl = wks.classes[f] && G.classes[wks.classes[f]];
                    list.push({ fighter: f, slot: slot, name: w.name, stat: def.stat ? (w.stat || (cfg.mainStatOnArmor && cl ? cl.main_stat : null)) : null, weapon: null, level: cap });
                    return;
                }
                if (!target || !def || !def.upgrade || !wks.sellerOf(w.name) || (w.level || 0) < g.fromLevel || (w.level || 0) >= target) return;
                // A drop weapon is being readied for this fighter: its shop weapon stays as it is.
                if (slot === "mainhand" && wks.weaponPlans().some(function (p) { return p.fighter === f; })) return;
                // Stat armor: the worn piece's stat, else the fighter's main stat.
                const cls = wks.classes[f] && G.classes[wks.classes[f]];
                const stat = def.stat ? (w.stat || (cfg.mainStatOnArmor && cls ? cls.main_stat : null)) : null;
                list.push({ fighter: f, slot: slot, name: w.name, stat: stat, weapon: null, level: target });
            });
            const main = eq.mainhand;
            (g.weapons || []).forEach(function (rule) {
                if (main && main.name === rule.name && (main.level || 0) < g.upTo) {
                    list.push({ fighter: f, slot: "mainhand", name: rule.name, stat: null, weapon: rule, level: g.upTo });
                }
            });
        });
        return list;
    }

    // The worn piece a gear-goal slot is about: in the offhand only a weapon (dual wield).
    function goalSlotItem(f, slot) {
        const w = wks.worn[f] && wks.worn[f][slot];
        if (!w || (slot === "offhand" && !(G.items[w.name] && G.items[w.name].type === "weapon"))) return null;
        return w;
    }

    function goalNames() {
        const names = new Set();
        config.team.fighters.forEach(function (f) {
            cfg.gearGoals.slots.forEach(function (slot) {
                const w = goalSlotItem(f, slot);
                if (w && (w.level || 0) >= cfg.gearGoals.fromLevel) names.add(w.name);
            });
        });
        (cfg.gearGoals.weapons || []).forEach(function (rule) { names.add(rule.name); });
        config.team.fighters.forEach(function (f) { const n = wks.shopWeaponGoal(f); if (n) names.add(n); });
        // Shop pieces an off-plan slot is waiting for (2026-11-22): their copies are goal stock.
        config.team.fighters.forEach(function (f) {
            wks.ARMOR_SLOTS.forEach(function (s) { const n = offPlanShop(f, s); if (n) names.add(n); });
        });
        return names;
    }

    // Finished bag copies matched to needs (right stat), in priority order.
    function goalAssignments(needs) {
        const taken = new Set();
        const out = [];
        needs.forEach(function (need) {
            const index = character.items.findIndex(function (item, i) {
                return item && !taken.has(i) && !item.l && item.name === need.name && (item.level || 0) >= need.level &&
                    (!need.stat || item.stat_type === need.stat);
            });
            if (index === -1) return;
            taken.add(index);
            out.push({ need: need, index: index });
        });
        return out;
    }

    function goalReadyFor(fighter) {
        if (!wks.goalsOn()) return [];
        return goalAssignments(goalNeeds()).filter(function (a) { return a.need.fighter === fighter; });
    }

    // Copies of gear-goal items (level 1+) are worth keeping: never sold – until the
    // goal is done for that item (player decision 2026-11-16): once every fighter
    // wearing it has it at upTo, the lower copies are outgrown shop gear.
    function isGoalStock(item) {
        if (!wks.goalsOn() || !item || (item.level || 0) < 1 || !goalNames().has(item.name)) return false;
        return !isOutgrownGoalCopy(item);
    }
    function goalDoneFor(name) {
        const upTo = wks.finalStage(); // lower copies are bases for the next stage until the last one
        if ((cfg.gearGoals.weapons || []).some(function (r) { return r.name === name; })) return false;
        if (config.team.fighters.some(function (f) { return wks.shopWeaponGoal(f) === name; })) return false;
        let wearers = 0;
        const open = config.team.fighters.some(function (f) {
            if (!wks.worn[f]) return true; // unknown yet: not done
            return cfg.gearGoals.slots.some(function (slot) {
                const w = goalSlotItem(f, slot);
                if (!w || w.name !== name) return false;
                wearers++;
                return (w.level || 0) < upTo;
            });
        });
        return wearers > 0 && !open;
    }
    function isOutgrownGoalCopy(item) {
        return wks.goalsOn() && !!item && !!wks.sellerOf(item.name) && (item.level || 0) < wks.finalStage() &&
            goalNames().has(item.name) && goalDoneFor(item.name) && !statCopyWanted(item);
    }
    // A stat copy (e.g. gloves +7 DEX) still beats what a fighter with that main stat wears in
    // its slot - something else (Hand of Midas, Dracul's Attire) or a lower copy (2026-11-18: the
    // old ranger's gloves and coat +7 DEX were sold while the new rogue wore other pieces there).
    function statCopyWanted(item) {
        const def = item && G.items[item.name];
        if (!def || !def.stat || !item.stat_type) return false;
        const slots = wks.SLOTS_BY_TYPE[def.type] || [];
        return config.team.fighters.some(function (f) {
            const cls = wks.fighterClass(f);
            if (!cls || !G.classes[cls] || G.classes[cls].main_stat !== item.stat_type) return false;
            const eq = wks.worn[f] || {};
            return slots.some(function (s) {
                const w = eq[s];
                return !(w && w.name === item.name && w.stat === item.stat_type && (w.level || 0) >= (item.level || 0));
            });
        });
    }

    // Finished copies stay in the bag until they are delivered.
    function isGoalFinished(item) {
        if (!wks.goalsOn() || !item || !goalNames().has(item.name)) return false;
        return goalNeedsAll().some(function (n) { return n.name === item.name && (item.level || 0) >= n.level; });
    }

    function kGold(x) {
        return Math.round(x / 1000) + "k";
    }

    function logBudget() {
        if (Date.now() - wks.lastBudgetLog < 30 * 60 * 1000) return;
        wks.lastBudgetLog = Date.now();
        const b = wks.goalBudget();
        util.log("workshop", "gear goals wait for income: " + kGold(b.allowed) + " left (earned " + kGold(b.earned) + " in " +
            b.hours.toFixed(1) + " h, spent " + kGold(b.spent) + ")", "orange");
    }

    // Main stat before every hand-over (v1.226.2, player decision 2026-11-23): an item with a stat slot goes to a fighter
    // only with that fighter's main stat - none or a wrong one gets the stat scroll first (1 scroll at grade 0, 10 at grade
    // 1). The cost is no reason to skip it (statOnDelivery.maxCost bypasses the pots). One item per workshop round.
    async function statBeforeDelivery() {
        const sc = cfg.statOnDelivery || {};
        if (sc.enabled === false) return false;
        const who = wks.fighters().concat(wks.activeEarmarks().map(function (e) { return e.fighter; })).filter(function (f, i, a) { return a.indexOf(f) === i && wks.isOnline(f); });
        for (const f of who) {
            const main = wks.classes[f] && G.classes[wks.classes[f]] && G.classes[wks.classes[f]].main_stat;
            if (!main) continue;
            const idxs = wks.readyFor(f).map(function (w) { return wks.wishIndex(w, wks.targetLevel(f, w)); })
                .concat(goalReadyFor(f).map(function (a) { return a.index; }));
            for (const index of idxs) {
                const it = character.items[index], def = it && G.items[it.name];
                if (!it || !def || !def.stat || it.l || it.stat_type === main) continue;
                const k = "_stat:" + it.name;
                if ((wks.blockedUntil[k] || 0) > Date.now()) continue;
                try {
                    util.status(main + " scroll for " + it.name + " (" + f + ")", "orange");
                    await applyStat(index, main, k);
                    return true;
                } catch (e) {
                    wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, util.errReason(e));
                    util.log("workshop", "no " + main + " for " + it.name + " +" + (it.level || 0) + " (" + f + "): " + util.errReason(e), "orange");
                }
            }
        }
        return false;
    }
    // Apply a stat scroll (str/int/dex) to the bag copy at `index`; spends from budget key k.
    async function applyStat(index, stat, k) {
        const budgetKey = k || wks.GOALS;
        const item = character.items[index];
        const scroll = stat + "scroll";
        if (!G.items[scroll] || G.items[scroll].type !== "pscroll") throw { reason: "no stat scroll for " + stat };
        const need = [1, 10, 100, 1000][item_grade(item)] || 9999; // scrolls needed by item grade
        const missing = need - util.countItem(scroll);
        if (missing > 0) {
            const cost = missing * G.items[scroll].g;
            if (!wks.canSpend(budgetKey, cost)) throw { reason: "budget" };
            await wks.goTo(wks.sellerOf(scroll));
            await buy(scroll, missing);
            wks.pay(budgetKey, cost);
        }
        await wks.goTo("newupgrade");
        const i = util.findItemIndex(function (x) {
            return x.name === item.name && (x.level || 0) === (item.level || 0) && x.stat_type === item.stat_type && !x.l;
        });
        if (i === -1) throw { reason: "finished copy lost track" };
        await wks.boost("massproduction");
        await upgrade(i, wks.bagIndex(scroll, 0));
        util.log("workshop", item.name + " +" + (item.level || 0) + " now has " + stat + " (" + need + " scrolls)", "green");
    }

    function bestBagLevel(name, below) {
        let best = -1;
        character.items.forEach(function (item) {
            if (item && item.name === name && !item.l && (item.level || 0) < below) best = Math.max(best, item.level || 0);
        });
        return best;
    }

    // One unit of gear-goal work. Returns true when something was done.
    async function workOnGoals() {
        if (!wks.goalsOn() || Date.now() < wks.goalsPausedUntil) return false;
        const g = cfg.gearGoals;
        const needs = goalNeeds();
        const assigned = goalAssignments(needs);
        const takenIdx = new Set(assigned.map(function (a) { return a.index; }));
        // Weapons first (player request 2026-11-15): the risky spare weapons when grace
        // allows (else they wait 30 min), then the worn shop weapons, armor only after that.
        // The offhand weapon (dual wield) is a weapon too: it ranked with the armor and the
        // warrior's Blade +5 waited behind four armor pieces (player decision 2026-11-20).
        function rank(n) { return n.weapon ? 0 : n.slot === "mainhand" || n.slot === "offhand" ? 1 : 2; }
        const open = needs.filter(function (n) { return !assigned.some(function (a) { return a.need === n; }); })
            .sort(function (a, b) { return rank(a) - rank(b); });
        if (!open.length || character.esize < 3) return false;

        const now = Date.now();
        try {
            for (const need of open) {
                // A reserved copy of this item waits for delivery: never use it as a base.
                if (wks.activeEarmarks().some(function (e) { return e.name === need.name; })) continue;
                // 1. A finished copy without the right stat: scroll it for this fighter.
                const finished = character.items.findIndex(function (item, i) {
                    return item && !takenIdx.has(i) && !item.l && item.name === need.name && (item.level || 0) >= need.level;
                });
                if (finished !== -1 && need.stat) {
                    util.status("stat scroll for " + need.name, "orange");
                    await applyStat(finished, need.stat);
                    return true;
                }
                // 2. A finished copy in the bank.
                const bankedDone = wks.bankFind(need.name, function (l) { return l >= need.level; });
                if (bankedDone) {
                    await wks.retrieve(bankedDone);
                    return true;
                }

                const w = { name: need.name, level: need.level };
                if (need.weapon && need.weapon.full) {
                    // 3a. Fire weapon to upTo: develop the best spare copy (not the worn one).
                    if (wks.weaponWaitUntil[need.name] > now) continue;
                    if (!wks.totalCopies(need.name, function (l) { return l < need.level; })) continue;
                    util.status("upgrading " + need.name + " to +" + need.level + " for " + need.fighter, "orange");
                    await wks.develop("_goal", w, { budgetKey: wks.GOALS, minChance: need.weapon.minChance });
                    if (wks.reachedOnly[wks.GOALS] !== undefined) {
                        delete wks.reachedOnly[wks.GOALS];
                        wks.weaponWaitUntil[need.name] = Date.now() + 30 * 60 * 1000;
                    }
                    return true;
                }
                if (need.weapon) {
                    // 3. Weapon: a spare copy at upTo-1, only with enough grace.
                    if (wks.weaponWaitUntil[need.name] > now) continue;
                    const below = g.upTo - 1;
                    if (wks.totalCopies(need.name) < 2 || !wks.totalCopies(need.name, function (l) { return l === below; })) continue;
                    if (bestBagLevel(need.name, g.upTo) < below) await wks.retrieve(wks.bankFind(need.name, function (l) { return l === below; }));
                    util.status("trying " + need.name + " +" + g.upTo, "orange");
                    await wks.develop("_goal", w, { budgetKey: wks.GOALS, minChance: need.weapon.minChance, spare: true });
                    if (wks.reachedOnly[wks.GOALS] !== undefined) {
                        delete wks.reachedOnly[wks.GOALS];
                        wks.weaponWaitUntil[need.name] = Date.now() + 30 * 60 * 1000; // armor failures raise the grace meanwhile
                    }
                    return true;
                }

                // 4. Shop armor: continue with the best copy we have, else buy one.
                const banked = wks.bankFind(need.name, function (l) { return l < need.level; });
                if (banked && banked.level > bestBagLevel(need.name, need.level)) await wks.retrieve(banked);
                util.status("gear goal: " + need.name + " +" + need.level + " for " + need.fighter, "orange");
                await wks.develop("_goal", w, { budgetKey: wks.GOALS, minChance: 0, spare: true, stat: need.stat, noCraft: !!need.noCraft });
                return true;
            }
        } catch (e) {
            const reason = util.errReason(e);
            if (reason === "budget") {
                logBudget();
                wks.goalsPausedUntil = Date.now() + 15 * 60 * 1000;
            } else {
                util.log("workshop", "gear goals: " + reason, "orange");
                wks.goalsPausedUntil = Date.now() + 5 * 60 * 1000;
            }
            return true;
        }
        return false;
    }

    Object.assign(wks, {
        inPlanGroup: inPlanGroup,
        planItems: planItems,
        chainReplaces: chainReplaces,
        itemProps: itemProps,
        atLeastAsGood: atLeastAsGood,
        offPlanShop: offPlanShop,
        offPlanNeed: offPlanNeed,
        goalNeeds: goalNeeds,
        goalNeedsAll: goalNeedsAll,
        goalSlotItem: goalSlotItem,
        goalNames: goalNames,
        goalAssignments: goalAssignments,
        goalReadyFor: goalReadyFor,
        isGoalStock: isGoalStock,
        goalDoneFor: goalDoneFor,
        isOutgrownGoalCopy: isOutgrownGoalCopy,
        statCopyWanted: statCopyWanted,
        isGoalFinished: isGoalFinished,
        kGold: kGold,
        logBudget: logBudget,
        statBeforeDelivery: statBeforeDelivery,
        applyStat: applyStat,
        bestBagLevel: bestBagLevel,
        workOnGoals: workOnGoals,
    });
};
