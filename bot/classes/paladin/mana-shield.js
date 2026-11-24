// =====================================================================
// classes/paladin/mana-shield.js - Mana Shield (toggle): damage drains MP instead of HP. On when HP gets low (onBelow)
// while MP is plentiful (minMp), off again once HP recovered (offAbove) or MP runs low.
// Interface: createManaShield(deps, options) -> { tick() }
//   deps: game, log
//   options: the manaShield block (null = off), see DEFAULTS
// =====================================================================

const DEFAULTS = {
    onBelow: 0.35, offAbove: 0.7, minMp: 0.25,
};

module.exports = function createManaShield(deps, options) {
    const game = deps.game;
    const s = options ? Object.assign({}, DEFAULTS, options) : null;

    function tick() {
        const me = game.me(), G = game.data();
        if (!s || !G.skills.mshield || game.onCooldown("mshield")) return;
        const on = !!(me.s && me.s.mshield);
        const hp = game.hpRatio(), mp = game.mpRatio();
        if (!on && hp < s.onBelow && mp > s.minMp) {
            game.useSkill("mshield").catch(function () {});
            deps.log("paladin", "Mana Shield on", "yellow");
        } else if (on && (hp > s.offAbove || mp < s.minMp)) {
            game.useSkill("mshield").catch(function () {});
            deps.log("paladin", "Mana Shield off", "white");
        }
    }

    return { tick: tick };
};
