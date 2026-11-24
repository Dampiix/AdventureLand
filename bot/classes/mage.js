// =====================================================================
// bot_class_mage – Mage skills.
//   support: Energize (lvl 20) – give mana to the party member that runs
//            lowest on MP (e.g. the priest), while we have plenty
//   fight:   basic attacks; Mana Burst (whole MP pool as damage) only when
//            enabled in config, because it empties the mage
//   always:  Blaster mode (v1.224.6) – the carried Blaster (great staff, blast
//            splash) goes on for a pack, staff + book come back afterwards
// =====================================================================

module.exports = function createMage(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.mage;

    function energizeTarget() {
        let best = null;
        ctx.party.memberNames().forEach(function (name) {
            if (name === character.name) return;
            const p = get_player(name);
            if (!p || p.rip || !p.max_mp) return;
            const ratio = p.mp / p.max_mp;
            if (ratio >= c.energizeBelow) return;
            if (!is_in_range(p, "energize")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio, missing: p.max_mp - p.mp };
        });
        return best;
    }

    // ---- Energize and Reflective Shield (v1.225.7, player decision 2026-11-23) ------------------------------------
    // Energize costs no MP itself: it hands over the MP we pass and gives the target "energized" (+80 % attack speed for
    // 0.8 s; cooldown 4 s, range 320). 1) MP to a member below energizeBelow, keeping energizeAbove of ours (the Blaster
    // needs it); 2) else a speed burst (1 MP) on the strongest damage dealer that is fighting - solo ourselves - for us
    // timed just before our next attack. The server counts both as our party contribution (XP share).
    let selfEnergizeOk = true, energizeLogAt = 0;
    function fighting(p) { return !!(p && !p.rip && (p.target || (p === character && get_targeted_monster()))); }
    function burstTarget() {
        let best = null, bestPow = 0;
        const consider = function (p, self) {
            if (!p || !fighting(p) || (!self && !is_in_range(p, "energize"))) return;
            if (p.s && p.s.energized) return;
            const pow = (p.attack || 0) * (p.frequency || 1);
            if (pow > bestPow) { bestPow = pow; best = { p: p, self: self }; }
        };
        if (selfEnergizeOk) consider(character, true);
        ctx.party.memberNames().forEach(function (name) { if (name !== character.name) consider(get_player(name), false); });
        return best;
    }
    function energizeTick() {
        if (c.energize === false || character.level < (G.skills.energize.level || 20) || !util.canCast("energize")) return;
        const t = energizeTarget();
        if (t && util.mpRatio() > c.energizeAbove) {
            const give = Math.floor(Math.min(t.missing, character.mp - character.max_mp * c.energizeAbove));
            if (give >= 50) { use_skill("energize", t.name, give).catch(function () {}); return; }
        }
        const b = burstTarget();
        if (!b) return;
        if (b.self) {
            // Our own burst only right before the next attack: the 0.8 s window then holds a faster one.
            const next = parent.next_skill && parent.next_skill.attack;
            const left = next ? next - new Date() : 0;
            if (left > (c.burstLeadMs || 250)) return;
        }
        use_skill("energize", b.self ? character.name : b.p.name, 1).catch(function (e) {
            if (b.self && selfEnergizeOk) {
                selfEnergizeOk = false; // the server refuses ourselves: members only
                util.log("mage", "Energize on myself refused (" + util.errReason(e) + ") - only on members", "orange");
            }
        });
        if (Date.now() - energizeLogAt > 10 * 60 * 1000) {
            energizeLogAt = Date.now();
            util.log("mage", "Energize burst on " + (b.self ? "myself" : b.p.name), "white");
        }
    }
    // Reflective Shield (level 60; 540 MP, cooldown 30 s, range 320): +20 % chance to bounce MAGICAL hits for 5 s. On the
    // member (or ourselves) with the most magical damage coming in from the monsters targeting it - the tank in a party,
    // ourselves when solo - while our MP stays above reflectKeepMp after the cast.
    function magicalIncoming(name) {
        let sum = 0;
        Object.values(parent.entities || {}).forEach(function (m) {
            if (!m || m.type !== "monster" || m.dead || m.target !== name) return;
            const d = G.monsters[m.mtype] || {};
            if ((m.damage_type || d.damage_type) === "magical") sum += m.attack || d.attack || 0;
        });
        return sum;
    }
    function reflectTick() {
        if (c.reflect === false || character.level < (G.skills.reflection.level || 60) || !util.canCast("reflection")) return;
        if ((character.mp - (G.skills.reflection.mp || 540)) / Math.max(1, character.max_mp) < (c.reflectKeepMp || 0.25)) return;
        let best = null, bestIn = 0;
        [character.name].concat(ctx.party.memberNames()).forEach(function (name) {
            const p = name === character.name ? character : get_player(name);
            if (!p || p.rip || (p.s && p.s.reflection)) return;
            if (p !== character && !is_in_range(p, "reflection")) return;
            const inc = magicalIncoming(name);
            if (inc > bestIn) { bestIn = inc; best = name; }
        });
        if (!best || bestIn < (c.reflectMinAttack || 100)) return;
        use_skill("reflection", best).catch(function () {});
        util.log("mage", "Reflective Shield on " + (best === character.name ? "myself" : best) + " (" + Math.round(bestIn) + " magical attack on it)", "white");
    }

    // ---- Blaster mode (player decision 2026-11-23) ------------------------------------------------
    // Like the warrior's Lolipops: the Blaster costs +160 MP per attack and takes both hands, so it is worn only while a
    // pack stands around our target (at least minNeighbours other monsters within its blast radius, blast / 3.6 px - the
    // warrior's Agitate stacks them) and MP is above minMp. keepMs without a pack, MP below offMp, or a walk bring the
    // staff and the book back - both in one equip_batch call. The gear module's weapon hold keeps its equip pass away.
    const bl = c.blaster || {};
    let blBusy = false, packSeenAt = 0, blLogAt = 0;
    function travelling() { return typeof smart !== "undefined" && !!smart.moving; }
    function isBlaster(i) { return !!(i && (bl.names || ["gstaff"]).includes(i.name)); }
    function blasterIndex() {
        let best = -1;
        character.items.forEach(function (it, i) {
            if (isBlaster(it) && (best === -1 || (it.level || 0) > (character.items[best].level || 0))) best = i;
        });
        return best;
    }
    function blastRadius(it) {
        let b = 0;
        try { b = parent.calculate_item_properties(it).blast || 0; } catch (e) {
            const d = G.items[it.name] || {};
            b = (d.blast || 0) + ((d.upgrade || {}).blast || 0) * (it.level || 0);
        }
        return b / 3.6;
    }
    function packAround(t, r) {
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.id === t.id) return false;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            return Math.hypot(ex - tx, ey - ty) < r;
        }).length;
    }
    // A free monster within r of t that the blast must not touch: a boss (cooperative or an events.policy name) or one
    // we can't kite away from (util.kiteRisk 1: faster than us, longer reach, special abilities). names: us and members.
    let noBlasterUntil = 0, blockLogAt = 0;
    // A boss: cooperative or one of our events.policy names (v1.226.0: against bosses always staff + book).
    function bossy(m) {
        const def = (m && G.monsters[m.mtype]) || {};
        return !!(m && (def.cooperative || (((ctx.config.events && ctx.config.events.policy) || {})[m.mtype] !== undefined)));
    }
    function dangerNear(t, r, names) {
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        const policy = (ctx.config.events && ctx.config.events.policy) || {};
        return Object.values(parent.entities || {}).some(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.id === t.id || (e.target && names.includes(e.target))) return false;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            if (Math.hypot(ex - tx, ey - ty) >= r) return false;
            const def = G.monsters[e.mtype] || {};
            if (def.cooperative || policy[e.mtype] !== undefined) return true;
            return util.kiteRisk(def, e, { speed: character.speed, range: character.range }) === 1;
        });
    }
    // Pull limit (v1.225.9, player report 2026-11-23), like the warrior's Lolipops: the mage died at the Squigs - the
    // blast pulled 5-6 onto him, he was terrified (fear: slower, weaker) and couldn't kite any more. A blast on t pulls
    // every free monster within r of it (t too, if free); with those already on us they must stay within our courage per
    // damage type (+ blaster.fearMax, default 0: fear slows the kiting) and pass the solo pack check for that many.
    function pullOk(t, r) {
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        const all = util.attackersOnMe().slice();
        Object.values(parent.entities || {}).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.target || all.indexOf(e) !== -1) return;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            if (e.id === t.id || Math.hypot(ex - tx, ey - ty) < r) all.push(e);
        });
        const byType = {};
        all.forEach(function (e) {
            const dt = e.damage_type || (G.monsters[e.mtype] || {}).damage_type || "physical";
            byType[dt] = (byType[dt] || 0) + 1;
        });
        const over = Object.keys(byType).some(function (dt) { return byType[dt] > util.courageOf(dt) + (bl.fearMax || 0); });
        if (over) return false;
        if (all.length <= 1 || !ctx.targeting.packVerdict) return true;
        const strongest = all.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
        return !!ctx.targeting.packVerdict(strongest, all.length).ok;
    }
    function blockBlaster() {
        noBlasterUntil = Date.now() + (bl.blockMs || 6000);
        if (Date.now() - blockLogAt > 30 * 1000) {
            blockLogAt = Date.now();
            util.log("mage", "Blaster held: its blast would hit a boss, a monster I can't outrun, or pull more than I can take", "orange");
        }
    }
    // The usual weapons: the strongest other weapon for the main hand and the best book (source) for the offhand.
    function usualBatch() {
        let main = -1, mainPow = 0, off = -1, offInt = -1;
        character.items.forEach(function (it, i) {
            const d = it && G.items[it.name];
            if (!d || isBlaster(it)) return;
            if (d.type === "weapon" && !util.isDoublehand(it.name, character.ctype)) {
                const p = util.weaponPower(it.name, it.level || 0, character.ctype);
                if (p > mainPow) { mainPow = p; main = i; }
            } else if (d.type === "source") {
                const v = (d.int || 0) + ((d.compound || {}).int || 0) * (it.level || 0);
                if (v > offInt) { offInt = v; off = i; }
            }
        });
        const batch = [];
        if (main !== -1) batch.push({ num: main, slot: "mainhand" });
        if (off !== -1) batch.push({ num: off, slot: "offhand" });
        return batch;
    }
    // Single target too (v1.224.7, player decision 2026-11-23): the Blaster stays on whenever it beats the best staff + book
    // on one target - weapon power (attack x class frequency modifier x burn, util.weaponPower) against the staff's power x
    // the book's INT share. MP is kept up with potions; only below offMp the staff comes back.
    function bookInt(it) {
        const d = it && G.items[it.name];
        if (!d || d.type !== "source") return 0;
        try { return parent.calculate_item_properties(it).int || 0; } catch (e) { return (d.int || 0) + ((d.compound || {}).int || 0) * (it.level || 0); }
    }
    function staffValue() {
        let mainPow = 0, book = 0;
        const slots = character.slots || {};
        const cand = character.items.concat([slots.mainhand, slots.offhand]);
        cand.forEach(function (it) {
            const d = it && G.items[it.name];
            if (!d || isBlaster(it)) return;
            if (d.type === "weapon" && !util.isDoublehand(it.name, character.ctype)) mainPow = Math.max(mainPow, util.weaponPower(it.name, it.level || 0, character.ctype));
            else if (d.type === "source") book = Math.max(book, bookInt(it));
        });
        const baseInt = Math.max(1, (character.int || 1) - bookInt(slots.offhand));
        return mainPow * (1 + book / baseInt);
    }
    function blasterBetter(it) {
        if (!bl.singleTarget || !it) return false;
        return util.weaponPower(it.name, it.level || 0, character.ctype) > staffValue() * (1 + (bl.singleMargin || 0));
    }
    async function blasterTick() {
        if (!bl.enabled || blBusy || character.rip) return;
        const t = get_targeted_monster();
        const worn = character.slots && character.slots.mainhand;
        if (isBlaster(worn)) {
            if (t && !t.dead && packAround(t, blastRadius(worn)) >= (bl.minNeighbours || 2)) packSeenAt = Date.now();
            const better = blasterBetter(worn);
            // Off under /manual outside the cave; inside the cave it is allowed (v1.231.4, player decision 2026-11-24: the
            // groups are small and apart there).
            const why = ctx.cave && ctx.cave.active() && !ctx.cave.caveManual() ? "manual" : t && !t.dead && bossy(t) ? "boss" : Date.now() < noBlasterUntil ? "dangerous bystander" : util.mpRatio() < (bl.offMp || 0.2) ? "MP low" : better ? null :
                travelling() ? "on the way" : Date.now() - packSeenAt > (bl.keepMs || 4000) ? "no pack" : null;
            if (!why) { ctx.gear.holdWeapons(bl.holdMs || 60000); return; }
            const batch = usualBatch();
            // No other main-hand weapon in the bag: the Blaster stays on (a lone book would push it off) - a blocked shot
            // then simply waits (fight() keeps returning) until the target is safe again.
            if (!batch.some(function (b) { return b.slot === "mainhand"; })) return;
            blBusy = true;
            try {
                await ctx.gear.equipBatch(batch);
                ctx.gear.holdWeapons(0);
                util.log("mage", "staff and book back (" + why + ")", "white");
            } catch (e) {
                util.log("mage", "blaster off: " + util.errReason(e), "orange");
            } finally { blBusy = false; }
            return;
        }
        if (Date.now() < noBlasterUntil || util.mpRatio() < (bl.minMp || 0.5) || character.esize < 1) return;
        if (ctx.cave && ctx.cave.active() && !ctx.cave.caveManual()) return; // /manual outside the cave: no blast splash (v1.231.4: allowed in the cave)
        const idx = blasterIndex();
        if (idx === -1) return;
        if (t && !t.dead && bossy(t)) return; // bosses: staff + book, whatever is stronger (v1.226.0)
        // No Blaster during a boss event either (v1.226.1): at the Phoenix the mage kept trying it on the small monsters
        // around - and a boss within 400 px (the blast or a pull could reach it).
        if (ctx.events && ctx.events.current && ctx.events.current()) return;
        if (Object.values(parent.entities || {}).some(function (e) { return e && e.type === "monster" && !e.dead && bossy(e) && util.distanceTo(e) < (bl.bossClear || 400); })) return;
        const better = blasterBetter(character.items[idx]);
        if (!better && (!t || t.dead || travelling())) return;
        const n = t && !t.dead ? packAround(t, blastRadius(character.items[idx])) : 0;
        if (!better && n < (bl.minNeighbours || 2)) return;
        blBusy = true;
        try {
            ctx.gear.holdWeapons(bl.holdMs || 60000); // records staff + book as the usual weapons first
            packSeenAt = Date.now();
            // A two-hander needs an empty offhand ("Unequip your offhand item to use this two-handed weapon" - v1.226.1):
            // the book comes off first, then the Blaster goes on.
            if (character.slots && character.slots.offhand) await unequip("offhand");
            const now = character.items.findIndex(function (it) { return isBlaster(it); });
            await ctx.gear.equipBatch([{ num: now !== -1 ? now : idx, slot: "mainhand" }]);
            if (Date.now() - blLogAt > 10 * 1000) {
                blLogAt = Date.now();
                util.log("mage", "Blaster on: " + (better ? "beats staff + book on one target" : (n + 1) + " in its blast radius (" + Math.round(blastRadius(character.slots.mainhand || {})) + " px)"), "yellow");
            }
        } catch (e) {
            util.log("mage", "blaster on: " + util.errReason(e), "orange");
        } finally { blBusy = false; }
    }

    // ---- Magiport (v1.228.1, player decision 2026-11-23) -----------------------------------------------------------
    // We stand at a boss the team fights (the leader's boss event; we found it as the runner, or got there first): the
    // fighters still on their way are pulled to us instead of walking - the tank first, the healer last. 900 MP each,
    // only while keepMp of our MP stays for the fight (the potion rule refills; the rest walk on meanwhile). A member
    // within minDist px or on its last tries for this boss (tries, retryMs apart) is skipped. The member accepts only
    // our port during a boss fight (core/events.js acceptMagiport). Not for join events or a runner's solo kill.
    // Distance (v1.228.3, player report 2026-11-23): get_party() positions lag behind - right after leaving the cave the
    // warrior and the priest stood next to the mage and were pulled anyway (their party info still said "cave"; another
    // check showed the warrior 370 px off). A member we can see is judged by its live position; one we can't see counts
    // as far, but only after the boss has been in our sight for graceMs (map changes and new entities settle first).
    const mpc = c.magiport || {};
    const portTries = {}; // member -> { boss, n, at }
    let portBusy = false, portLowLogAt = 0, portBoss = null; // portBoss: { id, since } - the boss in our sight
    function magiportTick() {
        if (!mpc.enabled || portBusy || character.rip || !ctx.party.enabled || !G.skills.magiport) return;
        if (ctx.cave && ctx.cave.inCave()) return; // magiport can't enter or leave the cave
        const ev = ctx.events && ctx.events.current ? ctx.events.current() : null;
        if (!ev || ev.join || ev.solo || !ev.monster) return;
        const boss = get_nearest_monster({ type: ev.monster });
        if (!boss || boss.dead || util.distanceTo(boss) > (mpc.bossRange || 500)) return;
        if (!portBoss || portBoss.id !== boss.id) portBoss = { id: boss.id, since: Date.now() };
        if (Date.now() - portBoss.since < (mpc.graceMs || 4000)) return;
        const info = get_party() || {};
        const fighters = (ctx.config.team && ctx.config.team.fighters) || [];
        const tanks = ((ctx.config.targeting && ctx.config.targeting.teamSafety) || {}).tankClasses || ["warrior", "paladin"];
        const healer = function (t) { return !!(G.skills.heal && (G.skills.heal.class || []).includes(t)); };
        const now = Date.now();
        const me = { x: character.real_x, y: character.real_y };
        const far = ctx.party.memberNames().filter(function (n) {
            const p = info[n];
            if (n === character.name || !fighters.includes(n) || !p || p.rip) return false;
            const live = get_player(n);
            if (live && (live.rip || util.distanceTo(live) <= (mpc.minDist || 600))) return false;
            const t = portTries[n];
            return !(t && t.boss === boss.id && (t.n >= (mpc.tries || 3) || now - t.at < (mpc.retryMs || 8000)));
        }).sort(function (a, b) {
            const rank = function (n) { const t = info[n].type; return tanks.includes(t) ? 0 : healer(t) ? 2 : 1; };
            return rank(a) - rank(b);
        });
        if (!far.length) return;
        const cost = G.skills.magiport.mp || 900;
        if (character.mp - cost < character.max_mp * (mpc.keepMp === undefined ? 0.3 : mpc.keepMp)) {
            if (now - portLowLogAt > 30 * 1000) {
                portLowLogAt = now;
                util.log("mage", "magiport for " + far.join(", ") + " waits: " + Math.round(character.mp) + " MP, keeping " + Math.round((mpc.keepMp === undefined ? 0.3 : mpc.keepMp) * 100) + " % for the " + ev.monster, "white");
            }
            return;
        }
        if (is_on_cooldown("magiport")) return;
        const who = far[0];
        const prev = portTries[who];
        portTries[who] = { boss: boss.id, n: prev && prev.boss === boss.id ? prev.n + 1 : 1, at: now };
        portBusy = true;
        const seen = get_player(who);
        util.log("mage", "magiport " + who + " to the " + ev.monster + " (" + (seen ? Math.round(util.distanceTo(seen)) + " px away" : "not in sight, party info: " + info[who].map +
            (info[who].map === character.map ? " ~" + Math.round(Math.hypot(info[who].x - me.x, info[who].y - me.y)) + " px" : "")) + ", try " + portTries[who].n + ")", "yellow");
        Promise.resolve(use_skill("magiport", who))
            .catch(function (e) { util.log("mage", "magiport " + who + ": " + util.errReason(e), "orange"); })
            .finally(function () { portBusy = false; });
    }

    // ---- Magiport on the way to a farm spot (v1.235.0, player decision 2026-11-24) ----------------------------------
    // We go ahead of the leader to the edge of its farm spot (party.spotAhead - Blink makes us first) and pull the
    // fighters still far away (another map, or more than travel.minDist px) to us there - the tank first, the healer last,
    // while keepMp of our MP stays; up to travel.tries per member and route. Only farm spots (bosses: magiportTick).
    // The members accept it only on a route to a farm spot, not fighting (events.acceptMagiport).
    const tcfg = mpc.travel || {};
    const travelTries = {}; // member -> { key, n, at }
    let travelLowLogAt = 0;
    function travelPortTick() {
        if (!mpc.enabled || !tcfg.enabled || portBusy || character.rip || !ctx.party.enabled || ctx.party.isLeader || !G.skills.magiport) return;
        if (ctx.cave && ctx.cave.active()) return;
        const lead = ctx.party.leaderInfo();
        const tg = ctx.targeting;
        if (!lead || !lead.moving || !lead.dest || lead.event || !tg || !tg.inSpotArea || !tg.watchPoint) return;
        if (character.map !== lead.dest.map || util.attackersOnMe().length) return;
        // Every route of the team (v1.235.2, player decision 2026-11-24: "whenever the group goes somewhere and he is
        // there"): a farm spot - we wait at its edge; any other route end (Daisy, town, ...) - we stand at it (we went
        // ahead there). Boss events have their own magiport.
        const toSpot = !!lead.farm && tg.inSpotArea(lead.dest, lead.farm);
        // Only at the real goal (v1.235.7): a leg of the leader's route (leaving spookytown, a via map) is no goal.
        if (lead.leg && !toSpot) return;
        if (toSpot) {
            const edge = tg.watchPoint(lead.farm);
            if (!edge || util.distanceTo(edge) > (tcfg.atEdge || 100)) return;
        } else if (Math.hypot(character.real_x - lead.dest.x, character.real_y - lead.dest.y) > (tcfg.atEnd || 200)) return;
        const daisy = util.daisyPos ? util.daisyPos() : null;
        const toDaisy = !toSpot && !!daisy && lead.dest.map === "main" && Math.hypot(lead.dest.x - daisy.x, lead.dest.y - daisy.y) < 250;
        const info = get_party() || {};
        const fighters = (ctx.config.team && ctx.config.team.fighters) || [];
        const tanks = ((ctx.config.targeting && ctx.config.targeting.teamSafety) || {}).tankClasses || ["warrior", "paladin"];
        const healer = function (t) { return !!(G.skills.heal && (G.skills.heal.class || []).includes(t)); };
        const key = lead.dest.map + ":" + Math.round(lead.dest.x / 100) + ":" + Math.round(lead.dest.y / 100);
        const now = Date.now();
        const far = ctx.party.memberNames().filter(function (n) {
            const p = info[n];
            if (n === character.name || !fighters.includes(n) || !p || p.rip) return false;
            const live = get_player(n);
            if (live && (live.rip || util.distanceTo(live) <= (tcfg.minDist || 800))) return false;
            if (!live && p.map === character.map && Math.hypot(p.x - character.real_x, p.y - character.real_y) <= (tcfg.minDist || 800)) return false;
            const t = travelTries[n];
            // At most one travel port per member within cooldownMs (v1.235.6, player report: the warrior, ported to the
            // stoneworm spot, still followed the leader back, and every new route end of the leader allowed new tries).
            if (t && now - t.at < (tcfg.cooldownMs || 60 * 1000)) return false;
            return !(t && t.key === key && t.n >= (tcfg.tries || 2));
        }).sort(function (a, b) {
            const rank = function (n) { const t = info[n].type; return tanks.includes(t) ? 0 : healer(t) ? 2 : 1; };
            return rank(a) - rank(b);
        });
        if (!far.length) return;
        const cost = G.skills.magiport.mp || 900;
        const keep = tcfg.keepMp === undefined ? 0.3 : tcfg.keepMp;
        if (character.mp - cost < character.max_mp * keep) {
            if (now - travelLowLogAt > 60 * 1000) {
                travelLowLogAt = now;
                util.log("mage", "travel magiport for " + far.join(", ") + " waits: " + Math.round(character.mp) + " MP (keeping " + Math.round(keep * 100) + " %)", "white");
            }
            return;
        }
        if (is_on_cooldown("magiport")) return;
        const who = far[0];
        const prev = travelTries[who];
        travelTries[who] = { key: key, n: prev && prev.key === key ? prev.n + 1 : 1, at: now };
        portBusy = true;
        util.log("mage", "magiport " + who + (toDaisy ? " to Daisy" : toSpot ? " to the " + lead.farm + " spot" : " to the route end on " + lead.dest.map) + " (" + (info[who].map !== character.map ? "on " + info[who].map : "far") + ", try " + travelTries[who].n + ")", "yellow");
        Promise.resolve(use_skill("magiport", who))
            .catch(function (e) { util.log("mage", "magiport " + who + ": " + util.errReason(e), "orange"); })
            .finally(function () { portBusy = false; });
    }

    // ---- Blink on routes (v1.234.0, player decision 2026-11-24) ------------------------------------------------------
    // Blink has no range limit on the server (any point of the same map; a test blinked 980 px and landed 35 px off).
    // On a path walk (smart_move, path found) we jump to the farthest step of the plan on this map - the next door or the
    // goal - when it is at least minDist px away, our MP stays above keepMp after the 1,600-MP cast (Magiport needs 900 a
    // member), nothing attacks us, and we are not under the manual rules (cave, /manual). The steps up to that point are
    // dropped from the plan; the landing point itself stays, so the walk ends exactly there (doors need it).
    const bt = c.blinkTravel || {};
    let blinkLogAt = 0, blinkCount = 0, blinkPx = 0, blinkBusyUntil = 0;
    function blinkTravelTick() {
        if (!bt.enabled || character.rip || Date.now() < blinkBusyUntil) return;
        if (typeof smart === "undefined" || !smart.moving || !smart.found || smart.town || !Array.isArray(smart.plot) || !smart.plot.length) return;
        if (ctx.cave && ctx.cave.active()) return;
        if (!G.skills.blink || !util.canCast("blink")) return;
        if ((character.mp - (G.skills.blink.mp || 1600)) / Math.max(1, character.max_mp) < (bt.keepMp || 0.4)) return;
        if (util.attackersOnMe().length) return;
        if (typeof is_transporting === "function" && is_transporting(character)) return;
        // The last step of the plan on our map before a door, town or another map.
        let k = -1;
        for (let i = 0; i < smart.plot.length; i++) {
            const p = smart.plot[i];
            if (!p || p.town || p.transport || p.map !== character.map) break;
            k = i;
        }
        if (k < 0) return;
        // Never into a farm spot (v1.235.0): the farthest step outside it - we wait at its edge (party.spotAhead), the
        // spot check comes first.
        const leadInfo = ctx.party.leaderInfo ? ctx.party.leaderInfo() : null;
        const farmNow = ctx.targeting && ctx.targeting.farmNow ? ctx.targeting.farmNow() : null;
        const farmType = (leadInfo && leadInfo.farm) || (farmNow && farmNow.monster) || null;
        const inSpot = function (p) { return !!(farmType && ctx.targeting.inSpotArea && ctx.targeting.inSpotArea({ map: character.map, x: p.x, y: p.y }, farmType)); };
        while (k >= 0 && inSpot(smart.plot[k])) k--;
        if (k < 0) return;
        const to = smart.plot[k];
        const d = Math.hypot(to.x - character.real_x, to.y - character.real_y);
        if (d < (bt.minDist || 400)) return;
        blinkBusyUntil = Date.now() + 1500;
        Promise.resolve(use_skill("blink", [Math.round(to.x), Math.round(to.y)])).then(function () {
            // Landed (200 ms): the plan goes on from the landing point.
            if (smart.moving && Array.isArray(smart.plot)) {
                const idx = smart.plot.indexOf(to);
                if (idx > 0) smart.plot.splice(0, idx);
            }
            blinkCount++;
            blinkPx += d;
            if (Date.now() - blinkLogAt > 60 * 1000) {
                blinkLogAt = Date.now();
                util.log("mage", "Blink on the way: " + Math.round(d) + " px on " + character.map + " (" + blinkCount + " blinks, " + Math.round(blinkPx) + " px since start)", "white");
            }
        }).catch(function (e) {
            blinkBusyUntil = Date.now() + 10 * 1000; // a refused blink (e.g. no safe spot there): not again right away
            util.log("mage", "Blink on the way refused: " + util.errReason(e), "orange");
        });
    }

    return {
        name: "mage",

        survive: function () { return false; },

        always: function () { magiportTick(); travelPortTick(); blasterTick(); blinkTravelTick(); },

        support: function () {
            reflectTick();
            energizeTick();
            return false; // neither replaces the attack
        },

        fight: function (target) {
            // Blaster aim (v1.225.6, player decision 2026-11-23): with the Blaster in hand, the monster of the same kind in
            // range with the most others around it (within the blast radius) is shot instead - same kind as the target the
            // core picked, so the farm and safety checks still hold; none better: the core's target.
            // Splash safety (v1.225.8, player report 2026-11-23): the Blast pulled a roaming Phoenix next to the Crocs, and the
            // mage died to it and an Armadillo. A shot whose blast would hit a free monster that is a boss or that we can't
            // kite (faster than us, longer reach, special abilities - util.kiteRisk) is never fired with the Blaster: another
            // target of the same kind without one, else staff + book for blockMs.
            const worn = character.slots && character.slots.mainhand;
            if (isBlaster(worn) && target && target.mtype && bossy(target)) { blockBlaster(); return true; } // staff + book first
            if (isBlaster(worn) && target && target.mtype) {
                const r = blastRadius(worn);
                const names = ctx.party.memberNames().concat([character.name]);
                const safeAt = function (t) { return !dangerNear(t, r, names) && pullOk(t, r); };
                let best = null, bestN = safeAt(target) ? packAround(target, r) : -1;
                Object.values(parent.entities || {}).forEach(function (m) {
                    if (!m || m.type !== "monster" || m.dead || m.id === target.id || m.mtype !== target.mtype) return;
                    if (m.target && !names.includes(m.target)) return; // another player's
                    if (util.noArea(ctx.config, m) || util.foreignOnlyBlocks(ctx.config, m)) return;
                    if (!is_in_range(m) || !safeAt(m)) return;
                    const n = packAround(m, r);
                    // Better pack (aim), or any safe one when the core's target is not safe.
                    if ((bl.aim !== false || bestN < 0) && n > bestN) { bestN = n; best = m; }
                });
                if (best) {
                    change_target(best);
                    if (!is_on_cooldown("attack") && can_attack(best)) attack(best).catch(function () {});
                    return true;
                }
                if (bestN < 0) { blockBlaster(); return true; } // staff + book come on (blasterTick), then the core shoots
            }
            if (c.useBurst && util.canCast("burst") && util.mpRatio() > 0.95 &&
                target.hp > character.mp * G.skills.burst.ratio) {
                use_skill("burst", target).catch(function () {});
            }
            return false;
        },
    };
};
