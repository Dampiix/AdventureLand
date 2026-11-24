// =====================================================================
// farming/target-pick.js - picking the target: lone monsters, isolation, the nearest safe one, ours and easy ones, party attackers, rare targets.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;
    const icfg = cfg.isolation || {};
    const rcfg = cfg.rage || {};

    // Where we stop to hit e: on the line from us to it, at 90% of our range.
    function standPoint(e) {
        const p = util.xy(e);
        const me = util.xy(character);
        const dx = me.x - p.x, dy = me.y - p.y;
        const d = Math.hypot(dx, dy);
        const r = Math.max(10, (character.range || 30) * 0.9);
        if (d <= r) return me;
        return { x: p.x + dx / d * r, y: p.y + dy / d * r };
    }
    function distToSegment(p, a, b) {
        const vx = b.x - a.x, vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
        return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
    }
    function crowdAround(e) {
        const r = icfg.radius || 120;
        const at = util.xy(e);
        const me = util.xy(character);
        const stand = standPoint(e);
        return Object.values(parent.entities || {}).filter(function (o) {
            if (!o || o.id === e.id || o.type !== "monster" || o.dead || !o.visible || o.target) return false;
            if (!tgt.aggressive(o)) return false;
            const q = util.xy(o);
            return Math.hypot(q.x - at.x, q.y - at.y) < r || distToSegment(q, me, stand) < r;
        }).length;
    }
    function isolated(e) {
        // In a rage zone there is no lone pull (2026-11-22): stepping in brings the whole spawn, so the zone's own
        // verdict decides (rageBlocks) - the priest stood at the booboo zone waiting for a lone one.
        if (rcfg.enabled !== false && tgt.zoneAt(util.xy(e))) return true;
        return !icfg.enabled || !tgt.aggressive(e) || crowdAround(e) === 0;
    }

    // Free monsters of this type that we may hit (damage return, live level check).
    function safeCandidates(type) {
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.mtype !== type || e.dead || !e.visible || e.target) return false;
            if (party.nearLeader && !party.nearLeader(e)) return false; // member: only within the farm radius of the leader
            return !util.tooSpiky(config, e) && tgt.liveSafe(e);
        });
    }
    // Nearest of them that stands alone (see isolated).
    function nearestSafe(type) {
        let best = null;
        let bestD = Infinity;
        safeCandidates(type).forEach(function (e) {
            if (!isolated(e)) return;
            if (!e.target && tgt.inOccupied(e)) return; // another player's spot
            const d = util.distanceTo(e);
            if (d < bestD && !tgt.skipDoomed(e) && !tgt.rageBlocks(e)) { bestD = d; best = e; }
        });
        return best;
    }
    function explainNone(type) {
        const now = Date.now();
        if (now - (tgt.noneLogged[type] || 0) < 60 * 1000) return;
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === type && !e.dead && e.visible;
        });
        if (!seen.length) return;
        tgt.noneLogged[type] = now;
        let busy = 0, unsafe = 0, notAlone = 0, occupied = 0;
        seen.forEach(function (e) {
            if (e.target) busy++;
            else if (util.tooSpiky(config, e) || !tgt.liveSafe(e) || tgt.rageBlocks(e)) unsafe++; // a failing rage zone counts as too strong
            else if (!isolated(e)) notAlone++;
            else if (tgt.inOccupied(e)) occupied++;
        });
        const parts = [];
        if (busy) parts.push(busy + " already fighting");
        if (unsafe) parts.push(unsafe + " too strong");
        if (notAlone) parts.push(notAlone + " not alone");
        if (occupied) parts.push(occupied + " on another player's spot");
        tgt.noneSeen[type] = { at: now, seen: seen.length, unsafe: unsafe, taken: busy + occupied };
        util.log("target", seen.length + " " + type + " in sight, none picked: " + (parts.join(", ") || "no reason found"), "orange");
    }
    // We see monsters of this type but none stands alone: hold position until one does,
    // instead of walking on into the pack (waitForLone below). Where to wait: spots.watchPoint.
    // Returns "lone" (only packs in sight), "strong" (only ones above our level check in
    // sight – skipped, but walking on towards the spawn's middle ran the team into the
    // level-12 White Wolves, 2026-11-17) or null (walk on).
    function waitForLone(type) {
        if (!icfg.enabled) return null;
        let why = null;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (why === "lone" || !e || e.type !== "monster" || e.mtype !== type || e.dead || !e.visible || e.target) return;
            // A spot already given up (taken, or too strong by the spot check) holds nobody back - the priest stood
            // still next to the big booboo spawn instead of walking on to the other one (2026-11-22).
            if (tgt.inOccupied(e)) return;
            if (!tgt.aggressive(e)) return;
            if (util.tooSpiky(config, e) || !tgt.liveSafe(e)) {
                // Only close ones stop us: holding as soon as the first one came into sight
                // left the team standing among the Wolfies below the White Wolves (2026-11-17).
                if (util.distanceTo(e) < (icfg.strongHold || 300)) why = why || "strong";
            }
            else if (!isolated(e)) why = "lone";
        });
        return why;
    }

    function isOurs(name) {
        return name === character.name || party.inParty(name);
    }

    // A monster we can safely handle alone: dies in a few of our hits and barely
    // scratches us (config.party.spread).
    function isEasy(type) {
        const s = config.party.spread;
        const def = G.monsters[type];
        if (!s || !s.enabled || !def || def.cooperative) return false;
        // Harmless ones (at most s.harmlessRatio of our HP per hit) are easy however long they take:
        // the warrior (98 attack) needed 4 hits for a bee (300 HP) and only assisted while the
        // ranger took his own - a bee hits him for 1 % of his HP (2026-11-19).
        if (s.harmlessRatio && def.attack <= character.max_hp * s.harmlessRatio) return true;
        // Kiteable for us (ranger, priest): its hits count with the residual kite risk, and how long the
        // kill takes doesn't matter (2026-11-21: giant scorpions, speed 24, range 32, for the ranger).
        const risk = util.kiteRisk(def, null, { speed: character.speed, range: character.range });
        if (risk < 1) return def.attack * risk <= character.max_hp * s.maxDamageRatio;
        return def.hp <= character.attack * s.maxHits && def.attack <= character.max_hp * s.maxDamageRatio;
    }

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (util.tooSpiky(config, t)) return false; // melee vs. damage return: our own hit kills us
        if (t.target && !isOurs(t.target) && !tgt.isCoop(t)) return false;
        // Giga Crab (events.foreignOnly): only while a foreign player holds it and it takes damage (2026-11-23).
        if (util.foreignOnlyBlocks(config, t)) return false;
        return true;
    }

    // Nearest monster attacking us or any party member (V1's party-aggro priority).
    // Doomed ones (dying to damage already in the air) are passed over (2026-11-20).
    function nearestPartyAttacker() {
        const names = party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        let best = null;
        let bestDistance = Infinity;
        Object.values(parent.entities || {}).forEach(function (m) {
            if (!m || m.type !== "monster" || m.dead || !m.target || !names.includes(m.target)) return;
            if (util.foreignOnlyBlocks(config, m)) return; // a Giga Crab on one of us: never hit it (2026-11-23)
            const d = util.distanceTo(m);
            if (d >= bestDistance || tgt.skipDoomed(m)) return;
            best = m;
            bestDistance = d;
        });
        return best;
    }

    // Rare monsters (player decision 2026-11-20, from earthiverse's bot): a golden bat, cutebee,
    // tiny pinky or a seasonal one in sight goes first - before the current target. Only ones we
    // get credit for (no target, or on us or a member), within rare.range px, and not invulnerable.
    function rareTarget() {
        const rc = config.targeting.rare || {};
        if (!rc.enabled || !(rc.types || []).length) return null;
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        let best = null, bestD = Infinity;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || !rc.types.includes(e.mtype)) return;
            if (e.target && !ours.includes(e.target)) return;
            if (e.s && (e.s.fullguard || e.s.fullguardx || e.s.invincible)) return;
            const d = util.distanceTo(e);
            if (d <= (rc.range || 400) && d < bestD) { best = e; bestD = d; }
        });
        if (best && best.id !== tgt.lastRareId) {
            tgt.lastRareId = best.id;
            util.log("target", "rare monster: " + best.mtype + " (" + Math.round(bestD) + " px) - attacking", "yellow");
        }
        return best;
    }
    // The next target (pickInner), then the guards: the mobbing guard, and the fear guard (earthiverse's
    // courage check, player decision 2026-11-21): no new free monster while the attackers of its damage
    // type on us already reach our courage for it - fear would cut our attack to 60/40/20 %. Monsters
    // already on us or a member are fought as usual. Last, a boss held for the team (holdBoss).
    function pick(farmTarget) {
        const t = pickInner(farmTarget);
        if (t && tgt.mobGuard(t)) {
            util.status("mobbing: no new pull", "white");
            return null;
        }
        if (t && util.wouldScare(t)) {
            if (Date.now() - tgt.fearLogged > 60 * 1000) {
                tgt.fearLogged = Date.now();
                util.log("target", "not pulling " + t.mtype + ": " + util.damageTypeOf(t) + " attackers on me reach my courage (" + util.courageOf(util.damageTypeOf(t)) + ")", "white");
            }
            util.status("fear: waiting with " + t.mtype, "white");
            return null;
        }
        return t && tgt.holdBoss(t) ? null : t;
    }
    function pickInner(farmTarget) {
        // Cave, manual mode (v1.231.0, player decision 2026-11-24): our current target (on the leader: set by the
        // player's click or attack), a monster attacking the party, and for members the leader's target - nothing
        // else, no rare monsters, no free pulls.
        if (farmTarget && farmTarget.cave) {
            const cur = get_targeted_monster();
            if (isValid(cur) && deps.cave.mayFight(cur) && !tgt.skipDoomed(cur)) return cur;
            const attacker = nearestPartyAttacker();
            if (attacker && deps.cave.mayFight(attacker) && !util.tooSpiky(config, attacker)) return attacker;
            if (party.isMember) {
                const lead = party.leaderInfo();
                const assist = lead && lead.target ? get_monster(lead.target) : null;
                if (isValid(assist) && deps.cave.mayFight(assist) && !tgt.skipDoomed(assist)) return assist;
            }
            return null;
        }
        tgt.checkOccupied();
        const rare = rareTarget();
        if (rare) return rare;
        const current = get_targeted_monster();
        // A lone pull we are still walking up to must stay alone until it is engaged: the
        // White Wolf wandered deeper into the pack while the priest followed it (2026-11-17).
        // Dropped, we hold (waitForLone) until it – or another one – stands alone again.
        // A current target the damage in the air already kills is let go (2026-11-20).
        if (isValid(current) && !(!current.target && tgt.aggressive(current) && !isolated(current)) && !tgt.skipDoomed(current)) return current;

        const attacker = nearestPartyAttacker();
        // Easy monsters (spread): help only with ones in our range or on us - the rest walk to
        // whoever they chase. After the warrior's Agitate the priest and the ranger waited for
        // the slow bees to reach him instead of taking free ones (2026-11-18).
        const spreading = party.enabled && farmTarget && farmTarget.monster && isEasy(farmTarget.monster);
        if (attacker && !util.tooSpiky(config, attacker) &&
            (!spreading || attacker.target === character.name || is_in_range(attacker))) return attacker;

        // Join event (e.g. Goo Brawl): anything in the event map is fair game, and
        // everyone picks its own nearest monster – waiting for the leader's pick
        // (a melee paladin) left most kills to other players.
        if (farmTarget.any) {
            // Events with waves (e.g. Graveyard Rising in Spooky Town) share the map with other
            // monsters (mummies): only the event's own monsters count.
            if (farmTarget.types && farmTarget.types.length) {
                let best = null;
                farmTarget.types.forEach(function (type) {
                    const m = get_nearest_monster({ type: type });
                    if (isValid(m) && (!best || util.distanceTo(m) < util.distanceTo(best))) best = m;
                });
                return best;
            }
            const m = get_nearest_monster({});
            return isValid(m) ? m : null;
        }

        if (party.isMember && !party.detached()) {
            // The event's boss in our own sight: take it without waiting for the leader's target
            // (player decision 2026-11-21: anyone may open on a boss alone). The warrior found the
            // Phoenix twice and only attacked once the priest saw it - members only assisted the
            // leader's target. Held bosses (events.holdFor) are still held by pick().
            if (farmTarget && farmTarget.monster && String(farmTarget.source || "").indexOf("event ") === 0) {
                const boss = get_nearest_monster({ type: farmTarget.monster });
                if (isValid(boss)) return boss;
            }
            const lead = party.leaderInfo();
            // Easy farm targets (e.g. goos for a hunt): everyone fights its own monster - our nearest
            // one, no leash to the leader any more (player decision 2026-11-21).
            const own = lead && lead.farm && isEasy(lead.farm) ? nearestSafe(lead.farm) : null;
            if (own) return own;
            // Otherwise only assist the leader, never pull new monsters –
            // and never wander off to a farm spot of our own.
            const assist = lead && lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && (assist.target || tgt.isCoop(assist)) && !tgt.skipDoomed(assist) ? assist : null;
        }

        const type = farmTarget.monster;
        if (G.monsters[type] && G.monsters[type].cooperative) {
            const boss = get_nearest_monster({ type: type }); // bosses never die to one volley
            if (isValid(boss)) return boss;
        }
        // Spot check from the edge still open: nothing of the kind picked yet (2026-11-22).
        if (tgt.spotGate(farmTarget)) return null;
        const best = nearestSafe(type);
        if (!best) explainNone(type);
        return best;
    }

    Object.assign(tgt, {
        standPoint: standPoint,
        distToSegment: distToSegment,
        crowdAround: crowdAround,
        isolated: isolated,
        safeCandidates: safeCandidates,
        nearestSafe: nearestSafe,
        explainNone: explainNone,
        waitForLone: waitForLone,
        isOurs: isOurs,
        isEasy: isEasy,
        isValid: isValid,
        nearestPartyAttacker: nearestPartyAttacker,
        rareTarget: rareTarget,
        pick: pick,
        pickInner: pickInner,
    });
};
