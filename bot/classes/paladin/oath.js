// =====================================================================
// classes/paladin/oath.js - Guardian's Oath (level 50): take 35 % of a hurt ally's damage for 8 s; the HP the paladin
// loses restores its MP. On the most hurt member below oathBelow in range, while we are above half HP.
// Interface: createOath(deps, options) -> { tick() }
//   deps: game, members()
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    oathBelow: 0.5,   // allies below this HP ratio
};

module.exports = function createOath(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function oathTarget() {
        const me = game.me();
        let best = null;
        deps.members().forEach(function (name) {
            if (name === me.name) return;
            const p = game.player(name);
            if (!p || p.rip || (p.s && p.s.guardians_oath)) return;
            const ratio = p.hp / p.max_hp;
            if (ratio >= o.oathBelow || !game.inRange(p, "guardians_oath")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio };
        });
        return best;
    }
    function tick() {
        if (game.hpRatio() > 0.5 && game.canCast("guardians_oath")) {
            const t = oathTarget();
            if (t) game.useSkill("guardians_oath", t.name).catch(function () {});
        }
    }

    return { tick: tick };
};
