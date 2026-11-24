// =====================================================================
// roles/workshop/compound.js - compounding spare copies.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- compound -----------------------------------------------------------

    // Usable copies (not locked, not shiny) of name at exactly `level`.
    function bagCopies(name, level) {
        const list = [];
        character.items.forEach(function (item, i) {
            if (item && item.name === name && (item.level || 0) === level && !item.l && !item.p) list.push(i);
        });
        return list;
    }

    function bankCopies(name, level) {
        if (!wks.bankSnapshot) return [];
        return wks.bankSnapshot.items.filter(function (b) { return b.name === name && b.level === level; });
    }

    // Combine three copies of name +level into one +level+1 at Cue.
    // Returns true on success, false on a failed roll, throws when it cannot try.
    async function compoundStep(k, name, level) {
        const missing = 3 - bagCopies(name, level).length;
        if (missing > 0) {
            if (character.esize < missing + 1) throw { reason: "bag full" };
            const banked = bankCopies(name, level);
            if (banked.length < missing) throw { reason: "not enough copies of " + name + " +" + level };
            for (const entry of banked.slice(0, missing)) await wks.retrieve(entry);
        }
        const copies = bagCopies(name, level);
        if (copies.length < 3) throw { reason: "copies went missing" };

        const sample = character.items[copies[0]];
        const grade = item_grade(sample);
        const minChance = wks.minChanceFor(sample, true, 3);
        let scroll = "cscroll" + grade;
        await wks.ensureScroll(k, scroll, 1);
        await wks.goTo("newupgrade");
        const preview = async function (s) {
            const c = bagCopies(name, level);
            return (await compound(c[0], c[1], c[2], s, null, true)).chance;
        };
        let chance = await preview(wks.bagIndex(scroll, 0));
        // Cheapest scroll per step (scrollChoice, 2026-11-20): a higher one when it saves gold.
        if (!(cfg.scrollChoice && cfg.scrollChoice.enabled === false)) {
            const pick = wks.cheaperScroll(name, level, true, chance);
            if (pick) {
                try {
                    await wks.ensureScroll(k, pick.scroll, 1);
                    await wks.goTo("newupgrade");
                    const better = await preview(wks.bagIndex(pick.scroll, 0));
                    if (better > chance) {
                        util.log("workshop", name + " +" + level + " -> +" + (level + 1) + ": " + pick.scroll + " " + wks.pct(better) + " instead of " + wks.pct(chance) +
                            " (expected " + Math.round(pick.cost / 1000) + "k vs " + Math.round(pick.normalCost / 1000) + "k)", "white");
                        scroll = pick.scroll;
                        chance = better;
                    }
                } catch (e) { /* no budget for it: the normal scroll */ }
            }
        }
        if (chance < minChance) {
            const better = await wks.strongerScroll(k, "cscroll", grade, minChance, preview);
            if (!better) throw { reason: name + " +" + level + " -> +" + (level + 1) + " only " + wks.pct(chance) + " (need " + wks.pct(minChance) + ")" };
            scroll = better.scroll;
            chance = better.chance;
        }
        const c = bagCopies(name, level);
        await wks.boost("massproduction");
        const result = await compound(c[0], c[1], c[2], wks.bagIndex(scroll, 0));
        if (result.success) {
            util.log("workshop", "compounded 3x " + name + " +" + level + " -> +" + (level + 1) + " (" + wks.pct(chance) + ")", "green");
            return true;
        }
        util.log("workshop", "compound " + name + " +" + level + " failed (" + wks.pct(chance) + ") - three copies lost", "red");
        return false;
    }

    // Build a wished compound item from existing copies, lowest level first.
    async function developCompound(fighter, w) {
        const k = wks.key(fighter, w);
        for (let level = 0; level < w.level; level++) {
            const total = bagCopies(w.name, level).length + bankCopies(w.name, level).length;
            if (total >= 3) {
                await compoundStep(k, w.name, level);
                return false; // one roll per work() round; the next round continues
            }
        }
        // Craftable (e.g. Orb of Beginnings at Cole): make another +0 copy.
        if (wks.crafterOf(w.name) && wks.copiesMissing(w.name, w.level) > 0) {
            const r = await wks.craftItem(k, w.name);
            if (r.ok || r.working) return false; // the next round compounds or crafts again
            util.log("workshop", "can't craft " + w.name + " yet - missing " +
                r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
            r.missing.forEach(function (m) { wks.noteIngredientShortage(m.name, m.level, m.need, w.name); });
            wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            return false;
        }
        util.log("workshop", "not enough copies to build " + w.name + " +" + w.level + " yet", "orange");
        wks.noteShortage(w.name, w.level);
        wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
        return false;
    }

    Object.assign(wks, {
        bagCopies: bagCopies,
        bankCopies: bankCopies,
        compoundStep: compoundStep,
        developCompound: developCompound,
    });
};
