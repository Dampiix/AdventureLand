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

module.exports = function createMerchant(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const m = config.merchantRole;
    const workshop = ctx.workshop;

    const requests = new Map(); // fighter name -> latest pickup request
    let running = false;
    let busy = false;
    let nextChoresAt = 0;     // selling/restocking runs at most every 30 s
    let nextReportAt = 0;     // workshop status report in the log
    let lastRespawnTry = 0;

    comms.on("pickup", function (data, from) {
        const isNew = !requests.has(from);
        requests.set(from, Object.assign({}, data, { at: Date.now() }));
        Object.keys(data.want || {}).forEach(function (name) {
            if (!G.items[name] || G.items[name].type !== "pot") return;
            stocked.set(name, Date.now());
            if (!users.has(name)) users.set(name, new Map());
            users.get(name).set(from, Date.now());
        });
        if (isNew) util.log("merchant", "pickup requested by " + from, "yellow");
        // Tell the fighter whether we can bring its potions; if not, it buys them itself.
        comms.send(from, "coming", { potions: canSupply(data.want) });
    });

    // Position updates of a fighter we are walking to (see catchUp).
    comms.on("pos", function (data, from) {
        const r = requests.get(from);
        if (!r || !data || !data.map) return;
        r.map = data.map; r.x = data.x; r.y = data.y; r.posAt = Date.now();
    });

    // At least half of every wanted potion type: in the bag or affordable above the reserve.
    function canSupply(want) {
        const spendable = Math.max(0, character.gold - util.goldAmount(m.goldReserve));
        return Object.keys(want || {}).every(function (name) {
            const need = want[name] || 0;
            if (need <= 0 || !G.items[name]) return true;
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
    function standIndex() {
        return util.findItemIndex(function (i) { return G.items[i.name] && G.items[i.name].type === "stand"; });
    }
    function useStand() {
        return !!st.enabled && !!st.home && standIndex() !== -1;
    }
    // Every walk goes through util.walk, which closes the stand first (speed 10 with it open).
    let nextOrdersAt = 0;
    const missingSince = {}; // item -> first time a buy-order shortage was seen
    // Listed wish buy orders (player decision 2026-11-20: a fill is paid from the gear pot).
    // trade slot -> { name, level, price, q } as the server listed it; a slot whose quantity
    // drops (or that empties) without us taking it down was sold to.
    const watched = {};
    let wishKeys = {}; // "name|level" of the current wish orders
    // A fill only counts when the bought copy shows up in our bag (2026-11-20, v1.154.0): right
    // after the stand reopened, the trade slots were not back yet, and stramulet +2 (41k) and
    // intring +2 (34k) were booked as bought - neither ever arrived.
    let standSince = 0; // when the stand was last seen opening
    const pendingFills = []; // { name, level, price, n, base, until }
    function bagCount(name, level) {
        let n = 0;
        character.items.forEach(function (i) { if (i && i.name === name && (i.level || 0) === level) n += i.q || 1; });
        return n;
    }
    function checkFills() {
        const now = Date.now();
        if (!standSince || now - standSince < 5000) return; // trade slots still coming back
        Object.keys(watched).forEach(function (s) {
            const w = watched[s];
            const it = character.slots[s];
            const same = it && it.b && it.name === w.name && (it.level || 0) === w.level && it.price === w.price;
            const left = same ? (it.q || 1) : 0;
            if (left >= w.q) { w.bag = bagCount(w.name, w.level); return; }
            const n = w.q - left;
            if (left) w.q = left; else delete watched[s];
            pendingFills.push({ name: w.name, level: w.level, price: w.price, n: n, base: w.bag, until: now + 15000 });
        });
        for (let i = pendingFills.length - 1; i >= 0; i--) {
            const p = pendingFills[i];
            if (bagCount(p.name, p.level) >= p.base + p.n) {
                pendingFills.splice(i, 1);
                workshop.bookWishFill(p.name, p.level, p.price, p.n);
            } else if (now > p.until) {
                pendingFills.splice(i, 1);
                util.log("merchant", "wish order " + p.name + " +" + p.level + " left the stand without the item - not booked", "white");
            }
        }
        // Listings the server confirmed (they carry a price; our claim right after listing doesn't).
        Object.keys(character.slots || {}).forEach(function (s) {
            const it = character.slots[s];
            if (!/^trade\d+$/.test(s) || watched[s] || !it || !it.b || !it.price) return;
            if (wishKeys[it.name + "|" + (it.level || 0)]) watched[s] = { name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, bag: bagCount(it.name, it.level || 0) };
        });
    }
    // Open the stand at home and keep the buy orders listed (exact name and level).
    function keepStand() {
        if (!useStand() || !atHome()) return;
        if (!character.stand) {
            standSince = 0;
            try {
                util.openStand(standIndex());
            } catch (e) { util.log("merchant", "opening the stand failed: " + util.errReason(e), "orange"); }
            nextOrdersAt = Date.now() + 2000; // let the trade slots appear first
            return;
        }
        if (!standSince) standSince = Date.now();
        if (workshop.bookWishFill) checkFills();
        if (Date.now() < nextOrdersAt) return;
        // Orders count bag + bank: right after a restart the bank is not read yet, and a
        // buy order for 4 green Lolipops went up with 26 of them in the bank (2026-11-17).
        if (!workshop.bankKnown()) return;
        nextOrdersAt = Date.now() + 60 * 1000;
        // An open stand has 16 trade slots (24 from merchant level 70, 30 from 80 - server);
        // empty ones are not listed in character.slots, so the names are built here.
        const count = character.level >= 80 ? 30 : character.level >= 70 ? 24 : 16;
        const slots = [];
        for (let i = 1; i <= count; i++) slots.push("trade" + i);
        const market = config.market || {};
        const lvlText = function (name, level) { return G.items[name].upgrade || G.items[name].compound ? " +" + level : ""; };
        // Configured orders plus orders for what the fighters wish (market.wishOrders, 2026-11-19).
        const wishOrders = workshop.wishBuyOrders ? workshop.wishBuyOrders() : [];
        const buys = (market.buy || []).concat(wishOrders);
        wishKeys = {};
        wishOrders.forEach(function (o) { wishKeys[o.item + "|" + (o.level || 0)] = true; });
        const stillNeeded = function (o) {
            return o.dynamic ? workshop.needsCopy(o.item, o.level || 0) : (o.want || 1) - workshop.ownedCount(o.item) > 0;
        };
        const samePrice = function (o, listed) {
            return o.dynamic ? Math.abs(listed - o.price) <= o.price * 0.2 : listed === o.price;
        };
        // Listed buy orders no longer needed - the item left config.market.buy, or we hold
        // "want" by now - are taken down (unequip removes the listing). So is one whose price
        // differs from the config (an orange Lolipop order from an old config sat at 50k for
        // days, 2026-11-18); the next pass lists it again at the current price.
        slots.forEach(function (s) {
            const it = character.slots[s];
            if (!it || !it.b) return;
            const o = buys.find(function (b) { return b.item === it.name && (b.level || 0) === (it.level || 0); });
            const needed = o && stillNeeded(o);
            if (needed && samePrice(o, it.price)) return;
            delete watched[s]; // taken down by us, not sold to
            parent.socket.emit("unequip", { slot: s });
            const why = !o ? "not on the list"
                : !needed ? "we hold " + workshop.ownedCount(o.item) + " of " + (o.want || 1)
                : "price " + it.price + " -> " + o.price + ", listed again";
            util.log("merchant", "buy order for " + it.name + " taken down (" + why + ")", "white");
        });
        // Sell listings of config.market.sell items at an old price (2026-11-22 review: only buy orders were
        // checked, so a changed sell price never reached the stand). Taken down; the sell pass below lists them
        // again at the current price. Listings of items not on the sell list are left alone (they may be ours by hand).
        slots.forEach(function (s) {
            const it = character.slots[s];
            if (!it || it.b || !it.price) return;
            const o = (market.sell || []).find(function (x) { return x.item === it.name && (x.level || 0) === (it.level || 0); });
            if (!o || it.price === o.price) return;
            delete watched[s]; // taken down by us, not sold
            parent.socket.emit("unequip", { slot: s });
            util.log("merchant", "sell listing for " + it.name + " taken down (price " + it.price + " -> " + o.price + ", listed again)", "white");
        });
        // Buy orders: what is missing up to "want" (bag + bank).
        buys.forEach(function (o) {
            if (!G.items[o.item]) return;
            const level = o.level || 0;
            const listed = slots.some(function (s) {
                const it = character.slots[s];
                return it && it.b && it.name === o.item && (it.level || 0) === level;
            });
            if (listed || character.gold < o.price) return; // a buy order must be funded
            const missing = o.dynamic ? (stillNeeded(o) ? 1 : 0) : (o.want || 1) - workshop.ownedCount(o.item);
            if (missing <= 0) { delete missingSince[o.item]; return; }
            // Only a shortage that lasts: while the workshop moves a stack between bag and bank
            // (crafting from 85 essences) the count read 0 for a moment and a buy order for 10
            // went up (2026-11-18).
            if (!missingSince[o.item]) missingSince[o.item] = Date.now();
            if (Date.now() - missingSince[o.item] < 2 * 60 * 1000) return;
            const free = slots.find(function (s) { return !character.slots[s]; });
            if (!free) return;
            character.slots[free] = { name: o.item, b: true }; // claimed until the server answers
            parent.socket.emit("trade_wishlist", { slot: free, name: o.item, level: level, q: missing, price: o.price });
            util.log("merchant", "buy order: " + missing + "x " + o.item + lvlText(o.item, level) + " at " + o.price, "white");
        });
        // Sell orders: everything above "keep", from the bag (bank items come on the next
        // bank trip). One listing per item at a time; a stack goes in with its surplus.
        (market.sell || []).forEach(function (o) {
            if (!G.items[o.item]) return;
            const level = o.level || 0;
            const listed = slots.some(function (s) {
                const it = character.slots[s];
                return it && !it.b && it.name === o.item && (it.level || 0) === level;
            });
            if (listed) return;
            const surplus = workshop.ownedCount(o.item) - (o.keep || 0);
            if (surplus <= 0) return;
            const idx = util.findItemIndex(function (i) {
                return i.name === o.item && (i.level || 0) === level && !i.l && !i.p && !workshop.isReserved(i);
            });
            if (idx === -1) return;
            const free = slots.find(function (s) { return !character.slots[s]; });
            if (!free) return;
            const item = character.items[idx];
            // max (2026-11-20): only part of the surplus at the stand - Monster Tokens go into
            // other players' buy orders as well (market.sellTo), which only sees bag + bank.
            const q = Math.min(surplus, item.q || 1, o.max || Infinity);
            character.slots[free] = { name: o.item, price: o.price }; // claimed until the server answers
            trade(idx, free, o.price, q);
            util.log("merchant", "sell order: " + q + "x " + o.item + lvlText(o.item, level) + " at " + o.price, "white");
        });
    }
    // Surplus of a market sell item (above "keep"), counted over bag and bank (workshop.ownedCount;
    // listings not included).
    function marketSurplus(name, level) {
        const o = ((config.market || {}).sell || []).find(function (s) { return s.item === name && (s.level || 0) === (level || 0); });
        return o ? workshop.ownedCount(name) - (o.keep || 0) : 0;
    }

    // ---- fishing (config.merchantRole.gather.fishing) --------------------------------
    // With a rod and the 48-min cooldown over: walk to the pier, cast until something bites
    // (10% per cast, the cooldown starts with the catch), back to the stand.
    const FISH_KEY = "merchant_next_fish:" + character.name;
    let nextFishAt = (function () { try { return get(FISH_KEY) || 0; } catch (e) { return 0; } })();
    function fishingDue() {
        const f = (m.gather || {}).fishing;
        if (!f || !f.enabled || Date.now() < nextFishAt || character.esize < 2) return false;
        if (is_on_cooldown("fishing")) return false;
        const rod = function (i) { return i && i.name === "rod"; };
        return util.findItemIndex(rod) !== -1 || rod(character.slots && character.slots.mainhand);
    }
    // The server's check (skill "fishing"/"mining"): one of the four points 24 px up, down,
    // left or right of us lies inside a zone of that type on our map. A few pixels off the
    // configured spot and there is no water in reach (2026-11-17), so we step onto a point
    // that passes the same check before casting.
    function insidePolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
    function zoneInReach(type, x, y) {
        return ((G.maps[character.map] || {}).zones || []).some(function (z) {
            return z.type === type && [[0, -24], [-24, 0], [24, 0], [0, 24]].some(function (o) {
                return insidePolygon(x + o[0], y + o[1], z.polygon);
            });
        });
    }
    async function stepIntoReach(type, around) {
        if (zoneInReach(type, character.x, character.y)) return true;
        const spots = [];
        for (let r = 0; r <= 48; r += 8) {
            for (let dx = -r; dx <= r; dx += 8) {
                for (let dy = -r; dy <= r; dy += 8) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring by ring, nearest first
                    const x = around.x + dx, y = around.y + dy;
                    if (zoneInReach(type, x, y)) spots.push({ x: x, y: y });
                }
            }
        }
        for (const p of spots.slice(0, 6)) {
            if (typeof can_move_to === "function" && !can_move_to(p.x, p.y)) continue;
            try { await move(p.x, p.y); } catch (e) { continue; }
            if (zoneInReach(type, character.x, character.y)) return true;
        }
        return zoneInReach(type, character.x, character.y);
    }
    async function fish() {
        const f = m.gather.fishing;
        util.status("fishing", "yellow");
        await util.walk(f.spot);
        if (!(await stepIntoReach("fishing", f.spot))) {
            util.log("merchant", "can't fish near " + f.spot.x + "," + f.spot.y + " - no water in reach (standing at " +
                Math.round(character.x) + "," + Math.round(character.y) + ")", "orange");
            nextFishAt = Date.now() + 60 * 60 * 1000;
            try { set(FISH_KEY, nextFishAt); } catch (e) { /* storage unavailable */ }
            return;
        }
        const m0 = character.slots && character.slots.mainhand;
        if (!m0 || m0.name !== "rod") {
            const idx = util.findItemIndex(function (i) { return i.name === "rod"; });
            if (idx === -1) return;
            await equip(idx);
            await sleep(500);
        }
        const freeBefore = character.esize;
        let caught = false;
        let noWater = 0;
        for (let cast = 0; cast < (f.maxCasts || 40) && !caught; cast++) {
            if (character.mp < 150) { await use_skill("use_mp").catch(function () {}); await sleep(2100); }
            await use_skill("fishing").catch(function () {});
            await sleep(800);
            if (!(character.c && character.c.fishing)) {
                // No channel: not next to water (or a hiccup) - give up after a few tries.
                if (++noWater >= 3) {
                    util.log("merchant", "can't fish at " + Math.round(character.x) + "," + Math.round(character.y) + " - the cast did not start", "orange");
                    nextFishAt = Date.now() + 60 * 60 * 1000;
                    break;
                }
                continue;
            }
            for (let t = 0; t < 40 && character.c && character.c.fishing; t++) await sleep(500);
            await sleep(500);
            caught = is_on_cooldown("fishing") || character.esize < freeBefore;
        }
        // The rod costs the merchant 20 speed (class data): back into the bag after fishing.
        if (character.slots && character.slots.mainhand && character.slots.mainhand.name === "rod" && character.esize > 0) {
            await unequip("mainhand").catch(function () {});
        }
        if (caught) {
            nextFishAt = Date.now() + ((G.skills.fishing && G.skills.fishing.reuse_cooldown) || 48 * 60 * 1000) + 30 * 1000;
            util.log("merchant", "caught something - next fishing in 48 min", "green");
        } else if (Date.now() >= nextFishAt) {
            nextFishAt = Date.now() + 10 * 60 * 1000; // no luck this time: try again a bit later
        }
        try { set(FISH_KEY, nextFishAt); } catch (e) { /* storage unavailable */ }
    }

    function homeSpot() {
        return useStand() ? { map: "main", x: st.home.x, y: st.home.y } : null;
    }
    function atHome() {
        const spot = homeSpot();
        if (spot) return character.map === "main" && util.distanceTo(spot) < 15;
        const shop = (G.maps.main.npcs || []).find(function (n) { return n.id === "fancypots"; });
        return character.map === "main" && shop && util.distanceTo({ x: shop.position[0], y: shop.position[1] }) < 200;
    }

    async function goHome() {
        if (!atHome()) {
            util.status("going to town", "yellow");
            const spot = homeSpot();
            if (spot) await util.walk(spot);
            else await util.walk({ to: "potions" });
        }
        keepStand();
    }

    // sellList entries: "name" (only +0) or { name, maxLevel }.
    function sellRule(name) {
        for (const entry of m.sellList) {
            if (entry === name) return { maxLevel: 0 };
            if (entry && entry.name === name) return { maxLevel: entry.maxLevel || 0 };
        }
        return null;
    }

    // Items any NPC shop sells (can be bought back at any time).
    const npcSold = new Set();
    Object.keys(G.npcs).forEach(function (id) {
        (Array.isArray(G.npcs[id].items) ? G.npcs[id].items : []).forEach(function (name) { if (name) npcSold.add(name); });
    });

    // config.merchantRole.sellBuyable: don't store what a shop sells anyway.
    function isBuyableJunk(item) {
        const rule = m.sellBuyable;
        if (!rule || !rule.enabled || !npcSold.has(item.name)) return false;
        const def = G.items[item.name];
        if (!def || rule.exceptTypes.includes(def.type) || m.bank.keep.includes(item.name)) return false;
        return (item.level || 0) <= rule.maxLevel;
    }

    function isSellable(item) {
        if (item.p || item.l) return false;            // shiny / locked never
        if (workshop.isReserved(item)) return false;    // a fighter wishes for it
        if (workshop.fillsEmptySlot(item)) return false; // a team fighter has that slot empty (e.g. a new rogue)
        if (workshop.isOrphanStatCopy(item)) return true;   // shop armor in a stat no fighter still builds
        if (workshop.isSpareJoyRing(item)) return true;     // every fighter wears two rings at +2 or better
        if (workshop.isDoneBoxArmor(item)) return true;     // Rugged piece already worn/held at +7 (before the goal-stock rule: a worn Rugged helmet makes its name a goal name)
        if (workshop.isGoalStock(item)) return false;   // a gear-goal copy (worn piece, level 1+)
        if (workshop.isOutgrownGoalCopy(item)) return true; // shop gear below a finished gear goal
        const rule = sellRule(item.name);
        if (rule && (item.level || 0) <= rule.maxLevel) return true;
        // Leftover grace fodder (any level) has done its job.
        if (config.workshop.grace && item.name === config.workshop.grace.fodder) return true;
        if (isOutgrownPotion(item)) return true;
        return isBuyableJunk(item);
    }

    async function sellJunk() {
        let sold = 0;
        for (;;) {
            const index = util.findItemIndex(isSellable);
            if (index === -1) break;
            const item = character.items[index];
            await sell(index, item.q || 1);
            sold++;
        }
        if (sold) util.log("merchant", "sold " + sold + " junk stacks", "green");
    }

    // Potion types fighters asked for – we keep stockPerPotion of each.
    const stocked = new Map(); // potion -> last time a fighter asked for it
    const users = new Map();   // potion -> Map(fighter -> last ask)
    const poorLogged = {}; // potion -> last "not enough gold" log
    const startedAt = Date.now();

    // Fighters ask for their current potion sizes with every pickup (at least every
    // 15 min). A size nobody asked for within an hour is outgrown: no restocking,
    // and our leftovers of it are sold.
    function isWantedPotion(name) {
        return stocked.has(name) && Date.now() - stocked.get(name) < 60 * 60 * 1000;
    }
    function isOutgrownPotion(item) {
        return /^(hpot|mpot)\d+$/.test(item.name) && Date.now() - startedAt > 60 * 60 * 1000 && !isWantedPotion(item.name);
    }

    // Fighters that asked for this potion size within the last hour.
    function userCount(name) {
        const u = users.get(name);
        if (!u) return 0;
        let n = 0;
        u.forEach(function (at) { if (Date.now() - at < 60 * 60 * 1000) n++; });
        return n;
    }

    // With `wanted` (a delivery): buy what this delivery needs. Without (chores):
    // build a stock of potions.target per fighter using the size (max stockPerPotion) –
    // but only while we have stockFromGold, so equipment wishes get the gold first.
    async function restock(wanted) {
        Object.keys(wanted || {}).forEach(function (name) { if (G.items[name] && G.items[name].type === "pot") stocked.set(name, Date.now()); });
        if (!wanted && character.gold < (m.stockFromGold || 0)) return;
        for (const name of stocked.keys()) {
            if (!isWantedPotion(name)) continue; // nobody drinks this size any more
            const target = wanted
                ? (wanted[name] || 0)
                : Math.min(m.stockPerPotion, Math.max(1, userCount(name)) * config.potions.target);
            const missing = target - util.countItem(name);
            if (missing <= 0) continue;
            const price = G.items[name].g;
            const affordable = Math.floor(Math.max(0, character.gold - util.goldAmount(m.goldReserve)) / price);
            const amount = Math.min(missing, affordable);
            if (amount <= 0) {
                if (Date.now() - (poorLogged[name] || 0) > 10 * 60 * 1000) {
                    poorLogged[name] = Date.now();
                    util.log("merchant", "not enough gold above the reserve for " + name + " - fighters buy their own", "orange");
                }
                continue;
            }
            if (character.esize < 1 && util.countItem(name) === 0) {
                util.log("merchant", "bag full - cannot buy " + name, "red");
                continue;
            }
            await buy(name, amount);
            util.log("merchant", "bought " + amount + " " + name, "green");
        }
    }

    async function giveTo(name, want) {
        for (const potion of Object.keys(want || {})) {
            let missing = want[potion];
            while (missing > 0) {
                const index = util.findItemIndex(function (i) { return i.name === potion; });
                if (index === -1) break;
                const amount = Math.min(missing, character.items[index].q || 1);
                await send_item(name, index, amount);
                missing -= amount;
            }
        }
    }

    // One-off items from config.merchantRole.give – sent once, because afterwards
    // they are no longer in our bag.
    async function giveGifts(name) {
        for (const itemName of (m.give && m.give[name]) || []) {
            const index = util.findItemIndex(function (i) { return i.name === itemName; });
            if (index === -1) continue;
            await send_item(name, index, 1);
            util.log("merchant", "gave " + itemName + " to " + name, "green");
        }
    }

    // Skill ingredients (config.merchantRole.classItems) for this fighter's class.
    async function giveClassItems(name) {
        const ctype = workshop.classOf ? workshop.classOf(name) : null;
        for (const itemName of (ctype && m.classItems && m.classItems[ctype]) || []) {
            for (;;) {
                const index = util.findItemIndex(function (i) { return i.name === itemName; });
                if (index === -1) break;
                const q = character.items[index].q || 1;
                await send_item(name, index, q);
                util.log("merchant", "gave " + q + "x " + itemName + " to " + name, "green");
            }
        }
    }

    // One-per-character items (config.merchantRole.onePerCharacter) the fighter lacks.
    async function giveOneEach(name) {
        for (const itemName of workshop.oneEachFor ? workshop.oneEachFor(name) : []) {
            const index = util.findItemIndex(function (i) { return i.name === itemName; });
            if (index === -1) continue;
            await send_item(name, index, 1);
            workshop.markCarried(name, itemName);
            util.log("merchant", "gave a " + G.items[itemName].name + " to " + name, "green");
        }
    }

    // Walk after a fighter that keeps farming (player decision 2026-11-17): towards the
    // newest position we know - its live position while we see it, otherwise its last
    // "pos" message - and re-route when it moved on. Returns the fighter once we are next
    // to it, or null after followMs.
    async function catchUp(name) {
        const until = Date.now() + (m.followMs || 4 * 60 * 1000);
        const newest = function () {
            const seen = get_player(name);
            if (seen && (!seen.map || seen.map === character.map)) return { map: character.map, x: seen.x, y: seen.y, seen: seen };
            const r = requests.get(name);
            return r ? { map: r.map, x: r.x, y: r.y } : null;
        };
        while (Date.now() < until) {
            const dest = newest();
            if (!dest) return null;
            if (dest.seen && util.isNear(dest.seen, 200)) return dest.seen;
            util.status("following " + name, "orange");
            let done = false;
            util.walk({ map: dest.map, x: dest.x, y: dest.y }).catch(function () { /* re-routed or blocked */ })
                .then(function () { done = true; });
            while (!done && Date.now() < until) {
                await sleep(1000);
                const now = newest();
                if (now && now.seen && util.isNear(now.seen, 200)) { stop(); break; }
                // It moved on: re-route (another map, or more than retargetPx away).
                if (now && (now.map !== dest.map || Math.hypot(now.x - dest.x, now.y - dest.y) > (m.retargetPx || 150))) { stop(); break; }
            }
            for (let i = 0; i < 20 && !done; i++) await sleep(100); // let the interrupted walk settle
            const here = newest();
            if (here && here.seen && util.isNear(here.seen, 250)) return here.seen;
            if (done && here && !here.seen && here.map === character.map && Math.hypot(here.x - character.x, here.y - character.y) < 100) {
                await sleep(1000); // at its last known spot without seeing it: wait for the next update
            }
        }
        return null;
    }

    async function deliver(name) {
        const req = requests.get(name);
        util.status("delivering to " + name, "orange");
        try {
            if (atHome()) await restock(req.want);
            const fighter = await catchUp(name);
            if (!fighter) {
                util.log("merchant", "couldn't catch up with " + name + " - waiting for a new request", "orange");
                return;
            }

            await giveTo(name, (requests.get(name) || req).want);
            await giveGifts(name);
            await giveClassItems(name);
            await giveOneEach(name);
            await workshop.handOver(name);
            if (util.canCast("mluck")) use_skill("mluck", name).catch(function () {});
            util.status("collecting from " + name, "orange");
            await sleep(m.handoverWaitMs); // the fighter hands over loot and gold while we stand here
            util.log("merchant", "pickup for " + name + " done", "green");
            comms.send(name, "served", {});
        } catch (e) {
            util.log("merchant", "delivery to " + name + " failed: " + util.errReason(e), "red");
        } finally {
            requests.delete(name);
        }
    }

    // Everything that is neither sold, kept, part of the potion stock nor a gift.
    // tight: the bag runs full - then reserved wish material (accessory and Wanderer copies) goes
    // to the bank as well, except what is about to be delivered (keep: bag indexes). The workshop
    // takes copies out of the bank again when it compounds or upgrades (2026-11-20: 42/42 slots,
    // pickups failed with "no space" while the bank had 52 free).
    function isBankable(item, index, tight, keep) {
        if (!item || isSellable(item) || workshop.isGoalFinished(item)) return false;
        if (workshop.isReserved(item) && !(tight && tight() && !(keep && keep.has(index)))) return false;
        if (G.items[item.name] && G.items[item.name].type === "pot") return false; // potion stock stays with us
        if (m.bank.keep.includes(item.name)) return false;
        if (marketSurplus(item.name, item.level) > 0) return false; // waits for a slot in the stand
        if (workshop.waitsForDismantle(item)) return false;           // goes to Leo, not the bank
        const gifts = [].concat.apply([], Object.values(m.give || {}));
        return !gifts.includes(item.name);
    }

    // Walk into the bank and store what we can. Returns the number of stacks stored.
    // storeOnly: only store (mid Ponty round) - no junk or stand items taken out into the bag.
    // tightBelow: reserved workshop copies go to the bank too while fewer slots than this are free
    // (default whenFreeBelow + 5).
    async function bankTrip(storeOnly, tightBelow) {
        util.status("banking", "yellow");
        // smart_move can end outside the bank (interrupted by another move, e.g. a pickup
        // call): then every store fails with not_in_bank – try again on the next round.
        // (character.bank is {} outside, so walkToBank checks for loaded packs.)
        if (!(await util.walkToBank())) {
            util.log("merchant", "not inside the bank after the walk - banking later", "white");
            return 0;
        }
        let stored = 0;
        let full = false;
        // Walk the bag once from the end; each index is checked right before storing.
        // Reserved items only while fewer than whenFreeBelow + 5 slots are free (no back and forth).
        const keep = workshop.deliveryIndexes ? workshop.deliveryIndexes() : new Set();
        const tight = function () { return character.esize < (tightBelow || (m.bank.whenFreeBelow || 6) + 5); };
        for (let index = character.items.length - 1; index >= 0; index--) {
            const item = character.items[index];
            if (!isBankable(item, index, tight, keep)) continue;
            try {
                await bank_store(index); // auto placement, merges into existing stacks
                stored++;
            } catch (e) {
                const why = util.errReason(e);
                if (why === "bank_full") full = true; // stackable items may still fit – keep going
                else if (why === "not_in_bank") break; // left the bank meanwhile: next round
                else util.log("merchant", "could not bank " + item.name + ": " + why, "orange");
            }
        }
        util.log("merchant", "banked " + stored + " stacks" + (full ? " - bank is full, a new pack is needed" : ""), full ? "orange" : "green");
        if (stored && workshop.refreshBank) workshop.refreshBank(); // the workshop counts the bank from its snapshot
        if (!storeOnly) await takeSellablesFromBank();
        return stored;
    }

    // Junk that ended up in the bank earlier (before it was on the sell list) is
    // taken out again and sold on the next chores round – frees bank slots.
    async function takeSellablesFromBank() {
        let taken = 0;
        for (const pack of Object.keys(character.bank || {})) {
            if (!/^items\d+$/.test(pack)) continue;
            const items = character.bank[pack] || [];
            for (let i = 0; i < items.length; i++) {
                if (character.esize <= 2) break; // leave room for loot handovers
                if (!items[i] || !isSellable(items[i])) continue;
                try {
                    await bank_retrieve(pack, i);
                    taken++;
                } catch (e) {
                    util.log("merchant", "could not take " + items[i].name + " from the bank: " + util.errReason(e), "orange");
                }
            }
        }
        if (taken) util.log("merchant", "took " + taken + " junk stacks out of the bank to sell", "green");
        // Market sell items (config.market.sell) above "keep": into the bag for the stand. Only the surplus
        // (2026-11-22 review): a retrieve only moves a stack from bank to bag, so the owned count never drops -
        // the kept copies came out too and went back on the next bank trip. Counted down here instead.
        const left = {};
        for (const pack of Object.keys(character.bank || {})) {
            if (!/^items\d+$/.test(pack)) continue;
            const items = character.bank[pack] || [];
            for (let i = 0; i < items.length; i++) {
                if (character.esize <= 3) break;
                if (!items[i]) continue;
                const k = items[i].name + ":" + (items[i].level || 0);
                if (!(k in left)) left[k] = marketSurplus(items[i].name, items[i].level) - bagCount(items[i].name, items[i].level || 0);
                if (left[k] <= 0) continue;
                left[k] -= items[i].q || 1;
                try {
                    await bank_retrieve(pack, i);
                    util.log("merchant", "took " + items[i].name + " from the bank for the stand", "green");
                } catch (e) { /* next time */ }
                if (workshop.refreshBank) workshop.refreshBank(); // the next surplus check must not count it twice
            }
        }
        return taken;
    }

    let nextBankTripAt = 0;
    // Before a pickup (2026-11-22, player report "send_no_space"): with fewer than bank.beforePickupFree slots
    // free we bank first (store only, workshop copies too) - pickups back to back (the Ponty-round prep calls
    // every fighter at once) filled the bag, the bank trip came only after the last one. Nothing fit: no new
    // try for 10 min (no bank-pickup ping-pong).
    let nextPrePickupBankAt = 0;
    async function bankBeforePickup() {
        const want = m.bank.beforePickupFree || 0;
        if (!want || character.esize >= want || Date.now() < nextPrePickupBankAt) return;
        const stored = await bankTrip(true, want);
        lastBankVisit = Date.now();
        if (!stored) nextPrePickupBankAt = Date.now() + 10 * 60 * 1000;
    }
    let lastBankVisit = 0;
    async function bankIfNeeded() {
        if (Date.now() < nextBankTripAt) return;
        // Visit when the bag is running full, or every 30 min to clear junk out of the bank.
        // Idle workshop stock (2026-11-23, player decision): below bank.stockFreeBelow free slots the jewellery and
        // other copies waiting for their compound/upgrade go to the bank too - the workshop takes them out again when
        // it works on them (retrieve). The bag was full of rings, amulets and belts while the bank had 49 free slots.
        const stockFree = m.bank.stockFreeBelow || 0;
        const due = character.esize < m.bank.whenFreeBelow || character.esize < stockFree || Date.now() - lastBankVisit > 30 * 60 * 1000;
        if (!due) return;
        lastBankVisit = Date.now();
        const stored = await bankTrip(false, stockFree || undefined);
        // Nothing fit: don't run back and forth – try again in 10 minutes.
        nextBankTripAt = Date.now() + (stored ? 60 * 1000 : 10 * 60 * 1000);
    }

    // ---- Ponty round over other servers (player decision 2026-11-20) -------------------
    // At fixed hours (every everyHours, local time; testAt once for testing) the merchant:
    //   prep:   calls every fighter for a pickup, serves them, banks - then asks for the hop
    //   travel: on each other server it visits Ponty (workshop.pontyVisit: wishes and finds,
    //           the usual price and pot rules), notes the stock, asks for the next server
    //   home:   back on the home server, normal work again.
    // The hop itself is done by the client that hosts our bot window (main.js hop watcher):
    // we only write a request into the shared storage (CODE messages don't cross servers).
    const prc = m.pontyRound || {};
    const ROUND_KEY = "dmpx_ponty_round:" + character.name;
    const HOP_KEY = "dmpx_hop_request:" + character.name;
    const LAST_KEY = "dmpx_ponty_round_last:" + character.name;
    function hereName() { return parent.server_region + " " + parent.server_identifier; }
    function homeName() { return util.teamServer(config); } // where the leader runs (2026-11-21)
    function readRound() { try { return get(ROUND_KEY) || null; } catch (e) { return null; } }
    function saveRound(st) { try { if (st) set(ROUND_KEY, st); else set(ROUND_KEY, null); } catch (e) { /* storage unavailable */ } }
    function requestHop(to) {
        const req = { id: Date.now() + ":" + to, to: to, at: Date.now() };
        try { set(HOP_KEY, req); } catch (e) { /* storage unavailable */ }
        util.log("merchant", "Ponty round: hop to " + to + " requested", "yellow");
    }
    // Which round slot is due: testAt once, else every everyHours at full local hours.
    function dueSlot() {
        let last = null;
        try { last = get(LAST_KEY); } catch (e) { /* storage unavailable */ }
        const now = new Date();
        // /ponty chat command (2026-11-21): a requested round right away (requests older than 10 min drop).
        let force = 0;
        try { force = get("dmpx_ponty_force") || 0; } catch (e) { /* storage unavailable */ }
        if (force) {
            try { set("dmpx_ponty_force", 0); } catch (e) { /* storage unavailable */ }
            // In the first half hour it counts as this hour's round (no second round right after it).
            if (Date.now() - force < 10 * 60 * 1000) return now.getMinutes() < 30 ? now.toDateString() + " " + now.getHours() : "manual:" + force;
        }
        const testAt = prc.testAt ? Date.parse(prc.testAt) : NaN;
        if (isFinite(testAt) && now >= testAt && last !== "test:" + prc.testAt) return "test:" + prc.testAt;
        const every = prc.everyHours || 0; // 0: only testAt
        if (!every || now.getHours() % every !== 0 || now.getMinutes() >= 30) return null;
        const slot = now.toDateString() + " " + now.getHours();
        return last === slot ? null : slot;
    }
    // True while the round holds the merchant (normal work skipped).
    async function pontyRound() {
        if (!prc.enabled) return false;
        const here = hereName(), home = homeName();
        let st = readRound();
        if (!st) {
            if (readTrip()) return false; // a sell trip holds the merchant (tradeTrip)
            if (here !== home) { // away without a round or sell trip (e.g. a restart mid-round): go home
                const req = (function () { try { return get(HOP_KEY); } catch (e) { return null; } })();
                if (!req || req.to !== home || Date.now() - req.at > 3 * 60 * 1000) requestHop(home);
                return true;
            }
            const slot = dueSlot();
            if (!slot) return false;
            const servers = (prc.servers || []).map(function (s) { return s.join(" "); }).filter(function (s) { return s !== home; });
            if (!servers.length) return false;
            try { set(LAST_KEY, slot); } catch (e) { /* storage unavailable */ }
            st = { phase: "prep", queue: servers, target: null, startedAt: Date.now(), at: Date.now(), visits: [] };
            saveRound(st);
            util.log("merchant", "Ponty round starts (" + servers.join(", ") + ") - calling the fighters first", "yellow");
            ((config.team && config.team.fighters) || []).forEach(function (f) { comms.send(f, "callpickup", {}); });
            return false; // prep: normal work serves the pickups
        }
        st.beat = Date.now();
        if (st.phase === "prep") {
            const settled = Date.now() - st.at > (prc.prepSettleMs || 20 * 1000) && requests.size === 0;
            if (!settled && Date.now() - st.at < (prc.prepMaxMs || 8 * 60 * 1000)) { saveRound(st); return false; }
            await goHome();
            await sellJunk();
            // Store only (2026-11-22 review): a full bank trip ends by taking junk and stand items out of the bank -
            // they would ride along unsold through the whole round and take the bag slots the Ponty buys need.
            await bankTrip(true);
            st.phase = "travel";
            st.target = st.queue.shift();
            st.at = Date.now();
            saveRound(st);
            requestHop(st.target);
            return true;
        }
        if (st.phase === "travel") {
            if (here === st.target) {
                if (character.stand) {
                    try { const p = typeof close_stand === "function" ? close_stand() : parent.close_merchant(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* closed by walking */ }
                }
                util.status("Ponty on " + here, "yellow");
                // Bag full mid-round (player decision 2026-11-21): bank on this server (the bank is the
                // account's) before the visit when it runs tight, and after a visit the bag cut short -
                // then Ponty again, up to pontyRound.bankRetries times.
                if (character.esize < (m.bank.whenFreeBelow || 6)) await bankTrip(true);
                let seen = null;
                try { seen = await workshop.pontyVisit(); } catch (e) { util.log("merchant", "Ponty on " + here + ": " + util.errReason(e), "orange"); }
                for (let n = 0; seen && seen.full && n < (prc.bankRetries || 2); n++) {
                    util.log("merchant", "Ponty on " + here + ": bag full after " + seen.bought + " - banking and back", "yellow");
                    if (!(await bankTrip(true))) break; // nothing fit in the bank
                    let again = null;
                    try { again = await workshop.pontyVisit(); } catch (e) { util.log("merchant", "Ponty on " + here + ": " + util.errReason(e), "orange"); }
                    if (!again) break;
                    seen = { items: again.items, bought: seen.bought + again.bought, full: again.full };
                }
                st.visits.push({ server: here, at: Date.now(), items: seen ? seen.items : null, bought: seen ? seen.bought : 0 });
                util.log("merchant", "Ponty on " + here + ": " + (seen ? seen.items + " items, bought " + seen.bought : "no visit"), "white");
                st.target = st.queue.length ? st.queue.shift() : home;
                if (st.target === home) st.phase = "home";
                st.at = Date.now();
                saveRound(st);
                requestHop(st.target);
                return true;
            }
            // Still waiting for the hop: ask again when nothing happened for a while.
            if (Date.now() - st.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { st.at = Date.now(); requestHop(st.target); }
            saveRound(st);
            return true;
        }
        if (st.phase === "home") {
            if (here === home) {
                const bought = st.visits.reduce(function (s, v) { return s + (v.bought || 0); }, 0);
                util.log("merchant", "Ponty round done in " + Math.round((Date.now() - st.startedAt) / 60000) + " min: " +
                    st.visits.map(function (v) { return v.server + " " + (v.items === null ? "-" : v.items) + "/" + v.bought; }).join(", ") + " (items/bought), " + bought + " bought", "green");
                try { const log = get("dmpx_ponty_round_log") || []; set("dmpx_ponty_round_log", log.concat([{ at: Date.now(), visits: st.visits }]).slice(-50)); } catch (e) { /* storage unavailable */ }
                saveRound(null);
                return false;
            }
            if (Date.now() - st.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { st.at = Date.now(); requestHop(home); }
            saveRound(st);
            return true;
        }
        saveRound(null); // unknown phase: drop it
        return false;
    }

    // ---- selling into other players' buy orders (player decision 2026-11-20) ----------
    // Every scanEveryMs (at home, no round running) the game's own merchant list
    // (/api/pull_merchants - every stand on every server, as the in-game list shows) is checked
    // for buy orders of a market.sellTo item at minPrice or more. The best one starts a trip:
    // take the surplus above "keep" out of the bank, hop to that server (same hop as the Ponty
    // round), walk to the buyer's stand, sell into the order, hop home. The server only sells
    // near the stand and when the buyer still has the gold (trade_sell: distance, buyer_gold).
    const stc = (config.market && config.market.sellTo) || {};
    const TRIP_KEY = "dmpx_trade_trip:" + character.name;
    // The next scan time survives a hop (review 2026-11-20): the 5-min wait after a buyer or seller
    // was away from its stand was set on the far server and lost on the way home - with a stale
    // merchant list the merchant hopped there and back every few minutes.
    const NEXT_SCAN_KEY = "dmpx_trade_next:" + character.name;
    let nextSellScanAt = Math.max(Date.now() + 60 * 1000, (function () { try { return get(NEXT_SCAN_KEY) || 0; } catch (e) { return 0; } })());
    function scanAgainIn(ms) {
        nextSellScanAt = Date.now() + ms;
        try { set(NEXT_SCAN_KEY, nextSellScanAt); } catch (e) { /* storage unavailable */ }
    }
    function readTrip() { try { return get(TRIP_KEY) || null; } catch (e) { return null; } }
    function saveTrip(t) { try { set(TRIP_KEY, t || null); } catch (e) { /* storage unavailable */ } }
    async function pullMerchants() {
        const r = await parent.fetch("/api/pull_merchants", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: "{}" });
        const data = await r.json();
        const m = ((data && data.infs) || []).find(function (x) { return x && x.type === "merchants"; });
        return (m && m.chars) || [];
    }
    function serverName(key) { // "SR_EUIII" -> "EU III"
        const mm = /^SR_(EU|US|ASIA)(.+)$/.exec(String(key || ""));
        return mm ? mm[1] + " " + mm[2] : null;
    }
    // Buying from other players' stands (player decision 2026-11-20): what Ponty would buy
    // (workshop.playerOffers - wishes, gear goals, finds; the same price and pot rules).
    // "seller|item|level" (or "buyer|item|sell") -> time a trip for it came back empty. In the
    // shared storage: every hop restarts the bot, and an in-memory list sent the merchant twice
    // to a stand that was gone (2026-11-20).
    const FAILED_KEY = "dmpx_trade_failed:" + character.name;
    const failedOffers = (function () {
        try { const f = get(FAILED_KEY) || {}; Object.keys(f).forEach(function (k) { if (Date.now() - f[k] > 30 * 60 * 1000) delete f[k]; }); return f; } catch (e) { return {}; }
    })();
    function markFailed(key, failed) {
        if (failed) failedOffers[key] = Date.now(); else delete failedOffers[key];
        try { set(FAILED_KEY, failedOffers); } catch (e) { /* storage unavailable */ }
    }
    function offerKey(seller, item, level) { return seller + "|" + item + "|" + level; }
    // A stand we just walked to may take a moment to show up.
    // Seen but not where the merchant list put the stand: walk up to where it really is - the
    // server trades only within a short distance (2026-11-20: "selling to Rocky: distance", the
    // list said 0,0).
    async function waitForPlayer(name) {
        for (let i = 0; i < 25; i++) {
            const p = get_player(name);
            if (p) {
                if (util.distanceTo(p) > 150) {
                    try { await util.walk({ map: character.map, x: p.x, y: p.y }); } catch (e) { /* checked by the trade */ }
                    return get_player(name) || p;
                }
                return p;
            }
            await sleep(200);
        }
        return null;
    }
    function bestBuyDeal(chars) {
        if (!stc.buyFromPlayers) return null;
        const offers = workshop.playerOffers(chars);
        for (const o of offers) {
            const server = serverName(o.char.server);
            if (!server) continue;
            if (Date.now() - (failedOffers[offerKey(o.char.name, o.name, o.level)] || 0) < 30 * 60 * 1000) continue;
            return { kind: "buy", server: server, seller: o.char.name, map: o.char.map, x: o.char.x, y: o.char.y,
                item: o.name, level: o.level, price: o.price, slot: o.slot, q: 1,
                offer: { kind: o.kind, fighter: o.fighter || null, own: o.own || null, gain: o.gain || null } };
        }
        return null;
    }
    function scanBuyOrders(chars) {
        const items = (stc.items || []).filter(function (s) { return G.items[s.item]; });
        if (!items.length) return null;
        const home = homeName();
        let best = null;
        chars.forEach(function (c) {
            if (!c || c.name === character.name || !c.slots || !c.stand) return; // stand closed: away
            const server = serverName(c.server);
            if (!server) return;
            Object.keys(c.slots).forEach(function (s) {
                const it = c.slots[s];
                if (!it || !it.b) return;
                const level = it.level || 0;
                // A rule per item level (2026-11-20: Vitality earrings +0 and +2).
                const rule = items.find(function (x) { return x.item === it.name && (x.level || 0) === level; });
                if (!rule || it.price < rule.minPrice) return;
                demand[it.name + ":" + level] = Date.now(); // a buyer at our price exists (workshop: hold the copies)
                if (Date.now() - (failedOffers[offerKey(c.name, it.name + (level ? "+" + level : ""), "sell")] || 0) < 30 * 60 * 1000) return;
                const surplus = workshop.ownedCount(it.name, level) - (rule.keep || 0);
                const q = Math.min(surplus, it.q || 1);
                if (q <= 0) return;
                const better = !best || it.price > best.price || (it.price === best.price && server === home && best.server !== home);
                if (better) best = { kind: "sell", server: server, buyer: c.name, map: c.map, x: c.x, y: c.y, item: it.name, level: level, price: it.price, q: q };
            });
        });
        saveDemand();
        return best;
    }
    // When a buyer at our minPrice was last seen per "item:level" (any server, open stand): the
    // workshop compounds sellTo items only after demandHours without one (player decision
    // 2026-11-20: sell Vitality earrings +0 while someone pays, else build +2 for stock).
    const DEMAND_KEY = "dmpx_sell_demand";
    const demand = (function () { try { return get(DEMAND_KEY) || {}; } catch (e) { return {}; } })();
    function saveDemand() {
        if (!demand._since) demand._since = Date.now(); // tracking started: nothing seen before counts as unknown
        try { set(DEMAND_KEY, demand); } catch (e) { /* storage unavailable */ }
    }
    // The largest single unlocked stack of name +level in the bag.
    function biggestStack(name, level) {
        return character.items.reduce(function (m, i) {
            return i && i.name === name && (i.level || 0) === level && !i.l ? Math.max(m, i.q || 1) : m;
        }, 0);
    }
    // Usable copies of name at exactly level in the bag (the server sells unlocked ones only).
    function countAt(name, level) {
        return character.items.reduce(function (s, i) {
            return i && i.name === name && (i.level || 0) === level && !i.l ? s + (i.q || 1) : s;
        }, 0);
    }
    // True while a sell trip holds the merchant.
    async function tradeTrip() {
        if (!stc.enabled) return false;
        const here = hereName(), home = homeName();
        let t = readTrip();
        if (!t) {
            if (here !== home || readRound() || Date.now() < nextSellScanAt) return false;
            scanAgainIn((stc.scanEveryMs || 5 * 60 * 1000));
            let chars = [];
            try { chars = await pullMerchants(); } catch (e) { util.log("merchant", "merchant list: " + util.errReason(e), "orange"); return false; }
            // Selling first (gold in), then the best offer to buy.
            const deal = scanBuyOrders(chars) || bestBuyDeal(chars);
            if (!deal) return false;
            t = { phase: "fetch", deal: deal, at: Date.now(), beat: Date.now() };
            saveTrip(t);
            if (deal.kind === "buy") util.log("merchant", "offer found: " + deal.seller + " (" + deal.server + ") sells " + deal.item + " +" + deal.level + " for " + Math.round(deal.price / 1000) + "k (" + deal.offer.kind + (deal.offer.fighter ? " for " + deal.offer.fighter : "") + ") - buying", "yellow");
            else util.log("merchant", "buy order found: " + deal.buyer + " (" + deal.server + ") pays " + Math.round(deal.price / 1000) + "k for " + deal.item + (deal.level ? " +" + deal.level : "") + " - selling " + deal.q, "yellow");
        }
        t.beat = Date.now();
        const d = t.deal;
        if (t.phase === "fetch" && d.kind === "buy") {
            if (character.gold < d.price || character.esize < 1) { util.log("merchant", "no gold or room for " + d.item + " - not buying", "orange"); saveTrip(null); return false; }
            t.phase = d.server === here ? "sell" : "travel";
            t.at = Date.now();
            saveTrip(t);
            if (t.phase === "travel") requestHop(d.server);
            return true;
        }
        if (t.phase === "fetch") {
            // The surplus into the bag (bank first); then off to the buyer.
            const lvl = d.level || 0;
            // Always through the bank: a fresh read there is the only reliable count - the scan's
            // surplus came from a snapshot that may still list what is already in the bag (review
            // 2026-11-20: the kept tokens could go).
            if (await util.walkToBank()) {
                if (workshop.refreshBank) workshop.refreshBank();
                for (const pack of Object.keys(character.bank || {})) {
                    if (!/^items\d+$/.test(pack)) continue;
                    const list = character.bank[pack] || [];
                    for (let i = 0; i < list.length && countAt(d.item, lvl) < d.q; i++) {
                        if (character.esize < 1) break;
                        if (list[i] && list[i].name === d.item && (list[i].level || 0) === lvl) { try { await bank_retrieve(pack, i); } catch (e) { /* next one */ } }
                    }
                }
                if (workshop.refreshBank) workshop.refreshBank();
                const rule = (stc.items || []).find(function (x) { return x.item === d.item && (x.level || 0) === lvl; }) || {};
                d.q = Math.min(d.q, workshop.ownedCount(d.item, lvl) - (rule.keep || 0));
            } else d.q = 0; // no fresh count: not this time
            d.q = Math.min(d.q, countAt(d.item, lvl));
            if (d.q <= 0) { util.log("merchant", "no " + d.item + " to sell after all", "orange"); saveTrip(null); return false; }
            t.phase = d.server === here ? "sell" : "travel";
            t.at = Date.now();
            saveTrip(t);
            if (t.phase === "travel") requestHop(d.server);
            return true;
        }
        if (t.phase === "travel") {
            if (here === d.server) { t.phase = "sell"; t.at = Date.now(); saveTrip(t); return true; }
            if (Date.now() - t.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { t.at = Date.now(); requestHop(d.server); }
            saveTrip(t);
            return true;
        }
        if (t.phase === "sell" && d.kind === "buy") {
            util.status("buying from " + d.seller, "yellow");
            try { await util.walk({ map: d.map, x: d.x, y: d.y }); } catch (e) { /* checked below */ }
            const seller = await waitForPlayer(d.seller);
            // Not at the stand (merchants walk to their fighters): no block, it is tried again
            // when the merchant list shows the stand open (player decision 2026-11-20). Any
            // other failure blocks the offer for 30 min; a purchase clears it.
            if (seller) markFailed(offerKey(d.seller, d.item, d.level), true);
            if (!seller) {
                util.log("merchant", d.seller + " not at the stand - no purchase, trying again later", "orange");
                scanAgainIn((stc.scanEveryMs || 5 * 60 * 1000));
            } else {
                // The listed slot, or the same item elsewhere on the stand - never dearer than planned.
                const ok = function (s) { const it = seller.slots && seller.slots[s]; return it && !it.b && it.name === d.item && (it.level || 0) === d.level && it.price <= d.price; };
                const slot = ok(d.slot) ? d.slot : Object.keys(seller.slots || {}).find(ok);
                if (!slot) util.log("merchant", d.seller + " no longer sells " + d.item + " +" + d.level + " at that price", "orange");
                else {
                    const price = seller.slots[slot].price;
                    try {
                        await trade_buy(seller, slot, 1);
                        markFailed(offerKey(d.seller, d.item, d.level), false);
                        workshop.bookPlayerBuy(Object.assign({}, d.offer, { name: d.item, level: d.level, price: price, seller: d.seller, server: here }));
                        util.log("merchant", "bought " + d.item + " +" + d.level + " from " + d.seller + " (" + here + ") for " + Math.round(price / 1000) + "k", "green");
                        try { const log = get("dmpx_trade_log") || []; set("dmpx_trade_log", log.concat([{ at: Date.now(), kind: "buy", server: here, seller: d.seller, item: d.item, level: d.level, q: 1, price: price }]).slice(-100)); } catch (e) { /* log only */ }
                    } catch (e) { util.log("merchant", "buying from " + d.seller + ": " + util.errReason(e), "orange"); }
                }
            }
            // No quick follow-up scan after a purchase any more (2026-11-20): the next one comes with
            // the normal interval, so the merchant gets on with its work between trips.
            t.phase = here === home ? "done" : "home";
            t.at = Date.now();
            saveTrip(t.phase === "done" ? null : t);
            if (t.phase === "home") requestHop(home);
            return t.phase === "home";
        }
        if (t.phase === "sell") {
            util.status("selling to " + d.buyer, "yellow");
            try { await util.walk({ map: d.map, x: d.x, y: d.y }); } catch (e) { /* checked below */ }
            const buyer = await waitForPlayer(d.buyer);
            let sold = 0, goldShort = false;
            if (!buyer) {
                util.log("merchant", d.buyer + " not at the stand - no sale, trying again later", "orange");
                scanAgainIn(stc.scanEveryMs || 5 * 60 * 1000);
            }
            else {
                const lvl = d.level || 0;
                const rule = (stc.items || []).find(function (x) { return x.item === d.item && (x.level || 0) === lvl; }) || {};
                const slot = Object.keys(buyer.slots || {}).find(function (s) {
                    const it = buyer.slots[s];
                    return it && it.b && it.name === d.item && (it.level || 0) === lvl && it.price >= (rule.minPrice || d.price);
                });
                // Not stackable (earrings): the server sells one item per call (q <= the item's q).
                const stacks = !!(G.items[d.item] && G.items[d.item].s);
                if (!slot) util.log("merchant", d.buyer + " no longer buys " + d.item + (lvl ? " +" + lvl : "") + " at our price", "orange");
                else {
                    // d.q is the surplus above "keep", counted before the trip (bag + bank).
                    // The server refuses the whole sale when the buyer can't pay all of it
                    // ("buyer_gold"): then half as many, again, down to one - and after each sale
                    // the next portion of that size until the buyer is out of gold (2026-11-20).
                    let remaining = Math.min(d.q, buyer.slots[slot].q || 1);
                    let chunk = remaining, gold = 0;
                    const price = buyer.slots[slot].price;
                    while (remaining > 0 && chunk >= 1) {
                        const b = get_player(d.buyer);
                        const cur = b && b.slots && b.slots[slot];
                        if (!cur || !cur.b || cur.name !== d.item || (cur.level || 0) !== lvl || cur.price < (rule.minPrice || d.price)) break;
                        // The server sells from ONE bag stack holding the whole amount (review 2026-11-20).
                        const c = stacks ? Math.min(chunk, remaining, cur.q || 1, biggestStack(d.item, lvl)) : Math.min(1, countAt(d.item, lvl));
                        if (c <= 0) break;
                        try {
                            await trade_sell(b, slot, c);
                            sold += c;
                            remaining -= c;
                            gold += cur.price * c;
                        } catch (e) {
                            const why = util.errReason(e);
                            if (why === "buyer_gold") { goldShort = true; chunk = Math.floor(c / 2); continue; }
                            util.log("merchant", "selling to " + d.buyer + ": " + why, "orange");
                            break;
                        }
                        await sleep(400); // let the buyer's slot update
                    }
                    if (sold) {
                        util.log("merchant", "sold " + sold + "x " + d.item + (lvl ? " +" + lvl : "") + " to " + d.buyer + " for " + Math.round(gold / 1000) + "k" + (remaining > 0 ? " (" + remaining + " more than it could pay)" : ""), "green");
                        try { const log = get("dmpx_trade_log") || []; set("dmpx_trade_log", log.concat([{ at: Date.now(), server: here, buyer: d.buyer, item: d.item, level: lvl, q: sold, price: price }]).slice(-100)); } catch (e) { /* log only */ }
                    } else if (chunk < 1) util.log("merchant", d.buyer + " can't pay even one " + d.item, "orange");
                }
            }
            // Nothing sold, or the buyer ran out of gold before taking everything: not this buyer for
            // 30 min (player decision 2026-11-20 - no hop to Rocky every 5 min for one token).
            // A buyer away from its stand is not blocked (it walks to its fighters, 2026-11-20).
            if (buyer) markFailed(offerKey(d.buyer, d.item + (d.level ? "+" + d.level : ""), "sell"), sold === 0 || goldShort);
            t.phase = here === home ? "done" : "home";
            t.at = Date.now();
            saveTrip(t.phase === "done" ? null : t);
            if (t.phase === "home") requestHop(home);
            return t.phase === "home";
        }
        if (t.phase === "home") {
            if (here === home) { saveTrip(null); util.log("merchant", "sell trip done", "green"); return false; }
            if (Date.now() - t.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { t.at = Date.now(); requestHop(home); }
            saveTrip(t);
            return true;
        }
        saveTrip(null);
        return false;
    }

    async function work() {
        if (busy) return;
        busy = true;
        try {
            if (await pontyRound()) return;
            if (await tradeTrip()) return;
            // A (nearly) full bag first sheds its junk in town: otherwise a pickup can't take
            // the loot (send_no_space) and the bag never empties (2026-11-17).
            if (character.esize < 4) {
                await goHome();
                await sellJunk();
            }
            const next = requests.keys().next();
            if (!next.done) {
                await bankBeforePickup();
                await deliver(next.value);
                await goHome();
                return;
            }
            // Boss search for the team (events.scout, 2026-11-23): after pickups and deliveries, before the chores.
            if (ctx.scout && await ctx.scout.work()) {
                await goHome();
                return;
            }
            await goHome();
            if (Date.now() >= nextChoresAt) {
                nextChoresAt = Date.now() + 30 * 1000;
                await sellJunk();
                await bankIfNeeded();
                await workshop.work();
                await goHome();
                await restock();
            }
            if (fishingDue()) {
                await fish();
                await goHome();
            }
            // A tool still in hand (e.g. after a restart while fishing) slows us down: bag it.
            const held = character.slots && character.slots.mainhand;
            if (held && (held.name === "rod" || held.name === "pickaxe") && character.esize > 0) await unequip("mainhand").catch(function () {});
            keepStand();
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
    let lastMluck = 0, mluckCasts = 0, mluckSince = Date.now();
    function mluckTick() {
        if (!mlc.enabled || !G.skills.mluck || character.level < (G.skills.mluck.level || 0)) return;
        if (Date.now() - lastMluck < 500 || !util.canCast("mluck")) return;
        // Never during a channel (Town teleport, fishing, mining): a skill would cancel it.
        if (util.townChannel() || (character.c && (character.c.fishing || character.c.mining))) return;
        if (character.mp < G.skills.mluck.mp + (mlc.mpReserve || 100)) return;
        const refresh = mlc.refreshBelowMs || 30 * 60 * 1000;
        const team = ((config.team && config.team.fighters) || []).concat([character.name]);
        const range = G.skills.mluck.range || 320;
        const needs = function (p) {
            const s = p.s && p.s.mluck;
            if (!s) return 0; // none at all: most urgent
            if (s.f === character.name) return s.ms < refresh ? s.ms : -1;
            if (s.strong) return -1; // another account's own merchant: the server keeps theirs
            return 1;
        };
        const list = [character];
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "character" || e.npc || e.rip) return;
            if (!team.includes(e.name) && (!mlc.strangers || e.ctype === "merchant")) return; // merchants loot nothing
            if (util.distanceTo(e) > range) return;
            list.push(e);
        });
        let best = null, bestNeed = Infinity, bestOurs = false;
        list.forEach(function (p) {
            const n = needs(p);
            if (n < 0) return;
            const ours = team.includes(p.name);
            // Our own characters first, then the most urgent.
            if (!best || (ours && !bestOurs) || (ours === bestOurs && n < bestNeed)) { best = p; bestNeed = n; bestOurs = ours; }
        });
        if (!best) return;
        lastMluck = Date.now();
        use_skill("mluck", best === character ? character.name : best.name).catch(function () {});
        mluckCasts++;
        if (Date.now() - mluckSince > 60 * 60 * 1000) {
            util.log("merchant", "Merchant's Luck: " + mluckCasts + " casts in the last hour", "white");
            mluckCasts = 0;
            mluckSince = Date.now();
        }
    }

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
                    mluckTick();
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
