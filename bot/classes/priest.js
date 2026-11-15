// =====================================================================
// bot_class_priest – Priest skills.
//   survive: heal itself below selfHealBelow
//   support: heal the most hurt party member below healBelow
//            (heal shares the attack cooldown, so it replaces an attack)
// Works solo too: without a party the priest only looks at itself.
// =====================================================================

module.exports = function createPriest(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.priest;

    // Visible party members (and ourselves) with their HP ratio, most hurt first.
    function hurtMembers() {
        const names = Object.keys(get_party() || {});
        if (!names.includes(character.name)) names.push(character.name);
        return names
            .map(function (name) {
                const entity = name === character.name ? character : get_player(name);
                if (!entity || entity.rip) return null;
                return { entity: entity, ratio: entity.hp / entity.max_hp };
            })
            .filter(Boolean)
            .sort(function (a, b) { return a.ratio - b.ratio; });
    }

    // Returns true when this tick's action was used (heal cast or walking to the target).
    // On cooldown it returns `whileCooling`: support() blocks attacks then, survive() lets potions run.
    function tryHeal(entity, whileCooling) {
        if (is_on_cooldown("heal")) return whileCooling; // heal shares the attack cooldown
        if (entity !== character && !is_in_range(entity, "heal")) {
            if (!is_moving(character)) xmove(entity.real_x, entity.real_y);
            return true;
        }
        heal(entity).catch(function () {});
        return true;
    }

    return {
        name: "priest",

        survive: function () {
            if (util.hpRatio() < c.selfHealBelow) return tryHeal(character, false);
            return false;
        },

        support: function () {
            const worst = hurtMembers()[0];
            if (worst && worst.ratio < c.healBelow) return tryHeal(worst.entity, true);
            return false;
        },

        fight: function () { return false; },
    };
};
