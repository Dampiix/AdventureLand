// =====================================================================
// classes/ranger/three-shot.js - 3-Shot (level 60, needs a bow) on three monsters, in range and never another player's
// monster, a damage-return one or a no-area one (Giga Crab), in this order:
//   1. ones on us or a member (no extra fear)
//   2. ones the shot kills outright (no fear either)
//   3. free ones of our target's kind while fear has room for their damage type (each takes a slot of its type)
// 3-Shot shares the attack cooldown: it goes to the strike loop like the basic attack and replaces it.
// Interface: createThreeShot(deps, options) -> { fight(target) -> true when it took the attack }
//   deps: game, members(), hitMultiplier(def, type, attacker), tooSpiky(m), noArea(m), damageTypeOf(m), fearRoom(type),
//         distanceTo(e), strikeSkill(name, targets)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    mpReserveRatio: 0.3,   // MP share kept after the shot
};

module.exports = function createThreeShot(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function targets(target) {
        const me = game.me(), G = game.data();
        const names = deps.members();
        if (!names.includes(me.name)) names.push(me.name);
        const mult = (G.skills["3shot"] && G.skills["3shot"].damage_multiplier) || 0.7;
        const kills = function (e) {
            const d = G.monsters[e.mtype] || {};
            return (me.attack || 0) * 0.9 * mult * deps.hitMultiplier(d, "physical", me) >= e.hp;
        };
        const inReach = Object.values(game.entities()).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.visible && game.inRange(e, "3shot") &&
                !deps.tooSpiky(e) && (!e.target || names.includes(e.target)) &&
                !deps.noArea(e); // never the Giga Crab in a multi-shot
        });
        const onUs = inReach.filter(function (e) { return !!e.target; });
        const oneShot = inReach.filter(function (e) { return !e.target && kills(e); });
        const room = {};
        const free = inReach.filter(function (e) {
            if (e.target || kills(e) || !target || e.mtype !== target.mtype) return false;
            const t = deps.damageTypeOf(e);
            if (room[t] === undefined) room[t] = deps.fearRoom(t);
            if (room[t] <= 0) return false;
            room[t] -= 1;
            return true;
        }).sort(function (a, b) { return deps.distanceTo(a) - deps.distanceTo(b); });
        const list = onUs.concat(oneShot, free).slice(0, 3);
        return list.length >= 3 ? list : null;
    }

    function fight(target) {
        const me = game.me(), G = game.data();
        const reserve = me.max_mp * o.mpReserveRatio;
        const s3 = G.skills["3shot"];
        if (s3 && me.level >= (s3.level || 0) && [].concat(s3.wtype || []).includes(game.mainhandType()) &&
            game.mpLeftAfter("3shot") >= reserve) {
            const group = targets(target);
            if (group) {
                deps.strikeSkill("3shot", group);
                return true; // 3-Shot replaces the basic attack
            }
        }
        return false;
    }

    return { fight: fight };
};
