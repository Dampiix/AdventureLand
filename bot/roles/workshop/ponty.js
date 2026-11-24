// =====================================================================
// roles/workshop/ponty.js - Ponty and other players' stands: buying wished items and finds.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // Weapon types a fighter really uses (player decision 2026-11-20): the ones its class's gear
    // plan names (config.gearPlan.classes, every mode and hand) plus what it wears now. The game
    // lets a warrior hold a bow, so two bows from Ponty were bought "for" the dual-wielding
    // warrior (776k, 2026-11-20). null: no plan for the class - no limit.
    function usedWeaponTypes(f, cls) {
        const pc = config.gearPlan && config.gearPlan.classes && config.gearPlan.classes[cls];
        if (!pc || !pc.modes) return null;
        const out = {};
        const add = function (name) { const d = name && G.items[name]; if (d && d.type === "weapon" && d.wtype) out[d.wtype] = true; };
        Object.keys(pc.modes).forEach(function (m) {
            ["mainhand", "offhand"].forEach(function (s) { (pc.modes[m][s] || []).forEach(function (e) { add(Array.isArray(e) ? e[0] : e); }); });
        });
        ["mainhand", "offhand"].forEach(function (s) { const w = (wks.worn[f] || {})[s]; if (w) add(w.name); });
        return Object.keys(out).length ? out : null;
    }
    // % more power for fighter f if item (assumed with f's main-stat scroll when it takes one)
    // replaces the weakest worn piece of its slot type; null when f can't use it.
    function gainFor(f, item) {
        const v = wks.fighterValues[f], b = v && v.base, def = G.items[item.name];
        if (!b || !def || Date.now() - v.at > 60 * 60 * 1000) return null;
        const cls = wks.fighterClass(f);
        if (def.class && !def.class.includes(cls)) return null;
        if (def.type === "weapon" && !util.weaponPower(item.name, item.level || 0, cls)) return null;
        if (def.type === "weapon") {
            const used = usedWeaponTypes(f, cls);
            if (used && !used[def.wtype]) return null;
        }
        const slots = wks.SLOTS_BY_TYPE[def.type] || [];
        if (!slots.length) return null;
        const props = function (it) {
            if (!it) return {};
            const x = { name: it.name, level: it.level || 0 };
            const st = it.stat || it.stat_type || (G.items[it.name] && G.items[it.name].stat ? b.stat : null);
            if (st) x.stat_type = st;
            try { return calculate_item_properties(x) || {}; } catch (e) { return {}; }
        };
        const parts = function (p) { return { stat: p[b.stat] || 0, atk: p.attack || 0, freq: (p.frequency || 0) / 100 + (p.dex || 0) / 640 + (p.int || 0) / 1575 }; };
        const pn = parts(props(item));
        // A two-handed weapon takes the offhand too (player decision 2026-11-20): it is weighed
        // against both hands together, an offhand weapon's attack at 0.7 as below.
        if (def.type === "weapon" && util.isDoublehand(item.name, cls)) {
            const pm = parts(props((wks.worn[f] || {}).mainhand)), po = parts(props((wks.worn[f] || {}).offhand));
            const g2 = (pn.stat - pm.stat - po.stat) / b.mainVal + (pn.atk - pm.atk - po.atk * 0.7) / Math.max(5, b.atk) + (pn.freq - pm.freq - po.freq) / b.freq;
            return g2 * 100;
        }
        let best = null;
        slots.forEach(function (s) {
            const pw = parts(props((wks.worn[f] || {})[s]));
            const g = (pn.stat - pw.stat) / b.mainVal + (pn.atk - pw.atk) * (s === "offhand" ? 0.7 : 1) / Math.max(5, b.atk) + (pn.freq - pw.freq) / b.freq;
            if (best === null || g > best) best = g;
        });
        return best === null ? null : best * 100;
    }
    // Stat scrolls a piece needs: 1, 10 or 100 by its grade (the merchant adds the main stat).
    function statScrollCost(item, stat) {
        const def = G.items[item.name];
        if (!def || !def.stat || !stat) return 0;
        const s = G.items[stat + "scroll"];
        let grade = 0;
        try { grade = item_grade(item); } catch (e) { /* unknown */ }
        return s ? (s.g || 0) * Math.pow(10, grade) : 0;
    }
    function noteBought(entry) {
        try { const old = get(wks.BOUGHT_KEY) || []; set(wks.BOUGHT_KEY, old.concat([Object.assign({ t: Date.now(), at: new Date().toISOString() }, entry)]).slice(-200)); } catch (e) { /* storage unavailable */ }
    }
    function wornLevel(name) {
        let best = -1;
        Object.keys(wks.worn).forEach(function (f) {
            Object.keys(wks.worn[f] || {}).forEach(function (s) { const w = wks.worn[f][s]; if (w && w.name === name) best = Math.max(best, w.level || 0); });
        });
        return best;
    }
    // Weapon list items worth buying bases for (gearPlan.weapons, 2026-11-21): every non-shop, non-essence
    // item of a fighter's list that beats its weaker worn weapon at the item's cap - { name, level, count }
    // (count: the fighter's weapon hands).
    function listWants() {
        const lists = (config.gearPlan && config.gearPlan.weapons) || {};
        const material = wks.materialOnlyItems(); // fire weapons: made from essence, not bought as bases
        const out = [];
        wks.activeTeam().forEach(function (f) {
            const list = lists[wks.classes[f]];
            if (!list || !wks.worn[f]) return;
            const eq = wks.worn[f];
            const hands = eq.offhand && G.items[eq.offhand.name] && G.items[eq.offhand.name].type === "weapon" ? 2 : 1;
            const bar = wks.weakerHand(f).power;
            list.forEach(function (name, i) {
                if (!G.items[name] || wks.sellerOf(name) || material.includes(name) || !wks.canWield(f, name)) return;
                if (util.weaponPower(name, wks.weaponCap(name), wks.classes[f]) <= bar) return;
                out.push({ name: name, level: wks.weaponCap(name), count: hands, prio: list.length - i });
            });
        });
        return out;
    }
    function pontyWants() {
        const wants = {};
        const add = function (name, level) { if (G.items[name]) wants[name] = Math.max(wants[name] || 0, level || 0); };
        wks.fighters().forEach(function (f) { wks.wishList(f).forEach(function (w) { add(w.name, w.level); }); });
        if (wks.goalsOn()) wks.goalNeedsAll().forEach(function (n) { add(n.name, n.level); });
        listWants().forEach(function (x) { add(x.name, x.level); });
        return wants;
    }
    // Copies the wishes ask for, per item (wish count summed over the fighters; goals count one).
    function pontyCounts() {
        const counts = {};
        wks.fighters().forEach(function (f) { wks.wishList(f).forEach(function (w) { counts[w.name] = (counts[w.name] || 0) + (w.count || 1); }); });
        if (wks.goalsOn()) wks.goalNeedsAll().forEach(function (n) { counts[n.name] = Math.max(counts[n.name] || 0, 1); });
        listWants().forEach(function (x) { counts[x.name] = Math.max(counts[x.name] || 0, x.count); });
        return counts;
    }
    // Levels of every copy we hold: worn by any fighter, in the bag or in the bank.
    function allCopyLevels(name) {
        return wks.unlockedCopies(name).concat(wornLevelsOf(name));
    }
    function wornLevelsOf(name) {
        const levels = [];
        Object.keys(wks.worn).forEach(function (f) {
            Object.keys(wks.worn[f] || {}).forEach(function (s) { const w = wks.worn[f][s]; if (w && w.name === name) levels.push(w.level || 0); });
        });
        return levels;
    }
    // A wished item no NPC sells (a drop): a copy below the target is the base we upgrade or
    // compound, so Ponty's lower levels are worth buying too (player decision 2026-11-19).
    //  - upgradeable: while we hold fewer copies than wished (any level), any level below the
    //    target; with enough copies only one above our weakest copy below the target;
    //  - compound: while the target level still lacks copies (three of a level make the next),
    //    a copy that doesn't overshoot what is missing.
    // stock: copies in the bag and bank (plus bought on this visit). Worn copies only count as finished
    // pieces (at the target): they are not upgraded - a fighter only swaps them for a better one (player
    // decision 2026-11-21: the warrior's worn Swords of the Dead +6/+5 counted as bases).
    function wantsAsBase(name, lvl, target, count, stock) {
        const wornLv = wornLevelsOf(name);
        const levels = stock.concat(wornLv);
        if (lvl >= target) return lvl > levels.reduce(function (m, l) { return Math.max(m, l); }, -1);
        if (G.items[name].compound) {
            const owned = levels.reduce(function (sum, l) { return sum + Math.pow(3, Math.min(l, target)); }, 0);
            return Math.pow(3, lvl) <= count * Math.pow(3, target) - owned;
        }
        const done = levels.filter(function (l) { return l >= target; }).length;
        if (done >= count) return false;
        if (stock.length < count - done) return true;
        const below = stock.filter(function (l) { return l < target; });
        if (below.length > 0 && lvl > Math.min.apply(null, below)) return true;
        // Enough bases for the failed upgrades on the way (player decision 2026-11-21): the copies we hold
        // count by their chance to reach the target (a +6 Rugged piece ~24-30 %, a +0 ~3-8 %), and we buy
        // until those chances add up to workshop.baseTargetPieces finished pieces per missing one - at
        // most workshop.maxBaseCopies copies (bank room). Was: every copy counted as one +0.
        const expected = below.reduce(function (sum, l) { return sum + reachChance(name, l, target); }, 0);
        return expected < (count - done) * (cfg.baseTargetPieces || 1) && below.length < (cfg.maxBaseCopies || 20);
    }
    // Chance that one copy of name +from gets to +target, with the scroll the workshop would choose per
    // step (same choice as upgradeCost). Cached for a minute per name.
    function reachChance(name, from, target) {
        let c = wks.reachCache[name];
        if (!c || Date.now() - c.at > 60 * 1000 || c.target !== target) {
            const memo = {}, steps = {};
            for (let l = 1; l <= target; l++) steps[l] = wks.bestScroll(name, l - 1, false, null, wks.copyValue(name, l - 1, memo)).p || 0.05;
            c = wks.reachCache[name] = { at: Date.now(), target: target, steps: steps };
        }
        let p = 1;
        for (let l = from + 1; l <= target; l++) p *= c.steps[l];
        return p;
    }
    // Gold of one craft's ingredients (2026-11-21): an NPC sells it - its price; else our standing
    // market.buy price; else unknown (Infinity). The craft cost alone was 0 for the Wanderer's set, so
    // Ponty's +0 copies (8k-29k) were always "dearer than making it" and skipped without a word -
    // making a Wanderer's Attire takes 100 slime + 200 crab claws (~78k at our buy prices).
    function craftIngredientGold(name) {
        const recipe = (G.craft[name] && G.craft[name].items) || [];
        const orders = (config.market && config.market.buy) || [];
        return recipe.reduce(function (sum, it) {
            const q = it[0], n = it[1];
            if (wks.sellerOf(n)) return sum + q * (G.items[n].g || 0);
            const o = orders.find(function (b) { return b.item === n && !(b.level > 0); });
            return o ? sum + q * o.price : Infinity;
        }, 0);
    }
    // Gold our own way to name +level would cost (Infinity: needs drops we can't time or price).
    // Drop hours count at the opportunity cost (player decision 2026-11-20): the team gold per
    // hour we give up on the drop spot against the spot we really farm (leader, dropCosts) -
    // 0 when the drop spot pays as well. Was our whole gold/hour of the last 24 h, which a
    // 45M token sale inflated to ~2M/h (orbg buy order at 9.9M).
    function ownCost(name, level) {
        const def = G.items[name];
        const c = def.compound ? wks.compoundCost(name, level) : wks.upgradeCost(name, level);
        let gold = c.gold;
        if (c.crafts > 0.01) gold += c.crafts * craftIngredientGold(name);
        if (c.copies > 0.01) {
            const t = wks.dropTimes[name], h = wks.dropCosts[name];
            if (t && typeof h === "number" && farmable(name)) gold += c.copies * t / 3600 * h;
            else { if (!t || typeof h !== "number") wks.costAsk[name] = true; gold = Infinity; }
        }
        return gold;
    }
    // A drop we can farm in useful time: at most dropNeverHours per copy (player decision
    // 2026-11-20). Orange Lollipops "dropped" every 48 billion s (a stray global drop) on the spot
    // we farm anyway - 0 gold/h lost, so the copies counted as free and a +7 buy order went up at
    // 280k (we paid 1M per +0 copy). Beyond the limit the cost is unknown: no order at own cost,
    // Ponty and player buys stay capped by the pot share.
    function farmable(name) {
        const t = wks.dropTimes[name];
        return !!t && t <= (cfg.dropNeverHours || 1000) * 3600;
    }
    // A filled wish buy order (player decision 2026-11-20): paid from the gear pot like a Ponty
    // purchase. Before, the gold just left the stand and counted as consumables, so the gear
    // pot never saw it.
    function bookWishFill(name, level, price, n) {
        const total = price * (n || 1);
        wks.pay(wks.GOALS, total);
        util.log("workshop", "bought " + (n > 1 ? n + "x " : "") + name + " +" + level + " via buy order for " + Math.round(total / 1000) + "k (gear pot)", "green");
        noteBought({ kind: "order", item: name + " +" + level, price: total, q: n || 1 });
    }
    // No copy at that level or higher held or worn yet.
    function needsCopy(name, level) {
        return !wks.copyAtLeast(name, level) && wornLevel(name) < level;
    }
    // Buy orders for what we wish (player idea 2026-11-19, market.wishOrders): one copy of every
    // wished item / gear goal at its level, priced at our own expected cost - not for plain NPC
    // stock (+0 shop items). Funded and within the pot share; gone once we have such a copy.
    function wishBuyOrders() {
        const wo = (config.market && config.market.wishOrders) || {};
        if (!wo.enabled || !wks.bankSnapshot) return [];
        const wants = pontyWants();
        const cap = wks.goalBudget().allowed * (wo.maxShareOfPot || 0.5);
        const out = [];
        Object.keys(wants).forEach(function (name) {
            const level = wants[name];
            const def = G.items[name];
            if (!def || (wks.sellerOf(name) && level === 0) || !needsCopy(name, level)) return;
            const own = ownCost(name, level) * (wo.priceShare || 1);
            if (!isFinite(own) || own < (wo.minPrice || 1000)) return;
            // Two significant digits: the estimate moves with every compound and drop.
            const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(own)) - 1));
            const price = Math.round(own / p) * p;
            if (price > cap || price > character.gold) return;
            out.push({ item: name, level: level, price: price, want: 1, dynamic: true });
        });
        return out.slice(0, wo.max || 8);
    }
    // Paid from the gear pot (gearGoals budget) since 2026-11-19 (player decision): buying replaces
    // building, so both come out of one pot; at most ponty.maxShareOfPot of it per purchase.
    // force: a Ponty round visit (merchantRole.pontyRound) - no timer, and it reports what it saw.
    async function shopPonty(force) {
        const pc = (config.market && config.market.ponty) || {};
        if (!pc.enabled || (!force && Date.now() < wks.nextPontyAt) || character.esize < 3 || !wks.bankSnapshot) return false;
        wks.nextPontyAt = Date.now() + (pc.everyMs || 20 * 60 * 1000);
        wks.lastPontyVisit = { items: 0, bought: 0 };
        const wants = pontyWants();
        // Finds are reported even with an empty pot (player wants to see what would be worth it).
        if ((!Object.keys(wants).length || !wks.canSpend(wks.GOALS, 1)) && !pc.reportFinds) return false;
        util.status("checking Ponty", "yellow");
        await wks.goTo("secondhands");
        let list = [];
        try { list = ((await get_secondhands()) || {}).items || []; } catch (e) {
            util.log("workshop", "Ponty: " + util.errReason(e), "orange");
            return true;
        }
        let bought = 0, bagFull = false;
        const tooDear = {}; // one log line per visit: "name +level" -> price
        // Finds outside the wish list (player decision 2026-11-19: reported only for now): a piece
        // that makes an active fighter stronger, rated by % power per gold against our best own
        // upgrade per gold. Main-stat scrolls are counted in.
        if (pc.reportFinds) {
            const finds = [];
            list.forEach(function (it) {
                if (!it || wants.hasOwnProperty(it.name) || it.p === "glitched" || !G.items[it.name]) return;
                let price = 0;
                try { price = calculate_item_value(it) * (G.items[it.name].cash ? 3 : 2) * (it.q || 1); } catch (e) { return; }
                Object.keys(wks.fighterValues).forEach(function (f) {
                    const g = gainFor(f, it);
                    if (!(g > (pc.findMinGain || 0.5))) return;
                    const b = wks.fighterValues[f].base || {};
                    const cost = price + (it.stat_type === b.stat ? 0 : statScrollCost(it, b.stat));
                    const perM = g / Math.max(1, cost) * 1e6;
                    finds.push({ it: it, stat: G.items[it.name].stat && it.stat_type !== b.stat ? b.stat : null, listPrice: price, t: Date.now(), fighter: f, item: it.name + " +" + (it.level || 0), price: Math.round(cost), gain: Math.round(g * 100) / 100,
                        perM: Math.round(perM * 100) / 100, oursPerM: Math.round(wks.bestPerGold * 1e6 * 100) / 100, better: wks.bestPerGold > 0 && g / cost >= wks.bestPerGold });
                });
            });
            finds.sort(function (a, b) { return b.perM - a.perM; });
            finds.slice(0, 3).forEach(function (x) {
                util.log("workshop", "Ponty find: " + x.item + " for " + Math.round(x.price / 1000) + "k -> " + x.fighter + " +" + x.gain + "% (" + x.perM + "%/M, our best upgrade " + (x.oursPerM || "?") + "%/M)" + (x.better ? " - worth it" : ""), x.better ? "yellow" : "white");
            });
            if (finds.length) {
                try { const old = get(wks.FINDS_KEY) || []; set(wks.FINDS_KEY, old.concat(finds.slice(0, 5).map(function (x) { return Object.assign({}, x, { it: undefined }); })).slice(-60)); } catch (e) { /* storage unavailable */ }
            }
            // buyFinds (player decision 2026-11-19): the best find worth it is bought too - within the
            // pot share per purchase - gets the fighter's main-stat scroll and goes to that fighter.
            const pick = pc.buyFinds && finds.find(function (x) {
                return x.better && x.price <= wks.goalBudget().allowed * (pc.maxShareOfPot || 1) && wks.canSpend(wks.GOALS, x.price) && x.price <= character.gold;
            });
            if (pick && character.esize >= 2) {
                try {
                    await buy_secondhand(pick.it);
                    wks.pay(wks.GOALS, pick.listPrice);
                    const lvl = pick.it.level || 0;
                    util.log("workshop", "bought " + pick.item + " at Ponty for " + Math.round(pick.listPrice / 1000) + "k for " + pick.fighter + " (+" + pick.gain + "%)", "green");
                    noteBought({ kind: "find", item: pick.item, price: pick.listPrice, fighter: pick.fighter, gain: pick.gain, perM: pick.perM, oursPerM: pick.oursPerM });
                    if (pick.stat) {
                        const idx = util.findItemIndex(function (x) { return x.name === pick.it.name && (x.level || 0) === lvl && x.stat_type !== pick.stat && !x.l; });
                        if (idx !== -1) await wks.applyStat(idx, pick.stat, wks.GOALS);
                    }
                    wks.earmark(pick.fighter, pick.it.name, lvl, pick.stat);
                    bought++;
                } catch (e) {
                    util.log("workshop", "Ponty find " + pick.item + ": " + util.errReason(e), "orange");
                }
            }
        }
        const counts = pontyCounts();
        const boughtLevels = {}; // copies bought on this visit, before the bank snapshot knows them
        // Only the ones not in the bag yet (2026-11-22 review): unlockedCopies reads the bag live, so a bought
        // copy that already arrived counted twice and base buying stopped too early.
        const boughtBase = {}; // name -> unlocked bag copies before our first buy of it on this visit
        const bagUnlocked = function (name) { return character.items.filter(function (i) { return i && i.name === name && !i.l && !i.p; }).length; };
        const pendingBought = function (name) {
            const b = boughtLevels[name] || [];
            if (!b.length) return b;
            const arrived = Math.max(0, bagUnlocked(name) - (boughtBase[name] || 0));
            return b.slice(Math.min(arrived, b.length));
        };
        // Highest level first: of several bases on offer the best one is bought.
        const offers = list.slice().sort(function (a, b) { return ((b && b.level) || 0) - ((a && a.level) || 0); });
        for (const it of offers) {
            if (it && !wants.hasOwnProperty(it.name) && it.p !== "glitched" && G.items[it.name]) {
                let bp = 0;
                try { bp = calculate_item_value(it) * (G.items[it.name].cash ? 3 : 2) * (it.q || 1); } catch (e) { bp = Infinity; }
                const mo = wks.materialOffer(it, bp);
                if (mo && bp <= character.gold && wks.canSpend(wks.GOALS, bp) &&
                    !(pc.maxShareOfPot && bp > wks.goalBudget().allowed * pc.maxShareOfPot) && character.esize >= 2) {
                    try {
                        await buy_secondhand(it);
                        wks.pay(wks.GOALS, bp);
                        bought++;
                        util.log("workshop", "bought " + it.name + " +0 at Ponty for " + Math.round(bp / 1000) + "k (" + (mo.kind === "base" ? "craft base for a " + mo.mat + " goal" : "becomes " + mo.mat) + ")", "green");
                        noteBought({ kind: mo.kind === "base" ? "craft base" : mo.mat, item: it.name + " +0", price: bp });
                    } catch (e) {
                        util.log("workshop", "Ponty " + it.name + ": " + util.errReason(e), "orange");
                    }
                }
                continue;
            }
            if (!it || !wants.hasOwnProperty(it.name) || it.p === "glitched") continue;
            const lvl = it.level || 0;
            const levels = allCopyLevels(it.name).concat(pendingBought(it.name));
            if (wks.sellerOf(it.name)) {
                // Shop items: only a copy better than everything we hold (the +0 comes from the NPC).
                if (lvl <= levels.reduce(function (m, l) { return Math.max(m, l); }, -1)) continue;
            } else if (!wantsAsBase(it.name, lvl, wants[it.name], counts[it.name] || 1, wks.unlockedCopies(it.name).concat(pendingBought(it.name)))) continue;
            let price = 0;
            try { price = calculate_item_value(it) * (G.items[it.name].cash ? 3 : 2) * (it.q || 1); } catch (e) { continue; }
            if (pc.maxPrice && price > pc.maxPrice) continue;
            if (pc.maxShareOfPot && price > wks.goalBudget().allowed * pc.maxShareOfPot) { tooDear[it.name + " +" + lvl] = Math.round(price / 1000); continue; }
            const own = ownCost(it.name, lvl);
            if (price > own * (pc.maxShareOfOwn || 1)) continue;
            if (price > character.gold || !wks.canSpend(wks.GOALS, price)) {
                tooDear[it.name + " +" + lvl] = Math.round(price / 1000);
                continue;
            }
            if (character.esize < 2) { bagFull = true; break; }
            if (!(it.name in boughtBase)) boughtBase[it.name] = bagUnlocked(it.name);
            try {
                await buy_secondhand(it);
                wks.pay(wks.GOALS, price);
                bought++;
                (boughtLevels[it.name] = boughtLevels[it.name] || []).push(lvl);
                util.log("workshop", "bought " + it.name + " +" + lvl + " at Ponty for " + Math.round(price / 1000) + "k (" + (isFinite(own) ? "making it: ~" + Math.round(own / 1000) + "k" : "can't make it") + ")", "green");
                noteBought({ kind: "wish", item: it.name + " +" + lvl, price: price, own: isFinite(own) ? Math.round(own) : null });
            } catch (e) {
                util.log("workshop", "Ponty " + it.name + " +" + lvl + ": " + util.errReason(e), "orange");
            }
        }
        const dear = Object.keys(tooDear);
        if (dear.length) util.log("workshop", "Ponty, not in the gear pot (" + Math.round(wks.goalBudget().allowed / 1000) + "k): " + dear.map(function (n) { return n + " " + tooDear[n] + "k"; }).join(", "), "white");
        // full: the bag stopped the buying - the Ponty round banks and comes back (2026-11-21).
        wks.lastPontyVisit = { items: list.length, bought: bought, full: bagFull };
        return bought > 0;
    }

    // ---- other players' stands (player decision 2026-11-20) ----------------------------
    // What the merchant would buy at Ponty, offered on a player's stand anywhere: the same
    // rules (wishes and gear goals: a better copy or a useful base, at most maxShareOfOwn of our
    // own cost and maxShareOfPot of the gear pot; finds: gain per gold at least our best own
    // upgrade), at the seller's price. Finds that would need a main-stat scroll are left out
    // (no stop at the upgrade NPC on a trip). chars: the game's merchant list. Best first.
    function playerOffers(chars) {
        const pc = (config.market && config.market.ponty) || {};
        if (!pc.enabled || !wks.bankSnapshot) return [];
        const wants = pontyWants(), counts = pontyCounts();
        const allowed = wks.goalBudget().allowed;
        const out = [];
        // Price check across the market (player decision 2026-11-20): never pay more for a level
        // than some stand asks for a higher level of the same item - an INT Ring +2 went for 5.3M,
        // three minutes before a +3 for 3.8M.
        const offered = {}; // name -> [{ level, price }] of every open sell listing
        (chars || []).forEach(function (c) {
            if (!c || !c.slots || !c.stand) return;
            Object.keys(c.slots).forEach(function (s) {
                const it = c.slots[s];
                if (!it || it.b || !(it.price > 0) || it.giveaway || it.want) return;
                (offered[it.name] = offered[it.name] || []).push({ level: it.level || 0, price: it.price });
            });
        });
        const higherCheaper = function (name, lvl, price) {
            return (offered[name] || []).some(function (o) { return o.level > lvl && o.price <= price; });
        };
        (chars || []).forEach(function (c) {
            if (!c || !c.slots || !c.stand || c.name === character.name) return; // stand closed: away
            Object.keys(c.slots).forEach(function (s) {
                const it = c.slots[s];
                if (!it || it.b || !(it.price > 0) || it.giveaway || it.want || it.p === "glitched" || !G.items[it.name]) return;
                const lvl = it.level || 0, price = it.price;
                if (price > character.gold || higherCheaper(it.name, lvl, price)) return;
                if (wants.hasOwnProperty(it.name)) {
                    const levels = allCopyLevels(it.name);
                    if (wks.sellerOf(it.name)) {
                        if (lvl <= levels.reduce(function (m, l) { return Math.max(m, l); }, -1)) return;
                    } else if (!wantsAsBase(it.name, lvl, wants[it.name], counts[it.name] || 1, wks.unlockedCopies(it.name))) return;
                    if (pc.maxShareOfPot && price > allowed * pc.maxShareOfPot) return;
                    const own = ownCost(it.name, lvl);
                    if (price > own * (pc.maxShareOfOwn || 1) || !wks.canSpend(wks.GOALS, price)) return;
                    out.push({ char: c, slot: s, name: it.name, level: lvl, price: price, kind: "wish", own: isFinite(own) ? Math.round(own) : null, score: isFinite(own) ? price / own : 1 });
                    return;
                }
                if (!pc.buyFinds || !(wks.bestPerGold > 0)) return;
                Object.keys(wks.fighterValues).forEach(function (f) {
                    const b = wks.fighterValues[f].base || {};
                    if (G.items[it.name].stat && it.stat_type !== b.stat) return; // would need a stat scroll
                    const g = gainFor(f, it);
                    if (!(g > (pc.findMinGain || 0.5)) || g / price < wks.bestPerGold) return;
                    if (price > allowed * (pc.maxShareOfPot || 1) || !wks.canSpend(wks.GOALS, price)) return;
                    out.push({ char: c, slot: s, name: it.name, level: lvl, price: price, kind: "find", fighter: f, gain: Math.round(g * 100) / 100, score: 2 - Math.min(1, g / price / wks.bestPerGold / 10) });
                });
            });
        });
        // Wishes before finds; within each, the best deal (lowest share of our own cost) first.
        return out.sort(function (a, b) { return (a.kind === "wish" ? 0 : 1) - (b.kind === "wish" ? 0 : 1) || a.score - b.score; });
    }
    // Book a purchase from a player's stand: the gear pot pays, the list of buys notes it.
    function bookPlayerBuy(o) {
        wks.pay(wks.GOALS, o.price);
        noteBought({ kind: "player " + o.kind, item: o.name + " +" + o.level, price: o.price, seller: o.seller, server: o.server, fighter: o.fighter || null, own: o.own || null, gain: o.gain || null });
        if (o.kind === "find" && o.fighter) wks.earmark(o.fighter, o.name, o.level, null);
    }

    Object.assign(wks, {
        usedWeaponTypes: usedWeaponTypes,
        gainFor: gainFor,
        statScrollCost: statScrollCost,
        noteBought: noteBought,
        wornLevel: wornLevel,
        listWants: listWants,
        pontyWants: pontyWants,
        pontyCounts: pontyCounts,
        allCopyLevels: allCopyLevels,
        wornLevelsOf: wornLevelsOf,
        wantsAsBase: wantsAsBase,
        reachChance: reachChance,
        craftIngredientGold: craftIngredientGold,
        ownCost: ownCost,
        farmable: farmable,
        bookWishFill: bookWishFill,
        needsCopy: needsCopy,
        wishBuyOrders: wishBuyOrders,
        shopPonty: shopPonty,
        playerOffers: playerOffers,
        bookPlayerBuy: bookPlayerBuy,
    });
};
