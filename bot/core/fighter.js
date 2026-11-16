// =====================================================================
// bot_fighter – the main loop for every non-merchant character.
//
// Each tick:
//   1. dead?              -> respawn
//   2. class survival     -> e.g. Paladin self-heal; else potions
//   3. loot
//   4. party management   -> invites / accept / leave wrong party
//   4b. gear              -> send equipment wishes, equip upgrades
//   5. supply             -> merchant handover / pickup / self-resupply
//   5a. events            -> join events, travel to / search world bosses
//   5b. hunts             -> Daisy trips, turn in / take Monster Hunts
//   6. formation          -> members stay within the leash of the leader
//   7. class support      -> e.g. Priest heals, Mage energizes
//   8. combat             -> pick target, class skills, basic attack, move
//
// Class modules provide: name, survive(), support(), fight(target), and
// optionally move(target) – called while walking (target null on a route);
// true means it moved us itself this tick (e.g. Warrior Dash).
// survive/support return true when they used the action for this tick;
// fight returns true when the basic attack should be skipped.
// =====================================================================

module.exports = function createFighter(ctx, cls) {
    const config = ctx.config;
    const util = ctx.util;
    const targeting = ctx.targeting;
    const supply = ctx.supply;
    const party = ctx.party;

    let running = false;
    let lastRespawnTry = 0;
    let lastFarm = null;   // remembered for the leader broadcast while busy
    let lastTarget = null;

    // A priest with an Essence of Life is on its way: don't respawn in town meanwhile.
    let reviveWaitUntil = 0;
    ctx.comms.on("revive_wait", function () { reviveWaitUntil = Date.now() + 30 * 1000; });

    let deathReported = false;
    function handleDeath() {
        if (!character.rip) { deathReported = false; return false; }
        if (!deathReported) {
            deathReported = true;
            // Blame the killer, not the farm target: a death on the way (e.g. vampire rats at
            // the underground entrance on the way to the CGoos) must not close the farm spot.
            // Monsters on us first, else the nearest one close by; the farm target only when
            // one of its kind is near.
            const near = Object.values(parent.entities || {}).filter(function (e) {
                return e && e.type === "monster" && !e.dead && G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative;
            }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
            const onMe = near.find(function (e) { return e.target === character.name; });
            const close = near.find(function (e) { return util.distanceTo(e) < 250; });
            const farmType = lastFarm && !lastFarm.any ? lastFarm.monster : null;
            const farmNear = farmType && near.find(function (e) { return e.mtype === farmType && util.distanceTo(e) < 500; });
            const monster = onMe ? onMe.mtype : close ? close.mtype : farmNear ? farmType : null;
            if (monster) {
                if (party.isMember) ctx.comms.send(config.leader, "died", { monster: monster });
                else targeting.diedAt(monster, character.name);
            }
        }
        if (Date.now() < reviveWaitUntil) {
            util.status("dead - a priest is reviving me", "yellow");
            return true;
        }
        util.status("dead - waiting to respawn", "red");
        if (Date.now() - lastRespawnTry > 5000) {
            lastRespawnTry = Date.now();
            respawn().catch(function () {}); // only succeeds once the death timer ran out
        }
        return true;
    }

    // HP and MP potions share one cooldown (2 s). Below the thresholds they are urgent; on
    // top of that a potion is drunk as soon as a whole one's worth is missing (combat.
    // potionWhenMissing) – waiting for 45 % let a solo warrior sink against the Phoenix,
    // one sip per dip below the line instead of one every cooldown (2026-11-16).
    function potionGives(kind) {
        const name = util.potionNames(config.potions)[kind];
        const g = G.items[name] && G.items[name].gives;
        const e = g && g.find(function (x) { return x[0] === kind; });
        return e ? e[1] : (kind === "hp" ? 200 : 300);
    }
    // A living priest in our party close by (or we are one): it heals, so potions are only
    // an emergency (combat.withHealer) – solo we drink on every cooldown.
    function healerNear() {
        if (character.ctype === "priest") return true;
        if (!party.enabled) return false;
        return party.memberNames().some(function (n) {
            if (n === character.name) return false;
            const p = get_player(n);
            return !!p && !p.rip && p.ctype === "priest" && util.distanceTo(p) < 600;
        });
    }
    function handlePotions() {
        if (is_on_cooldown("use_hp")) return;
        const c = healerNear() ? Object.assign({}, config.combat, config.combat.withHealer || {}) : config.combat;
        const hpMissing = character.max_hp - character.hp;
        const mpMissing = character.max_mp - character.mp;
        if (util.hpRatio() < c.potionHpBelow) use_skill("use_hp").catch(function () {});
        else if (util.mpRatio() < c.potionMpBelow) use_skill("use_mp").catch(function () {});
        else if (c.potionWhenMissing && hpMissing >= potionGives("hp")) use_skill("use_hp").catch(function () {});
        else if (c.potionWhenMissing && mpMissing >= potionGives("mp")) use_skill("use_mp").catch(function () {});
    }

    function travel(destination, label) {
        util.status(label, "yellow");
        if (!is_moving(character)) {
            smart_move(destination).catch(function (e) {
                util.log("move", "route to " + JSON.stringify(destination) + " failed: " + util.errReason(e), "red");
            });
        } else if (cls.move) {
            cls.move(null); // e.g. Warrior Charge on the way
        }
    }

    function handleCombat() {
        const farm = targeting.currentFarm();
        const target = targeting.pick(farm);
        // Only time actually fighting counts for the crowded-spot check: running after a
        // monster that another player kills on the way is time without a target too.
        targeting.reportSearch(!!target && is_in_range(target));
        lastFarm = farm;
        lastTarget = target;

        if (!target) {
            if (party.idleFollow()) return; // party member: stay with the leader
            if (farm.any) { util.status("waiting for monsters (" + farm.source + ")", "white"); return; }
            travel(farm.dest || targeting.spotFor(farm.monster, farm.map) || farm.monster, "searching " + farm.monster);
            return;
        }

        if (get_targeted_monster() !== target) change_target(target);

        if (!is_in_range(target)) {
            util.status("moving to " + target.mtype, "orange");
            if (cls.move && cls.move(target)) return; // e.g. Warrior Dash closed the gap
            if (!is_moving(character)) util.moveToEntity(target);
            return;
        }

        util.status(cls.name + ": " + target.mtype, "green");
        if (cls.fight(target)) return;
        if (can_attack(target)) attack(target).catch(function () {});
    }

    function tick() {
        if (handleDeath()) return;
        if (!cls.survive()) handlePotions();
        if (cls.always) cls.always(); // every tick, also while a trip keeps the loop busy
        loot();
        party.manage();
        // Leader: share position every tick – also while searching, travelling or at Daisy,
        // so members never lose track (party.broadcast throttles itself).
        party.broadcast(lastFarm, lastTarget, ctx.events.current());
        ctx.gear.tick();
        if (supply.tick() === "busy") return;
        if (ctx.events.tick() === "busy") return;
        if (!ctx.events.current() && ctx.hunts.tick() === "busy") return; // no Daisy trips during events
        const ev = ctx.events.current();
        if (party.keepUp(!!(ev && ev.join))) return;
        if (cls.support()) return;
        handleCombat();
    }

    async function loop() {
        running = true;
        util.log("bot", "fighter started (" + cls.name + (party.enabled ? ", party " + (party.isLeader ? "leader" : "member") : ", solo") + ")", "green");
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
