// =====================================================================
// travel/rage-walls.js - rage zones and path walks (module plan, stage 3b; moved out of core/fighter.js unchanged):
//   - rage boxes (+ travel.rageMargin) are walls for the path search: this frame's can_move refuses a step into or
//     through one; a failed search narrows the margin (travel.rageWallSteps) and plans again
//   - the smart_move wrapper: leaving a map by a safe one first (travel.leaveVia), the retries above
//   - leaveRageZone / keepClearOfZones: out of a zone the team can't take, then out to the margin
//   - holdRingStep: wait outside an aggressive boss's spawn until the team is there
// deps: { game, util, config, party, targeting, moveTo, stopOnPurpose } - party and targeting may be getters;
// moveTo(p) is the fighter's walk, stopOnPurpose() marks a walk we stop ourselves (travel.js).
// The client hooks are installed when the module is created (game.hook: once per page, never wrapped twice).
// =====================================================================

module.exports = function createRageWalls(deps) {
    const game = deps.game, util = deps.util, config = deps.config;
    function walk() { return game.path(); }                       // the running path walk (smart)
    function pathing() { const s = walk(); return !!(s && s.moving); }

    // ---- rage zones as walls for the path search ---------------------------------------------------------------
    // A path walk plans its route without knowing rage zones; detours after the fact went round in circles. So the CODE
    // frame's own can_move - the one smart_move's path search asks for every step, and can_move_to too - refuses a
    // step that ends in, or passes through, a rage box grown by travel.rageMargin. Every rage box is a wall except the
    // walk's goal zone and our farm target's zones the team can take. A step that STARTS inside the grown box is always
    // allowed: whoever stands there can walk out. Only this frame's copy is wrapped (the game's data stays as it is).
    // Walls with a fallback: between two zones the walls can leave no way at all ("Path not found!"), so a failed
    // search narrows the margin (rageWallSteps, e.g. 100 -> 50 -> 0 = box only -> walls off) and the walk is planned
    // anew. A finished walk, or 2 minutes, bring the full margin back.
    let rageWallLevel = 0, rageWallAt = 0;
    function rageWallSteps() {
        const tc = config.travel || {};
        return tc.rageWallSteps || [tc.rageMargin || 100, 50, 0, -1];
    }
    function rageWallPad() {
        if (rageWallLevel && Date.now() - rageWallAt > 120 * 1000) rageWallLevel = 0;
        const steps = rageWallSteps();
        return steps[Math.min(rageWallLevel, steps.length - 1)];
    }
    function rageWallLoosen() {
        const tc = config.travel || {};
        if (tc.rageWalls === false) return false;
        const steps = rageWallSteps();
        if (rageWallLevel >= steps.length - 1) return false;
        rageWallLevel++;
        rageWallAt = Date.now();
        const pad = steps[rageWallLevel];
        util.log("move", "no path with the rage walls - " + (pad < 0 ? "walls off" : "margin " + pad + " px") + " for this walk", "orange");
        return true;
    }
    function rageWallReset() { rageWallLevel = 0; }

    let cache = { at: 0, map: null, boxes: [] };
    function blocked(mapName) {
        const targeting = deps.targeting;
        const tc = config.travel || {};
        if (tc.rageWalls === false || !targeting.rageBoxes) return [];
        const now = Date.now();
        const pad = rageWallPad();
        if (pad < 0) return [];
        // The walk's own goal (smart.x/y): its zone is no wall - that is where we want to go, the spot check decides there.
        const smart = walk();
        const goal = smart && smart.map === mapName && typeof smart.x === "number" ? { x: smart.x, y: smart.y } : null;
        const gk = goal ? Math.round(goal.x) + "," + Math.round(goal.y) : "";
        // Our farm target's zones the team can take stay open too (else every step into the farm zone was a wall).
        const fn = targeting.farmNow ? targeting.farmNow() : null;
        const farmType = fn && fn.monster && mapName === game.me().map ? fn.monster : null;
        if (cache.map === mapName && cache.pad === pad && cache.goal === gk && cache.farm === farmType && now - cache.at < 2000) return cache.boxes;
        const boxes = [];
        targeting.rageBoxes(mapName).forEach(function (z) {
            if (farmType && z.type === farmType && targeting.failingZoneAt && !targeting.failingZoneAt({ x: (z.b[0] + z.b[2]) / 2, y: (z.b[1] + z.b[3]) / 2 })) return;
            // Every rage zone on the way is a wall, not only the ones the team can't take (with the warrior next to
            // him a zone counted as takeable, and the priest walked right through it).
            if (goal && goal.x >= z.b[0] && goal.x <= z.b[2] && goal.y >= z.b[1] && goal.y <= z.b[3]) return;
            boxes.push([z.b[0] - pad, z.b[1] - pad, z.b[2] + pad, z.b[3] + pad]);
        });
        cache = { at: now, map: mapName, pad: pad, goal: gk, farm: farmType, boxes: boxes };
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
    // Leaving a map by a safe one (travel.leaveVia): from Spooky Town the path search went past the Vampire Rats
    // (spookytown -> level2 -> level1 -> main). Every path walk (travel, following, the merchant pickup, bank and
    // potion walks) that leaves such a map for another one first goes to the safe map. A goal whose map can't be told
    // (an unknown name) walks as asked.
    function destMap(d) {
        const G = game.data();
        if (!d) return null;
        if (typeof d === "object") {
            if (d.map) return d.map;
            d = d.to;
            if (!d) return null;
        }
        if (typeof d !== "string") return null;
        if (G.maps[d]) return d;
        if (/^(bank|potions|upgrade|compound|exchange|scrolls|town)$/.test(d)) return "main";
        const names = Object.keys(G.maps).filter(function (m) { return !G.maps[m].ignore && !G.maps[m].instance; });
        const byMonster = names.find(function (m) { return (G.maps[m].monsters || []).some(function (p) { return p.type === d; }); });
        if (byMonster) return byMonster;
        return names.find(function (m) { return (G.maps[m].npcs || []).some(function (n) { return n.id === d; }); }) || null;
    }
    function leaveLeg(d) {
        const here = game.me().map, G = game.data();
        const lv = ((config.travel || {}).leaveVia || {})[here];
        if (!lv) return null;
        const to = destMap(d);
        if (!to || to === here || to === lv) return null;
        // A direct neighbour (a door from here, e.g. spookytown -> level2) is walked to directly.
        if (((G.maps[here] || {}).doors || []).some(function (dr) { return dr[4] === to; })) return null;
        return { map: lv };
    }

    // The hooks: can_move first (no client can_move - no walls and no smart_move wrapper either).
    const installed = game.hook("can_move", function (orig) {
        return function (m, based) {
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
    });
    // Every path walk (travel, following the leader, revives...) retries with a narrower margin when the search finds no
    // way. Wrapped once per page (the first wrapper stays).
    if (installed) game.hook("smart_move", function (orig) {
        return function () {
            const self = this, args = arguments;
            function run(a) {
                return orig.apply(self, a).catch(function (e) {
                    const why = util.errReason(e);
                    if (/path not found|failed/i.test(why) && rageWallLoosen()) return run(a);
                    // Not even without walls: the goal itself is unreachable - the walls weren't the reason, so the
                    // full margin is back at once instead of walls off for 2 minutes.
                    rageWallReset();
                    throw e;
                });
            }
            let leg = null;
            try { leg = leaveLeg(args[0]); } catch (e) { /* walk as asked */ }
            const first = leg ? run([leg]) : Promise.resolve();
            return first.then(function () { return run(args); }).then(function (r) { rageWallReset(); return r; });
        };
    }, true);

    // ---- standing next to / in a rage zone ---------------------------------------------------------------------
    // Standing still within travel.rageMargin of a rage zone the team can't take (outside it): a step out to the margin
    // first (after "Path not found!" the warrior stood 13 px off a booboo zone and was taken). Not while a path walk
    // runs (the rage walls plan those).
    let clearLogged = 0;
    function keepClearOfZones() {
        const targeting = deps.targeting;
        if (!targeting.failingZoneNear) return false;
        if (pathing()) return false;
        const margin = ((config.travel || {}).rageMargin) || 100;
        const me = util.xy(game.me());
        const z = targeting.failingZoneNear(me, margin);
        if (!z || z.gap <= 0) return false; // inside: leaveRageZone
        const b = z.b;
        const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
        let dx = me.x - nx, dy = me.y - ny;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const want = margin + 40;
        let p = { x: nx + dx * want, y: ny + dy * want };
        if (!game.canMoveTo(p.x, p.y)) {
            // Any of 16 directions, 140 px, that ends farthest from the box.
            let best = null, bestGap = -1;
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8, q = { x: me.x + Math.cos(a) * 140, y: me.y + Math.sin(a) * 140 };
                if (!game.canMoveTo(q.x, q.y)) continue;
                const g = Math.hypot(Math.max(b[0] - q.x, 0, q.x - b[2]), Math.max(b[1] - q.y, 0, q.y - b[3]));
                if (g > bestGap) { bestGap = g; best = q; }
            }
            if (!best || bestGap <= z.gap) return false;
            p = best;
        }
        if (Date.now() - clearLogged > 30 * 1000) {
            clearLogged = Date.now();
            util.log("move", "standing " + Math.round(z.gap) + " px from the " + z.type + " rage zone - moving off to " + margin + " px", "orange");
        }
        deps.moveTo(p);
        util.status("away from the " + z.type + " zone", "orange");
        return true;
    }

    // The hold ring around an aggressive boss's spawn (targeting.bossHoldRing): wait outside it until the team is here.
    let lastRing = null; // { map, type, ring, at }
    function boxGap(p, b) {
        return Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[2]), Math.max(b[1] - p.y, 0, p.y - b[3]));
    }
    function holdRingStep(boss, type) {
        const targeting = deps.targeting, character = game.me();
        if (!targeting.bossHoldRing || !targeting.holdingBoss) return false;
        const now = Date.now();
        if (boss && !boss.dead) {
            if (!targeting.holdingBoss(boss)) { lastRing = null; return false; } // the team is here, or not held
            const ring = targeting.bossHoldRing(boss);
            lastRing = ring ? { map: character.map, type: type, ring: ring, at: now } : null;
        }
        const r = lastRing && lastRing.map === character.map && lastRing.type === type && now - lastRing.at < 60 * 1000 ? lastRing.ring : null;
        if (!r) return false;
        const me = util.xy(character), b = r.box;
        const gap = boxGap(me, b);
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        // The nearest box point, and the way out from it (from the middle when we stand inside).
        const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
        let dx = gap > 0 ? me.x - nx : me.x - cx, dy = gap > 0 ? me.y - ny : me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        if (gap < r.margin || (gap > r.margin + 150 && boss && !boss.dead)) {
            const want = r.margin + 30;
            let p = { x: nx + dx * want, y: ny + dy * want };
            if (!game.canMoveTo(p.x, p.y)) {
                // Around the box: the side nearest to us that we can reach in a straight line.
                const sides = [{ x: b[0] - want, y: me.y }, { x: b[2] + want, y: me.y }, { x: me.x, y: b[1] - want }, { x: me.x, y: b[3] + want }]
                    .sort(function (a, c) { return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(c.x - me.x, c.y - me.y); });
                p = sides.find(function (s) { return game.canMoveTo(s.x, s.y); }) || p;
            }
            deps.moveTo(p);
            util.status("waiting outside the " + type + " spawn", "yellow");
            return true;
        }
        if (game.isMoving(character) && !pathing()) game.stopAction();
        util.status("waiting outside the " + type + " spawn", "yellow");
        return true;
    }

    // Rage zones (targeting.zoneAt): standing in one whose whole spawn we can't take, we step out - waiting, resting, a
    // handover or a stopped walk there pulled the whole pack. Not while a path walk only passes through (the game's
    // route; waypoints keep us off the worst maps) - a walk that ends in the zone is stopped, and a member's walk into
    // a failing zone is stopped on its map. Members too (no exception for the leader's farm spawn).
    let rageLogged = 0;
    function leaveRageZone() {
        const targeting = deps.targeting, party = deps.party, character = game.me();
        if (!targeting.rageZoneHere) return false;
        // Members: no path walk INTO a failing rage zone at all - stopped as soon as we are on its map (the leader walks
        // on to the edge, where its spot check stops it).
        const smart = walk();
        if (party.enabled && party.isMember && pathing() && smart.map === character.map &&
            targeting.failingZoneAt && targeting.failingZoneAt({ x: smart.x, y: smart.y })) {
            deps.stopOnPurpose();
            try { game.stopAction("smart"); } catch (e) { /* not walking */ }
            if (Date.now() - rageLogged > 30 * 1000) { rageLogged = Date.now(); util.log("combat", "not walking into a rage zone the team can't take - waiting for " + config.leader, "orange"); }
            return false; // the follow logic decides the next step
        }
        const z = targeting.rageZoneHere();
        if (!z) return false;
        // A path walk passing through may go on - one that ENDS in the zone is stopped (the warrior's walk to the
        // leader's route end, the middle of the spawn, ran on into it).
        if (pathing()) {
            const endsHere = smart.map === character.map && typeof smart.x === "number" &&
                smart.x >= z.b[0] && smart.x <= z.b[2] && smart.y >= z.b[1] && smart.y <= z.b[3];
            if (!endsHere) return false;
            deps.stopOnPurpose();
            try { game.stopAction("smart"); } catch (e) { /* not walking */ }
        }
        // rageZoneHere only names zones the team model (members have the team's stats) or our own check fails.
        const me = util.xy(character), b = z.b;
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        // The nearest way out: each side of the box, 80 px beyond it, nearest first.
        const outs = [
            { x: b[0] - 80, y: me.y }, { x: b[2] + 80, y: me.y },
            { x: me.x, y: b[1] - 80 }, { x: me.x, y: b[3] + 80 },
        ].sort(function (p, q) { return Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y); });
        let p = outs.find(function (o) { return game.canMoveTo(o.x, o.y); });
        if (!p) { // away from the middle, whatever is free
            const dx = me.x - cx, dy = me.y - cy, len = Math.hypot(dx, dy) || 1;
            p = { x: me.x + dx / len * 200, y: me.y + dy / len * 200 };
        }
        if (Date.now() - rageLogged > 30 * 1000) {
            rageLogged = Date.now();
            util.log("combat", "standing in the " + z.type + " rage zone (" + z.why + ") - stepping out", "orange");
        }
        deps.moveTo(p);
        util.status("leaving the " + z.type + " rage zone", "orange");
        return true;
    }

    return {
        leaveRageZone: leaveRageZone,
        keepClearOfZones: keepClearOfZones,
        holdRingStep: holdRingStep,
        // for tests: the walls the path search sees on a map, and the leaveVia leg of a goal
        wallsOn: blocked,
        leaveLeg: leaveLeg,
    };
};
