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
// least the risk tier's chance (config.workshop.risk: shop items no floor,
// compounds 35 %, token/drop items 50 %; a higher scroll grade is
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

    // fighter -> [{ name, level }] from its progression guide. Kept across restarts (up to
    // 6 h): right after a merchant restart the wishes were empty, so isReserved() let the
    // sell list sell the HP belts the warrior wishes for (2026-11-17).
    const WISHES_KEY = "workshop_wishes:" + character.name;
    const wishes = (function () {
        try {
            const saved = get(WISHES_KEY) || {};
            if (saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000) return saved.list || {};
        } catch (e) { /* storage unavailable */ }
        return {};
    })();
    const spent = {};       // wish key -> gold spent
    const blockedUntil = {}; // wish key -> timestamp (gave up for a while)
    const reachedOnly = {}; // wish key -> level we stopped at (too risky to go on) – delivered as is
    let graceSince = Date.now(); // start of the current 24 h grace budget window
    let bankSnapshot = null; // { at, items: [{ pack, index, name, level }] }

    // Delivered wishes are not fulfilled again for a while (survives restarts).
    // Storage is shared by every character in the client: keys carry the merchant's name.
    const DELIVERED_KEY = "workshop_delivered:" + character.name;
    function loadDelivered() {
        try { return get(DELIVERED_KEY) || {}; } catch (e) { return {}; }
    }
    // Keyed by fighter, item, level and stat: a helmet +0 does not block a later helmet +3.
    const delivered = loadDelivered(); // "fighter:name:level:stat" -> timestamp
    function deliveredKey(fighter, w) {
        return fighter + ":" + w.name + ":" + (w.level || 0) + ":" + (w.stat || "");
    }
    function markDelivered(fighter, w) {
        delivered[deliveredKey(fighter, w)] = Date.now();
        try { set(DELIVERED_KEY, delivered); } catch (e) { /* storage unavailable – only this session remembers */ }
    }
    function recentlyDelivered(fighter, w) {
        return Date.now() - (delivered[deliveredKey(fighter, w)] || 0) < cfg.redeliverAfterMs;
    }

    // What each fighter wears (sent with its wishes; survives restarts) – for gear goals.
    const WORN_KEY = "workshop_worn:" + character.name;
    const worn = (function () {
        try { return get(WORN_KEY) || {}; } catch (e) { return {}; }
    })();

    const classes = {}; // fighter -> ctype (sent with its wishes)
    const carries = {}; // fighter -> { item: true/false } for one-per-character items
    // Gold a fighter handed over is income (loot, sales), not a transfer by hand: the
    // transfer check below would otherwise drop a big handover (gearGoals budget).
    comms.on("gold", function (data) {
        const a = Math.round((data && data.a) || 0);
        if (a <= 0) return;
        income.credits = income.credits || [];
        income.credits.push({ t: Date.now(), a: a });
        saveIncome();
    });
    comms.on("wishes", function (data, from) {
        wishes[from] = (data.list || []).filter(function (w) { return w && G.items[w.name]; });
        try { set(WISHES_KEY, { at: Date.now(), list: wishes }); } catch (e) { /* storage unavailable */ }
        if (data.ctype && G.classes[data.ctype]) classes[from] = data.ctype;
        if (data.has) carries[from] = data.has;
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
        return list.map(function (w) { return withMainStat(fighter, w); })
            // Rings and earrings come in pairs: the second copy is not held back by the
            // 6 h redelivery pause (player decision 2026-11-17).
            .filter(function (w) {
                const t = G.items[w.name] && G.items[w.name].type;
                return t === "ring" || t === "earring" || (w.count || 1) > 1 || !recentlyDelivered(fighter, w);
            });
    }

    // Armor that can carry a stat always gets the fighter's main stat (str/int/dex),
    // even when the guide's wish names none: a piece without it would never replace
    // a worn piece that has one, and the guide's lessons want it anyway.
    function withMainStat(fighter, w) {
        if (w.stat || !cfg.mainStatOnArmor || !G.items[w.name] || !G.items[w.name].stat) return w;
        const cls = classes[fighter] && G.classes[classes[fighter]];
        return cls && cls.main_stat ? Object.assign({}, w, { stat: cls.main_stat }) : w;
    }

    function fighters() {
        return Object.keys(Object.assign({}, wishes, cfg.wishes || {}));
    }

    // The level a wish is fulfilled at: the wished one, or where we had to stop.
    function targetLevel(fighter, w) {
        const r = reachedOnly[key(fighter, w)];
        return r !== undefined ? r : w.level;
    }

    // Where an NPC stands: main first, then any other regular map (e.g. the witch).
    function npcPos(id) {
        const maps = ["main"].concat(Object.keys(G.maps).filter(function (m) { return m !== "main"; }));
        for (const mapName of maps) {
            const map = G.maps[mapName];
            if (!map || map.ignore || map.instance) continue;
            const npc = (map.npcs || []).find(function (n) { return n.id === id && n.position; });
            if (npc) return { map: mapName, x: npc.position[0], y: npc.position[1] };
        }
        return null;
    }

    async function goTo(npcId) {
        const p = npcPos(npcId);
        if (!p) throw { reason: "npc " + npcId + " not found" };
        // Market stand (config.merchantRole.stand): an NPC within the server's 400 px of the
        // home spot is used from there - we walk home instead of to the NPC, so the stand
        // reopens and Merrit's two minutes keep running. After a bank trip the merchant had
        // walked on to Lucas and the upgrade NPC with his stand closed (2026-11-17).
        const st = config.merchantRole.stand || {};
        const hasStand = st.enabled && st.home &&
            character.items.some(function (i) { return i && G.items[i.name] && G.items[i.name].type === "stand"; });
        if (hasStand && p.map === "main") {
            const home = { map: "main", x: st.home.x, y: st.home.y };
            const reach = st.reach || 390;
            if (Math.hypot(p.x - home.x, p.y - home.y) < reach) {
                if (character.map !== "main" || util.distanceTo(home) >= 15) await util.walk(home);
                if (!character.stand) {
                    try { util.openStand(); } catch (e) { /* the merchant's round opens it again */ }
                }
                return;
            }
        }
        if (character.map === p.map && util.distanceTo(p) < 100) return;
        await util.walk(p);
    }

    // Mass Production (lvl 30, -50%; "pp" from lvl 60, -90%) before an upgrade or compound,
    // Mass Exchange (lvl 40 / 70) before an exchange: the next one finishes faster.
    async function boost(skill) {
        try {
            if (!cfg.massSkills || (character.s && (character.s[skill] || character.s[skill + "pp"]))) return;
            const pick = util.canCast(skill + "pp") ? skill + "pp" : util.canCast(skill) ? skill : null;
            if (pick) await use_skill(pick);
        } catch (e) {
            // a speed-up is never worth failing the upgrade for
        }
    }

    function bagIndex(name, minLevel) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== name || (item.level || 0) < minLevel) return;
            if (best === -1 || (item.level || 0) < (character.items[best].level || 0)) best = i; // smallest that satisfies
        });
        return best;
    }

    // ---- earmarks -----------------------------------------------------------
    //
    // A fighter's wish list keeps changing (top rows of its guide). Once an item is
    // ready for a fighter it is earmarked for it and stays reserved – never sold or
    // banked – until it is delivered, even if the wish drops off the list. Earmarks
    // survive restarts and expire after 12 h.
    const EARMARK_KEY = "workshop_earmarks:" + character.name;
    const EARMARK_MS = 12 * 60 * 60 * 1000;
    const earmarks = (function () { // "fighter|name" -> { fighter, name, level, at }
        try { return get(EARMARK_KEY) || {}; } catch (e) { return {}; }
    })();
    function saveEarmarks() {
        try { set(EARMARK_KEY, earmarks); } catch (e) { /* storage unavailable */ }
    }
    function activeEarmarks() {
        const now = Date.now();
        return Object.keys(earmarks).filter(function (k) {
            if (now - earmarks[k].at < EARMARK_MS && config.characters[earmarks[k].fighter]) return true;
            delete earmarks[k];
            return false;
        }).map(function (k) { return earmarks[k]; });
    }
    function earmark(fighter, name, level, stat) {
        const k = fighter + "|" + name;
        if (earmarks[k] && earmarks[k].level >= level && (earmarks[k].stat || null) === (stat || null)) return;
        earmarks[k] = { fighter: fighter, name: name, level: level, stat: stat || null, at: Date.now() };
        saveEarmarks();
    }

    // A bag copy that fulfils a wish/earmark: at least `level`, with the wished stat
    // (str/int/dex scroll) if one is asked for. Smallest such level first.
    function wishIndex(w, level) {
        let best = -1;
        character.items.forEach(function (item, i) {
            if (!item || item.name !== w.name || (item.level || 0) < level) return;
            if (w.stat && item.stat_type !== w.stat) return;
            if (best === -1 || (item.level || 0) < (character.items[best].level || 0)) best = i;
        });
        return best;
    }

    // Items reserved for a fighter must not be sold or banked.
    function isReserved(item) {
        if (activeEarmarks().some(function (e) { return e.name === item.name && (item.level || 0) >= e.level; })) return true;
        return fighters().some(function (f) {
            return wishList(f).some(function (w) { return w.name === item.name; });
        });
    }

    // ---- delivery -------------------------------------------------------

    // Wishes we can fulfil from the bag now, plus earmarked items waiting in the bag.
    function readyFor(fighter) {
        const list = wishList(fighter).filter(function (w) { return wishIndex(w, targetLevel(fighter, w)) !== -1; });
        activeEarmarks().forEach(function (e) {
            if (e.fighter !== fighter || list.some(function (w) { return w.name === e.name; })) return;
            if (wishIndex(e, e.level) !== -1) list.push({ name: e.name, level: e.level, stat: e.stat || null });
        });
        return list;
    }

    async function handOver(fighter) {
        for (const w of readyFor(fighter)) {
            const index = wishIndex(w, targetLevel(fighter, w));
            if (index === -1) continue;
            const item = character.items[index];
            await send_item(fighter, index, 1);
            util.log("workshop", "delivered " + item.name + " +" + (item.level || 0) + " to " + fighter, "green");
            markDelivered(fighter, w);
            if (G.items[item.name]) filledAt[fighter + "|" + G.items[item.name].type] = Date.now();
            delete earmarks[fighter + "|" + w.name];
            saveEarmarks();
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
                if (item) items.push({ pack: pack, index: index, name: item.name, level: item.level || 0, q: item.q || 1, stat: item.stat_type || null });
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
        await util.walk("bank");
        readBank();
        let fresh = bankSnapshot.items.find(function (b) { return b.pack === entry.pack && b.index === entry.index && b.name === entry.name; });
        // An older snapshot (we took a copy since, or the player moved things): any slot with
        // the same item and level will do - the wish used to pause for an hour (2026-11-17).
        if (!fresh) {
            fresh = bankSnapshot.items.find(function (b) {
                return b.name === entry.name && b.level === entry.level && (b.stat || null) === (entry.stat || null);
            });
        }
        if (!fresh) throw { reason: entry.name + " moved in the bank" };
        entry = fresh;
        await bank_retrieve(entry.pack, entry.index);
        util.log("workshop", "took " + entry.name + (entry.q > 1 ? " x" + entry.q : " +" + entry.level) + " from the bank", "green");
        readBank();
    }

    // ---- develop ----------------------------------------------------------

    // How long a stopped job waits before the next try. Too little gold right now
    // (fighters hand gold over regularly) is retried soon; a used-up wish budget
    // or any other reason (too risky, no copies, ...) waits giveUpForMs.
    function pauseAfter(k, reason) {
        if (reason !== "budget" || k === GOALS) return cfg.giveUpForMs;
        const left = budgetFor(k) - (spent[k] || 0);
        return left < 10000 ? cfg.giveUpForMs : (cfg.retryAfterBudgetMs || cfg.giveUpForMs);
    }

    // Budget per key: wishes use budgetPerWish, grace keys ("grace:<level>") their own.
    // budgetPerWish may be split { shop, rare }: shop gear vs token/drop items, whose
    // higher scrolls are worth more than a lost copy (player decision 2026-11-16).
    function budgetFor(k) {
        if (k.indexOf("grace:") === 0) return graceBudget();
        const b = cfg.budgetPerWish;
        if (typeof b !== "object") return b;
        const name = k.split(":")[1];
        if (b.byItem && b.byItem[name]) return b.byItem[name];
        return G.items[name] && !sellerOf(name) ? b.rare : b.shop;
    }

    function canSpend(k, amount) {
        // Never below the floor: the larger of the potion reserve and workshop.keepGold. The
        // merchant's own wishes (stand, tools) only keep the potion reserve - a fresh account
        // must not wait for millions to buy a 40k stand.
        const reserve = util.goldAmount(config.merchantRole.goldReserve);
        const floor = k.indexOf("_own:") === 0 ? reserve : Math.max(reserve, cfg.keepGold || 0);
        if (character.gold - amount < floor) return false;
        if (k === GOALS) return goalBudget().allowed >= amount;
        if (k === LADDER) return ladderBudget().allowed >= amount;
        return (spent[k] || 0) + amount <= budgetFor(k);
    }

    function pay(k, amount) {
        if (k === LADDER) {
            income.spends.push({ t: Date.now(), a: amount, k: LADDER });
            saveIncome();
            return;
        }
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
    // daily budget follows what the team currently earns. Gold moved by hand (e.g.
    // from the bank) shows up as one big jump between two samples: it is a transfer,
    // not income (budget.transferAbove), so the budget stays tied to real cash flow.
    const GOALS = "goals"; // budget key of the gear goals
    const LADDER = "ladder"; // budget key of the weapon ladder (its own income share)
    const INCOME_KEY = "workshop_income:" + character.name;
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
        income.credits = (income.credits || []).filter(function (c) { return c.t >= since; });
        saveIncome();
    }

    // Gold moved in or out by hand since the baseline: jumps of at least transferAbove
    // between two samples (gear-goal spending in between taken out).
    function transfers() {
        const limit = cfg.gearGoals.budget.transferAbove || Infinity;
        const points = income.samples.concat([{ t: Date.now(), gold: character.gold }]);
        let sum = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const between = income.spends.reduce(function (x, s) { return s.t > a.t && s.t <= b.t ? x + s.a : x; }, 0);
            // Gold the fighters handed over in this step is income, not a transfer.
            const handed = (income.credits || []).reduce(function (x, c) { return c.t > a.t && c.t <= b.t ? x + c.a : x; }, 0);
            const step = b.gold - a.gold + between - handed;
            if (Math.abs(step) >= limit) sum += step;
        }
        return sum;
    }

    // budget.resetAt once it has passed: everything before it is ignored (0 = no mark).
    function resetMark() {
        const r = cfg.gearGoals.budget && cfg.gearGoals.budget.resetAt;
        const t = r ? Date.parse(r) : 0;
        return t && t <= Date.now() ? t : 0;
    }
    function goalBudget() {
        const b = cfg.gearGoals.budget;
        if (!income.samples.length) return { allowed: 0, earned: 0, spent: 0, hours: 0, moved: 0 };
        // A reset mark: the first gold sample after it is the baseline, older spending is gone.
        const mark = resetMark();
        if (mark && income.samples[0].t < mark) {
            income.samples = income.samples.filter(function (s) { return s.t >= mark; });
            if (!income.samples.length) income.samples.push({ t: Date.now(), gold: character.gold });
            income.spends = income.spends.filter(function (s) { return s.t >= mark; });
            saveIncome();
            util.log("workshop", "budget reset: every pot starts from 0 now", "yellow");
        }
        const base = income.samples[0];
        // All workshop spending is put back into the income; the gear goals' share only
        // counts their own spending (the weapon ladder has its own pot).
        const spentAll = income.spends.reduce(function (sum, s) { return sum + s.a; }, 0);
        const spentInWindow = income.spends.reduce(function (sum, s) { return s.k ? sum : sum + s.a; }, 0);
        const moved = transfers();
        const earned = character.gold - base.gold + spentAll - moved;
        // A player-granted extra (budget.extra: { amount, until }) on top of the income share,
        // e.g. to gear up a new character faster. What it pays for still counts as spent in
        // the 24 h window, so after it expires the income share has to catch up first.
        const extra = b.extra && b.extra.amount && Date.now() < Date.parse(b.extra.until) ? b.extra.amount : 0;
        let allowed = Math.max(0, earned * b.incomeShare + extra - spentInWindow);
        if (b.total) allowed = Math.min(allowed, Math.max(0, b.total - income.total));
        return { allowed: allowed, earned: earned, spent: spentInWindow, hours: (Date.now() - base.t) / 3600000, moved: moved };
    }

    // Weapon ladder budget (player decision 2026-11-17): its own share of the last 24 h of
    // income (bruteForce.incomeShare) – no fixed amount, it grows with the account, and it
    // keeps going while the gear goals' pot is empty after a player-granted extra.
    function ladderBudget() {
        const share = (cfg.bruteForce && cfg.bruteForce.incomeShare) || 0;
        const spentLadder = income.spends.reduce(function (sum, s) { return s.k === LADDER ? sum + s.a : sum; }, 0);
        const earned = goalBudget().earned;
        return { allowed: Math.max(0, earned * share - spentLadder), earned: earned, spent: spentLadder };
    }

    // Grace budget per target level and 24 h (player decision 2026-11-16): a share of the
    // merchant's net income over the last 24 h (grace.incomeShare, like the gear goals),
    // never below grace.budgetPerLevel. Grace spending itself is not a loss of income.
    function graceBudget() {
        const g = cfg.grace;
        const mark = resetMark();
        if (mark && graceSince < mark) { // budget.resetAt: grace spending starts over too
            Object.keys(spent).forEach(function (k) { if (k.indexOf("grace:") === 0) delete spent[k]; });
            graceSince = mark;
            saveGraceSpent();
        }
        if (!g.incomeShare) return g.budgetPerLevel;
        let graceSpent = 0;
        Object.keys(spent).forEach(function (k) { if (k.indexOf("grace:") === 0) graceSpent += spent[k] || 0; });
        const earned = goalBudget().earned + graceSpent;
        // A player-granted extra per level (grace.extra: { amount, until }), like the gear goals.
        const extra = g.extra && g.extra.amount && Date.now() < Date.parse(g.extra.until) ? g.extra.amount : 0;
        return Math.max(g.budgetPerLevel || 0, Math.round(earned * g.incomeShare)) + extra;
    }

    // Grace spending survives restarts and resets after 24 h.
    const GRACE_KEY = "workshop_grace_spent:" + character.name;
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

    // An NPC shop selling this item – in town (main) only, like before.
    function sellerOf(name) {
        const id = Object.keys(G.npcs).find(function (n) {
            const p = Array.isArray(G.npcs[n].items) && G.npcs[n].items.includes(name) && npcPos(n);
            return p && p.map === "main";
        });
        return id || null;
    }

    // ---- crafting -----------------------------------------------------------------
    //
    // Items without a shop that have a recipe (G.craft) are crafted: at Cole for his
    // monster-material recipes, at the witch for hers, at Leo for the rest. The
    // ingredients come from bag and bank; each one must sit in a single stack, so
    // split stacks are merged through the bank first. Missing ingredients are
    // reported for drop farming.

    function crafterOf(name) {
        const r = G.craft && G.craft[name];
        if (!r) return null;
        const id = r.quest
            ? Object.keys(G.npcs).find(function (n) { return G.npcs[n].quest === r.quest && npcPos(n); })
            : Object.keys(G.npcs).find(function (n) { return G.npcs[n].role === "craftsman" && npcPos(n); });
        return id || null;
    }

    function stackable(name) {
        return !!(G.items[name] && G.items[name].s);
    }

    // How many we hold (bag + bank): stack quantities, or copies at exactly `level`.
    function ingredientCount(name, level) {
        let n = 0;
        character.items.forEach(function (i) {
            if (!i || i.name !== name || i.l) return;
            if (stackable(name)) n += i.q || 1;
            else if ((i.level || 0) === level) n++;
        });
        (bankSnapshot ? bankSnapshot.items : []).forEach(function (b) {
            if (b.name !== name) return;
            if (stackable(name)) n += b.q || 1;
            else if (b.level === level) n++;
        });
        return n;
    }

    // Get `q` of an ingredient into the bag (one stack for stackables).
    async function gatherIngredient(name, q, level) {
        if (stackable(name)) {
            if (util.findItemIndex(function (i) { return i.name === name && (i.q || 1) >= q; }) !== -1) return;
            await util.walk("bank");
            // Bag stacks go into the bank first: storing merges them into one stack.
            for (let i = character.items.length - 1; i >= 0; i--) {
                if (character.items[i] && character.items[i].name === name) await bank_store(i);
            }
            readBank();
            const stack = bankSnapshot.items.filter(function (b) { return b.name === name; })
                .sort(function (a, b) { return b.q - a.q; })[0];
            if (!stack || stack.q < q) throw { reason: name + " is split across stacks (" + (stack ? stack.q : 0) + "/" + q + " in one)" };
            await retrieve(stack);
            return;
        }
        if (bagIndex(name, level) !== -1 && character.items.some(function (i) { return i && i.name === name && (i.level || 0) === level; })) return;
        const banked = bankFind(name, function (l) { return l === level; });
        if (!banked) throw { reason: "no " + name + " +" + level + " for crafting" };
        await retrieve(banked);
    }

    // Returns { ok: true } after crafting, or { ok: false, missing: [{ name, level, need }] }.
    async function craftItem(k, name) {
        const recipe = G.craft[name];
        const npc = crafterOf(name);
        if (!recipe || !npc) return { ok: false, missing: [] };
        const missing = [];
        recipe.items.forEach(function (it) {
            const q = it[0], ing = it[1], level = it[2] || 0;
            const have = ingredientCount(ing, level);
            if (have < q) missing.push({ name: ing, level: level, need: q, have: have });
        });
        // Only shop items at +0 can be bought: the rest must be found or farmed.
        const buyable = missing.filter(function (m) { return m.level === 0 && sellerOf(m.name); });
        const farmable = missing.filter(function (m) { return buyable.indexOf(m) === -1; });
        if (farmable.length) return { ok: false, missing: farmable };
        for (const m of buyable) {
            const amount = m.need - m.have;
            const cost = amount * G.items[m.name].g;
            if (!canSpend(k, cost)) throw { reason: "budget" };
            if (character.esize < (stackable(m.name) ? 1 : amount) + 1) throw { reason: "bag full" };
            await goTo(sellerOf(m.name));
            if (stackable(m.name)) await buy(m.name, amount);
            else for (let i = 0; i < amount; i++) await buy(m.name, 1);
            pay(k, cost);
            util.log("workshop", "bought " + amount + "x " + m.name + " for crafting " + name, "white");
        }
        if (recipe.cost && !canSpend(k, recipe.cost)) throw { reason: "budget" };
        if (character.esize < recipe.items.length + 1) throw { reason: "bag full" };
        for (const it of recipe.items) await gatherIngredient(it[1], it[0], it[2] || 0);
        await goTo(npc);
        let at = npc;
        try {
            await auto_craft(name);
        } catch (e) {
            // Recipes without a named specialist go to Leo, but some (e.g. the cave items)
            // are crafted by Cole: retry there when Leo turns it down.
            if (util.errReason(e) !== "distance" || npc === "mcollector" || !npcPos("mcollector")) throw e;
            at = "mcollector";
            await goTo(at);
            await auto_craft(name);
        }
        if (recipe.cost) pay(k, recipe.cost);
        util.log("workshop", "crafted " + G.items[name].name + " at " + (G.npcs[at].name || at), "green");
        return { ok: true };
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

    // Minimum success chance for risking `item` (`copies` of it, 3 for compounds), by how
    // it is replaced (player decision 2026-11-16): shop gear is simply bought again,
    // compound copies come from drops, token/drop items (Hunter set, Phoenix weapons)
    // take longest to replace.
    function minChanceFor(item, replaceable, copies) {
        const r = cfg.risk;
        // Items whose copies we can always make again (e.g. Rugged from armor boxes): like shop gear.
        if ((r.free || []).includes(item.name)) return r.shop;
        if ((copies || 1) >= 3 || (G.items[item.name] && G.items[item.name].compound)) return r.compound;
        return replaceable ? r.shop : r.rare;
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
        await boost("massproduction");
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
        // Craftable (e.g. Orb of Beginnings at Cole): make another +0 copy.
        if (crafterOf(w.name) && copiesMissing(w.name, w.level) > 0) {
            const r = await craftItem(k, w.name);
            if (r.ok) return false; // the next round compounds or crafts again
            util.log("workshop", "can't craft " + w.name + " yet - missing " +
                r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
            r.missing.forEach(function (m) { noteIngredientShortage(m.name, m.level, m.need, w.name); });
            blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            return false;
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

    // Survives restarts: otherwise the leader drops a drop target (e.g. Porcupine Leather)
    // after every merchant restart until the next failed craft notes it again.
    const SHORT_KEY = "workshop_shortages:" + character.name;
    const shortages = (function () { // name -> { level, at, need?, forItem? }
        try { return get(SHORT_KEY) || {}; } catch (e) { return {}; }
    })();
    function saveShortages() {
        try { set(SHORT_KEY, shortages); } catch (e) { /* storage unavailable */ }
    }
    let nextDropReportAt = 0;

    // ---- the merchant's own wishes (config.merchantRole.ownWishes) --------------------
    function ownHas(name) {
        if (Object.values(character.slots || {}).some(function (s) { return s && s.name === name; })) return true;
        if (character.items.some(function (i) { return i && i.name === name; })) return true;
        return !!(bankSnapshot && bankSnapshot.items.some(function (b) { return b.name === name; }));
    }
    function isOwnWish(name) {
        return (config.merchantRole.ownWishes || []).some(function (w) { return w.name === name; });
    }
    // One missing own wish per round: bought, crafted, or its missing drop ingredient is
    // reported as a shortage (the drop system sends a fighter for it). Returns true if done.
    async function workOwnWishes() {
        const now = Date.now();
        for (const w of config.merchantRole.ownWishes || []) {
            const def = G.items[w.name];
            if (!def || ownHas(w.name)) continue;
            const k = "_own:" + w.name;
            if (blockedUntil[k] > now) continue;
            if (character.esize < 2) return false;
            try {
                const seller = sellerOf(w.name);
                if (seller) {
                    if (!canSpend(k, def.g)) throw { reason: "budget" };
                    util.status("buy " + w.name, "orange");
                    await goTo(seller);
                    await buy(w.name, 1);
                    pay(k, def.g);
                    util.log("workshop", "bought my own " + def.name + " for " + def.g, "green");
                    return true;
                }
                if (crafterOf(w.name)) {
                    util.status("craft " + w.name, "orange");
                    const r = await craftItem(k, w.name);
                    if (r.ok) return true;
                    util.log("workshop", "can't craft my " + def.name + " yet - missing " +
                        r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                    r.missing.forEach(function (m) { noteIngredientShortage(m.name, m.level, m.need, w.name); });
                } else {
                    noteShortage(w.name, 0);
                }
                blockedUntil[k] = now + cfg.giveUpForMs;
            } catch (e) {
                util.log("workshop", "my " + w.name + ": " + util.errReason(e), "orange");
                blockedUntil[k] = now + pauseAfter(k, util.errReason(e));
            }
        }
        return false;
    }

    function noteShortage(name, level) {
        shortages[name] = { level: level, at: Date.now() };
        saveShortages();
    }

    // A craft ingredient we lack: `need` in total, for the wished item `forItem`.
    function noteIngredientShortage(name, level, need, forItem) {
        shortages[name] = { level: level, at: Date.now(), need: need, forItem: forItem };
        saveShortages();
    }

    // ---- dismantling (config.dismantle, player decision 2026-11-17) ------------------
    //
    // Spare drop weapons are not upgraded but dismantled at Leo into their material (a
    // fire weapon gives one Essence of Fire). The material stacks in one bank slot and
    // weapons are crafted from it on demand - Phoenix nights no longer fill the bank.
    function dismantleOn(name) {
        const d = config.dismantle;
        return !!(d && d.enabled && (d.names || []).includes(name) && G.dismantle && G.dismantle[name]);
    }
    // Units we hold (bag + last bank snapshot).
    function ownedCount(name) {
        const bag = character.items.reduce(function (s, i) { return i && i.name === name ? s + (i.q || 1) : s; }, 0);
        const bank = bankSnapshot ? bankSnapshot.items.reduce(function (s, b) { return b.name === name ? s + (b.q || 1) : s; }, 0) : 0;
        return bag + bank;
    }
    // A bag item or bank entry we may dismantle now.
    function isDismantleCopy(item) {
        if (!item || !dismantleOn(item.name) || item.l || item.p) return false;
        if ((item.level || 0) > (config.dismantle.maxLevel || 0)) return false;
        if (isReserved(item) || isOwnWish(item.name)) return false;
        // betterWeapons readies a copy of it for a fighter: those copies are needed.
        if (weaponPlans().some(function (p) { return p.name === item.name; })) return false;
        // Bought on purpose (config.market.buy): copies up to "want" stay.
        const order = ((config.market || {}).buy || []).find(function (o) { return o.item === item.name; });
        if (order && ownedCount(item.name) <= (order.want || 0)) return false;
        return true;
    }
    async function dismantleDrops() {
        if (!config.dismantle || !config.dismantle.enabled) return false;
        if ((blockedUntil._dismantle || 0) > Date.now()) return false;
        const inBag = function () { return character.items.findIndex(function (i) { return isDismantleCopy(i); }); };
        const banked = bankSnapshot ? bankSnapshot.items.filter(isDismantleCopy) : [];
        if (inBag() === -1 && !banked.length) return false;
        const reserve = util.goldAmount(config.merchantRole.goldReserve);
        try {
            // Bank copies first, as many as the bag takes in one visit.
            for (const b of banked) {
                if (character.esize < 4) break;
                await retrieve(b);
            }
            let index;
            while ((index = inBag()) !== -1) {
                const item = character.items[index];
                const cost = G.dismantle[item.name].cost || 0;
                if (character.gold - cost < reserve) throw { reason: "gold below the reserve" };
                util.status("dismantling " + item.name, "orange");
                await goTo("craftsman");
                index = inBag(); // the walk may have taken a while: locate it again
                if (index === -1) break;
                const name = character.items[index].name, level = character.items[index].level || 0;
                await dismantle(index);
                util.log("workshop", "dismantled " + name + " +" + level + " into " +
                    G.dismantle[name].items.map(function (it) { return it[0] + "x " + it[1]; }).join(", "), "green");
            }
        } catch (e) {
            util.log("workshop", "dismantling: " + util.errReason(e), "orange");
            blockedUntil._dismantle = Date.now() + cfg.giveUpForMs;
        }
        return true;
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
        // Counts include the bank: right after a restart, before the first bank scan,
        // everything would look missing (e.g. "50 armor boxes missing" with 130 banked).
        if (!bankSnapshot) return;
        // ...and the fighters' wishes: unknown wishes would drop every shortage.
        // (solo: just the leader – the others are offline and never send wishes)
        const ph = (config.phases || {})[config.phase] || {};
        const active = ph.party && ph.party.length ? ph.party : [config.leader];
        if (active.some(function (f) { return !wishes[f]; })) return;
        nextDropReportAt = Date.now() + d.reportMs;
        const list = [];
        Object.keys(shortages).forEach(function (name) {
            const s = shortages[name];
            const target = s.forItem || name; // ingredients count while the crafted item is wished
            if (heldBoxFor(name)) return; // opened from our own boxes, not farmed
            const wished = fighters().some(function (f) { return wishList(f).some(function (w) { return w.name === target; }); }) ||
                weaponPlans().some(function (p) { return p.name === target; }); // e.g. Bones for a Dead weapon
            // Reported as long as it is wished and copies are missing – not only for a while
            // after the last failed attempt (that made the team hop between farm spots).
            const fresh = wished;
            const missing = !fresh ? 0 : s.need ? s.need - ingredientCount(name, s.level) : copiesMissing(name, s.level);
            if (missing > 0) list.push({ name: name, copies: missing });
            else { delete shortages[name]; saveShortages(); }
        });
        (d.want || []).forEach(function (w) {
            // Stackable items (e.g. Armor Boxes) count by quantity, not by stacks.
            const have = stackable(w.name) ? ingredientCount(w.name, 0) : unlockedCopies(w.name).length;
            const missing = (w.copies || 1) - have;
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
            blockedUntil[k] = Date.now() + pauseAfter(k, util.errReason(e));
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

    // A wished item that only comes out of something we hold (e.g. Rugged armor from
    // Armor Boxes): open one batch of that source. Sources listed in
    // config.workshop.exchange.onDemand only, while the bank keeps room for the rewards.
    // We hold an on-demand box (exchange.onDemand) that gives `name`: it comes from
    // opening those, not from farming (2026-11-17: the warrior farmed bats for a Rugged
    // coat while 109 armor boxes waited in the bank behind a full bank).
    function heldBoxFor(name) {
        return ((cfg.exchange || {}).onDemand || []).some(function (src) {
            const t = G.drops[src];
            if (!Array.isArray(t) || !t.some(function (d) { return d && d[1] === name; })) return false;
            // Any stack in the bag or the bank (bank stacks carry no level, so ingredientCount
            // with level 0 missed them).
            return character.items.some(function (i) { return i && i.name === src; }) ||
                !!(bankSnapshot && bankSnapshot.items.some(function (b) { return b.name === src; }));
        });
    }

    async function openSourceFor(name) {
        const ex = cfg.exchange || {};
        const sources = (ex.onDemand || []).filter(function (src) {
            const t = G.drops[src];
            return Array.isArray(t) && t.some(function (d) { return d && d[1] === name; }) && G.items[src];
        });
        if (!sources.length) return false;
        if ((ex.hold || []).includes(sources[0])) return false; // hoarded for a later batch
        if (bankSnapshot && bankSnapshot.free < (ex.onDemandBankFree || 10)) {
            util.log("workshop", "would open " + sources[0] + " for " + name + " but the bank is nearly full", "orange");
            return false;
        }
        // Copies from earlier boxes come first: opening more while 3+ wait only piled up
        // Rugged pants and coats (2026-11-17).
        if (waitingBoxArmor() >= 3) return false;
        if (character.esize < (ex.keepFree || 8)) return false;
        for (const src of sources) {
            const need = G.items[src].e || 1;
            if (exchangeStack(src, need) === -1) {
                const banked = bankSnapshot && bankSnapshot.items.find(function (b) { return b.name === src && b.q >= need; });
                if (!banked) continue;
                await retrieve(banked);
            }
            const npc = exchangeNpc(src);
            if (!npc) continue;
            await goTo(npc);
            const rewards = [];
            for (let n = 0; n < (ex.onDemandBatch || 3) && character.esize >= (ex.keepFree || 8); n++) {
                const index = exchangeStack(src, need);
                if (index === -1) break;
                const result = await exchange(index);
                rewards.push(result && result.reward ? result.reward : "?");
                if (rewards.includes(name)) break; // got what we wanted
            }
            if (rewards.length) {
                util.log("workshop", "opened " + rewards.length + "x " + src + " for " + name + ": " + rewards.join(", "), "green");
                return true;
            }
        }
        return false;
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
            if ((ex.hold || []).includes(name)) continue; // hoarded for a later batch
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
                    await boost("massexchange");
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
        // A fighter already wears one (e.g. a Hunter piece stopped below its wished level):
        // we never upgrade worn gear, and a second copy would only burn tokens.
        const wearer = Object.keys(worn).find(function (f) {
            return config.team.fighters.includes(f) && Object.values(worn[f] || {}).some(function (x) { return x && x.name === name; });
        });
        if (wearer) {
            util.log("workshop", wearer + " already wears " + name + " - not buying another for " + offer.price + " " + offer.token, "white");
            return false;
        }
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

    // Game source (server.js upgrade): every failed attempt at +L adds 1 player grace for +L,
    // whatever the item; it counts as min(3, fails / 4.5) plus the upgraded item's own
    // grace and a fixed term by its base grade (normal +1, high -1, rare -2), and is then
    // divided by L and 4.8 minus a threshold. So fodder grace only lifts items of normal
    // base grade (shop gear); high/rare items (fire weapons) gain ~0-1% (2026-11-16: 875k
    // of Wooden Basher failures moved the firebow +5 by 0%). A run that gained nothing
    // blocks that item and level for a day.
    const noGraceUntil = {}; // "item:level" -> timestamp
    function graceHelps(item, level) {
        const k = item.name + ":" + level;
        if (noGraceUntil[k] > Date.now()) return false;
        const normal = item_grade({ name: item.name, level: 0 }) === 0;
        if (!normal) {
            noGraceUntil[k] = Date.now() + 24 * 60 * 60 * 1000;
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
        await ensureScroll(gk, scroll, bulk || 1);
        await goTo("newupgrade");
        const i = util.findItemIndex(function (x) { return x.name === item.name && (x.level || 0) === (item.level || 0) && !x.l && !x.p; });
        if (i === -1) throw { reason: "fodder lost track" };
        if (check) {
            const why = check((await upgrade(i, bagIndex(scroll, 0), null, true)).chance);
            if (why) return { stop: why };
        }
        await boost("massproduction");
        const result = await upgrade(i, bagIndex(scroll, 0));
        return result.success ? "success" : "fail";
    }

    // Returns the new chance once it reaches minChance, or null when we gave up.
    async function farmGrace(level, minChance, targetChance, itemName) {
        const gk = "grace:" + level;
        const fodder = cfg.grace.fodder;
        const def = G.items[fodder];
        util.log("workshop", "building grace for +" + level + " with " + fodder + " (need " + pct(minChance) + ", budget " +
            Math.round(((spent[gk] || 0)) / 1000) + "k of " + Math.round(budgetFor(gk) / 1000) + "k today)", "yellow");
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
                const check = function (own) {
                    let why = null;
                    if (own > cap) {
                        why = "fodder already succeeds with " + pct(own) + " - another grace stack is unlikely";
                    } else if (lastFailed && lastOwn !== null && lastGain > 0) {
                        const perStack = Math.max(0, own - lastOwn);
                        const needed = Math.ceil((minChance - current) / lastGain);
                        const atLast = own + (needed - 1) * perStack;
                        if (atLast > cap) {
                            why = "needs ~" + needed + " more stacks (+" + pct(lastGain) + " each), the fodder would be at " +
                                pct(atLast) + " by then - not realistic";
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
                        " - fodder had " + pct(lastOwn), "white");
                    if (outcome === "fail") {
                        chance = await targetChance();
                        current = chance;
                        lastGain = chance - before;
                        lastFailed = true;
                        if (lastGain < 0.005) {
                            stopReason = "a grace stack gave the item " + pct(lastGain) + " - this fodder does not help it";
                            if (itemName) noGraceUntil[itemName + ":" + (level - 1)] = Date.now() + 24 * 60 * 60 * 1000;
                            break;
                        }
                        if (chance >= minChance) {
                            util.log("workshop", "grace done after " + tries + " attempts: +" + level + " now at " + pct(chance), "green");
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
        if (cfg.stockEnabled === false) return false; // paused (player decision 2026-11-16)
        const now = Date.now();
        for (const rule of cfg.stock || []) {
            if (dismantleOn(rule.name)) continue;
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
                blockedUntil[k] = Date.now() + pauseAfter(k, util.errReason(e));
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
            } else if (crafterOf(w.name)) {
                const r = await craftItem(k, w.name);
                if (!r.ok) {
                    util.log("workshop", "can't craft " + w.name + " yet - missing " +
                        r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                    r.missing.forEach(function (m) { noteIngredientShortage(m.name, m.level, m.need, w.name); });
                    blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                    return false;
                }
            } else if (await openSourceFor(w.name)) {
                return false; // a box/exchange was opened – its reward is random, look again next round
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

            // A wished stat goes on while the scroll is cheap: before the step into the
            // next grade (e.g. +6 -> +7: 1 stat scroll instead of 10).
            const stat = opts && opts.stat;
            if (stat && item.stat_type !== stat && G.items[w.name].stat) {
                const next = Object.assign({}, item, { level: level + 1 });
                if (item_grade(next) > item_grade(item)) {
                    await applyStat(index, stat, k);
                    index = util.findItemIndex(function (i) { return i.name === w.name && (i.level || 0) === level && i.stat_type === stat; });
                    if (index === -1) throw { reason: "working copy lost track" };
                    continue;
                }
            }

            const grade = item_grade(item);
            // Re-buyable from an NPC = replaceable (risk.shop); token/drop copies are risk.rare.
            const replaceable = opts && opts.replaceable !== undefined ? opts.replaceable : !!sellerOf(w.name);
            const minChance = opts && opts.minChance !== undefined ? opts.minChance : minChanceFor(item, replaceable, 1);
            let scroll = "scroll" + grade;
            // Weapons nobody sells, still normal grade (e.g. Lolipop Maces): from the step to
            // risk.higherScrollFrom on, the next scroll grade – x1.2 + 1 point for 40k instead of
            // burning copies we can't buy again (player decision 2026-11-17). A scroll two grades
            // higher adds nothing more (server.js).
            const hs = cfg.risk.higherScrollFrom;
            if (hs && grade === 0 && level + 1 >= hs && !sellerOf(w.name) && G.items[w.name].type === "weapon") scroll = "scroll1";
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
                // Still short on a valuable item at a higher level, but close (risk.graceWindow):
                // build grace with cheap fodder. Far below the floor, grace costs too much.
                const close = chance >= minChance - graceWindowFor(level + 1);
                if (!better && !spare && close && minChance > 0 && cfg.grace.enabled && level + 1 >= cfg.grace.minLevel &&
                    graceHelps(item, level)) {
                    const graced = await farmGrace(level + 1, minChance, async function () {
                        await ensureScroll(k, scroll, 1); // fodder attempts may have used our scrolls
                        await goTo("newupgrade");
                        return preview(bagIndex(scroll, 0));
                    }, w.name);
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
            await boost("massproduction");
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
    // The shop weapon to build for a fighter that wears a drop weapon, or null: the
    // class's starting weapon (staff, mace, bow), if at upTo it beats the worn one.
    // "Weapon done" for the full +7 gate: the worn weapon is at gearGoals.upTo, or at
    // least as strong as the class's shop weapon at upTo (a fire weapon at +5 can be).
    function weaponAtGoal(f) {
        const m = worn[f] && worn[f].mainhand;
        const ctype = classes[f];
        if (!m) return false;
        if ((m.level || 0) >= cfg.gearGoals.upTo) return true;
        const base = ctype && G.classes[ctype] && G.classes[ctype].base_slots && G.classes[ctype].base_slots.mainhand;
        const name = base && base.name;
        if (!name || !G.items[name]) return false;
        return util.weaponPower(m.name, m.level || 0, ctype) >= util.weaponPower(name, cfg.gearGoals.upTo, ctype);
    }

    function shopWeaponGoal(f) {
        const m = worn[f] && worn[f].mainhand;
        const ctype = classes[f];
        if (!m || !ctype || sellerOf(m.name)) return null; // nothing or a shop weapon in hand: normal goals
        const base = G.classes[ctype] && G.classes[ctype].base_slots && G.classes[ctype].base_slots.mainhand;
        const name = base && base.name;
        if (!name || !G.items[name] || !G.items[name].upgrade || !sellerOf(name)) return null;
        const bar = util.weaponPower(m.name, m.level || 0, ctype) * (1 + ((cfg.betterWeapons && cfg.betterWeapons.margin) || 0));
        return util.weaponPower(name, cfg.gearGoals.upTo, ctype) > bar ? name : null;
    }

    // Staged armor goals (player decision 2026-11-16): ALL of a fighter's shop armor
    // reaches one stage before any piece goes on to the next (gearGoals.stages, e.g.
    // 7 -> 8 -> 9). Returns the stage this fighter's armor is working on, or null.
    function armorStage(f) {
        const g = cfg.gearGoals;
        const stages = (g.stages && g.stages.length ? g.stages : [g.upTo]).slice().sort(function (a, b) { return a - b; });
        const levels = g.slots.filter(function (s) { return s !== "mainhand" && s !== "offhand"; }).map(function (s) {
            const w = worn[f] && worn[f][s];
            return w && sellerOf(w.name) && G.items[w.name] && G.items[w.name].upgrade ? (w.level || 0) : null;
        }).filter(function (l) { return l !== null; });
        if (!levels.length) return null;
        const low = Math.min.apply(null, levels);
        return stages.find(function (s) { return low < s; }) || null;
    }
    function finalStage() {
        const g = cfg.gearGoals;
        return g.stages && g.stages.length ? Math.max.apply(null, g.stages) : g.upTo;
    }

    function goalNeeds() {
        return goalNeedsAll().filter(function (n) { return Date.now() - (goalSentAt[n.fighter + ":" + n.slot] || 0) > 15 * 60 * 1000; });
    }
    function goalNeedsAll() {
        const g = cfg.gearGoals;
        const list = [];
        config.team.fighters.forEach(function (f) {
            const eq = worn[f];
            if (!eq) return;
            const stage = armorStage(f);
            // A drop weapon in hand (e.g. a Phoenix weapon): the class's shop weapon at
            // upTo may beat it – build that, the fighter switches, and the drop weapon is
            // then upgraded until it wins again (betterWeapons). Player idea 2026-11-15.
            const shopWeapon = shopWeaponGoal(f);
            if (shopWeapon) list.push({ fighter: f, slot: "mainhand", name: shopWeapon, stat: null, weapon: null, level: g.upTo });
            g.slots.forEach(function (slot) {
                const w = eq[slot];
                const def = w && G.items[w.name];
                // Offhand: only a second shop weapon (dual wield) – shields, books and
                // quivers stay out (player decision 2026-11-17); it goes to the weapon level.
                if (slot === "offhand" && (!def || def.type !== "weapon")) return;
                const target = slot === "mainhand" || slot === "offhand" ? g.upTo : stage;
                if (!target || !def || !def.upgrade || !sellerOf(w.name) || (w.level || 0) < g.fromLevel || (w.level || 0) >= target) return;
                // A drop weapon is being readied for this fighter: its shop weapon stays as it is.
                if (slot === "mainhand" && weaponPlans().some(function (p) { return p.fighter === f; })) return;
                // Stat armor: the worn piece's stat, else the fighter's main stat.
                const cls = classes[f] && G.classes[classes[f]];
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
        const w = worn[f] && worn[f][slot];
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
        config.team.fighters.forEach(function (f) { const n = shopWeaponGoal(f); if (n) names.add(n); });
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
        if (!goalsOn()) return [];
        return goalAssignments(goalNeeds()).filter(function (a) { return a.need.fighter === fighter; });
    }

    // Copies of gear-goal items (level 1+) are worth keeping: never sold – until the
    // goal is done for that item (player decision 2026-11-16): once every fighter
    // wearing it has it at upTo, the lower copies are outgrown shop gear.
    function isGoalStock(item) {
        if (!goalsOn() || !item || (item.level || 0) < 1 || !goalNames().has(item.name)) return false;
        return !isOutgrownGoalCopy(item);
    }
    function goalDoneFor(name) {
        const upTo = finalStage(); // lower copies are bases for the next stage until the last one
        if ((cfg.gearGoals.weapons || []).some(function (r) { return r.name === name; })) return false;
        if (config.team.fighters.some(function (f) { return shopWeaponGoal(f) === name; })) return false;
        let wearers = 0;
        const open = config.team.fighters.some(function (f) {
            if (!worn[f]) return true; // unknown yet: not done
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
        return goalsOn() && !!item && !!sellerOf(item.name) && (item.level || 0) < finalStage() &&
            goalNames().has(item.name) && goalDoneFor(item.name);
    }

    // Finished copies stay in the bag until they are delivered.
    function isGoalFinished(item) {
        if (!goalsOn() || !item || !goalNames().has(item.name)) return false;
        return goalNeedsAll().some(function (n) { return n.name === item.name && (item.level || 0) >= n.level; });
    }

    function kGold(x) {
        return Math.round(x / 1000) + "k";
    }

    function logBudget() {
        if (Date.now() - lastBudgetLog < 30 * 60 * 1000) return;
        lastBudgetLog = Date.now();
        const b = goalBudget();
        util.log("workshop", "gear goals wait for income: " + kGold(b.allowed) + " left (earned " + kGold(b.earned) + " in " +
            b.hours.toFixed(1) + " h, spent " + kGold(b.spent) + (b.moved ? ", " + kGold(b.moved) + " moved by hand not counted" : "") + ")", "orange");
    }

    // Apply the fighter's stat scroll (str/int/dex) to a finished copy.
    // Apply a stat scroll (str/int/dex) to the bag copy at `index`; spends from budget key k.
    async function applyStat(index, stat, k) {
        const budgetKey = k || GOALS;
        const item = character.items[index];
        const scroll = stat + "scroll";
        if (!G.items[scroll] || G.items[scroll].type !== "pscroll") throw { reason: "no stat scroll for " + stat };
        const need = [1, 10, 100, 1000][item_grade(item)] || 9999; // scrolls needed by item grade
        const missing = need - util.countItem(scroll);
        if (missing > 0) {
            const cost = missing * G.items[scroll].g;
            if (!canSpend(budgetKey, cost)) throw { reason: "budget" };
            await goTo(sellerOf(scroll));
            await buy(scroll, missing);
            pay(budgetKey, cost);
        }
        await goTo("newupgrade");
        const i = util.findItemIndex(function (x) {
            return x.name === item.name && (x.level || 0) === (item.level || 0) && x.stat_type === item.stat_type && !x.l;
        });
        if (i === -1) throw { reason: "finished copy lost track" };
        await boost("massproduction");
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
        // Weapons first (player request 2026-11-15): the risky spare weapons when grace
        // allows (else they wait 30 min), then the worn shop weapons, armor only after that.
        function rank(n) { return n.weapon ? 0 : n.slot === "mainhand" ? 1 : 2; }
        const open = needs.filter(function (n) { return !assigned.some(function (a) { return a.need === n; }); })
            .sort(function (a, b) { return rank(a) - rank(b); });
        if (!open.length || character.esize < 3) return false;

        const now = Date.now();
        try {
            for (const need of open) {
                // A reserved copy of this item waits for delivery: never use it as a base.
                if (activeEarmarks().some(function (e) { return e.name === need.name; })) continue;
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
                const bankedDone = bankFind(need.name, function (l) { return l >= need.level; });
                if (bankedDone) {
                    await retrieve(bankedDone);
                    return true;
                }

                const w = { name: need.name, level: need.level };
                if (need.weapon && need.weapon.full) {
                    // 3a. Fire weapon to upTo: develop the best spare copy (not the worn one).
                    if (weaponWaitUntil[need.name] > now) continue;
                    if (!totalCopies(need.name, function (l) { return l < need.level; })) continue;
                    util.status("upgrading " + need.name + " to +" + need.level + " for " + need.fighter, "orange");
                    await develop("_goal", w, { budgetKey: GOALS, minChance: need.weapon.minChance });
                    if (reachedOnly[GOALS] !== undefined) {
                        delete reachedOnly[GOALS];
                        weaponWaitUntil[need.name] = Date.now() + 30 * 60 * 1000;
                    }
                    return true;
                }
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
                const banked = bankFind(need.name, function (l) { return l < need.level; });
                if (banked && banked.level > bestBagLevel(need.name, need.level)) await retrieve(banked);
                util.status("gear goal: " + need.name + " +" + need.level + " for " + need.fighter, "orange");
                await develop("_goal", w, { budgetKey: GOALS, minChance: 0, spare: true, stat: need.stat });
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

    // ---- empty slots ---------------------------------------------------------
    //
    // A fighter with an empty slot (no belt, no amulet, ...) gets a fitting piece
    // from our bag or bank – anything usable beats nothing. The piece is earmarked
    // for the fighter and goes out with the normal deliveries; the fighter equips it
    // into the empty slot. Pieces boosting another class's main stat are skipped.

    const SLOTS_BY_TYPE = {
        weapon: ["mainhand"], shield: ["offhand"], source: ["offhand"], quiver: ["offhand"], misc_offhand: ["offhand"],
        helmet: ["helmet"], chest: ["chest"], pants: ["pants"], gloves: ["gloves"], shoes: ["shoes"], cape: ["cape"],
        amulet: ["amulet"], belt: ["belt"], orb: ["orb"], ring: ["ring1", "ring2"], earring: ["earring1", "earring2"],
    };
    const MAIN_STATS = ["str", "int", "dex"];
    const filledAt = {}; // "fighter|type" -> last delivery of such an item

    function usableBy(def, ctype) {
        const cls = G.classes[ctype] || {};
        if (def.class && !def.class.includes(ctype)) return false;
        if (def.type === "weapon") return !!((cls.mainhand || {})[def.wtype] || (cls.doublehand || {})[def.wtype]);
        if (["shield", "source", "quiver", "misc_offhand"].includes(def.type)) return !!(cls.offhand || {})[def.type];
        // Jewelry for another class's main stat (e.g. an STR amulet for a priest) is no help.
        const own = cls.main_stat;
        if (def[own] > 0) return true; // e.g. Ring of Small Joys: a bit of every stat
        return !MAIN_STATS.some(function (s) { return s !== own && def[s] > 0; });
    }

    function fillEmptySlots() {
        const fightersList = config.team.fighters.filter(function (f) { return worn[f] && classes[f]; });
        if (!fightersList.length) return;
        // Copies we hold, minus those already earmarked.
        const wished = {};
        fighters().forEach(function (f) { wishList(f).forEach(function (w) { wished[w.name] = true; }); });
        const pool = [];
        character.items.forEach(function (it) { if (it && !it.l && !it.p && !wished[it.name]) pool.push({ name: it.name, level: it.level || 0, stat: it.stat_type || null }); });
        (bankSnapshot ? bankSnapshot.items : []).forEach(function (b) { if (!wished[b.name]) pool.push({ name: b.name, level: b.level, stat: b.stat || null }); });
        activeEarmarks().forEach(function (e) {
            const i = pool.findIndex(function (p) { return p.name === e.name && p.level >= e.level && (!e.stat || p.stat === e.stat); });
            if (i !== -1) pool.splice(i, 1);
        });
        fightersList.forEach(function (f) {
            const eq = worn[f];
            Object.keys(SLOTS_BY_TYPE).forEach(function (type) {
                // Just delivered something of this type: wait for the fighter's next report.
                if (Date.now() - (filledAt[f + "|" + type] || 0) < 10 * 60 * 1000) return;
                const empty = SLOTS_BY_TYPE[type].filter(function (s) { return !eq[s]; }).length;
                const pending = activeEarmarks().filter(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === type; }).length;
                for (let n = pending; n < empty; n++) {
                    const i = pool.findIndex(function (p) {
                        const def = G.items[p.name];
                        // A piece with a stat scroll only goes to a fighter with that main stat
                        // (three Horse Leather Capes with STR/INT/DEX, 2026-11-17).
                        const own = G.classes[classes[f]] && G.classes[classes[f]].main_stat;
                        return def && def.type === type && usableBy(def, classes[f]) && !isGoalStock(p) &&
                            (!p.stat || !MAIN_STATS.includes(p.stat) || p.stat === own);
                    });
                    if (i === -1) return;
                    const p = pool.splice(i, 1)[0];
                    // Key by name: a second copy for the other ring/earring slot waits for the next round.
                    if (earmarks[f + "|" + p.name]) return;
                    earmark(f, p.name, p.level, p.stat);
                    util.log("workshop", p.name + " +" + p.level + (p.stat ? " " + p.stat : "") + " goes to " + f + " (empty " + type + " slot)", "yellow");
                }
            });
            // Dual wield (warrior): an empty offhand next to a one-handed weapon – or one
            // holding a clearly weaker weapon (e.g. the guide's blade) – gets the strongest
            // offhand-capable weapon we hold. Waits while a weapon is on its way.
            const cls = G.classes[classes[f]] || {};
            const offTypes = cls.offhand || {};
            if (!eq.mainhand || util.isDoublehand(eq.mainhand.name, classes[f])) return;
            const off = eq.offhand;
            if (off && !(G.items[off.name] && G.items[off.name].type === "weapon")) return; // a shield etc. stays
            const bw = cfg.betterWeapons || {};
            const bar = off ? util.weaponPower(off.name, off.level || 0, classes[f]) * (1 + (bw.margin || 0)) : 0;
            if (Date.now() - (filledAt[f + "|offhand"] || 0) < 10 * 60 * 1000) return;
            if (activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) return;
            let best = -1, bestPower = bar;
            pool.forEach(function (p, i) {
                const def = G.items[p.name];
                if (!def || def.type !== "weapon" || !offTypes[def.wtype] || earmarks[f + "|" + p.name]) return;
                const power = util.weaponPower(p.name, p.level, classes[f]);
                if (power > bestPower) { best = i; bestPower = power; }
            });
            if (best === -1) return;
            const p = pool.splice(best, 1)[0];
            earmark(f, p.name, p.level);
            filledAt[f + "|offhand"] = Date.now();
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
        (bankSnapshot ? bankSnapshot.items : []).forEach(function (b) { pool.push({ name: b.name, level: b.level, stat: b.stat || null }); });
        activeEarmarks().forEach(function (e) {
            const i = pool.findIndex(function (p) { return p.name === e.name && p.level >= e.level && (!e.stat || p.stat === e.stat); });
            if (i !== -1) pool.splice(i, 1);
        });
        fightersList.forEach(function (f) {
            const eq = worn[f];
            Object.keys(eq).forEach(function (slot) {
                const w = eq[slot];
                const def = w && G.items[w.name];
                if (!def || earmarks[f + "|" + w.name]) return;
                if (Date.now() - (filledAt[f + "|" + def.type] || 0) < 10 * 60 * 1000) return;
                const others = fighters().some(function (o) { return o !== f && wishList(o).some(function (x) { return x.name === w.name; }); });
                if (others) return;
                let best = -1;
                pool.forEach(function (p, i) {
                    if (p.name !== w.name || p.level <= (w.level || 0)) return;
                    if (w.stat && p.stat !== w.stat) return;
                    if (best === -1 || p.level > pool[best].level) best = i;
                });
                if (best === -1) return;
                const p = pool.splice(best, 1)[0];
                earmark(f, p.name, p.level, p.stat);
                util.log("workshop", p.name + " +" + p.level + (p.stat ? " " + p.stat : "") + " goes to " + f + " (better than its +" + (w.level || 0) + ")", "yellow");
            });
        });
    }

    // ---- better weapons (drops) -------------------------------------------------
    //
    // config.workshop.betterWeapons: drop weapons (e.g. Phoenix) are compared with the
    // fighters' worn weapons. A copy that is already stronger goes out; otherwise the best
    // copy is upgraded to the first level that beats the worn weapon.

    // Mainhand power of a fighter's worn weapon (0 = nothing worn).
    function wornPower(f) {
        const m = worn[f] && worn[f].mainhand;
        return m ? util.weaponPower(m.name, m.level || 0, classes[f]) : 0;
    }

    // Can fighter f wield this weapon (a two-handed one only with an empty offhand)?
    function canWield(f, name) {
        if (!classes[f] || !util.weaponPower(name, 0, classes[f])) return false;
        return !util.isDoublehand(name, classes[f]) || !(worn[f] && worn[f].offhand);
    }

    // { fighter, name, need } per drop weapon we hold: the fighter it helps most and the
    // first level (<= maxLevel) at which it beats that fighter's worn weapon.
    function weaponPlans() {
        const bw = cfg.betterWeapons;
        if (!bw || !bw.enabled) return [];
        const plans = [];
        (bw.names || []).forEach(function (name) {
            // Names on bw.buy (e.g. the Concord Mace) are bought with tokens when we hold none.
            const buyable = (bw.buy || []).includes(name) && !!tokenOffer(name);
            // Names on bw.craft (the "of the Dead" weapons) are crafted when we hold none – the
            // next weapon step once a fighter's weapon (shop or fire) is at gearGoals.upTo.
            const craftable = (bw.craft || []).includes(name) && !!crafterOf(name);
            if (!G.items[name] || (!unlockedCopies(name).length && !buyable && !craftable)) return;
            let plan = null;
            config.team.fighters.forEach(function (f) {
                if (!worn[f] || !canWield(f, name)) return;
                const m = worn[f].mainhand;
                if (m && m.name === name) return; // already wears one: gear goals take over
                // Not before the fighter is "full +7": weapon at upTo AND all shop armor past
                // the first stage (player decision 2026-11-16).
                if ((bw.craft || []).includes(name)) {
                    const stage = armorStage(f);
                    if (!weaponAtGoal(f) || (stage !== null && stage <= cfg.gearGoals.upTo)) return;
                }
                const bar = wornPower(f) * (1 + (bw.margin || 0));
                for (let level = 0; level <= bw.maxLevel; level++) {
                    if (util.weaponPower(name, level, classes[f]) <= bar) continue;
                    if (!plan || level < plan.need) plan = { fighter: f, name: name, need: level };
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
            if (earmarks[f + "|" + plan.name]) return;
            if (activeEarmarks().some(function (e) { return e.fighter === f && G.items[e.name] && G.items[e.name].type === "weapon"; })) return;
            if (Date.now() - (filledAt[f + "|weapon"] || 0) < 10 * 60 * 1000) return;
            const levels = unlockedCopies(plan.name).filter(function (l) { return l >= plan.need; });
            if (!levels.length) return;
            const level = Math.max.apply(null, levels);
            const m = worn[f].mainhand;
            earmark(f, plan.name, level);
            util.log("workshop", plan.name + " +" + level + " goes to " + f + " (stronger than its " +
                (m ? m.name + " +" + (m.level || 0) : "empty hand") + ")", "yellow");
        });
    }

    // One upgrade run for a drop weapon that isn't strong enough yet.
    async function workOnBetterWeapons() {
        const now = Date.now();
        for (const plan of weaponPlans()) {
            const k = key("_better", { name: plan.name, level: plan.need });
            if (blockedUntil[k] > now || earmarks[plan.fighter + "|" + plan.name]) continue;
            if (unlockedCopies(plan.name).some(function (l) { return l >= plan.need; })) continue; // ready to deliver
            if (character.esize < 3) return false;
            const bw = cfg.betterWeapons;
            if (!unlockedCopies(plan.name).length && (bw.craft || []).includes(plan.name)) {
                // A bw.craft weapon we don't hold yet: craft the +0 copy (missing ingredients,
                // e.g. Bones, are reported to the leader's drop routes).
                util.status("crafting " + plan.name + " for " + plan.fighter, "orange");
                try {
                    const r = await craftItem(GOALS, plan.name);
                    if (!r.ok) {
                        util.log("workshop", "can't craft " + plan.name + " yet - missing " + r.missing.map(function (m) { return (m.need - m.have) + "x " + m.name; }).join(", "), "orange");
                        r.missing.forEach(function (m) { noteIngredientShortage(m.name, m.level, m.need, plan.name); });
                        blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                    }
                } catch (e) {
                    util.log("workshop", "crafting " + plan.name + ": " + util.errReason(e), "orange");
                    blockedUntil[k] = Date.now() + pauseAfter(k, util.errReason(e));
                }
                return true;
            }
            if (!unlockedCopies(plan.name).length) {
                // A bw.buy weapon we don't hold yet: buy the +0 copy with tokens first.
                util.status("buying " + plan.name + " for " + plan.fighter, "orange");
                try {
                    if (!(await buyWithTokens(plan.name))) blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                } catch (e) {
                    util.log("workshop", "buying " + plan.name + ": " + util.errReason(e), "orange");
                    blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                }
                return true;
            }
            util.status("upgrading " + plan.name + " for " + plan.fighter, "orange");
            util.log("workshop", "upgrading " + plan.name + " to +" + plan.need + " - then it beats " + plan.fighter + "'s weapon", "yellow");
            // Drop weapons may break (player decision 2026-11-15); token weapons get a risk floor.
            const floor = bw.minChance && bw.minChance[plan.name];
            try {
                await develop("_better", { name: plan.name, level: plan.need }, { budgetKey: GOALS, replaceable: !floor, spare: true, minChance: floor || 0 });
                if (reachedOnly[GOALS] !== undefined) {
                    // Next step below the risk floor: try again later (luck or grace may help).
                    delete reachedOnly[GOALS];
                    blockedUntil[k] = Date.now() + cfg.giveUpForMs;
                }
            } catch (e) {
                const reason = util.errReason(e);
                util.log("workshop", plan.name + " +" + plan.need + ": " + reason, "orange");
                blockedUntil[k] = Date.now() + pauseAfter(k, reason);
            }
            return true;
        }
        return false;
    }

    // ---- one per character ----------------------------------------------------
    //
    // config.merchantRole.onePerCharacter (e.g. Tracktrix): every fighter that reports
    // not carrying one gets one; the merchant always keeps one for itself.

    function oneEachList() {
        return (config.merchantRole && config.merchantRole.onePerCharacter) || [];
    }

    // Items we can hand to this fighter now (we keep our own copy).
    function oneEachFor(fighter) {
        return oneEachList().filter(function (item) {
            return carries[fighter] && carries[fighter][item] === false && util.countItem(item) > 1;
        });
    }

    // Fetch copies from the bank until we hold one per lacking fighter plus our own.
    async function stockOneEach() {
        for (const item of oneEachList()) {
            const lacking = config.team.fighters.filter(function (f) { return carries[f] && carries[f][item] === false; }).length;
            if (util.countItem(item) >= lacking + 1) continue;
            const banked = bankSnapshot && bankSnapshot.items.find(function (b) { return b.name === item; });
            if (!banked || character.esize < 2) continue;
            await retrieve(banked);
            return true;
        }
        return false;
    }

    // ---- main step ----------------------------------------------------------

    // Fair order: every fighter's most important wish first, then everyone's second,
    // ... (rank = position in the fighter's guide list); on equal rank the fighter
    // served longest ago goes first.
    const lastServed = {}; // fighter -> when we last worked on one of its wishes
    function openWishes() {
        const now = Date.now();
        const list = [];
        fighters().forEach(function (fighter) {
            wishList(fighter).forEach(function (w, rank) {
                if (blockedUntil[key(fighter, w)] > now) return;
                list.push({ fighter: fighter, wish: w, rank: rank });
            });
        });
        return list.sort(function (a, b) {
            return a.rank - b.rank || (lastServed[a.fighter] || 0) - (lastServed[b.fighter] || 0);
        });
    }

    // One unit of work. Returns the fighters that now have something waiting.
    const readySince = {}; // fighter -> since when something waits for it
    let lastGoalStep = 0;  // last gear-goal unit of work
    // Weapon ladder (config.workshop.bruteForce, player decision 2026-11-16): high-grade
    // drop weapons (fire weapons) can't be helped by grace (-1 on them), so spare copies
    // are tried right away with the normal scroll – but only one level above the WEAKEST
    // worn copy of that item in the team (a warrior's two fireblades both count). A spare
    // that gets there is delivered (deliverBetterCopies swaps it in), the old worn copy
    // comes back as the next spare, and only once every worn copy is at the top level does
    // the next level start. Worn copies are never risked; nothing happens while a copy
    // of that item is on its way to a fighter.
    function spareLadderCopies() {
        const bf = cfg.bruteForce;
        if (!bf || !bf.names) return 0;
        return bf.names.filter(function (n) { return !dismantleOn(n); }).reduce(function (sum, n) { return sum + unlockedCopies(n).length; }, 0);
    }
        async function bruteForceSpares() {
        const bf = cfg.bruteForce;
        if (!bf || !bf.names) return false;
        const now = Date.now();
        for (const name of bf.names) {
            if (dismantleOn(name)) continue; // config.dismantle: no upgrades, essence instead
            const levels = [];
            config.team.fighters.forEach(function (f) {
                const eq = worn[f];
                if (!eq) return;
                ["mainhand", "offhand"].forEach(function (s) { if (eq[s] && eq[s].name === name) levels.push(eq[s].level || 0); });
            });
            if (!levels.length) continue; // nobody wears it: spares wait
            let target = Math.min.apply(null, levels) + 1;
            // Hoard (player decision 2026-11-16): above bf.hoardAt nothing is risked – spares
            // only climb to hoardAt and stay there (later: server grace peaks, Primlings).
            const capped = !!bf.hoardAt && target > bf.hoardAt;
            if (capped) target = bf.hoardAt;
            if (target > (bf.maxLevel || 9)) continue;
            const k = key("_brute", { name: name, level: target });
            if (blockedUntil[k] > now) continue;
            if (activeEarmarks().some(function (e) { return e.name === name; })) continue; // a better copy is on its way
            const spares = unlockedCopies(name);
            if (!spares.some(function (l) { return l < target; })) continue; // nothing left to climb
            if (!capped && spares.some(function (l) { return l >= target; })) continue; // one is ready to deliver
            if (character.esize < 3) return false;
            const best = Math.max.apply(null, spares.filter(function (l) { return l < target; }));
            util.status("upgrading a spare " + name + " +" + best + " towards +" + target, "orange");
            util.log("workshop", "spare " + name + " +" + best + " -> +" + target + (capped ? " (kept there)" : " (weakest worn +" + (target - 1) + ")"), "white");
            try {
                await develop("_brute", { name: name, level: target }, { budgetKey: LADDER, minChance: 0, spare: true });
            } catch (e) {
                const why = util.errReason(e);
                util.log("workshop", name + " +" + target + ": " + why, "orange");
                blockedUntil[k] = Date.now() + pauseAfter(k, why);
            }
            return true;
        }
        return false;
    }

    // Box armor in parallel (config.workshop.boxArmor, player decision 2026-11-17): armor
    // boxes give all five Rugged pieces, but only one is wished at a time – the others
    // would fill the bank. While a fighter wishes any piece of the set, every spare copy
    // of every piece is upgraded towards upTo right away (normal scroll, no floor, no
    // grace – high grade): failures free bank slots, and the later chain steps are ready
    // early. One copy per piece at upTo is enough; nothing happens without such a wish.
    // Spare copies of wished box armor still below upTo (bag + bank).
    function waitingBoxArmor() {
        const b = cfg.boxArmor;
        if (!b || !b.names) return 0;
        return b.names.filter(function (n) {
            return fighters().some(function (f) { return wishList(f).some(function (w) { return w.name === n; }); });
        }).reduce(function (sum, n) {
            const copies = unlockedCopies(n);
            if (copies.some(function (l) { return l >= b.upTo; })) return sum;
            return sum + copies.filter(function (l) { return l < b.upTo; }).length;
        }, 0);
    }

    async function upgradeBoxArmor() {
        const b = cfg.boxArmor;
        if (!b || !b.names || !b.names.length) return false;
        // Only pieces some fighter still wishes (each Rugged chain is its own wish; a piece
        // worn at upTo is no longer wished, so no second copy is built for it).
        const wanted = b.names.filter(function (n) {
            return fighters().some(function (f) { return wishList(f).some(function (w) { return w.name === n; }); });
        });
        if (!wanted.length) return false;
        const now = Date.now();
        for (const name of wanted) {
            const k = key("_box", { name: name, level: b.upTo });
            if (blockedUntil[k] > now) continue;
            const copies = unlockedCopies(name);
            if (!copies.length || copies.some(function (l) { return l >= b.upTo; })) continue; // none, or one done
            if (character.esize < 3) return false;
            util.status("upgrading spare " + name + " +" + Math.max.apply(null, copies) + " towards +" + b.upTo, "orange");
            try {
                await develop("_box", { name: name, level: b.upTo }, { budgetKey: GOALS, minChance: 0, spare: true });
            } catch (e) {
                const why = util.errReason(e);
                util.log("workshop", name + " +" + b.upTo + ": " + why, "orange");
                blockedUntil[k] = Date.now() + pauseAfter(k, why);
            }
            return true;
        }
        return false;
    }

    // Shop armor with a stat nobody in the team still builds (player decision 2026-11-17):
    // e.g. gloves +7 STR once the only STR fighter wears +8 – priest/ranger need INT/DEX.
    // Copies in a stat some team fighter still wears below the final stage stay as bases.
    function isOrphanStatCopy(item) {
        if (!goalsOn() || !item || !item.stat_type || !sellerOf(item.name)) return false;
        const def = G.items[item.name];
        if (!def || !def.stat || (item.level || 0) >= finalStage()) return false;
        return !config.team.fighters.some(function (f) {
            const eq = worn[f] || {};
            return Object.keys(eq).some(function (s) {
                const w = eq[s];
                return w && w.name === item.name && w.stat === item.stat_type && (w.level || 0) < finalStage();
            });
        });
    }

    // Rings of Small Joys up to +2 once every team fighter wears two rings that are at least
    // as good – a Ring of Joy +2 or another ring at +2 (stat rings) – player decision
    // 2026-11-17. Copies above +2 stay: they still beat a worn +2.
    function isSpareJoyRing(item) {
        if (!item || item.name !== "ringsj" || (item.level || 0) > 2) return false;
        return config.team.fighters.every(function (f) {
            const eq = worn[f];
            if (!eq) return false;
            return ["ring1", "ring2"].every(function (s) { return eq[s] && (eq[s].level || 0) >= 2; });
        });
    }

    // A box armor piece we are done with (player decision 2026-11-17): nobody wishes it any
    // more and a fighter wears it at upTo (or we hold a copy at upTo) – further copies from
    // the boxes are sold. The copy at upTo itself is kept.
    function isDoneBoxArmor(item) {
        const b = cfg.boxArmor;
        if (!b || !item || !(b.names || []).includes(item.name) || (item.level || 0) >= b.upTo) return false;
        if (fighters().some(function (f) { return wishList(f).some(function (w) { return w.name === item.name; }); })) return false;
        const wornDone = config.team.fighters.some(function (f) {
            const eq = worn[f] || {};
            return Object.keys(eq).some(function (s) { return eq[s] && eq[s].name === item.name && (eq[s].level || 0) >= b.upTo; });
        });
        return wornDone || unlockedCopies(item.name).some(function (l) { return l >= b.upTo; });
    }

    async function work() {
        if (!cfg.enabled) return;

        // Ping fighters that have finished items waiting.
        sampleIncome();
        reportDrops();
        // Earmark what is ready now (it stays reserved even if the wish changes).
        fighters().forEach(function (fighter) {
            wishList(fighter).forEach(function (w) {
                if (wishIndex(w, targetLevel(fighter, w)) !== -1) earmark(fighter, w.name, targetLevel(fighter, w), w.stat);
            });
        });
        // Deliver in batches: call fighters only once every wish we can work on right now
        // is done, or when a finished item has waited deliveryBatchMs. (A fighter that
        // calls us anyway – potions, full bag, routine – gets everything that is ready.)
        const stillWorkable = openWishes().some(function (o) { return wishIndex(o.wish, targetLevel(o.fighter, o.wish)) === -1; });
        const waiting = {};
        fighters().concat(activeEarmarks().map(function (e) { return e.fighter; })).forEach(function (f) { waiting[f] = true; });
        Object.keys(waiting).forEach(function (fighter) {
            const ready = readyFor(fighter).length || goalReadyFor(fighter).length || oneEachFor(fighter).length;
            if (!ready) { delete readySince[fighter]; return; }
            if (!readySince[fighter]) readySince[fighter] = Date.now();
            if (!stillWorkable || Date.now() - readySince[fighter] >= (cfg.deliveryBatchMs || 0)) comms.send(fighter, "ready", {});
        });

        if (!bankSnapshot || Date.now() - bankSnapshot.at > cfg.bankScanEveryMs) {
            util.status("checking the bank", "yellow");
            await util.walk("bank");
            readBank();
        }

        if (await workOwnWishes()) return; // the merchant's own stand and tools come first
        if (await dismantleDrops()) return; // spare drop weapons into material (config.dismantle)
        if (await stockOneEach()) return;
        fillEmptySlots();
        deliverBetterWeapons();

        // Earmarked items that ended up in the bank come out first; vanished ones are dropped.
        for (const e of activeEarmarks()) {
            if (wishIndex(e, e.level) !== -1) continue;
            const banked = bankSnapshot && bankSnapshot.items.filter(function (b) { return b.name === e.name && b.level >= e.level && (!e.stat || b.stat === e.stat); }).sort(function (a, b) { return b.level - a.level; })[0];
            if (banked && character.esize >= 2) {
                await retrieve(banked);
                return;
            }
            if (!banked) {
                delete earmarks[e.fighter + "|" + e.name];
                saveEarmarks();
            }
        }

        // A finished copy that only lacks the wished stat gets it right away: the scroll is a
        // sure step, while its wish may rank behind accessories that stay open for hours
        // (the Rugged Coat +7 waited for the warrior's STR, 2026-11-17).
        for (const o of openWishes()) {
            if (!o.wish.stat) continue;
            const lvl = targetLevel(o.fighter, o.wish);
            if (wishIndex(o.wish, lvl) !== -1) continue;
            const idx = character.items.findIndex(function (it) {
                return it && !it.l && it.name === o.wish.name && (it.level || 0) >= lvl && it.stat_type !== o.wish.stat;
            });
            if (idx === -1) continue;
            const k = key(o.fighter, o.wish);
            try {
                util.status(o.wish.stat + " scroll for " + o.wish.name + " (" + o.fighter + ")", "orange");
                await applyStat(idx, o.wish.stat, k);
                return;
            } catch (e) {
                util.log("workshop", "no " + o.wish.stat + " for " + o.wish.name + " +" + lvl + " yet: " + util.errReason(e), "orange");
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
        }

        // Waiting box armor copies are upgraded every round (not only every gear-goal step),
        // before the wish job opens new boxes.
        if (waitingBoxArmor() >= 3 && await upgradeBoxArmor()) return;
        // Same for the fire weapon ladder: solo Phoenix kills bring ~2 weapons each, far more
        // than the 3-minute step could work through (player decision 2026-11-17).
        if (spareLadderCopies() >= 3 && await bruteForceSpares()) return;
        // A tight bank comes first: every compound (3 -> 1) frees two slots, and the armor
        // boxes for the Rugged chain only open with 10 free (2026-11-17: 83 of 84 used).
        if (bankSnapshot && bankSnapshot.free < ((cfg.exchange || {}).onDemandBankFree || 10) && await autoCompound()) return;
        const open = openWishes().filter(function (o) { return wishIndex(o.wish, targetLevel(o.fighter, o.wish)) === -1; });
        if (!open.length) {
            if (await autoCompound()) return;
            if (await stockUpgrade()) return;
            lastGoalStep = Date.now();
            if (await workOnBetterWeapons()) return;
            if (await bruteForceSpares()) return;
            if (await upgradeBoxArmor()) return;
            if (await workOnGoals()) return;
            await autoExchange();
            return;
        }
        // Gear goals also get a turn every few minutes while wishes are open, so armor
        // and weapons keep growing while the guide waits on accessories.
        if (goalsOn() && Date.now() - lastGoalStep >= (cfg.gearGoals.everyMs || 0)) {
            lastGoalStep = Date.now();
            // Compounding frees bank slots (3 -> 1): with wishes that never close (cape, class
            // orb) it used to wait for an idle moment that never came (2026-11-17).
            if (await autoCompound()) return;
            if (await workOnBetterWeapons()) return;
            if (await bruteForceSpares()) return;
            if (await upgradeBoxArmor()) return;
            if (await workOnGoals()) return;
            // Exchanging used to wait for a moment without open wishes – with the Rugged
            // wishes that never came, and 45 Tiny Rubies piled up (2026-11-17).
            if (await autoExchange()) return;
        }

        const job = open[0];
        lastServed[job.fighter] = Date.now();
        const k = key(job.fighter, job.wish);
        util.status("working on " + job.wish.name + " +" + job.wish.level, "orange");
        try {
            // A copy at the wished level that only lacks the stat: apply the stat scroll.
            if (job.wish.stat) {
                const lvl = targetLevel(job.fighter, job.wish);
                const idx = character.items.findIndex(function (it) {
                    return it && !it.l && it.name === job.wish.name && (it.level || 0) >= lvl && it.stat_type !== job.wish.stat;
                });
                if (idx !== -1) {
                    util.status(job.wish.stat + " scroll for " + job.wish.name, "orange");
                    await applyStat(idx, job.wish.stat, k);
                    return;
                }
            }
            const banked = bankFind(job.wish.name, function (l) { return l >= job.wish.level; });
            if (banked) {
                await retrieve(banked);
                return;
            }
            await develop(job.fighter, job.wish, job.wish.stat ? { stat: job.wish.stat } : undefined);
            if (job.wish.full && reachedOnly[k] !== undefined) {
                // Only the complete piece is wanted (e.g. Hunter armor at +7): keep the copy
                // and try the next step later – luck or grace may help.
                util.log("workshop", job.wish.name + " stays at +" + reachedOnly[k] + " for now - " + job.fighter + " only wants +" + job.wish.level, "white");
                delete reachedOnly[k];
                blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
        } catch (e) {
            const reason = util.errReason(e);
            util.log("workshop", job.wish.name + " +" + job.wish.level + " for " + job.fighter + ": " + reason, reason === "budget" ? "orange" : "red");
            blockedUntil[k] = Date.now() + pauseAfter(k, reason);
        }
    }

    return {
        work: work, handOver: handOver, isReserved: isReserved, readyFor: readyFor,
        isGoalStock: isGoalStock, isGoalFinished: isGoalFinished, isOutgrownGoalCopy: isOutgrownGoalCopy,
        isDoneBoxArmor: isDoneBoxArmor, isOrphanStatCopy: isOrphanStatCopy, isSpareJoyRing: isSpareJoyRing,
        classOf: function (fighter) { return classes[fighter] || null; },
        oneEachFor: oneEachFor,
        markCarried: function (fighter, item) { (carries[fighter] = carries[fighter] || {})[item] = true; },
        // What the workshop is waiting on (logged every 10 min by the merchant): open wishes
        // with their pause, and what the budget pots still allow.
        report: function () {
            const now = Date.now();
            const list = [];
            fighters().forEach(function (f) {
                wishList(f).forEach(function (w) {
                    if (wishIndex(w, targetLevel(f, w)) !== -1) return; // ready for delivery
                    // Only what is being worked on (player request 2026-11-17): paused ones are left out.
                    if ((blockedUntil[key(f, w)] || 0) > now) return;
                    list.push(w.name + "+" + w.level + " " + f.replace(/^Dmpx/, ""));
                });
            });
            const k = function (n) { return Math.round(n / 1000) + "k"; };
            return "budget: goals " + k(goalBudget().allowed) + ", ladder " + k(ladderBudget().allowed) +
                " | working on: " + (list.slice(0, 6).join(", ") || "nothing") + (list.length > 6 ? " ..." : "");
        },
        isOwnWish: isOwnWish,
        // Units of an item we hold (bag + last bank snapshot), e.g. for the stand's buy orders.
        ownedCount: ownedCount,
        bankKnown: function () { return !!bankSnapshot; },
        // A copy waiting to be dismantled stays in the bag (unless dismantling is paused).
        waitsForDismantle: function (item) {
            return (blockedUntil._dismantle || 0) <= Date.now() && isDismantleCopy(item);
        },
    };
};
