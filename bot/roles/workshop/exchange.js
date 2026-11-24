// =====================================================================
// roles/workshop/exchange.js - exchanging boxes, gems and seashells, elixirs from the exchange, token shops.
// Part of bot_workshop (module plan, stage 6): moved verbatim from the old single-file roles/workshop.js. The parts
// share one internal state (wks: wishes, bank snapshot, budgets, blocks, caches) and call each other through wks;
// outside dependencies come in deps (config, util, comms).
// =====================================================================

module.exports = function install(wks, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.workshop;

    // ---- exchange -----------------------------------------------------------

    // Quest items go to their quest NPC (e.g. seashells -> Tristian), the rest to Xyn.
    function exchangeNpc(name) {
        const quest = G.items[name].quest;
        if (!quest) return "exchange";
        return Object.keys(G.npcs).find(function (id) { return G.npcs[id].quest === quest && wks.npcPos(id); }) || null;
    }

    function exchangeStack(name, need) {
        return util.findItemIndex(function (i) { return i.name === name && (i.q || 1) >= need; });
    }

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
                !!(wks.bankSnapshot && wks.bankSnapshot.items.some(function (b) { return b.name === src; }));
        });
    }

    // A wished item that only comes out of something we hold (e.g. Rugged armor from
    // Armor Boxes): open one batch of that source. Sources listed in
    // config.workshop.exchange.onDemand only, while the bank keeps room for the rewards.
    async function openSourceFor(name) {
        const ex = cfg.exchange || {};
        const sources = (ex.onDemand || []).filter(function (src) {
            const t = G.drops[src];
            return Array.isArray(t) && t.some(function (d) { return d && d[1] === name; }) && G.items[src];
        });
        if (!sources.length) return false;
        if ((ex.hold || []).includes(sources[0])) return false; // hoarded for a later batch
        if (wks.bankSnapshot && wks.bankSnapshot.free < (ex.onDemandBankFree || 10)) {
            util.log("workshop", "would open " + sources[0] + " for " + name + " but the bank is nearly full", "orange");
            return false;
        }
        // Copies from earlier boxes come first: opening more while 3+ wait only piled up
        // Rugged pants and coats (2026-11-17).
        if (wks.waitingBoxArmor() >= 3) return false;
        if (character.esize < (ex.keepFree || 8)) return false;
        for (const src of sources) {
            const need = G.items[src].e || 1;
            if (exchangeStack(src, need) === -1) {
                const banked = wks.bankSnapshot && wks.bankSnapshot.items.find(function (b) { return b.name === src && b.q >= need; });
                if (!banked) continue;
                await wks.retrieve(banked);
            }
            const npc = exchangeNpc(src);
            if (!npc) continue;
            await wks.goTo(npc);
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

    // ---- elixirs from the exchange (v1.229.0, config.elixirs) ----------------------------------------------------
    // The team's stat elixirs that come out of the elixir source (Seashells -> basic elixir box): one per class in the
    // team (byClass), only those the source can give. Short: one of them below min (bag + bank) starts a refill that runs
    // until every one is at refill (in memory - a restart in between waits for the next one below min).
    function elixirExchange() { return ((config.elixirs || {}).exchange) || {}; }
    function teamStatElixirs() {
        const el = config.elixirs || {};
        const src = elixirExchange().source;
        const table = src && G.drops[src] ? G.drops[src] : null;
        const fromSource = function (it) {
            if (!table) return false;
            return table.some(function (d) {
                if (!d) return false;
                if (d[1] === it) return true;
                return d[1] === "open" && Array.isArray(G.drops[d[2]]) && G.drops[d[2]].some(function (x) { return x && x[1] === it; });
            });
        };
        const out = [];
        ((config.team && config.team.fighters) || []).forEach(function (f) {
            const ctype = wks.classes[f];
            const it = ctype && (el.byClass || {})[ctype];
            if (it && G.items[it] && fromSource(it) && !out.includes(it)) out.push(it);
        });
        return out;
    }
    function elixirsShort() {
        const el = config.elixirs || {};
        const exc = elixirExchange();
        if (!el.enabled || !exc.source) return false;
        const list = teamStatElixirs();
        if (!list.length) return false;
        if (list.some(function (it) { return wks.ownedCount(it) < (exc.min || 6); })) {
            if (!wks.elixirRefill) util.log("workshop", "elixirs short (" + list.map(function (it) { return it + " " + wks.ownedCount(it); }).join(", ") + ") - exchanging " + exc.source + " until " + (exc.refill || 20) + " each", "yellow");
            wks.elixirRefill = true;
        }
        if (wks.elixirRefill && list.every(function (it) { return wks.ownedCount(it) >= (exc.refill || 20); })) {
            util.log("workshop", "elixir refill done (" + list.map(function (it) { return it + " " + wks.ownedCount(it); }).join(", ") + ")", "green");
            wks.elixirRefill = false;
        }
        return wks.elixirRefill;
    }

    // Without wishes or compound work: exchange boxes, gems, seashells ...
    // (config.workshop.exchange.items) in batches while the bag has room.
    async function autoExchange() {
        const ex = cfg.exchange;
        if (!ex.enabled) return false;
        // Rewards need somewhere to go: no exchanging while the bank is (almost) full.
        if (wks.bankSnapshot && wks.bankSnapshot.free < 3) {
            util.status("bank full - not exchanging", "orange");
            return false;
        }
        const now = Date.now();
        for (const name of ex.items) {
            const def = G.items[name];
            if (!def || wks.blockedUntil["exchange:" + name] > now) continue;
            if ((ex.hold || []).includes(name)) continue; // hoarded for a later batch
            const need = def.e || 1;
            if (character.esize < ex.keepFree) return false;
            // The elixir source (Seashells, v1.229.0): only while a stat elixir of the team is short, and never below
            // sourceKeep (Loaded Die).
            const elixirSource = elixirExchange().source === name;
            if (elixirSource && !elixirsShort()) continue;
            const sourceLeft = function () { return wks.ownedCount(name) - (elixirExchange().sourceKeep || 0); };
            if (elixirSource && sourceLeft() < need) continue;

            if (exchangeStack(name, need) === -1) {
                const banked = wks.bankSnapshot && wks.bankSnapshot.items.find(function (b) { return b.name === name && b.q >= need; });
                if (!banked) continue;
                await wks.retrieve(banked);
            }
            const npc = exchangeNpc(name);
            if (!npc) {
                wks.blockedUntil["exchange:" + name] = now + cfg.giveUpForMs;
                continue;
            }
            util.status("exchanging " + name, "orange");
            await wks.goTo(npc);

            const rewards = [];
            while (rewards.length < ex.batch && character.esize >= ex.keepFree) {
                if (elixirSource && (!elixirsShort() || sourceLeft() < need)) break;
                const index = exchangeStack(name, need);
                if (index === -1) break;
                try {
                    await wks.boost("massexchange");
                    const result = await exchange(index);
                    rewards.push(result && result.reward ? result.reward : "?");
                } catch (e) {
                    util.log("workshop", "exchange " + name + ": " + util.errReason(e) + " - pausing it", "orange");
                    wks.blockedUntil["exchange:" + name] = Date.now() + cfg.giveUpForMs;
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
        // Token order (workshop.tokenOrder, 2026-11-22 player decision): a purchase waits while an item listed before it
        // is still wished - Fun Tokens go to the Rabbit's Foot (one buy, a big step) before the Shield M (many buys).
        const order = (cfg.tokenOrder || {})[offer.token];
        const at = order ? order.indexOf(name) : -1;
        if (at > 0) {
            const first = order.slice(0, at).find(function (n) {
                return wks.fighters().some(function (f) { return wks.wishList(f).some(function (w) { return w.name === n; }); });
            });
            if (first) throw { reason: offer.token + " kept for " + first };
        }
        // A fighter already wears one (e.g. a Hunter piece stopped below its wished level):
        // we never upgrade worn gear, and a second copy would only burn tokens.
        const wearer = Object.keys(wks.worn).find(function (f) {
            return config.team.fighters.includes(f) && Object.values(wks.worn[f] || {}).some(function (x) { return x && x.name === name; });
        });
        if (wearer) {
            util.log("workshop", wearer + " already wears " + name + " - not buying another for " + offer.price + " " + offer.token, "white");
            return false;
        }
        let have = util.countItem(offer.token);
        if (have < offer.price) {
            const banked = wks.bankSnapshot && wks.bankSnapshot.items.find(function (b) { return b.name === offer.token; });
            if (banked && have + banked.q >= offer.price) {
                await wks.retrieve(banked);
                have = util.countItem(offer.token);
            }
        }
        if (have < offer.price) {
            util.log("workshop", name + " costs " + offer.price + " " + offer.token + ", we have " + have, "orange");
            return false;
        }
        const npc = Object.keys(G.npcs).find(function (id) { return G.npcs[id].token === offer.token && wks.npcPos(id); });
        if (!npc) return false;
        await wks.goTo(npc);
        await exchange_buy(offer.token, name);
        util.log("workshop", "bought " + name + " for " + offer.price + " " + offer.token, "green");
        return true;
    }

    Object.assign(wks, {
        exchangeNpc: exchangeNpc,
        exchangeStack: exchangeStack,
        heldBoxFor: heldBoxFor,
        openSourceFor: openSourceFor,
        elixirExchange: elixirExchange,
        teamStatElixirs: teamStatElixirs,
        elixirsShort: elixirsShort,
        autoExchange: autoExchange,
        tokenOffer: tokenOffer,
        buyWithTokens: buyWithTokens,
    });
};
