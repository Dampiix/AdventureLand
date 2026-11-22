// =====================================================================
// bot_class_priest – Priest skills.
//   survive: heal itself below selfHealBelow
//   support: Party Heal (400 MP) when several members are hurt or one is
//            in danger; otherwise heal the most hurt member below healBelow
//            (heal shares the attack cooldown, so it replaces an attack)
//   fight:   Curse (400 MP, 5 s) on sturdy targets – they take 20% more
//            damage and deal 20% less; Dark Blessing (lvl 70, 900 MP, 60 s):
//            +25% damage for the party for 8 s on sturdy targets and bosses
//   absorb:  Absorb Sins (lvl 55, 200 MP) as an emergency: pulls every monster
//            off a member in danger when no tank (warrior/paladin) is close
//            enough to taunt – the priest heals itself meanwhile
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
        if (is_on_cooldown("heal")) {
            // The strike loop heals the moment the cooldown ends (2026-11-20) - only one we reach.
            if (whileCooling && (entity === character || is_in_range(entity, "heal"))) ctx.strike.heal(entity);
            return whileCooling; // heal shares the attack cooldown
        }
        if (entity !== character && !is_in_range(entity, "heal")) {
            if (!is_moving(character)) util.moveToEntity(entity);
            return true;
        }
        ctx.strike.heal(entity);
        return true;
    }

    // A member out of our sight below partyHealOne, from its heartbeat (fresh within 15 s) - Party
    // Heal reaches the whole party wherever it is (earthiverse, player decision 2026-11-21).
    function farMemberLow() {
        if (!ctx.party.enabled) return null;
        return ctx.party.memberNames().find(function (n) {
            if (n === character.name || get_player(n)) return false;
            let b = null;
            try { b = get("dmpx_beat:" + n); } catch (e) { /* storage unavailable */ }
            return !!b && Date.now() - b.at < 15000 && !b.rip && typeof b.hp === "number" && b.hp < (c.partyHealOne || 0.5);
        }) || null;
    }
    function tryPartyHeal(hurt) {
        if (!util.canCast("partyheal")) return false;
        const wounded = hurt.filter(function (m) { return m.ratio < c.partyHealBelow; }).length;
        const danger = hurt.length && hurt[0].ratio < c.partyHealDanger;
        // One member below partyHealOne is enough (party only: solo the normal heal does it).
        const oneLow = ctx.party.enabled && (hurt.some(function (m) { return m.entity !== character && m.ratio < (c.partyHealOne || 0.5); }) || !!farMemberLow());
        if (wounded < 2 && !(danger && ctx.party.enabled) && !oneLow) return false;
        use_skill("partyheal").catch(function () {});
        return true;
    }

    // Absorb Sins: a member (not the tank) is in danger with monsters on it and no tank
    // stands within Taunt range of it (dead, elsewhere, farming alone) – take them over.
    let lastAbsorbLog = 0;
    function tryAbsorb(hurt) {
        const a = c.absorb || {};
        if (!a.enabled || !ctx.party.enabled || !util.canCast("absorb")) return false;
        if (util.hpRatio() < (a.selfAbove || 0.6)) return false;
        const tankClasses = (ctx.config.targeting.teamSafety && ctx.config.targeting.teamSafety.tankClasses) || ["warrior", "paladin"];
        const tanks = ctx.party.memberNames()
            .map(function (n) { return n === character.name ? null : get_player(n); })
            .filter(function (p) { return p && !p.rip && tankClasses.includes(p.ctype); });
        const tauntRange = (G.skills.taunt && G.skills.taunt.range) || 200;
        const victim = hurt.find(function (m) {
            const p = m.entity;
            if (p === character || m.ratio >= (a.below || 0.35) || tankClasses.includes(p.ctype)) return false;
            if (util.distanceTo(p) > G.skills.absorb.range) return false;
            const onIt = Object.values(parent.entities || {}).some(function (e) {
                return e && e.type === "monster" && !e.dead && e.target === p.name;
            });
            if (!onIt) return false;
            return !tanks.some(function (t) { return Math.hypot(t.x - p.x, t.y - p.y) <= tauntRange; });
        });
        if (!victim) return false;
        use_skill("absorb", victim.entity).catch(function () {});
        if (Date.now() - lastAbsorbLog > 10000) {
            lastAbsorbLog = Date.now();
            util.log("priest", "Absorb Sins: monsters off " + victim.entity.name + " (" + Math.round(victim.ratio * 100) + "% HP, no tank near)", "yellow");
        }
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
        // Not next to a rage zone (2026-11-22): the warrior died 9 px from the big booboo zone, and the walk to his
        // gravestone would have taken the priest into it. He respawns in town instead.
        const boxes = ctx.targeting && ctx.targeting.rageBoxes ? ctx.targeting.rageBoxes(character.map) : [];
        const dp = util.xy(dead);
        const nearZone = boxes.find(function (z) {
            const b = z.b;
            return Math.hypot(Math.max(b[0] - dp.x, 0, dp.x - b[2]), Math.max(b[1] - dp.y, 0, dp.y - b[3])) < 150;
        });
        if (nearZone) {
            if (Date.now() - lastWaitSent > 60 * 1000) {
                lastWaitSent = Date.now();
                util.log("priest", "not reviving " + dead.name + ": the gravestone lies at the " + nearZone.type + " rage zone", "orange");
            }
            return false;
        }
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

        // Busy phases (following, waiting, trips): Party Heal and heals on members already in
        // range - never a step (2026-11-20). True when a heal is planned.
        supportInPlace: function () {
            const hurt = hurtMembers();
            if (tryPartyHeal(hurt)) return false;
            const worst = hurt.find(function (m) { return m.ratio < c.healBelow && (m.entity === character || is_in_range(m.entity, "heal")); });
            if (!worst) return false;
            ctx.strike.heal(worst.entity);
            return true;
        },

        support: function () {
            if (tryRevive()) return true;
            const hurt = hurtMembers();
            if (tryPartyHeal(hurt)) return false; // Party Heal is a skill: the heal/attack stays available
            tryAbsorb(hurt); // a skill too: the heal below still runs
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
            // Dark Blessing: worth its 900 MP on long fights (sturdy targets, bosses).
            const db = c.darkBlessing || {};
            const def = G.monsters[target.mtype] || {};
            if (db.enabled && util.canCast("darkblessing") &&
                character.mp - G.skills.darkblessing.mp >= character.max_mp * c.mpReserveRatio &&
                (def.cooperative || target.hp > character.attack * (db.sturdyHits || 10)) &&
                is_in_range(target)) {
                use_skill("darkblessing").catch(function () {});
                util.log("priest", "Dark Blessing on " + target.mtype, "yellow");
            }
            return false;
        },
    };
};
