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
    // A move promise rejects when the next move interrupts it: swallow it (the log filled with "{}", 2026-11-18).
    function quiet(p) { if (p && p.catch) p.catch(function () {}); return p; }
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

    // Assassin's Smoke as an escape (player idea 2026-11-18): the monsters lose us, we stop
    // attacking (a hit would show us again), walk to a quiet spot - no monster within
    // smokeClear px - and drink there until smokeUntil of max HP, then fight on.
    let hiding = false, hideSpot = null, hideSince = 0, lastUnhide = 0;
    function invisible() {
        return !!(character.s && character.s.invis);
    }
    function quietSpot() {
        const me = util.xy(character);
        const monsters = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead;
        }).map(util.xy);
        const clear = c.smokeClear || 200;
        let best = null, bestD = Infinity;
        for (const r of [150, 220, 300, 400]) {
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
                if (monsters.some(function (p) { return Math.hypot(p.x - x, p.y - y) < clear; })) continue;
                if (r < bestD) { bestD = r; best = { x: x, y: y }; }
            }
            if (best) break; // the nearest ring with a quiet point
        }
        return best;
    }
    function hide() {
        if (!hiding) return false;
        const done = util.hpRatio() >= (c.smokeUntil || 0.6) || (!invisible() && Date.now() - hideSince > 3000) ||
            Date.now() - hideSince > 60 * 1000;
        if (done) {
            hiding = false;
            util.log("rogue", "back to the fight at " + Math.round(util.hpRatio() * 100) + "% HP", "green");
            return false;
        }
        if (!hideSpot || (!is_moving(character) && util.distanceTo(hideSpot) > 30 &&
            Object.values(parent.entities || {}).some(function (e) { return e && e.type === "monster" && !e.dead && util.distanceTo(e) < (c.smokeClear || 200); }))) {
            hideSpot = quietSpot();
            if (hideSpot) quiet(xmove(hideSpot.x, hideSpot.y));
        }
        util.status("smoke: hiding " + Math.round(util.hpRatio() * 100) + "%", "orange");
        return true;
    }

    return {
        name: "rogue",

        always: function () {
            swiftness();
            // In a party, following the leader: show ourselves again once we are done hiding
            // (player request 2026-11-18) - invisible, the priest can't see or heal us and the
            // leader waits for us. Alone the smoke lasts until we attack, as before.
            if (!hiding && invisible() && ctx.party.isMember && !(ctx.party.detached && ctx.party.detached()) &&
                Date.now() - lastUnhide > 3000) {
                lastUnhide = Date.now();
                stop("invis").catch(function () {});
                util.log("rogue", "visible again for the party", "white");
            }
        },

        survive: function () {
            // Assassin's Smoke: monsters lose us (its cooldown starts when we show again).
            if (!hiding && c.smokeBelow && util.hpRatio() < c.smokeBelow && onMe().length && util.canCast("invis") && !invisible()) {
                use_skill("invis").catch(function () {});
                hiding = true;
                hideSpot = null;
                hideSince = Date.now();
                util.log("rogue", "Assassin's Smoke at " + Math.round(util.hpRatio() * 100) + "% HP - hiding", "yellow");
            }
            return false; // potions as usual
        },

        // While hiding we neither fight nor pull: the combat waits until we are healed up.
        support: function () { return hide(); },

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
