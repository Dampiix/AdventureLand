// =====================================================================
// bot_class_ranger – Ranger skills.
//   fight: Hunter's Mark (+10% damage taken) on sturdy targets,
//          Supershot (1.5x, 30 s cooldown, needs a bow) on sturdy targets,
//          3-Shot (level 60, needs a bow) when 3+ monsters attack the team,
//          always keeping an MP reserve
// Bow requirements are checked by util.canCast via the skill's wtype.
// =====================================================================

module.exports = function createRanger(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.ranger;

    function mpLeftAfter(skill) {
        return character.mp - (G.skills[skill].mp || 0);
    }

    function sturdy(target) {
        return target.hp > character.attack * c.sturdyHits;
    }

    // Monsters currently attacking us or a party member, in range of 3-Shot.
    function teamAttackers() {
        const names = ctx.party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.visible && names.includes(e.target) && is_in_range(e, "3shot");
        });
    }

    return {
        name: "ranger",

        survive: function () { return false; },
        support: function () { return false; },

        fight: function (target) {
            const reserve = character.max_mp * c.mpReserveRatio;

            if (util.canCast("3shot") && mpLeftAfter("3shot") >= reserve) {
                const group = teamAttackers();
                if (group.length >= 3) {
                    use_skill("3shot", group.slice(0, 3)).catch(function () {});
                    return true; // 3-Shot replaces the basic attack
                }
            }
            if (sturdy(target) && !(target.s && target.s.marked) &&
                util.canCast("huntersmark") && mpLeftAfter("huntersmark") >= reserve) {
                use_skill("huntersmark", target).catch(function () {});
            }
            if (sturdy(target) && util.canCast("supershot") && mpLeftAfter("supershot") >= reserve) {
                use_skill("supershot", target).catch(function () {});
            }
            return false;
        },
    };
};
