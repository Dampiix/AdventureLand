// =====================================================================
// bot_workshop – the merchant fulfils the fighters' equipment wishes.
//
// Fighters send wishes ({ name, level }) taken from their progression
// guide. For each open wish, one at a time:
//   1. bag:     a copy at the wished level or higher is already here
//   2. bank:    a copy at that level or higher lies in the bank -> retrieve
//   3. develop: take the best lower copy (bag/bank) or buy a +0 copy from
//               an NPC, then upgrade it step by step at Cue
// Rules (config.workshop): only steps with a previewed success chance of at
// least the risk tier's chance (config.workshop.risk: cheap re-buyable items
// 40 %, mid-value 60 %, precious/irreplaceable 70 %; a higher scroll grade is
// tried when the normal one falls short), never spend below the gold reserve,
// at most budgetPerWish
// per wish, no offerings, no shells. Upgradeable items are upgraded step by
// step; compound items (rings, earrings, books, ...) are built from three
// matching copies per level out of bag and bank (copies can't be bought).
// Without open wishes, spare compound items are combined up to
// config.workshop.compound.autoUpTo (same chance/budget rules), spare copies
// are upgraded (config.workshop.stock), the fighters' worn gear is pushed to
// config.workshop.gearGoals.upTo with an income-based budget, then
// boxes/gems/seashells from config.workshop.exchange.items are exchanged.
// We only ever work on our own copies – worn gear is never risked.
// Finished items are handed over on the next delivery; the fighter gets a
// "ready" ping so it calls the merchant right away.
// =====================================================================

