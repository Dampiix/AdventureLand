// =====================================================================
// roles/merchant/delivery.js - deliveries to the fighters: pickups, gifts, class items, one of each.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, busy, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop, scout, teamView - optional).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const m = config.merchantRole;
    const workshop = deps.workshop;

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

    // A fighter's live position from its team view entry (team view step 3, 2026-11-25): it runs in our client on our
    // server - exact and current, where its "pos" message is up to positionEveryMs old. Null otherwise (or dead).
    function liveSpot(name) {
        try {
            const tv = deps.teamView;
            const e = tv && tv.member(name);
            const c = e && e.game();
            if (!c || c.rip || !c.map || typeof c.real_x !== "number") return null;
            return { map: c.map, x: c.real_x, y: c.real_y, live: true };
        } catch (x) { return null; }
    }

    // Walk after a fighter that keeps farming (player decision 2026-11-17): towards the
    // newest position we know - its live position while we see it, else its live position
    // from the team view (step 3), otherwise its last "pos" message - and re-route when it
    // moved on. Returns the fighter once we are next to it, or null after followMs.
    async function catchUp(name) {
        const until = Date.now() + (m.followMs || 4 * 60 * 1000);
        let noted = false;
        const newest = function () {
            const seen = get_player(name);
            if (seen && (!seen.map || seen.map === character.map)) return { map: character.map, x: seen.x, y: seen.y, seen: seen };
            const live = liveSpot(name);
            if (live) {
                if (!noted) { noted = true; util.log("merchant", "following " + name + " by its live position (team view)", "white"); }
                return live;
            }
            const r = mer.requests.get(name);
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
        const req = mer.requests.get(name);
        util.status("delivering to " + name, "orange");
        try {
            if (mer.atHome()) await mer.restock(req.want);
            const fighter = await catchUp(name);
            if (!fighter) {
                util.log("merchant", "couldn't catch up with " + name + " - waiting for a new request", "orange");
                return;
            }

            await giveTo(name, (mer.requests.get(name) || req).want);
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
            mer.requests.delete(name);
        }
    }

    Object.assign(mer, {
        giveTo: giveTo,
        giveGifts: giveGifts,
        giveClassItems: giveClassItems,
        giveOneEach: giveOneEach,
        catchUp: catchUp,
        deliver: deliver,
    });
};
