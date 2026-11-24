// =====================================================================
// roles/workshop/better-weapons.js - better weapons from drops.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- better weapons (drops) -------------------------------------------------
    //
    // config.workshop.betterWeapons: drop weapons are compared with the fighters' worn
    // weapons. A copy that is already stronger goes out; otherwise the best copy is upgraded
    // to the first level that beats the worn weapon. Classes with a gearPlan.weapons list are
    // planned by it (listPlans); weapons made from a material (the Phoenix's fire weapons from
    // essence, Of-the-Dead from Bones) are left to the material goals, spare copies are dismantled.


    // Can fighter f wield this weapon (a two-handed one only with an empty offhand)?
    function canWield(f, name) {
        if (!wks.classes[f] || !util.weaponPower(name, 0, wks.classes[f])) return false;
        return !util.isDoublehand(name, wks.classes[f]) || !realOffhand(wks.worn[f]);
    }
    // The worn offhand, not the "_twohand" marker a fighter reports next to a two-hander (gear.js worn(), 2026-11-23).
    function realOffhand(eq) {
        const o = eq && eq.offhand;
        return o && o.name !== "_twohand" ? o : null;
    }

    // Upgrade cap of a list weapon (gearPlan.weaponCaps, else its default, else 7).
    function weaponCap(name) {
        const caps = (config.gearPlan && config.gearPlan.weaponCaps) || {};
        return caps[name] !== undefined ? caps[name] : (caps.default !== undefined ? caps.default : 7);
    }
    // The fighter's weaker weapon hand: { slot, power } (dual wield: the offhand when it is weaker).
    function weakerHand(f) {
        const eq = wks.worn[f] || {}, cls = wks.classes[f];
        const pw = function (i) { return i ? util.weaponPower(i.name, i.level || 0, cls) : 0; };
        const off = eq.offhand;
        const dual = off && G.items[off.name] && G.items[off.name].type === "weapon";
        if (dual && pw(off) < pw(eq.mainhand)) return { slot: "offhand", power: pw(off) };
        return { slot: "mainhand", power: pw(eq.mainhand) };
    }
    // Weapon lists (config.gearPlan.weapons, player decision 2026-11-21): per fighter one plan - from the
    // back of its class list, the first item we can work on: we hold a copy (any level, not blocked) or can
    // craft one that beats the fighter's weaker worn weapon at some level up to its cap. Items made from a
    // material are skipped (the material goals handle them, 2026-11-22). The shop weapon at the front is
    // left to the gear goals.
    function listPlans() {
        const lists = (config.gearPlan && config.gearPlan.weapons) || {};
        const bw = cfg.betterWeapons || {};
        const material = wks.materialItems(); // the material goals' items (fire, Of-the-Dead)
        const plans = [];
        const now = Date.now();
        wks.activeTeam().forEach(function (f) {
            const list = lists[wks.classes[f]];
            if (!list || !wks.worn[f]) return;
            const hand = weakerHand(f);
            const bar = hand.power * (1 + (bw.margin || 0));
            for (let i = list.length - 1; i >= 0; i--) {
                const name = list[i];
                if (!G.items[name] || wks.sellerOf(name) || !canWield(f, name)) continue; // shop weapon: gear goals
                if (material.includes(name)) {
                    // Made from a material: the material goals craft, upgrade and deliver it - the planner
                    // goes on to the next item (2026-11-22).
                    continue;
                }
                let need = -1;
                for (let level = 0; level <= weaponCap(name); level++) {
                    if (util.weaponPower(name, level, wks.classes[f]) > bar) { need = level; break; }
                }
                if (need < 0) continue; // even at its cap no better than what we wear
                const craftable = (bw.craft || []).includes(name) && !!wks.crafterOf(name);
                if (!wks.unlockedCopies(name).length && !craftable) continue; // nothing to work with (Ponty buys bases)
                if ((wks.blockedUntil[wks.key("_better", { name: name, level: need })] || 0) > now) continue; // budget, failures
                plans.push({ fighter: f, name: name, need: need, slot: hand.slot });
                return;
            }
        });
        return plans;
    }
    // { fighter, name, need, slot } per drop weapon we hold: the list plans, plus for classes without a
    // list, per betterWeapons name, the fighter it beats soonest and the first level (<= maxLevel) at which
    // it beats that fighter's worn weapon.
    function weaponPlans() {
        const bw = cfg.betterWeapons;
        if (!bw || !bw.enabled) return [];
        const lists = (config.gearPlan && config.gearPlan.weapons) || {};
        const plans = listPlans();
        (bw.names || []).forEach(function (name) {
            // Classes with a weapon list are planned by it (listPlans); the names only for the others.
            if (config.team.fighters.every(function (f) { return !wks.classes[f] || lists[wks.classes[f]]; })) return;
            // A material goal waiting for a higher priority (material goals, 2026-11-22).
            if (wks.materialDeferred(name)) return;
            // Names on bw.buy (e.g. the Concord Mace) are bought with tokens when we hold none.
            const buyable = (bw.buy || []).includes(name) && !!wks.tokenOffer(name);
            // Names on bw.craft (the "of the Dead" weapons) are crafted when we hold none – the
            // next weapon step once a fighter's weapon (shop or fire) is at gearGoals.upTo.
            const craftable = (bw.craft || []).includes(name) && !!wks.crafterOf(name);
            if (!G.items[name] || (!wks.unlockedCopies(name).length && !buyable && !craftable)) return;
            let plan = null;
            wks.activeTeam().forEach(function (f) {
                if (!wks.worn[f] || !canWield(f, name) || lists[wks.classes[f]]) return;
                const m = wks.worn[f].mainhand;
                // Already in the main hand: dual wield classes get a second copy for the offhand
                // (gear plan 2026-11-19: two Daggers of the Dead for the rogue, swords/maces for
                // the warrior) - first the main hand, then the offhand.
                let slot = "mainhand";
                if (m && m.name === name) {
                    const off = wks.worn[f].offhand;
                    const offTypes = (G.classes[wks.classes[f]] || {}).offhand || {};
                    if (!offTypes[G.items[name].wtype] || util.isDoublehand(name, wks.classes[f])) return;
                    if (off && (off.name === name || !G.items[off.name] || G.items[off.name].type !== "weapon")) return; // a shield etc. stays
                    slot = "offhand";
                }
                // Not before the fighter is "full +7": weapon at upTo AND all shop armor past
                // the first stage (player decision 2026-11-16).
                if ((bw.craft || []).includes(name)) {
                    const stage = wks.armorStage(f);
                    // First armor stage, not upTo: with shop weapons at +8 (2026-11-19) a rogue
                    // whose gloves are still +7 would never get its Dagger of the Dead.
                    const first = Math.min.apply(null, (cfg.gearGoals.stages && cfg.gearGoals.stages.length) ? cfg.gearGoals.stages : [cfg.gearGoals.upTo]);
                    if (!wks.weaponAtGoal(f) || (stage !== null && stage <= first)) return;
                }
                const held = wks.worn[f][slot];
                const bar = (held ? util.weaponPower(held.name, held.level || 0, wks.classes[f]) : 0) * (1 + (bw.margin || 0));
                for (let level = 0; level <= bw.maxLevel; level++) {
                    if (util.weaponPower(name, level, wks.classes[f]) <= bar) continue;
                    if (!plan || level < plan.need) plan = { fighter: f, name: name, need: level, slot: slot };
                    break;
                }
            });
            if (plan) plans.push(plan);
        });
        return plans;
    }

    // Earmark copies that are already strong enough.
    function deliverBetterWeapons() {
        weaponPlans().forEach(function (plan) {
            const f = plan.fighter;
            if (wks.earmarks[f + "|" + plan.name]) return;
            if (wks.activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) return;
            if (Date.now() - (wks.filledAt[f + "|weapon"] || 0) < 10 * 60 * 1000) return;
            const levels = wks.unlockedCopies(plan.name).filter(function (l) { return l >= plan.need; });
            if (!levels.length) return;
            const level = Math.max.apply(null, levels);
            const m = wks.worn[f][plan.slot || "mainhand"];
            wks.earmark(f, plan.name, level);
            util.log("workshop", plan.name + " +" + level + " goes to " + f + " (" + (plan.slot || "mainhand") + ", stronger than its " +
                (m ? m.name + " +" + (m.level || 0) : "empty hand") + ")", "yellow");
        });
    }

    // One upgrade run for a drop weapon that isn't strong enough yet.
    async function workOnBetterWeapons() {
        const now = Date.now();
        for (const plan of weaponPlans()) {
            const k = wks.key("_better", { name: plan.name, level: plan.need });
            if (wks.blockedUntil[k] > now || wks.earmarks[plan.fighter + "|" + plan.name]) continue;
            if (wks.unlockedCopies(plan.name).some(function (l) { return l >= plan.need; })) continue; // ready to deliver
            if (character.esize < 3) return false;
            const bw = cfg.betterWeapons;
            if (!wks.unlockedCopies(plan.name).length && (bw.craft || []).includes(plan.name)) {
                // A bw.craft weapon we don't hold yet: craft the +0 copy (missing ingredients,
                // e.g. Bones, are reported to the leader's drop routes).
                util.status("crafting " + plan.name + " for " + plan.fighter, "orange");
                try {
                    const r = await wks.craftItem(wks.GOALS, plan.name);
                    if (!r.ok) {
                        util.log("workshop", "can't craft " + plan.name + " yet - missing " + r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                        r.missing.forEach(function (m) { wks.noteIngredientShortage(m.name, m.level, m.need, plan.name); });
                        wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                    }
                } catch (e) {
                    util.log("workshop", "crafting " + plan.name + ": " + util.errReason(e), "orange");
                    wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, util.errReason(e));
                }
                return true;
            }
            if (!wks.unlockedCopies(plan.name).length) {
                // A bw.buy weapon we don't hold yet: buy the +0 copy with tokens first.
                util.status("buying " + plan.name + " for " + plan.fighter, "orange");
                try {
                    if (!(await wks.buyWithTokens(plan.name))) wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                } catch (e) {
                    util.log("workshop", "buying " + plan.name + ": " + util.errReason(e), "orange");
                    wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                }
                return true;
            }
            util.status("upgrading " + plan.name + " for " + plan.fighter, "orange");
            util.log("workshop", "upgrading " + plan.name + " to +" + plan.need + " - then it beats " + plan.fighter + "'s weapon", "yellow");
            // Drop weapons may break (player decision 2026-11-15); token weapons get a risk floor.
            const floor = bw.minChance && bw.minChance[plan.name];
            try {
                await wks.develop("_better", { name: plan.name, level: plan.need }, { budgetKey: wks.GOALS, replaceable: !floor, spare: true, minChance: floor || 0 });
                if (wks.reachedOnly[wks.GOALS] !== undefined) {
                    // Next step below the risk floor: try again later (luck or grace may help).
                    delete wks.reachedOnly[wks.GOALS];
                    wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                }
            } catch (e) {
                const reason = util.errReason(e);
                util.log("workshop", plan.name + " +" + plan.need + ": " + reason, "orange");
                wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, reason);
            }
            return true;
        }
        return false;
    }

    Object.assign(wks, {
        canWield: canWield,
        realOffhand: realOffhand,
        weaponCap: weaponCap,
        weakerHand: weakerHand,
        listPlans: listPlans,
        weaponPlans: weaponPlans,
        deliverBetterWeapons: deliverBetterWeapons,
        workOnBetterWeapons: workOnBetterWeapons,
    });
};
