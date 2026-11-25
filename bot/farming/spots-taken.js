// =====================================================================
// farming/spots-taken.js - spots other players hold, crowded and too-strong spots, the stand point on a spot.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.targeting;
    const CROWD_KEY = "bot_crowded:" + character.name;
    const STRONG_KEY = "bot_strong_spots:" + character.name;

    function spotKey(s) { return s.map + ":" + s.x + ":" + s.y; }
    function strangersNear(p, r) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "character" && !e.npc && !e.rip && !config.characters[e.name] &&
                Math.hypot(e.real_x - p.x, e.real_y - p.y) <= r;
        });
    }
    function occupiedSpots() {
        const now = Date.now();
        return Object.keys(tgt.occupiedUntil).filter(function (k) { return tgt.occupiedUntil[k] > now; })
            .concat(Object.keys(tgt.strongSpotUntil).filter(function (k) { return tgt.strongSpotUntil[k] > now; })).map(function (k) {
            const p = k.split(":");
            return { map: p[0], x: Number(p[1]), y: Number(p[2]) };
        });
    }
    function inOccupied(e) {
        const p = util.xy(e);
        const r = cfg.occupiedRadius || 300;
        return occupiedSpots().some(function (s) { return s.map === character.map && Math.hypot(p.x - s.x, p.y - s.y) <= r; });
    }
    function busyShare(windowMs) {
        const now = Date.now();
        while (tgt.busyLog.length && now - tgt.busyLog[0][0] > windowMs) tgt.busyLog.shift();
        let ms = 0, on = 0;
        for (let i = 1; i < tgt.busyLog.length; i++) {
            const dt = Math.min(5000, tgt.busyLog[i][0] - tgt.busyLog[i - 1][0]);
            ms += dt;
            if (tgt.busyLog[i][1]) on += dt;
        }
        return { ms: ms, share: ms > 0 ? on / ms : 0 };
    }
    // Other players' fighters on a spot (merchants never count).
    function fightersNear(p) {
        return strangersNear(p, cfg.occupiedRadius || 300).filter(function (e) { return e.ctype !== "merchant"; });
    }
    // An occupied spot we stand on with no other fighter on it for occupiedFreeMs is free again
    // (player decision 2026-11-20: the croc spot stayed "taken" long after the player had left,
    // and the detached warrior stood idle among six free crocs until the crowded check fired).
    function releaseFreedSpots() {
        const now = Date.now();
        occupiedSpots().forEach(function (s) {
            const k = spotKey(s);
            if (tgt.strongSpotUntil[k] > now) return; // too strong, not taken: it frees up by time only
            const near = character.map === s.map && Math.hypot(character.real_x - s.x, character.real_y - s.y) <= 400;
            if (!near || fightersNear(s).length) { delete tgt.emptySince[k]; return; }
            if (!tgt.emptySince[k]) tgt.emptySince[k] = now;
            if (now - tgt.emptySince[k] < (cfg.occupiedFreeMs || 30 * 1000)) return;
            delete tgt.occupiedUntil[k];
            delete tgt.emptySince[k];
            util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " is free again", "green");
        });
    }
    function checkOccupied() {
        releaseFreedSpots();
        const s = tgt.lastSpot;
        // Only the spot of our current farm target (2026-11-20): a spot remembered from an earlier
        // target was marked taken while we stood next to it with the leader, and blocked it later.
        if (!s || !tgt.farm || tgt.farm.any || s.type !== tgt.farm.monster) return;
        if (character.map !== s.map || tgt.occupiedUntil[spotKey(s)] > Date.now()) return;
        if (Math.hypot(character.real_x - s.x, character.real_y - s.y) > 400) return; // judged on the spot only
        // Only players who stay: merchants never count, and a fighter must be seen on the spot
        // for occupiedAfterMs (2026-11-18: a merchant walking past blocked the goo spot for 20 min).
        const now = Date.now();
        const here = fightersNear(s);
        Object.keys(tgt.strangerSince).forEach(function (n) { if (!here.some(function (e) { return e.name === n; })) delete tgt.strangerSince[n]; });
        here.forEach(function (e) { if (!tgt.strangerSince[e.name]) tgt.strangerSince[e.name] = now; });
        const others = here.filter(function (e) { return now - tgt.strangerSince[e.name] >= (cfg.occupiedAfterMs || 20000); });
        if (others.length < (cfg.occupiedBy || 1)) return;
        // Shared, not taken (player decision 2026-11-21): a lone bot farming single giant scorpions
        // left more than enough for us, but the spot counted as taken after 20 s. While we had a target
        // at least stayIfBusy of the last shareWindowMs, we stay; judged once shareMinMs of it is known.
        const busy = busyShare(cfg.shareWindowMs || 2 * 60 * 1000);
        if (cfg.stayIfBusy && busy.ms < (cfg.shareMinMs || 60 * 1000)) return; // not enough known yet
        if (cfg.stayIfBusy && busy.share >= cfg.stayIfBusy) {
            const who = others.map(function (e) { return e.name; }).join(", ");
            if (tgt.sharedLogged !== who + "|" + spotKey(s)) {
                tgt.sharedLogged = who + "|" + spotKey(s);
                util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " shared with " + who + " - staying, we had a target " + Math.round(busy.share * 100) + "% of the time", "white");
            }
            return;
        }
        tgt.sharedLogged = "";
        tgt.occupiedUntil[spotKey(s)] = Date.now() + (cfg.occupiedForMs || 20 * 60 * 1000);
        util.log("target", "spot " + s.map + " " + s.x + "," + s.y + " is taken by " + others.map(function (e) { return e.name; }).join(", ") +
            (cfg.stayIfBusy ? " (we had a target " + Math.round(busy.share * 100) + "% of " + Math.round(busy.ms / 1000) + " s, need " + Math.round(cfg.stayIfBusy * 100) + "%)" : "") +
            " - another one for " + Math.round((cfg.occupiedForMs || 20 * 60 * 1000) / 60000) + " min", "orange");
        // Every spot of our farm target taken (2026-11-18: squigtoads have a single spot, bots on
        // it, the rogue stood there on "find"): skip the monster like a crowded one, pick again.
        if (tgt.farm && tgt.farm.monster && !tgt.farm.any && allSpotsTaken(tgt.farm.monster)) {
            tgt.crowdedUntil[tgt.farm.monster] = Date.now() + (cfg.occupiedForMs || 20 * 60 * 1000);
            tgt.nextPickAt = 0;
            util.log("target", "every " + tgt.farm.monster + " spot is taken - another farm target", "orange");
        }
    }
    // ignoreStrong: only other players count (the Cavalry plan resets too-strong spots).
    // A spot whose whole spawn (rage zone) the team can't take counts as taken like a too-strong one (v1.238.1): the
    // 9 mummies in Spooky Town were "free" while level3 / level4 were too strong, so the mummies stayed a choice and the
    // team walked to the rage box and stuck there.
    function allSpotsTaken(type, ignoreStrong) {
        const now = Date.now();
        let any = false, free = false;
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== type) return;
                const boxes = pack.boundaries ? pack.boundaries : pack.boundary ? [[m].concat(pack.boundary)] : [];
                boxes.forEach(function (b) {
                    any = true;
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) };
                    if (!(tgt.occupiedUntil[spotKey(spot)] > now) && (ignoreStrong || (!(tgt.strongSpotUntil[spotKey(spot)] > now) &&
                        !(tgt.failingSpawnAt && tgt.failingSpawnAt(type, spot))))) free = true;
                });
            });
        });
        return any && !free;
    }
    // Where to walk for a farm target: the spawn pack on its map (guide routes name one),
    // else the biggest pack of that monster anywhere. smart_move("cgoo") picked the nearest
    // spawn, through the vampire rats at the underground entrance, while 32 CGoos wait in
    // the arena right next to town.
    function spotFor(type, mapName) {
        // The spot a Cavalry reset was planned for (hunt reset, 2026-11-22) - even though it is marked too strong.
        if (tgt.cavPlan && tgt.cavPlan.spot && tgt.cavPlan.monster === type) {
            tgt.lastSpot = { map: tgt.cavPlan.spot.map, x: tgt.cavPlan.spot.x, y: tgt.cavPlan.spot.y, type: type };
            return { map: tgt.cavPlan.spot.map, x: tgt.cavPlan.spot.x, y: tgt.cavPlan.spot.y };
        }
        let best = null, bestSafe = null, bestFree = null;
        const now = Date.now();
        Object.keys(G.maps).forEach(function (m) {
            const map = G.maps[m];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== type) return;
                const boxes = pack.boundaries ? pack.boundaries : pack.boundary ? [[m].concat(pack.boundary)] : [];
                boxes.forEach(function (b) {
                    const spot = { map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2), count: pack.count || 1 };
                    const score = (mapName && spot.map === mapName ? 1000 : 0) + spot.count;
                    spot.score = score;
                    if (!best || score > best.score) best = spot;
                    const failing = !!(tgt.failingSpawnAt && tgt.failingSpawnAt(type, spot));
                    if (!failing && (!bestSafe || score > bestSafe.score)) bestSafe = spot;
                    // Nor one whose whole spawn (rage zone) the team can't take (v1.238.0): the mummies in level3 / level4
                    // instead of the 9 in Spooky Town's rage box.
                    if (!(tgt.occupiedUntil[spotKey(spot)] > now) && !(tgt.strongSpotUntil[spotKey(spot)] > now) &&
                        !failing && (!bestFree || score > bestFree.score)) bestFree = spot;
                });
            });
        });
        // Every spot taken: the best one whose whole spawn does not fail (its edge check holds us outside), else the best
        // one anyway - only a forced target (config, event) gets that far (v1.238.1: the test with the mummies as the
        // config target walked to the 9-mummy rage box once level3 / level4 were too strong).
        const pickSpot = bestFree || bestSafe || best;
        if (pickSpot) tgt.lastSpot = { map: pickSpot.map, x: pickSpot.x, y: pickSpot.y, type: type };
        return pickSpot ? { map: pickSpot.map, x: pickSpot.x, y: pickSpot.y } : null;
    }
    function saveStrong() { try { set(STRONG_KEY, tgt.strongSpots); } catch (e) { /* storage unavailable */ } }
    function tooStrongHere(m) {
        const ns = tgt.noneSeen[m];
        return !!(ns && Date.now() - ns.at < 3 * 60 * 1000 && ns.unsafe > 0 && ns.taken === 0);
    }
    // strong (spot check, 2026-11-22): too strong, judged from the edge - `why` says what we saw.
    function markCrowded(why, strong) {
        const now = Date.now();
        // Without the Cavalry a too-strong spot is skipped like a crowded one (crowdedForMs, doubling on repeats).
        if ((config.cavalry || {}).enabled && (strong || tooStrongHere(tgt.farm.monster))) {
            const until = Math.max(tgt.cavalryNext(), now + 10 * 60 * 1000);
            tgt.crowdedUntil[tgt.farm.monster] = until;
            tgt.strongSpots[tgt.farm.monster] = now;
            saveStrong();
            const what = strong ? "spot check: " + why : tgt.noneSeen[tgt.farm.monster].unsafe + " of " + tgt.noneSeen[tgt.farm.monster].seen + " in sight";
            // The ~10 min were only the fallback block when the Cavalry is ready already (v1.235.4): then the reset comes
            // right away (cavalryPlan) and lifts the block.
            util.log("target", tgt.farm.monster + " too strong here (" + what + ") - " + (tgt.cavalryNext() <= now ? "the Cavalry is ready: reset first" :
                "blocked until the Cavalry is ready (~" + Math.max(1, Math.round((until - now) / 60000)) + " min), then reset"), "orange");
            tgt.idleSince = 0;
            tgt.win = null;
            tgt.nextPickAt = 0;
            return;
        }
        const h = tgt.crowdHistory[tgt.farm.monster];
        // A repeat within a day of the last time counts up; otherwise start over.
        const n = h && now - h.at < 24 * 60 * 60 * 1000 ? h.n + 1 : 1;
        const ms = Math.min(cfg.crowdedMaxMs || cfg.crowdedForMs, cfg.crowdedForMs * Math.pow(2, n - 1));
        tgt.crowdedUntil[tgt.farm.monster] = now + ms;
        tgt.crowdHistory[tgt.farm.monster] = { n: n, at: now, until: now + ms };
        try { set(CROWD_KEY, tgt.crowdHistory); } catch (e) { /* storage unavailable */ }
        util.log("target", tgt.farm.monster + (strong ? " too strong (spot check: " : " spot looks crowded (") + why + ") - trying another target for " + Math.round(ms / 60000) + " min", "orange");
        tgt.idleSince = 0;
        tgt.win = null;
        tgt.nextPickAt = 0; // pick again right away
    }
    // Called by the fighter every combat tick. If we stand on the farm map for
    // a while without any free target (other players clear the spot), mark the
    // spot as crowded and move on to the guide's next choice (or the next drop route).
    // Besides a long gap without any target, a spot where other players leave us only
    // the odd monster is crowded too: we measure the share of time without a target over
    // a sliding window (crowdedWindowMs) and give up above crowdedIdleShare.
    function reportSearch(found) {
        const src = tgt.farm ? String(tgt.farm.source) : "";
        const now = Date.now();
        if (found) tgt.lastFoundAt = now;
        // Only on the spot of our farm target (walking there is no idle time on the spot).
        const sp = tgt.lastSpot;
        if (sp && tgt.farm && sp.type === tgt.farm.monster && character.map === sp.map && Math.hypot(character.real_x - sp.x, character.real_y - sp.y) <= 400) tgt.busyLog.push([now, !!found]);
        else tgt.busyLog.length = 0;
        if (tgt.busyLog.length > 2000) tgt.busyLog.splice(0, tgt.busyLog.length - 2000);
        if (!tgt.farm || !(src.startsWith("guide") || src.startsWith("drop") || src === "config list") || character.map !== tgt.farm.map) {
            tgt.idleSince = 0;
            tgt.win = null;
            return;
        }
        // Idle share over the window.
        if (!tgt.win || tgt.win.monster !== tgt.farm.monster) tgt.win = { monster: tgt.farm.monster, start: now, last: now, idle: 0 };
        const dt = Math.min(5000, now - tgt.win.last);
        tgt.win.last = now;
        if (!found) tgt.win.idle += dt;
        if (cfg.crowdedWindowMs && now - tgt.win.start >= cfg.crowdedWindowMs) {
            const share = tgt.win.idle / (now - tgt.win.start);
            if (share >= (cfg.crowdedIdleShare || 0.6)) { markCrowded(Math.round(share * 100) + "% of " + Math.round(cfg.crowdedWindowMs / 60000) + " min without a target"); return; }
            tgt.win = { monster: tgt.farm.monster, start: now, last: now, idle: 0 };
        }
        if (found) { tgt.idleSince = 0; return; }
        if (!tgt.idleSince) tgt.idleSince = now;
        if (now - tgt.idleSince >= cfg.crowdedAfterMs) markCrowded("no free target for " + Math.round(cfg.crowdedAfterMs / 1000) + " s");
    }

    Object.assign(tgt, {
        spotKey: spotKey,
        strangersNear: strangersNear,
        occupiedSpots: occupiedSpots,
        inOccupied: inOccupied,
        busyShare: busyShare,
        fightersNear: fightersNear,
        releaseFreedSpots: releaseFreedSpots,
        checkOccupied: checkOccupied,
        allSpotsTaken: allSpotsTaken,
        spotFor: spotFor,
        markCrowded: markCrowded,
        reportSearch: reportSearch,
        saveStrong: saveStrong,
        tooStrongHere: tooStrongHere,
    });
};
