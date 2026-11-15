// =====================================================================
// bot_fighter – the main loop for every non-merchant character.
//
// Each tick:
//   1. dead?              -> respawn
//   2. class survival     -> e.g. Paladin self-heal; else potions
//   3. loot
//   4. supply             -> merchant handover / pickup / self-resupply
//   5. class support      -> e.g. Priest heals a party member
//   6. combat             -> pick target, class skills, basic attack, move
//
// Class modules provide: name, survive(), support(), fight(target).
// survive/support return true when they used the action for this tick;
// fight returns true when the basic attack should be skipped.
// =====================================================================

module.exports = function createFighter(ctx, cls) {
    const config = ctx.config;
    const util = ctx.util;
    const targeting = ctx.targeting;
    const supply = ctx.supply;

    let running = false;
    let lastRespawnTry = 0;

    function handleDeath() {
        if (!character.rip) return false;
        util.status("dead - waiting to respawn", "red");
        if (Date.now() - lastRespawnTry > 5000) {
            lastRespawnTry = Date.now();
            respawn().catch(function () {}); // only succeeds once the death timer ran out
        }
        return true;
    }

    function handlePotions() {
        if (is_on_cooldown("use_hp")) return; // HP and MP potions share a cooldown
        if (util.hpRatio() < config.combat.potionHpBelow) use_skill("use_hp").catch(function () {});
        else if (util.mpRatio() < config.combat.potionMpBelow) use_skill("use_mp").catch(function () {});
    }

    function travel(destination, label) {
        util.status(label, "yellow");
        if (!is_moving(character)) {
            smart_move(destination).catch(function (e) {
                util.log("move", "route to " + JSON.stringify(destination) + " failed: " + util.errReason(e), "red");
            });
        }
    }

    function handleCombat() {
        const farm = targeting.currentFarm();
        const target = targeting.pick(farm.monster);

        if (!target) {
            travel(farm.monster, "searching " + farm.monster);
            return;
        }

        if (get_targeted_monster() !== target) change_target(target);

        if (!is_in_range(target)) {
            util.status("moving to " + target.mtype, "orange");
            // Direct line when possible, pathfinding otherwise (xmove does both)
            if (!is_moving(character)) xmove(target.real_x, target.real_y);
            return;
        }

        util.status(cls.name + ": " + target.mtype, "green");
        if (cls.fight(target)) return;
        if (can_attack(target)) attack(target).catch(function () {});
    }

    function tick() {
        if (handleDeath()) return;
        if (!cls.survive()) handlePotions();
        loot();
        if (supply.tick() === "busy") return;
        if (cls.support()) return;
        handleCombat();
    }

    async function loop() {
        running = true;
        util.log("bot", "fighter started (" + cls.name + ")", "green");
        while (running) {
            try {
                tick();
            } catch (e) {
                util.log("bot", "tick error: " + util.errReason(e), "red");
            }
            await sleep(config.tickMs);
        }
    }

    return {
        start: function () { loop(); },
        stop: function () { running = false; },
    };
};
