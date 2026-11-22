// =====================================================================
// bot_fighter – the main loop for every non-merchant character.
//
// Each tick:
//   1. dead?              -> respawn
//   2. class survival     -> e.g. Paladin self-heal; else potions
//   3. loot
//   4. party management   -> invites / accept / leave wrong party
//   4b. gear              -> send equipment wishes, equip upgrades
//   4c. Cavalry           -> cavalryTick: walk to a grown pack and call it
//   4d. rage zones        -> leaveRageZone (out of a failing zone), then
//                            keepClearOfZones (out to travel.rageMargin);
//                            path walks treat rage boxes as walls
//   5. supply             -> merchant handover / pickup / self-resupply
//   5a. events            -> join events, travel to / search world bosses
//   5b. hunts             -> Daisy trips, turn in / take Monster Hunts
//   6. formation          -> members follow the leader (party.keepUp) and
//                            the leader waits for the team (busyStep)
//   6b. kiting            -> kiteStep keeps us off monsters we can outrun
//   6c. toHealer          -> a hurt member walks into the healer's range;
//                            coverMembers: a healer leader stays with a
//                            member under attack
//   7. class support      -> e.g. Priest heals, Mage energizes
//   8. combat             -> pick target, class skills, basic attack, move
//                            (kiting / party spacing)
//
// Class modules provide: name, survive(), support(), fight(target), and
// optionally move(target) – called while walking (target null on a route);
// true means it moved us itself this tick (e.g. Warrior Dash).
// survive/support return true when they used the action for this tick;
// fight returns true when the basic attack should be skipped.
// =====================================================================

