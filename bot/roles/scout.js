// =====================================================================
// bot_scout - the merchant searches roaming bosses and walks clear of aggressive monsters
// (2026-11-23, player decision).
//
// Boss search: the runner (ranger) spent a lot of its time on boss searches - Phoenix, Dracul,
// Ms. Dracul, Skeletor, Green Jr. - time it did not do damage at the farm spot. Now the merchant
// walks the spawn areas of the bosses on config.events.scout.bosses between its chores; the three
// fighters stay at the spot and only leave when it reports a find. Jr. (Spooky Town: rage zones,
// Vampire Rats on the way) stays on the runner's list.
//   - The leader decides what is due (its search timers, pauses and boss checks) and writes the
//     plan into the shared storage (dmpx_scout_plan); the merchant only reads it.
//   - A boss in sight: reported like a member's sighting (bosssight, every 2 s), the walk stops,
//     the merchant keeps scout.keepAway px from it and watches it until a fighter is near it, it
//     is gone or scout.watchMs ran out - then it walks on.
//   - After the round: scoutdone per boss to the leader (not found: searched again on its timer).
//   - Fallback (events.js): the leader sends the runner / team search as before when the merchant
//     is not available (other server, Ponty round, trade trip, dead) or a boss is overdue by
//     scout.fallbackMs.
//
// Safe walking (scout.safeWalk): every path walk of the merchant plans around aggressive monsters
// in sight (aggro or rage, no target yet: safeWalk.pad px), rage zones (map "rage" boxes) and the
// travel.wallMonsters spawns (+ ragePad). The merchant has 1,400 HP - one Skeletor hit (1,800) or
// a Ms. Dracul hit (875 magical) kills it or nearly. Server rule: aggro picks players within the
// neighbouring 32-px cells only, so ~100 px is clear. No path with the walls: walls off for
// safeWalk.offMs and the walk is planned again.
// =====================================================================