module.exports = function createWorkshop(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.workshop;

    const wishes = {};      // fighter -> [{ name, level }] from its progression guide
    const spent = {};       // wish key -> gold spent
    const blockedUntil = {}; // wish key -> timestamp (gave up for a while)
    const reachedOnly = {}; // wish key -> level we stopped at (too risky to go on) – delivered as is
    let graceSince = Date.now(); // start of the current 24 h grace budget window
    let bankSnapshot = null; // { at, items: [{ pack, index, name, level }] }

    // Delivered wishes are not fulfilled again for a while (survives restarts).
    const DELIVERED_KEY = "workshop_delivered";
    function loadDelivered() {
        try { return get(DELIVERED_KEY) || {}; } catch (e) { return {}; }
    }
    const delivered = loadDelivered(); // "fighter:name" -> timestamp
    function markDelivered(fighter, name) {
        delivered[fighter + ":" + name] = Date.now();
        try { set(DELIVERED_KEY, delivered); } catch (e) { /* storage unavailable – only this session remembers */ }
    }
    function recentlyDelivered(fighter, name) {
        return Date.now() - (delivered[fighter + ":" + name] || 0) < cfg.redeliverAfterMs;
    }

    // What each fighter wears (sent with its wishes; survives restarts) – for gear goals.
    const WORN_KEY = "workshop_worn";
    const worn = (function () {
        try { return get(WORN_KEY) || {}; } catch (e) { return {}; }
    })();

    comms.on("wishes", function (data, from) {
        wishes[from] = (data.list || []).filter(function (w) { return w && G.items[w.name]; });
        if (data.worn) {
            worn[from] = data.worn;
            try { set(WORN_KEY, worn); } catch (e) { /* storage unavailable */ }
        }
    });

    function key(fighter, w) { return fighter + ":" + w.name + ":" + w.level; }

    // Guide wishes plus fixed wishes from config.workshop.wishes, minus recent deliveries.
    function wishList(fighter) {
        const list = (wishes[fighter] || []).slice();
        ((cfg.wishes || {})[fighter] || []).forEach(function (w) {
            if (G.items[w.name] && !list.some(function (x) { return x.name === w.name && x.level >= w.level; })) list.push(w);
        });
        return list.filter(function (w) { return !recentlyDelivered(fighter, w.name); });
    }

    function fighters() {
        return Object.keys(Object.assign({}, wishes, cfg.wishes || {}));
    }

    // The level a wish is fulfilled at: the wished one, or where we had to stop.
    function targetLevel(fighter, w) {
        const r = reachedOnly[key(fighter, w)];
        return r !== undefined ? r : w.level;
    }

    function npcPos(id) {
        const npc = (G.maps.main.npcs || []).find(function (n) { return n.id === id; });
        return npc ? { map: "main", x: npc.position[0], y: npc.position[1] } : null;
    }

    async function goTo(npcId) {
        const p = npcPos(npcId);
        if (!p) throw { reason: "npc " + npcId + " not found" };
        if (character.map === "main" && util.distanceTo(p) < 100) return;
        await smart_move(p);
    }

    function bagIndex(name, minLevel) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== name || (item.level || 0) < minLevel) return;
            if (best === -1 || (item.level || 0) < (character.items[best].level || 0)) best = i; // smallest that satisfies
        });
        return best;
    }

    // Items reserved for a fighter must not be sold or banked.
    function isReserved(item) {
        return fighters().some(function (f) {
            return wishList(f).some(function (w) { return w.name === item.name; });
        });
    }

    // ---- delivery -------------------------------------------------------

    function readyFor(fighter) {
        return wishList(fighter).filter(function (w) { return bagIndex(w.name, targetLevel(fighter, w)) !== -1; });
    }

    async function handOver(fighter) {
        for (const w of readyFor(fighter)) {
            const index = bagIndex(w.name, targetLevel(fighter, w));
            if (index === -1) continue;
            const item = character.items[index];
            await send_item(fighter, index, 1);
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter, "green");
            markDelivered(fighter, w.name);
            wishes[fighter] = (wishes[fighter] || []).filter(function (x) { return x !== w; });
        }
        // Finished gear-goal copies (indexes stay valid: sending only empties a slot).
        for (const a of goalReadyFor(fighter)) {
            const item = character.items[a.index];
            if (!item || item.name !== a.need.name) continue;
            await send_item(fighter, a.index, 1);
            goalSentAt[fighter + ":" + a.need.slot] = Date.now();
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter + " (gear goal)", "green");
        }
    }

    // ---- bank -------------------------------------------------------------

    function readBank() {
        const items = [];
        Object.keys(character.bank || {}).forEach(function (pack) {
            if (!/^items\d+$/.test(pack)) return;
            (character.bank[pack] || []).forEach(function (item, index) {
                if (item) items.push({ pack: pack, index: index, name: item.name, level: item.level || 0, q: item.q || 1 });
            });
        });
        const packs = Object.keys(character.bank || {}).filter(function (p) { return /^items\d+$/.test(p); });
        const capacity = packs.reduce(function (sum, p) { return sum + (character.bank[p] || []).length; }, 0);
        bankSnapshot = { at: Date.now(), items: items, free: capacity - items.length };
    }

    function bankFind(name, filter) {
        if (!bankSnapshot) return null;
        return bankSnapshot.items.filter(function (b) { return b.name === name && filter(b.level); })
            .sort(function (a, b) { return b.level - a.level; })[0] || null;
    }

    async function retrieve(entry) {
        if (character.esize < 1) throw { reason: "bag full" };
        await smart_move("bank");
        readBank();
        const fresh = bankSnapshot.items.find(function (b) { return b.pack === entry.pack && b.index === entry.index && b.name === entry.name; });
        if (!fresh) throw { reason: entry.name + " moved in the bank" };
        await bank_retrieve(entry.pack, entry.index);
        util.log("workshop", "took " + entry.name + (entry.q > 1 ? " x" + entry.q : " +" + entry.level) + " from the bank", "green");
        readBank();
    }

    // ---- develop ----------------------------------------------------------

    // Budget per key: wishes use budgetPerWish, grace keys ("grace:<level>") their own.
    function budgetFor(k) {
        return k.indexOf("grace:") === 0 ? cfg.grace.budgetPerLevel : cfg.budgetPerWish;
    }

    function canSpend(k, amount) {
        if (character.gold - amount < util.goldAmount(config.merchantRole.goldReserve)) return false;
        if (k === GOALS) return goalBudget().allowed >= amount;
        return (spent[k] || 0) + amount <= budgetFor(k);
    }

    function pay(k, amount) {
        if (k === GOALS) {
            income.spends.push({ t: Date.now(), a: amount });
            income.total += amount;
            saveIncome();
            return;
        }
        spent[k] = (spent[k] || 0) + amount;
        if (k.indexOf("grace:") === 0) saveGraceSpent();
    }

    // ---- income-based budget for gear goals ---------------------------------
    //
    // The merchant's gold is sampled every 10 minutes; one sample older than 24 h
    // stays as the baseline. Net income = gold now - baseline gold + what the gear
    // goals spent since then (their own spending is not a loss of income). Gear
    // goals may spend incomeShare of that, minus what they already spent – so the
    // daily budget follows what the team currently earns.
    const GOALS = "goals"; // budget key of the gear goals
    const INCOME_KEY = "workshop_income";
    const DAY = 24 * 60 * 60 * 1000;
    const income = (function () {
        try {
            const saved = get(INCOME_KEY);
            if (saved && Array.isArray(saved.samples) && Array.isArray(saved.spends)) return saved;
        } catch (e) { /* storage unavailable */ }
        return { samples: [], spends: [], total: 0 };
    })();
    function saveIncome() {
        try { set(INCOME_KEY, income); } catch (e) { /* storage unavailable */ }
    }

    function sampleIncome() {
        const now = Date.now();
        const last = income.samples[income.samples.length - 1];
        if (last && now - last.t < 10 * 60 * 1000) return;
        income.samples.push({ t: now, gold: character.gold });
        while (income.samples.length > 2 && now - income.samples[1].t >= DAY) income.samples.shift();
        const since = income.samples[0].t;
        income.spends = income.spends.filter(function (s) { return s.t >= since; });
        saveIncome();
    }

    function goalBudget() {
        const b = cfg.gearGoals.budget;
        if (!income.samples.length) return { allowed: 0, earned: 0, spent: 0, hours: 0 };
        const base = income.samples[0];
        const spentInWindow = income.spends.reduce(function (sum, s) { return sum + s.a; }, 0);
        const earned = character.gold - base.gold + spentInWindow;
        const allowed = Math.min(Math.max(0, earned * b.incomeShare - spentInWindow), Math.max(0, b.total - income.total));
        return { allowed: allowed, earned: earned, spent: spentInWindow, hours: (Date.now() - base.t) / 3600000 };
    }

    // Grace spending survives restarts and resets after 24 h.
    const GRACE_KEY = "workshop_grace_spent";
    (function loadGraceSpent() {
        try {
            const saved = get(GRACE_KEY) || {};
            if (saved.since && Date.now() - saved.since < 24 * 60 * 60 * 1000) {
                Object.keys(saved.spent || {}).forEach(function (k) { spent[k] = saved.spent[k]; });
                graceSince = saved.since;
            }
        } catch (e) { /* storage unavailable */ }
    })();
    function saveGraceSpent() {
        const graceSpent = {};
        Object.keys(spent).forEach(function (k) { if (k.indexOf("grace:") === 0) graceSpent[k] = spent[k]; });
        try { set(GRACE_KEY, { since: graceSince, spent: graceSpent }); } catch (e) { /* storage unavailable */ }
    }

    function sellerOf(name) {
        const id = Object.keys(G.npcs).find(function (n) {
            return Array.isArray(G.npcs[n].items) && G.npcs[n].items.includes(name) && npcPos(n);
        });
        return id || null;
    }

    // Make sure a scroll is in the bag; buys enough for the remaining steps in one trip.
    async function ensureScroll(k, scroll, stepsLeft) {
        if (bagIndex(scroll, 0) !== -1) return;
        const price = G.items[scroll].g;
        let amount = Math.max(1, stepsLeft);
        while (amount > 1 && !canSpend(k, price * amount)) amount--;
        if (!canSpend(k, price * amount)) throw { reason: "budget" };
        await goTo("scrolls");
        await buy(scroll, amount);
        pay(k, price * amount);
    }

    // ---- risk -------------------------------------------------------------------

    // Minimum success chance for risking `item` (`copies` of it, 3 for compounds).
    // Cheap, re-buyable things may fail more often; irreplaceable ones may not.
    function minChanceFor(item, replaceable, copies) {
        const r = cfg.risk;
        let value;
        try { value = item_value(item) * (copies || 1); } catch (e) { value = Infinity; }
        if (!replaceable) value = Math.max(value, r.midBelow);
        if (value < r.cheapBelow) return r.cheap;
        if (value < r.midBelow) return r.mid;
        return r.precious;
    }

    function pct(x) { return Math.round(x * 100) + "%"; }

    // The normal scroll is not good enough: try higher scroll grades (owned, banked,
    // or bought within the wish budget) until the preview reaches minChance.
    // preview(scrollIndex) -> chance. Returns { scroll, chance } or null.
    async function strongerScroll(k, prefix, grade, minChance, preview) {
        for (let g = grade + 1; g <= cfg.risk.maxScrollGrade; g++) {
            const name = prefix + g;
            if (!G.items[name]) continue;
            if (bagIndex(name, 0) === -1) {
                const banked = bankSnapshot && bankSnapshot.items.find(function (b) { return b.name === name; });
                const seller = sellerOf(name);
                if (banked) {
                    await retrieve(banked);
                } else if (cfg.risk.buyStrongerScrolls && seller && canSpend(k, G.items[name].g)) {
                    await goTo(seller);
                    await buy(name, 1);
                    pay(k, G.items[name].g);
                } else {
                    continue;
                }
            }
            await goTo("newupgrade");
            const chance = await preview(bagIndex(name, 0));
            if (chance >= minChance) return { scroll: name, chance: chance };
            util.log("workshop", "even with " + name + " only " + pct(chance), "white");
        }
        return null;
    }

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
        if (!bankSnapshot) return [];
        return bankSnapshot.items.filter(function (b) { return b.name === name && b.level === level; });
    }

    // Combine three copies of name +level into one +level+1 at Cue.
    // Returns true on success, false on a failed roll, throws when it cannot try.
    async function compoundStep(k, name, level) {
        const missing = 3 - bagCopies(name, level).length;
        if (missing > 0) {
            if (character.esize < missing + 1) throw { reason: "bag full" };
            const banked = bankCopies(name, level);
            if (banked.length < missing) throw { reason: "not enough copies of " + name + " +" + level };
            for (const entry of banked.slice(0, missing)) await retrieve(entry);
        }
        const copies = bagCopies(name, level);
        if (copies.length < 3) throw { reason: "copies went missing" };

        const sample = character.items[copies[0]];
        const grade = item_grade(sample);
        const minChance = minChanceFor(sample, true, 3);
        let scroll = "cscroll" + grade;
        await ensureScroll(k, scroll, 1);
        await goTo("newupgrade");
        const preview = async function (s) {
            const c = bagCopies(name, level);
            return (await compound(c[0], c[1], c[2], s, null, true)).chance;
        };
        let chance = await preview(bagIndex(scroll, 0));
        if (chance < minChance) {
            const better = await strongerScroll(k, "cscroll", grade, minChance, preview);
            if (!better) throw { reason: name + " +" + level + " -> +" + (level + 1) + " only " + pct(chance) + " (need " + pct(minChance) + ")" };
            scroll = better.scroll;
            chance = better.chance;
        }
        const c = bagCopies(name, level);
        const result = await compound(c[0], c[1], c[2], bagIndex(scroll, 0));
        if (result.success) {
            util.log("workshop", "compounded 3x " + name + " +" + level + " -> +" + (level + 1) + " (" + pct(chance) + ")", "green");
            return true;
        }
        util.log("workshop", "compound " + name + " +" + level + " failed (" + pct(chance) + ") - three copies lost", "red");
        return false;
    }

    // Build a wished compound item from existing copies, lowest level first.
    async function developCompound(fighter, w) {
        const k = key(fighter, w);
        for (let level = 0; level < w.level; level++) {
            const total = bagCopies(w.name, level).length + bankCopies(w.name, level).length;
            if (total >= 3) {
                await compoundStep(k, w.name, level);
                return false; // one roll per work() round; the next round continues
            }
        }
        util.log("workshop", "not enough copies to build " + w.name + " +" + w.level + " yet", "orange");
        noteShortage(w.name, w.level);
        blockedUntil[k] = Date.now() + cfg.giveUpForMs;
        return false;
    }

    // ---- drop shortages ----------------------------------------------------------
    //
    // Wished items we can't build for lack of copies (and config.drops.want) are
    // reported to the leader, whose guide finds the drop route (bot_drops).

    const shortages = {}; // name -> { level, at }
    let nextDropReportAt = 0;

    function noteShortage(name, level) {
        shortages[name] = { level: level, at: Date.now() };
    }

    function unlockedCopies(name) {
        const list = [];
        character.items.forEach(function (i) { if (i && i.name === name && !i.l && !i.p) list.push(i.level || 0); });
        (bankSnapshot ? bankSnapshot.items : []).forEach(function (b) { if (b.name === name) list.push(b.level); });
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
        if (!d || !d.enabled || !config.leader || Date.now() < nextDropReportAt) return;
        nextDropReportAt = Date.now() + d.reportMs;
        const list = [];
        Object.keys(shortages).forEach(function (name) {
            const s = shortages[name];
            const wished = fighters().some(function (f) { return wishList(f).some(function (w) { return w.name === name; }); });
            const missing = wished && Date.now() - s.at < 2 * 60 * 60 * 1000 ? copiesMissing(name, s.level) : 0;
            if (missing > 0) list.push({ name: name, copies: missing });
            else delete shortages[name];
        });
        (d.want || []).forEach(function (w) {
            const missing = (w.copies || 1) - unlockedCopies(w.name).length;
            if (G.items[w.name] && missing > 0 && !list.some(function (x) { return x.name === w.name; })) list.push({ name: w.name, copies: missing });
        });
        comms.send(config.leader, "drops", { list: list });
    }

    // Without open wishes: combine spare accessories/books up to autoUpTo.
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
        (bankSnapshot ? bankSnapshot.items : []).forEach(function (b) { add(b.name, b.level); });

        const now = Date.now();
        const id = Object.keys(counts).find(function (x) { return counts[x] >= 3 && !(blockedUntil["auto:" + x] > now); });
        if (!id) return false;
        const parts = id.split(":");
        const k = "auto:" + id;
        util.status("compounding " + parts[0] + " +" + parts[1], "orange");
        try {
            await compoundStep(k, parts[0], Number(parts[1]));
        } catch (e) {
            util.log("workshop", "auto compound " + parts[0] + " +" + parts[1] + ": " + util.errReason(e), "orange");
            blockedUntil[k] = Date.now() + cfg.giveUpForMs;
        }
        return true;
    }

    // ---- exchange -----------------------------------------------------------

    // Quest items go to their quest NPC (e.g. seashells -> Tristian), the rest to Xyn.
    function exchangeNpc(name) {
        const quest = G.items[name].quest;
        if (!quest) return "exchange";
        return Object.keys(G.npcs).find(function (id) { return G.npcs[id].quest === quest && npcPos(id); }) || null;
    }

    function exchangeStack(name, need) {
        return util.findItemIndex(function (i) { return i.name === name && (i.q || 1) >= need; });
    }

    // Without wishes or compound work: exchange boxes, gems, seashells ...
    // (config.workshop.exchange.items) in batches while the bag has room.
    async function autoExchange() {
        const ex = cfg.exchange;
        if (!ex.enabled) return false;
        // Rewards need somewhere to go: no exchanging while the bank is (almost) full.
        if (bankSnapshot && bankSnapshot.free < 3) {
            util.status("bank full - not exchanging", "orange");
            return false;
        }
        const now = Date.now();
        for (const name of ex.items) {
            const def = G.items[name];
            if (!def || blockedUntil["exchange:" + name] > now) continue;
            const need = def.e || 1;
            if (character.esize < ex.keepFree) return false;

            if (exchangeStack(name, need) === -1) {
                const banked = bankSnapshot && bankSnapshot.items.find(function (b) { return b.name === name && b.q >= need; });
                if (!banked) continue;
                await retrieve(banked);
            }
            const npc = exchangeNpc(name);
            if (!npc) {
                blockedUntil["exchange:" + name] = now + cfg.giveUpForMs;
                continue;
            }
            util.status("exchanging " + name, "orange");
            await goTo(npc);

            const rewards = [];
            while (rewards.length < ex.batch && character.esize >= ex.keepFree) {
                const index = exchangeStack(name, need);
                if (index === -1) break;
                try {
                    const result = await exchange(index);
                    rewards.push(result && result.reward ? result.reward : "?");
                } catch (e) {
                    util.log("workshop", "exchange " + name + ": " + util.errReason(e) + " - pausing it", "orange");
                    blockedUntil["exchange:" + name] = Date.now() + cfg.giveUpForMs;
                    break;
                }
            }
            if (rewards.length) {
                util.log("workshop", "exchanged " + rewards.length + "x " + name + ": " + rewards.join(", "), "green");
                return true;
            }
        }
        return false;
    }

    // ---- token shops ---------------------------------------------------------

    // Token price of an item (e.g. Concord Mace = 12 Monster Tokens), or null.
    function tokenOffer(name) {
        for (const token of Object.keys(G.tokens || {})) {
            const price = G.tokens[token][name];
            if (price) return { token: token, price: price };
        }
        return null;
    }

    // Buy a +0 copy with tokens at the token NPC (Daisy for Monster Tokens).
    async function buyWithTokens(name) {
        const offer = tokenOffer(name);
        if (!offer) return false;
        let have = util.countItem(offer.token);
        if (have < offer.price) {
            const banked = bankSnapshot && bankSnapshot.items.find(function (b) { return b.name === offer.token; });
            if (banked && have + banked.q >= offer.price) {
                await retrieve(banked);
                have = util.countItem(offer.token);
            }
        }
        if (have < offer.price) {
            util.log("workshop", name + " costs " + offer.price + " " + offer.token + ", we have " + have, "orange");
            return false;
        }
        const npc = Object.keys(G.npcs).find(function (id) { return G.npcs[id].token === offer.token && npcPos(id); });
        if (!npc) return false;
        await goTo(npc);
        await exchange_buy(offer.token, name);
        util.log("workshop", "bought " + name + " for " + offer.price + " " + offer.token, "green");
        return true;
    }

    // ---- grace ------------------------------------------------------------------
    //
    // A failed upgrade towards +L raises the player's grace for +L (any item),
    // a success at +L resets it. So before risking a valuable item at +L we fail
    // cheap shop items (config.workshop.grace.fodder) at +L until the valuable
    // item's previewed chance reaches its tier – or the grace budget runs out.

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
    async function fodderAttempt(gk, index, bulk) {
        const item = character.items[index];
        const scroll = "scroll" + item_grade(item);
        await ensureScroll(gk, scroll, bulk || 1);
        await goTo("newupgrade");
        const i = util.findItemIndex(function (x) { return x.name === item.name && (x.level || 0) === (item.level || 0) && !x.l && !x.p; });
        if (i === -1) throw { reason: "fodder lost track" };
        const result = await upgrade(i, bagIndex(scroll, 0));
        return result.success ? "success" : "fail";
    }

    // Returns the new chance once it reaches minChance, or null when we gave up.
    async function farmGrace(level, minChance, targetChance) {
        const gk = "grace:" + level;
        const fodder = cfg.grace.fodder;
        const def = G.items[fodder];
        util.log("workshop", "building grace for +" + level + " with " + fodder + " (need " + pct(minChance) + ")", "yellow");
        let tries = 0;   // attempts at the target level
        let stopReason = "attempt limit";

        // Fodder copies sitting exactly one level below the target.
        const readyCount = function () {
            return character.items.filter(function (i) {
                return i && i.name === fodder && !i.l && !i.p && (i.level || 0) === level - 1;
            }).length;
        };

        try {
            for (let round = 0; round < 50 && tries < cfg.grace.maxAttempts; round++) {
                let chance = await targetChance();
                if (chance >= minChance) {
                    util.log("workshop", "grace done after " + tries + " attempts: +" + level + " now at " + pct(chance), "green");
                    return chance;
                }

                // 1. Prepare a batch: buy helmets and climb all of them to +level-1 first,
                //    so the attempts at +level can run back to back (one scroll trip, no walking).
                const want = Math.min(cfg.grace.batch, cfg.grace.maxAttempts - tries);
                // Buy the missing helmets in one visit.
                const have = character.items.filter(function (i) { return i && i.name === fodder && !i.l && !i.p && (i.level || 0) <= level - 1; }).length;
                let toBuy = Math.min(want - have, character.esize - 2);
                while (toBuy > 1 && !canSpend(gk, def.g * toBuy)) toBuy--;
                if (toBuy > 0 && canSpend(gk, def.g * toBuy)) {
                    await goTo(sellerOf(fodder));
                    for (let b = 0; b < toBuy; b++) await buy(fodder, 1);
                    pay(gk, def.g * toBuy);
                }
                for (let guard = 0; readyCount() < want && guard < want * 12; guard++) {
                    let index = fodderIndex(level - 2); // a copy that still needs climbing
                    if (index === -1) {
                        if (character.esize < 2) { stopReason = "bag full"; break; }
                        if (!canSpend(gk, def.g)) { stopReason = "budget used up"; break; }
                        await goTo(sellerOf(fodder));
                        await buy(fodder, 1);
                        pay(gk, def.g);
                        index = fodderIndex(level - 2);
                        if (index === -1) { stopReason = "could not buy " + fodder; break; }
                    }
                    await fodderAttempt(gk, index, want * level); // climbing; a failure just costs a cheap copy
                }
                if (!readyCount()) break;
                util.log("workshop", readyCount() + " " + fodder + "s ready at +" + (level - 1) + " - attempting +" + level, "white");

                // 2. Attempt the whole batch in a row, re-checking the real preview after each one.
                while (readyCount() && tries < cfg.grace.maxAttempts) {
                    tries++;
                    const outcome = await fodderAttempt(gk, fodderIndex(level - 1), readyCount());
                    util.log("workshop", "grace attempt " + tries + " at +" + level + ": " + (outcome === "fail" ? "failed (grace up)" : "succeeded (grace reset)"), "white");
                    if (outcome === "fail") {
                        chance = await targetChance();
                        if (chance >= minChance) {
                            util.log("workshop", "grace done after " + tries + " attempts: +" + level + " now at " + pct(chance), "green");
                            return chance;
                        }
                    }
                }
                if (stopReason !== "attempt limit") break;
            }
        } catch (e) {
            stopReason = util.errReason(e); // e.g. "budget" from a scroll purchase
        }
        util.log("workshop", "grace for +" + level + " stopped: " + stopReason + " (" + Math.round((spent[gk] || 0) / 1000) + "k spent)", "orange");
        return null;
    }

    // Upgrade the copy at `index` towards `target`. Returns true on success.
    // ---- stock upgrades ---------------------------------------------------------
    //
    // config.workshop.stock: items we hold many spare copies of (Phoenix weapons).
    // Without open wishes, the best copy below upTo is upgraded step by step with
    // the usual risk rules. While we hold more than `spares` copies, a copy counts
    // as replaceable, so failures (which use up surplus copies) are acceptable.

    function totalCopies(name, filter) {
        const inBag = character.items.filter(function (i) { return i && i.name === name && (!filter || filter(i.level || 0)); }).length;
        const inBank = bankSnapshot ? bankSnapshot.items.filter(function (b) { return b.name === name && (!filter || filter(b.level)); }).length : 0;
        return inBag + inBank;
    }

    async function stockUpgrade() {
        const now = Date.now();
        for (const rule of cfg.stock || []) {
            const k = key("_stock", { name: rule.name, level: rule.upTo });
            if (blockedUntil[k] > now) continue;
            const total = totalCopies(rule.name);
            if (total <= rule.spares) continue;
            if (!totalCopies(rule.name, function (l) { return l < rule.upTo; })) continue;
            if (character.esize < 3) return false;
            util.status("upgrading spare " + rule.name, "orange");
            try {
                await develop("_stock", { name: rule.name, level: rule.upTo }, { replaceable: total > rule.spares, spare: true });
            } catch (e) {
                util.log("workshop", "spare " + rule.name + ": " + util.errReason(e), "orange");
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
            if (reachedOnly[k] !== undefined) {
                // Next step too risky right now: try again later (grace or luck may help).
                delete reachedOnly[k];
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
            return true;
        }
        return false;
    }

    // opts.replaceable overrides the shop check (e.g. a spare we hold many copies of);
    // opts.spare: no stronger scrolls and no grace farming for this item;
    // opts.minChance overrides the risk tier; opts.budgetKey spends from another budget.
    async function develop(fighter, w, opts) {
        const k = (opts && opts.budgetKey) || key(fighter, w);
        const def = G.items[w.name];
        if (!def.upgrade) {
            if (def.compound) return developCompound(fighter, w);
            util.log("workshop", w.name + " can be neither upgraded nor compounded", "orange");
            blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            return false;
        }

        // A base copy: best lower copy in the bag, then the bank, then the shop.
        let index = -1;
        character.items.forEach(function (item, i) {
            if (item && item.name === w.name && (item.level || 0) < w.level && !item.l &&
                (index === -1 || (item.level || 0) > (character.items[index].level || 0))) index = i;
        });
        if (index === -1) {
            const banked = bankFind(w.name, function (l) { return l < w.level; });
            if (banked) {
                await retrieve(banked);
                index = bagIndex(w.name, banked.level);
            }
        }
        if (index === -1) {
            const seller = sellerOf(w.name);
            if (seller) {
                if (!canSpend(k, def.g)) throw { reason: "budget" };
                await goTo(seller);
                await buy(w.name, 1);
                pay(k, def.g);
            } else if (!(await buyWithTokens(w.name))) {
                util.log("workshop", "no copy of " + w.name + " and no shop or token offer for it", "orange");
                if (!tokenOffer(w.name)) noteShortage(w.name, 0); // drop-only item: the team can farm it
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                return false;
            }
            index = bagIndex(w.name, 0);
        }

        // Step by step at Cue.
        for (;;) {
            const item = character.items[index];
            if (!item || item.name !== w.name) throw { reason: "working copy lost track" };
            const level = item.level || 0;
            if (level >= w.level) return true;

            const grade = item_grade(item);
            // Re-buyable from an NPC = replaceable; token/bank-only copies are precious.
            const replaceable = opts && opts.replaceable !== undefined ? opts.replaceable : !!sellerOf(w.name);
            const minChance = opts && opts.minChance !== undefined ? opts.minChance : minChanceFor(item, replaceable, 1);
            let scroll = "scroll" + grade;
            await ensureScroll(k, scroll, w.level - level);
            await goTo("newupgrade");
            // Buying and walking can reorder the bag: re-locate the working copy.
            const locate = function () {
                const here = character.items[index];
                if (here && here.name === w.name && (here.level || 0) === level) return index;
                index = util.findItemIndex(function (i) { return i.name === w.name && (i.level || 0) === level && !i.l; });
                if (index === -1) throw { reason: "working copy lost track" };
                return index;
            };
            const preview = async function (s) { return (await upgrade(locate(), s, null, true)).chance; };
            let chance = await preview(bagIndex(scroll, 0));
            if (chance < minChance) {
                // Spare upgrades use normal scrolls only – rare scrolls and grace are kept for wishes.
                const spare = !!(opts && opts.spare);
                let better = spare ? null : await strongerScroll(k, "scroll", grade, minChance, preview);
                // Still short on a valuable item at a higher level: build grace with cheap fodder.
                if (!better && !spare && cfg.grace.enabled && level + 1 >= cfg.grace.minLevel && minChance >= cfg.risk.mid) {
                    const graced = await farmGrace(level + 1, minChance, async function () {
                        await ensureScroll(k, scroll, 1); // fodder attempts may have used our scrolls
                        await goTo("newupgrade");
                        return preview(bagIndex(scroll, 0));
                    });
                    if (graced !== null) better = { scroll: scroll, chance: graced };
                }
                if (!better) {
                    util.log("workshop", w.name + " +" + level + " -> +" + (level + 1) + " only " + pct(chance) + " (need " + pct(minChance) + ") - stopping at +" + level, "orange");
                    reachedOnly[k] = level; // deliver the copy as it is; the fighter's guide decides whether to wear it
                    return true;
                }
                scroll = better.scroll;
                chance = better.chance;
            }
            const result = await upgrade(locate(), bagIndex(scroll, 0));
            if (result.success) {
                util.log("workshop", w.name + " is now +" + result.level + " (" + pct(chance) + ", " + scroll + ")", "green");
                index = result.num !== undefined ? result.num : index;
            } else {
                util.log("workshop", w.name + " +" + level + " failed (" + pct(chance) + ") - the copy is gone", "red");
                return false; // next work() round starts again with a new base copy, budget permitting
            }
        }
    }

    // ---- gear goals -------------------------------------------------------------
    //
    // config.workshop.gearGoals: stronger copies of what the fighters wear.
    // Shop armor is pushed to upTo whatever the chance: a failure costs only gold
    // and raises the grace for that level (shared by every item), a success is a
    // finished piece. A weapon is only tried from a spare copy at upTo-1, once
    // grace has raised its previewed chance to the rule's minChance (armor
    // failures at the same level do that). Finished copies get the fighter's stat
    // scroll and are delivered; spending follows the income budget above.

    const goalSentAt = {};      // "fighter:slot" -> delivered at (until the new worn report arrives)
    const weaponWaitUntil = {}; // weapon name -> timestamp (chance too low, waiting for grace)
    let goalsPausedUntil = 0;
    let lastBudgetLog = 0;

    function goalsOn() {
        return !!(cfg.gearGoals && cfg.gearGoals.enabled);
    }

    // What each fighter should get, in team order (leader first).
    function goalNeeds() {
        const g = cfg.gearGoals;
        const now = Date.now();
        const list = [];
        config.team.fighters.forEach(function (f) {
            const eq = worn[f];
            if (!eq) return;
            g.slots.forEach(function (slot) {
                const w = eq[slot];
                const def = w && G.items[w.name];
                if (!def || !def.upgrade || !sellerOf(w.name) || (w.level || 0) >= g.upTo) return;
                list.push({ fighter: f, slot: slot, name: w.name, stat: def.stat ? w.stat : null, weapon: null });
            });
            const main = eq.mainhand;
            (g.weapons || []).forEach(function (rule) {
                if (main && main.name === rule.name && (main.level || 0) < g.upTo) {
                    list.push({ fighter: f, slot: "mainhand", name: rule.name, stat: null, weapon: rule });
                }
            });
        });
        return list.filter(function (n) { return now - (goalSentAt[n.fighter + ":" + n.slot] || 0) > 15 * 60 * 1000; });
    }

    function goalNames() {
        const names = new Set();
        Object.keys(worn).forEach(function (f) {
            cfg.gearGoals.slots.forEach(function (slot) { if (worn[f][slot]) names.add(worn[f][slot].name); });
        });
        (cfg.gearGoals.weapons || []).forEach(function (rule) { names.add(rule.name); });
        return names;
    }

    // Finished bag copies matched to needs (right stat), in priority order.
    function goalAssignments(needs) {
        const upTo = cfg.gearGoals.upTo;
        const taken = new Set();
        const out = [];
        needs.forEach(function (need) {
            const index = character.items.findIndex(function (item, i) {
                return item && !taken.has(i) && !item.l && item.name === need.name && (item.level || 0) >= upTo &&
                    (!need.stat || item.stat_type === need.stat);
            });
            if (index === -1) return;
            taken.add(index);
            out.push({ need: need, index: index });
        });
        return out;
    }

    function goalReadyFor(fighter) {
        if (!goalsOn()) return [];
        return goalAssignments(goalNeeds()).filter(function (a) { return a.need.fighter === fighter; });
    }

    // Copies of gear-goal items (level 1+) are worth keeping: never sold.
    function isGoalStock(item) {
        return goalsOn() && !!item && (item.level || 0) >= 1 && goalNames().has(item.name);
    }

    // Finished copies stay in the bag until they are delivered.
    function isGoalFinished(item) {
        return goalsOn() && !!item && (item.level || 0) >= cfg.gearGoals.upTo && goalNames().has(item.name);
    }

    function kGold(x) {
        return Math.round(x / 1000) + "k";
    }

    function logBudget() {
        if (Date.now() - lastBudgetLog < 30 * 60 * 1000) return;
        lastBudgetLog = Date.now();
        const b = goalBudget();
        util.log("workshop", "gear goals wait for income: " + kGold(b.allowed) + " left (earned " + kGold(b.earned) + " in " +
            b.hours.toFixed(1) + " h, spent " + kGold(b.spent) + ", " + kGold(income.total) + " in total)", "orange");
    }

    // Apply the fighter's stat scroll (str/int/dex) to a finished copy.
    async function applyStat(index, stat) {
        const item = character.items[index];
        const scroll = stat + "scroll";
        if (!G.items[scroll] || G.items[scroll].type !== "pscroll") throw { reason: "no stat scroll for " + stat };
        const need = [1, 10, 100, 1000][item_grade(item)] || 9999; // scrolls needed by item grade
        const missing = need - util.countItem(scroll);
        if (missing > 0) {
            const cost = missing * G.items[scroll].g;
            if (!canSpend(GOALS, cost)) throw { reason: "budget" };
            await goTo(sellerOf(scroll));
            await buy(scroll, missing);
            pay(GOALS, cost);
        }
        await goTo("newupgrade");
        const i = util.findItemIndex(function (x) {
            return x.name === item.name && (x.level || 0) === (item.level || 0) && x.stat_type === item.stat_type && !x.l;
        });
        if (i === -1) throw { reason: "finished copy lost track" };
        await upgrade(i, bagIndex(scroll, 0));
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
        if (!goalsOn() || Date.now() < goalsPausedUntil) return false;
        const g = cfg.gearGoals;
        const needs = goalNeeds();
        const assigned = goalAssignments(needs);
        const takenIdx = new Set(assigned.map(function (a) { return a.index; }));
        // Weapons first: they are only tried when grace allows (else they wait 30 min),
        // so a long armor queue never keeps them from a good moment.
        const open = needs.filter(function (n) { return !assigned.some(function (a) { return a.need === n; }); })
            .sort(function (a, b) { return (b.weapon ? 1 : 0) - (a.weapon ? 1 : 0); });
        if (!open.length || character.esize < 3) return false;

        const now = Date.now();
        try {
            for (const need of open) {
                // 1. A finished copy without the right stat: scroll it for this fighter.
                const finished = character.items.findIndex(function (item, i) {
                    return item && !takenIdx.has(i) && !item.l && item.name === need.name && (item.level || 0) >= g.upTo;
                });
                if (finished !== -1 && need.stat) {
                    util.status("stat scroll for " + need.name, "orange");
                    await applyStat(finished, need.stat);
                    return true;
                }
                // 2. A finished copy in the bank.
                const bankedDone = bankFind(need.name, function (l) { return l >= g.upTo; });
                if (bankedDone) {
                    await retrieve(bankedDone);
                    return true;
                }

                const w = { name: need.name, level: g.upTo };
                if (need.weapon) {
                    // 3. Weapon: a spare copy at upTo-1, only with enough grace.
                    if (weaponWaitUntil[need.name] > now) continue;
                    const below = g.upTo - 1;
                    if (totalCopies(need.name) < 2 || !totalCopies(need.name, function (l) { return l === below; })) continue;
                    if (bestBagLevel(need.name, g.upTo) < below) await retrieve(bankFind(need.name, function (l) { return l === below; }));
                    util.status("trying " + need.name + " +" + g.upTo, "orange");
                    await develop("_goal", w, { budgetKey: GOALS, minChance: need.weapon.minChance, spare: true });
                    if (reachedOnly[GOALS] !== undefined) {
                        delete reachedOnly[GOALS];
                        weaponWaitUntil[need.name] = Date.now() + 30 * 60 * 1000; // armor failures raise the grace meanwhile
                    }
                    return true;
                }

                // 4. Shop armor: continue with the best copy we have, else buy one.
                const banked = bankFind(need.name, function (l) { return l < g.upTo; });
                if (banked && banked.level > bestBagLevel(need.name, g.upTo)) await retrieve(banked);
                util.status("gear goal: " + need.name + " +" + g.upTo + " for " + need.fighter, "orange");
                await develop("_goal", w, { budgetKey: GOALS, minChance: 0, spare: true });
                return true;
            }
        } catch (e) {
            const reason = util.errReason(e);
            if (reason === "budget") {
                logBudget();
                goalsPausedUntil = Date.now() + 15 * 60 * 1000;
            } else {
                util.log("workshop", "gear goals: " + reason, "orange");
                goalsPausedUntil = Date.now() + 5 * 60 * 1000;
            }
            return true;
        }
        return false;
    }

    // ---- main step ----------------------------------------------------------

    function openWishes() {
        const now = Date.now();
        const list = [];
        fighters().forEach(function (fighter) {
            wishList(fighter).forEach(function (w) {
                if (blockedUntil[key(fighter, w)] > now) return;
                list.push({ fighter: fighter, wish: w });
            });
        });
        return list;
    }

    // One unit of work. Returns the fighters that now have something waiting.
    async function work() {
        if (!cfg.enabled) return;

        // Ping fighters that have finished items waiting.
        sampleIncome();
        reportDrops();
        fighters().forEach(function (fighter) {
            if (readyFor(fighter).length || goalReadyFor(fighter).length) comms.send(fighter, "ready", {});
        });

        if (!bankSnapshot || Date.now() - bankSnapshot.at > cfg.bankScanEveryMs) {
            util.status("checking the bank", "yellow");
            await smart_move("bank");
            readBank();
        }

        const open = openWishes().filter(function (o) { return bagIndex(o.wish.name, targetLevel(o.fighter, o.wish)) === -1; });
        if (!open.length) {
            if (await autoCompound()) return;
            if (await stockUpgrade()) return;
            if (await workOnGoals()) return;
            await autoExchange();
            return;
        }

        const job = open[0];
        const k = key(job.fighter, job.wish);
        util.status("working on " + job.wish.name + " +" + job.wish.level, "orange");
        try {
            const banked = bankFind(job.wish.name, function (l) { return l >= job.wish.level; });
            if (banked) {
                await retrieve(banked);
                return;
            }
            await develop(job.fighter, job.wish);
        } catch (e) {
            const reason = util.errReason(e);
            util.log("workshop", job.wish.name + " +" + job.wish.level + " for " + job.fighter + ": " + reason, reason === "budget" ? "orange" : "red");
            blockedUntil[k] = Date.now() + cfg.giveUpForMs;
        }
    }

    return {
        work: work, handOver: handOver, isReserved: isReserved, readyFor: readyFor,
        isGoalStock: isGoalStock, isGoalFinished: isGoalFinished,
    };
};
