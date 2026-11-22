// =====================================================================
// bot_class_ranger – Ranger skills.
//   fight: Hunter's Mark (+10% damage taken) on sturdy targets,
//          Supershot (1.5x, 30 s cooldown, needs a bow) on sturdy targets,
//          3-Shot (level 60, needs a bow) on 3 monsters: ones on the team, ones it kills, free ones while fear allows,
//          Poison Arrow (consumes a Poison Sack) on sturdy targets,
//          always keeping an MP reserve
// Bow requirements are checked by util.canCast via the skill's wtype.
// =====================================================================

module.exports = function createRanger(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.ranger;

    const mpLeftAfter = ctx.util.mpLeftAfter;

    function sturdy(target) {
        return target.hp > character.attack * c.sturdyHits;
    }

    // 3-Shot targets (after earthiverse, player decision 2026-11-21), in range and never another
    // player's monster or a damage-return one:
    //   1. ones on us or a member (no extra fear)
    //   2. ones the shot kills outright (no fear either)
    //   3. free ones of our target's kind while fear has room for their damage type (each one
    //      takes a slot of its type)
    // Up to three, in that order; null when fewer than three qualify.
    function threeShotTargets(target) {
        const names = ctx.party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        const mult = (G.skills["3shot"] && G.skills["3shot"].damage_multiplier) || 0.7;
        const kills = function (e) {
            const d = G.monsters[e.mtype] || {};
            return (character.attack || 0) * 0.9 * mult * util.hitMultiplier(d, "physical", character) >= e.hp;
        };
        const inReach = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.visible && is_in_range(e, "3shot") &&
                !util.tooSpiky(ctx.config, e) && (!e.target || names.includes(e.target));
        });
        const onUs = inReach.filter(function (e) { return !!e.target; });
        const oneShot = inReach.filter(function (e) { return !e.target && kills(e); });
        const room = {};
        const free = inReach.filter(function (e) {
            if (e.target || kills(e) || !target || e.mtype !== target.mtype) return false;
            const t = util.damageTypeOf(e);
            if (room[t] === undefined) room[t] = util.fearRoom(t);
            if (room[t] <= 0) return false;
            room[t] -= 1;
            return true;
        }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
        const list = onUs.concat(oneShot, free).slice(0, 3);
        return list.length >= 3 ? list : null;
    }

    return {
        name: "ranger",

        survive: function () { return false; },
        support: function () { return false; },

        fight: function (target) {
            const reserve = character.max_mp * c.mpReserveRatio;

            // 3-Shot shares the attack cooldown: it goes to the strike loop like the basic attack
            // (fired the moment the cooldown ends) instead of racing it from the tick (2026-11-21).
            const s3 = G.skills["3shot"];
            if (s3 && character.level >= (s3.level || 0) && [].concat(s3.wtype || []).includes(util.mainhandType()) &&
                mpLeftAfter("3shot") >= reserve) {
                const group = threeShotTargets(target);
                if (group) {
                    ctx.strike.skill("3shot", group);
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
            // Poison Arrow (consumes a Poison Sack): poisoned monsters attack 10% slower
            // and heal less.
            if (c.usePoisonArrow && sturdy(target) && !(target.s && target.s.poisoned) &&
                util.countItem("poison") > 0 && util.canCast("poisonarrow") && mpLeftAfter("poisonarrow") >= reserve) {
                use_skill("poisonarrow", target).catch(function () {});
            }
            return false;
        },
    };
};