module.exports = function createScout(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const ev = config.events || {};
    const sc = ev.scout || {};
    const wcfg = sc.safeWalk || {};
    const PLAN_KEY = "dmpx_scout_plan";
    const STATE_KEY = "dmpx_scout:" + character.name;

    // ---- safe walking ----------------------------------------------------------------------
    // Only monsters that kill us in safeWalk.hits hits (2026-11-23, player decision): every aggressive kind walled
    // the paths in the cave (bats, 50 damage) and the arena (CGoos) - "no path", and an 11-minute Dracul round. Now
    // a monster counts when its hit on us (our armor / resistance, x1.1 like the team check) times hits reaches our
    // max HP: with 1,400 HP Skeletor (1,800) and Ms. Dracul (875 magical), not the Phoenix, Dracul, bats, CGoos or
    // Fire Spirits. Rage zones stay walls (a whole pack comes there).
    function deadly(e) {
        try { return util.predictedHit(e, character) * 1.1 * (wcfg.hits || 2) >= character.max_hp; } catch (x) { return true; }
    }
    let wallsOffUntil = 0;
    (function installSafeWalls() {
        if (wcfg.enabled === false) return;
        const W = window;
        if (!W.__dmpxOrigCanMove) W.__dmpxOrigCanMove = W.can_move;
        const orig = W.__dmpxOrigCanMove;
        if (typeof orig !== "function") return;
        let cache = { at: 0, map: null, goal: "", boxes: [] };
        function blocked(mapName) {
            if (Date.now() < wallsOffUntil) return [];
            const goal = typeof smart !== "undefined" && smart && smart.map === mapName && typeof smart.x === "number" ? { x: smart.x, y: smart.y } : null;
            const gk = goal ? Math.round(goal.x) + "," + Math.round(goal.y) : "";
            if (cache.map === mapName && cache.goal === gk && Date.now() - cache.at < 1500) return cache.boxes;
            const pad = wcfg.pad || 100, rPad = wcfg.ragePad || 100;
            const walls = (config.travel && config.travel.wallMonsters) || [];
            const boxes = [];
            const add = function (b, p) {
                const box = [b[0] - p, b[1] - p, b[2] + p, b[3] + p];
                // The walk's own goal is never walled in (it is where we want to be).
                if (goal && goal.x >= box[0] && goal.x <= box[2] && goal.y >= box[1] && goal.y <= box[3]) return;
                boxes.push(box);
            };
            ((G.maps[mapName] || {}).monsters || []).forEach(function (p) {
                if (p.rage) add(p.rage, rPad);
                else if (walls.includes(p.type) && deadly({ mtype: p.type })) util.spawnBoxes(p, mapName).forEach(function (b) { if (b && b.length >= 4) add(b, rPad); });
            });
            if (mapName === character.map) {
                Object.values(parent.entities || {}).forEach(function (e) {
                    if (!e || e.type !== "monster" || e.dead || e.target) return; // one with a target never aggroes (server rule)
                    const d = G.monsters[e.mtype] || {};
                    if (!((d.aggro || 0) > 0 || (d.rage || 0) > 0) || !deadly(e)) return;
                    add([e.x, e.y, e.x, e.y], pad);
                });
            }
            cache = { at: Date.now(), map: mapName, goal: gk, boxes: boxes };
            return boxes;
        }
        // Liang-Barsky: does the segment touch the box?
        function segTouches(x0, y0, x1, y1, b) {
            let t0 = 0, t1 = 1;
            const dx = x1 - x0, dy = y1 - y0;
            const p = [-dx, dx, -dy, dy], q = [x0 - b[0], b[2] - x0, y0 - b[1], b[3] - y0];
            for (let i = 0; i < 4; i++) {
                if (p[i] === 0) { if (q[i] < 0) return false; continue; }
                const r = q[i] / p[i];
                if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
                else { if (r < t0) return false; if (r < t1) t1 = r; }
            }
            return true;
        }
        if (!W.__dmpxOrigSmartMove && typeof W.smart_move === "function") {
            W.__dmpxOrigSmartMove = W.smart_move;
            W.smart_move = function () {
                const self = this, args = arguments;
                return W.__dmpxOrigSmartMove.apply(self, args).catch(function (e) {
                    const why = util.errReason(e);
                    if (/path not found|failed/i.test(why) && Date.now() >= wallsOffUntil) {
                        wallsOffUntil = Date.now() + (wcfg.offMs || 60 * 1000);
                        util.log("scout", "no path around the monsters - walls off for " + Math.round((wcfg.offMs || 60 * 1000) / 1000) + " s", "orange");
                        return W.__dmpxOrigSmartMove.apply(self, args);
                    }
                    throw e;
                });
            };
        }
        W.can_move = function (m, based) {
            if (!orig.apply(this, arguments)) return false;
            if (based || !m || !m.map || typeof m.going_x !== "number") return true;
            try {
                const boxes = blocked(m.map);
                for (const b of boxes) {
                    if (m.x >= b[0] && m.x <= b[2] && m.y >= b[1] && m.y <= b[3]) continue; // starts inside: may walk out
                    if (segTouches(m.x, m.y, m.going_x, m.going_y, b)) return false;
                }
            } catch (e) { /* walls are a help, never a blocker */ }
            return true;
        };
    })();

    // ---- boss search ------------------------------------------------------------------------
    function hereName() { return parent.server_region + " " + parent.server_identifier; }
    function watched() {
        const out = (ev.search || []).slice();
        (ev.engage || []).forEach(function (n) { if (!out.includes(n)) out.push(n); });
        return out;
    }
    function spawnSpots(name) {
        const spots = [];
        Object.keys(G.maps).forEach(function (mapName) {
            const map = G.maps[mapName];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== name) return;
                (pack.boundaries || []).forEach(function (b) {
                    spots.push({ boss: name, map: b[0], x: Math.round((b[1] + b[3]) / 2), y: Math.round((b[2] + b[4]) / 2) });
                });
                if (pack.boundary) {
                    const b = pack.boundary;
                    spots.push({ boss: name, map: mapName, x: Math.round((b[0] + b[2]) / 2), y: Math.round((b[1] + b[3]) / 2) });
                }
            });
        });
        return spots;
    }
    function readPlan() {
        try {
            const p = get(PLAN_KEY);
            if (!p || !Array.isArray(p.due) || Date.now() - p.at > 60 * 1000 || p.server !== hereName()) return null;
            return p;
        } catch (e) { return null; }
    }
    let pausedUntil = 0, lastLap = 0;
    function saveState(st) { try { set(STATE_KEY, st); } catch (e) { /* storage unavailable */ } }

    // The nearest watched boss in sight that is not in `skip` (bosses already found on this round).
    function visibleBoss(skip) {
        let best = null;
        watched().forEach(function (n) {
            if (skip && skip[n]) return;
            const m = get_nearest_monster({ type: n });
            if (m && !m.dead && (!best || util.distanceTo(m) < util.distanceTo(best))) best = m;
        });
        return best;
    }
    function bossInfo(m) {
        let area = null, bestD = Infinity;
        spawnSpots(m.mtype).forEach(function (s) {
            if (s.map !== character.map) return;
            const d = Math.hypot(s.x - m.x, s.y - m.y);
            if (d < bestD) { bestD = d; area = s.map + " " + s.x + "," + s.y; }
        });
        const own = Object.keys(config.characters || {});
        const others = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "character" && !e.npc && !own.includes(e.name) && Math.hypot(e.x - m.x, e.y - m.y) < 400;
        }).map(function (e) { return e.name; });
        return { map: character.map, x: Math.round(m.x), y: Math.round(m.y), area: area || character.map,
            hp: Math.round(100 * m.hp / Math.max(1, m.max_hp)), by: m.target && !own.includes(m.target) ? m.target : null, others: others.slice(0, 6) };
    }
    let lastSent = 0;
    function report(m) {
        if (Date.now() - lastSent < 2000) return;
        lastSent = Date.now();
        // fx/fy: where we stand - walkable and kept clear of the boss: the team walks here.
        comms.send(config.leader, "bosssight", { name: m.mtype, id: m.id, map: character.map, x: Math.round(m.x), y: Math.round(m.y),
            fx: Math.round(character.real_x), fy: Math.round(character.real_y), info: bossInfo(m) });
    }
    function teamNear(m) {
        return ((config.team && config.team.fighters) || []).some(function (n) {
            const p = get_player(n);
            return p && !p.rip && Math.hypot(p.x - m.x, p.y - m.y) <= (sc.teamNear || 300);
        });
    }
    // A step that ends farther than keepAway from the boss (16 directions, the farthest reachable).
    function stepAway(m) {
        const keep = sc.keepAway || 250;
        const me = { x: character.real_x, y: character.real_y };
        let best = null, bestD = Math.hypot(me.x - m.x, me.y - m.y);
        // Straight away from it, only to keepAway + 30 px (a far step lost it from sight).
        const d0 = bestD || 1, want = keep + 30;
        const straight = { x: m.x + (me.x - m.x) / d0 * want, y: m.y + (me.y - m.y) / d0 * want };
        if (can_move_to(straight.x, straight.y)) { const pr = move(straight.x, straight.y); if (pr && pr.catch) pr.catch(function () {}); return; }
        for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8;
            for (const len of [keep, keep / 2]) {
                const q = { x: me.x + Math.cos(a) * len, y: me.y + Math.sin(a) * len };
                if (!can_move_to(q.x, q.y)) continue;
                const d = Math.hypot(q.x - m.x, q.y - m.y);
                if (d > bestD) { bestD = d; best = q; }
                break;
            }
        }
        if (best) { const pr = move(best.x, best.y); if (pr && pr.catch) pr.catch(function () {}); }
    }
    // Watch a found boss from a distance until a fighter is near it, it is gone or watchMs ran out.
    async function watchBoss(name) {
        const until = Date.now() + (sc.watchMs || 3 * 60 * 1000);
        // Out of sight for a moment is not gone (2026-11-23, first round: Skeletor "gone" 4 s after the find, the
        // merchant walked home and the leader's sighting ran out): gone after lostMs without a sight; meanwhile a
        // walk back toward its last spot, to keepAway px.
        let lastSeen = Date.now(), lastPos = null, backTo = null;
        while (Date.now() < until) {
            if (character.rip) return "dead";
            const m = get_nearest_monster({ type: name });
            if (m && m.dead) return "gone";
            if (!m) {
                if (Date.now() - lastSeen > (sc.lostMs || 8000)) return "gone";
                if (lastPos && !character.moving && !backTo) {
                    const me = { x: character.real_x, y: character.real_y };
                    const d = Math.hypot(me.x - lastPos.x, me.y - lastPos.y) || 1;
                    const keep = sc.keepAway || 250;
                    if (d > keep) {
                        backTo = { x: lastPos.x + (me.x - lastPos.x) / d * keep, y: lastPos.y + (me.y - lastPos.y) / d * keep };
                        const pr = move(backTo.x, backTo.y); if (pr && pr.catch) pr.catch(function () {});
                    }
                }
                await sleep(500);
                continue;
            }
            lastSeen = Date.now(); lastPos = { x: m.x, y: m.y }; backTo = null;
            report(m);
            if (teamNear(m)) return "team";
            if (util.distanceTo(m) < (sc.keepAway || 250) && !character.moving) stepAway(m);
            util.status("scouting: " + name + " found - waiting for the team", "green");
            await sleep(500);
        }
        return "time";
    }

    // Report and walk on (2026-11-23, player decision): the find is sent a few times over scout.reportMs, then the
    // round goes on - the leader holds a merchant's report up to scout.holdMs (events.js memberSighting), so the
    // team still walks there. Too close: one step away first. Bosses on scout.watch are watched instead (watchBoss).
    async function reportAndGo(m) {
        const until = Date.now() + (sc.reportMs || 3000);
        if (util.distanceTo(m) < (sc.keepAway || 250)) stepAway(m);
        while (Date.now() < until && !character.rip) {
            const x = get_nearest_monster({ type: m.mtype });
            if (x && !x.dead) { lastSent = 0; report(x); }
            await sleep(1000);
        }
    }

    // The next spot: nearest on our map, else the first map of scout.mapOrder that still has spots.
    function nextSpot(spots) {
        const mine = spots.filter(function (s) { return s.map === character.map; });
        if (mine.length) {
            return mine.sort(function (a, b) { return Math.hypot(a.x - character.real_x, a.y - character.real_y) - Math.hypot(b.x - character.real_x, b.y - character.real_y); })[0];
        }
        const order = sc.mapOrder || ["main", "arena", "cave", "halloween"];
        for (const map of order) {
            const s = spots.find(function (x) { return x.map === map; });
            if (s) return s;
        }
        return spots[0];
    }

    let abortFor = null; // a boss came into sight during a walk
    async function lap(due) {
        const started = Date.now();
        const seen = {};
        // Spots of different bosses within 150 px of each other count once (Phoenix and Dracul in the cave).
        let spots = [];
        due.forEach(function (n) {
            spawnSpots(n).forEach(function (sp) {
                const same = spots.find(function (o) { return o.map === sp.map && Math.hypot(o.x - sp.x, o.y - sp.y) < 150; });
                if (same) { if (!same.bosses.includes(n)) same.bosses.push(n); }
                else spots.push({ map: sp.map, x: sp.x, y: sp.y, bosses: [n] });
            });
        });
        util.log("scout", "boss search: " + due.join(", ") + " (" + spots.length + " area(s))", "yellow");
        // Areas left per boss: only a boss whose areas were all walked (or that was found) is reported (v1.220.4: a
        // round stopped after one area reported all three bosses "not found", and they were put off for 20 min).
        const left = {};
        due.forEach(function (n) { left[n] = spots.filter(function (s) { return s.bosses.includes(n); }).length; });
        saveState({ state: "out", bosses: due, at: started });
        abortFor = null;
        const sight = setInterval(function () {
            try {
                const m = visibleBoss(seen);
                if (!m) return;
                report(m);
                if (!abortFor && util.distanceTo(m) < 700) {
                    abortFor = m.mtype;
                    try { stop(); } catch (e) { /* not walking */ }
                }
            } catch (e) { /* next tick */ }
        }, 1000);
        try {
            while (spots.length && !character.rip) {
                const plan = readPlan();
                if (!plan) { util.log("scout", "no fresh plan from " + config.leader + " - search stopped", "orange"); break; }
                spots = spots.filter(function (s) { return s.bosses.some(function (b) { return plan.due.includes(b) && !seen[b]; }); });
                if (!spots.length) break;
                const spot = nextSpot(spots);
                spots = spots.filter(function (s) { return s !== spot; });
                util.status("scouting " + spot.bosses.join("/") + " (" + spot.map + ")", "yellow");
                let reached = false;
                const walkFrom = Date.now();
                try {
                    await util.viaFirst(spot);
                    await util.walk({ map: spot.map, x: spot.x, y: spot.y });
                    reached = true;
                    util.log("scout", spot.bosses.join("/") + " area " + spot.map + " " + spot.x + "," + spot.y + " reached in " + Math.round((Date.now() - walkFrom) / 1000) + " s", "white");
                } catch (e) {
                    if (!abortFor) { util.log("scout", "can't reach " + spot.map + " " + spot.x + "," + spot.y + " (" + util.errReason(e) + ")", "orange"); continue; }
                }
                if (!abortFor) await sleep(sc.spotMs || 3000);
                const m = visibleBoss(seen);
                if (!reached && !m) spots.push(spot); // stopped for a boss that is out of sight again: this spot later
                else spot.bosses.forEach(function (b) { left[b] = Math.max(0, (left[b] || 0) - 1); });
                if (m) {
                    seen[m.mtype] = true;
                    abortFor = m.mtype;
                    const info = bossInfo(m);
                    util.log("scout", m.mtype + " found at " + info.map + " " + info.x + "," + info.y + " (" + info.hp + " % HP" + (info.by ? ", fought by " + info.by : "") + ") - reported", "green");
                    if ((sc.watch || []).includes(m.mtype)) {
                        const r = await watchBoss(m.mtype);
                        util.log("scout", m.mtype + ": " + (r === "team" ? "the team is there" : r === "gone" ? "gone" : r === "dead" ? "I died watching it" : "no team after " + Math.round((sc.watchMs || 180000) / 60000) + " min") + " - walking on", r === "dead" ? "red" : "white");
                        if (r === "dead") break;
                    } else await reportAndGo(m);
                }
                abortFor = null;
            }
        } finally {
            clearInterval(sight);
            abortFor = null;
            // A death on the round pauses the searching (the runner takes over meanwhile).
            if (character.rip) {
                pausedUntil = Date.now() + (sc.pauseAfterDeathMs || 30 * 60 * 1000);
                util.log("scout", "died on the boss search - no search for " + Math.round((sc.pauseAfterDeathMs || 30 * 60 * 1000) / 60000) + " min", "red");
            }
            const done = due.filter(function (n) { return seen[n] || !left[n]; });
            done.forEach(function (n) { comms.send(config.leader, "scoutdone", { name: n, found: !!seen[n] }); });
            const secs = Math.round((Date.now() - started) / 1000);
            util.log("scout", "boss search done in " + secs + " s: " + due.map(function (n) { return n + (seen[n] ? " found" : !left[n] ? " not found" : " not finished (" + left[n] + " area(s) left)"); }).join(", "), "white");
            saveState({ state: "idle", at: Date.now(), pausedUntil: pausedUntil });
            lastLap = Date.now();
        }
    }

    // Called from the merchant's work loop when nothing more urgent is waiting. True: a round ran.
    async function work() {
        if (!sc.enabled || character.rip) return false;
        if (Date.now() < pausedUntil || Date.now() - lastLap < 20 * 1000) return false;
        const plan = readPlan();
        if (!plan || !plan.due.length) return false;
        await lap(plan.due.slice());
        return true;
    }

    // ---- Witch's Cipher stock (events.witchCipher, 2026-11-23) ---------------------------------------
    // Every 30 s: the four ingredients in the bank (last bank snapshot) and our bag into dmpx_cipher_stock. Once the
    // farming window of the next round opens (leadMs before its start), the scarcest one is chosen - ties at random -
    // and kept for that round; the leader farms it (events.cipherFarm).
    const wc = ev.witchCipher || {};
    const INGREDIENTS = ["verdantspore", "frostscale", "embercoal", "gloomfeather"];
    function cipherStock() {
        const counts = {};
        INGREDIENTS.forEach(function (n) { counts[n] = 0; });
        try {
            const bank = get("workshop_bank:" + character.name) || {};
            (bank.items || []).forEach(function (it) { if (it && counts[it.name] !== undefined) counts[it.name] += it.q || 1; });
        } catch (e) { /* no snapshot */ }
        (character.items || []).forEach(function (it) { if (it && counts[it.name] !== undefined) counts[it.name] += it.q || 1; });
        return counts;
    }
    function nextRoundAt() {
        const st = (typeof server !== "undefined" && server.status) || {};
        const gatherMs = ((G.events.witchcipher || {}).gathering || 1200) * 1000;
        const now = Date.now();
        const evs = ((st.schedule || {}).events || []).filter(function (e) { return e && e.event === "witchcipher" && typeof e.at === "number" && e.at + gatherMs > now; });
        evs.sort(function (a, b) { return a.at - b.at; });
        return evs.length ? evs[0].at : null;
    }
    let cipherChoice = null; // { at, ingredient }
    try { const old = get("dmpx_cipher_stock"); if (old && old.choice) cipherChoice = old.choice; } catch (e) { /* none */ }
    setInterval(function () {
        if (!wc.farm) return;
        try {
            const counts = cipherStock();
            const at = nextRoundAt();
            if (at && Date.now() >= at - (wc.leadMs || 10 * 60 * 1000) && (!cipherChoice || cipherChoice.at !== at)) {
                const min = Math.min.apply(null, INGREDIENTS.map(function (n) { return counts[n]; }));
                const low = INGREDIENTS.filter(function (n) { return counts[n] === min; });
                cipherChoice = { at: at, ingredient: low[Math.floor(Math.random() * low.length)] };
                util.log("scout", "Witch's Cipher at " + new Date(at).toISOString().slice(11, 16) + "Z: farm " + cipherChoice.ingredient + " (stock " +
                    INGREDIENTS.map(function (n) { return n + " " + counts[n]; }).join(", ") + ")", "yellow");
            }
            set("dmpx_cipher_stock", { at: Date.now(), counts: counts, choice: cipherChoice });
        } catch (e) { /* next round */ }
    }, 30 * 1000);

    return { work: work };
};
