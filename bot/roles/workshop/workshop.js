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
// least the risk tier's chance (config.workshop.risk - all floors 0 since
// 2026-11-19; a higher scroll grade is
// tried when the normal one falls short), never spend below the gold reserve,
// at most budgetPerWish
// per wish (a safety cap; all gear spending comes out of the gear pot since 2026-11-19), no offerings, no shells. Upgradeable items are upgraded step by
// step; compound items (rings, earrings, books, ...) are built from three
// matching copies per level out of bag and bank (copies can't be bought).
// Without open wishes (and every gearGoals.everyMs while wishes are open),
// spare compound items are combined up to
// config.workshop.compound.autoUpTo (same chance/budget rules), drop weapons
// are worked on (gearPlan.weapons lists / betterWeapons), box armor is
// upgraded, the fighters' worn gear is pushed to
// config.workshop.gearGoals.upTo with an income-based budget, then
// boxes/gems/seashells from config.workshop.exchange.items are exchanged.
// Weapons made from a material (fire weapons from the Phoenix's essence,
// Of-the-Dead from Bones) go through materialGoals first; spare drop copies
// are dismantled into that material (config.dismantle).
// We only ever work on our own copies – worn gear is never risked.
// Finished items are handed over on the next delivery; the fighter gets a
// "ready" ping so it calls the merchant right away.
// =====================================================================

const PARTS = [
    require("./common.js"),
    require("./wishes.js"),
    require("./bank.js"),
    require("./budget.js"),
    require("./crafting.js"),
    require("./compound.js"),
    require("./dismantle.js"),
    require("./material-goals.js"),
    require("./exchange.js"),
    require("./grace.js"),
    require("./gear-goals.js"),
    require("./off-plan-armor.js"),
    require("./better-weapons.js"),
    require("./scrolls.js"),
    require("./ponty.js"),
];

