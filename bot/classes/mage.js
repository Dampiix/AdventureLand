// =====================================================================
// bot_class_mage – Mage skills.
//   support: Energize (lvl 20) – give mana to the party member that runs
//            lowest on MP (e.g. the priest), while we have plenty
//   fight:   basic attacks; Mana Burst (whole MP pool as damage) only when
//            enabled in config, because it empties the mage
// =====================================================================

module.exports = function createMage(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.mage;

    function energizeTarget() {
        let best = null;
        ctx.party.memberNames().forEach(function (name) {
            if (name === character.name) return;
            const p = get_player(name);
            if (!p || p.rip || !p.max_mp) return;
            const ratio = p.mp / p.max_mp;
            if (ratio >= c.energizeBelow) return;
            if (!is_in_range(p, "energize")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio };
        });
        return best;
    }

    return {
        name: "mage",

        survive: function () { return false; },

        support: function () {
            if (util.mpRatio() > c.energizeAbove && util.canCast("energize")) {
                const t = energizeTarget();
                if (t) use_skill("energize", t.name).catch(function () {});
            }
            return false; // Energize does not replace the attack
        },

        fight: function (target) {
            if (c.useBurst && util.canCast("burst") && util.mpRatio() > 0.95 &&
                target.hp > character.mp * G.skills.burst.ratio) {
                use_skill("burst", target).catch(function () {});
            }
            return false;
        },
    };
};
