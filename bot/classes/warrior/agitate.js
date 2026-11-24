// =====================================================================
// classes/warrior/agitate.js - the Agitate pack tick: decides each tick whether the pack mode runs (stream or pull point) and drives the pull.
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

    function packTick() {
        if (w.splashOnly()) w.releaseSplash(); // puts the Lolipops on (also in a swords stream)
        if (util.noAreaNear(deps.config, game.data().skills.agitate.range + (ag.clearMargin || 80))) return false; // Giga Crab near (2026-11-23)
        if (!w.packOn()) { w.releaseSplash(); return false; }
        // A roaming boss waiting for the team in reach: no Agitate (it would open the fight alone, 2026-11-21).
        if (deps.targeting && deps.targeting.heldBossNear && deps.targeting.heldBossNear(game.data().skills.agitate.range || 300)) return false;
        // Mobbing live (2026-11-22): more than 3 on us and the live combo would kill us within mobStopTtdSec -
        // no Agitate (it only adds to the mob); the normal combat kills those on us until 3 are left.
        if (w.onMe().length > 3 && deps.targeting && deps.targeting.liveDanger) {
            const dz = deps.targeting.liveDanger();
            if (dz.ttd < (ag.mobStopTtdSec || 20)) {
                util.status("mobbed x" + dz.mult.toFixed(1) + ": no Agitate", "orange");
                return false;
            }
        }
        // Spot check from the edge still open (2026-11-22): no pull before the spot is judged, unless monsters are on us.
        if (deps.targeting && deps.targeting.spotGate && !w.onMe().length) {
            let fm = null;
            try { fm = deps.targeting.farmNow(); } catch (e) { fm = null; }
            if (fm && deps.targeting.spotGate(fm)) { w.releaseSplash(); return false; }
        }
        // Learning: a low-HP moment under attack counts against that monster kind.
        if (util.hpRatio() < (ag.streamStopHp || 0.4)) {
            const on = w.onMe();
            if (on.length) w.noteLowHp(on[0].mtype);
        }
        // Auto: the stream runs only where the farm target is (player report 2026-11-18): other
        // harmless kinds only come along. With booboo as the target the stream walked from goo
        // clump to goo clump in town instead of letting the normal combat travel to Spooky Town.
        // Without the farm target around the normal combat fights whatever is on us, with the
        // usual weapons.
        if (ag.monsters === "auto" && w.auto.type && !Object.values(game.entities()).some(function (e) {
            return e && e.type === "monster" && !e.dead && e.mtype === w.auto.type && util.distanceTo(e) <= 600;
        })) { w.releaseSplash(); return false; }
        // A party member behind the leader catches up first (the leash), unless monsters are on us.
        // (After the farm-target check: following the priest out of the bat cave the Lolipops
        // stayed on until their hold ran out, 2026-11-18.)
        if (deps.party.isMember && !deps.party.detached() && !w.onMe().length) {
            const lead = deps.party.leaderInfo();
            const leash = (deps.config.party && deps.config.party.leash) || 300;
            if (lead && (lead.map !== game.me().map || Math.hypot(lead.x - game.me().x, lead.y - game.me().y) > leash)) return false;
        }
        if (w.effectiveMode() === "splashstream") {
            // Stream with the splash weapons on (player test 2026-11-18).
            if (!w.wearingSplash()) {
                if (!w.splashWeapons().length) return false;
                if (!w.pack.busy) w.putOnSplash();
                return true;
            }
            deps.gear.holdWeapons(ag.keepMs || 60 * 1000);
            if (w.streamAgitate(true) === "step") return true; // walking clear of other kinds first
            return w.streamFight(true);
        }
        if (deps.party.enabled) {
            if (w.effectiveMode() === "swords") { if (w.streamAgitate() === "step") return true; return w.streamFight(); }
            return false; // pull-point modes are solo only
        }
        if (w.agMode() === "swords" && (ag.swords || "stream") === "stream") {
            if (w.streamAgitate() === "step") return true;
            return w.streamFight();
        }
        if (w.pack.busy) return true;
        const now = Date.now();
        if (w.pack.state === "idle") {
            const free = w.packAround(game.data().skills.agitate.range);
            if ((ag.gather || "center") !== "center" && free.length < (ag.minPack || 3)) return false; // "center": bestPullPoint looks wider
            if (util.hpRatio() < (ag.minHp || 0.8) || !util.canCast("agitate") || game.me().mp < game.data().skills.agitate.mp) return false;
            // "center": the best place to Agitate from (most pack monsters in reach, nothing
            // unwanted, shortest walk) - see bestPullPoint.
            const spot = (ag.gather || "center") === "center" ? w.bestPullPoint() : null;
            if ((ag.gather || "center") === "center" && !spot) return false; // no place with a pack and nothing unwanted
            const others = spot ? [] : w.unwantedAround(game.data().skills.agitate.range);
            if (others.length) {
                util.status("agitate: waiting - " + others.length + "x " + others[0].mtype + " in reach", "white");
                return false; // normal combat meanwhile; the next round may stand better
            }
            if (w.splashMode() && !w.wearingSplash()) {
                if (!w.splashWeapons().length) {
                    if (!w.pack.noWeaponsLogged) util.log("warrior", "agitate mode: no splash weapon in the bag", "orange");
                    w.pack.noWeaponsLogged = true;
                    return false;
                }
                w.putOnSplash();
                return true;
            }
            // "center" (default since 2026-11-18): walk to the best pull point first - only as
            // far as needed, so aggressive monsters don't start towards us before the Agitate
            // and arrive one by one (the arctic bees came from 50-300 px and died alone).
            if (spot && !spot.here) {
                if (!game.isMoving(game.me()) || !w.pack.walkTo || Math.hypot(w.pack.walkTo.x - spot.x, w.pack.walkTo.y - spot.y) > 40) {
                    w.pack.walkTo = { x: spot.x, y: spot.y };
                    quiet(game.walkStraight(spot.x, spot.y));
                }
                util.status("agitate: to the pull point (" + spot.count + ")", "orange");
                return true;
            }
            if (!w.farmTargetIn(w.packAround(game.data().skills.agitate.range))) return false; // only other kinds here
            if (spot && game.isMoving(game.me())) game.stopAction();
            w.pack.walkTo = null;
            if (util.canCast("warcry") && game.me().mp >= game.data().skills.agitate.mp + game.data().skills.warcry.mp) game.useSkill("warcry").catch(function () {});
            game.useSkill("agitate").catch(function () {});
            w.lastAgitate = { at: now, type: (spot && w.auto.type) || (w.packAround(game.data().skills.agitate.range)[0] || {}).mtype || null };
            if (w.splashMode()) deps.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            const pulledNow = w.packAround(game.data().skills.agitate.range);
            w.pack.pulled = pulledNow.map(function (m) { return m.id; });
            w.pack.since = now; w.pack.startHp = game.me().hp; w.pack.attacks = 0; w.pack.neighborSum = 0; w.pack.recent = [];
            const kinds = {};
            pulledNow.forEach(function (m) { kinds[m.mtype] = (kinds[m.mtype] || 0) + 1; });
            util.log("warrior", "Agitate: " + Object.keys(kinds).map(function (k) { return kinds[k] + "x " + k; }).join(", "), "yellow");
            if ((ag.gather || "center") === "step") w.pack.state = w.stepAway(pulledNow) ? "gather" : "fight";
            else {
                // A short step out of the pack: the splash works forward (around the target, the
                // warrior's own body blocks the far side), so they should come from one side.
                w.pack.state = ag.sideStep && w.stepAway(pulledNow, ag.sideStep) ? "gather" : "fight";
            }
            w.pack.lastAdjust = now;
            return true;
        }
        const mine = w.onMe();
        if (util.hpRatio() < (ag.abortHp || 0.3) && mine.length) {
            // Too hot: walk away from the pack (most pack monsters are slower than us).
            if (!game.isMoving(game.me())) w.stepAway(mine);
            util.status("agitate: backing off", "red");
            return true;
        }
        if (w.pack.state === "gather") {
            if (game.isMoving(game.me()) && now - w.pack.gatherAt < (ag.gatherMs || 2500)) {
                util.status("agitate: gathering the pack", "orange");
                return true;
            }
            if (game.isMoving(game.me())) game.stopAction();
            w.pack.state = "fight";
        }
        // fight
        if (!mine.length) {
            if (now - w.pack.since > 3000) w.finishPull("no monster left on us");
            return w.pack.state !== "idle";
        }
        let best = null, bestN = -1;
        mine.forEach(function (m) {
            if (!game.inRange(m)) return;
            const n = w.splashNeighbours(m, mine);
            if (n > bestN || (n === bestN && best && m.hp < best.hp)) { best = m; bestN = n; }
        });
        if (!best && mine.length > (ag.chaseFrom || 3)) {
            util.status("agitate: waiting for the pack (" + mine.length + ")", "orange");
            return true;
        }
        // "chain" (player idea 2026-11-18): with only stragglers left, the next pull starts at
        // once - new monsters have spawned meanwhile, the stragglers follow us into the new pack
        // and there is no phase of fighting just one or two.
        if (w.agMode() === "chain" && mine.length <= (ag.chaseFrom || 3) && now - w.pack.since > 3000 &&
            util.canCast("agitate") && game.me().mp >= game.data().skills.agitate.mp + w.reserve()) {
            const next = w.bestPullPoint();
            const freshCount = next ? next.count - mine.filter(function (m) { return Math.hypot(util.xy(m).x - next.x, util.xy(m).y - next.y) <= game.data().skills.agitate.range - 10; }).length : 0;
            if (next && freshCount >= (ag.minPack || 3)) {
                w.finishPull("chained into the next pull");
                return true; // idle: walks to the pull point and pulls; the stragglers come along
            }
        }
        if (!best) {
            // Only stragglers left (chaseFrom or fewer): meet the nearest one instead of waiting (player request
            // 2026-11-18: the last 2-3 from the far side took long to arrive). Monsters first
            // walk to where we cast Agitate, then to us - so going to them is the shortest.
            const near = mine.slice().sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); })[0];
            const p = util.xy(near);
            if (!game.isMoving(game.me()) || !w.pack.chase || Math.hypot(w.pack.chase.x - p.x, w.pack.chase.y - p.y) > 30) {
                w.pack.chase = p;
                if (game.canMoveTo(p.x, p.y)) quiet(game.walkStraight(p.x, p.y));
                else quiet(game.moveTo(p.x, p.y));
            }
            util.status("agitate: to the next one (" + mine.length + " left)", "orange");
            return true;
        }
        w.pack.chase = null;
        // The first swing waits until most of the pack is here (waitShare of the pulled ones in
        // range, at most waitMs): a lone first arrival would just die alone.
        if (!w.pack.attacks && now - w.pack.since < (ag.waitMs || 3000)) {
            const here = mine.filter(function (m) { return game.inRange(m); }).length;
            if (here < Math.ceil(w.pack.pulled.length * (ag.waitShare || 0.7))) {
                util.status("agitate: " + here + "/" + w.pack.pulled.length + " here", "orange");
                return true;
            }
        }
        // Spread around us: step away again so they come from one side.
        const avg = w.pack.recent.length >= 4 ? w.pack.recent.reduce(function (s, n) { return s + n; }, 0) / w.pack.recent.length : 99;
        if ((ag.gather || "center") === "step" && mine.length >= 3 && avg < (ag.regroupBelow || 0.5) && now - w.pack.lastRegroup > (ag.regroupEveryMs || 8000)) {
            w.pack.recent = [];
            if (w.stepAway(mine)) { w.pack.state = "gather"; return true; }
        }
        // Monsters behind us (opposite the pack's main side) take no splash: a small step away
        // from all of them puts them on one side again (at most every adjustEveryMs).
        if ((ag.gather || "center") === "center" && ag.adjustStep && mine.length >= 3 && now - (w.pack.lastAdjust || 0) > (ag.adjustEveryMs || 4000)) {
            const me = util.xy(game.me()), mid = w.centerOf(mine);
            const dx = mid.x - me.x, dy = mid.y - me.y;
            const behind = mine.filter(function (m) { const p = util.xy(m); return (p.x - me.x) * dx + (p.y - me.y) * dy < 0; });
            if (behind.length && behind.length < mine.length) {
                w.pack.lastAdjust = now;
                w.stepAway(mine, ag.adjustStep);
            }
        }
        if (game.targetedMonster() !== best) game.changeTarget(best);
        // Fired by the strike loop the moment the cooldown ends (2026-11-20).
        deps.strike.attack(best, function (m) {
            const n = w.splashNeighbours(m, w.onMe());
            w.pack.attacks++;
            w.pack.neighborSum += n;
            w.noteHit(m.mtype, n);
            w.pack.recent.push(n);
            if (w.pack.recent.length > 6) w.pack.recent.shift();
        });
        util.status("agitate: " + mine.length + " on us, splash " + bestN, "green");
        return true;
    }

    Object.assign(w, {
        packTick: packTick,
    });
};
