// =====================================================================
// bot_class_warrior – Warrior skills.
//   survive: Hard Shell (lvl 60, 480 MP) when HP gets low while physical
//            monsters hit us
//   support: Taunt (40 MP, 3 s, range 200) pulls a monster off a party
//            member when it hits hard or the member is hurt;
//            Agitate (lvl 68, 420 MP) taunts everything nearby when several
//            monsters are on other members; War Cry (lvl 70) on sturdy fights
//   fight:   Cleave (lvl 52, axe/scythe) when several monsters stand around
//            us, Stomp (lvl 52, basher) when several attack the team
//   move:    Charge (+30 speed, 3.2 s, 40 s cooldown, no MP) on longer walks
//            and chases; Dash (120 MP) closes the last gap to a target when
//            the straight line is free
// Solo, support only protects the warrior itself (nothing to taunt off).
// =====================================================================

module.exports = function createWarrior(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.warrior;

    function mpLeftAfter(skill) {
        return character.mp - ((G.skills[skill] && G.skills[skill].mp) || 0);
    }
    function reserve() {
        return character.max_mp * (c.mpReserveRatio || 0);
    }

    // Monsters attacking a party member other than us, nearest first.
    function onOthers() {
        const names = ctx.party.memberNames().filter(function (n) { return n !== character.name; });
        if (!names.length) return [];
        return Object.values(parent.entities || {})
            .filter(function (e) { return e && e.type === "monster" && !e.dead && e.visible && names.includes(e.target); })
            .sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
    }

    // Monsters standing within `range` of us (for Cleave / Stomp).
    function around(range, attackingOnly) {
        const names = ctx.party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible || util.distanceTo(e) > range) return false;
            if (util.tooSpiky(ctx.config, e)) return false; // Cleave/Stomp would hit a porcupine
            if (attackingOnly && !names.includes(e.target)) return false;
            // Never pull monsters that fight other players.
            return !e.target || names.includes(e.target);
        });
    }

    // Cleave and Stomp hit everything around us: never with a damage-return monster in reach.
    function spikyNear(range) {
        return Object.values(parent.entities || {}).some(function (e) {
            // Any damage return counts here: Cleave/Stomp hit them all, each one returns.
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range + 20 &&
                ((G.monsters[e.mtype] || {}).dreturn > 0 || util.tooSpiky(ctx.config, e));
        });
    }

    // A monster on an ally is worth taunting when the ally is hurt or the monster hits hard.
    function worthTaunting(m) {
        const p = get_player(m.target);
        if (!p || p.rip) return false;
        const t = c.taunt || {};
        return p.hp / p.max_hp < (t.allyHpBelow || 0.8) || (m.attack || 0) >= p.max_hp * (t.hitRatio || 0.05);
    }

    // Dash: a short jump towards a point ([x, y]). It has no cooldown, so we space the
    // jumps ourselves (dash.everyMs) – otherwise every tick jumps and drains the MP.
    // A failure pauses it instead of retrying every tick.
    let dashPausedUntil = 0;
    let lastDash = 0;
    function tryDash(target) {
        const d = c.dash || {};
        if (!d.enabled || Date.now() < dashPausedUntil || Date.now() - lastDash < (d.everyMs || 2000)) return false;
        if (!util.canCast("dash")) return false;
        if (mpLeftAfter("dash") < reserve()) return false;
        const dist = util.distanceTo(target);
        if (dist < (d.from || 120)) return false;
        const p = util.xy(target);
        // The server takes a point at most 50 px away (game source: farther fails as
        // "dash_failed" and the MP is gone) – a hop over an obstacle, not a gap closer.
        const step = Math.min(d.max || 45, 48, dist - (character.range || 20) * 0.7);
        if (step < 20) return false;
        const k = step / dist;
        const to = [character.real_x + (p.x - character.real_x) * k, character.real_y + (p.y - character.real_y) * k];
        lastDash = Date.now();
        use_skill("dash", to).catch(function (e) {
            dashPausedUntil = Date.now() + 60 * 1000;
            util.log("warrior", "dash failed: " + util.errReason(e) + " - pausing it for a minute", "orange");
        });
        return true;
    }

    // ---- Agitate pack mode (config.classes.warrior.agitate, test since 2026-11-18) ----------
    //
    // Solo: when enough free monsters stand within Agitate range, the warrior puts on his
    // splash weapons (explosion, e.g. Lolipop Maces), casts War Cry and Agitate, walks a step
    // away so the pack follows from one side and bunches up, then always hits the monster with
    // the most others inside the splash radius (explosion / 3.6 px, hitbox edge to edge -
    // server.js). When the pack spreads around him he steps away again. Each pull ends with
    // a summary line (pulled, time, splash neighbours per hit, HP used) to judge the mode.
    const ag = c.agitate || {};
    const pack = { state: "idle", busy: false, since: 0, pulled: [], startHp: 0, attacks: 0, neighborSum: 0,
        recent: [], lastRegroup: 0, gatherAt: 0, noWeaponsLogged: false };

    // Mode: "off" (single targets), "swords" (Agitate, usual weapons - pull everything, kill one
    // by one, no walking) or "splash" (Agitate with the splash weapons). From the config
    // (enabled + weapons "keep"/"splash"), or switched at runtime with the chat command
    // "/agitate off|swords|splash|config" (kept across restarts; for A/B tests, 2026-11-18).
    const MODE_KEY = "agitate_mode:" + character.name;
    let modeCache = { at: 0, v: null }, lastMode = null;
    function agMode() {
        if (Date.now() - modeCache.at > 2000) {
            let v = null;
            try { v = get(MODE_KEY) || null; } catch (e) { /* storage unavailable */ }
            modeCache = { at: Date.now(), v: v };
        }
        const m = modeCache.v || (!ag.enabled ? "off" : ag.weapons === "keep" ? "swords" : "splash");
        if (m !== lastMode) {
            if (lastMode !== null) {
                util.log("warrior", "agitate mode: " + m, "yellow");
                if (!SPLASH_MODES.includes(m)) ctx.gear.holdWeapons(0); // usual weapons back at once
                pack.state = "idle";
            }
            lastMode = m;
        }
        return m;
    }
    const SPLASH_MODES = ["splash", "chain", "splashstream"];
    function splashMode() {
        const m = effectiveMode();
        return SPLASH_MODES.includes(m); // "chain": splash pulls that start the next pull early; "splashstream": stream with splash
    }
    // In a party only the stream modes run (player decision 2026-11-18): the leader picks the
    // spot and walks, we stay on the leash - Agitate where we stand, fight what comes.
    // agitate.partyMode decides which ("splashstream", "swords" or "off").
    function partyStream() {
        return ctx.party.enabled && ["splashstream", "swords"].includes(ag.partyMode || "off");
    }
    function effectiveMode() {
        return ctx.party.enabled ? (partyStream() ? ag.partyMode : "off") : agMode();
    }
    function packOn() {
        if (ctx.party.enabled ? !partyStream() : agMode() === "off") return false;
        return !!G.skills.agitate && character.level >= (G.skills.agitate.level || 68);
    }
    function isSplash(item) {
        const def = item && G.items[item.name];
        return !!(def && def.type === "weapon" && def.explosion > 0);
    }
    // Bag weapons with splash that our class can hold, highest level first.
    function splashWeapons() {
        return character.items.map(function (it, num) { return { it: it, num: num }; }).filter(function (x) {
            return isSplash(x.it) && util.weaponPower(x.it.name, 0, character.ctype) > 0;
        }).sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    }
    function wearingSplash() {
        return isSplash(character.slots && character.slots.mainhand);
    }
    function packWanted(e) {
        return !ag.monsters || !ag.monsters.length || ag.monsters.includes(e.mtype);
    }
    // Free monsters of the wanted kind around us (not fighting another player).
    function packAround(range) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.visible && packWanted(e) &&
                util.distanceTo(e) <= range && (!e.target || e.target === character.name) &&
                !(ctx.targeting.inOccupied && ctx.targeting.inOccupied(e)); // another player's spot
        });
    }
    // Monsters Agitate would pull as well although we don't want them: other kinds (when
    // agitate.monsters lists some) and anything that returns damage - Agitate taunts all
    // within 320 px, at the crocs it pulled armadillos (dreturn 30) too (2026-11-18).
    function unwantedAround(range) {
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || util.distanceTo(e) > range) return false;
            if (e.target && e.target !== character.name) return false; // busy with another player
            const def = G.monsters[e.mtype] || {};
            return !packWanted(e) || def.dreturn > 0 || util.tooSpiky(ctx.config, e);
        });
    }
    function onMe() {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === character.name;
        });
    }
    // Hitbox edge to edge, like the server's splash check.
    function edge(a, b) {
        try { return parent.distance(a, b); } catch (e) {
            return Math.max(0, Math.hypot(a.real_x - b.real_x, a.real_y - b.real_y) - 20);
        }
    }
    // The splash radius we have - or, with our usual weapons ("swords"), the one the splash
    // weapons in the bag would give: the neighbour count then says what splash would have hit.
    function splashRadius() {
        if (character.explosion) return character.explosion / 3.6;
        let sum = 0;
        splashWeapons().slice(0, 2).forEach(function (x) {
            try { sum += parent.calculate_item_properties(x.it).explosion || 0; } catch (e) { sum += G.items[x.it.name].explosion || 0; }
        });
        return sum / 3.6;
    }
    function splashNeighbours(t, list) {
        const r = splashRadius();
        return list.filter(function (m) { return m !== t && edge(m, t) < r; }).length;
    }

    async function putOnSplash() {
        pack.busy = true;
        try {
            ctx.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            let w = splashWeapons();
            if (w[0]) await equip(w[0].num, "mainhand");
            w = splashWeapons(); // the bag changed: look again
            const off = character.slots && character.slots.offhand;
            if (w[0] && (!off || G.items[off.name].type === "weapon")) await equip(w[0].num, "offhand");
            util.log("warrior", "splash weapons on: " + ["mainhand", "offhand"].map(function (s) {
                const i = character.slots[s]; return i ? i.name + " +" + (i.level || 0) : "-";
            }).join(", ") + " (splash radius " + Math.round(splashRadius()) + " px)", "yellow");
        } catch (e) {
            util.log("warrior", "splash weapons: " + util.errReason(e), "orange");
        } finally {
            pack.busy = false;
        }
    }

    function centerOf(list) {
        let x = 0, y = 0;
        list.forEach(function (m) { const p = util.xy(m); x += p.x; y += p.y; });
        return { x: x / list.length, y: y / list.length };
    }
    // The point to Agitate from (player idea 2026-11-18): as many free pack monsters within
    // reach as possible, no unwanted one in reach, then the shortest walk - so we only go as
    // far into the pack as needed. Candidates on a grid around us (agitate.searchRadius,
    // gridStep), reachable in a straight line. { x, y, count, here } or null below minPack.
    function bestPullPoint() {
        const reach = G.skills.agitate.range - 10; // centre distance, a little inside the edge-to-edge 320
        const search = ag.searchRadius || 200, grid = ag.gridStep || 40;
        const me = util.xy(character);
        const pool = packAround(reach + search).map(util.xy);
        if (pool.length < (ag.minPack || 3)) return null;
        const bad = unwantedAround(reach + search + 40).map(util.xy);
        let best = null;
        for (let gx = -search; gx <= search; gx += grid) {
            for (let gy = -search; gy <= search; gy += grid) {
                const d = Math.hypot(gx, gy);
                if (d > search) continue;
                const x = me.x + gx, y = me.y + gy;
                const dists = pool.map(function (p) { return Math.hypot(p.x - x, p.y - y); }).filter(function (v) { return v <= reach; });
                const count = dists.length;
                if (count < (ag.minPack || 3)) continue;
                // Count against the average way of the pulled monsters (player decision 2026-11-18:
                // short, even ways so they arrive together, weighted more than one more monster):
                // one monster more is worth agitate.avgPerMonster px less average way. Our own walk
                // only breaks ties.
                const avg = dists.reduce(function (s, v) { return s + v; }, 0) / count;
                const score = count - avg / (ag.avgPerMonster || 60);
                if (best && (score < best.score - 0.02 || (Math.abs(score - best.score) <= 0.02 && d >= best.d))) continue;
                if (bad.some(function (p) { return Math.hypot(p.x - x, p.y - y) <= reach + 20; })) continue;
                if (d > 0 && !can_move_to(x, y)) continue; // checked last: the costly one
                best = { x: x, y: y, count: count, d: d, avg: avg, score: score };
            }
        }
        if (best) best.here = best.d <= (ag.centerWithin || 20);
        return best;
    }

    // A step away from the pack's middle: it follows from one side and bunches up.
    function stepAway(list, stepPx) {
        const me = util.xy(character);
        const mid = centerOf(list);
        const cx = mid.x, cy = mid.y;
        let dx = me.x - cx, dy = me.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const step = stepPx || ag.kiteStep || 120;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
            const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
            const x = me.x + ux * step, y = me.y + uy * step;
            if (can_move_to(x, y)) {
                move(x, y);
                pack.lastRegroup = pack.gatherAt = Date.now();
                return true;
            }
        }
        return false;
    }

    function finishPull(reason) {
        const secs = Math.round((Date.now() - pack.since) / 1000);
        const dead = pack.pulled.filter(function (id) { const e = parent.entities[id]; return !e || e.dead; }).length;
        const avg = pack.attacks ? (pack.neighborSum / pack.attacks).toFixed(2) : "0";
        const hpUsed = Math.round((pack.startHp - character.hp) / character.max_hp * 100);
        util.log("warrior", "pull done [" + agMode() + "] (" + reason + "): " + pack.pulled.length + " pulled, " + dead + " dead, " + secs + " s, " +
            pack.attacks + " hits, " + avg + " splash neighbours per hit, HP used " + hpUsed + "%", "green");
        pack.state = "idle";
        // Keep the splash weapons a little while for the next pull, then the usual ones go back on.
        if (splashMode()) ctx.gear.holdWeapons(ag.keepMs || 60 * 1000);
    }

    // Returns true while the pack mode runs this tick (the normal combat waits).
    // "swords": no pull point, no waiting - normal combat where we stand, and Agitate on every
    // cooldown that finds free monsters, so a steady stream walks to us (player idea
    // 2026-11-18: the pull-point version lost 15% to single targets at the arctic bees, its
    // waiting cost more than the walking it saved). Only while few are on us already.
    let lastStreamLog = 0;
    // How many may be on us before the next Agitate (player decision 2026-11-18): with splash
    // more pay off (splashOnMe), during Sugar Rush (3x attack speed) sugarBonus more; low HP
    // fewer (below lowHp: 2, below minHp of the pull mode none) - also saves potions.
    function streamLimit(splash) {
        let n = splash ? (ag.splashOnMe || 5) : (ag.streamOnMe || 3);
        if (splash && character.s && character.s.sugarrush) n += (ag.sugarBonus || 2);
        // A living priest close by heals us: the party takes more at once (agitate.partyOnMe).
        if (ctx.party.enabled && ctx.party.memberNames().some(function (nm) {
            const p = nm !== character.name && get_player(nm);
            return p && !p.rip && p.ctype === "priest" && util.distanceTo(p) < 400;
        })) n = Math.max(n, ag.partyOnMe || 7);
        const hp = util.hpRatio();
        if (hp < (ag.streamStopHp || 0.4)) return 0;
        if (hp < (ag.streamLowHp || 0.6)) n = Math.min(n, 2);
        return n;
    }
    function streamAgitate(splash) {
        if (!util.canCast("agitate") || character.mp < G.skills.agitate.mp + reserve()) return;
        const coming = onMe().length;
        if (coming >= streamLimit(splash)) return; // Agitate only while fewer than the limit attack us
        const fresh = packAround(G.skills.agitate.range).filter(function (m) { return m.target !== character.name; });
        if (fresh.length < (ag.streamFrom || 1) || unwantedAround(G.skills.agitate.range).length) return;
        use_skill("agitate").catch(function () {});
        if (Date.now() - lastStreamLog > 5 * 60 * 1000) {
            lastStreamLog = Date.now();
            util.log("warrior", "agitate stream: " + fresh.length + " more on the way (" + coming + " on us)", "white");
        }
    }

    // "stream" fighting (player rules 2026-11-18): hit what is in range (ones on us first,
    // nearest first); with nobody in range, walk to the nearest monster - on its way to us
    // or free - instead of waiting. False when nothing is around (normal search takes over).
    let streamWalkTo = null;
    function streamFight(splash) {
        const inParty = ctx.party.enabled;
        const around = Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || !e.visible) return false;
            if (e.target === character.name) return true;
            return packWanted(e) && !e.target && !(ctx.targeting.inOccupied && ctx.targeting.inOccupied(e)) &&
                !util.tooSpiky(ctx.config, e) && util.distanceTo(e) <= 600;
        }).sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); });
        if (!around.length) return false;
        const inRange = around.filter(function (m) { return is_in_range(m); });
        // In a party we never walk off on our own: the normal combat (follow, assist) takes over.
        if (inParty && !inRange.length) return false;
        if (inRange.length) {
            let t = inRange.find(function (m) { return m.target === character.name; }) || inRange[0];
            if (splash) {
                // Splash stream: the one in range with the most others in the splash radius.
                const mine = onMe();
                let bestN = -1;
                inRange.forEach(function (m) { const n = splashNeighbours(m, mine); if (n > bestN) { bestN = n; t = m; } });
            }
            if (get_targeted_monster() !== t) change_target(t);
            if (can_attack(t)) attack(t).catch(function () {});
            streamWalkTo = null;
            util.status("agitate stream: " + t.mtype + " (" + onMe().length + " on us)", "green");
            return true;
        }
        // Splash: not simply the nearest one, the one with the most others around it (a clump
        // is worth a few steps more - player idea 2026-11-18): neighbours within clumpRadius
        // count clumpStep px of way each.
        let goal = around[0];
        if (splash && ag.streamToClump !== false) {
            let bestScore = -Infinity;
            around.forEach(function (m) {
                const q = util.xy(m);
                const n = around.filter(function (o) { return o !== m && Math.hypot(util.xy(o).x - q.x, util.xy(o).y - q.y) <= (ag.clumpRadius || 60); }).length;
                const score = n * (ag.clumpStep || 80) - util.distanceTo(m);
                if (score > bestScore) { bestScore = score; goal = m; }
            });
        }
        const p = util.xy(goal);
        if (!is_moving(character) || !streamWalkTo || Math.hypot(streamWalkTo.x - p.x, streamWalkTo.y - p.y) > 25) {
            streamWalkTo = p;
            if (can_move_to(p.x, p.y)) move(p.x, p.y);
            else xmove(p.x, p.y);
        }
        util.status("agitate stream: to " + (goal === around[0] ? "the nearest " : "a clump of ") + goal.mtype, "orange");
        return true;
    }

    function packTick() {
        if (!packOn()) return false;
        if (effectiveMode() === "splashstream") {
            // Stream with the splash weapons on (player test 2026-11-18).
            if (!wearingSplash()) {
                if (!splashWeapons().length) return false;
                if (!pack.busy) putOnSplash();
                return true;
            }
            ctx.gear.holdWeapons(ag.keepMs || 60 * 1000);
            streamAgitate(true);
            return streamFight(true);
        }
        if (ctx.party.enabled) return false; // pull-point modes are solo only
        if (agMode() === "swords" && (ag.swords || "stream") === "stream") {
            streamAgitate();
            return streamFight();
        }
        if (pack.busy) return true;
        const now = Date.now();
        if (pack.state === "idle") {
            const free = packAround(G.skills.agitate.range);
            if ((ag.gather || "center") !== "center" && free.length < (ag.minPack || 3)) return false; // "center": bestPullPoint looks wider
            if (util.hpRatio() < (ag.minHp || 0.8) || !util.canCast("agitate") || character.mp < G.skills.agitate.mp) return false;
            // "center": the best place to Agitate from (most pack monsters in reach, nothing
            // unwanted, shortest walk) - see bestPullPoint.
            const spot = (ag.gather || "center") === "center" ? bestPullPoint() : null;
            if ((ag.gather || "center") === "center" && !spot) return false; // no place with a pack and nothing unwanted
            const others = spot ? [] : unwantedAround(G.skills.agitate.range);
            if (others.length) {
                util.status("agitate: waiting - " + others.length + "x " + others[0].mtype + " in reach", "white");
                return false; // normal combat meanwhile; the next round may stand better
            }
            if (splashMode() && !wearingSplash()) {
                if (!splashWeapons().length) {
                    if (!pack.noWeaponsLogged) util.log("warrior", "agitate mode: no splash weapon in the bag", "orange");
                    pack.noWeaponsLogged = true;
                    return false;
                }
                putOnSplash();
                return true;
            }
            // "center" (default since 2026-11-18): walk to the best pull point first - only as
            // far as needed, so aggressive monsters don't start towards us before the Agitate
            // and arrive one by one (the arctic bees came from 50-300 px and died alone).
            if (spot && !spot.here) {
                if (!is_moving(character) || !pack.walkTo || Math.hypot(pack.walkTo.x - spot.x, pack.walkTo.y - spot.y) > 40) {
                    pack.walkTo = { x: spot.x, y: spot.y };
                    move(spot.x, spot.y);
                }
                util.status("agitate: to the pull point (" + spot.count + ")", "orange");
                return true;
            }
            if (spot && is_moving(character)) stop();
            pack.walkTo = null;
            if (util.canCast("warcry") && character.mp >= G.skills.agitate.mp + G.skills.warcry.mp) use_skill("warcry").catch(function () {});
            use_skill("agitate").catch(function () {});
            if (splashMode()) ctx.gear.holdWeapons(ag.holdMs || 10 * 60 * 1000);
            const pulledNow = packAround(G.skills.agitate.range);
            pack.pulled = pulledNow.map(function (m) { return m.id; });
            pack.since = now; pack.startHp = character.hp; pack.attacks = 0; pack.neighborSum = 0; pack.recent = [];
            const kinds = {};
            pulledNow.forEach(function (m) { kinds[m.mtype] = (kinds[m.mtype] || 0) + 1; });
            util.log("warrior", "Agitate: " + Object.keys(kinds).map(function (k) { return kinds[k] + "x " + k; }).join(", "), "yellow");
            if ((ag.gather || "center") === "step") pack.state = stepAway(pulledNow) ? "gather" : "fight";
            else {
                // A short step out of the pack: the splash works forward (around the target, the
                // warrior's own body blocks the far side), so they should come from one side.
                pack.state = ag.sideStep && stepAway(pulledNow, ag.sideStep) ? "gather" : "fight";
            }
            pack.lastAdjust = now;
            return true;
        }
        const mine = onMe();
        if (util.hpRatio() < (ag.abortHp || 0.3) && mine.length) {
            // Too hot: walk away from the pack (most pack monsters are slower than us).
            if (!is_moving(character)) stepAway(mine);
            util.status("agitate: backing off", "red");
            return true;
        }
        if (pack.state === "gather") {
            if (is_moving(character) && now - pack.gatherAt < (ag.gatherMs || 2500)) {
                util.status("agitate: gathering the pack", "orange");
                return true;
            }
            if (is_moving(character)) stop();
            pack.state = "fight";
        }
        // fight
        if (!mine.length) {
            if (now - pack.since > 3000) finishPull("no monster left on us");
            return pack.state !== "idle";
        }
        let best = null, bestN = -1;
        mine.forEach(function (m) {
            if (!is_in_range(m)) return;
            const n = splashNeighbours(m, mine);
            if (n > bestN || (n === bestN && best && m.hp < best.hp)) { best = m; bestN = n; }
        });
        if (!best && mine.length > (ag.chaseFrom || 3)) {
            util.status("agitate: waiting for the pack (" + mine.length + ")", "orange");
            return true;
        }
        // "chain" (player idea 2026-11-18): with only stragglers left, the next pull starts at
        // once - new monsters have spawned meanwhile, the stragglers follow us into the new pack
        // and there is no phase of fighting just one or two.
        if (agMode() === "chain" && mine.length <= (ag.chaseFrom || 3) && now - pack.since > 3000 &&
            util.canCast("agitate") && character.mp >= G.skills.agitate.mp + reserve()) {
            const next = bestPullPoint();
            const freshCount = next ? next.count - mine.filter(function (m) { return Math.hypot(util.xy(m).x - next.x, util.xy(m).y - next.y) <= G.skills.agitate.range - 10; }).length : 0;
            if (next && freshCount >= (ag.minPack || 3)) {
                finishPull("chained into the next pull");
                return true; // idle: walks to the pull point and pulls; the stragglers come along
            }
        }
        if (!best) {
            // Only stragglers left (chaseFrom or fewer): meet the nearest one instead of waiting (player request
            // 2026-11-18: the last 2-3 from the far side took long to arrive). Monsters first
            // walk to where we cast Agitate, then to us - so going to them is the shortest.
            const near = mine.slice().sort(function (a, b) { return util.distanceTo(a) - util.distanceTo(b); })[0];
            const p = util.xy(near);
            if (!is_moving(character) || !pack.chase || Math.hypot(pack.chase.x - p.x, pack.chase.y - p.y) > 30) {
                pack.chase = p;
                if (can_move_to(p.x, p.y)) move(p.x, p.y);
                else xmove(p.x, p.y);
            }
            util.status("agitate: to the next one (" + mine.length + " left)", "orange");
            return true;
        }
        pack.chase = null;
        // The first swing waits until most of the pack is here (waitShare of the pulled ones in
        // range, at most waitMs): a lone first arrival would just die alone.
        if (!pack.attacks && now - pack.since < (ag.waitMs || 3000)) {
            const here = mine.filter(function (m) { return is_in_range(m); }).length;
            if (here < Math.ceil(pack.pulled.length * (ag.waitShare || 0.7))) {
                util.status("agitate: " + here + "/" + pack.pulled.length + " here", "orange");
                return true;
            }
        }
        // Spread around us: step away again so they come from one side.
        const avg = pack.recent.length >= 4 ? pack.recent.reduce(function (s, n) { return s + n; }, 0) / pack.recent.length : 99;
        if ((ag.gather || "center") === "step" && mine.length >= 3 && avg < (ag.regroupBelow || 0.5) && now - pack.lastRegroup > (ag.regroupEveryMs || 8000)) {
            pack.recent = [];
            if (stepAway(mine)) { pack.state = "gather"; return true; }
        }
        // Monsters behind us (opposite the pack's main side) take no splash: a small step away
        // from all of them puts them on one side again (at most every adjustEveryMs).
        if ((ag.gather || "center") === "center" && ag.adjustStep && mine.length >= 3 && now - (pack.lastAdjust || 0) > (ag.adjustEveryMs || 4000)) {
            const me = util.xy(character), mid = centerOf(mine);
            const dx = mid.x - me.x, dy = mid.y - me.y;
            const behind = mine.filter(function (m) { const p = util.xy(m); return (p.x - me.x) * dx + (p.y - me.y) * dy < 0; });
            if (behind.length && behind.length < mine.length) {
                pack.lastAdjust = now;
                stepAway(mine, ag.adjustStep);
            }
        }
        if (get_targeted_monster() !== best) change_target(best);
        if (can_attack(best)) {
            attack(best).catch(function () {});
            pack.attacks++;
            pack.neighborSum += bestN;
            pack.recent.push(bestN);
            if (pack.recent.length > 6) pack.recent.shift();
        }
        util.status("agitate: " + mine.length + " on us, splash " + bestN, "green");
        return true;
    }

    function tryCharge() {
        if (!c.useCharge || !util.canCast("charge") || (character.s && character.s.charging)) return;
        use_skill("charge").catch(function () {});
    }

    return {
        name: "warrior",

        // Charge (+30 speed for 3.2 s, 40 s cooldown, no MP) whenever we walk – farm trips,
        // boss searches and Daisy trips too (player request 2026-11-16).
        always: function () {
            if (c.useCharge && is_moving(character)) tryCharge();
        },

        survive: function () {
            const h = c.hardShell || {};
            if (h.enabled && util.hpRatio() < (h.below || 0.45) && util.canCast("hardshell") &&
                around(200, true).some(function (m) { return (G.monsters[m.mtype] || {}).damage_type === "physical"; })) {
                use_skill("hardshell").catch(function () {});
                util.log("warrior", "Hard Shell", "yellow");
            }
            return false; // potions as usual
        },

        // Agitate "stream": while Agitate can't be cast, walk to the incoming monsters instead
        // of waiting for them (player request 2026-11-18).
        meetIncoming: function () {
            return packOn() && !ctx.party.enabled && agMode() === "swords" && (ag.swords || "stream") === "stream" &&
                (!util.canCast("agitate") || character.mp < G.skills.agitate.mp + reserve());
        },

        support: function () {
            // In a party the protective Taunt/Agitate for allies comes first, then the stream.
            if (!ctx.party.enabled && packTick()) return true; // Agitate pack mode (solo)
            if (ctx.party.enabled && onOthers().length === 0 && packTick()) return true;
            const others = onOthers();
            if (!others.length) return false;
            // Agitate: everything nearby comes to us when several monsters are on allies.
            if (others.length >= (c.agitateFrom || 3) && util.canCast("agitate") && mpLeftAfter("agitate") >= reserve() &&
                others.filter(function (m) { return util.distanceTo(m) <= G.skills.agitate.range; }).length >= (c.agitateFrom || 3)) {
                use_skill("agitate").catch(function () {});
                util.log("warrior", "Agitate (" + others.length + " monsters on allies)", "yellow");
                return false;
            }
            if (!(c.taunt && c.taunt.enabled) || !util.canCast("taunt")) return false;
            const m = others.find(function (e) { return util.distanceTo(e) <= G.skills.taunt.range && worthTaunting(e); });
            if (m) {
                use_skill("taunt", m).catch(function () {});
            }
            return false; // taunting doesn't use the attack
        },

        fight: function (target) {
            const sturdy = target.hp > character.attack * (c.sturdyHits || 4);
            if (sturdy && util.canCast("warcry") && mpLeftAfter("warcry") >= reserve() && ctx.party.enabled) {
                use_skill("warcry").catch(function () {});
            }
            if (util.canCast("cleave") && mpLeftAfter("cleave") >= reserve() && !spikyNear(G.skills.cleave.range) &&
                around(G.skills.cleave.range, false).length >= (c.cleaveFrom || 3)) {
                use_skill("cleave").catch(function () {});
            }
            if (util.canCast("stomp") && mpLeftAfter("stomp") >= reserve() && !spikyNear(G.skills.stomp.range) &&
                around(G.skills.stomp.range, true).length >= (c.stompFrom || 2)) {
                use_skill("stomp").catch(function () {});
            }
            return false; // basic attack as well
        },

        // Called while we walk: towards `target` (chase) or along a route (target null).
        move: function (target) {
            tryCharge();
            return target ? tryDash(target) : false;
        },
    };
};
