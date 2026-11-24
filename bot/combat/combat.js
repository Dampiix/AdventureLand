// =====================================================================
// combat/combat.js - the fight: target, the class's fight hook, the basic attack, moving into range.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const targeting = deps.targeting;
    const party = deps.party;
    const cls = deps.cls;

    function handleCombat() {
        if (ftr.resting()) return;
        const farm = targeting.currentFarm();
        let target = targeting.pick(farm);
        // Pass through (player request 2026-11-19): on the way to the farm spot, monsters of
        // another kind that attack us but are clearly slower are left behind instead of fought -
        // the party stuck in booboo fights on its way to the mummies. Not near the spot, not
        // below combat.passThrough.minHp, and only when every attacker is that slow.
        if (target && ftr.passThrough(farm, target)) {
            ftr.lastFarm = farm;
            ftr.lastTarget = null; // members see the leader travelling with no target: they follow, no fights
            ftr.startPassing(farm);
            util.status("passing " + target.mtype, "yellow");
            ftr.travel(ftr.goalFor(farm), "searching " + farm.monster, farm);
            return;
        }
        // Only time actually fighting counts for the crowded-spot check: running after a
        // monster that another player kills on the way is time without a target too.
        // A monster attacking one of us counts as work too, in our range or not: after the
        // warrior's Agitate the leader saw no free bee in its own range, called the spot crowded
        // and the party shuttled between bee spots (2026-11-18).
        // Walking to a target stays idle (player decision 2026-11-21: a spot where we mostly walk for one
        // kill a minute is no good spot); the shared-spot bar was lowered to 75 % instead.
        const busy = !!target && (is_in_range(target) || (target.target && (target.target === character.name || party.memberNames().includes(target.target))));
        targeting.reportSearch(busy);
        ftr.lastFarm = farm;
        ftr.lastTarget = target;

        if (!target) {
            // A boss we hold for the team (not engaged yet) in sight but far off: close in to within
            // the hold range - out of its reach - so the team can gather at it (2026-11-21: the
            // meeting point was where the warrior first saw Dracul, 560 px away; the hold waits until
            // everyone is within holdRange of the boss, so all three stood at the meeting point and
            // waited for each other).
            if (String(farm.source || "").indexOf("event ") === 0 && farm.monster) {
                const boss = get_nearest_monster({ type: farm.monster });
                // An aggressive boss we hold for the team (2026-11-22, targeting.bossHoldRing): we wait outside its
                // spawn box - inside, Jr. walked into the ranger and the fight began alone. The ring is kept for a
                // minute when the boss leaves our sight, so we don't walk into its box looking for it.
                if (ftr.holdRingStep(boss, farm.monster)) return;
                const holdRange = (config.events && config.events.holdRange) || 350;
                if (boss && !boss.dead && util.distanceTo(boss) > holdRange * 0.7) {
                    const def = G.monsters[boss.mtype] || {};
                    const keepOff = Math.max(holdRange * 0.55, (boss.range || def.range || 50) + 60);
                    const me = util.xy(character), b = util.xy(boss);
                    const d = Math.hypot(me.x - b.x, me.y - b.y) || 1;
                    util.status("closing in on " + boss.mtype, "yellow");
                    ftr.moveTo({ x: b.x + (me.x - b.x) / d * keepOff, y: b.y + (me.y - b.y) / d * keepOff });
                    return;
                }
                // In sight and close enough: wait here. Travelling would mean smart_move("phoenix") -
                // the game's nearest Phoenix SPAWN, a different one for each of us, away from the
                // Phoenix next to us (2026-11-21).
                if (boss && !boss.dead) { util.status("waiting at " + boss.mtype, "yellow"); return; }
            }
            if (party.idleFollow()) return; // party member: stay with the leader
            if (farm.any) { util.status("waiting for monsters (" + farm.source + ")", "white"); return; }
            // Cavalry reset at a rage zone (2026-11-22): we call from its edge, never from inside it.
            const edge = targeting.cavalryEdge ? targeting.cavalryEdge(farm) : null;
            if (edge && edge.hold) {
                ftr.endSearchWalk();
                if (is_moving(character)) stop();
                util.status(edge.why, "yellow");
                return;
            }
            // Spot check (2026-11-22): at the edge of the farm spot we stop and look before walking in.
            const gate = targeting.spotGate ? targeting.spotGate(farm) : null;
            if (gate && gate.hold) {
                ftr.endSearchWalk();
                if (is_moving(character)) stop();
                util.status(gate.why, "white");
                return;
            }
            // A Cavalry plan walks right into the spot (the call needs the monsters within 320 px).
            const hold =String(farm.source || "").startsWith("cavalry") ? null : targeting.waitForLone(farm.monster);
            if (hold) {
                // Too strong ones close: the spot check judges from here (2026-11-22).
                if (hold === "strong" && targeting.spotGateWatchNow) targeting.spotGateWatchNow(farm);
                // Waiting for a lone one: from the edge of the spawn, where the whole box is in
                // sight (player request 2026-11-19) - not wherever the first one came into view.
                const wp = hold === "lone" && targeting.watchPoint ? targeting.watchPoint(farm.monster) : null;
                if (wp && util.distanceTo(wp) > 40) ftr.moveTo(wp);
                else ftr.endSearchWalk();
                util.status((hold === "strong" ? "too strong: " : "waiting for a lone ") + farm.monster, "white");
                return;
            }
            ftr.travel(ftr.goalFor(farm), "searching " + farm.monster, farm);
            return;
        }

        // Solo (player decision 2026-11-17): a costly fight only starts with enough HP to end it
        // above the reserve - (1 - soloHpUse) of max HP. With soloHpUse 0.7 a fight costing 70%
        // waits for full HP, a cheap one goes ahead at lower HP. Not for monsters already on us.
        if (!party.enabled && target.target !== character.name && ftr.topUpFor(target)) return;
        ftr.topUpSince = 0;

        if (get_targeted_monster() !== target) change_target(target);
        // A far target in sight does not end the search walk yet: it may be gone (another
        // player, out of sight) the next tick, and the walk restarted - two steps, a new
        // search, two steps on the way to the bees (2026-11-17). Close ones, ones already on
        // us and aggressive ones (packs) end it at once.
        const near = util.distanceTo(target) < 250 || !!target.target || targeting.aggressive(target);
        if (!near && ftr.walks.searching() && typeof smart !== "undefined" && smart.moving) {
            util.status("moving to " + target.mtype, "orange");
            return;
        }
        ftr.endSearchWalk();

        if (!is_in_range(target)) {
            // A monster on its way to a party member (e.g. the priest pulled it): meet it at
            // that member instead of running to where the monster was – the warrior ran past
            // the incoming White Wolf deeper into the spawn (2026-11-17). Taunt (range 200)
            // takes it over once we are close. Melee only: the priest followed the wolf to
            // the warrior after the Taunt – into the spawn (2026-11-17); ranged fighters just
            // close in to their range.
            const melee = ((config.targeting.melee || {}).classes || []).includes(character.ctype);
            const victimName = melee && target.target && target.target !== character.name && party.memberNames().includes(target.target) ? target.target : null;
            const victim = victimName ? get_player(victimName) : null;
            // Only until we stand by that member: a kiting priest keeps the monster at range, so
            // the warrior waited next to him forever (2026-11-19) - from there we go for it.
            if (victim && !victim.rip && util.distanceTo(victim) > 80) {
                util.status("moving to " + victimName, "orange");
                // Warrior Dash towards the hit member (player decision 2026-11-21): there we taunt it off.
                if (cls.move && cls.move(victim)) return;
                ftr.moveTo(util.xy(victim));
                return;
            }
            // A monster already coming for us (e.g. after our Taunt) is waited for, not met
            // halfway - the warrior ran towards the moles, into the next ones (2026-11-17).
            // Only if it reaches us: one with a longer range than ours would stop short.
            const def = G.monsters[target.mtype] || {};
            // Ranged fighters likewise wait when the monster heads for a party member within
            // their own range: it comes into range by itself - the ranger walked towards the
            // moles (2026-11-17).
            const onMember = !melee && victimName === null && target.target && target.target !== character.name &&
                party.memberNames().includes(target.target) && get_player(target.target) &&
                util.distanceTo(get_player(target.target)) < (character.range || 0) * 0.9;
            // A class mode may want us to meet them instead (warrior Agitate "stream": while
            // Agitate is on cooldown we walk to them, player request 2026-11-18).
            const meet = cls.meetIncoming && cls.meetIncoming();
            if (!meet && (onMember || target.target === character.name) && (def.range || 0) <= (character.range || 0) + 10) {
                if (is_moving(character) && !(typeof smart !== "undefined" && smart.moving)) stop();
                util.status("waiting for " + target.mtype, "orange");
                return;
            }
            util.status("moving to " + target.mtype, "orange");
            if (cls.move && cls.move(target)) return; // e.g. Warrior Dash closed the gap
            // Aggressive ones: only up to our range, not into them (and past their friends).
            // The point follows the monster (it was only set once, when we stood still).
            ftr.moveTo(targeting.aggressive(target) ? targeting.standPoint(target) : util.xy(target));
            return;
        }

        const kiting = ftr.kiteStep(target) || ftr.spacingStep(target);
        if (!kiting) util.status(cls.name + ": " + target.mtype, "green");
        if (cls.fight(target)) return;
        ftr.strike.attack(target); // fires at once, or the moment the cooldown ends
    }

    Object.assign(ftr, {
        handleCombat: handleCombat,
    });
};
