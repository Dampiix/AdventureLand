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
// config.workshop.compound.autoUpTo (same chance/budget rules), then
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

    comms.on("wishes", function (data, from) {
        wishes[from] = (data.list || []).filter(function (w) { return w && G.items[w.name]; });
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
        bankSnapshot = { at: Date.now(), items: items };
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

    function canSpend(k, amount) {
        return character.gold - amount >= util.goldAmount(config.merchantRole.goldReserve) && (spent[k] || 0) + amount <= cfg.budgetPerWish;
    }

    function pay(k, amount) { spent[k] = (spent[k] || 0) + amount; }

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
        blockedUntil[k] = Date.now() + cfg.giveUpForMs;
        return false;
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

    // Upgrade the copy at `index` towards `target`. Returns true on success.
    async function develop(fighter, w) {
        const k = key(fighter, w);
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
            const minChance = minChanceFor(item, !!sellerOf(w.name), 1);
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
                const better = await strongerScroll(k, "scroll", grade, minChance, preview);
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
        fighters().forEach(function (fighter) {
            if (readyFor(fighter).length) comms.send(fighter, "ready", {});
        });

        if (!bankSnapshot || Date.now() - bankSnapshot.at > cfg.bankScanEveryMs) {
            util.status("checking the bank", "yellow");
            await smart_move("bank");
            readBank();
        }

        const open = openWishes().filter(function (o) { return bagIndex(o.wish.name, targetLevel(o.fighter, o.wish)) === -1; });
        if (!open.length) {
            if (await autoCompound()) return;
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

    return { work: work, handOver: handOver, isReserved: isReserved, readyFor: readyFor };
};
