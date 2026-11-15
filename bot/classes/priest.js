// =====================================================================
// bot_class_priest – Priest skills.
//   survive: heal itself below selfHealBelow
//   support: Party Heal (400 MP) when several members are hurt or one is
//            in danger; otherwise heal the most hurt member below healBelow
//            (heal shares the attack cooldown, so it replaces an attack)
//   fight:   Curse (400 MP, 5 s) on sturdy targets – they take 20% more
//            damage and deal 20% less
//   revive:  with an Essence of Life in the bag, a fallen member's gravestone
//            is healed to full and revived (the member waits for it)
// Works solo too: without a party the priest only looks at itself.
// =====================================================================

module.exports = function createPriest(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.priest;

    // Visible party members (and ourselves) with their HP ratio, most hurt first.
    function hurtMembers() {
        const names = ctx.party.memberNames();
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
            if (!is_moving(character)) util.moveToEntity(entity);
            return true;
        }
        heal(entity).catch(function () {});
        return true;
    }

    function tryPartyHeal(hurt) {
        if (!util.canCast("partyheal")) return false;
        const wounded = hurt.filter(function (m) { return m.ratio < c.partyHealBelow; }).length;
        const danger = hurt.length && hurt[0].ratio < c.partyHealDanger;
        if (wounded < 2 && !(danger && ctx.party.enabled)) return false;
        use_skill("partyheal").catch(function () {});
        return true;
    }

    // Revive (consumes an Essence of Life): heal a fallen member's gravestone to full,
    // then revive it. The dead fighter is told to wait instead of respawning in town.
    let lastWaitSent = 0;
    function tryRevive() {
        if (!c.useRevive || util.countItem("essenceoflife") < 1) return false;
        const dead = ctx.party.memberNames()
            .filter(function (n) { return n !== character.name; })
            .map(function (n) { return get_player(n); })
            .find(function (p) { return p && p.rip; });
        if (!dead) return false;
        if (Date.now() - lastWaitSent > 5000) {
            lastWaitSent = Date.now();
            ctx.comms.send(dead.name, "revive_wait", {});
        }
        if (!is_in_range(dead, "revive")) {
            if (!is_moving(character)) util.moveToEntity(dead);
            return true;
        }
        if (dead.hp < dead.max_hp) return tryHeal(dead, true);
        if (util.canCast("revive")) {
            use_skill("revive", dead.name).catch(function () {});
            util.log("priest", "reviving " + dead.name, "green");
        }
        return true;
    }

    return {
        name: "priest",

        survive: function () {
            if (util.hpRatio() < c.selfHealBelow) return tryHeal(character, false);
            return false;
        },

        support: function () {
            if (tryRevive()) return true;
            const hurt = hurtMembers();
            if (tryPartyHeal(hurt)) return false; // Party Heal is a skill: the heal/attack stays available
            const worst = hurt[0];
            if (worst && worst.ratio < c.healBelow) return tryHeal(worst.entity, true);
            return false;
        },

        fight: function (target) {
            if (c.useCurse && util.canCast("curse") &&
                character.mp - G.skills.curse.mp >= character.max_mp * c.mpReserveRatio &&
                target.hp > character.attack * 5 && !(target.s && target.s.cursed) &&
                is_in_range(target, "curse")) {
                use_skill("curse", target).catch(function () {});
            }
            return false;
        },
    };
};
