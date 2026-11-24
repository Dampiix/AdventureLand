// =====================================================================
// roles/workshop/material-goals.js - material goals: weapons crafted from a dismantled material and pushed up the upgrade
// ladder; also the missing-copies / drop shortage report (reportDrops) and automatic compounding (autoCompound).
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const cfg = config.workshop;

    function mgOn() { return !!wks.MG.enabled; }
    // A fighter's class: sent with its wishes, else the account's character list (offline).
    function fighterClass(f) {
        if (wks.classes[f]) return wks.classes[f];
        try {
            const c = ((parent.X && parent.X.characters) || []).find(function (x) { return x.name === f; });
            return c && G.classes[c.type] ? c.type : null;
        } catch (e) { return null; }
    }
    function onDismantleList(name) { return ((config.dismantle || {}).names || []).includes(name); }
    function makeMaterial(mat) {
        const mc = (wks.MG.materials || {})[mat] || {};
        // Upgradeable weapons whose recipe uses the material (read from G.craft), minus MG.skip.
        function items() {
            return Object.keys(G.craft || {}).filter(function (name) {
                const def = G.items[name], r = G.craft[name];
                return def && def.type === "weapon" && def.upgrade && r && !(wks.MG.skip || []).includes(name) &&
                    (r.items || []).some(function (it) { return it[1] === mat; });
            });
        }
        function goalLevel(name) { return typeof mc.upTo === "number" ? mc.upTo : wks.weaponCap(name); }
        const USED_KEY = mat === "essenceoffire" ? "workshop_essence_used:" + character.name : "workshop_material_used:" + mat + ":" + character.name;
        const used = (function () { try { return get(USED_KEY) || {}; } catch (e) { return {}; } })();
        function saveUsed() { try { set(USED_KEY, used); } catch (e) { /* storage unavailable */ } }
        const keyPrefix = mat === "essenceoffire" ? "_essence" : "_mat_" + mat;
        function goalKey(g) { return wks.key(keyPrefix, { name: g.name, level: g.level }); }

        // [{ fighter, slot, name, level, prio }]
        function needs() {
            if (wks.MG.auto === false) return [];
            const names = items();
            const out = [];
            wks.activeTeam().forEach(function (f) {
                const cls = fighterClass(f);
                const eq = wks.worn[f];
                if (!cls || !eq) return;
                const list = ((config.gearPlan && config.gearPlan.weapons) || {})[cls] || null;
                ["mainhand", "offhand"].forEach(function (slot) {
                    const w = eq[slot];
                    // Offhand: only a second weapon (dual wield) - shields, books and quivers stay.
                    if (slot === "offhand" && !(w && G.items[w.name] && G.items[w.name].type === "weapon")) return;
                    const wornPowerHere = w ? util.weaponPower(w.name, w.level || 0, cls) : 0;
                    if (list) {
                        list.forEach(function (name, i) {
                            if (!names.includes(name)) return;
                            if (slot === "mainhand" ? !util.weaponPower(name, 0, cls) : !(G.classes[cls].offhand || {})[G.items[name].wtype]) return;
                            if (util.weaponPower(name, goalLevel(name), cls) <= wornPowerHere) return; // what we wear is as good already
                            out.push({ fighter: f, slot: slot, name: name, level: goalLevel(name), prio: list.length - i });
                        });
                        return;
                    }
                    let best = null, bestPower = 0;
                    names.forEach(function (name) {
                        if (slot === "mainhand") {
                            if (!util.weaponPower(name, 0, cls)) return;
                            if (util.isDoublehand(name, cls) && wks.realOffhand(eq)) return;
                        } else if (!(G.classes[cls].offhand || {})[G.items[name].wtype]) return;
                        const p = util.weaponPower(name, goalLevel(name), cls);
                        if (p > bestPower) { best = name; bestPower = p; }
                    });
                    if (best && bestPower > wornPowerHere) out.push({ fighter: f, slot: slot, name: best, level: goalLevel(best), prio: 1 });
                });
            });
            return out;
        }
        // { all, open, deferred, keepWorking }: all = goals still lacking copies; open = the lowest priority
        // number among them (worked on, crafted for); deferred = names of the waiting ones (their +0 copies
        // become material when they are on the dismantle list); keepWorking = waiting goals whose held
        // copies are still upgraded (not on the dismantle list). Cached for 5 s (isDismantleCopy asks per item).
        let stateAt = 0, state = null;
        function goalState() {
            if (state && Date.now() - stateAt < 5000) return state;
            const want = {};
            const add = function (name, level, count, fighter, prio) {
                const k = name + "|" + level;
                const g = want[k] = want[k] || { name: name, level: level, count: 0, fighters: [], prio: prio || 1 };
                g.count += count;
                g.prio = Math.min(g.prio, prio || 1);
                if (fighter) g.fighters.push(fighter);
            };
            needs().forEach(function (n) { add(n.name, n.level, 1, n.fighter, n.prio); });
            (mc.extra || []).forEach(function (x) { if (x && G.items[x.item]) add(x.item, x.level || 0, x.count || 1, null, 1); });
            const all = Object.keys(want).map(function (k) { return want[k]; }).filter(function (g) {
                return unlockedCopies(g.name).filter(function (l) { return l >= g.level; }).length < g.count;
            });
            const top = all.reduce(function (m, g) { return Math.min(m, g.prio); }, Infinity);
            const open = all.filter(function (g) { return g.prio === top; });
            const deferred = all.filter(function (g) { return g.prio > top; }).map(function (g) { return g.name; })
                .filter(function (n) { return !open.some(function (g) { return g.name === n; }); });
            const keepWorking = all.filter(function (g) { return deferred.includes(g.name) && !onDismantleList(g.name); });
            state = { all: all, open: open, deferred: deferred, keepWorking: keepWorking };
            stateAt = Date.now();
            return state;
        }
        function forget() { state = null; }
        function deferred(name) { return goalState().deferred.includes(name); }
        // Copies of this item must not be dismantled: an open goal wants it, or a waiting one that keeps
        // its copies (not on the dismantle list).
        function protects(name) {
            const s = goalState();
            return s.open.some(function (g) { return g.name === name; }) || s.keepWorking.some(function (g) { return g.name === name; });
        }
        // Material we have or will have: in stock, plus +0 sources waiting to be dismantled.
        function ahead() {
            const goalNames = goalState().all.map(function (g) { return g.name; });
            let n = wks.ownedCount(mat);
            (mc.sources || []).forEach(function (src) {
                if (goalNames.includes(src) || !onDismantleList(src)) return; // kept as it is
                n += unlockedCopies(src).filter(function (l) { return l === 0; }).length;
            });
            return n;
        }
        // A Ponty offer worth buying for this material: "source" / "base" / null (it at price).
        function wantsOffer(it, price) {
            if ((it.level || 0) !== 0) return null;
            const goals = goalState().all;
            if (!goals.length) return null;
            if ((mc.sources || []).includes(it.name) && price <= (mc.sourceMaxPrice || 0)) {
                const zeros = []; for (let i = ahead(); i > 0; i--) zeros.push(0);
                if (goals.some(function (g) { return wks.wantsAsBase(g.name, 0, g.level, g.count, unlockedCopies(g.name).concat(zeros)); })) return "source";
            }
            const rare = (mc.rareBases || {})[it.name];
            if (rare && price <= rare && goals.some(function (g) {
                return ((G.craft[g.name] || {}).items || []).some(function (x) { return x[1] === it.name; });
            }) && wks.ingredientCount(it.name, 0) < ahead()) return "base";
            return null;
        }
        // Every ingredient no shop sells is in stock (the material, a rare base): a +0 copy can be crafted.
        function craftable(name) {
            const r = G.craft[name];
            if (!r || !wks.crafterOf(name)) return false;
            return r.items.every(function (x) { return ((x[2] || 0) === 0 && wks.sellerOf(x[1])) || wks.ingredientCount(x[1], x[2] || 0) >= x[0]; });
        }
        function budgetKey() { return mc.budget === "ladder" ? ladderOrGoals() : wks.GOALS; }
        function deliver() {
            // "better" materials are delivered together in deliverMaterialGoals (strongest copy of all of them).
            if (mc.deliver === "better") return;
            needs().forEach(function (n) {
                if (wks.earmarks[n.fighter + "|" + n.name]) return;
                const levels = unlockedCopies(n.name).filter(function (l) { return l >= n.level; });
                if (!levels.length) return;
                const level = Math.max.apply(null, levels);
                wks.earmark(n.fighter, n.name, level);
                util.log("workshop", n.name + " +" + level + " goes to " + n.fighter + " (" + mat + " goal)", "yellow");
            });
        }
        // "better" materials go step by step (player decision 2026-11-22): the first level (up to the goal)
        // at which a copy beats the weakest worn weapon among the goal's fighters - delivered there, the
        // replaced weapon comes back as a base, and the next run aims one step higher. "goal": the goal level.
        function stepLevel(g) {
            if (mc.deliver !== "better") return g.level;
            const margin = 1 + ((cfg.betterWeapons || {}).margin || 0);
            let step = g.level;
            needs().forEach(function (n) {
                if (n.name !== g.name) return;
                const cls = wks.classes[n.fighter] || fighterClass(n.fighter);
                const bar = wks.weakerHand(n.fighter).power * margin;
                for (let l = 0; l < step; l++) {
                    if (util.weaponPower(g.name, l, cls) > bar) { step = l; break; }
                }
            });
            return step;
        }
        // One craft-and-upgrade run. Returns true when something was done.
        async function work() {
            const limit = typeof wks.MG.maxPerGoal === "number" ? wks.MG.maxPerGoal : null; // null = no limit
            const now = Date.now();
            const s = goalState();
            const list = s.open.map(function (g) { return { g: g, craft: true }; })
                .concat(s.keepWorking.map(function (g) { return { g: g, craft: false }; }));
            for (const x of list) {
                const g = x.g;
                const k = goalKey(g);
                if ((wks.blockedUntil[k] || 0) > now) continue;
                const spent = used[k] || 0;
                if (limit !== null && spent >= limit) continue;
                const step = stepLevel(g);
                // A copy at the step already: it waits for delivery (deliver), nothing to upgrade now.
                if (wks.totalCopies(g.name, function (l) { return l >= step; }) > 0 && step < g.level) continue;
                const hasBase = wks.totalCopies(g.name, function (l) { return l < step; }) > 0;
                if (!hasBase && (!x.craft || wks.ownedCount(mat) <= (wks.MG.reserve || 0) || !craftable(g.name))) continue; // nothing to work with
                if (character.esize < 4) return false;
                const before = wks.ownedCount(mat);
                util.status(mat + " goal: " + g.name + " +" + step + (step < g.level ? " (on the way to +" + g.level + ")" : ""), "orange");
                try {
                    // Normal scroll choice, any chance: every copy is one attempt (player decision 2026-11-18).
                    await wks.develop(keyPrefix, { name: g.name, level: step }, { budgetKey: budgetKey(), replaceable: true, spare: true, minChance: 0, noCraft: !x.craft });
                    forget(); // copies changed: the goals are read fresh
                } catch (e) {
                    const reason = util.errReason(e);
                    util.log("workshop", mat + " goal " + g.name + " +" + g.level + ": " + reason, "orange");
                    // A full bag or an empty pot clears soon: again in a few minutes, not after an hour.
                    const soon = /space|bag full|budget|gold/.test(reason);
                    wks.blockedUntil[k] = Date.now() + (soon ? (cfg.retryAfterBudgetMs || 10 * 60 * 1000) : wks.pauseAfter(k, reason));
                }
                const spentHere = before - wks.ownedCount(mat);
                if (spentHere > 0) used[k] = spent + spentHere;
                if (!goalState().all.some(function (o) { return o.name === g.name && o.level === g.level; })) {
                    util.log("workshop", mat + " goal reached: " + g.name + " +" + g.level + " after " + (used[k] || 0) + "x " + mat, "green");
                    delete used[k];
                }
                saveUsed();
                return true;
            }
            return false;
        }
        function report() {
            const goals = goalState().all;
            if (!goals.length) return "";
            return " | " + mat + " goals: " + goals.map(function (g) {
                return g.name + "+" + g.level + " p" + g.prio + (g.fighters.length ? " " + g.fighters.join("/") : "") + " (" + (used[goalKey(g)] || 0) + " used)";
            }).join(", ") + ", " + wks.ownedCount(mat) + " left";
        }
        // "better": every held copy that beats the fighter's weaker worn weapon, with its power.
        function candidates() {
            if (mc.deliver !== "better") return [];
            const bw = cfg.betterWeapons || {};
            const out = [], seen = {};
            needs().forEach(function (n) {
                const f = n.fighter, k = f + "|" + n.name;
                if (seen[k]) return;
                seen[k] = true;
                const hand = wks.weakerHand(f), cls = wks.classes[f] || fighterClass(f);
                const bar = hand.power * (1 + (bw.margin || 0));
                unlockedCopies(n.name).forEach(function (l) {
                    const p = util.weaponPower(n.name, l, cls);
                    if (p > bar) out.push({ fighter: f, name: n.name, level: l, power: p, slot: hand.slot, mat: mat });
                });
            });
            return out;
        }
        return { mat: mat, items: items, goalState: goalState, deferred: deferred, protects: protects, wantsOffer: wantsOffer, stepLevel: stepLevel, candidates: candidates,
            deliver: deliver, work: work, report: report, forget: forget, buysCopies: !!mc.buyCopies };
    }
    function allMaterials() {
        if (!mgOn()) return [];
        return Object.keys(wks.MG.materials || {}).filter(function (m) { return G.items[m]; }).map(function (m) {
            return wks.materials[m] = wks.materials[m] || makeMaterial(m);
        });
    }
    // Every weapon made from a material (any of them).
    function materialItems() {
        return allMaterials().reduce(function (acc, m) { return acc.concat(m.items()); }, []);
    }
    // Made from a material whose copies are not bought as bases (fire weapons: essence only).
    function materialOnlyItems() {
        return allMaterials().filter(function (m) { return !m.buysCopies; }).reduce(function (acc, m) { return acc.concat(m.items()); }, []);
    }
    function materialDeferred(name) { return allMaterials().some(function (m) { return m.deferred(name); }); }
    function materialProtects(name) { return allMaterials().some(function (m) { return m.protects(name); }); }
    function materialOffer(it, price) {
        for (const m of allMaterials()) { const r = m.wantsOffer(it, price); if (r) return { kind: r, mat: m.mat }; }
        return null;
    }
    // "goal" materials deliver on their own; "better" ones together: per fighter the strongest held copy
    // of all materials that beats the weaker worn weapon (a sword +6 wins over a fireblade +3 even though
    // the fire goal comes first), one weapon at a time.
    function deliverMaterialGoals() {
        const ms = allMaterials();
        ms.forEach(function (m) { m.deliver(); });
        const best = {};
        ms.forEach(function (m) {
            m.candidates().forEach(function (c) {
                if (!best[c.fighter] || c.power > best[c.fighter].power) best[c.fighter] = c;
            });
        });
        Object.keys(best).forEach(function (f) {
            const c = best[f];
            if (wks.earmarks[f + "|" + c.name]) return;
            if (wks.activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) return;
            if (Date.now() - (wks.filledAt[f + "|weapon"] || 0) < 10 * 60 * 1000) return;
            wks.earmark(f, c.name, c.level);
            util.log("workshop", c.name + " +" + c.level + " goes to " + f + " (" + c.slot + ", " + c.mat + " goal: strongest copy that beats the worn weapon)", "yellow");
        });
    }
    async function workOnMaterialGoals() {
        for (const m of allMaterials()) { if (await m.work()) return true; }
        return false;
    }
    function materialReport() { return allMaterials().map(function (m) { return m.report(); }).join(""); }
    // The pot a "ladder" material run pays from: the weapon ladder's, or - when that is empty and
    // materialGoals.borrowFrom is "goals" - the gear goals' pot while every gear goal is done or has its
    // finished copy waiting for delivery (their money would only lie idle).
    function gearGoalsIdle() {
        if (!wks.goalsOn()) return true;
        const needs = wks.goalNeedsAll();
        const assigned = wks.goalAssignments(needs);
        return needs.every(function (n) { return assigned.some(function (a) { return a.need === n; }); });
    }
    function ladderOrGoals() {
        if (wks.MG.borrowFrom !== "goals" || wks.ladderBudget().allowed >= 250000) return wks.LADDER;
        if (!gearGoalsIdle() || wks.goalBudget().allowed < 250000) return wks.LADDER;
        if (Date.now() - wks.lastBorrowLog > 30 * 60 * 1000) {
            wks.lastBorrowLog = Date.now();
            util.log("workshop", "material goals pay from the gear goals' pot (ladder pot empty, gear goals idle)", "yellow");
        }
        return wks.GOALS;
    }

    function unlockedCopies(name) {
        const list = [];
        character.items.forEach(function (i) { if (i && i.name === name && !i.l && !i.p) list.push(i.level || 0); });
        (wks.bankSnapshot ? wks.bankSnapshot.items : []).forEach(function (b) { if (b.name === name) list.push(b.level); });
        return list;
    }

    // +0 copies still missing for name +level: three of a level make one of the next.
    function copiesMissing(name, level) {
        const compound = !!(G.items[name] && G.items[name].compound);
        const levels = unlockedCopies(name);
        if (!compound) return levels.length ? 0 : 1; // upgradeable: one base copy is enough
        const owned = levels.reduce(function (sum, l) { return sum + (l >= level ? Infinity : Math.pow(3, l)); }, 0);
        return Math.max(0, Math.pow(3, level) - owned);
    }

    function reportDrops() {
        const d = config.drops;
        if (!d || !d.enabled || !config.leader || Date.now() < wks.nextDropReportAt) return;
        // Counts include the bank: right after a restart, before the first bank scan,
        // everything would look missing (e.g. "50 armor boxes missing" with 130 banked).
        if (!wks.bankSnapshot) return;
        // ...and the fighters' wishes: unknown wishes would drop every shortage.
        // (solo: just the leader – the others are offline and never send wishes)
        const ph = (config.phases || {})[config.phase] || {};
        const active = ph.party && ph.party.length ? ph.party : [config.leader];
        if (active.some(function (f) { return !wks.wishes[f]; })) return;
        wks.nextDropReportAt = Date.now() + d.reportMs;
        const list = [];
        Object.keys(wks.shortages).forEach(function (name) {
            const s = wks.shortages[name];
            const target = s.forItem || name; // ingredients count while the crafted item is wished
            if (wks.heldBoxFor(name)) return; // opened from our own boxes, not farmed
            const wished = wks.fighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === target; }); }) ||
                wks.weaponPlans().some(function (p) { return p.name === target; }); // e.g. Bones for a Dead weapon
            // Reported as long as it is wished and copies are missing – not only for a while
            // after the last failed attempt (that made the team hop between farm spots).
            const fresh = wished;
            const missing = !fresh ? 0 : s.need ? s.need - wks.ingredientCount(name, s.level) : copiesMissing(name, s.level);
            if (missing > 0) list.push({ name: name, copies: missing });
            else { delete wks.shortages[name]; wks.saveShortages(); }
        });
        (d.want || []).forEach(function (w) {
            // Stackable items (e.g. Armor Boxes) count by quantity, not by stacks.
            const have = wks.stackable(w.name) ? wks.ingredientCount(w.name, 0) : unlockedCopies(w.name).length;
            const missing = (w.copies || 1) - have;
            if (G.items[w.name] && missing > 0 && !list.some(function (x) { return x.name === w.name; })) list.push({ name: w.name, copies: missing });
        });
        comms.send(config.leader, "drops", { list: list });
    }

    // Items sold into players' buy orders by level (market.sellTo, player decision 2026-11-20 -
    // Vitality earrings: +0 sold while someone pays, else compounded to +2 for stock): a level
    // with its own rule is held while a buyer at minPrice was seen in the last demandHours
    // (merchant: bot_sell_demand), and nothing goes past the highest level we sell. Levels in
    // between (+1) are compounded on.
    function heldForBuyers(name, level) {
        const rules = ((((config.market || {}).sellTo || {}).items) || []).filter(function (r) { return r.item === name; });
        if (!rules.length) return false;
        const top = Math.max.apply(null, rules.map(function (r) { return r.level || 0; }));
        if (level >= top) return true;
        const rule = rules.find(function (r) { return (r.level || 0) === level; });
        if (!rule) return false;
        let seen = {};
        try { seen = get("bot_sell_demand") || {}; } catch (e) { /* storage unavailable */ }
        const last = seen[name + ":" + level] || seen._since;
        if (!last) return true; // no scan yet: hold
        return Date.now() - last < (rule.demandHours || 3) * 60 * 60 * 1000;
    }

    // Combine spare accessories/books up to autoUpTo - without open wishes, and also while
    // wishes are open (with a tight bank, and with the gear-goal steps every gearGoals.everyMs).
    // Keeps the bank tidy (3 -> 1) and prepares stronger copies for later.
    async function autoCompound() {
        if (!cfg.compound.auto) return false;
        const counts = {};
        const add = function (name, level) {
            const def = G.items[name];
            if (!def || !def.compound || level >= cfg.compound.autoUpTo) return;
            const id = name + ":" + level;
            counts[id] = (counts[id] || 0) + 1;
        };
        character.items.forEach(function (i) { if (i && !i.l && !i.p) add(i.name, i.level || 0); });
        (wks.bankSnapshot ? wks.bankSnapshot.items : []).forEach(function (b) { add(b.name, b.level); });

        const now = Date.now();
        // compound.keep (player decision 2026-11-18): copies of "name:level" held back from auto
        // compounding, e.g. DEX belts +2 (ranger, Knife Belt for the rogue) - with keep 2 the
        // first try at +3 needs five spare copies.
        const keep = cfg.compound.keep || {};
        const id = Object.keys(counts).find(function (x) {
            const p = x.split(":");
            return counts[x] - (keep[x] || 0) >= 3 && !(wks.blockedUntil["auto:" + x] > now) && !heldForBuyers(p[0], Number(p[1]));
        });
        if (!id) return false;
        const parts = id.split(":");
        const k = "auto:" + id;
        util.status("compounding " + parts[0] + " +" + parts[1], "orange");
        try {
            await wks.compoundStep(k, parts[0], Number(parts[1]));
        } catch (e) {
            util.log("workshop", "auto compound " + parts[0] + " +" + parts[1] + ": " + util.errReason(e), "orange");
            wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, util.errReason(e));
        }
        return true;
    }

    Object.assign(wks, {
        mgOn: mgOn,
        fighterClass: fighterClass,
        onDismantleList: onDismantleList,
        makeMaterial: makeMaterial,
        allMaterials: allMaterials,
        materialItems: materialItems,
        materialOnlyItems: materialOnlyItems,
        materialDeferred: materialDeferred,
        materialProtects: materialProtects,
        materialOffer: materialOffer,
        deliverMaterialGoals: deliverMaterialGoals,
        workOnMaterialGoals: workOnMaterialGoals,
        materialReport: materialReport,
        gearGoalsIdle: gearGoalsIdle,
        ladderOrGoals: ladderOrGoals,
        unlockedCopies: unlockedCopies,
        copiesMissing: copiesMissing,
        reportDrops: reportDrops,
        heldForBuyers: heldForBuyers,
        autoCompound: autoCompound,
    });
};
