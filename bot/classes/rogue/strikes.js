// =====================================================================
// classes/rogue/strikes.js - the rogue's extra strikes in a fight, keeping the MP reserve:
//   Quick Stab (dagger in the mainhand) / Quick Punch (fist) between the normal attacks - the mainhand decides which;
//   Mental Burst (needs 64 INT) to finish a target - a kill turns its damage into mana;
//   A Poisonous Touch (consumes a Poison Sack) on long fights (targets needing minHits+ of our hits).
// Stacked Damage is passive (+1 per hit on the same target, up to +2000). Weapon requirements via game.canCast.
// Interface: createStrikes(deps, options) -> { fight(target) }
//   deps: game, countItem(name), reserve() -> MP to keep
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    mentalBurst: true,
    poisonCoat: { enabled: true, minHits: 40 },
};

module.exports = function createStrikes(deps, options) {
    const game = deps.game;
    const c = Object.assign({}, DEFAULTS, options || {});

    function fight(target) {
        const me = game.me(), G = game.data();
        const res = deps.reserve();
        ["quickstab", "quickpunch"].forEach(function (s) {
            if (game.canCast(s) && game.mpLeftAfter(s) >= res && game.inRange(target, s)) game.useSkill(s, target).catch(function () {});
        });
        if (c.mentalBurst && (me.int || 0) >= ((G.skills.mentalburst.requirements || {}).int || 0) &&
            game.canCast("mentalburst") && target.hp <= (me.attack || 0) * (G.skills.mentalburst.damage_multiplier || 0.6) * 0.8) {
            game.useSkill("mentalburst", target).catch(function () {});
        }
        const p = c.poisonCoat || {};
        if (p.enabled && target.hp > (me.attack || 1) * (p.minHits || 40) && deps.countItem("poison") > 0 &&
            game.canCast("pcoat") && game.mpLeftAfter("pcoat") >= res && !(me.s && me.s.poisonous)) {
            game.useSkill("pcoat").catch(function () {});
        }
    }

    return { fight: fight };
};
