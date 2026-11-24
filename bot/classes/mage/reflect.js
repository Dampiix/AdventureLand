// =====================================================================
// classes/mage/reflect.js - Reflective Shield (level 60; 540 MP, cooldown 30 s, range 320): +20 % chance to bounce
// MAGICAL hits for 5 s. On the member (or ourselves) with the most magical damage coming in from the monsters targeting
// it - the tank in a party, ourselves when solo - while our MP stays above keepMp after the cast.
// Interface: createReflect(deps, options) -> { tick() }
//   deps:    game (lib/game.js), members() -> party member names, log(tag, text, color)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    keepMp: 0.25,     // our MP share left after the cast
    minAttack: 100,   // only for at least this much magical attack on the target
};

module.exports = function createReflect(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function magicalIncoming(name) {
        const G = game.data();
        let sum = 0;
        Object.values(game.entities()).forEach(function (m) {
            if (!m || m.type !== "monster" || m.dead || m.target !== name) return;
            const d = G.monsters[m.mtype] || {};
            if ((m.damage_type || d.damage_type) === "magical") sum += m.attack || d.attack || 0;
        });
        return sum;
    }
    function tick() {
        const me = game.me(), G = game.data();
        if (!o.enabled || me.level < (G.skills.reflection.level || 60) || !game.canCast("reflection")) return;
        if ((me.mp - (G.skills.reflection.mp || 540)) / Math.max(1, me.max_mp) < (o.keepMp || 0.25)) return;
        let best = null, bestIn = 0;
        [me.name].concat(deps.members()).forEach(function (name) {
            const p = name === me.name ? me : game.player(name);
            if (!p || p.rip || (p.s && p.s.reflection)) return;
            if (p !== me && !game.inRange(p, "reflection")) return;
            const inc = magicalIncoming(name);
            if (inc > bestIn) { bestIn = inc; best = name; }
        });
        if (!best || bestIn < (o.minAttack || 100)) return;
        game.useSkill("reflection", best).catch(function () {});
        deps.log("mage", "Reflective Shield on " + (best === me.name ? "myself" : best) + " (" + Math.round(bestIn) + " magical attack on it)", "white");
    }

    return { tick: tick };
};
