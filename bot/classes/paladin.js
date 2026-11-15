// =====================================================================
// bot_class_paladin – Paladin skills.
//   survive: self-heal ("selfheal", 20 MP) below the configured HP ratio;
//            Mana Shield toggled on when HP is low and MP plentiful
//   support: Guardian's Oath (lvl 50) – take 35% of a hurt ally's damage
//            for 8 s; the HP the paladin loses restores its MP;
//            Cleansing Light (lvl 30) on an ally with a harmful condition
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

    // Mana Shield (toggle): damage drains MP instead of HP. On when HP gets low while
    // MP is plentiful, off again once HP recovered or MP runs low.
    function manaShield() {
        const s = c.manaShield;
        if (!s || !G.skills.mshield || is_on_cooldown("mshield")) return;
        const on = !!(character.s && character.s.mshield);
        const hp = util.hpRatio(), mp = util.mpRatio();
        if (!on && hp < s.onBelow && mp > s.minMp) {
            use_skill("mshield").catch(function () {});
            util.log("paladin", "Mana Shield on", "yellow");
        } else if (on && (hp > s.offAbove || mp < s.minMp)) {
            use_skill("mshield").catch(function () {});
            util.log("paladin", "Mana Shield off", "white");
        }
    }

    // Cleansing Light (lvl 30): lift harmful conditions (poison, curse, burn, stun, ...)
    // from an ally – not from ourselves.
    function cleanseTarget() {
        return ctx.party.memberNames().find(function (name) {
            if (name === character.name) return false;
            const p = get_player(name);
            if (!p || p.rip || !is_in_range(p, "cleansing_light")) return false;
            return Object.keys(p.s || {}).some(function (k) { return G.conditions[k] && G.conditions[k].cleansable; });
        }) || null;
    }

    return {
        name: "paladin",

        survive: function () {
            manaShield();
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
            if (c.useCleansingLight && util.canCast("cleansing_light")) {
                const name = cleanseTarget();
                if (name) {
                    use_skill("cleansing_light", name).catch(function () {});
                    util.log("paladin", "Cleansing Light on " + name, "green");
                }
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
