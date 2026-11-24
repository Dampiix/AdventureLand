// =====================================================================
// roles/workshop/grace.js - grace: the upgrade chance bonus and its 24 h budget.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- grace ------------------------------------------------------------------
    //
    // A failed upgrade towards +L raises the player's grace for +L (any item),
    // a success at +L resets it. So before risking a valuable item at +L we fail
    // cheap shop items (config.workshop.grace.fodder) at +L until the valuable
    // item's previewed chance reaches its tier – or the grace budget runs out.

    // How far below the floor grace farming may start at all (risk.graceWindow: a number,
    // or { default, <level>: window } – the highest listed level <= target wins). How many
    // stacks are actually built is decided by the fodder's chance (see farmGrace).
    function graceWindowFor(target) {
        const w = cfg.risk.graceWindow;
        if (typeof w === "number") return w;
        if (!w) return 0.1;
        let best = w.default !== undefined ? w.default : 0.1;
        let bestLevel = -1;
        Object.keys(w).forEach(function (k) {
            const l = Number(k);
            if (!isNaN(l) && l <= target && l > bestLevel) { bestLevel = l; best = w[k]; }
        });
        return best;
    }
    function graceHelps(item, level) {
        const k = item.name + ":" + level;
        if (wks.noGraceUntil[k] > Date.now()) return false;
        const normal = item_grade({ name: item.name, level: 0 }) === 0;
        if (!normal) {
            wks.noGraceUntil[k] = Date.now() + 24 * 60 * 60 * 1000;
            util.log("workshop", "no grace for " + item.name + " +" + level + " -> +" + (level + 1) +
                ": not a normal-grade item (grace -1/-2 on it, fodder grace barely helps)", "orange");
        }
        return normal;
    }

    function fodderIndex(maxLevel) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== cfg.grace.fodder || item.l || item.p) return;
            const lvl = item.level || 0;
            if (lvl > maxLevel) return;
            if (best === -1 || lvl > (character.items[best].level || 0)) best = i;
        });
        return best;
    }

    // One upgrade attempt on a fodder copy; returns "success" | "fail".
    // bulk: how many scrolls to buy if we have none (one trip for a whole batch).
    // check(ownChance): at the target level, the fodder's own success chance is previewed
    // first; a returned reason skips the attempt ({ stop: reason }).
    async function fodderAttempt(gk, index, bulk, check) {
        const item = character.items[index];
        const scroll = "scroll" + item_grade(item);
        await wks.ensureScroll(gk, scroll, bulk || 1);
        await wks.goTo("newupgrade");
        const i = util.findItemIndex(function (x) { return x.name === item.name && (x.level || 0) === (item.level || 0) && !x.l && !x.p; });
        if (i === -1) throw { reason: "fodder lost track" };
        if (check) {
            const why = check((await upgrade(i, wks.bagIndex(scroll, 0), null, true)).chance);
            if (why) return { stop: why };
        }
        await wks.boost("massproduction");
        const result = await upgrade(i, wks.bagIndex(scroll, 0));
        return result.success ? "success" : "fail";
    }

    // Returns the new chance once it reaches minChance, or null when we gave up.
    async function farmGrace(level, minChance, targetChance, itemName) {
        const gk = "grace:" + level;
        const fodder = cfg.grace.fodder;
        const def = G.items[fodder];
        util.log("workshop", "building grace for +" + level + " with " + fodder + " (need " + wks.pct(minChance) + ", budget " +
            Math.round(((wks.spent[gk] || 0)) / 1000) + "k of " + Math.round(wks.budgetFor(gk) / 1000) + "k today)", "yellow");
        let tries = 0;   // attempts at the target level
        let stopReason = "attempt limit";
        // How many grace stacks are realistic is decided by the fodder's own chance (player
        // decision 2026-11-16): every failed fodder attempt is a stack, a success resets
        // them, and grace raises the fodder's chance too. We stop when the fodder would
        // succeed with more than grace.maxFodderChance – now, or by the time the stacks
        // still needed (from the measured gain per stack) are built.
        const cap = cfg.grace.maxFodderChance || 0.5;
        let lastOwn = null;      // fodder chance before the previous attempt
        let lastGain = null;     // target chance gained by the previous failed attempt
        let lastFailed = false;
        let current = null;      // target chance right now

        // Fodder copies sitting exactly one level below the target.
        const readyCount = function () {
            return character.items.filter(function (i) {
                return i && i.name === fodder && !i.l && !i.p && (i.level || 0) === level - 1;
            }).length;
        };

        try {
            for (let round = 0; round < 50 && tries < cfg.grace.maxAttempts; round++) {
                let chance = await targetChance();
                current = chance;
                if (chance >= minChance) {
                    util.log("workshop", "grace done after " + tries + " attempts: +" + level + " now at " + wks.pct(chance), "green");
                    return chance;
                }

                // 1. Prepare a batch: buy helmets and climb all of them to +level-1 first,
                //    so the attempts at +level can run back to back (one scroll trip, no walking).
                const want = Math.min(cfg.grace.batch, cfg.grace.maxAttempts - tries);
                // Buy the missing helmets in one visit.
                const have = character.items.filter(function (i) { return i && i.name === fodder && !i.l && !i.p && (i.level || 0) <= level - 1; }).length;
                let toBuy = Math.min(want - have, character.esize - 2);
                while (toBuy > 1 && !wks.canSpend(gk, def.g * toBuy)) toBuy--;
                if (toBuy > 0 && wks.canSpend(gk, def.g * toBuy)) {
                    await wks.goTo(wks.sellerOf(fodder));
                    for (let b = 0; b < toBuy; b++) await buy(fodder, 1);
                    wks.pay(gk, def.g * toBuy);
                }
                for (let guard = 0; readyCount() < want && guard < want * 12; guard++) {
                    let index = fodderIndex(level - 2); // a copy that still needs climbing
                    if (index === -1) {
                        if (character.esize < 2) { stopReason = "bag full"; break; }
                        if (!wks.canSpend(gk, def.g)) { stopReason = "budget used up"; break; }
                        await wks.goTo(wks.sellerOf(fodder));
                        await buy(fodder, 1);
                        wks.pay(gk, def.g);
                        index = fodderIndex(level - 2);
                        if (index === -1) { stopReason = "could not buy " + fodder; break; }
                    }
                    await fodderAttempt(gk, index, want * level); // climbing; a failure just costs a cheap copy
                }
                if (!readyCount()) break;
                util.log("workshop", readyCount() + " " + fodder + "s ready at +" + (level - 1) + " - attempting +" + level, "white");

                // 2. Attempt the whole batch in a row, re-checking the real preview after each one.
                const check = function (own) {
                    let why = null;
                    if (own > cap) {
                        why = "fodder already succeeds with " + wks.pct(own) + " - another grace stack is unlikely";
                    } else if (lastFailed && lastOwn !== null && lastGain > 0) {
                        const perStack = Math.max(0, own - lastOwn);
                        const needed = Math.ceil((minChance - current) / lastGain);
                        const atLast = own + (needed - 1) * perStack;
                        if (atLast > cap) {
                            why = "needs ~" + needed + " more stacks (+" + wks.pct(lastGain) + " each), the fodder would be at " +
                                wks.pct(atLast) + " by then - not realistic";
                        }
                    }
                    lastOwn = own;
                    return why;
                };
                while (readyCount() && tries < cfg.grace.maxAttempts) {
                    const before = current;
                    const outcome = await fodderAttempt(gk, fodderIndex(level - 1), readyCount(), check);
                    if (outcome && outcome.stop) { stopReason = outcome.stop; break; }
                    tries++;
                    util.log("workshop", "grace attempt " + tries + " at +" + level + ": " + (outcome === "fail" ? "failed (grace up)" : "succeeded (grace reset)") +
                        " - fodder had " + wks.pct(lastOwn), "white");
                    if (outcome === "fail") {
                        chance = await targetChance();
                        current = chance;
                        lastGain = chance - before;
                        lastFailed = true;
                        if (lastGain < 0.005) {
                            stopReason = "a grace stack gave the item " + wks.pct(lastGain) + " - this fodder does not help it";
                            if (itemName) wks.noGraceUntil[itemName + ":" + (level - 1)] = Date.now() + 24 * 60 * 60 * 1000;
                            break;
                        }
                        if (chance >= minChance) {
                            util.log("workshop", "grace done after " + tries + " attempts: +" + level + " now at " + wks.pct(chance), "green");
                            return chance;
                        }
                    } else {
                        lastFailed = false;
                        lastGain = null;
                        current = await targetChance();
                    }
                }
                if (stopReason !== "attempt limit") break;
            }
        } catch (e) {
            stopReason = util.errReason(e); // e.g. "budget" from a scroll purchase
        }
        util.log("workshop", "grace for +" + level + " stopped: " + stopReason + " (" + Math.round((wks.spent[gk] || 0) / 1000) + "k spent)", "orange");
        return null;
    }

    // Copies of an item in bag and bank (locked and shiny ones too), optionally only levels passing filter.
    function totalCopies(name, filter) {
        const inBag = character.items.filter(function (i) { return i && i.name === name && (!filter || filter(i.level || 0)); }).length;
        const inBank = wks.bankSnapshot ? wks.bankSnapshot.items.filter(function (b) { return b.name === name && (!filter || filter(b.level)); }).length : 0;
        return inBag + inBank;
    }
    function tryAllowed(name, level) {
        const max = (cfg.dailyTries || {})[name + ":" + level];
        if (typeof max !== "number") return true;
        const list = (wks.tries[name + ":" + level] || []).filter(function (t) { return Date.now() - t < 24 * 60 * 60 * 1000; });
        return list.length < max;
    }
    function noteTry(name, level) {
        const k = name + ":" + level;
        if (typeof (cfg.dailyTries || {})[k] !== "number") return;
        wks.tries[k] = (wks.tries[k] || []).filter(function (t) { return Date.now() - t < 24 * 60 * 60 * 1000; }).concat([Date.now()]);
        try { set(wks.TRY_KEY, wks.tries); } catch (e) { /* storage unavailable */ }
    }

    async function develop(fighter, w, opts) {
        const k = (opts && opts.budgetKey) || wks.key(fighter, w);
        const def = G.items[w.name];
        if (!def.upgrade) {
            if (def.compound) return wks.developCompound(fighter, w);
            util.log("workshop", w.name + " can be neither upgraded nor compounded", "orange");
            wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            return false;
        }

        // A base copy: best lower copy in the bag, then the bank, then the shop.
        let index = -1;
        character.items.forEach(function (item, i) {
            if (item && item.name === w.name && (item.level || 0) < w.level && !item.l &&
                (index === -1 || (item.level || 0) > (character.items[index].level || 0))) index = i;
        });
        if (index === -1) {
            const banked = wks.bankFind(w.name, function (l) { return l < w.level; });
            if (banked) {
                await wks.retrieve(banked);
                index = wks.bagIndex(w.name, banked.level);
            }
        }
        if (index === -1) {
            const seller = wks.sellerOf(w.name);
            if (seller) {
                if (!wks.canSpend(k, def.g)) throw { reason: "budget" };
                await wks.goTo(seller);
                await buy(w.name, 1);
                wks.pay(k, def.g);
            } else if (wks.crafterOf(w.name) && !(opts && opts.noCraft)) {
                const r = await wks.craftItem(k, w.name);
                if (r.working) return false; // an ingredient got a step: on with it next round
                if (!r.ok) {
                    util.log("workshop", "can't craft " + w.name + " yet - missing " +
                        r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                    r.missing.forEach(function (m) { wks.noteIngredientShortage(m.name, m.level, m.need, w.name); });
                    wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                    return false;
                }
            } else if (await wks.openSourceFor(w.name)) {
                return false; // a box/exchange was opened – its reward is random, look again next round
            } else if (!(await wks.buyWithTokens(w.name))) {
                util.log("workshop", "no copy of " + w.name + " and no shop or token offer for it", "orange");
                if (!wks.tokenOffer(w.name)) wks.noteShortage(w.name, 0); // drop-only item: the team can farm it
                wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                return false;
            }
            index = wks.bagIndex(w.name, 0);
        }

        // Step by step at Cue.
        for (;;) {
            const item = character.items[index];
            if (!item || item.name !== w.name) throw { reason: "working copy lost track" };
            const level = item.level || 0;
            if (level >= w.level) return true;

            // A wished stat goes on while the scroll is cheap: before the step into the
            // next grade (e.g. +6 -> +7: 1 stat scroll instead of 10).
            const stat = opts && opts.stat;
            if (stat && item.stat_type !== stat && G.items[w.name].stat) {
                const next = Object.assign({}, item, { level: level + 1 });
                if (item_grade(next) > item_grade(item)) {
                    await wks.applyStat(index, stat, k);
                    index = util.findItemIndex(function (i) { return i.name === w.name && (i.level || 0) === level && i.stat_type === stat; });
                    if (index === -1) throw { reason: "working copy lost track" };
                    continue;
                }
            }

            const grade = item_grade(item);
            // Re-buyable from an NPC = replaceable (risk.shop); token/drop copies are risk.rare.
            const replaceable = opts && opts.replaceable !== undefined ? opts.replaceable : !!wks.sellerOf(w.name);
            const minChance = opts && opts.minChance !== undefined ? opts.minChance : wks.minChanceFor(item, replaceable, 1);
            let scroll = "scroll" + grade;
            // Fixed High-scroll levels only with scrollChoice off (player decisions 2026-11-17/20);
            // otherwise the cheapest scroll per step is chosen after the preview below.
            const choose = !(cfg.scrollChoice && cfg.scrollChoice.enabled === false);
            const hs = cfg.risk.higherScrollFrom;
            if (!choose && hs && grade === 0 && level + 1 >= hs && !wks.sellerOf(w.name) && G.items[w.name].type === "weapon") scroll = "scroll1";
            const gs = cfg.risk.gearHighScrollFrom;
            const armor = ["helmet", "chest", "pants", "shoes", "gloves"].includes(G.items[w.name].type);
            if (!choose && gs && grade === 0 && level >= gs && (wks.sellerOf(w.name) || armor)) scroll = "scroll1";
            await wks.ensureScroll(k, scroll, w.level - level);
            await wks.goTo("newupgrade");
            // Buying and walking can reorder the bag: re-locate the working copy.
            const locate = function () {
                const here = character.items[index];
                if (here && here.name === w.name && (here.level || 0) === level) return index;
                index = util.findItemIndex(function (i) { return i.name === w.name && (i.level || 0) === level && !i.l; });
                if (index === -1) throw { reason: "working copy lost track" };
                return index;
            };
            const preview = async function (s) { return (await upgrade(locate(), s, null, true)).chance; };
            let chance = await preview(wks.bagIndex(scroll, 0));
            if (choose) {
                const pick = wks.cheaperScroll(w.name, level, false, chance);
                if (pick) {
                    try {
                        await wks.ensureScroll(k, pick.scroll, 1);
                        await wks.goTo("newupgrade");
                        const better = await preview(wks.bagIndex(pick.scroll, 0));
                        if (better > chance) {
                            util.log("workshop", w.name + " +" + level + " -> +" + (level + 1) + ": " + pick.scroll + " " + wks.pct(better) + " instead of " + wks.pct(chance) +
                                " (expected " + Math.round(pick.cost / 1000) + "k vs " + Math.round(pick.normalCost / 1000) + "k)", "white");
                            scroll = pick.scroll;
                            chance = better;
                        }
                    } catch (e) { /* no budget for it: the normal scroll */ }
                }
            }
            if (chance < minChance) {
                // Spare upgrades use normal scrolls only – rare scrolls and grace are kept for wishes.
                const spare = !!(opts && opts.spare);
                let better = spare ? null : await wks.strongerScroll(k, "scroll", grade, minChance, preview);
                // Still short on a valuable item at a higher level, but close (risk.graceWindow):
                // build grace with cheap fodder. Far below the floor, grace costs too much.
                const close = chance >= minChance - graceWindowFor(level + 1);
                if (!better && !spare && close && minChance > 0 && cfg.grace.enabled && level + 1 >= cfg.grace.minLevel &&
                    graceHelps(item, level)) {
                    const graced = await farmGrace(level + 1, minChance, async function () {
                        await wks.ensureScroll(k, scroll, 1); // fodder attempts may have used our scrolls
                        await wks.goTo("newupgrade");
                        return preview(wks.bagIndex(scroll, 0));
                    }, w.name);
                    if (graced !== null) better = { scroll: scroll, chance: graced };
                }
                if (!better) {
                    util.log("workshop", w.name + " +" + level + " -> +" + (level + 1) + " only " + wks.pct(chance) + " (need " + wks.pct(minChance) + ") - stopping at +" + level, "orange");
                    wks.reachedOnly[k] = level; // deliver the copy as it is; the fighter's guide decides whether to wear it
                    return true;
                }
                scroll = better.scroll;
                chance = better.chance;
            }
            if (!tryAllowed(w.name, level + 1)) throw { reason: "daily tries for " + w.name + " +" + (level + 1) + " used" };
            await wks.boost("massproduction");
            const result = await upgrade(locate(), wks.bagIndex(scroll, 0));
            noteTry(w.name, level + 1);
            if (result.success) {
                util.log("workshop", w.name + " is now +" + result.level + " (" + wks.pct(chance) + ", " + scroll + ")", "green");
                index = result.num !== undefined ? result.num : index;
            } else {
                util.log("workshop", w.name + " +" + level + " failed (" + wks.pct(chance) + ") - the copy is gone", "red");
                return false; // next work() round starts again with a new base copy, budget permitting
            }
        }
    }

    Object.assign(wks, {
        graceWindowFor: graceWindowFor,
        graceHelps: graceHelps,
        fodderIndex: fodderIndex,
        fodderAttempt: fodderAttempt,
        farmGrace: farmGrace,
        totalCopies: totalCopies,
        tryAllowed: tryAllowed,
        noteTry: noteTry,
        develop: develop,
    });
};
