// =====================================================================
// classes/warrior/common.js - shared helpers of the warrior's parts: MP reserve, monsters on allies and around us, damage-return check, hitbox distance, pack middle, on the way.
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

    function reserve() {
        return game.me().max_mp * (c.mpReserveRatio || 0);
    }

    // Monsters attacking a party member other than us, nearest first.
    function onOthers() {
        const names = deps.party.memberNames().filter(function (n) { return n !== game.me().name; });
        if (!names.length) return [];
        return Object.values(game.entities())
            .filter(function (e) { return e && e.type === "monster" && !e.dead && e.visible && names.includes(e.target); })
            .sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
    }

    // Monsters standing within `range` of us (for Cleave / Stomp).
    function around(range, attackingOnly) {
        const names = deps.party.memberNames();
        if (!names.includes(game.me().name)) names.push(game.me().name);
        return Object.values(game.entities()).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible || util.distanceTo(e) > range) return false;
            if (util.tooSpiky(deps.config, e)) return false; // Cleave/Stomp would hit a porcupine
            if (attackingOnly && !names.includes(e.target)) return false;
            // Never pull monsters that fight other players.
            return !e.target || names.includes(e.target);
        });
    }

    // Cleave and Stomp hit everything around us: never with a damage-return monster in reach.
    function spikyNear(range) {
        return Object.values(game.entities()).some(function (e) {
            // Any damage return counts here: Cleave/Stomp hit them all, each one returns.
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range + 20 &&
                ((game.data().monsters[e.mtype] || {}).dreturn > 0 || util.tooSpiky(deps.config, e));
        });
    }

    const onMe = util.attackersOnMe;

    // Hitbox edge to edge, like the server's splash check.
    function edge(a, b) {
        try { return game.entityDistance(a, b); } catch (e) {
            return Math.max(0, Math.hypot(a.real_x - b.real_x, a.real_y - b.real_y) - 20);
        }
    }

    function centerOf(list) {
        let x = 0, y = 0;
        list.forEach(function (m) { const p = util.xy(m); x += p.x; y += p.y; });
        return { x: x / list.length, y: y / list.length };
    }

    // On the way (a path walk: an event call, a spot change, following the leader - 2026-11-22): no splash weapons.
    // Leaving the Giant Scorpions for the Phoenix, the scorpions followed, the warrior defended himself with the
    // Lolipops on - their splash could pull the Fire Spirits along the way, and they slow us down too.
    function travelling() {
        return !!(game.path() && game.path().moving);
    }

    Object.assign(w, {
        reserve: reserve,
        onOthers: onOthers,
        around: around,
        spikyNear: spikyNear,
        onMe: onMe,
        edge: edge,
        centerOf: centerOf,
        travelling: travelling,
    });
};
