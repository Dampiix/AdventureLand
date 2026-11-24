// =====================================================================
// combat/kiting.js - kiting monsters we can outrun (anchors: the boss middle, the farm spawn), escape points, party spacing.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const quiet = util.quiet;
    const party = deps.party;

    // The point on the circle of radius dist around entity, from our own angle, turning alternately
    // left and right (40 steps over the half circle each way); ok filters points. direct: we can
    // walk there in a straight line. null: nothing fits.
    // nearest: instead of the first fitting point (smallest turn), the fitting point with the lowest
    // nearest(x, y) - used to stay close to a boss's spawn area (anchor).
    function orbitPoint(entity, dist, ok, nearest) {
        const me = util.xy(character), e = util.xy(entity);
        const base = Math.atan2(me.y - e.y, me.x - e.x);
        let best = null, bestScore = Infinity;
        for (let i = 1; i < 40; i++) {
            const a = base + (i % 2 ? 1 : -1) * (Math.PI * ((i - (i % 2)) / 40));
            const x = e.x + dist * Math.cos(a), y = e.y + dist * Math.sin(a);
            const lx = e.x + dist * 1.25 * Math.cos(a), ly = e.y + dist * 1.25 * Math.sin(a);
            if (!ftr.canMoveFrom(x, y, lx, ly)) continue; // not standable, or a wall right behind it
            if (ok && !ok(x, y)) continue;
            // Only points we reach in a straight line (2026-11-21: the ranger between a cactus and a
            // wall got "Path not found!" again and again - a circle point inside the cactus went to
            // smart_move). Behind an obstacle we take the next angle instead.
            if (!ftr.canMoveFrom(me.x, me.y, x, y)) continue;
            if (!nearest) return { x: x, y: y };
            const sc = nearest(x, y);
            if (sc < bestScore) { bestScore = sc; best = { x: x, y: y }; }
        }
        return best;
    }
    // Boss anchor (player decision 2026-11-21): kiting a boss stays within kite.anchorRadius of the
    // middle of its spawn area on our map - the ranger kited the Phoenix through the whole cave and
    // could have dragged it to another player (who joins in and cuts our share). Null for others.
    function bossAnchor(m) {
        const ev = config.events || {};
        const def = G.monsters[m.mtype] || {};
        if (!(ev.search || []).concat(ev.engage || []).includes(m.mtype) && !def.cooperative) return null;
        const map = G.maps[character.map];
        let best = null, bestD = Infinity;
        ((map && map.monsters) || []).forEach(function (pack) {
            if (pack.type !== m.mtype) return;
            const boxes = util.spawnBoxes(pack, character.map);
            boxes.forEach(function (b) {
                const c = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
                const d = Math.hypot(c.x - m.x, c.y - m.y);
                if (d < bestD) { bestD = d; best = c; }
            });
        });
        return best;
    }
    // Farm anchor (v1.225.1, player report 2026-11-23): kiting a normal monster may leave its spawn area, but not far - the
    // new mage kited the Porcupines far away from their spot. Allowed: within kite.farmAnchorMargin px (250) of the nearest
    // spawn box of its kind on our map, so there is room to kite around it. kite.farmAnchor false switches it off.
    function farmAnchor(m) {
        const k = config.combat.kite || {};
        if (k.farmAnchor === false) return null;
        const map = G.maps[character.map];
        let best = null, bestD = Infinity;
        ((map && map.monsters) || []).forEach(function (pack) {
            if (pack.type !== m.mtype) return;
            util.spawnBoxes(pack, character.map).forEach(function (b) {
                const d = boxDist(b, m.x, m.y);
                if (d < bestD) { bestD = d; best = { box: b, margin: k.farmAnchorMargin || 250 }; }
            });
        });
        return best;
    }
    function boxDist(b, x, y) {
        return Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    }
    // Distance of a point from an anchor's allowed area (0 inside): boss anchors are a circle around a middle, farm
    // anchors a spawn box with a margin.
    function anchorOut(a, x, y, R) {
        return a.box ? Math.max(0, boxDist(a.box, x, y) - a.margin) : Math.max(0, Math.hypot(x - a.x, y - a.y) - R);
    }
    function kiteStep(target) {
        const k = config.combat.kite;
        if (!k || !k.enabled) return false;
        const attackers = util.attackersOnMe();
        if (!attackers.length) return false;
        const myRange = character.range || 0, mySpeed = character.speed || 0;
        let threat = null, threatDist = Infinity;
        for (const m of attackers) {
            const def = G.monsters[m.mtype] || {};
            // A charging monster rushes at its charge speed (2026-11-21: Jr. charges at 90).
            const mRange = m.range || def.range || 20, mSpeed = Math.max(m.speed || def.speed || 0, def.charge || 0);
            if (myRange < mRange + (k.margin || 30) || mSpeed > mySpeed * (k.maxSpeedRatio || 1.1)) return false; // can't kite this one
            let dist;
            try { dist = parent.distance(character, m); } catch (e) { dist = util.distanceTo(m); }
            // Would it reach us before it dies? The target dies after its HP / our damage per
            // second; any other attacker only after the target.
            // Our damage type decides armor or resistance (2026-11-22 review: the priest was judged against armor).
            const myType = character.damage_type || ((G.classes && G.classes[character.ctype]) || {}).damage_type || "physical";
            const myDef = util.defenseVs(def, myType, character);
            const myDps = Math.max(1, (character.attack || 0) * (character.frequency || 1) * util.damageMultiplier(myDef));
            const killSec = (m === target ? m.hp : m.hp + (target ? target.hp : 0)) / myDps;
            const reachSec = Math.max(0, dist - mRange) / Math.max(1, mSpeed);
            if (killSec <= reachSec) continue; // dies first
            if (dist < threatDist) { threat = m; threatDist = dist; }
        }
        if (!threat) return false;
        const def = G.monsters[threat.mtype] || {};
        const mRange = threat.range || def.range || 20;
        const want = Math.min(myRange - (k.rangeSlack || 10), Math.max(threat.speed || def.speed || 0, def.charge || 0) + mRange + (k.extra || 50));
        if (threatDist >= want - (k.slack || 15)) { util.status("kiting " + threat.mtype + " (in place)", "orange"); return true; }
        if (is_moving(character) && Date.now() - ftr.lastKite < (k.everyMs || 250)) return true;
        const me = util.xy(character);
        const free = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        }).map(util.xy);
        // Never out of our own range of the target (player rule 2026-11-19) and not next to free
        // monsters (they would join) - the last one dropped if nothing else fits. No leash to the
        // leader any more (player decision 2026-11-21): in a fight the distance to the leader does not
        // matter - the priest comes into heal range by itself, low fighters go to the priest.
        const aim = target && target !== threat ? util.xy(target) : null;
        const okBase = function (x, y) { return !aim || Math.hypot(x - aim.x, y - aim.y) <= myRange * 0.95; };
        const okFree = function (x, y) { return okBase(x, y) && !free.some(function (q) { return Math.hypot(q.x - x, q.y - y) < (k.avoidRadius || 120); }); };
        const anchor = bossAnchor(threat) || farmAnchor(threat);
        const R = k.anchorRadius || 280;
        const inAnchor = function (ok) { return function (x, y) { return ok(x, y) && (!anchor || anchorOut(anchor, x, y, R) === 0); }; };
        const toAnchor = anchor ? function (x, y) { return anchor.box ? boxDist(anchor.box, x, y) : Math.hypot(x - anchor.x, y - anchor.y); } : null;
        // Out of foreign kinds' reach first (2026-11-22, Fire Spirits next to the scorpions).
        const skip = [threat, target];
        const okSafe = function (x, y) { return okFree(x, y) && !inForeignReach(x, y, skip); };
        // Inside the anchor circle first; none there: the fitting point closest to the anchor.
        const p = orbitPoint(threat, want, inAnchor(okSafe)) || orbitPoint(threat, want, inAnchor(okFree)) || orbitPoint(threat, want, inAnchor(okBase)) ||
            (anchor ? orbitPoint(threat, want, okBase, toAnchor) : orbitPoint(threat, want, okBase));
        if (!p) {
            // Cornered: run to open ground instead of standing and tanking (player idea 2026-11-18),
            // keep walking a chosen way out for a few seconds (Viz priest, 2026-11-19).
            if (ftr.escape && Date.now() < ftr.escape.until && is_moving(character)) {
                util.status("kiting " + threat.mtype + " - out of the corner", "orange");
                return true;
            }
            const esc = escapePoint(me, util.xy(threat), free, k, skip);
            if (!esc || (aim && Math.hypot(esc.x - aim.x, esc.y - aim.y) > myRange * 0.95)) return false; // nowhere to go: stand and fight
            ftr.lastKite = Date.now();
            ftr.escape = { x: esc.x, y: esc.y, until: Date.now() + 4000 };
            quiet(move(esc.x, esc.y));
            util.status("kiting " + threat.mtype + " - out of the corner", "orange");
            return true;
        }
        ftr.escape = null;
        if (Math.hypot(p.x - me.x, p.y - me.y) < 10) return true;
        ftr.lastKite = Date.now();
        ftr.goTo(p);
        util.status("kiting " + threat.mtype, "orange");
        return true;
    }
    // Foreign kinds (2026-11-22, player report): the warrior died to three Fire Spirits (range 280, magical,
    // burn) next to the Giant Scorpions. The priest stood towards them, the pulled scorpions ran his way, and
    // step by step the fight drifted into their reach - kite and spacing points only kept 120-130 px. A monster
    // of another kind than the farm target (event types count as ours) is kept off by its own reach +
    // kite.foreignMargin. skip: entities not to count (the monster we kite, our target).
    function isForeign(e) {
        const fm = ftr.lastFarm;
        if (!fm || !e || e.type !== "monster") return false;
        if (fm.any) return Array.isArray(fm.types) ? !fm.types.includes(e.mtype) : false;
        return !!fm.monster && e.mtype !== fm.monster;
    }
    function reachOf(e) { return e.range || (G.monsters[e.mtype] || {}).range || 20; }
    function inForeignReach(x, y, skip) {
        const margin = (config.combat.kite || {}).foreignMargin || 50;
        return Object.values(parent.entities || {}).some(function (e) {
            if (!e || e.dead || (skip && skip.includes(e)) || !isForeign(e)) return false;
            const q = util.xy(e);
            return Math.hypot(q.x - x, q.y - y) < reachOf(e) + margin;
        });
    }
    function escapePoint(me, pack, free, k, skip) {
        // Clear of foreign kinds' reach first; nothing there: as before (2026-11-22).
        return escapePointFrom(me, pack, free, k, skip || []) || escapePointFrom(me, pack, free, k, null);
    }
    function escapePointFrom(me, pack, free, k, skip) {

        let best = null, bestScore = -Infinity;
        for (const r of [150, 220, 300]) {
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
                // Through the pack is fine: monsters don't block the way, and they hit us anyway
                // while we stand in reach (player note 2026-11-18). Only free ones are avoided.
                if (free.some(function (p) { return Math.hypot(p.x - x, p.y - y) < (k.avoidRadius || 120); })) continue;
                if (skip && inForeignReach(x, y, skip)) continue;
                if (!ftr.canMoveFrom(me.x, me.y, x, y)) continue; // straight line only (no smart_move into walls)
                let open = 0;
                for (let j = 0; j < 8; j++) {
                    const b = j * Math.PI / 4;
                    if (ftr.canMoveFrom(x, y, x + Math.cos(b) * 60, y + Math.sin(b) * 60)) open++;
                }
                if (open < 4) continue; // another corner
                const score = Math.hypot(x - pack.x, y - pack.y) + open * 25 - r * 0.2;
                if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
            }
        }
        return best;
    }
    function spacingStep(target) {
        const sp = (config.party && config.party.spacing) || {};
        if (!sp.enabled || !party.enabled) return false;
        // A chosen point is walked to the end (2026-11-21: re-planned every 0.8 s, priest and ranger
        // swung left-right-left between the pompoms around the Phoenix).
        if (ftr.spaceGoal && is_moving(character) && Date.now() - ftr.spaceGoal.at < (sp.holdGoalMs || 2500) &&
            Math.hypot(character.x - ftr.spaceGoal.x, character.y - ftr.spaceGoal.y) > 10) return true;
        if (is_moving(character) && Date.now() - ftr.lastSpace < (sp.everyMs || 700)) return false;
        const myRange = character.range || 0;
        const tanks = ((config.targeting.teamSafety || {}).tankClasses) || [];
        if (myRange < (sp.minOwnRange || 100) || tanks.includes(character.ctype)) return false;
        const tank = party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
            .find(function (p) { return p && !p.rip && tanks.includes(p.ctype) && util.distanceTo(p) < 400; });
        if (!tank) return false;
        const margin = sp.margin || 50;
        // Never farther than we can shoot (2026-11-21): at most our range - 25 px. Foreign kinds (not our target)
        // out of their whole reach + foreignMargin (2026-11-22: Fire Spirits, 280, next to the scorpions).
        const fMargin = (config.combat.kite || {}).foreignMargin || 50;
        const keep = function (m) {
            if (m !== target && isForeign(m)) return reachOf(m) + fMargin;
            const r = reachOf(m) + margin;
            return r < myRange ? Math.min(r, myRange - 25) : Math.min(sp.gap || 130, myRange - 25);
        };
        // The same circle as kiting (2026-11-21): around the closest monster we are too near to, from
        // our own angle - we only move while inside its circle, so we don't swing back and forth.
        // Every monster around counts, also free ones (player decision 2026-11-21: many have aggro and
        // rage - walking into them would pull more than we can take). The pendulum between two of them
        // is solved by a point clear of all at once and by walking a chosen point to the end.
        const relevant = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead;
        });
        let near = null, nearGap = Infinity;
        relevant.forEach(function (e) {
            const gap = util.distanceTo(e) - keep(e);
            if (gap < -(sp.slack || 15) && gap < nearGap) { near = e; nearGap = gap; }
        });
        if (!near) { ftr.spaceGoal = null; return false; }
        const t = target ? util.xy(target) : null;
        const inShot = function (x, y) { return !t || Math.hypot(t.x - x, t.y - y) <= myRange - 15; };
        // A point clear of every relevant monster first, else clear of the nearest one.
        const clearAll = function (x, y) {
            return inShot(x, y) && relevant.every(function (e) { const q = util.xy(e); return Math.hypot(q.x - x, q.y - y) >= keep(e) - (sp.slack || 15); });
        };
        const p = orbitPoint(near, keep(near), clearAll) || orbitPoint(near, keep(near), inShot);
        if (!p) return false;
        ftr.lastSpace = Date.now();
        ftr.spaceGoal = { x: p.x, y: p.y, at: Date.now() };
        ftr.goTo(p);
        util.status("keeping distance from " + near.mtype, "white");
        return true;
    }

    Object.assign(ftr, {
        orbitPoint: orbitPoint,
        bossAnchor: bossAnchor,
        farmAnchor: farmAnchor,
        boxDist: boxDist,
        anchorOut: anchorOut,
        kiteStep: kiteStep,
        isForeign: isForeign,
        reachOf: reachOf,
        inForeignReach: inForeignReach,
        escapePoint: escapePoint,
        escapePointFrom: escapePointFrom,
        spacingStep: spacingStep,
    });
};
