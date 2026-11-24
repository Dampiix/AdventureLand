// =====================================================================
// combat/strike-loop.js - the strike loop: attacks, skills and heals fired on time (the strike object the warrior uses), defending in place while busy.
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

    function msToAttack() {
        const n = parent.next_skill && parent.next_skill.attack;
        return n ? n - Date.now() : 0;
    }
    function pingComp() { return Math.min(150, Math.max(0, (character.ping || 0) * 0.9)); }
    function fire() {
        const i = ftr.strikeIntent;
        if (!i || Date.now() - i.at > 700 || character.rip) return false;
        if (msToAttack() > 0) return false;
        if (parent.is_disabled && parent.is_disabled(character)) return false;
        if (i.kind === "heal") {
            const p = i.name === character.name ? character : get_player(i.name);
            if (!p || p.rip || (p !== character && !is_in_range(p, "heal"))) return false;
            heal(p).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
            return true;
        }
        if (i.kind === "skill") {
            // A skill on the attack cooldown (3shot/5shot share it): fired by the same loop, or the
            // basic attack always took the cooldown first and 3-Shot only came now and then
            // (2026-11-21, giant scorpions: 4-5 on the warrior, the ranger shot one arrow).
            const ts = i.ids.map(function (id) { return parent.entities && parent.entities[id]; });
            if (ts.some(function (t) { return !t || t.dead || !is_in_range(t, i.name); })) { ftr.strikeIntent = null; return false; }
            if (character.mp < ((G.skills[i.name] && G.skills[i.name].mp) || 0)) { ftr.strikeIntent = null; return false; }
            use_skill(i.name, ts).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
            ftr.strikeIntent = null;
            return true;
        }
        const t = parent.entities && parent.entities[i.id];
        if (!t || t.dead || !is_in_range(t)) return false;
        if (targeting.doomed && targeting.doomed(t)) return false; // the next tick picks another
        attack(t).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
        if (i.after) { try { i.after(t); } catch (e) { /* bookkeeping only */ } }
        return true;
    }
    async function strikeLoop() {
        while (ftr.running) {
            let wait = 100;
            try {
                if (!fire()) {
                    const ms = msToAttack();
                    wait = ftr.strikeIntent && ms > 0 ? Math.min(200, Math.max(10, ms)) : 100;
                } else wait = 60;
            } catch (e) { /* next round */ }
            await sleep(wait);
        }
    }

    // Busy phases (waiting for the team, following, trips, events, Daisy): defend and heal in
    // place - only targets already in range, never a step (player decision 2026-11-20, from
    // earthiverse: his fight loop never moves, the move loop decides where to go). We had cut
    // all fighting there because fights kept the team from leaving a spot.
    function defendInPlace() {
        if (character.rip) return;
        // Waiting in place: still step away from what we can kite (2026-11-21) - not during a
        // smart_move (travel, search), which the step would cut off again and again.
        if (!(typeof smart !== "undefined" && smart.moving)) ftr.kiteStep(null);
        if (cls.supportInPlace && cls.supportInPlace()) return;
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        let best = null;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.target || !ours.includes(e.target)) return;
            if (!is_in_range(e) || util.tooSpiky(config, e)) return;
            if (targeting.doomed && targeting.doomed(e)) return; // dies to damage already in the air
            if (!best || e.hp < best.hp) best = e;
        });
        if (best) ftr.strike.attack(best);
    }

    Object.assign(ftr, {
        msToAttack: msToAttack,
        pingComp: pingComp,
        fire: fire,
        strikeLoop: strikeLoop,
        defendInPlace: defendInPlace,
    });
};