module.exports = function createFighter(ctx, cls) {
    // A move promise rejects when the next move interrupts it: swallow it (the log filled with "{}", 2026-11-18).
    const quiet = ctx.util.quiet;
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

    // Death analysis (2026-11-18: three deaths at level-1 bats the pack check called harmless):
    // the hits we took in the last 10 s (attacker, level, damage) and the potions drunk then go
    // to the log when we die. One socket listener for the page (reloads would stack them).
    const HIT_LOG_MS = 10 * 1000;
    // The listener lives on the game page and outlasts a bot reload: it holds the page window
    // itself (the old CODE frame's "parent" is null after a reload - every hit threw and the
    // log filled with "{}", 2026-11-18), and each load swaps the previous listener for its own.
    const PAGE = parent;
    try {
        if (PAGE.__dmpxHitFn) PAGE.socket.off("hit", PAGE.__dmpxHitFn);
        PAGE.__dmpxHits = PAGE.__dmpxHits || [];
        PAGE.__dmpxHitFn = function (d) {
            try {
                if (!d || !d.damage || !PAGE.character || d.id !== PAGE.character.id) return;
                const a = PAGE.entities && PAGE.entities[d.hid];
                PAGE.__dmpxHits.push({ t: Date.now(), dmg: d.damage, who: a ? a.mtype + " L" + (a.level || 1) : String(d.hid || "?") });
                util.noteHitTaken(d, a); // learned hit factor for the safety checks (2026-11-22)
                while (PAGE.__dmpxHits.length && Date.now() - PAGE.__dmpxHits[0].t > HIT_LOG_MS) PAGE.__dmpxHits.shift();
            } catch (e) { /* analysis only */ }
        };
        PAGE.socket.on("hit", PAGE.__dmpxHitFn);
    } catch (e) { /* no socket */ }
    // Damage meter (player request 2026-11-19): real damage per second from the game's "hit"
    // events - ours, and on the leader every party member's it sees. Logged every
    // config.meter.everyMs, "/dps" prints it now. Listener swapped on each load like the one above.
    const meterCfg = config.meter || {};
    try {
        if (PAGE.__dmpxDpsFn) PAGE.socket.off("hit", PAGE.__dmpxDpsFn);
        PAGE.__dmpxDps = PAGE.__dmpxDps || [];
        PAGE.__dmpxDpsFn = function (d) {
            try {
                if (!d || !d.damage || !PAGE.entities || !d.hid) return;
                const target = PAGE.entities[d.id];
                if (!target || target.type !== "monster") return; // damage on monsters only (no heals, no hits on us)
                PAGE.__dmpxDps.push({ t: Date.now(), who: String(d.hid), dmg: d.damage, kill: !!d.kill });
                const keep = (meterCfg.windowMs || 5 * 60 * 1000) + 5000;
                while (PAGE.__dmpxDps.length && Date.now() - PAGE.__dmpxDps[0].t > keep) PAGE.__dmpxDps.shift();
            } catch (e) { /* meter only */ }
        };
        PAGE.socket.on("hit", PAGE.__dmpxDpsFn);
    } catch (e) { /* no socket */ }
    const meterStart = Date.now();
    let lastMeterLog = Date.now();
    function meterReport(force) {
        const now = Date.now();
        if (!force && (!meterCfg.everyMs || now - lastMeterLog < meterCfg.everyMs)) return;
        lastMeterLog = now;
        const win = Math.min(meterCfg.windowMs || 5 * 60 * 1000, now - meterStart);
        if (win < 10 * 1000) return;
        const team = party.enabled ? party.memberNames() : [character.name];
        const per = {}; let total = 0, kills = 0;
        (PAGE.__dmpxDps || []).forEach(function (h) {
            if (now - h.t > win || !team.includes(h.who)) return;
            per[h.who] = (per[h.who] || 0) + h.dmg; total += h.dmg;
            if (h.kill) kills++;
        });
        const sec = win / 1000;
        const parts = Object.keys(per).sort(function (a, b) { return per[b] - per[a]; })
            .map(function (n) { return n.replace(/^Dmpx/, "") + " " + Math.round(per[n] / sec); });
        util.log("dps", (team.length > 1 ? "team " : "") + Math.round(total / sec) + "/s over " + Math.round(sec / 60 * 10) / 10 + " min" +
            (parts.length > 1 ? " (" + parts.join(", ") + ")" : "") + ", " + kills + " kills", "white");
    }
    BOT_DPS_REPORT = function () { meterReport(true); };
    const potSamples = []; // { t, hp, mp } potion counts, one per second
    function samplePotions() {
        const now = Date.now();
        if (potSamples.length && now - potSamples[potSamples.length - 1].t < 1000) return;
        const names = util.potionNames(config.potions);
        potSamples.push({ t: now, hp: util.countItem(names.hp), mp: util.countItem(names.mp) });
        while (potSamples.length && now - potSamples[0].t > HIT_LOG_MS + 2000) potSamples.shift();
    }
    function logDeathAnalysis() {
        const now = Date.now();
        const hits = (PAGE.__dmpxHits || []).filter(function (h) { return now - h.t <= HIT_LOG_MS; });
        const by = {};
        hits.forEach(function (h) { const b = by[h.who] = by[h.who] || { n: 0, dmg: 0 }; b.n++; b.dmg += h.dmg; });
        const parts = Object.keys(by).sort(function (a, b) { return by[b].dmg - by[a].dmg; })
            .map(function (k) { return k + ": " + by[k].n + " hits " + by[k].dmg; });
        const first = potSamples[0], last = potSamples[potSamples.length - 1];
        const pots = first && last ? (first.hp - last.hp) + " HP / " + (first.mp - last.mp) + " MP potions" : "potions unknown";
        const total = hits.reduce(function (s, h) { return s + h.dmg; }, 0);
        util.log("death", "last 10 s: " + total + " damage (" + (parts.join(", ") || "no hits seen") + "), " + pots, "red");
    }

    let deathReported = false;
    function handleDeath() {
        if (!character.rip) { deathReported = false; return false; }
        if (!deathReported) {
            deathReported = true;
            try { logDeathAnalysis(); } catch (e) { /* analysis only */ }
            if (ctx.events && ctx.events.onOwnDeath) { try { ctx.events.onOwnDeath(); } catch (e) { /* report only */ } }
            if (cls.onDeath) { try { cls.onDeath(); } catch (e) { /* class hook only */ } }
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
            // First choice: the kind that did the most damage in the last seconds (the hit log) -
            // 2026-11-19 the warrior died to mummies, but by the time it was reported the leader had
            // switched to booboos and the death closed the booboo spot.
            const dealt = {};
            const now = Date.now();
            (PAGE.__dmpxHits || []).forEach(function (h) {
                if (now - h.t > HIT_LOG_MS) return;
                const type = String(h.who || "").split(" ")[0];
                if (G.monsters[type]) dealt[type] = (dealt[type] || 0) + h.dmg;
            });
            const killer = Object.keys(dealt).sort(function (a, b) { return dealt[b] - dealt[a]; })[0] || null;
            const monster = killer || (onMe ? onMe.mtype : close ? close.mtype : farmNear ? farmType : null);
            if (monster) {
                // A member reports to the leader and notes it itself as well: farming on its own
                // (detached) it picks with its own records (2026-11-18: the warrior died three
                // times at the moles, the spot was closed only for the leader).
                if (party.isMember) ctx.comms.send(config.leader, "died", { monster: monster });
                targeting.diedAt(monster, character.name);
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
            return !!p && !p.rip && util.isHealer(p) && util.distanceTo(p) < 600;
        });
    }
    // HP lost per second over the last ~3 s, as a share of max HP.
    const hpTrail = [];
    function hpLossRate() {
        const now = Date.now();
        hpTrail.push({ t: now, hp: character.hp });
        while (hpTrail.length && now - hpTrail[0].t > 3000) hpTrail.shift();
        const first = hpTrail[0];
        const secs = (now - first.t) / 1000;
        return secs > 0.5 ? Math.max(0, first.hp - character.hp) / secs / character.max_hp : 0;
    }
    let lastDangerLog = 0;
    function handlePotions() {
        const loss = hpLossRate();
        if (is_on_cooldown("use_hp")) return;
        // Emergency brake (after earthiverse's avoid_death, player decision 2026-11-21): when the next
        // hits of everything on us (max damage, fear-scaled) reach our HP, an HP potion now - with a
        // healer near too, and even while Town channels.
        const danger = util.incomingDamage();
        if (danger > 0 && danger >= character.hp * (config.combat.dangerShare || 1) && character.hp < character.max_hp) {
            use_skill("use_hp").catch(function () {});
            if (Date.now() - lastDangerLog > 30 * 1000) {
                lastDangerLog = Date.now();
                util.log("combat", "danger: next hits up to " + Math.round(danger) + " vs " + Math.round(character.hp) + " HP - potion", "orange");
            }
            return;
        }
        // No potion while Town channels (it would cancel the teleport) - unless HP is critical.
        if (util.townChannel() && util.hpRatio() >= (config.combat.hpCriticalBelow || 0.3)) return;
        // With a healer potions are only an emergency - unless we lose HP fast: Jr. took the
        // warrior from full to dead in 10 s next to the priest, 2 HP potions drunk (2026-11-18).
        // Then the solo rules apply (a potion on every cooldown when one is missing).
        const fast = loss >= ((config.combat.withHealer || {}).fastLossPerSec || 0.06);
        const c = healerNear() && !fast ? Object.assign({}, config.combat, config.combat.withHealer || {}) : config.combat;
        const hpMissing = character.max_hp - character.hp;
        const mpMissing = character.max_mp - character.mp;
        const hp = util.hpRatio(), mp = util.mpRatio();
        // Without MP there is no attack (and no skill): MP first unless HP is critical.
        const mpEmpty = character.mp < Math.max(1, character.mp_cost || 0) * 3;
        // A whole MP potion fits (player decision 2026-11-21): MP before the HP top-up while HP is above
        // combat.mpFirstAboveHp (65 %: well above the 50 % rest line) - the warrior's own attacks drain
        // ~10 MP/s, one potion every ~30 s keeps him full.
        const mpFits = mpMissing >= potionGives("mp");
        const mpFirst = hp >= (c.mpFirstAboveHp !== undefined ? c.mpFirstAboveHp : 0.65);
        // combat.hpWhenFits (player test 2026-11-21): an HP potion whenever a whole one fits, MP only in
        // the gaps (or when MP is nearly empty) - the solo warrior still fell below the 50 % rest line.
        // Off with a healer near (withHealer.potionWhenMissing false).
        const hpFirst = c.hpWhenFits && c.potionWhenMissing && hpMissing >= potionGives("hp");
        if (hp < (c.hpCriticalBelow || 0.3)) use_skill("use_hp").catch(function () {});
        else if (hpFirst && !mpEmpty) use_skill("use_hp").catch(function () {});
        else if (mpEmpty || ((mp < c.potionMpBelow || mpFits) && (mpFirst || c.hpWhenFits))) use_skill("use_mp").catch(function () {});
        else if (hp < c.potionHpBelow) use_skill("use_hp").catch(function () {});
        else if (mp < c.potionMpBelow) use_skill("use_mp").catch(function () {});
        else if (c.potionWhenMissing && hpMissing >= potionGives("hp")) use_skill("use_hp").catch(function () {});
        // MP has its own rule (combat.mpTopUp: share of a potion that may be missing): mana
        // is healing for the priest and Cleave/3-Shot for the others – it stays topped up
        // also in the party, where HP potions are only an emergency (player decision 2026-11-17).
        else if (c.mpTopUp !== undefined ? mpMissing >= potionGives("mp") * c.mpTopUp : (c.potionWhenMissing && mpMissing >= potionGives("mp"))) use_skill("use_mp").catch(function () {});
    }

    // A target in sight ends the search walk: smart_move kept walking to the middle of the
    // spawn while we fought on the way – into the White Wolf pack (2026-11-17).
    // Only our own search walk is stopped: the way to a target behind a wall is a smart_move
    // too (xmove), and stopping that every tick left the team standing in town (2026-11-17).
    let searchWalk = 0;          // id of the running search walk, 0 = none
    let stoppedOnPurpose = false;
    function endSearchWalk() {
        if (!searchWalk || typeof smart === "undefined" || !smart.moving) return;
        searchWalk = 0;
        stoppedOnPurpose = true;
        stop();
    }

    // A new goal while still walking to an old one turns us around (2026-11-21: the ranger found
    // Dracul while the priest walked to the giant scorpions - it walked all the way there first and
    // only then towards the cave, and the members followed its old goal).
    let travelGoal = null;
    function sameGoal(a, b) {
        if (!a || !b) return false;
        if (typeof a === "string" || typeof b === "string") return a === b;
        return a.map === b.map && Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)) < 150;
    }
    // Waypoints (config.travel.via, 2026-11-21): a map reached through a dangerous one goes via a safe map
    // first - the ranger walked main -> level1 -> spookytown to search Jr. and the Vampire Rats there (aggro 1,
    // 9,200 HP) killed it twice in a row.
    // In the waypoint map we first walk to its own door to the destination (2026-11-22): arriving in
    // halloween at the level1 door, the path search found "back through level1" shorter than the walk
    // to halloween's spookytown door, and level1 sent us to halloween again - a loop every 3 s.
    function viaFor(destination) {
        const via = ((config.travel || {}).via) || {};
        const map = destination && typeof destination === "object" ? destination.map : null;
        const v = map && via[map];
        if (!v || character.map === map) return destination;
        if (character.map !== v) return { map: v };
        // The door's own spawn point in this map (door[6]) - walkable, right next to the door.
        const vm = G.maps[v] || {};
        const door = (vm.doors || []).find(function (d) { return d[4] === map; });
        const at = door && vm.spawns && vm.spawns[door[6]];
        if (!at || Math.hypot(character.real_x - at[0], character.real_y - at[1]) < 80) return destination;
        return { map: v, x: at[0], y: at[1] };
    }
    function travel(destination, label) {
        const goal = destination; // the real goal: a failed walk marks it, not the waypoint (2026-11-22 review)
        destination = viaFor(destination);
        util.status(label, "yellow");
        if (is_moving(character) && travelGoal && !sameGoal(travelGoal, destination) && typeof smart !== "undefined" && smart.moving) {
            stoppedOnPurpose = true;
            try { stop("smart"); } catch (e) { /* not walking */ }
        }
        travelGoal = destination;
        if (!is_moving(character)) {
            const id = Date.now();
            searchWalk = id;
            smart_move(destination).then(function () {
                if (searchWalk === id) searchWalk = 0;
            }).catch(function (e) {
                if (searchWalk === id) searchWalk = 0;
                if (stoppedOnPurpose) { stoppedOnPurpose = false; return; } // we stopped it for a target
                const why = util.errReason(e);
                if (!/interrupt|stop/i.test(why) && destination === goal) markBadGoal(goal);
                util.log("move", "route to " + JSON.stringify(destination) + " failed: " + why, "red");
            });
        } else if (cls.move) {
            cls.move(null); // e.g. Warrior Charge on the way
        }
    }
    // Meeting points without a path (2026-11-21): a boss's meeting point (where the finder stood) can
    // lie on a spot the path search can't reach - priest and ranger got "Path not found!" again and
    // again while the team met at a boss in the cave. Such a point is skipped for a minute; we walk
    // to the boss's spawn instead (smart_move by monster name).
    const badGoals = [];
    function markBadGoal(d) {
        if (d && typeof d === "object" && d.map) badGoals.push({ map: d.map, x: d.x, y: d.y, until: Date.now() + 60 * 1000 });
    }
    function isBadGoal(d) {
        const now = Date.now();
        for (let i = badGoals.length - 1; i >= 0; i--) if (badGoals[i].until < now) badGoals.splice(i, 1);
        return !!d && typeof d === "object" && badGoals.some(function (b) { return b.map === d.map && Math.hypot(b.x - d.x, b.y - d.y) < 60; });
    }
    function goalFor(farm) {
        if (farm.dest && !isBadGoal(farm.dest)) return farm.dest;
        if (farm.dest) return farm.monster;
        return targeting.spotFor(farm.monster, farm.map) || farm.monster;
    }

    // Solo recovery (config.combat.recover): after a fight that left us low, no new pull
    // until the potions brought HP and MP back up. Monsters already on us are fought.
    let recovering = false;
    let restSince = 0;
    function resting() {
        const r = config.combat.recover;
        // Solo only (player request): in a party the ranger rested while the priest was a
        // few hundred px behind on the way to Daisy (2026-11-17).
        if (!r || !r.enabled || party.enabled || healerNear()) { recovering = false; return false; }
        const hp = util.hpRatio(), mp = util.mpRatio();
        const attacked = !!get_nearest_monster({ target: character.name });
        if (!recovering) {
            if (attacked) return false; // still fighting
            if (hp >= r.hpBelow && mp >= r.mpBelow) return false;
            recovering = true;
            restSince = Date.now();
            util.log("combat", "resting after the fight: HP " + Math.round(hp * 100) + "%, MP " + Math.round(mp * 100) + "%", "yellow");
        }
        // Done – or resting too long (no potions left, slow natural regeneration).
        if ((hp >= r.hpUntil && mp >= r.mpUntil) || Date.now() - restSince > (r.maxMs || 90 * 1000)) {
            recovering = false;
            util.log("combat", "rested: HP " + Math.round(hp * 100) + "%, MP " + Math.round(mp * 100) + "%", "green");
            return false;
        }
        if (attacked) return false; // something hits us while we rest: fight back
        // Drink up to the targets: the normal rule only drinks once a whole potion is
        // missing, so a 935-MP warrior stopped at ~46% MP and rested for good (2026-11-17).
        if (!is_on_cooldown("use_hp") && !util.townChannel()) {
            if (hp < r.hpUntil && (hp / r.hpUntil <= mp / r.mpUntil || mp >= r.mpUntil)) use_skill("use_hp").catch(function () {});
            else if (mp < r.mpUntil) use_skill("use_mp").catch(function () {});
        }
        if (searchWalk) endSearchWalk();
        else if (is_moving(character)) stop();
        util.status("rest " + Math.round(Math.min(hp / r.hpUntil, mp / r.mpUntil) * 100) + "%", "white");
        return true;
    }

    let topUpSince = 0;
    function topUpFor(target) {
        const cost = targeting.soloCost(target);
        if (!cost) return false;
        const reserve = character.max_hp * (1 - ((config.targeting.live || {}).soloHpUse || 0.5));
        const need = Math.min(character.max_hp, cost + reserve);
        if (character.hp >= need) return false;
        if (!topUpSince) {
            topUpSince = Date.now();
            util.log("combat", "healing up before " + target.mtype + ": " + Math.round(character.hp) + "/" + Math.round(need) + " HP", "yellow");
        }
        // Natural regeneration is slow: after the rest cap we go anyway (potions empty).
        if (Date.now() - topUpSince > ((config.combat.recover || {}).maxMs || 90 * 1000)) return false;
        if (!is_on_cooldown("use_hp")) use_skill("use_hp").catch(function () {});
        if (searchWalk) endSearchWalk();
        else if (is_moving(character)) stop();
        util.status("heal up " + Math.round(character.hp / need * 100) + "% for " + target.mtype, "white");
        return true;
    }

    // Walk to a point; a new order only when standing or the point moved 40+ px.
    let moveDest = null;
    // A path walk (xmove -> smart_move behind walls) is not restarted for a target that moved a bit:
    // the priest stood 350 px from the Phoenix in the cave, smart_move searching a path, and a new
    // order every tick for the moving Phoenix cut each search off - it never got going (2026-11-21).
    function moveTo(p) {
        const pathing = typeof smart !== "undefined" && smart.moving;
        if ((is_moving(character) || pathing) && moveDest && Math.hypot(moveDest.x - p.x, moveDest.y - p.y) < (pathing ? 150 : 40)) return;
        moveDest = { x: p.x, y: p.y };
        quiet(xmove(p.x, p.y));
    }

    // Kiting (config.combat.kite), after earthiverse's KiteMoveStrategy (player decision 2026-11-21):
    // we stand on a circle around the monster at the kite distance - its charge speed + its range +
    // extra px, at most our own range - and keep the angle we stand at. The point taken is the one on
    // that circle closest to our current direction (turning left/right in small steps) with room 25 %
    // farther out (no corners). Inside the circle we step out to it; at or beyond it we stay put - no
    // pendulum next to a monster that stands still (2026-11-21: priest and ranger swung between two
    // points). Only for attackers on us that we outrange and about outrun (charge counts), not for
    // ones that die before they reach us. Attacks and heals go on while we walk.
    let lastKite = 0;
    let escape = null; // { x, y, until }: a way out of a corner we are walking
    // The point on the circle of radius dist around entity, from our own angle, turning alternately
    // left and right (40 steps over the half circle each way); ok filters points. direct: we can
    // walk there in a straight line. null: nothing fits.
    // nearest: instead of the first fitting point (smallest turn), the fitting point with the lowest
    // nearest(x, y) - used to stay close to a boss's spawn area (anchor).
    function orbitPoint(entity, dist, ok, nearest) {
        const me = util.xy(character), e = util.xy(entity);
        const base = Math.atan2(me.y - e.y, me.x - e.x);
        let best = null, bestScore = Infinity;
        for (let i = 1; i < 40; i++) {
            const a = base + (i % 2 ? 1 : -1) * (Math.PI * ((i - (i % 2)) / 40));
            const x = e.x + dist * Math.cos(a), y = e.y + dist * Math.sin(a);
            const lx = e.x + dist * 1.25 * Math.cos(a), ly = e.y + dist * 1.25 * Math.sin(a);
            if (!canMoveFrom(x, y, lx, ly)) continue; // not standable, or a wall right behind it
            if (ok && !ok(x, y)) continue;
            // Only points we reach in a straight line (2026-11-21: the ranger between a cactus and a
            // wall got "Path not found!" again and again - a circle point inside the cactus went to
            // smart_move). Behind an obstacle we take the next angle instead.
            if (!canMoveFrom(me.x, me.y, x, y)) continue;
            if (!nearest) return { x: x, y: y };
            const sc = nearest(x, y);
            if (sc < bestScore) { bestScore = sc; best = { x: x, y: y }; }
        }
        return best;
    }
    // Boss anchor (player decision 2026-11-21): kiting a boss stays within kite.anchorRadius of the
    // middle of its spawn area on our map - the ranger kited the Phoenix through the whole cave and
    // could have dragged it to another player (who joins in and cuts our share). Null for others.
    function bossAnchor(m) {
        const ev = config.events || {};
        const def = G.monsters[m.mtype] || {};
        if (!(ev.search || []).concat(ev.engage || []).includes(m.mtype) && !def.cooperative) return null;
        const map = G.maps[character.map];
        let best = null, bestD = Infinity;
        ((map && map.monsters) || []).forEach(function (pack) {
            if (pack.type !== m.mtype) return;
            const boxes = util.spawnBoxes(pack, character.map);
            boxes.forEach(function (b) {
                const c = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
                const d = Math.hypot(c.x - m.x, c.y - m.y);
                if (d < bestD) { bestD = d; best = c; }
            });
        });
        return best;
    }
    function goTo(p) {
        // A direct step in the middle of a path walk: end the walk first (2026-11-21: the priest's
        // spacing steps broke its path walk in the arena every second - "Lost the path..." spam).
        if (typeof smart !== "undefined" && smart.moving) {
            stoppedOnPurpose = true;
            moveDest = null;
            try { stop("smart"); } catch (e) { /* not walking */ }
        }
        quiet(move(p.x, p.y));
    }
    function kiteStep(target) {
        const k = config.combat.kite;
        if (!k || !k.enabled) return false;
        const attackers = util.attackersOnMe();
        if (!attackers.length) return false;
        const myRange = character.range || 0, mySpeed = character.speed || 0;
        let threat = null, threatDist = Infinity;
        for (const m of attackers) {
            const def = G.monsters[m.mtype] || {};
            // A charging monster rushes at its charge speed (2026-11-21: Jr. charges at 90).
            const mRange = m.range || def.range || 20, mSpeed = Math.max(m.speed || def.speed || 0, def.charge || 0);
            if (myRange < mRange + (k.margin || 30) || mSpeed > mySpeed * (k.maxSpeedRatio || 1.1)) return false; // can't kite this one
            let dist;
            try { dist = parent.distance(character, m); } catch (e) { dist = util.distanceTo(m); }
            // Would it reach us before it dies? The target dies after its HP / our damage per
            // second; any other attacker only after the target.
            // Our damage type decides armor or resistance (2026-11-22 review: the priest was judged against armor).
            const myType = character.damage_type || ((G.classes && G.classes[character.ctype]) || {}).damage_type || "physical";
            const myDef = util.defenseVs(def, myType, character);
            const myDps = Math.max(1, (character.attack || 0) * (character.frequency || 1) * util.damageMultiplier(myDef));
            const killSec = (m === target ? m.hp : m.hp + (target ? target.hp : 0)) / myDps;
            const reachSec = Math.max(0, dist - mRange) / Math.max(1, mSpeed);
            if (killSec <= reachSec) continue; // dies first
            if (dist < threatDist) { threat = m; threatDist = dist; }
        }
        if (!threat) return false;
        const def = G.monsters[threat.mtype] || {};
        const mRange = threat.range || def.range || 20;
        const want = Math.min(myRange - (k.rangeSlack || 10), Math.max(threat.speed || def.speed || 0, def.charge || 0) + mRange + (k.extra || 50));
        if (threatDist >= want - (k.slack || 15)) { util.status("kiting " + threat.mtype + " (in place)", "orange"); return true; }
        if (is_moving(character) && Date.now() - lastKite < (k.everyMs || 250)) return true;
        const me = util.xy(character);
        const free = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        }).map(util.xy);
        // Never out of our own range of the target (player rule 2026-11-19) and not next to free
        // monsters (they would join) - the last one dropped if nothing else fits. No leash to the
        // leader any more (player decision 2026-11-21): in a fight the distance to the leader does not
        // matter - the priest comes into heal range by itself, low fighters go to the priest.
        const aim = target && target !== threat ? util.xy(target) : null;
        const okBase = function (x, y) { return !aim || Math.hypot(x - aim.x, y - aim.y) <= myRange * 0.95; };
        const okFree = function (x, y) { return okBase(x, y) && !free.some(function (q) { return Math.hypot(q.x - x, q.y - y) < (k.avoidRadius || 120); }); };
        const anchor = bossAnchor(threat);
        const R = k.anchorRadius || 280;
        const inAnchor = function (ok) { return function (x, y) { return ok(x, y) && (!anchor || Math.hypot(x - anchor.x, y - anchor.y) <= R); }; };
        const toAnchor = anchor ? function (x, y) { return Math.hypot(x - anchor.x, y - anchor.y); } : null;
        // Inside the anchor circle first; none there: the fitting point closest to the anchor.
        const p = orbitPoint(threat, want, inAnchor(okFree)) || orbitPoint(threat, want, inAnchor(okBase)) ||
            (anchor ? orbitPoint(threat, want, okBase, toAnchor) : orbitPoint(threat, want, okBase));
        if (!p) {
            // Cornered: run to open ground instead of standing and tanking (player idea 2026-11-18),
            // keep walking a chosen way out for a few seconds (Viz priest, 2026-11-19).
            if (escape && Date.now() < escape.until && is_moving(character)) {
                util.status("kiting " + threat.mtype + " - out of the corner", "orange");
                return true;
            }
            const esc = escapePoint(me, util.xy(threat), free, k);
            if (!esc || (aim && Math.hypot(esc.x - aim.x, esc.y - aim.y) > myRange * 0.95)) return false; // nowhere to go: stand and fight
            lastKite = Date.now();
            escape = { x: esc.x, y: esc.y, until: Date.now() + 4000 };
            quiet(move(esc.x, esc.y));
            util.status("kiting " + threat.mtype + " - out of the corner", "orange");
            return true;
        }
        escape = null;
        if (Math.hypot(p.x - me.x, p.y - me.y) < 10) return true;
        lastKite = Date.now();
        goTo(p);
        util.status("kiting " + threat.mtype, "orange");
        return true;
    }
    function escapePoint(me, pack, free, k) {

        let best = null, bestScore = -Infinity;
        for (const r of [150, 220, 300]) {
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
                // Through the pack is fine: monsters don't block the way, and they hit us anyway
                // while we stand in reach (player note 2026-11-18). Only free ones are avoided.
                if (free.some(function (p) { return Math.hypot(p.x - x, p.y - y) < (k.avoidRadius || 120); })) continue;
                if (!canMoveFrom(me.x, me.y, x, y)) continue; // straight line only (no smart_move into walls)
                let open = 0;
                for (let j = 0; j < 8; j++) {
                    const b = j * Math.PI / 4;
                    if (canMoveFrom(x, y, x + Math.cos(b) * 60, y + Math.sin(b) * 60)) open++;
                }
                if (open < 4) continue; // another corner
                const score = Math.hypot(x - pack.x, y - pack.y) + open * 25 - r * 0.2;
                if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
            }
        }
        return best;
    }
    // Party spacing (player request 2026-11-18): with a tank class near, ranged fighters stay out of
    // the melee reach of the monsters around - priest, ranger and warrior stood on one spot at the
    // booboos and some went for the ranged ones. Monsters reaching farther than we shoot (booboos,
    // 420) can't be outranged: from those we keep party.spacing.gap px, so the tank in melee is the
    // one closest to them. We stay in range of our target.
    let lastSpace = 0;
    let spaceGoal = null; // { x, y, at }: the spacing point we are walking to
    function spacingStep(target) {
        const sp = (config.party && config.party.spacing) || {};
        if (!sp.enabled || !party.enabled) return false;
        // A chosen point is walked to the end (2026-11-21: re-planned every 0.8 s, priest and ranger
        // swung left-right-left between the pompoms around the Phoenix).
        if (spaceGoal && is_moving(character) && Date.now() - spaceGoal.at < (sp.holdGoalMs || 2500) &&
            Math.hypot(character.x - spaceGoal.x, character.y - spaceGoal.y) > 10) return true;
        if (is_moving(character) && Date.now() - lastSpace < (sp.everyMs || 700)) return false;
        const myRange = character.range || 0;
        const tanks = ((config.targeting.teamSafety || {}).tankClasses) || [];
        if (myRange < (sp.minOwnRange || 100) || tanks.includes(character.ctype)) return false;
        const tank = party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
            .find(function (p) { return p && !p.rip && tanks.includes(p.ctype) && util.distanceTo(p) < 400; });
        if (!tank) return false;
        const margin = sp.margin || 50;
        const reachOf = function (m) { return m.range || (G.monsters[m.mtype] || {}).range || 20; };
        // Never farther than we can shoot (2026-11-21): at most our range - 25 px.
        const keep = function (m) { const r = reachOf(m) + margin; return r < myRange ? Math.min(r, myRange - 25) : Math.min(sp.gap || 130, myRange - 25); };
        // The same circle as kiting (2026-11-21): around the closest monster we are too near to, from
        // our own angle - we only move while inside its circle, so we don't swing back and forth.
        // Every monster around counts, also free ones (player decision 2026-11-21: many have aggro and
        // rage - walking into them would pull more than we can take). The pendulum between two of them
        // is solved by a point clear of all at once and by walking a chosen point to the end.
        const relevant = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead;
        });
        let near = null, nearGap = Infinity;
        relevant.forEach(function (e) {
            const gap = util.distanceTo(e) - keep(e);
            if (gap < -(sp.slack || 15) && gap < nearGap) { near = e; nearGap = gap; }
        });
        if (!near) { spaceGoal = null; return false; }
        const t = target ? util.xy(target) : null;
        const inShot = function (x, y) { return !t || Math.hypot(t.x - x, t.y - y) <= myRange - 15; };
        // A point clear of every relevant monster first, else clear of the nearest one.
        const clearAll = function (x, y) {
            return inShot(x, y) && relevant.every(function (e) { const q = util.xy(e); return Math.hypot(q.x - x, q.y - y) >= keep(e) - (sp.slack || 15); });
        };
        const p = orbitPoint(near, keep(near), clearAll) || orbitPoint(near, keep(near), inShot);
        if (!p) return false;
        lastSpace = Date.now();
        spaceGoal = { x: p.x, y: p.y, at: Date.now() };
        goTo(p);
        util.status("keeping distance from " + near.mtype, "white");
        return true;
    }
    // Walkable straight line between two points (not only from where we stand).
    // This frame's can_move: the one with the rage walls (2026-11-22 review: kite and escape points used the page's
    // copy and could lie in a rage zone).
    function canMoveFrom(x1, y1, x2, y2) {
        try {
            return !!can_move({ map: character.map, x: x1, y: y1, going_x: x2, going_y: y2, base: character.base });
        } catch (e) { return true; }
    }

    // Stacking guard (earthiverse's AvoidStackingStrategy, player request 2026-11-21): a hit on us
    // that the server marks as "stacked" (we stand on top of another player) moves us up to 25 px
    // aside - looks better, no game advantage. Not while we walk, at most every 250 ms. The listener
    // lives on the game page and is swapped on each code load.
    let lastUnstack = 0;
    function unstack(data) {
        if (!data || data.id !== character.id || !Array.isArray(data.stacked) || !data.stacked.includes(character.id)) return;
        if (character.rip || is_moving(character) || Date.now() - lastUnstack < 250) return;
        const x = character.x - 25 + Math.round(50 * Math.random()), y = character.y - 25 + Math.round(50 * Math.random());
        if (!can_move_to(x, y)) return;
        lastUnstack = Date.now();
        quiet(move(x, y));
    }
    try {
        if (parent.__dmpxUnstackFn) parent.socket.off("hit", parent.__dmpxUnstackFn);
        parent.__dmpxUnstackFn = function (data) { try { unstack(data); } catch (e) { /* cosmetic only */ } };
        parent.socket.on("hit", parent.__dmpxUnstackFn);
    } catch (e) { /* no socket */ }

    let passing = null; // { until, dest } while we pass through attackers on the way
    // Leave a fight with another kind than the farm target (player request 2026-11-19): after
    // combat.passThrough.leaveAfterMs of such fighting we walk out towards the target - the
    // warrior stood in the mummies' rage zone, they kept pulling him and the team never left
    // for the new spot. Every fighter (members too), any speed, any HP; a 5 s pause starts over.
    let offSince = 0, offSeen = 0, leaveLogged = 0;
    function stuckOffTarget(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.leaveAfterMs || !farm || farm.any || !farm.monster || !target || target.mtype === farm.monster) { offSince = 0; return false; }
        // Never out of a boss fight (player decision 2026-11-21: the team left Dracul at 5 % HP after
        // 60 s "for the Phoenix" - which stood right next to them - and walked off to its spawn).
        if (isBossType(target.mtype)) { offSince = 0; return false; }
        const now = Date.now();
        if (!offSince || now - offSeen > 5000) offSince = now;
        offSeen = now;
        if (now - offSince < pt.leaveAfterMs) return false;
        if (now - leaveLogged > 60 * 1000) { leaveLogged = now; util.log("combat", "still fighting " + target.mtype + " after " + Math.round((now - offSince) / 1000) + " s - leaving for " + farm.monster, "yellow"); }
        return true;
    }
    function isBossType(mtype) {
        const ev = config.events || {};
        const def = G.monsters[mtype] || {};
        return (ev.search || []).concat(ev.engage || []).includes(mtype) || !!def.cooperative;
    }
    function passThrough(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.enabled || !farm || farm.any || !farm.monster || target.mtype === farm.monster || isBossType(target.mtype)) { offSince = 0; return false; }
        if (stuckOffTarget(farm, target)) {
            const spot0 = targeting.spotFor(farm.monster, farm.map);
            return !(spot0 && spot0.map === character.map && util.distanceTo(spot0) < (pt.spotRadius || 400));
        }
        if (party.enabled && party.isMember && !party.detached()) return false; // members follow the leader
        if (util.hpRatio() < (pt.minHp || 0.5)) return false;
        const spot = targeting.spotFor(farm.monster, farm.map);
        if (spot && spot.map === character.map && util.distanceTo(spot) < (pt.spotRadius || 400)) return false; // arrived
        const mine = character.speed || 0;
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        const attackers = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target && ours.includes(e.target);
        });
        if (!attackers.length && !target.target) return false; // a free one: just don't pull it (pick decides)
        return attackers.every(function (e) {
            return e.mtype !== farm.monster && (e.speed || (G.monsters[e.mtype] || {}).speed || 0) < mine * (pt.speedShare || 0.8);
        });
    }

    function handleCombat() {
        if (resting()) return;
        const farm = targeting.currentFarm();
        let target = targeting.pick(farm);
        // Pass through (player request 2026-11-19): on the way to the farm spot, monsters of
        // another kind that attack us but are clearly slower are left behind instead of fought -
        // the party stuck in booboo fights on its way to the mummies. Not near the spot, not
        // below combat.passThrough.minHp, and only when every attacker is that slow.
        if (target && passThrough(farm, target)) {
            lastFarm = farm;
            lastTarget = null; // members see the leader travelling with no target: they follow, no fights
            passing = { until: Date.now() + 3000, dest: farm.dest || targeting.spotFor(farm.monster, farm.map) || farm.monster };
            util.status("passing " + target.mtype, "yellow");
            travel(goalFor(farm), "searching " + farm.monster);
            return;
        }
        // Only time actually fighting counts for the crowded-spot check: running after a
        // monster that another player kills on the way is time without a target too.
        // A monster attacking one of us counts as work too, in our range or not: after the
        // warrior's Agitate the leader saw no free bee in its own range, called the spot crowded
        // and the party shuttled between bee spots (2026-11-18).
        // Walking to a target stays idle (player decision 2026-11-21: a spot where we mostly walk for one
        // kill a minute is no good spot); the shared-spot bar was lowered to 75 % instead.
        const busy = !!target && (is_in_range(target) || (target.target && (target.target === character.name || party.memberNames().includes(target.target))));
        targeting.reportSearch(busy);
        lastFarm = farm;
        lastTarget = target;

        if (!target) {
            // A boss we hold for the team (not engaged yet) in sight but far off: close in to within
            // the hold range - out of its reach - so the team can gather at it (2026-11-21: the
            // meeting point was where the warrior first saw Dracul, 560 px away; the hold waits until
            // everyone is within holdRange of the boss, so all three stood at the meeting point and
            // waited for each other).
            if (String(farm.source || "").indexOf("event ") === 0 && farm.monster) {
                const boss = get_nearest_monster({ type: farm.monster });
                // An aggressive boss we hold for the team (2026-11-22, targeting.bossHoldRing): we wait outside its
                // spawn box - inside, Jr. walked into the ranger and the fight began alone. The ring is kept for a
                // minute when the boss leaves our sight, so we don't walk into its box looking for it.
                if (holdRingStep(boss, farm.monster)) return;
                const holdRange = (config.events && config.events.holdRange) || 350;
                if (boss && !boss.dead && util.distanceTo(boss) > holdRange * 0.7) {
                    const def = G.monsters[boss.mtype] || {};
                    const keepOff = Math.max(holdRange * 0.55, (boss.range || def.range || 50) + 60);
                    const me = util.xy(character), b = util.xy(boss);
                    const d = Math.hypot(me.x - b.x, me.y - b.y) || 1;
                    util.status("closing in on " + boss.mtype, "yellow");
                    moveTo({ x: b.x + (me.x - b.x) / d * keepOff, y: b.y + (me.y - b.y) / d * keepOff });
                    return;
                }
                // In sight and close enough: wait here. Travelling would mean smart_move("phoenix") -
                // the game's nearest Phoenix SPAWN, a different one for each of us, away from the
                // Phoenix next to us (2026-11-21).
                if (boss && !boss.dead) { util.status("waiting at " + boss.mtype, "yellow"); return; }
            }
            if (party.idleFollow()) return; // party member: stay with the leader
            if (farm.any) { util.status("waiting for monsters (" + farm.source + ")", "white"); return; }
            // Cavalry reset at a rage zone (2026-11-22): we call from its edge, never from inside it.
            const edge = targeting.cavalryEdge ? targeting.cavalryEdge(farm) : null;
            if (edge && edge.hold) {
                endSearchWalk();
                if (is_moving(character)) stop();
                util.status(edge.why, "yellow");
                return;
            }
            // Spot check (2026-11-22): at the edge of the farm spot we stop and look before walking in.
            const gate = targeting.spotGate ? targeting.spotGate(farm) : null;
            if (gate && gate.hold) {
                endSearchWalk();
                if (is_moving(character)) stop();
                util.status(gate.why, "white");
                return;
            }
            // A Cavalry plan walks right into the spot (the call needs the monsters within 320 px).
            const hold =String(farm.source || "").startsWith("cavalry") ? null : targeting.waitForLone(farm.monster);
            if (hold) {
                // Too strong ones close: the spot check judges from here (2026-11-22).
                if (hold === "strong" && targeting.spotGateWatchNow) targeting.spotGateWatchNow(farm);
                // Waiting for a lone one: from the edge of the spawn, where the whole box is in
                // sight (player request 2026-11-19) - not wherever the first one came into view.
                const wp = hold === "lone" && targeting.watchPoint ? targeting.watchPoint(farm.monster) : null;
                if (wp && util.distanceTo(wp) > 40) moveTo(wp);
                else endSearchWalk();
                util.status((hold === "strong" ? "too strong: " : "waiting for a lone ") + farm.monster, "white");
                return;
            }
            travel(goalFor(farm), "searching " + farm.monster);
            return;
        }

        // Solo (player decision 2026-11-17): a costly fight only starts with enough HP to end it
        // above the reserve - (1 - soloHpUse) of max HP. With soloHpUse 0.7 a fight costing 70%
        // waits for full HP, a cheap one goes ahead at lower HP. Not for monsters already on us.
        if (!party.enabled && target.target !== character.name && topUpFor(target)) return;
        topUpSince = 0;

        if (get_targeted_monster() !== target) change_target(target);
        // A far target in sight does not end the search walk yet: it may be gone (another
        // player, out of sight) the next tick, and the walk restarted - two steps, a new
        // search, two steps on the way to the bees (2026-11-17). Close ones, ones already on
        // us and aggressive ones (packs) end it at once.
        const near = util.distanceTo(target) < 250 || !!target.target || targeting.aggressive(target);
        if (!near && searchWalk && typeof smart !== "undefined" && smart.moving) {
            util.status("moving to " + target.mtype, "orange");
            return;
        }
        endSearchWalk();

        if (!is_in_range(target)) {
            // A monster on its way to a party member (e.g. the priest pulled it): meet it at
            // that member instead of running to where the monster was – the warrior ran past
            // the incoming White Wolf deeper into the spawn (2026-11-17). Taunt (range 200)
            // takes it over once we are close. Melee only: the priest followed the wolf to
            // the warrior after the Taunt – into the spawn (2026-11-17); ranged fighters just
            // close in to their range.
            const melee = ((config.targeting.melee || {}).classes || []).includes(character.ctype);
            const victimName = melee && target.target && target.target !== character.name && party.memberNames().includes(target.target) ? target.target : null;
            const victim = victimName ? get_player(victimName) : null;
            // Only until we stand by that member: a kiting priest keeps the monster at range, so
            // the warrior waited next to him forever (2026-11-19) - from there we go for it.
            if (victim && !victim.rip && util.distanceTo(victim) > 80) {
                util.status("moving to " + victimName, "orange");
                // Warrior Dash towards the hit member (player decision 2026-11-21): there we taunt it off.
                if (cls.move && cls.move(victim)) return;
                moveTo(util.xy(victim));
                return;
            }
            // A monster already coming for us (e.g. after our Taunt) is waited for, not met
            // halfway - the warrior ran towards the moles, into the next ones (2026-11-17).
            // Only if it reaches us: one with a longer range than ours would stop short.
            const def = G.monsters[target.mtype] || {};
            // Ranged fighters likewise wait when the monster heads for a party member within
            // their own range: it comes into range by itself - the ranger walked towards the
            // moles (2026-11-17).
            const onMember = !melee && victimName === null && target.target && target.target !== character.name &&
                party.memberNames().includes(target.target) && get_player(target.target) &&
                util.distanceTo(get_player(target.target)) < (character.range || 0) * 0.9;
            // A class mode may want us to meet them instead (warrior Agitate "stream": while
            // Agitate is on cooldown we walk to them, player request 2026-11-18).
            const meet = cls.meetIncoming && cls.meetIncoming();
            if (!meet && (onMember || target.target === character.name) && (def.range || 0) <= (character.range || 0) + 10) {
                if (is_moving(character) && !(typeof smart !== "undefined" && smart.moving)) stop();
                util.status("waiting for " + target.mtype, "orange");
                return;
            }
            util.status("moving to " + target.mtype, "orange");
            if (cls.move && cls.move(target)) return; // e.g. Warrior Dash closed the gap
            // Aggressive ones: only up to our range, not into them (and past their friends).
            // The point follows the monster (it was only set once, when we stood still).
            moveTo(targeting.aggressive(target) ? targeting.standPoint(target) : util.xy(target));
            return;
        }

        const kiting = kiteStep(target) || spacingStep(target);
        if (!kiting) util.status(cls.name + ": " + target.mtype, "green");
        if (cls.fight(target)) return;
        strike.attack(target); // fires at once, or the moment the cooldown ends
    }

    // Cavalry (Tracktrix, interact("cavalry"); player decision 2026-11-18). Below account level 80
    // the four sentries fight up to 24 level-3+ monsters within 320 px for 90 s, and those they hit
    // respawn at level 1. One call per ~10 min + 1 min per level, shared by the whole account.
    //   emergency: any fighter low on HP with level-3+ monsters on it
    //   reset:     the one who picks the spot (leader, solo, farming on its own) at its farm target
    //              when several of them in reach have grown (resetFromLevel)
    const CAV_KEY = "dmpx_cavalry_next"; // account-wide: next possible call (ms)
    let cavTryAt = 0;
    function cavalryReady() {
        let next = 0;
        try { next = get(CAV_KEY) || 0; } catch (e) { /* storage unavailable */ }
        return Date.now() >= next && Date.now() >= cavTryAt;
    }
    function callCavalry(why) {
        cavTryAt = Date.now() + 60 * 1000; // one try per minute at most
        util.log("cavalry", "calling the Cavalry: " + why, "yellow");
        interact("cavalry").then(function (r) {
            const wait = (r && (r.cooldown_ms || (r.next_call ? new Date(r.next_call).getTime() - Date.now() : 0))) || 0;
            try { set(CAV_KEY, Date.now() + Math.max(wait, 10 * 60 * 1000)); set("dmpx_cavalry_called", Date.now()); } catch (e) { /* storage unavailable */ }
            util.log("cavalry", "Cavalry answered (" + ((r && r.assigned) || 0) + " sentries" + (r && r.queued ? ", queued" : "") + ")", "green");
        }).catch(function (e) {
            const ms = e && (e.cooldown_ms || e.ms);
            if (ms) try { set(CAV_KEY, Date.now() + ms); } catch (x) { /* storage unavailable */ }
            util.log("cavalry", "Cavalry refused: " + util.errReason(e), "orange");
        });
    }
    // Reset/nuke guard (player decision 2026-11-21). At 09:14Z the Cavalry was called on 2 grown
    // booboos (levels 19,10) while other players fought more of them in reach: the sentries hit
    // every level-3+ monster within 320 px, those came for us, and the warrior and the ranger
    // died within 11 s. So a reset or nuke call needs
    //   - nothing in reach fought by players outside our team (it pulls their monsters on us and
    //     takes their kills), and
    //   - the team surviving everything the Cavalry would take at once: the same check as a pack
    //     we farm (team model as leader, our own hits and sustain solo), per kind, with the
    //     strongest one of the kind and the count in reach.
    // Emergency calls are not checked: there the monsters are on us already.
    // Returns null when the call is fine, else why not.
    function cavalryBlock(list) {
        const ours = function (n) { return n === character.name || party.inParty(n) || (config.team.fighters || []).includes(n); };
        const fought = list.filter(function (e) { return e.target && !ours(e.target); });
        if (fought.length) {
            const who = fought.map(function (e) { return e.target; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
            return fought.length + " of them fought by " + who.join(", ");
        }
        const byType = {};
        list.forEach(function (e) { (byType[e.mtype] = byType[e.mtype] || []).push(e); });
        // Our own farm monster needs no HP check (player decision 2026-11-21): the sentries kill them,
        // not we - the pack check blocked every reset of 4-9 level-26 CGoos in the arena while the
        // warrior just stood there. The players check above and foreignClear stay.
        const own = lastFarm && lastFarm.monster;
        for (const type of Object.keys(byType)) {
            if (type === own) continue;
            const pack = byType[type];
            const live = pack.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
            const v = targeting.teamModelOn() ? targeting.teamVerdict(type, live, { pull: pack.length }) : targeting.packVerdict(live, pack.length);
            if (!v.ok) return pack.length + "x " + type + " at once: " + (v.why || "unsafe");
        }
        return null;
    }
    let cavBlocked = { why: "", at: 0 };
    function guardedCall(why, inReach) {
        const block = cavalryBlock(inReach);
        if (!block) return callCavalry(why);
        // Logged when the reason changes, else every 5 min.
        if (block !== cavBlocked.why || Date.now() - cavBlocked.at > 5 * 60 * 1000) {
            cavBlocked = { why: block, at: Date.now() };
            util.log("cavalry", "not calling the Cavalry (" + why + "): " + block, "orange");
        }
    }
    function cavalryTick() {
        const cv = config.cavalry || {};
        if (!cv.enabled || character.rip || !cavalryReady()) return;
        if (!["tracker", "supercomputer"].some(function (n) { return util.countItem(n) > 0; })) return;
        const reach = 320;
        const grown = function (e) { return e && e.type === "monster" && !e.dead && (e.level || 1) >= 3 && util.distanceTo(e) <= reach && G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative; };
        const all = Object.values(parent.entities || {});
        // Emergency: low HP with level-3+ monsters on us (only those can be taken).
        if (util.hpRatio() < (cv.emergencyHpBelow || 0.35)) {
            const on = all.filter(function (e) { return grown(e) && e.target === character.name; });
            if (on.length >= (cv.emergencyOnMe || 1)) return callCavalry("emergency, " + Math.round(util.hpRatio() * 100) + "% HP, " + on.length + " on me");
        }
        // Reset/nuke: the Cavalry takes the NEAREST level-3+ monsters of any kind, and one it hits
        // goes for the caller (it never targets the Cavalry). 2026-11-19: a passive green fairy
        // (3,000 magic damage, whole-map reach) near the dinos was taken and killed the priest.
        // So no call while another kind of level-3+ monster is within foreignClear px.
        const foreign = function (type) {
            return all.some(function (e) {
                return e && e.type === "monster" && !e.dead && e.mtype !== type && (e.level || 1) >= 3 &&
                    G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative && util.distanceTo(e) <= (cv.foreignClear || 420);
            });
        };
        // Reset: the spot picker at its farm target, not during events.
        if (ctx.events.current() || !lastFarm || !lastFarm.monster || lastFarm.any) return;
        if (foreign(lastFarm.monster)) return;
        if (party.enabled && party.isMember && !party.detached()) return;
        // Cavalry plan (targeting): nuke = any level-3+ one of the kind in reach; reset = grown ones.
        const src = String(lastFarm.source || "");
        if (src === "cavalry nuke" || src === "cavalry reset") {
            const lvl = 3; // the plan wants this spot cleared - any level the Cavalry takes
            const these = all.filter(function (e) { return grown(e) && e.mtype === lastFarm.monster && (e.level || 1) >= lvl; });
            // Most of the pack in reach first (2026-11-19: the call came with 1 mummy in reach and the
            // Cavalry left after killing it): planMinCount of them, or all we see if fewer.
            const seen = all.filter(function (e) { return e && e.type === "monster" && !e.dead && e.mtype === lastFarm.monster && (e.level || 1) >= lvl; }).length;
            if (these.length && these.length >= Math.min(cv.planMinCount || 5, seen)) guardedCall(src.slice(8) + " " + these.length + "x " + lastFarm.monster + " (levels " + these.map(function (e) { return e.level || 1; }).join(",") + ")", all.filter(grown));
            return;
        }
        if (!cv.reset) return;
        // At least resetPackMin grown ones in reach, or all we see if fewer (player decision 2026-11-21:
        // a call with 3 of 27 level-26 CGoos in reach spent the ~70 min cooldown on three of them).
        const bigAll = all.filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.mtype === lastFarm.monster && (e.level || 1) >= (cv.resetFromLevel || 5) &&
                G.monsters[e.mtype] && !G.monsters[e.mtype].cooperative;
        });
        const big = bigAll.filter(function (e) { return util.distanceTo(e) <= reach; });
        const want = Math.max(cv.resetMinCount || 2, Math.min(cv.resetPackMin || 5, bigAll.length));
        const levels = function (l) { return l.map(function (e) { return e.level || 1; }).join(","); };
        // Something on us already: the call goes out at once with what is in reach (they come anyway).
        const onUs = all.some(function (e) { return e && e.type === "monster" && !e.dead && e.target === character.name; });
        if (onUs && big.length >= (cv.resetMinCount || 2)) {
            cavWalk = null;
            guardedCall("reset " + big.length + "x " + lastFarm.monster + " (attacked, levels " + levels(big) + ")", all.filter(grown));
            return;
        }
        if (bigAll.length < want || onUs) { cavWalk = null; return; }
        // The densest group (player decision 2026-11-21): the grown one with the most others within
        // 80 % of the reach, and the middle of that group - we call from there, so the sentries take as
        // many as possible (up to 24) instead of the first 5 at the group's edge.
        let group = [];
        bigAll.forEach(function (e) {
            const p = util.xy(e);
            const g = bigAll.filter(function (o) { const q = util.xy(o); return Math.hypot(q.x - p.x, q.y - p.y) <= reach * 0.8; });
            if (g.length > group.length) group = g;
        });
        let mid = group.reduce(function (s, e) { const q = util.xy(e); return { x: s.x + q.x / group.length, y: s.y + q.y / group.length }; }, { x: 0, y: 0 });
        // Not into a rage zone we can't take (2026-11-22: at 06:43 the walk to the middle of the booboos pulled
        // the whole spawn, the sentries only take level 3+ and the level-1/2 ones killed the warrior): the call
        // goes out from just outside the box, on our side of it.
        const fz = targeting.failingZoneAt ? targeting.failingZoneAt(mid) : null;
        if (fz) {
            const me = util.xy(character);
            const len = Math.hypot(me.x - mid.x, me.y - mid.y) || 1;
            let p = { x: mid.x, y: mid.y };
            for (let d = 0; d <= len && targeting.failingZoneAt(p); d += 20) p = { x: mid.x + (me.x - mid.x) * d / len, y: mid.y + (me.y - mid.y) * d / len };
            mid = { x: p.x + (me.x - mid.x) / len * 40, y: p.y + (me.y - mid.y) / len * 40 };
        }
        const inGroup = group.filter(function (e) { return util.distanceTo(e) <= reach; }).length;
        const atMid = util.distanceTo(mid) <= 40;
        // Stuck on the way (wall, no path) for 3 s: call from here when enough are in reach.
        const stuck = cavWalk && !is_moving(character) && Date.now() - cavWalk.at > 3000;
        if (big.length >= want && (atMid || stuck || inGroup >= group.length || big.length >= 24)) {
            cavWalk = null;
            guardedCall("reset " + big.length + "x " + lastFarm.monster + " (levels " + levels(big) + ", group of " + group.length + ")", all.filter(grown));
            return;
        }
        const sameMid = cavWalk && Math.hypot(cavWalk.x - mid.x, cavWalk.y - mid.y) <= 60;
        if (!sameMid || (!is_moving(character) && !atMid)) {
            cavWalk = { x: mid.x, y: mid.y, at: sameMid ? cavWalk.at : Date.now() }; // "at" survives re-sends (stuck check)
            if (can_move_to(mid.x, mid.y)) move(mid.x, mid.y);
            else smart_move({ map: character.map, x: mid.x, y: mid.y }).catch(function () {});
            if (Date.now() - cavWalkLog > 60 * 1000) {
                cavWalkLog = Date.now();
                util.log("cavalry", "walking to the middle of the " + lastFarm.monster + " group for the Cavalry: " + group.length + " there, " + big.length + " in reach now", "yellow");
            }
        }
        util.status("to the pack (Cavalry)", "yellow");
        return true;
    }
    let cavWalk = null, cavWalkLog = 0;

    // ---- strike loop (player decision 2026-11-20, idea from earthiverse's bot) ------
    // Attacks and heals fire the moment the cooldown ends instead of on the next 250 ms tick
    // (on average ~125 ms lost per swing, 15-25 % of damage and heals). The tick decides WHAT
    // to hit (strike.attack / strike.heal set an intent for ~700 ms); this loop decides WHEN.
    // After each strike the local cooldown is shortened by our ping (reduce_cooldown).
    let strikeIntent = null; // { kind: "attack"|"heal", id|name, at, after }
    function msToAttack() {
        const n = parent.next_skill && parent.next_skill.attack;
        return n ? n - Date.now() : 0;
    }
    function pingComp() { return Math.min(150, Math.max(0, (character.ping || 0) * 0.9)); }
    function fire() {
        const i = strikeIntent;
        if (!i || Date.now() - i.at > 700 || character.rip) return false;
        if (msToAttack() > 0) return false;
        if (parent.is_disabled && parent.is_disabled(character)) return false;
        if (i.kind === "heal") {
            const p = i.name === character.name ? character : get_player(i.name);
            if (!p || p.rip || (p !== character && !is_in_range(p, "heal"))) return false;
            heal(p).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
            return true;
        }
        if (i.kind === "skill") {
            // A skill on the attack cooldown (3shot/5shot share it): fired by the same loop, or the
            // basic attack always took the cooldown first and 3-Shot only came now and then
            // (2026-11-21, giant scorpions: 4-5 on the warrior, the ranger shot one arrow).
            const ts = i.ids.map(function (id) { return parent.entities && parent.entities[id]; });
            if (ts.some(function (t) { return !t || t.dead || !is_in_range(t, i.name); })) { strikeIntent = null; return false; }
            if (character.mp < ((G.skills[i.name] && G.skills[i.name].mp) || 0)) { strikeIntent = null; return false; }
            use_skill(i.name, ts).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
            strikeIntent = null;
            return true;
        }
        const t = parent.entities && parent.entities[i.id];
        if (!t || t.dead || !is_in_range(t)) return false;
        if (targeting.doomed && targeting.doomed(t)) return false; // the next tick picks another
        attack(t).then(function () { reduce_cooldown("attack", pingComp()); }).catch(function () {});
        if (i.after) { try { i.after(t); } catch (e) { /* bookkeeping only */ } }
        return true;
    }
    const strike = {
        // Hit this monster as soon as the cooldown allows; `after` runs once per swing sent.
        attack: function (target, after) {
            if (!target) return;
            strikeIntent = { kind: "attack", id: target.id, at: Date.now(), after: after || null };
            fire();
        },
        // A multi-target skill on the attack cooldown (ranger 3-Shot): replaces the basic attack.
        skill: function (name, targets) {
            if (!targets || !targets.length) return;
            strikeIntent = { kind: "skill", name: name, ids: targets.map(function (t) { return t.id; }), at: Date.now() };
            fire();
        },
        heal: function (entity) {
            if (!entity) return;
            strikeIntent = { kind: "heal", name: entity === character ? character.name : entity.name, at: Date.now() };
            fire();
        },
    };
    ctx.strike = strike;
    async function strikeLoop() {
        while (running) {
            let wait = 100;
            try {
                if (!fire()) {
                    const ms = msToAttack();
                    wait = strikeIntent && ms > 0 ? Math.min(200, Math.max(10, ms)) : 100;
                } else wait = 60;
            } catch (e) { /* next round */ }
            await sleep(wait);
        }
    }

    // Busy phases (waiting for the team, following, trips, events, Daisy): defend and heal in
    // place - only targets already in range, never a step (player decision 2026-11-20, from
    // earthiverse: his fight loop never moves, the move loop decides where to go). We had cut
    // all fighting there because fights kept the team from leaving a spot.
    function defendInPlace() {
        if (character.rip) return;
        // Waiting in place: still step away from what we can kite (2026-11-21) - not during a
        // smart_move (travel, search), which the step would cut off again and again.
        if (!(typeof smart !== "undefined" && smart.moving)) kiteStep(null);
        if (cls.supportInPlace && cls.supportInPlace()) return;
        const ours = [character.name].concat(party.enabled ? party.memberNames() : []);
        let best = null;
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.target || !ours.includes(e.target)) return;
            if (!is_in_range(e) || util.tooSpiky(config, e)) return;
            if (targeting.doomed && targeting.doomed(e)) return; // dies to damage already in the air
            if (!best || e.hp < best.hp) best = e;
        });
        if (best) strike.attack(best);
    }

    // ---- chest opener (player decision 2026-11-20) ---------------------------------
    // A party chest's gold uses the OPENER's gold multiplier for everyone (game guide: opener
    // within 400 px, within 8 min). So the fighter with the highest gold bonus opens them; the
    // others leave a chest to it - unless it is dead, out of sight or farther than awayRange
    // from the chest (its bonus would not count anyway), or the chest has waited fallbackMs.
    // The game's own loot() opens every chest on the map, whoever is first.
    const co = (config.party && config.party.chestOpener) || {};
    const goldOf = {}; // fighter -> { g, at } gold multipliers the others reported
    let lastGoldSend = 0, lastLootAt = 0, lastOpenerSend = 0, lastOpenerSent = "";
    let leaderOpener = null; // { name, at } - the leader's choice (members follow it)
    let lastStuckLog = 0;
    const chestSeen = {}; // chest id -> first time we saw it
    ctx.comms.on("goldm", function (data, from) {
        if (!data || typeof data.g !== "number" || !((config.team && config.team.fighters) || []).includes(from)) return;
        goldOf[from] = { g: data.g, at: Date.now() };
    });
    // One decision for the whole team (2026-11-20): every fighter choosing on its own from
    // reports up to a minute old disagreed when a gold bonus changed - the priest saw another
    // opener, the others saw the priest, and the bees' chests piled up until fallbackMs.
    ctx.comms.on("opener", function (data, from) {
        if (from !== config.leader || !data || !data.name) return;
        leaderOpener = { name: data.name, at: Date.now() };
    });
    function shareGold() {
        const now = Date.now();
        const team = (config.team && config.team.fighters) || [];
        const others = party.memberNames().filter(function (n) { return n !== character.name && team.includes(n); });
        if (party.isLeader) {
            // The leader tells everyone its choice: every 5 s, at once when it changes.
            const op = chooseOpener();
            if (op !== lastOpenerSent || now - lastOpenerSend > 5000) {
                lastOpenerSent = op;
                lastOpenerSend = now;
                others.forEach(function (n) { ctx.comms.send(n, "opener", { name: op }); });
            }
        }
        if (now - lastGoldSend < 30 * 1000) return;
        lastGoldSend = now;
        if (!party.isLeader && config.leader && others.includes(config.leader)) ctx.comms.send(config.leader, "goldm", { g: character.goldm || 1 });
    }
    // Members: the leader's choice while it is fresh; the leader (or without it): our own.
    function chestOpener() {
        if (!party.isLeader && leaderOpener && Date.now() - leaderOpener.at < 30 * 1000) return leaderOpener.name;
        return chooseOpener();
    }
    // The fighter that opens chests: config fixed one, else the highest gold multiplier among
    // the team fighters in the party (reports younger than 3 min); ties: the leader, then team order.
    function chooseOpener() {
        const team = (config.team && config.team.fighters) || [];
        const here = team.filter(function (n) { return n === character.name || party.memberNames().includes(n); });
        if (co.fixed && here.includes(co.fixed)) return co.fixed;
        let best = null, bestG = -1;
        const order = [config.leader].concat(team).filter(function (n, i, a) { return n && a.indexOf(n) === i && here.includes(n); });
        order.forEach(function (n) {
            const g = n === character.name ? (character.goldm || 1)
                : (goldOf[n] && Date.now() - goldOf[n].at < 3 * 60 * 1000 ? goldOf[n].g : null);
            if (g !== null && g > bestG + 1e-9) { best = n; bestG = g; }
        });
        return best || character.name;
    }
    function openerAway(name, chest) {
        if (name === character.name) return false;
        const p = get_player(name);
        if (!p || p.rip || (p.map && p.map !== character.map)) return true;
        return Math.hypot((p.x || 0) - chest.x, (p.y || 0) - chest.y) > (co.awayRange || 400);
    }
    function lootChests() {
        if (!co.enabled || !party.enabled) { loot(); return; }
        shareGold();
        const now = Date.now();
        if (now - lastLootAt < Math.min(300, (character.ping || 100) * 3)) return;
        const opener = chestOpener();
        const ids = Object.keys(parent.chests || {});
        Object.keys(chestSeen).forEach(function (id) { if (!ids.includes(id)) delete chestSeen[id]; });
        // Diagnosis (2026-11-20: a pile of chests stayed behind): any fighter with chests older than
        // twice fallbackMs says what it sees - at most every 2 min.
        if (now - lastStuckLog > 2 * 60 * 1000) {
            const oldIds = ids.filter(function (id) { return chestSeen[id] && now - chestSeen[id] > 2 * (co.fallbackMs || 10000); });
            if (oldIds.length >= 3) {
                lastStuckLog = now;
                const c0 = parent.chests[oldIds[0]] || {};
                const fromLeader = !party.isLeader && leaderOpener && now - leaderOpener.at < 30 * 1000;
                util.log("loot", oldIds.length + " chests older than " + Math.round(2 * (co.fallbackMs || 10000) / 1000) + " s - opener " + opener +
                    (opener === character.name ? " (us)" : " (away: " + openerAway(opener, c0) + ")") + ", choice from " + (fromLeader ? "leader" : "own") +
                    ", first at " + Math.round(Math.hypot((c0.x || 0) - character.x, (c0.y || 0) - character.y)) + " px, items " + (c0.items || 0) + "/" + character.esize, "orange");
            }
        }
        let opened = 0;
        for (let i = 0; i < ids.length && opened < 2; i++) {
            const id = ids[i], chest = parent.chests[id];
            if (!chest) continue;
            if (!chestSeen[id]) chestSeen[id] = now;
            if ((chest.items || 0) > character.esize || (chest.last_loot && now - chest.last_loot < 1600)) continue;
            if (opener !== character.name && !openerAway(opener, chest) && now - chestSeen[id] < (co.fallbackMs || 30000)) continue;
            chest.last_loot = now;
            lastLootAt = now;
            opened++;
            try { Promise.resolve(loot(id)).catch(function () {}); } catch (e) { /* chest gone */ }
        }
    }

    // Leader: wait for fighters far behind (player request 2026-11-18: the priest walked into the
    // farm spot while warrior and ranger were still on the way). Only while nothing attacks us;
    // members farming on their own (damage return) and dead ones are not waited for; after
    // party.waitMaxMs we go on anyway (a stuck member must not stop the team).
    let teamWaitSince = 0;
    // The wait's "wait VizRng" stayed on screen after it ended: walks that run on their own (the
    // boss search) set their status only once per spot (2026-11-20).
    let waitShown = false;
    function endWaitStatus() {
        if (!waitShown) return;
        waitShown = false;
        util.status("walking on", "white");
    }
    function waitForTeam() {
        const pc = config.party || {};
        if (!party.enabled || !party.isLeader || !pc.waitForTeam) return false;
        // Never while a fight is on - a monster on us or on any member: the waiting skipped the
        // priest's heals while the warrior died to mummies and the ranger was off buying potions
        // (2026-11-19).
        const members = party.memberNames();
        if (Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && !e.dead && e.target && (e.target === character.name || members.includes(e.target));
        })) { endWaitStatus(); return false; }
        // A target boss in sight (ours or a member's): the members are already at it, the leader
        // goes there too instead of waiting for them (2026-11-20, Phoenix at the armadillos).
        if (ctx.events && ctx.events.engaging && ctx.events.engaging()) { teamWaitSince = 0; endWaitStatus(); return false; }
        // On a route: no stops on the way - the members walk to its end themselves and we wait there
        // (player decision 2026-11-21, idea from earthiverse: the priest stopped at almost every door).
        if (pc.goToDest !== false && typeof smart !== "undefined" && smart.moving) { teamWaitSince = 0; endWaitStatus(); return false; }
        // Parallel boss search: the members walk their own areas (2026-11-21).
        if (ctx.events && ctx.events.splitSearching && ctx.events.splitSearching()) { teamWaitSince = 0; endWaitStatus(); return false; }
        const fighters = (config.team && config.team.fighters) || [];
        const runner = ctx.events && ctx.events.runnerOut ? ctx.events.runnerOut() : null; // out on a boss search alone
        // A member that went ahead and stands at our farm spot already is not waited for (2026-11-21:
        // the priest waited in town for the warrior, who was at the giant scorpions long since).
        let spot = null;
        try { spot = lastFarm && lastFarm.monster && targeting.spotFor ? targeting.spotFor(lastFarm.monster, lastFarm.map) : null; } catch (e) { spot = null; }
        const atSpot = function (info) {
            return !!(spot && info && info.map === spot.map && typeof info.x === "number" &&
                Math.hypot(info.x - spot.x, info.y - spot.y) <= (pc.waitDistance || 500));
        };
        // ...nor one already at our NEXT goal (2026-11-22, player report): on the waypoint map (halloween) the members
        // went ahead to the door, the priest stopped at the entrance to wait for them, they walked back to it - and so
        // on at every leg. Our next goal: the farm spot through the waypoint rule (e.g. halloween's spookytown door).
        let next = null;
        try { next = lastFarm && lastFarm.monster ? viaFor(goalFor(lastFarm)) : null; } catch (e) { next = null; }
        const atNext = function (info) {
            return !!(next && typeof next === "object" && next.map && typeof next.x === "number" && info && info.map === next.map &&
                typeof info.x === "number" && Math.hypot(info.x - next.x, info.y - next.y) <= (pc.waitDistance || 500));
        };
        // A member strong enough to pick its own targets here (targeting isEasy, from its own stats) farms on
        // its own like a detached one - no waiting for it (player decision 2026-11-21: the warrior took his own
        // CGoos far away and priest and ranger stood waiting for him).
        const stats = ctx.events && ctx.events.teamStats ? ctx.events.teamStats() : [];
        const ownTargets = function (n) {
            const s = config.party.spread, def = lastFarm && lastFarm.monster && G.monsters[lastFarm.monster];
            const st = stats.find(function (x) { return x && x.name === n; });
            if (!s || !s.enabled || !def || def.cooperative || !st) return false;
            if (s.harmlessRatio && def.attack <= st.max_hp * s.harmlessRatio) return true;
            const risk = util.kiteRisk(def, null, { speed: st.speed, range: st.range }); // kiteable: residual risk (2026-11-21)
            if (risk < 1) return def.attack * risk <= st.max_hp * s.maxDamageRatio;
            return def.hp <= st.attack * s.maxHits && def.attack <= st.max_hp * s.maxDamageRatio;
        };
        const far = party.memberNames().filter(function (n) {
            if (n === character.name || !fighters.includes(n) || n === runner) return false;
            if (ownTargets(n)) return false;
            const info = (get_party() || {})[n] || {};
            if (character.map !== (spot && spot.map) && atSpot(info)) return false; // ahead of us, at the spot
            if (atNext(info)) return false; // ahead of us, at our next goal
            if (lastFarm && lastFarm.monster && util.tooSpiky(config, lastFarm.monster, info.type)) return false; // farms on its own
            const p = get_player(n);
            if (p && p.rip) return false;
            return !p || util.distanceTo(p) > (pc.waitDistance || 500);
        });
        if (!far.length) { teamWaitSince = 0; endWaitStatus(); return false; }
        const now = Date.now();
        if (!teamWaitSince) {
            teamWaitSince = now;
            util.log("party", "waiting for " + far.join(", "), "white");
        }
        // Waited long enough: go on for waitAgainMs, then wait again (2026-11-18: after one long
        // wait the leader never waited again and walked alone to the next spot).
        const waited = now - teamWaitSince, max = pc.waitMaxMs || 45000;
        if (waited > max + (pc.waitAgainMs || 60000)) {
            teamWaitSince = now;
            util.log("party", "waiting for " + far.join(", ") + " again", "white");
        } else if (waited > max) { endWaitStatus(); return false; }
        // Marked for the boss search: a walk stopped by this wait is no failed try (2026-11-20).
        ctx.teamWaitAt = now;
        if (is_moving(character)) { stoppedOnPurpose = true; stop(); }
        util.status("waiting for " + far.join(", "), "yellow");
        waitShown = true;
        return true;
    }

    // A member below party.toHealerBelow HP walks into the healer's range (player decision 2026-11-21,
    // from earthiverse): with the members walking ahead on their own, one may end up out of reach.
    let toHealerAt = 0;
    function toHealer() {
        const pc = config.party || {};
        if (!party.enabled || party.isLeader || !pc.toHealerBelow || util.hpRatio() >= pc.toHealerBelow || character.ctype === "priest") return false;
        const healer = party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
            .find(function (p) { return p && !p.rip && util.isHealer(p); });
        if (!healer) return false;
        const reach = (healer.range || 200) * 0.8;
        if (util.distanceTo(healer) <= reach) return false;
        util.status("to " + healer.name + " for heals", "orange");
        if (Date.now() - toHealerAt > 500) {
            toHealerAt = Date.now();
            const p = util.xy(healer);
            try { Promise.resolve(xmove(p.x, p.y)).catch(function () {}); } catch (e) { /* next tick */ }
        }
        return true;
    }
    let journalMap = null; // map changes go into the decision journal (util.journal, 2026-11-21)
    function tick() {
        if (character.map !== journalMap) {
            if (journalMap !== null) util.journal("[map] " + journalMap + " -> " + character.map);
            journalMap = character.map;
        }
        if (handleDeath()) return;
        samplePotions();
        if (!party.enabled || party.isLeader) meterReport(false); // the leader sees the whole team
        if (!cls.survive()) handlePotions();
        if (cls.always) cls.always(); // every tick, also while a trip keeps the loop busy
        lootChests();
        party.manage();
        // Leader: share position every tick – also while searching, travelling or at Daisy,
        // so members never lose track (party.broadcast throttles itself).
        party.broadcast(lastFarm, lastTarget, ctx.events.current());
        ctx.gear.tick();
        if (cavalryTick() === true) return; // walking to a grown pack for the Cavalry
        if (leaveRageZone()) return; // standing in a rage zone we can't take: out first (2026-11-22)
        if (keepClearOfZones()) return; // standing next to one: on to rageMargin first (2026-11-22)
        if (busyStep()) { defendInPlace(); return; }
        // Kiting comes before healing and covering (2026-11-21): the priest alone with a Phoenix
        // healed itself every tick (cls.support ends the tick) and never stepped back - the Phoenix
        // stood 13 px off and hit it all along. Heals and attacks still fire while we walk; the
        // kite step in handleCombat is throttled and does not move twice.
        const aimed = get_targeted_monster();
        const kited = kiteStep(aimed && !aimed.dead ? aimed : null);
        if (!kited && toHealer()) return;
        const covering = !kited && coverMembers();
        if (cls.support()) {
            // Healing while passing through: keep walking (a priest healing the warrior every tick
            // never got to travel on - 2026-11-19).
            if (!covering && passing && Date.now() < passing.until && !is_moving(character)) travel(passing.dest, "passing");
            return;
        }
        if (covering) return;
        handleCombat();
    }

    // ---- rage zones as walls for the path search (player decision 2026-11-22) ------------
    // A path walk (smart_move) plans its route without knowing rage zones - the priest walked right through the big
    // booboo zone on his way out. Detours after the fact (the route guard, removed 2026-11-22) went round in circles
    // (the next plan crossed the zone again), and three fighters died at the booboo zones on the way past. So the CODE frame's own can_move - the one smart_move's path search (bfs) asks
    // for every step, and can_move_to too - refuses a step that ends in, or passes through, a rage box, grown by
    // travel.rageMargin. Every rage box is a wall except the walk's goal zone and our farm target's zones the team
    // can take. A step that STARTS inside that grown box is always allowed: whoever stands there
    // can walk out. Only this frame's copy is wrapped (the game's data stays as it is); installed once per page.
    // Walls with a fallback (2026-11-22): priest and warrior stood in the strip between the mummy zone and the big
    // booboo zone (each +100 px) - with the walls only 90 grid cells were reachable, without them 7111, and every walk
    // ended in "Path not found!". So a failed path search narrows the margin (rageWallSteps: 100 -> 50 -> 0 = box only
    // -> walls off) and the walk is planned anew. A finished walk, or 2 minutes, bring the full margin back.
    let rageWallLevel = 0, rageWallAt = 0;
    function rageWallSteps() {
        const tc = config.travel || {};
        return tc.rageWallSteps || [tc.rageMargin || 100, 50, 0, -1];
    }
    function rageWallPad() {
        if (rageWallLevel && Date.now() - rageWallAt > 120 * 1000) rageWallLevel = 0;
        const steps = rageWallSteps();
        return steps[Math.min(rageWallLevel, steps.length - 1)];
    }
    function rageWallLoosen() {
        const tc = config.travel || {};
        if (tc.rageWalls === false) return false;
        const steps = rageWallSteps();
        if (rageWallLevel >= steps.length - 1) return false;
        rageWallLevel++;
        rageWallAt = Date.now();
        const pad = steps[rageWallLevel];
        util.log("move", "no path with the rage walls - " + (pad < 0 ? "walls off" : "margin " + pad + " px") + " for this walk", "orange");
        return true;
    }
    function rageWallReset() { rageWallLevel = 0; }
    (function installRageWalls() {
        const W = window;
        if (!W.__dmpxOrigCanMove) W.__dmpxOrigCanMove = W.can_move;
        const orig = W.__dmpxOrigCanMove;
        if (typeof orig !== "function") return;
        let cache = { at: 0, map: null, boxes: [] };
        function blocked(mapName) {
            const tc = config.travel || {};
            if (tc.rageWalls === false || !targeting.rageBoxes) return [];
            const now = Date.now();
            const pad = rageWallPad();
            if (pad < 0) return [];
            // The walk's own goal (smart.x/y): its zone is no wall - that is where we want to go, the spot check decides there.
            const goal = typeof smart !== "undefined" && smart && smart.map === mapName && typeof smart.x === "number" ? { x: smart.x, y: smart.y } : null;
            const gk = goal ? Math.round(goal.x) + "," + Math.round(goal.y) : "";
            // Our farm target's zones the team can take stay open too (2026-11-22: the spot check accepted the reset
            // 4-booboo zone, but the priest could hardly step in - every step into it was a wall).
            const fn = targeting.farmNow ? targeting.farmNow() : null;
            const farmType = fn && fn.monster && mapName === character.map ? fn.monster : null;
            if (cache.map === mapName && cache.pad === pad && cache.goal === gk && cache.farm === farmType && now - cache.at < 2000) return cache.boxes;
            const boxes = [];
            targeting.rageBoxes(mapName).forEach(function (z) {
                if (farmType && z.type === farmType && targeting.failingZoneAt && !targeting.failingZoneAt({ x: (z.b[0] + z.b[2]) / 2, y: (z.b[1] + z.b[3]) / 2 })) return;
                // Every rage zone on the way is a wall (2026-11-22), not only the ones the team can't take: with the
                // warrior next to him the booboo zone counted as takeable, and the priest walked right through it.
                if (goal && goal.x >= z.b[0] && goal.x <= z.b[2] && goal.y >= z.b[1] && goal.y <= z.b[3]) return;
                boxes.push([z.b[0] - pad, z.b[1] - pad, z.b[2] + pad, z.b[3] + pad]);
            });
            cache = { at: now, map: mapName, pad: pad, goal: gk, farm: farmType, boxes: boxes };
            return boxes;
        }
        // Liang-Barsky: does the segment touch the box?
        function segTouches(x0, y0, x1, y1, b) {
            let t0 = 0, t1 = 1;
            const dx = x1 - x0, dy = y1 - y0;
            const p = [-dx, dx, -dy, dy], q = [x0 - b[0], b[2] - x0, y0 - b[1], b[3] - y0];
            for (let i = 0; i < 4; i++) {
                if (p[i] === 0) { if (q[i] < 0) return false; continue; }
                const r = q[i] / p[i];
                if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
                else { if (r < t0) return false; if (r < t1) t1 = r; }
            }
            return true;
        }
        // Every path walk (travel, following the leader, revives...) retries with a narrower margin when the search
        // finds no way (2026-11-22: the ranger following the priest got "Path not found!" over and over).
        // Leaving a map by a safe one (travel.leaveVia, 2026-11-22): from Spooky Town to anywhere else the path search
        // took spookytown -> level2 -> level1 -> main, right past the level-20 Vampire Rats (aggro 1, 9,200 HP) - priest
        // and ranger walked through them on the way to pick up the warrior. Every path walk (travel, following, the
        // merchant pickup, bank and potion walks) that leaves such a map for another one first goes to the safe map.
        // A goal whose map can't be told (an unknown name) walks as asked.
        function destMap(d) {
            if (!d) return null;
            if (typeof d === "object") {
                if (d.map) return d.map;
                d = d.to;
                if (!d) return null;
            }
            if (typeof d !== "string") return null;
            if (G.maps[d]) return d;
            if (/^(bank|potions|upgrade|compound|exchange|scrolls|town)$/.test(d)) return "main";
            const names = Object.keys(G.maps).filter(function (m) { return !G.maps[m].ignore && !G.maps[m].instance; });
            const byMonster = names.find(function (m) { return (G.maps[m].monsters || []).some(function (p) { return p.type === d; }); });
            if (byMonster) return byMonster;
            return names.find(function (m) { return (G.maps[m].npcs || []).some(function (n) { return n.id === d; }); }) || null;
        }
        function leaveLeg(d) {
            const lv = ((config.travel || {}).leaveVia || {})[character.map];
            if (!lv) return null;
            const to = destMap(d);
            if (!to || to === character.map || to === lv) return null;
            // A direct neighbour (a door from here, e.g. spookytown -> level2) is walked to directly.
            if (((G.maps[character.map] || {}).doors || []).some(function (dr) { return dr[4] === to; })) return null;
            return { map: lv };
        }
        if (!W.__dmpxOrigSmartMove && typeof W.smart_move === "function") {
            W.__dmpxOrigSmartMove = W.smart_move;
            W.smart_move = function () {
                const self = this, args = arguments;
                function run(a) {
                    return W.__dmpxOrigSmartMove.apply(self, a).catch(function (e) {
                        const why = util.errReason(e);
                        if (/path not found|failed/i.test(why) && rageWallLoosen()) return run(a);
                        // Not even without walls (2026-11-22): the goal itself is unreachable - the walls weren't the
                        // reason, so the full margin is back at once instead of walls off for 2 minutes.
                        rageWallReset();
                        throw e;
                    });
                }
                let leg = null;
                try { leg = leaveLeg(args[0]); } catch (e) { /* walk as asked */ }
                const first = leg ? run([leg]) : Promise.resolve();
                return first.then(function () { return run(args); }).then(function (r) { rageWallReset(); return r; });
            };
        }
        W.can_move = function (m, based) {
            if (!orig.apply(this, arguments)) return false;
            if (based || !m || !m.map || typeof m.going_x !== "number") return true;
            try {
                const boxes = blocked(m.map);
                for (const b of boxes) {
                    if (m.x >= b[0] && m.x <= b[2] && m.y >= b[1] && m.y <= b[3]) continue; // starts inside: may walk out
                    if (segTouches(m.x, m.y, m.going_x, m.going_y, b)) return false;
                }
            } catch (e) { /* walls are a help, never a blocker */ }
            return true;
        };
    })();

    // Standing still within travel.rageMargin of a rage zone the team can't take (outside it): a step out to the margin
    // first (2026-11-22: after "Path not found!" the warrior stood 13 px off the big booboo zone and was taken). Not
    // while a path walk runs (the rage walls plan those).
    let clearLogged = 0;
    function keepClearOfZones() {
        if (!targeting.failingZoneNear) return false;
        if (typeof smart !== "undefined" && smart.moving) return false;
        const margin = ((config.travel || {}).rageMargin) || 100;
        const me = util.xy(character);
        const z = targeting.failingZoneNear(me, margin);
        if (!z || z.gap <= 0) return false; // inside: leaveRageZone
        const b = z.b;
        const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
        let dx = me.x - nx, dy = me.y - ny;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const want = margin + 40;
        let p = { x: nx + dx * want, y: ny + dy * want };
        if (!can_move_to(p.x, p.y)) {
            // Any of 16 directions, 140 px, that ends farthest from the box.
            let best = null, bestGap = -1;
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8, q = { x: me.x + Math.cos(a) * 140, y: me.y + Math.sin(a) * 140 };
                if (!can_move_to(q.x, q.y)) continue;
                const g = Math.hypot(Math.max(b[0] - q.x, 0, q.x - b[2]), Math.max(b[1] - q.y, 0, q.y - b[3]));
                if (g > bestGap) { bestGap = g; best = q; }
            }
            if (!best || bestGap <= z.gap) return false;
            p = best;
        }
        if (Date.now() - clearLogged > 30 * 1000) {
            clearLogged = Date.now();
            util.log("move", "standing " + Math.round(z.gap) + " px from the " + z.type + " rage zone - moving off to " + margin + " px", "orange");
        }
        moveTo(p);
        util.status("away from the " + z.type + " zone", "orange");
        return true;
    }
    let lastRing = null; // { map, type, ring, at }
    function boxGap(p, b) {
        return Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[2]), Math.max(b[1] - p.y, 0, p.y - b[3]));
    }
    function holdRingStep(boss, type) {
        if (!targeting.bossHoldRing || !targeting.holdingBoss) return false;
        const now = Date.now();
        if (boss && !boss.dead) {
            if (!targeting.holdingBoss(boss)) { lastRing = null; return false; } // the team is here, or not held
            const ring = targeting.bossHoldRing(boss);
            lastRing = ring ? { map: character.map, type: type, ring: ring, at: now } : null;
        }
        const r = lastRing && lastRing.map === character.map && lastRing.type === type && now - lastRing.at < 60 * 1000 ? lastRing.ring : null;
        if (!r) return false;
        const me = util.xy(character), b = r.box;
        const gap = boxGap(me, b);
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        // The nearest box point, and the way out from it (from the middle when we stand inside).
        const nx = Math.max(b[0], Math.min(b[2], me.x)), ny = Math.max(b[1], Math.min(b[3], me.y));
        let dx = gap > 0 ? me.x - nx : me.x - cx, dy = gap > 0 ? me.y - ny : me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        if (gap < r.margin || (gap > r.margin + 150 && boss && !boss.dead)) {
            const want = r.margin + 30;
            let p = { x: nx + dx * want, y: ny + dy * want };
            if (!can_move_to(p.x, p.y)) {
                // Around the box: the side nearest to us that we can reach in a straight line.
                const sides = [{ x: b[0] - want, y: me.y }, { x: b[2] + want, y: me.y }, { x: me.x, y: b[1] - want }, { x: me.x, y: b[3] + want }]
                    .sort(function (a, c) { return Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(c.x - me.x, c.y - me.y); });
                p = sides.find(function (s) { return can_move_to(s.x, s.y); }) || p;
            }
            moveTo(p);
            util.status("waiting outside the " + type + " spawn", "yellow");
            return true;
        }
        if (is_moving(character) && !(typeof smart !== "undefined" && smart.moving)) stop();
        util.status("waiting outside the " + type + " spawn", "yellow");
        return true;
    }

    // Rage zones (2026-11-22, targeting.zoneAt): standing in one whose whole spawn we can't take, we
    // step out - waiting, resting, a handover or a stopped walk there pulled all 5 booboos. Not while a
    // path walk only passes through (the game's route; waypoints keep us off the worst maps) - a walk
    // that ends in the zone is stopped, and a member's walk into a failing zone is stopped on its map.
    // Members too (no exception for the leader's farm spawn any more, see below).
    let rageLogged = 0;
    function leaveRageZone() {
        if (!targeting.rageZoneHere) return false;
        // Members: no path walk INTO a failing rage zone at all - stopped as soon as we are on its map (the leader
        // walks on to the edge, where its spot check stops it).
        if (party.enabled && party.isMember && typeof smart !== "undefined" && smart.moving && smart.map === character.map &&
            targeting.failingZoneAt && targeting.failingZoneAt({ x: smart.x, y: smart.y })) {
            stoppedOnPurpose = true;
            try { stop("smart"); } catch (e) { /* not walking */ }
            if (Date.now() - rageLogged > 30 * 1000) { rageLogged = Date.now(); util.log("combat", "not walking into a rage zone the team can't take - waiting for " + config.leader, "orange"); }
            return false; // the follow logic decides the next step
        }
        const z = targeting.rageZoneHere();
        if (!z) return false;
        // A path walk passing through may go on - one that ENDS in the zone is stopped (2026-11-22: the warrior's
        // walk to the leader's route end, the middle of the booboo spawn, ran on into it).
        if (typeof smart !== "undefined" && smart.moving) {
            const endsHere = smart.map === character.map && typeof smart.x === "number" &&
                smart.x >= z.b[0] && smart.x <= z.b[2] && smart.y >= z.b[1] && smart.y <= z.b[3];
            if (!endsHere) return false;
            stoppedOnPurpose = true;
            try { stop("smart"); } catch (e) { /* not walking */ }
        }
        // Members too: rageZoneHere only names zones the team model (members have the team's stats) or our own
        // check fails - no "the leader farms it" exception any more (2026-11-22: two deaths at the booboos).
        const me = util.xy(character), b = z.b;
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        // The nearest way out: each side of the box, 80 px beyond it, nearest first.
        const outs = [
            { x: b[0] - 80, y: me.y }, { x: b[2] + 80, y: me.y },
            { x: me.x, y: b[1] - 80 }, { x: me.x, y: b[3] + 80 },
        ].sort(function (p, q) { return Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y); });
        let p = outs.find(function (o) { return can_move_to(o.x, o.y); });
        if (!p) { // away from the middle, whatever is free
            const dx = me.x - cx, dy = me.y - cy, len = Math.hypot(dx, dy) || 1;
            p = { x: me.x + dx / len * 200, y: me.y + dy / len * 200 };
        }
        if (Date.now() - rageLogged > 30 * 1000) {
            rageLogged = Date.now();
            util.log("combat", "standing in the " + z.type + " rage zone (" + z.why + ") - stepping out", "orange");
        }
        moveTo(p);
        util.status("leaving the " + z.type + " rage zone", "orange");
        return true;
    }

    // True while something else than the fight decides where we go this tick.
    function busyStep() {
        if (waitForTeam()) return true;
        if (supply.tick() === "busy") return true;
        if (ctx.events.tick() === "busy") return true;
        // No Daisy trips during events or a boss fight (a paused boss too, 2026-11-21); one on its
        // way is stopped.
        if (ctx.events.bossBusy()) ctx.hunts.abort();
        else if (!ctx.events.current() && ctx.hunts.tick() === "busy") return true;
        const ev = ctx.events.current();
        if (ev && ev.solo) return false; // runner fighting its solo boss away from the team (events runner)
        // The event's boss in our own sight: fight it, no leash (player decision 2026-11-21: anyone
        // may open on a boss alone, holdForTeam off). The warrior found a Phoenix in the cave at
        // 11:54Z and only watched it until the ranger came - keepUp held it at the sighting point
        // the leader travelled to while the Phoenix moved on. Held bosses (events.holdFor) stay
        // held by targeting; a boss out of sight still means following as before.
        if (ev && ev.monster && !character.rip) {
            const b = get_nearest_monster({ type: ev.monster });
            if (b && !b.dead) return false;
        }
        if (party.keepUp(!!(ev && ev.join))) return true;
        if (party.leaderTravels && party.leaderTravels()) { party.idleFollow(); return true; } // no fights on the way
        return false;
    }

    // A healer leader stays with a member under attack instead of walking on to the next spot
    // (2026-11-19: the priest left for the arctic bees, the warrior left the mummies alone and
    // died). Moves into heal range; heals go on as usual (cls.support).
    let coverMoveAt = 0;
    function coverMembers() {
        if (!party.enabled || !party.isLeader) return false;
        const heal = G.skills.heal;
        if (!heal || !(heal.class || []).includes(character.ctype)) return false;
        let worst = null;
        party.memberNames().forEach(function (n) {
            if (n === character.name) return;
            const p = get_player(n);
            if (!p || p.rip || p.map !== character.map) return;
            const hit = Object.values(parent.entities || {}).some(function (e) { return e && e.type === "monster" && !e.dead && e.target === n; });
            if (!hit) return;
            const d = util.distanceTo(p);
            if (d > (character.range || 200) * 0.95 && (!worst || d > worst.d)) worst = { p: p, d: d };
        });
        if (!worst) return false;
        util.status("covering " + worst.p.name, "yellow");
        // Only into heal range (85 %), not onto the member (2026-11-21: the priest kited the
        // Phoenix to 90 % of its range, walked onto the warrior next to it at 80 %, and so on).
        // A straight line: walk to that point. Behind a wall: a path to the member itself (walkable),
        // through moveTo, which does not restart a running path search every 0.7 s - the priest stood
        // "covering" off the giant scorpion spot while each new order cut the search off (2026-11-21).
        if (Date.now() - coverMoveAt > 700) {
            coverMoveAt = Date.now();
            const me = util.xy(character), to = util.xy(worst.p);
            const f = 1 - (character.range || 200) * 0.85 / Math.max(1, worst.d);
            const x = me.x + (to.x - me.x) * f, y = me.y + (to.y - me.y) * f;
            if (can_move_to(x, y)) { moveDest = { x: x, y: y }; quiet(move(x, y)); }
            else moveTo(to);
        }
        return true;
    }

    async function loop() {
        running = true;
        util.log("bot", "fighter started (" + cls.name + (party.enabled ? ", party " + (party.isLeader ? "leader" : "member") : ", solo") + ")", "green");
        strikeLoop();
        while (running) {
            try {
                tick();
                util.heartbeat(); // member watchdog (main.js): only after a step went through
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
