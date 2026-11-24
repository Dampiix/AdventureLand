// =====================================================================
// classes/warrior/agitate-stream.js - the Agitate stream: gap step, step away, end of a pull, how many may be on us, the stream Agitate and the stream fight.
// Part of the warrior (module plan, stage 2): moved verbatim from the old single-file warrior.js. The warrior's parts
// share one internal state (w: the pack, the auto decision, the last Agitate, the speed reference) and call each
// other through w; outside dependencies come in deps (game, util, config, party, targeting, gear, strike, events).
// =====================================================================

module.exports = function install(w, deps) {
    const game = deps.game;
    const util = deps.util;
    const quiet = util.quiet;
    const c = deps.config.classes.warrior;
    const ag = c.agitate || {};
    const mpLeftAfter = util.mpLeftAfter;

    // ---- gap step (player idea 2026-11-22) ---------------------------------------------------
    // The splash hits what stands around the TARGET (server: within explosion / 3.6 px, hitbox to hitbox),
    // there is no facing. With 3 scorpions on one side and 1 behind us, the one behind never takes splash.
    // A step into the emptiest direction - the middle of the largest angle gap between the monsters on us -
    // puts them all on the side we came from: they follow and bunch up there. Splash weapons on, at least
    // gapStep.minOnMe on us, and the best target's splash misses one of those in our range; at most every
    // everyMs, earlier (from minMs) only when all of them are in range again. Not into free monsters, a
    // failing rage zone, or (member) off the leash.
    const gs = ag.gapStep || {};
    let lastGap = 0, gapSteps = 0, gapLogAt = Date.now();
    function gapStep(mine, covered) {
        if (gs.enabled === false || game.isMoving(game.me())) return false;
        const inRange = mine.filter(function (m) { return game.inRange(m); });
        if (mine.length < (gs.minOnMe || 3) || covered >= inRange.length) return false;
        const now = Date.now();
        const since = now - lastGap;
        if (since < (gs.minMs || 2500) || (since < (gs.everyMs || 4000) && inRange.length < mine.length)) return false;
        const me = util.xy(game.me());
        const angles = mine.map(function (m) { const p = util.xy(m); return Math.atan2(p.y - me.y, p.x - me.x); }).sort(function (a, b) { return a - b; });
        const gaps = angles.map(function (a, i) {
            const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
            return { size: next - a, mid: a + (next - a) / 2 };
        }).sort(function (a, b) { return b.size - a.size; });
        const step = gs.step || 50;
        const free = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        }).map(util.xy);
        const lead = deps.party.enabled && deps.party.isMember && !deps.party.detached() ? deps.party.leaderInfo() : null;
        const leash = (deps.config.party && deps.config.party.leash) || 300;
        for (const g of gaps) {
            const x = me.x + Math.cos(g.mid) * step, y = me.y + Math.sin(g.mid) * step;
            if (!game.canMoveTo(x, y)) continue;
            if (free.some(function (q) { return Math.hypot(q.x - x, q.y - y) < 80; })) continue; // would pull a free one
            if (deps.targeting.failingZoneAt && deps.targeting.failingZoneAt({ x: x, y: y })) continue;
            if (lead && lead.map === game.me().map && Math.hypot(lead.x - x, lead.y - y) > leash) continue;
            lastGap = now;
            gapSteps++;
            quiet(game.walkStraight(x, y));
            if (now - gapLogAt > 10 * 60 * 1000) {
                util.log("warrior", "gap steps: " + gapSteps + " in " + Math.round((now - gapLogAt) / 60000) + " min (splash per hit " + splashAvg() + ")", "white");
                gapLogAt = now; gapSteps = 0;
            }
            util.status("gap step: " + mine.length + " on us, splash took " + covered, "orange");
            return true;
        }
        return false;
    }
    function splashAvg() {
        const st = w.auto.type ? w.statOf(w.auto.type) : null;
        return st && st.hits ? (st.nsum / st.hits).toFixed(2) : "?";
    }

    // A step away from the pack's middle: it follows from one side and bunches up.
    function stepAway(list, stepPx) {
        const me = util.xy(game.me());
        const mid = w.centerOf(list);
        const cx = mid.x, cy = mid.y;
        let dx = me.x - cx, dy = me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const step = stepPx || ag.kiteStep || 120;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
            const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
            const x = me.x + ux * step, y = me.y + uy * step;
            if (game.canMoveTo(x, y)) {
                quiet(game.walkStraight(x, y));
                w.pack.lastRegroup = w.pack.gatherAt = Date.now();
                return true;
            }
        }
        return false;
    }

    function finishPull(reason) {
        const secs = Math.round((Date.now() - w.pack.since) / 1000);
        const dead = w.pack.pulled.filter(function (id) { const e = game.entities()[id]; return !e || e.dead; }).length;
        const avg = w.pack.attacks ? (w.pack.neighborSum / w.pack.attacks).toFixed(2) : "0";
        const hpUsed = Math.round((w.pack.startHp - game.me().hp) / game.me().max_hp * 100);
        util.log("warrior", "pull done [" + w.agMode() + "] (" + reason + "): " + w.pack.pulled.length + " pulled, " + dead + " dead, " + secs + " s, " +
            w.pack.attacks + " hits, " + avg + " splash neighbours per hit, HP used " + hpUsed + "%", "green");
        w.pack.state = "idle";
        // Keep the splash weapons a little while for the next pull, then the usual ones go back on.
        if (w.splashMode()) deps.gear.holdWeapons(ag.keepMs || 60 * 1000);
    }

    // Returns true while the pack mode runs this tick (the normal combat waits).
    // "swords": no pull point, no waiting - normal combat where we stand, and Agitate on every
    // cooldown that finds free monsters, so a steady stream walks to us (player idea
    // 2026-11-18: the pull-point version lost 15% to single targets at the arctic bees, its
    // waiting cost more than the walking it saved). Only while few are on us already.
    let lastStreamLog = 0;
    // How many may be on us before the next Agitate (player decision 2026-11-18): with splash
    // more pay off (splashOnMe), during Sugar Rush (3x attack speed) sugarBonus more; low HP
    // fewer (below lowHp: 2, below minHp of the pull mode none) - also saves potions.
    function streamLimit(splash) {
        // Auto swords use the splash count too (player decision 2026-11-18): the splash per hit is
        // measured with the swords as well, and with only 3 on us at most 2 neighbours were possible
        // - the learned value stayed too low to ever switch (snakes: 0.46). The pack check (autoCap)
        // still caps it.
        let n = (splash || w.autoDecides()) ? (ag.splashOnMe || 5) : (ag.streamOnMe || 3);
        const cap = w.autoCap(); // auto: what the pack check and experience allow (party too, 2026-11-18)
        if (splash && game.me().s && game.me().s.sugarrush) n += (ag.sugarBonus || 2);
        // A party uses the same limits as solo (player decision 2026-11-18, no partyOnMe boost).
        const hp = util.hpRatio();
        if (hp < (ag.streamStopHp || 0.4)) return 0;
        if (hp < (ag.streamLowHp || 0.6)) n = Math.min(n, 2);
        if (cap !== null) n = Math.min(n, cap);
        return n;
    }
    function streamAgitate(splash) {
        if (!util.canCast("agitate") || game.me().mp < game.data().skills.agitate.mp + w.reserve()) return;
        // Not on the way: a route walk (smart_move) pulled bats before we reached the spot (2026-11-18).
        if ((game.path() && game.path().moving)) return;
        const coming = w.onMe().length;
        if (coming >= streamLimit(splash)) return; // Agitate only while fewer than the limit attack us
        const fresh = w.packAround(game.data().skills.agitate.range).filter(function (m) { return m.target !== game.me().name; });
        if (fresh.length < (ag.streamFrom || 1)) return;
        if (!w.farmTargetIn(fresh)) return;
        // Agitate taunts everything in reach, not just up to our limit: the safe count must cover
        // all of them (2026-11-18: "up to 2" booboos, but 5 stood in reach - the warrior died).
        const cap = w.autoCap();
        if (cap !== null && coming + fresh.length > cap) return;
        // Auto: every single cast checks the levels too - the decision is held during fights, and
        // two grown bats came along with a stream pull (2026-11-18).
        if (ag.monsters === "auto" && typeof ag.maxLevel === "number" && fresh.some(function (m) { return (m.level || 1) > ag.maxLevel; })) return;
        // Other kinds in reach (any target but us, 2026-11-23): step clear of them first - see agitateClear.
        const clear = w.agitateClear(w.onOthers().filter(function (m) { return w.ourKind(m); }), fresh);
        if (clear !== "go") return clear;
        if (w.unwantedAround(game.data().skills.agitate.range).length) return;
        game.useSkill("agitate").catch(function () {});
        w.lastAgitate = { at: Date.now(), type: fresh[0].mtype };
        if (Date.now() - lastStreamLog > 5 * 60 * 1000) {
            lastStreamLog = Date.now();
            util.log("warrior", "agitate stream: " + fresh.length + " more on the way (" + coming + " on us)", "white");
        }
    }

    // "stream" fighting (player rules 2026-11-18): hit what is in range (ones on us first,
    // nearest first); with nobody in range, walk to the nearest monster - on its way to us
    // or free - instead of waiting. False when nothing is around (normal search takes over).
    let streamWalkTo = null;
    function streamFight(splash) {
        const inParty = deps.party.enabled;
        const around = Object.values(game.entities()).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible) return false;
            if (e.target === game.me().name) return true;
            // Free ones only of the farm target: other kinds come along through Agitate and are
            // fought once they are on us (2026-11-18: following the priest through the goo field
            // the warrior kept hitting goos and fell behind).
            if (ag.monsters === "auto" && w.auto.type && e.mtype !== w.auto.type) return false;
            return w.packWanted(e) && !e.target && !(deps.targeting.inOccupied && deps.targeting.inOccupied(e)) &&
                !util.tooSpiky(deps.config, e) && util.distanceTo(e) <= 600 && !w.inBadZone(e) &&
                !(deps.party.nearLeader && !deps.party.nearLeader(e)); // member: free ones only near the leader (2026-11-22)
        }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
        if (!around.length) return false;
        const inRange = around.filter(function (m) { return game.inRange(m); });
        // In a party we never walk off on our own: the normal combat (follow, assist) takes over.
        if (inRange.length) {
            let t = inRange.find(function (m) { return m.target === game.me().name; }) || inRange[0];
            if (splash) {
                // Splash stream: the one in range with the most others in the splash radius.
                const mine = w.onMe();
                let bestN = -1;
                inRange.forEach(function (m) { const n = w.splashNeighbours(m, mine); if (n > bestN) { bestN = n; t = m; } });
                // Some on us out of that splash (e.g. one behind us): a step into the emptiest direction first.
                if (gapStep(mine, bestN + 1)) return true;
            }
            if (game.targetedMonster() !== t) game.changeTarget(t);
            // Fired by the strike loop the moment the cooldown ends (2026-11-20).
            deps.strike.attack(t, function (m) { w.noteHit(m.mtype, w.splashNeighbours(m, w.onMe())); }); // learning: (would-have) splash per hit
            streamWalkTo = null;
            util.status("agitate stream: " + t.mtype + " (" + w.onMe().length + " on us)", "green");
            return true;
        }
        // Splash: not simply the nearest one, the one with the most others around it (a clump
        // is worth a few steps more - player idea 2026-11-18): neighbours within clumpRadius
        // count clumpStep px of way each.
        let goal = around[0];
        if (splash && ag.streamToClump !== false) {
            let bestScore = -Infinity;
            around.forEach(function (m) {
                const q = util.xy(m);
                const n = around.filter(function (o) { return o !== m && Math.hypot(util.xy(o).x - q.x, util.xy(o).y - q.y) <= (ag.clumpRadius || 60); }).length;
                const score = n * (ag.clumpStep || 80) - util.distanceTo(m);
                if (score > bestScore) { bestScore = score; goal = m; }
            });
        }
        // Only goals we can walk to in a straight line: path finding to unreachable ones in the
        // cave ("Lost the path..." x12) left us standing while the bats hit us (2026-11-18).
        if (!game.canMoveTo(util.xy(goal).x, util.xy(goal).y)) {
            goal = around.find(function (m) { const q = util.xy(m); return game.canMoveTo(q.x, q.y); });
            if (!goal) return false; // nothing reachable: the normal combat decides
        }
        const p = util.xy(goal);
        // In a party like solo (player request 2026-11-18), but only where it is safe: every free
        // monster within Agitate reach of the goal plus the ones on us must fit the safe count,
        // and the goal stays on the leash - the warrior walked into the middle of 5 booboos.
        if (inParty && deps.party.isMember && !deps.party.detached()) {
            const cap = w.autoCap();
            const free = Object.values(game.entities()).filter(function (e) {
                return e && e.type === "monster" && !e.dead && !e.target && Math.hypot(util.xy(e).x - p.x, util.xy(e).y - p.y) <= game.data().skills.agitate.range;
            }).length;
            const lead = deps.party.leaderInfo();
            const leash = (deps.config.party && deps.config.party.leash) || 300;
            if (cap === null || free + w.onMe().length > cap) return false;
            if (lead && (lead.map !== game.me().map || Math.hypot(lead.x - p.x, lead.y - p.y) > leash)) return false;
        }
        if (!game.isMoving(game.me()) || !streamWalkTo || Math.hypot(streamWalkTo.x - p.x, streamWalkTo.y - p.y) > 25) {
            streamWalkTo = p;
            quiet(game.walkStraight(p.x, p.y));
        }
        util.status("agitate stream: to " + (goal === around[0] ? "the nearest " : "a clump of ") + goal.mtype, "orange");
        return true;
    }

    Object.assign(w, {
        gapStep: gapStep,
        splashAvg: splashAvg,
        stepAway: stepAway,
        finishPull: finishPull,
        streamLimit: streamLimit,
        streamAgitate: streamAgitate,
        streamFight: streamFight,
    });
};