module.exports = function createWorkshop(ctx) {
    // Outside dependencies of the parts (module plan, stage 6).
    const deps = { config: ctx.config, util: ctx.util, comms: ctx.comms };
    // The internal state shared by the parts; they put their functions here too (the facade's as well).
    const wks = { oneEachList: oneEachList, oneEachOwn: oneEachOwn, oneEachFor: oneEachFor, stockOneEach: stockOneEach, openWishes: openWishes, waitingBoxArmor: waitingBoxArmor, upgradeBoxArmor: upgradeBoxArmor, isOrphanStatCopy: isOrphanStatCopy, isSpareJoyRing: isSpareJoyRing, isDoneBoxArmor: isDoneBoxArmor, work: work, workRound: workRound };
    PARTS.forEach(function (install) { install(wks, deps); });

    // ---- state, start-up and the facade's own functions, in the old order (the parts' functions are all there
    // already, as the hoisted functions were) ----
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.workshop;

    // fighter -> [{ name, level }] from its progression guide. Kept across restarts (up to
    // 6 h): right after a merchant restart the wishes were empty, so isReserved() let the
    // sell list sell the HP belts the warrior wishes for (2026-11-17).
    const WISHES_KEY = "workshop_wishes:" + character.name;
    wks.wishes = (function () {
        try {
            const saved = get(WISHES_KEY) || {};
            if (saved.at && Date.now() - saved.at < 6 * 60 * 60 * 1000) return saved.list || {};
        } catch (e) { /* storage unavailable */ }
        return {};
    })();
    wks.spent = {};       // wish key -> gold spent
    // wish key -> timestamp (gave up for a while). Kept across restarts (v1.224.3, player decision 2026-11-23): three merchant
    // restarts in 15 min cleared every 1-hour lock, and the Orb of Strength / Winged Boots tries came back each time.
    const BLOCKS_KEY = "workshop_blocks:" + character.name;
    let blockSets = 0; // locks set so far - a round that only set locks found nothing to do (work() below)
    wks.blockedUntil = (function () {
        const now = Date.now();
        const t = {};
        try {
            const saved = get(BLOCKS_KEY) || {};
            Object.keys(saved).forEach(function (k) { if (saved[k] > now) t[k] = saved[k]; });
        } catch (e) { /* storage unavailable */ }
        return new Proxy(t, {
            set: function (obj, k, v) {
                obj[k] = v;
                if (v > Date.now()) blockSets++;
                try {
                    const n = Date.now(), out = {};
                    Object.keys(obj).forEach(function (x) { if (obj[x] > n) out[x] = obj[x]; });
                    set(BLOCKS_KEY, out);
                } catch (e) { /* storage unavailable */ }
                return true;
            },
        });
    })();
    wks.reachedOnly = {}; // wish key -> level we stopped at (too risky to go on) – delivered as is
    wks.graceSince = Date.now(); // start of the current 24 h grace budget window
    // Kept across restarts (2026-11-20): on a Ponty round the merchant starts on another server
    // and must not walk to the bank first. A snapshot older than 3 h is not trusted.
    wks.BANK_KEY = "workshop_bank:" + character.name;
    wks.bankSnapshot = (function () {
        try { const s = get(wks.BANK_KEY); return s && Date.now() - s.at < 3 * 60 * 60 * 1000 ? s : null; } catch (e) { return null; }
    })(); // { at, items: [{ pack, index, name, level }] }

    // Delivered wishes are not fulfilled again for a while (survives restarts).
    // Storage is shared by every character in the client: keys carry the merchant's name.
    wks.DELIVERED_KEY = "workshop_delivered:" + character.name;
    // Keyed by fighter, item, level and stat: a helmet +0 does not block a later helmet +3.
    wks.delivered = wks.loadDelivered(); // "fighter:name:level:stat" -> timestamp

    // What each fighter wears (sent with its wishes; survives restarts) – for gear goals.
    const WORN_KEY = "workshop_worn:" + character.name;
    wks.worn = (function () {
        try { return get(WORN_KEY) || {}; } catch (e) { return {}; }
    })();

    wks.classes = {}; // fighter -> ctype (sent with its wishes)
    // Known from the account's character list right away (2026-11-22 review): after a merchant restart, and for
    // offline fighters, classes stayed empty until a "wishes" message came - weapon goals, shop weapon goals and
    // their isGoalStock protection were missing meanwhile (weaponPower without a class is 0).
    try {
        ((config.team && config.team.fighters) || []).forEach(function (f) {
            const c = ((parent.X && parent.X.characters) || []).find(function (x) { return x.name === f; });
            if (c && G.classes[c.type]) wks.classes[f] = c.type;
        });
    } catch (e) { /* filled by the wishes messages */ }
    const carries = {}; // fighter -> { item: true/false } for one-per-character items
    // Gold a fighter handed over (shown apart from sales in the budget line; every gold rise
    // is income since 2026-11-19).
    comms.on("gold", function (data) {
        const a = Math.round((data && data.a) || 0);
        if (a <= 0) return;
        wks.income.credits = wks.income.credits || [];
        wks.income.credits.push({ t: Date.now(), a: a });
        wks.saveIncome();
    });
    // Value report (stage 1): the fighters' XP value and the leader's per-copy farm times.
    // Kept across restarts (v1.238.5, 2026-11-25): every Ponty hop reopens the merchant, and each restart emptied them -
    // the team's XP value was unknown and the leader farmed its XP spot for 15-25 min (14:07 and 15:39 that day). Entries
    // whose XP rate is older than VALUES_MS are dropped at the start.
    wks.VALUES_KEY = "workshop_values:" + character.name;
    wks.VALUES_MS = 30 * 60 * 1000;
    wks.fighterValues = (function () {
        const out = {};
        try {
            const saved = get(wks.VALUES_KEY) || {};
            Object.keys(saved).forEach(function (f) {
                const v = saved[f];
                if (v && Date.now() - (v.xpAt || v.at || 0) < wks.VALUES_MS) out[f] = v;
            });
        } catch (e) { /* storage unavailable */ }
        return out;
    })();
    // Kept across restarts: without them every wish needing drops sorts as "unknown" for 15 min.
    wks.dropTimes = (function () { try { return get("bot_drop_times") || {}; } catch (e) { return {}; } })();
    // Team gold per hour given up while farming each drop (leader's guide, player decision
    // 2026-11-20): ownCost values drop hours with it instead of our whole gold/hour.
    // v1.150.0: measured team gold only; the old key held costs from the guide calibration.
    const COSTS_KEY = "bot_drop_costs_v2";
    wks.dropCosts = (function () { try { return get(COSTS_KEY) || {}; } catch (e) { return {}; } })();
    wks.costAsk = {}; // items ownCost had no drop cost for (asked with the next value report)
    comms.on("droptimes", function (data, from) {
        if (from !== config.leader) return;
        Object.assign(wks.dropTimes, data.times || {});
        try { set("bot_drop_times", wks.dropTimes); } catch (e) { /* storage unavailable */ }
        if (!data.basis) {
            // The leader's normal spot is not measured: no costs, so no wish orders on guesses.
            Object.keys(wks.dropCosts).forEach(function (n) { delete wks.dropCosts[n]; });
            try { set(COSTS_KEY, wks.dropCosts); } catch (e) { /* storage unavailable */ }
            return;
        }
        if (data.costs) {
            Object.assign(wks.dropCosts, data.costs);
            Object.keys(data.costs).forEach(function (n) { delete wks.costAsk[n]; });
            try { set(COSTS_KEY, wks.dropCosts); } catch (e) { /* storage unavailable */ }
        }
    });
    comms.on("wishes", function (data, from) {
        if (data.value) {
            const old = wks.fighterValues[from];
            const v = Object.assign({ at: Date.now() }, data.value);
            // A fighter that just restarted has no XP rate for its first ~10 min: its last known rate stays while it is
            // younger than VALUES_MS (v1.238.5) - the team's XP value no longer drops out after each fighter reload.
            if (typeof v.xpPower !== "number" && old && typeof old.xpPower === "number" && Date.now() - (old.xpAt || old.at || 0) < wks.VALUES_MS) {
                v.xpPower = old.xpPower;
                v.xpPerHour = old.xpPerHour;
                v.xpAt = old.xpAt || old.at;
                v.xpKept = true;
            } else if (typeof v.xpPower === "number") v.xpAt = Date.now();
            wks.fighterValues[from] = v;
            try { set(wks.VALUES_KEY, wks.fighterValues); } catch (e) { /* storage unavailable */ }
        }
        wks.wishes[from] = (data.list || []).filter(function (w) { return w && G.items[w.name]; });
        try { set(WISHES_KEY, { at: Date.now(), list: wks.wishes }); } catch (e) { /* storage unavailable */ }
        if (data.ctype && G.classes[data.ctype]) wks.classes[from] = data.ctype;
        if (data.has) carries[from] = data.has;
        if (data.worn) {
            wks.worn[from] = data.worn;
            try { set(WORN_KEY, wks.worn); } catch (e) { /* storage unavailable */ }
        }
    });

    // Class chains from the back (2026-11-22, player decision - like the weapon lists): a fighter wishes the first step
    // of a gearPlan chain it has not reached. When we hold a copy (any level) of a LATER item of that chain, that one is
    // worked on instead - the furthest such item, at its first step's level (a Dracul's Attire +0 in the bank: Attire +7
    // while the warrior still wishes Rugged). Paused there (blocked): one item further to the front. The fighter takes
    // the delivered piece as the further chain step.
    wks.backMemo = {}; // fighter|name|level -> { at, w } (wishList runs often; 2 s is fresh enough)

    // Fighters playing now (v1.225.0, player decision 2026-11-23): nothing is built in the background for characters that are
    // not played. A fighter counts as online while its heartbeat ("bot_beat:<name>", every 10 s) is fresher than
    // workshop.onlineMs. Planning - wishes, gear and material goals, weapons, Ponty buys, deliveries - serves only them;
    // protection (what is reserved, never sold or re-scrolled) still counts every fighter (allFighters, config.team.fighters).
    wks.onlineCache = {};

    // ---- earmarks -----------------------------------------------------------
    //
    // A fighter's wish list keeps changing (top rows of its guide). Once an item is
    // ready for a fighter it is earmarked for it and stays reserved – never sold or
    // banked – until it is delivered, even if the wish drops off the list. Earmarks
    // survive restarts and expire after 12 h.
    wks.EARMARK_KEY = "workshop_earmarks:" + character.name;
    wks.EARMARK_MS = 12 * 60 * 60 * 1000;
    wks.earmarks = (function () { // "fighter|name" -> { fighter, name, level, at }
        try { return get(wks.EARMARK_KEY) || {}; } catch (e) { return {}; }
    })();

    // ---- income-based budget for gear goals ---------------------------------
    //
    // Direct booking (player decision 2026-11-19): every rise of the merchant's gold is income
    // (fighter handovers, stand and NPC sales, parcels - no gold comes from anywhere else, the
    // bot never takes gold from the bank), every drop is spending; both go into 10-minute
    // buckets for the last 24 h. Income for the pots = gross income - consumables, where
    // consumables are the spending the workshop did not book (potions, buy-order materials).
    // Gear may spend incomeShare of that, minus what it already spent. No transfer rule any
    // more: a 3M+ jump (mummy handovers, a pricey stand sale) is income like any other.
    wks.GOALS = "goals"; // budget key of the gear goals
    wks.LADDER = "ladder"; // budget key of the weapon ladder (its own income share)
    wks.INCOME_KEY = "workshop_income:" + character.name;
    wks.DAY = 24 * 60 * 60 * 1000;
    wks.income = (function () {
        let x = null;
        try {
            const saved = get(wks.INCOME_KEY);
            if (saved && Array.isArray(saved.samples) && Array.isArray(saved.spends)) x = saved;
        } catch (e) { /* storage unavailable */ }
        x = x || { samples: [], spends: [], total: 0 };
        // First run with direct booking: the fighters' handovers already logged are income.
        if (!Array.isArray(x.flow)) x.flow = (x.credits || []).map(function (c) { return { t: c.t, in: c.a, out: 0 }; });
        return x;
    })();
    // Gold changes, checked four times a second (a purchase and a handover in the same moment
    // would cancel out; at 250 ms that is rare and small). The last booked gold is stored, so a
    // change while the bot was stopped (e.g. a sale by hand) is booked on the next start.
    wks.lastGold = typeof wks.income.lastGold === "number" ? wks.income.lastGold : character.gold;
    wks.flowSavedAt = 0;
    setInterval(wks.noteGold, 250);

    // Grace spending survives restarts and resets after 24 h.
    wks.GRACE_KEY = "workshop_grace_spent:" + character.name;
    (function loadGraceSpent() {
        try {
            const saved = get(wks.GRACE_KEY) || {};
            if (saved.since && Date.now() - saved.since < 24 * 60 * 60 * 1000) {
                Object.keys(saved.spent || {}).forEach(function (k) { wks.spent[k] = saved.spent[k]; });
                wks.graceSince = saved.since;
            }
        } catch (e) { /* storage unavailable */ }
    })();

    // ---- drop shortages ----------------------------------------------------------
    //
    // Wished items we can't build for lack of copies (and config.drops.want) are
    // reported to the leader, whose guide finds the drop route (bot_drops).

    // Survives restarts: otherwise the leader drops a drop target (e.g. Porcupine Leather)
    // after every merchant restart until the next failed craft notes it again.
    wks.SHORT_KEY = "workshop_shortages:" + character.name;
    wks.shortages = (function () { // name -> { level, at, need?, forItem? }
        try { return get(wks.SHORT_KEY) || {}; } catch (e) { return {}; }
    })();
    wks.nextDropReportAt = 0;

    // ---- material goals (config.materialGoals, player decision 2026-11-22) -------------------------
    //
    // One set of rules for every material a weapon is crafted from - Essence of Fire (fire weapons) and
    // Bones (Of-the-Dead weapons); a new material is one more entry in config.materialGoals.materials.
    // Was: the essence goals (2026-11-18) plus Bones rules spread over the weapon planner (2026-11-21).
    //   goals:    per fighter and weapon hand, every material item of its class's weapon list
    //             (gearPlan.weapons) that beats the worn weapon at its goal level; priority = its place
    //             from the back of the list (1 = last item). Fighters without a list: the best material
    //             item that beats the worn weapon (priority 1). Plus the material's config extras.
    //   order:    the lowest priority number first; higher ones wait (deferred): nothing is crafted for
    //             them, and their +0 copies are dismantled into material - unless the item is not on
    //             config.dismantle.names (e.g. the Sword of the Dead: its Short Sword is rare), then held
    //             copies are still upgraded. Buying is never held back.
    //   work:     one craft-and-upgrade run per round: a held copy below the goal is the base, else one is
    //             crafted from the material (+ its shop base); a failure starts over with the next copy.
    //   deliver:  "better" - the best copy that beats the fighter's weaker worn weapon, and upgrades go step
    //             by step to the first level that does (the replaced weapon comes back as the next base);
    //             "goal" - straight to the goal level, delivered there (the fire weapons before 2026-11-22).
    //   buying:   sources (+0 items that dismantle into the material) up to sourceMaxPrice while a goal
    //             still wants bases, rare bases (no shop sells them) up to their price while material
    //             waits for one.
    wks.MG = config.materialGoals || {};
    wks.materials = {};
    wks.lastBorrowLog = 0;
    wks.elixirRefill = false;

    // Game source (server.js upgrade): every failed attempt at +L adds 1 player grace for +L,
    // whatever the item; it counts as min(3, fails / 4.5) plus the upgraded item's own
    // grace and a fixed term by its base grade (normal +1, high -1, rare -2), and is then
    // divided by L and 4.8 minus a threshold. So fodder grace only lifts items of normal
    // base grade (shop gear); high/rare items (fire weapons) gain ~0-1% (2026-11-16: 875k
    // of Wooden Basher failures moved the firebow +5 by 0%). A run that gained nothing
    // blocks that item and level for a day.
    wks.noGraceUntil = {}; // "item:level" -> timestamp

    // Upgrade tries per day for "item:level" (workshop.dailyTries, 2026-11-22: Dracul's Attire +8 at most 3 a day).
    wks.TRY_KEY = "workshop_tries:" + character.name;
    wks.tries = (function () { try { return get(wks.TRY_KEY) || {}; } catch (e) { return {}; } })();

    // ---- gear goals -------------------------------------------------------------
    //
    // config.workshop.gearGoals: stronger copies of what the fighters wear.
    // Shop armor and shop weapons go through gearGoals.stages (team-wide) up to upTo
    // whatever the chance: a failure costs only gold, a success is a finished piece.
    // Drop-weapon rules (gearGoals.weapons: a spare copy at upTo-1 once grace raised
    // its chance to minChance) are off - the list is empty and grace is disabled;
    // drop weapons go through materialGoals and gearPlan.weapons. Finished copies get
    // the fighter's stat scroll and are delivered; spending follows the income budget above.

    wks.goalSentAt = {};      // "fighter:slot" -> delivered at (until the new worn report arrives)
    wks.weaponWaitUntil = {}; // weapon name -> timestamp (chance too low, waiting for grace)
    wks.goalsPausedUntil = 0;
    wks.lastBudgetLog = 0;

    // ---- off-plan armor (player decision 2026-11-22) ---------------------------------------
    // The gear goals push the WORN piece up - a slot holding something outside the class's gear plan was
    // skipped for good: the ranger's lucky T-Shirt +3 (9 DEX, nothing else) kept the merchant from ever
    // building him a Coat +8 (12 DEX, 12 armor, 10 resistance). Now an armor slot that is empty or holds a
    // piece outside its ladder (gearPlan: shop piece, equivalents for the parallel group, wish chains with
    // their alts, found items - for this class) gets the ladder's next step: a wish chain with "replace"
    // (Rugged for tanks, Wanderer's for the priest) already handles it; otherwise the shop piece at the
    // current stage, with the main stat - if it is at least as good as the worn piece in main stat and in
    // armor + resistance (and better in one). The equip pass decides with the game's valuation as before.
    wks.ARMOR_SLOTS = ["helmet", "chest", "pants", "shoes", "gloves"];
    wks.offPlanLogged = {};

    // ---- empty slots ---------------------------------------------------------
    //
    // A fighter with an empty slot (no belt, no amulet, ...) gets a fitting piece
    // from our bag or bank – anything usable beats nothing. The piece is earmarked
    // for the fighter and goes out with the normal deliveries; the fighter equips it
    // into the empty slot. Pieces boosting another class's main stat are skipped.

    wks.SLOTS_BY_TYPE = {
        weapon: ["mainhand"], shield: ["offhand"], source: ["offhand"], quiver: ["offhand"], misc_offhand: ["offhand"],
        helmet: ["helmet"], chest: ["chest"], pants: ["pants"], gloves: ["gloves"], shoes: ["shoes"], cape: ["cape"],
        amulet: ["amulet"], belt: ["belt"], orb: ["orb"], ring: ["ring1", "ring2"], earring: ["earring1", "earring2"],
    };
    wks.MAIN_STATS = ["str", "int", "dex"];
    wks.filledAt = {}; // "fighter|type" -> last delivery of such an item

    wks.NO_EQUIP = new Set(((config.gear && config.gear.noEquip) || []).map(function (n) { return G.items[n]; }).filter(Boolean));

    // ---- value report (stage 1, player request 2026-11-19) ------------------------
    //
    // Logs, without acting on it: for every open wish the gain (% more power, from the
    // fighter), its expected cost (gold from the game's success tables, +0 copies to farm
    // with the leader's per-copy times) and gain per hour (gold counted as hours of income).
    // Plus each fighter's XP value (% power per hour from levels). Later stages will order
    // the wishes and pick the team's farm target by these numbers.
    wks.nextValueAt = Date.now() + 2 * 60 * 1000;
    // Cached for a minute (openWishes runs several times per round).
    wks.valueCache = {};
    wks.valueGoldAt = 0, wks.valueGold = null;

    // ---- Ponty (player request 2026-11-19, fresh account) --------------------------
    //
    // Every market.ponty.everyMs the merchant looks at Ponty's listings (players' items sold
    // to NPCs, price = item value x 2, x 3 for shell items) and buys what a fighter wishes or
    // a gear goal needs, when it beats our best copy and costs less than making it ourselves
    // (our gold cost, plus farm hours counted at our gold per hour). Paid from the gear pot;
    // the copy then goes out through the usual deliveries.
    wks.nextPontyAt = Date.now() + 60 * 1000;
    wks.bestPerGold = 0; // % power per gold of our best gold-only upgrade (value report)
    wks.FINDS_KEY = "bot_ponty_finds";
    // Every Ponty purchase, kept across restarts for the player's review (last 200).
    wks.BOUGHT_KEY = "bot_ponty_bought";
    wks.reachCache = {}; // ponty.js reachChance: name -> cached chances (a minute)
    wks.lastPontyVisit = null; // { items, bought }

    // ---- one per character ----------------------------------------------------
    //
    // config.merchantRole.onePerCharacter (e.g. Tracktrix): every fighter that reports
    // not carrying one gets one; the merchant always keeps one for itself.

    function oneEachList() {
        return (config.merchantRole && config.merchantRole.onePerCharacter) || [];
    }

    // The merchant's own copy (merchantRole.onePerCharacterKeepOwn, default true).
    function oneEachOwn() { return config.merchantRole.onePerCharacterKeepOwn === false ? 0 : 1; }

    // Items we can hand to this fighter now (keeping our own copy when configured).
    function oneEachFor(fighter) {
        return oneEachList().filter(function (item) {
            return carries[fighter] && carries[fighter][item] === false && util.countItem(item) > oneEachOwn();
        });
    }

    // Copies for every fighter that reports lacking one (only online fighters report): from
    // the bank first, else bought with tokens when the token NPC sells it (Tracktrix: 4
    // Monster Tokens at Daisy - player decision 2026-11-19).
    async function stockOneEach() {
        for (const item of oneEachList()) {
            const lacking = config.team.fighters.filter(function (f) { return carries[f] && carries[f][item] === false; }).length;
            if (!lacking || util.countItem(item) >= lacking + oneEachOwn()) continue;
            if (character.esize < 2) continue;
            const banked = wks.bankSnapshot && wks.bankSnapshot.items.find(function (b) { return b.name === item; });
            if (banked) {
                await wks.retrieve(banked);
                return true;
            }
            if (wks.tokenOffer(item) && (await wks.buyWithTokens(item))) return true;
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
        wks.fighters().forEach(function (fighter) {
            wks.wishList(fighter).forEach(function (w, rank) {
                if (wks.blockedUntil[wks.key(fighter, w)] > now) return;
                if (wks.materialDeferred(w.name)) return; // a material goal waiting for a higher priority (2026-11-21)
                list.push({ fighter: fighter, wish: w, rank: rank });
            });
        });
        // Item stages (gear plan, player decision 2026-11-19): a compound item goes up level by
        // level across the team - a wish for STR rings +4 waits while another fighter's STR-ring
        // wish at +3 still has no copy. Other items never block it.
        const staged = list.filter(function (o) {
            const def = G.items[o.wish.name];
            if (!def || !def.compound) return true;
            return !list.some(function (x) {
                return x !== o && x.wish.name === o.wish.name && x.wish.level < o.wish.level && !wks.copyAtLeast(x.wish.name, x.wish.level);
            });
        });
        // Order by value (stage 2, player decision 2026-11-19): first what we can work on now
        // without farming (copies and ingredients in hand), most gain per gold first; then the
        // rest in the fighters' order; wishes without measurable gain (Wanderer's set) last.
        if (cfg.valueReport && cfg.valueReport.orderWishes) {
            staged.forEach(function (o) { o.v = wks.cachedValue(o.fighter, o.wish); });
            const tier = function (o) {
                if (!o.v) return 1;                   // no gain number (e.g. carried mode weapons)
                if (o.v.gain <= 0) return 2;          // a bonus, not stronger
                return o.v.farmH > 0 || o.v.unknown.length ? 1 : 0;
            };
            const perGold = function (o) { return o.v.gold > 0 ? o.v.gain / o.v.gold : Number.MAX_VALUE; };
            return staged.sort(function (a, b) {
                const ta = tier(a), tb = tier(b);
                if (ta !== tb) return ta - tb;
                if (ta === 0 && perGold(a) !== perGold(b)) return perGold(b) > perGold(a) ? 1 : -1;
                // Needs farming: most gain per hour first (gold + farm time); unknown times after.
                if (ta === 1 && a.v && b.v) {
                    const va = a.v.value === null ? -1 : a.v.value, vb = b.v.value === null ? -1 : b.v.value;
                    if (va !== vb) return vb - va;
                }
                return a.rank - b.rank || (lastServed[a.fighter] || 0) - (lastServed[b.fighter] || 0);
            });
        }
        return staged.sort(function (a, b) {
            return a.rank - b.rank || (lastServed[a.fighter] || 0) - (lastServed[b.fighter] || 0);
        });
    }

    // One unit of work. Returns the fighters that now have something waiting.
    const readySince = {}; // fighter -> since when something waits for it
    let lastGoalStep = 0;  // last gear-goal unit of work
    let lastBonusStep = 0; // last unit of work on a bonus wish (no measurable gain, e.g. Wanderer's set)
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
            return wks.fighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === n; }); });
        }).reduce(function (sum, n) {
            const copies = wks.unlockedCopies(n);
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
            return wks.fighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === n; }); });
        });
        if (!wanted.length) return false;
        const now = Date.now();
        for (const name of wanted) {
            const k = wks.key("_box", { name: name, level: b.upTo });
            if (wks.blockedUntil[k] > now) continue;
            const copies = wks.unlockedCopies(name);
            if (!copies.length || copies.some(function (l) { return l >= b.upTo; })) continue; // none, or one done
            if (character.esize < 3) return false;
            util.status("upgrading spare " + name + " +" + Math.max.apply(null, copies) + " towards +" + b.upTo, "orange");
            // The wished stat goes on before the step into the next grade, like on the wish
            // path: Rugged +6 takes 10 scrolls, +7 takes 100 (2026-11-18: Rugged Shoes +7 got
            // their STR at +7 for ~800k instead of ~80k).
            let stat = null;
            wks.fighters().some(function (f) {
                const w = wks.wishList(f).find(function (x) { return x.name === name && x.stat; });
                if (w) stat = w.stat;
                return !!w;
            });
            try {
                await wks.develop("_box", { name: name, level: b.upTo }, { budgetKey: wks.GOALS, minChance: 0, spare: true, stat: stat });
            } catch (e) {
                const why = util.errReason(e);
                util.log("workshop", name + " +" + b.upTo + ": " + why, "orange");
                wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, why);
            }
            return true;
        }
        return false;
    }

    // Shop armor with a stat nobody in the team still builds (player decision 2026-11-17):
    // e.g. gloves +7 STR once the only STR fighter wears +8 – priest/ranger need INT/DEX.
    // Copies in a stat some team fighter still wears below the final stage stay as bases.
    function isOrphanStatCopy(item) {
        if (!wks.goalsOn() || !item || !item.stat_type || !wks.sellerOf(item.name)) return false;
        if (wks.statCopyWanted(item)) return false;
        const def = G.items[item.name];
        if (!def || !def.stat || (item.level || 0) >= wks.finalStage()) return false;
        return !config.team.fighters.some(function (f) {
            const eq = wks.worn[f] || {};
            return Object.keys(eq).some(function (s) {
                const w = eq[s];
                return w && w.name === item.name && w.stat === item.stat_type && (w.level || 0) < wks.finalStage();
            });
        });
    }

    // Rings of Small Joys up to +2 once every team fighter wears two rings that are at least
    // as good – a Ring of Joy +2 or another ring at +2 (stat rings) – player decision
    // 2026-11-17. Copies above +2 stay: they still beat a worn +2.
    function isSpareJoyRing(item) {
        if (!item || item.name !== "ringsj" || (item.level || 0) > 2) return false;
        return config.team.fighters.every(function (f) {
            const eq = wks.worn[f];
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
        if (wks.allFighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === item.name; }); })) return false;
        // A +0 copy of a piece nobody wears and nobody wishes (2026-11-23, player decision): the warrior went from the Rugged
        // Coat +7 on to Dracul's Attire, so no Coat is ever built to upTo - four +0 copies sat in the full bank.
        // Only once every fighter's gear is known; higher copies stay (they cost upgrades).
        if (!(item.level || 0) && config.team.fighters.every(function (f) { return !!wks.worn[f]; }) &&
            !config.team.fighters.some(function (f) {
                const eq = wks.worn[f] || {};
                return Object.keys(eq).some(function (s) { return eq[s] && eq[s].name === item.name; });
            })) return true;
        const wornDone = config.team.fighters.some(function (f) {
            const eq = wks.worn[f] || {};
            return Object.keys(eq).some(function (s) { return eq[s] && eq[s].name === item.name && (eq[s].level || 0) >= b.upTo; });
        });
        return wornDone || wks.unlockedCopies(item.name).some(function (l) { return l >= b.upTo; });
    }

    // One workshop round and what it came to (v1.224.4, player decision 2026-11-23 - between two upgrades the merchant
    // stood idle for 30 s per job it found it couldn't do):
    //   "did"     - bag or bank changed: the merchant's next round comes after a few seconds;
    //   "blocked" - only new locks (no copies, missing ingredient, too risky ...): the next job is tried at once;
    //   "idle"    - nothing to do: the merchant's usual 30 s.
    async function work() {
        const state = function () {
            // Not the gold: stand sales and fighters' gold would count as work. Every purchase changes the bag anyway.
            return character.items.map(function (i) { return i ? i.name + ":" + (i.level || 0) + ":" + (i.q || 1) : "-"; }).join(",") +
                "|" + (wks.bankSnapshot ? wks.bankSnapshot.at : 0);
        };
        const before = state(), sets = blockSets;
        await workRound();
        if (state() !== before) return "did";
        return blockSets > sets ? "blocked" : "idle";
    }
    async function workRound() {
        if (!cfg.enabled) return;

        // Ping fighters that have finished items waiting.
        wks.sampleIncome();
        wks.reportDrops();
        wks.valueReport();
        // Earmark what is ready now (it stays reserved even if the wish changes).
        wks.fighters().forEach(function (fighter) {
            wks.wishList(fighter).forEach(function (w) {
                if (wks.wishIndex(w, wks.targetLevel(fighter, w)) !== -1) wks.earmark(fighter, w.name, wks.targetLevel(fighter, w), w.stat);
            });
        });
        // Deliver in batches: call fighters only once every wish we can work on right now
        // is done, or when a finished item has waited deliveryBatchMs. (A fighter that
        // calls us anyway – potions, full bag, routine – gets everything that is ready.)
        const stillWorkable = openWishes().some(function (o) { return wks.wishIndex(o.wish, wks.targetLevel(o.fighter, o.wish)) === -1; });
        const waiting = {};
        wks.fighters().concat(wks.activeEarmarks().map(function (e) { return e.fighter; })).forEach(function (f) { waiting[f] = true; });
        Object.keys(waiting).forEach(function (fighter) {
            const ready = wks.readyFor(fighter).length || wks.goalReadyFor(fighter).length || oneEachFor(fighter).length;
            if (!ready) { delete readySince[fighter]; return; }
            if (!readySince[fighter]) readySince[fighter] = Date.now();
            if (!stillWorkable || Date.now() - readySince[fighter] >= (cfg.deliveryBatchMs || 0)) comms.send(fighter, "ready", {});
        });

        if (!wks.bankSnapshot || Date.now() - wks.bankSnapshot.at > cfg.bankScanEveryMs) {
            util.status("checking the bank", "yellow");
            if (!(await util.walkToBank())) return; // walk cut short: next round
            wks.readBank();
        }

        if (await wks.workOwnWishes()) return; // the merchant's own stand and tools come first
        if (await wks.statBeforeDelivery()) return; // ready items get the receiver's main stat first (v1.226.2)
        if (await wks.dismantleDrops()) return; // spare drop weapons into material (config.dismantle)
        if (await stockOneEach()) return;
        if (await wks.shopPonty()) return; // Ponty: wished items cheaper than making them (market.ponty)
        wks.fillEmptySlots();
        wks.deliverBetterWeapons();
        wks.deliverMaterialGoals();

        // Earmarked items that ended up in the bank come out first; vanished ones are dropped.
        for (const e of wks.activeEarmarks()) {
            if (wks.wishIndex(e, e.level) !== -1) continue;
            const banked = wks.bankSnapshot && wks.bankSnapshot.items.filter(function (b) { return b.name === e.name && b.level >= e.level && (!e.stat || b.stat === e.stat); }).sort(function (a, b) { return b.level - a.level; })[0];
            if (banked && character.esize >= 2) {
                await wks.retrieve(banked);
                return;
            }
            if (!banked) {
                // By its own key (2026-11-22 review): the second copy of a weapon pair sits under "|2" - deleting
                // fighter|name left it for up to 12 h, blocking every weapon delivery for that fighter.
                const key = Object.keys(wks.earmarks).find(function (k) { return wks.earmarks[k] === e; }) || e.fighter + "|" + e.name;
                delete wks.earmarks[key];
                wks.saveEarmarks();
            }
        }

        // A finished copy that only lacks the wished stat gets it right away: the scroll is a
        // sure step, while its wish may rank behind accessories that stay open for hours
        // (the Rugged Coat +7 waited for the warrior's STR, 2026-11-17).
        for (const o of openWishes()) {
            if (!o.wish.stat) continue;
            const lvl = wks.targetLevel(o.fighter, o.wish);
            if (wks.wishIndex(o.wish, lvl) !== -1) continue;
            const idx = character.items.findIndex(function (it) {
                return it && !it.l && it.name === o.wish.name && (it.level || 0) >= lvl && wks.restatOk(it, o.wish, o.fighter);
            });
            if (idx === -1) continue;
            const k = wks.key(o.fighter, o.wish);
            try {
                util.status(o.wish.stat + " scroll for " + o.wish.name + " (" + o.fighter + ")", "orange");
                await wks.applyStat(idx, o.wish.stat, k);
                return;
            } catch (e) {
                util.log("workshop", "no " + o.wish.stat + " for " + o.wish.name + " +" + lvl + " yet: " + util.errReason(e), "orange");
                wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
        }

        // Waiting box armor copies are upgraded every round (not only every gear-goal step),
        // before the wish job opens new boxes.
        if (waitingBoxArmor() >= 3 && await upgradeBoxArmor()) return;
        // Material goals (config.materialGoals: essence, Bones) every round as well, after the box armor copies.
        if (await wks.workOnMaterialGoals()) return;
        // A tight bank comes first: every compound (3 -> 1) frees two slots, and the armor
        // boxes for the Rugged chain only open with 10 free (2026-11-17: 83 of 84 used).
        if (wks.bankSnapshot && wks.bankSnapshot.free < ((cfg.exchange || {}).onDemandBankFree || 10) && await wks.autoCompound()) return;
        const open = openWishes().filter(function (o) { return wks.wishIndex(o.wish, wks.targetLevel(o.fighter, o.wish)) === -1; });
        if (!open.length) {
            if (await wks.autoCompound()) return;
            lastGoalStep = Date.now();
            if (await wks.workOnBetterWeapons()) return;
            if (await upgradeBoxArmor()) return;
            if (await wks.workOnGoals()) return;
            await wks.autoExchange();
            return;
        }
        // Gear goals also get a turn every few minutes while wishes are open, so armor
        // and weapons keep growing while the guide waits on accessories.
        if (wks.goalsOn() && Date.now() - lastGoalStep >= (cfg.gearGoals.everyMs || 0)) {
            lastGoalStep = Date.now();
            // Compounding frees bank slots (3 -> 1): with wishes that never close (cape, class
            // orb) it used to wait for an idle moment that never came (2026-11-17).
            if (await wks.autoCompound()) return;
            if (await wks.workOnBetterWeapons()) return;
            if (await upgradeBoxArmor()) return;
            if (await wks.workOnGoals()) return;
            // Exchanging used to wait for a moment without open wishes – with the Rugged
            // wishes that never came, and 45 Tiny Rubies piled up (2026-11-17).
            if (await wks.autoExchange()) return;
        }

        // Bonus wishes (gain 0, e.g. the Wanderer's set: its luck bonus is not in the valuation) sort
        // last and were only reached when everything else was blocked - the priest's Wanderer pieces
        // never moved (player decision 2026-11-21): like the gear goals they get one unit of work every
        // bonusWishes.everyMs while other wishes are open.
        let job = open[0];
        const bw = cfg.bonusWishes || {};
        if (bw.everyMs && Date.now() - lastBonusStep >= bw.everyMs) {
            const bonus = open.find(function (o) { const v = o.v || wks.cachedValue(o.fighter, o.wish); return !!v && v.gain <= 0; });
            if (bonus) { job = bonus; lastBonusStep = Date.now(); }
        }
        lastServed[job.fighter] = Date.now();
        const k = wks.key(job.fighter, job.wish);
        util.status("working on " + job.wish.name + " +" + job.wish.level, "orange");
        try {
            // A copy at the wished level that only lacks the stat: apply the stat scroll.
            if (job.wish.stat) {
                const lvl = wks.targetLevel(job.fighter, job.wish);
                const idx = character.items.findIndex(function (it) {
                    return it && !it.l && it.name === job.wish.name && (it.level || 0) >= lvl && wks.restatOk(it, job.wish, job.fighter);
                });
                if (idx !== -1) {
                    util.status(job.wish.stat + " scroll for " + job.wish.name, "orange");
                    await wks.applyStat(idx, job.wish.stat, k);
                    return;
                }
            }
            // A banked copy carrying another fighter's wished stat stays where it is.
            const banked = wks.bankSnapshot && wks.bankSnapshot.items.filter(function (b) {
                return b.name === job.wish.name && b.level >= job.wish.level &&
                    (!job.wish.stat || b.stat === job.wish.stat || !wks.statReserved(b.stat, b.name, job.fighter));
            }).sort(function (a, b) { return b.level - a.level; })[0];
            if (banked) {
                await wks.retrieve(banked);
                return;
            }
            await wks.develop(job.fighter, job.wish, job.wish.stat ? { stat: job.wish.stat } : undefined);
            if (job.wish.full && wks.reachedOnly[k] !== undefined) {
                // Only the complete piece is wanted (e.g. Hunter armor at +7): keep the copy
                // and try the next step later – luck or grace may help.
                util.log("workshop", job.wish.name + " stays at +" + wks.reachedOnly[k] + " for now - " + job.fighter + " only wants +" + job.wish.level, "white");
                delete wks.reachedOnly[k];
                wks.blockedUntil[k] = Date.now() + cfg.giveUpForMs;
            }
        } catch (e) {
            const reason = util.errReason(e);
            util.log("workshop", job.wish.name + " +" + job.wish.level + " for " + job.fighter + ": " + reason, reason === "budget" ? "orange" : "red");
            wks.blockedUntil[k] = Date.now() + wks.pauseAfter(k, reason);
        }
    }

    return {
        work: work, handOver: wks.handOver, isReserved: wks.isReserved,
        isGoalStock: wks.isGoalStock, isGoalFinished: wks.isGoalFinished, isOutgrownGoalCopy: wks.isOutgrownGoalCopy,
        isDoneBoxArmor: isDoneBoxArmor, isOrphanStatCopy: isOrphanStatCopy, isSpareJoyRing: isSpareJoyRing,
        fillsEmptySlot: wks.fillsEmptySlot,
        classOf: function (fighter) { return wks.classes[fighter] || null; },
        oneEachFor: oneEachFor,
        markCarried: function (fighter, item) { (carries[fighter] = carries[fighter] || {})[item] = true; },
        // What the workshop is waiting on (logged every 10 min by the merchant): open wishes
        // with their pause, and what the budget pots still allow.
        report: function () {
            const now = Date.now();
            const list = [];
            wks.fighters().forEach(function (f) {
                wks.wishList(f).forEach(function (w) {
                    if (wks.wishIndex(w, wks.targetLevel(f, w)) !== -1) return; // ready for delivery
                    // Only what is being worked on (player request 2026-11-17): paused ones are left out.
                    if ((wks.blockedUntil[wks.key(f, w)] || 0) > now) return;
                    list.push(w.name + "+" + w.level + " " + util.shortName(f));
                });
            });
            const k = function (n) { return Math.round(n / 1000) + "k"; };
            return "budget: goals " + k(wks.goalBudget().allowed) + ", ladder " + k(wks.ladderBudget().allowed) +
                " (24h: in " + k(wks.goalBudget().gross) + " - fighters " + k(wks.goalBudget().fighters) +
                ", sales/other " + k(wks.goalBudget().gross - wks.goalBudget().fighters) + "; consumables " + k(wks.goalBudget().consumables) +
                "; gear spent " + k(wks.goalBudget().spent) + ")" +
                " | working on: " + (list.slice(0, 6).join(", ") || "nothing") + (list.length > 6 ? " ..." : "") +
                wks.materialReport();
        },
        wishBuyOrders: wks.wishBuyOrders,
        bookWishFill: wks.bookWishFill,
        playerOffers: wks.playerOffers,
        bookPlayerBuy: wks.bookPlayerBuy,
        // Ponty round (merchantRole.pontyRound): one visit now; { items, bought } or null.
        pontyVisit: async function () {
            wks.lastPontyVisit = null;
            await wks.shopPonty(true);
            return wks.lastPontyVisit;
        },
        needsCopy: wks.needsCopy,
        // Units of an item we hold (bag + last bank snapshot), e.g. for the stand's buy orders.
        ownedCount: wks.ownedCount,
        bankKnown: function () { return !!wks.bankSnapshot; },
        // Bag indexes about to go out to a fighter (ready wishes, earmarks): they stay in the bag
        // even when it runs full (merchant bankTrip, 2026-11-20).
        deliveryIndexes: function () {
            const out = new Set();
            wks.fighters().forEach(function (f) {
                wks.readyFor(f).forEach(function (w) {
                    const i = wks.wishIndex(w, wks.targetLevel(f, w));
                    if (i !== -1) out.add(i);
                });
            });
            return out;
        },
        // Re-read the bank (only while inside it) after the merchant took things out itself: the
        // snapshot counted them twice for up to bankScanEveryMs - bag and "bank" (review 2026-11-20:
        // the 20 kept Monster Tokens could be sold).
        refreshBank: function () { return wks.readBank(); },
        // A copy waiting to be dismantled stays in the bag (unless dismantling is paused).
        waitsForDismantle: function (item) {
            return (wks.blockedUntil._dismantle || 0) <= Date.now() && wks.isDismantleCopy(item);
        },
    };

};
