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
// least minChance, never spend below the gold reserve, at most budgetPerWish
// per wish, no offerings, no shells. Upgradeable items are upgraded step by
// step; compound items (rings, earrings, books, ...) are built from three
// matching copies per level out of bag and bank (copies can't be bought).
// Without open wishes, spare compound items are combined up to
// config.workshop.compound.autoUpTo (same chance/budget rules).
// We only ever work on our own copies – worn gear is never risked.
// Finished items are handed over on the next delivery; the fighter gets a
// "ready" ping so it calls the merchant right away.
// =====================================================================

module.exports = function createWorkshop(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.workshop;
    const reserve = config.merchantRole.goldReserve;

    const wishes = {};      // fighter -> [{ name, level }]
    const spent = {};       // wish key -> gold spent
    const blockedUntil = {}; // wish key -> timestamp (gave up for a while)
    let bankSnapshot = null; // { at, items: [{ pack, index, name, level }] }

    comms.on("wishes", function (data, from) {
        wishes[from] = (data.list || []).filter(function (w) { return w && G.items[w.name]; });
    });

    function key(fighter, w) { return fighter + ":" + w.name + ":" + w.level; }

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
        return Object.keys(wishes).some(function (f) {
            return wishes[f].some(function (w) { return w.name === item.name; });
        });
    }

    // ---- delivery -------------------------------------------------------

    function readyFor(fighter) {
        return (wishes[fighter] || []).filter(function (w) { return bagIndex(w.name, w.level) !== -1; });
    }

    async function handOver(fighter) {
        for (const w of readyFor(fighter)) {
            const index = bagIndex(w.name, w.level);
            if (index === -1) continue;
            const item = character.items[index];
            await send_item(fighter, index, 1);
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter, "green");
            wishes[fighter] = wishes[fighter].filter(function (x) { return x !== w; });
        }
    }

    // ---- bank -------------------------------------------------------------

    function readBank() {
        const items = [];
        Object.keys(character.bank || {}).forEach(function (pack) {
            if (!/^items\d+$/.test(pack)) return;
            (character.bank[pack] || []).forEach(function (item, index) {
                if (item) items.push({ pack: pack, index: index, name: item.name, level: item.level || 0 });
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
        util.log("workshop", "took " + entry.name + " +" + entry.level + " from the bank", "green");
        readBank();
    }

    // ---- develop ----------------------------------------------------------

    function canSpend(k, amount) {
        return character.gold - amount >= reserve && (spent[k] || 0) + amount <= cfg.budgetPerWish;
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

        const scroll = "cscroll" + item_grade(character.items[copies[0]]);
        await ensureScroll(k, scroll, 1);
        await goTo("newupgrade");
        const c = bagCopies(name, level);
        const s = bagIndex(scroll, 0);
        const preview = await compound(c[0], c[1], c[2], s, null, true);
        if (preview.chance < cfg.minChance) {
            throw { reason: name + " +" + level + " -> +" + (level + 1) + " only " + Math.round(preview.chance * 100) + "%" };
        }
        const result = await compound(c[0], c[1], c[2], s);
        if (result.success) {
            util.log("workshop", "compounded 3x " + name + " +" + level + " -> +" + (level + 1) + " (" + Math.round(preview.chance * 100) + "%)", "green");
            return true;
        }
        util.log("workshop", "compound " + name + " +" + level + " failed (" + Math.round(preview.chance * 100) + "%) - three copies lost", "red");
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
            if (!seller) {
                util.log("workshop", "no copy of " + w.name + " and no NPC sells it", "orange");
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                return false;
            }
            if (!canSpend(k, def.g)) throw { reason: "budget" };
            await goTo(seller);
            await buy(w.name, 1);
            pay(k, def.g);
            index = bagIndex(w.name, 0);
        }

        // Step by step at Cue.
        for (;;) {
            const item = character.items[index];
            if (!item || item.name !== w.name) throw { reason: "working copy lost track" };
            const level = item.level || 0;
            if (level >= w.level) return true;

            const scroll = "scroll" + item_grade(item);
            await ensureScroll(k, scroll, w.level - level);
            await goTo("newupgrade");
            // Buying and walking can reorder the bag: re-locate the working copy.
            const here = character.items[index];
            if (!here || here.name !== w.name || (here.level || 0) !== level) {
                index = util.findItemIndex(function (i) { return i.name === w.name && (i.level || 0) === level && !i.l; });
                if (index === -1) throw { reason: "working copy lost track" };
            }
            const scrollIndex = bagIndex(scroll, 0);
            const preview = await upgrade(index, scrollIndex, null, true);
            if (preview.chance < cfg.minChance) {
                util.log("workshop", w.name + " +" + level + " -> +" + (level + 1) + " only " + Math.round(preview.chance * 100) + "% - stopping at +" + level, "orange");
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                return false;
            }
            const result = await upgrade(index, scrollIndex);
            if (result.success) {
                util.log("workshop", w.name + " is now +" + result.level + " (" + Math.round(preview.chance * 100) + "%)", "green");
                index = result.num !== undefined ? result.num : index;
            } else {
                util.log("workshop", w.name + " +" + level + " failed (" + Math.round(preview.chance * 100) + "%) - the copy is gone", "red");
                return false; // next work() round starts again with a new base copy, budget permitting
            }
        }
    }

    // ---- main step ----------------------------------------------------------

    function openWishes() {
        const now = Date.now();
        const list = [];
        Object.keys(wishes).forEach(function (fighter) {
            wishes[fighter].forEach(function (w) {
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
        Object.keys(wishes).forEach(function (fighter) {
            if (readyFor(fighter).length) comms.send(fighter, "ready", {});
        });

        if (!bankSnapshot || Date.now() - bankSnapshot.at > cfg.bankScanEveryMs) {
            util.status("checking the bank", "yellow");
            await smart_move("bank");
            readBank();
        }

        const open = openWishes().filter(function (o) { return bagIndex(o.wish.name, o.wish.level) === -1; });
        if (!open.length) {
            await autoCompound();
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
