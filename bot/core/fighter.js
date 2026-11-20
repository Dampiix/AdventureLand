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
    // A move promise rejects when the next move interrupts it: swallow it (the log filled with "{}", 2026-11-18).
    function quiet(p) { if (p && p.catch) p.catch(function () {}); return p; }
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
            return !!p && !p.rip && p.ctype === "priest" && util.distanceTo(p) < 600;
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
    function handlePotions() {
        const loss = hpLossRate();
        if (is_on_cooldown("use_hp")) return;
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
        if (hp < (c.hpCriticalBelow || 0.3)) use_skill("use_hp").catch(function () {});
        else if (mpEmpty || (mp < c.potionMpBelow && hp >= 0.5)) use_skill("use_mp").catch(function () {});
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

    function travel(destination, label) {
        util.status(label, "yellow");
        if (!is_moving(character)) {
            const id = Date.now();
            searchWalk = id;
            smart_move(destination).then(function () {
                if (searchWalk === id) searchWalk = 0;
            }).catch(function (e) {
                if (searchWalk === id) searchWalk = 0;
                if (stoppedOnPurpose) { stoppedOnPurpose = false; return; } // we stopped it for a target
                util.log("move", "route to " + JSON.stringify(destination) + " failed: " + util.errReason(e), "red");
            });
        } else if (cls.move) {
            cls.move(null); // e.g. Warrior Charge on the way
        }
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
    function moveTo(p) {
        if (is_moving(character) && moveDest && Math.hypot(moveDest.x - p.x, moveDest.y - p.y) < 40) return;
        moveDest = { x: p.x, y: p.y };
        quiet(xmove(p.x, p.y));
    }

    // Kiting (config.combat.kite, solo; player decision 2026-11-18): a fighter that outranges
    // and outruns a monster steps back when that monster would reach it before it dies - not
    // for ones that die in time (1-2 hits). The step leads away from everything on us and from
    // other free monsters. Attacks go on while walking.
    let lastKite = 0;
    let escape = null; // { x, y, until }: a way out of a corner we are walking
    function kiteStep(target) {
        const k = config.combat.kite;
        if (!k || !k.enabled) return false;
        // In a party too (player decision 2026-11-18): only monsters on us count anyway, and not
        // every team has a taunting tank. There the step prefers the way to a tank class and
        // never leaves the leash around the leader.
        const team = kiteTeam();
        const attackers = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === character.name;
        });
        if (!attackers.length) return false;
        const myRange = character.range || 0, mySpeed = character.speed || 0;
        let threat = null, threatTime = Infinity;
        for (const m of attackers) {
            const def = G.monsters[m.mtype] || {};
            const mRange = m.range || def.range || 20, mSpeed = m.speed || def.speed || 0;
            if (myRange < mRange + (k.margin || 30) || mSpeed >= mySpeed * 0.9) return false; // can't kite this one
            let dist;
            try { dist = parent.distance(character, m); } catch (e) { dist = util.distanceTo(m); }
            if (dist > mRange + (k.margin || 30)) continue; // still far enough
            // Would it reach us before it dies? The target dies after its HP / our damage per
            // second; any other attacker only after the target.
            const myDef = (def.armor || 0) - (character.apiercing || 0);
            const myDps = Math.max(1, (character.attack || 0) * (character.frequency || 1) * util.damageMultiplier(myDef));
            const killSec = (m === target ? m.hp : m.hp + (target ? target.hp : 0)) / myDps;
            const reachSec = Math.max(0, dist - mRange) / Math.max(1, mSpeed);
            if (killSec <= reachSec) continue; // dies first
            if (reachSec < threatTime) { threat = m; threatTime = reachSec; }
        }
        if (!threat) return false;
        if (is_moving(character) && Date.now() - lastKite < (k.everyMs || 600)) return true;
        const me = util.xy(character);
        let cx = 0, cy = 0;
        attackers.forEach(function (m) { const p = util.xy(m); cx += p.x; cy += p.y; });
        cx /= attackers.length; cy /= attackers.length;
        let dx = me.x - cx, dy = me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const free = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && !e.target;
        }).map(util.xy);
        const step = k.step || 60;
        // Never out of our own range of the target (player rule 2026-11-19: the Viz ranger kited a
        // long way off and could not shoot any more) - every step and every way out stays within it.
        const aim = target ? util.xy(target) : util.xy(threat);
        const inReach = function (x, y) { return Math.hypot(x - aim.x, y - aim.y) <= myRange * 0.95; };
        let best = null, bestScore = -Infinity;
        for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
            const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
            const x = me.x + ux * step, y = me.y + uy * step;
            if (!can_move_to(x, y)) continue;
            if (!inReach(x, y)) continue;
            // Away from the pack, and not next to free monsters (they would join).
            const crowd = free.filter(function (p) { return Math.hypot(p.x - x, p.y - y) < (k.avoidRadius || 120); }).length;
            if (!team.allows(x, y)) continue;
            const score = Math.hypot(x - cx, y - cy) - crowd * 100 - Math.abs(turn) * 10 + team.towardTank(me, x, y);
            if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
        }
        if (!best) {
            // Cornered (no straight step back is free): run to open ground instead of standing
            // and tanking (player idea 2026-11-18) - a point 150-300 px away, far from the pack,
            // with no free monster near, open in most directions (through the pack is fine).
            // Keep walking a chosen way out for a few seconds: a new path every 0.6 s with the back
            // to a wall gave "Lost the path..." again and again (Viz priest, 2026-11-19).
            if (escape && Date.now() < escape.until && is_moving(character)) {
                util.status("kiting " + threat.mtype + " - out of the corner", "orange");
                return true;
            }
            const esc = escapePoint(me, { x: cx, y: cy }, free, k, team);
            if (!esc || !inReach(esc.x, esc.y)) return false; // nowhere to go within range: stand and fight
            lastKite = Date.now();
            escape = { x: esc.x, y: esc.y, until: Date.now() + 4000 };
            // A straight line needs no path search (the search is what loses the path).
            if (can_move_to(esc.x, esc.y)) quiet(move(esc.x, esc.y)); else quiet(xmove(esc.x, esc.y));
            util.status("kiting " + threat.mtype + " - out of the corner", "orange");
            return true;
        }
        lastKite = Date.now();
        escape = null;
        quiet(move(best.x, best.y));
        util.status("kiting " + threat.mtype, "orange");
        return true;
    }
    // Party rules for kiting: points within the leash around the leader; a bonus for steps
    // towards a tank class (config.targeting.teamSafety.tankClasses) that can take the monster.
    function kiteTeam() {
        const none = { allows: function () { return true; }, towardTank: function () { return 0; } };
        if (!party.enabled) return none;
        const lead = party.leaderInfo();
        const leash = (config.party && config.party.leash) || 300;
        const tanks = ((config.targeting.teamSafety || {}).tankClasses) || [];
        let tank = null;
        party.memberNames().forEach(function (n) {
            if (n === character.name || tank) return;
            const p = get_player(n);
            if (p && !p.rip && tanks.includes(p.ctype)) tank = util.xy(p);
        });
        return {
            allows: function (x, y) { return !lead || Math.hypot(x - lead.x, y - lead.y) <= leash * 0.9; },
            towardTank: function (me, x, y) { return tank ? (Math.hypot(me.x - tank.x, me.y - tank.y) - Math.hypot(x - tank.x, y - tank.y)) * 0.8 : 0; },
        };
    }
    function escapePoint(me, pack, free, k, team) {

        let best = null, bestScore = -Infinity;
        for (const r of [150, 220, 300]) {
            for (let i = 0; i < 16; i++) {
                const a = i * Math.PI / 8;
                const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
                // Through the pack is fine: monsters don't block the way, and they hit us anyway
                // while we stand in reach (player note 2026-11-18). Only free ones are avoided.
                if (free.some(function (p) { return Math.hypot(p.x - x, p.y - y) < (k.avoidRadius || 120); })) continue;
                let open = 0;
                for (let j = 0; j < 8; j++) {
                    const b = j * Math.PI / 4;
                    if (canMoveFrom(x, y, x + Math.cos(b) * 60, y + Math.sin(b) * 60)) open++;
                }
                if (open < 4) continue; // another corner
                if (team && !team.allows(x, y)) continue;
                const score = Math.hypot(x - pack.x, y - pack.y) + open * 25 - r * 0.2;
                if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
            }
        }
        return best;
    }
    // Walkable straight line between two points (not only from where we stand).
    // Party spacing (player request 2026-11-18): with a tank class near, ranged fighters stay out of
    // the melee reach of the monsters around - priest, ranger and warrior stood on one spot at the
    // booboos and some went for the ranged ones. Monsters reaching farther than we shoot (booboos,
    // 420) can't be outranged: from those we keep party.spacing.gap px, so the tank in melee is the
    // one closest to them. We stay in range of our target and on the leash.
    let lastSpace = 0;
    function spacingStep(target) {
        const sp = (config.party && config.party.spacing) || {};
        if (!sp.enabled || !party.enabled || is_moving(character) || Date.now() - lastSpace < (sp.everyMs || 700)) return false;
        const myRange = character.range || 0;
        const tanks = ((config.targeting.teamSafety || {}).tankClasses) || [];
        if (myRange < (sp.minOwnRange || 100) || tanks.includes(character.ctype)) return false;
        const tank = party.memberNames().map(function (n) { return n === character.name ? null : get_player(n); })
            .find(function (p) { return p && !p.rip && tanks.includes(p.ctype) && util.distanceTo(p) < 400; });
        if (!tank) return false;
        const margin = sp.margin || 50;
        const reachOf = function (m) { return m.range || (G.monsters[m.mtype] || {}).range || 20; };
        const keep = function (m) { const r = reachOf(m) + margin; return r < myRange ? r : Math.min(sp.gap || 130, myRange - 20); };
        const close = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) < keep(e);
        });
        if (!close.length) return false;
        const me = util.xy(character);
        const mid = close.reduce(function (a, e) { const p = util.xy(e); return { x: a.x + p.x / close.length, y: a.y + p.y / close.length }; }, { x: 0, y: 0 });
        const team = kiteTeam();
        const t = target ? util.xy(target) : null;
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8;
            const x = me.x + Math.cos(a) * (sp.step || 80), y = me.y + Math.sin(a) * (sp.step || 80);
            if (!canMoveFrom(me.x, me.y, x, y) || !team.allows(x, y)) continue;
            if (t && Math.hypot(t.x - x, t.y - y) > myRange - 15) continue; // keep shooting
            const clear = Math.min.apply(null, close.map(function (e) { const p = util.xy(e); return Math.hypot(p.x - x, p.y - y) - keep(e); }));
            const score = clear + Math.hypot(x - mid.x, y - mid.y) * 0.3;
            if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
        }
        if (!best) return false;
        lastSpace = Date.now();
        quiet(move(best.x, best.y));
        util.status("keeping distance (" + close.length + " close)", "white");
        return true;
    }
    function canMoveFrom(x1, y1, x2, y2) {
        try {
            return !!parent.can_move({ map: character.map, x: x1, y: y1, going_x: x2, going_y: y2, base: character.base });
        } catch (e) { return true; }
    }

    let passing = null; // { until, dest } while we pass through attackers on the way
    // Leave a fight with another kind than the farm target (player request 2026-11-19): after
    // combat.passThrough.leaveAfterMs of such fighting we walk out towards the target - the
    // warrior stood in the mummies' rage zone, they kept pulling him and the team never left
    // for the new spot. Every fighter (members too), any speed, any HP; a 5 s pause starts over.
    let offSince = 0, offSeen = 0, leaveLogged = 0;
    function stuckOffTarget(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.leaveAfterMs || !farm || farm.any || !farm.monster || !target || target.mtype === farm.monster) { offSince = 0; return false; }
        const now = Date.now();
        if (!offSince || now - offSeen > 5000) offSince = now;
        offSeen = now;
        if (now - offSince < pt.leaveAfterMs) return false;
        if (now - leaveLogged > 60 * 1000) { leaveLogged = now; util.log("combat", "still fighting " + target.mtype + " after " + Math.round((now - offSince) / 1000) + " s - leaving for " + farm.monster, "yellow"); }
        return true;
    }
    function passThrough(farm, target) {
        const pt = config.combat.passThrough || {};
        if (!pt.enabled || !farm || farm.any || !farm.monster || target.mtype === farm.monster) { offSince = 0; return false; }
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
            travel(farm.dest || targeting.spotFor(farm.monster, farm.map) || farm.monster, "searching " + farm.monster);
            return;
        }
        // Only time actually fighting counts for the crowded-spot check: running after a
        // monster that another player kills on the way is time without a target too.
        // A monster attacking one of us counts as work too, in our range or not: after the
        // warrior's Agitate the leader saw no free bee in its own range, called the spot crowded
        // and the party shuttled between bee spots (2026-11-18).
        const busy = !!target && (is_in_range(target) || (target.target && (target.target === character.name || party.memberNames().includes(target.target))));
        targeting.reportSearch(busy);
        lastFarm = farm;
        lastTarget = target;

        if (!target) {
            if (party.idleFollow()) return; // party member: stay with the leader
            if (farm.any) { util.status("waiting for monsters (" + farm.source + ")", "white"); return; }
            // A Cavalry plan walks right into the spot (the call needs the monsters within 320 px).
            const hold = String(farm.source || "").startsWith("cavalry") ? null : targeting.waitForLone(farm.monster);
            if (hold) {
                // Waiting for a lone one: from the edge of the spawn, where the whole box is in
                // sight (player request 2026-11-19) - not wherever the first one came into view.
                const wp = hold === "lone" && targeting.watchPoint ? targeting.watchPoint(farm.monster) : null;
                if (wp && util.distanceTo(wp) > 40) moveTo(wp);
                else endSearchWalk();
                util.status((hold === "strong" ? "too strong: " : "waiting for a lone ") + farm.monster, "white");
                return;
            }
            travel(farm.dest || targeting.spotFor(farm.monster, farm.map) || farm.monster, "searching " + farm.monster);
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
        if (can_attack(target)) attack(target).catch(function () {});
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
            if (these.length && these.length >= Math.min(cv.planMinCount || 5, seen)) callCavalry(src.slice(8) + " " + these.length + "x " + lastFarm.monster + " (levels " + these.map(function (e) { return e.level || 1; }).join(",") + ")");
            return;
        }
        if (!cv.reset) return;
        const big = all.filter(function (e) { return grown(e) && e.mtype === lastFarm.monster && (e.level || 1) >= (cv.resetFromLevel || 5); });
        if (big.length >= (cv.resetMinCount || 2)) {
            callCavalry("reset " + big.length + "x " + lastFarm.monster + " (levels " + big.map(function (e) { return e.level || 1; }).join(",") + ")");
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
        const fighters = (config.team && config.team.fighters) || [];
        const far = party.memberNames().filter(function (n) {
            if (n === character.name || !fighters.includes(n)) return false;
            const info = (get_party() || {})[n] || {};
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

    function tick() {
        if (handleDeath()) return;
        samplePotions();
        if (!party.enabled || party.isLeader) meterReport(false); // the leader sees the whole team
        if (!cls.survive()) handlePotions();
        if (cls.always) cls.always(); // every tick, also while a trip keeps the loop busy
        loot();
        party.manage();
        // Leader: share position every tick – also while searching, travelling or at Daisy,
        // so members never lose track (party.broadcast throttles itself).
        party.broadcast(lastFarm, lastTarget, ctx.events.current());
        ctx.gear.tick();
        cavalryTick();
        if (waitForTeam()) return;
        if (supply.tick() === "busy") return;
        if (ctx.events.tick() === "busy") return;
        if (!ctx.events.current() && ctx.hunts.tick() === "busy") return; // no Daisy trips during events
        const ev = ctx.events.current();
        if (party.keepUp(!!(ev && ev.join))) return;
        if (party.leaderTravels && party.leaderTravels()) { party.idleFollow(); return; } // no fights on the way
        const covering = coverMembers();
        if (cls.support()) {
            // Healing while passing through: keep walking (a priest healing the warrior every tick
            // never got to travel on - 2026-11-19).
            if (!covering && passing && Date.now() < passing.until && !is_moving(character)) travel(passing.dest, "passing");
            return;
        }
        if (covering) return;
        handleCombat();
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
            if (d > (character.range || 200) * 0.8 && (!worst || d > worst.d)) worst = { p: p, d: d };
        });
        if (!worst) return false;
        util.status("covering " + worst.p.name, "yellow");
        if (Date.now() - coverMoveAt > 700) {
            coverMoveAt = Date.now();
            try { xmove(worst.p.x, worst.p.y); } catch (e) { move(worst.p.x, worst.p.y); }
        }
        return true;
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
