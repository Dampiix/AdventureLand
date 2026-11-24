// =====================================================================
// bot_merchant – the merchant supports the fighters.
//
// Idle (in town near the potion shop):
//   - sell items from config.merchantRole.sellList (shiny and locked
//     items never; upgraded ones only up to the entry's maxLevel)
//   - bag running full -> store everything else in the bank
//     (config.merchantRole.bank), never buying new bank packs
//   - keep a potion stock (config.merchantRole.stockPerPotion, built only
//     from stockFromGold gold), never spending
//     below goldReserve (a share of our gold, so a fresh merchant still works)
//   - work on the fighters' equipment wishes (bot_workshop)
// Delivery (a fighter sent a "pickup" request):
//   - top up the stock, walk to the fighter
//   - send the potions it asked for, gifts and finished wishes,
//     cast Merchant's Luck on it
//   - wait a moment: the fighter hands over loot and surplus gold
//   - walk back to town
// =====================================================================

const PARTS = [
    require("./stand.js"),
    require("./fishing.js"),
    require("./selling.js"),
    require("./elixirs.js"),
    require("./delivery.js"),
    require("./bank-trips.js"),
    require("./ponty-round.js"),
    require("./sell-to.js"),
    require("./mluck.js"),
];

module.exports = function createMerchant(ctx) {
    // Outside dependencies of the parts (module plan, stage 6b).
    const deps = { config: ctx.config, util: ctx.util, comms: ctx.comms, workshop: ctx.workshop, get scout() { return ctx.scout; } };
    // The internal state shared by the parts; they put their functions here too (the facade's as well).
    const mer = { canSupply: canSupply, survive: survive, work: work, loop: loop };
    PARTS.forEach(function (install) { install(mer, deps); });

    // ---- state, start-up and the facade's own functions, in the old order (the parts' functions are all there
    // already, as the hoisted functions were) ----
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const m = config.merchantRole;
    const workshop = ctx.workshop;

    mer.requests = new Map(); // fighter name -> latest pickup request
    let running = false;
    let busy = false;
    let nextChoresAt = 0;     // selling/restocking runs at most every 30 s
    let nextReportAt = 0;     // workshop status report in the log
    let lastRespawnTry = 0;

    comms.on("pickup", function (data, from) {
        const isNew = !mer.requests.has(from);
        mer.requests.set(from, Object.assign({}, data, { at: Date.now() }));
        Object.keys(data.want || {}).forEach(function (name) {
            if (!G.items[name] || G.items[name].type !== "pot") return;
            mer.stocked.set(name, Date.now());
            if (!mer.users.has(name)) mer.users.set(name, new Map());
            mer.users.get(name).set(from, Date.now());
        });
        if (isNew) util.log("merchant", "pickup requested by " + from, "yellow");
        // Tell the fighter whether we can bring its potions; if not, it buys them itself.
        comms.send(from, "coming", { potions: canSupply(data.want) });
    });

    // Position updates of a fighter we are walking to (see catchUp).
    comms.on("pos", function (data, from) {
        const r = mer.requests.get(from);
        if (!r || !data || !data.map) return;
        r.map = data.map; r.x = data.x; r.y = data.y; r.posAt = Date.now();
    });

    // At least half of every wanted potion type: in the bag or affordable above the reserve.
    function canSupply(want) {
        const spendable = Math.max(0, character.gold - util.goldAmount(m.goldReserve));
        return Object.keys(want || {}).every(function (name) {
            const need = want[name] || 0;
            if (need <= 0 || !G.items[name]) return true;
            if (G.items[name].type !== "pot") return true; // elixirs (v1.229.0) come when we have them - not a potion question

            return util.countItem(name) + Math.floor(spendable / G.items[name].g) >= need / 2;
        });
    }

    function survive() {
        if (is_on_cooldown("use_hp")) return;
        if (util.townChannel() && util.hpRatio() >= 0.3) return; // a potion would cancel the Town teleport
        if (util.hpRatio() < 0.5) use_skill("use_hp").catch(function () {});
        else if (util.mpRatio() < 0.2) use_skill("use_mp").catch(function () {});
    }

    // ---- market stand (config.merchantRole.stand) ----------------------------------
    const st = m.stand || {};
    // Every walk goes through util.walk, which closes the stand first (speed 10 with it open).
    mer.nextOrdersAt = 0;
    mer.missingSince = {}; // item -> first time a buy-order shortage was seen
    // Listed wish buy orders (player decision 2026-11-20: a fill is paid from the gear pot).
    // trade slot -> { name, level, price, q } as the server listed it; a slot whose quantity
    // drops (or that empties) without us taking it down was sold to.
    mer.watched = {};
    mer.wishKeys = {}; // "name|level" of the current wish orders
    // A fill only counts when the bought copy shows up in our bag (2026-11-20, v1.154.0): right
    // after the stand reopened, the trade slots were not back yet, and stramulet +2 (41k) and
    // intring +2 (34k) were booked as bought - neither ever arrived.
    mer.standSince = 0; // when the stand was last seen opening
    mer.pendingFills = []; // { name, level, price, n, base, until }

    // ---- fishing (config.merchantRole.gather.fishing) --------------------------------
    // With a rod and the 48-min cooldown over: walk to the pier, cast until something bites
    // (10% per cast, the cooldown starts with the catch), back to the stand.
    mer.FISH_KEY = "merchant_next_fish:" + character.name;
    mer.nextFishAt = (function () { try { return get(mer.FISH_KEY) || 0; } catch (e) { return 0; } })();

    // Items any NPC shop sells (can be bought back at any time).
    mer.npcSold = new Set();
    Object.keys(G.npcs).forEach(function (id) {
        (Array.isArray(G.npcs[id].items) ? G.npcs[id].items : []).forEach(function (name) { if (name) mer.npcSold.add(name); });
    });

    // Potion types fighters asked for – we keep stockPerPotion of each.
    mer.stocked = new Map(); // potion -> last time a fighter asked for it
    mer.users = new Map();   // potion -> Map(fighter -> last ask)
    mer.poorLogged = {}; // potion -> last "not enough gold" log
    mer.startedAt = Date.now();
    // NPC-bought elixirs (elixirs.buy, Liquid Luck at Warin): below min (bag + bank) the merchant walks to the seller
    // and buys up to max, with gold above goldReserve only.
    mer.elixirPoorLog = {};

    mer.nextBankTripAt = 0;
    // Before a pickup (2026-11-22, player report "send_no_space"): with fewer than bank.beforePickupFree slots
    // free we bank first (store only, workshop copies too) - pickups back to back (the Ponty-round prep calls
    // every fighter at once) filled the bag, the bank trip came only after the last one. Nothing fit: no new
    // try for 10 min (no bank-pickup ping-pong).
    mer.nextPrePickupBankAt = 0;
    mer.lastBankVisit = 0;

    // ---- Ponty round over other servers (player decision 2026-11-20) -------------------
    // At fixed hours (every everyHours, local time; testAt once for testing) the merchant:
    //   prep:   calls every fighter for a pickup, serves them, banks - then asks for the hop
    //   travel: on each other server it visits Ponty (workshop.pontyVisit: wishes and finds,
    //           the usual price and pot rules), notes the stock, asks for the next server
    //   home:   back on the home server, normal work again.
    // The hop itself is done by the client that hosts our bot window (main.js hop watcher):
    // we only write a request into the shared storage (CODE messages don't cross servers).
    const prc = m.pontyRound || {};
    mer.ROUND_KEY = "bot_ponty_round:" + character.name;
    mer.HOP_KEY = "bot_hop_request:" + character.name;
    mer.LAST_KEY = "bot_ponty_round_last:" + character.name;
    // The leader's client makes the hops (main.js startHopWatcher): no round without a fresh leader heartbeat
    // (v1.224.1, player decision 2026-11-23 - the merchant ran alone, its round asked for hops nobody made and it hung).
    mer.leaderMissLogAt = 0;

    // ---- selling into other players' buy orders (player decision 2026-11-20) ----------
    // Every scanEveryMs (at home, no round running) the game's own merchant list
    // (/api/pull_merchants - every stand on every server, as the in-game list shows) is checked
    // for buy orders of a market.sellTo item at minPrice or more. The best one starts a trip:
    // take the surplus above "keep" out of the bank, hop to that server (same hop as the Ponty
    // round), walk to the buyer's stand, sell into the order, hop home. The server only sells
    // near the stand and when the buyer still has the gold (trade_sell: distance, buyer_gold).
    const stc = (config.market && config.market.sellTo) || {};
    mer.TRIP_KEY = "bot_trade_trip:" + character.name;
    // The next scan time survives a hop (review 2026-11-20): the 5-min wait after a buyer or seller
    // was away from its stand was set on the far server and lost on the way home - with a stale
    // merchant list the merchant hopped there and back every few minutes.
    mer.NEXT_SCAN_KEY = "bot_trade_next:" + character.name;
    mer.nextSellScanAt = Math.max(Date.now() + 60 * 1000, (function () { try { return get(mer.NEXT_SCAN_KEY) || 0; } catch (e) { return 0; } })());
    // Buying from other players' stands (player decision 2026-11-20): what Ponty would buy
    // (workshop.playerOffers - wishes, gear goals, finds; the same price and pot rules).
    // "seller|item|level" (or "buyer|item|sell") -> time a trip for it came back empty. In the
    // shared storage: every hop restarts the bot, and an in-memory list sent the merchant twice
    // to a stand that was gone (2026-11-20).
    mer.FAILED_KEY = "bot_trade_failed:" + character.name;
    mer.failedOffers = (function () {
        try { const f = get(mer.FAILED_KEY) || {}; Object.keys(f).forEach(function (k) { if (Date.now() - f[k] > 30 * 60 * 1000) delete f[k]; }); return f; } catch (e) { return {}; }
    })();
    // When a buyer at our minPrice was last seen per "item:level" (any server, open stand): the
    // workshop compounds sellTo items only after demandHours without one (player decision
    // 2026-11-20: sell Vitality earrings +0 while someone pays, else build +2 for stock).
    mer.DEMAND_KEY = "bot_sell_demand";
    mer.demand = (function () { try { return get(mer.DEMAND_KEY) || {}; } catch (e) { return {}; } })();

    async function work() {
        if (busy) return;
        busy = true;
        try {
            if (await mer.pontyRound()) return;
            if (await mer.tradeTrip()) return;
            // A (nearly) full bag first sheds its junk in town: otherwise a pickup can't take
            // the loot (send_no_space) and the bag never empties (2026-11-17).
            if (character.esize < 4) {
                await mer.goHome();
                await mer.sellJunk();
            }
            const next = mer.requests.keys().next();
            if (!next.done) {
                await mer.bankBeforePickup();
                await mer.deliver(next.value);
                await mer.goHome();
                return;
            }
            // Boss search for the team (events.scout, 2026-11-23): after pickups and deliveries, before the chores.
            if (ctx.scout && await ctx.scout.work()) {
                await mer.goHome();
                return;
            }
            await mer.goHome();
            if (Date.now() >= nextChoresAt) {
                nextChoresAt = Date.now() + 30 * 1000;
                await mer.sellJunk();
                await mer.bankIfNeeded();
                // v1.224.4 (player decision 2026-11-23): a round that only found locked jobs tries the next one at once,
                // a round that did something is followed after workshopFastMs - the 30 s only when there is nothing to do.
                let wr = await workshop.work();
                for (let n = 0; wr === "blocked" && n < 8; n++) wr = await workshop.work();
                if (wr === "did" || wr === "blocked") nextChoresAt = Date.now() + (m.workshopFastMs || 3000);
                await mer.goHome();
                await mer.restock();
                try { await mer.elixirChores(); } catch (e) { util.log("merchant", "elixir purchase: " + util.errReason(e), "orange"); }
                await mer.goHome();
            }
            if (mer.fishingDue()) {
                await mer.fish();
                await mer.goHome();
            }
            // A tool still in hand (e.g. after a restart while fishing) slows us down: bag it.
            const held = character.slots && character.slots.mainhand;
            if (held && (held.name === "rod" || held.name === "pickaxe") && character.esize > 0) await unequip("mainhand").catch(function () {});
            mer.keepStand();
            // At the stand the last workshop status stays visible (player request 2026-11-17).
            if (!character.stand) util.status("ready in town", "white");
            if (Date.now() >= nextReportAt) {
                nextReportAt = Date.now() + 10 * 60 * 1000;
                try { util.log("workshop", workshop.report(), "white"); } catch (e) { /* report only */ }
            }
        } catch (e) {
            util.log("merchant", "work failed: " + util.errReason(e), "red");
            await sleep(5000);
        } finally {
            busy = false;
        }
    }

    // ---- Merchant's Luck for everyone in reach (player decision 2026-11-20) -----------
    // +12 luck for 60 min, and the caster gets a 2 % chance of a copy of every item the target
    // loots (game source: drop logic checks s.mluck.f) - a Ring of Joy +2 with the M mark came
    // that way. So: ourselves, our fighters, and every other non-merchant player passing by.
    // The server only overwrites another merchant's mluck when it is not "strong" (strong =
    // cast by the target's own account), so those are skipped. 10 MP per cast; potions below
    // 20 % MP as before (survive).
    const mlc = (config.merchantRole && config.merchantRole.mluck) || {};
    mer.lastMluck = 0, mer.mluckCasts = 0, mer.mluckSince = Date.now();

    async function loop() {
        running = true;
        util.log("bot", "merchant started", "green");
        while (running) {
            try {
                if (character.rip) {
                    if (Date.now() - lastRespawnTry > 5000) {
                        lastRespawnTry = Date.now();
                        respawn().catch(function () {});
                    }
                } else {
                    survive();
                    mer.mluckTick();
                    work();
                }
                util.heartbeat(); // member watchdog (main.js)
            } catch (e) {
                util.log("bot", "tick error: " + util.errReason(e), "red");
            }
            await sleep(1000);
        }
    }

    return {
        start: function () { loop(); },
        stop: function () { running = false; },
    };

};
