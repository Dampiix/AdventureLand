// =====================================================================
// bot_class_paladin – Paladin skills.
//   survive: self-heal ("selfheal", 20 MP) below the configured HP ratio
//   support: Guardian's Oath (lvl 50) – take 35% of a hurt ally's damage
//            for 8 s; the HP the paladin loses restores its MP
//   fight:   Smash (lvl 10, 380 MP, needs a mace) on targets that take more
//            than a couple of hits, keeping an MP reserve for healing
// =====================================================================

module.exports = function createPaladin(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.paladin;

    function oathTarget() {
        let best = null;
        ctx.party.memberNames().forEach(function (name) {
            if (name === character.name) return;
            const p = get_player(name);
            if (!p || p.rip || (p.s && p.s.guardians_oath)) return;
            const ratio = p.hp / p.max_hp;
            if (ratio >= c.oathBelow || !is_in_range(p, "guardians_oath")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio };
        });
        return best;
    }

    return {
        name: "paladin",

        survive: function () {
            if (util.hpRatio() < c.selfHealBelow && util.canCast("selfheal")) {
                use_skill("selfheal").catch(function () {});
                return true;
            }
            return false;
        },

        support: function () {
            if (util.hpRatio() > 0.5 && util.canCast("guardians_oath")) {
                const t = oathTarget();
                if (t) use_skill("guardians_oath", t.name).catch(function () {});
            }
            return false;
        },

        fight: function (target) {
            const smash = G.skills.smash;
            if (c.useSmash && util.canCast("smash") &&
                character.mp - smash.mp >= c.mpReserve &&
                target.hp > character.attack * 2) {
                use_skill("smash", target).catch(function () {});
            }
            return false; // basic attack as well
        },
    };
};
