// =====================================================================
// bot_class_rogue – Rogue skills (player plan 2026-11-18: solo farmer and party helper).
//   always:  Rogue Swiftness (lvl 40, 45 min speed buff) on ourselves, and in a party on
//            every member in reach that lacks it
//   survive: Assassin's Smoke (invisible) when HP drops low with monsters on us - they
//            lose us; potions as usual
//   fight:   Quick Stab (dagger in the mainhand) / Quick Punch (fist) between the normal
//            attacks; Mental Burst (needs 64 INT) to finish a target - a kill turns its
//            damage into mana; A Poisonous Touch (consumes a Poison Sack) on long fights;
//            Fan of Knives (lvl 65, Knife Belt worn) with several monsters around
//   Stacked Damage is passive (+1 per hit on the same target, up to +2000 - server.js).
// Weapon requirements (dagger / fist) are checked by util.canCast via the skill's wtype;
// items, slots and INT here.
// =====================================================================

module.exports = function createRogue(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.rogue || {};

    function mpLeftAfter(skill) {
        return character.mp - ((G.skills[skill] && G.skills[skill].mp) || 0);
    }
    function reserve() {
        return character.max_mp * (c.mpReserveRatio || 0.25);
    }
    function onMe() {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === character.name;
        });
    }
    function wearsKnifeBelt() {
        const b = character.slots && character.slots.belt;
        const need = (G.skills.fanofknives.slot || []).find(function (s) { return s[0] === "belt"; });
        return !!(b && need && b.name === need[1]);
    }
    function hasRspeed(p) {
        return !!(p && p.s && p.s.rspeed);
    }

    // Rogue Swiftness: ourselves first, then party members in reach (it lasts 45 min).
    let lastSwift = 0;
    function swiftness() {
        if (!c.swiftness || Date.now() - lastSwift < 3000 || !util.canCast("rspeed")) return;
        if (mpLeftAfter("rspeed") < reserve()) return;
        let who = !hasRspeed(character) ? character : null;
        if (!who && ctx.party.enabled) {
            who = ctx.party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
                .find(function (p) { return p && !p.rip && !hasRspeed(p) && util.distanceTo(p) <= G.skills.rspeed.range; }) || null;
        }
        if (!who) return;
        lastSwift = Date.now();
        use_skill("rspeed", who).catch(function () {});
    }

    return {
        name: "rogue",

        always: function () {
            swiftness();
        },

        survive: function () {
            // Assassin's Smoke: monsters lose us (its cooldown starts when we show again).
            if (c.smokeBelow && util.hpRatio() < c.smokeBelow && onMe().length && util.canCast("invis") &&
                !(character.s && character.s.invis)) {
                use_skill("invis").catch(function () {});
                util.log("rogue", "Assassin's Smoke at " + Math.round(util.hpRatio() * 100) + "% HP", "yellow");
            }
            return false; // potions as usual
        },

        support: function () { return false; },

        fight: function (target) {
            const res = reserve();
            // Fan of Knives: five knives on monsters around us (Knife Belt in the belt slot).
            if (c.fanFrom && util.canCast("fanofknives") && wearsKnifeBelt() && mpLeftAfter("fanofknives") >= res) {
                const near = Object.values(parent.entities || {}).filter(function (e) {
                    return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= G.skills.fanofknives.range &&
                        (!e.target || e.target === character.name) && !util.tooSpiky(ctx.config, e);
                });
                if (near.length >= c.fanFrom) use_skill("fanofknives").catch(function () {});
            }
            // Quick Stab / Quick Punch between the normal attacks (the mainhand decides which).
            ["quickstab", "quickpunch"].forEach(function (s) {
                if (util.canCast(s) && mpLeftAfter(s) >= res && is_in_range(target, s)) use_skill(s, target).catch(function () {});
            });
            // Mental Burst to finish: a kill converts its damage into mana.
            if (c.mentalBurst && (character.int || 0) >= ((G.skills.mentalburst.requirements || {}).int || 0) &&
                util.canCast("mentalburst") && target.hp <= (character.attack || 0) * (G.skills.mentalburst.damage_multiplier || 0.6) * 0.8) {
                use_skill("mentalburst", target).catch(function () {});
            }
            // A Poisonous Touch on long fights (a boss): consumes a Poison Sack.
            const p = c.poisonCoat || {};
            if (p.enabled && target.hp > (character.attack || 1) * (p.minHits || 40) && util.countItem("poison") > 0 &&
                util.canCast("pcoat") && mpLeftAfter("pcoat") >= res && !(character.s && character.s.poisonous)) {
                use_skill("pcoat").catch(function () {});
            }
            return false; // basic attack as well
        },
    };
};
