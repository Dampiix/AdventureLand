// =====================================================================
// bot_hunts – Monster Hunts from Daisy (character.s.monsterhunt).
//
// Hunts start once every fighter has config.hunts.minLevel (Daisy hands out the
// server's highest-level monster, not one that fits our level).
//
// Hunt state: { id: monster key, c: kills remaining, sn: server, ms: time left }
//
// Members share their hunt with the leader every few seconds. The leader:
//   - farms the hunt monster of any party fighter (own or a member's) that
//     is on this server, has kills left, enough time left and is safe –
//     the one expiring first wins
//   - takes the group to Daisy when a hunt is finished (c = 0) – right away, the
//     trip cooldown only limits trips for new hunts – or someone has no hunt and
//     there is nothing to hunt right now
// At Daisy every fighter turns in a finished hunt and/or takes a new one: members
// that need her walk up to her while the leader is there, and the leader waits
// (up to waitAtDaisyMaxMs) until every member's report shows it is done.
//
// A member farming on its own (bot_party detached(): the leader farms a monster it
// must not hit) works on its own hunt meanwhile – same checks, solo kill speed.
//
// A hunt is taken on only if it is safe for the whole team (same check as farm
// spots in bot_targeting: every fighter's guide agrees, no recent death there;
// config.hunts.allow/deny override it) and the remaining kills fit into the
// remaining time at the guide's kill speed. Other hunts are left to expire.
// =====================================================================

module.exports = function createHunts(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const party = ctx.party;
    const cfg = config.hunts;
    const leads = !party.isMember; // solo character or party leader

    const known = {};      // member name -> { hunt, at }
    const safeCache = {};  // monster -> { safe, at }
    let lastShare = 0;
    let nextDaisyAt = 0;   // trips for new hunts only
    let lastTripAt = 0;    // any trip (a finished hunt retries after finishedRetryMs)
    let busy = false;      // leader: Daisy trip running
    let talking = false;   // interact() running
    let sticky = null;     // { name, id } – the hunt the team is working on

    comms.on("hunt", function (data, from) {
        known[from] = { hunt: data.hunt || null, at: Date.now() };
    });

    // Hunts start once the whole team has reached cfg.minLevel: Daisy hands out the
    // server's highest-level monster, not one that fits our level.
    let loggedWait = false;
    function active() {
        if (!cfg.enabled) return false;
        const lvl = leads ? util.teamLevel(config) : character.level;
        const ok = lvl >= (cfg.minLevel || 0);
        if (!ok && !loggedWait && leads) {
            loggedWait = true;
            util.log("hunt", "hunts start at level " + cfg.minLevel + " (team is " + lvl + ")", "white");
        }
        if (ok) loggedWait = false;
        return ok;
    }

    function serverName() {
        return server.region + " " + server.id;
    }

    function own() {
        const h = character.s && character.s.monsterhunt;
        return h ? { id: h.id, c: h.c, sn: h.sn, ms: h.ms } : null;
    }

    // No hunt yet, or a finished one waiting to be turned in.
    function needsDaisy(h) {
        return !h || h.c === 0;
    }

    function share(now) {
        if (!party.isMember || (!now && Date.now() - lastShare < cfg.shareMs)) return;
        lastShare = Date.now();
        comms.send(config.leader, "hunt", { hunt: own() });
    }

    // Safe = the same team check as farm spots (bot_targeting): every fighter's guide
    // agrees, trials only once proven, no recent death there. Re-checked every 2 min.
    function isSafe(monster) {
        if (cfg.deny.includes(monster)) return false;
        if (cfg.allow.includes(monster)) return true;
        if (!G.monsters[monster]) return false;
        const cached = safeCache[monster];
        const died = ctx.targeting && ctx.targeting.deathAt ? ctx.targeting.deathAt(monster) : 0;
        if (cached && Date.now() - cached.at < 2 * 60 * 1000 && !(cached.safe && died > cached.at)) return cached.safe;
        let why = "no targeting module";
        try {
            why = ctx.targeting ? ctx.targeting.whyUnsafe(monster) : why;
        } catch (e) {
            why = "check failed: " + util.errReason(e);
        }
        const safe = !why;
        if (!safe && (!cached || cached.safe)) util.log("hunt", monster + " hunt skipped: " + why, "orange");
        safeCache[monster] = { safe: safe, at: Date.now() };
        return safe;
    }

    // Seconds per kill for the team at this monster, from the leader's guide (fastest
    // route): the kill part speeds up with the team (config.hunts.teamSpeedup), the
    // respawn limit of the spot does not. null when the guide has no route.
    const cycleCache = {};
    function solo() { return !leads && !!(party.detached && party.detached()); }
    function teamKillSeconds(monster) {
        const c = cycleCache[monster];
        if (c && Date.now() - c.at < 5 * 60 * 1000) return c.s;
        let best = null;
        try {
            ((get_progression() || {}).routes || []).forEach(function (r) {
                if (!r || r.monster !== monster) return;
                const s = util.teamCycle(r, solo() ? 1 : cfg.teamSpeedup);
                if (s !== null && (best === null || s < best)) best = s;
            });
        } catch (e) { /* guide not ready */ }
        cycleCache[monster] = { s: best, at: Date.now() };
        return best;
    }

    // Can the team finish this hunt before it expires?
    const timeLogged = {};
    function fitsInTime(x) {
        const h = x.hunt;
        const s = teamKillSeconds(h.id);
        const ok = s !== null && h.c * s * 1000 <= h.ms;
        const id = x.name + ":" + h.id;
        if (!ok && !timeLogged[id]) {
            timeLogged[id] = true;
            util.log("hunt", h.id + " hunt of " + x.name + ": " + h.c + " kills" +
                (s === null ? " - no route from the guide" : " need ~" + Math.round(h.c * s / 60) + " min, " + Math.round(h.ms / 60000) + " min left") +
                " - skipping it", "orange");
        }
        return ok;
    }

    // Hunts of every fighter we know about (own + fresh member reports).
    // A member's last report stays usable for a few minutes (a missed message must
    // not make the leader drop the hunt); its remaining time is aged accordingly.
    function allHunts() {
        const list = [{ name: character.name, hunt: own() }];
        const now = Date.now();
        Object.keys(known).forEach(function (name) {
            const k = known[name];
            const age = now - k.at;
            if (age > 3 * 60 * 1000 || !config.characters[name]) return;
            const hunt = k.hunt ? Object.assign({}, k.hunt, { ms: k.hunt.ms - age }) : null;
            list.push({ name: name, hunt: hunt });
        });
        return list;
    }

    // Hunts only for monsters among the team's best XP spots (config.hunts.xpTop, player decision
    // 2026-11-20): a fresh account hunts its beginner monsters - they are its best XP anyway - and
    // stops once it outgrows them (bees, snakes and goos kept a level-54 team from its XP spots).
    // Skipped hunts run out; Daisy hands out the next one. No ranking yet (guide not ready): allowed.
    const rankLogged = {};
    function inXpTop(monster) {
        const n = cfg.xpTop;
        if (!n || cfg.allow.includes(monster)) return true;
        const list = ctx.targeting && ctx.targeting.xpRanking ? ctx.targeting.xpRanking() : null;
        if (!list) return true;
        const rank = list.indexOf(monster);
        const ok = rank !== -1 && rank < n;
        if (!ok && !rankLogged[monster]) {
            util.log("hunt", monster + " hunt skipped: not among the top " + n + " XP spots (" + (rank === -1 ? "not listed" : "#" + (rank + 1)) + "; top: " + list.slice(0, n).join(", ") + ")", "white");
        }
        rankLogged[monster] = !ok;
        return ok;
    }

    // Leader (or a member farming on its own: only its own hunt): the hunt monster to
    // farm right now, or null.
    function target() {
        const alone = solo();
        if ((!leads && !alone) || !active()) return null;
        const sn = serverName();
        const open = (alone ? [{ name: character.name, hunt: own() }] : allHunts())
            .filter(function (x) {
                const h = x.hunt;
                return h && h.c > 0 && h.sn === sn && h.ms > cfg.minRemainingMs && isSafe(h.id) && inXpTop(h.id) && fitsInTime(x);
            })
            .sort(function (a, b) { return a.hunt.ms - b.hunt.ms; });
        if (!open.length) {
            sticky = null;
            return null;
        }
        // Stick with the hunt we're on until it is done or no longer open – two hunts
        // with similar remaining time must not make the team walk back and forth.
        let pick = sticky && open.find(function (x) { return x.name === sticky.name && x.hunt.id === sticky.id; });
        if (!pick) {
            pick = open[0];
            sticky = { name: pick.name, id: pick.hunt.id };
        }
        return { monster: pick.hunt.id, source: "hunt of " + pick.name + ", " + pick.hunt.c + " left" };
    }

    // A finished hunt goes to Daisy at once (its token is lost when the hunt expires);
    // the trip cooldown only applies to fetching new hunts.
    function wantsDaisy() {
        if (!leads || !active()) return false;
        const now = Date.now();
        const hunts = allHunts();
        const finished = hunts.some(function (x) { return x.hunt && x.hunt.c === 0 && x.hunt.ms > 0; });
        if (finished && now - lastTripAt >= (cfg.finishedRetryMs || 60 * 1000)) return true;
        const missing = hunts.some(function (x) { return !x.hunt; });
        return now >= nextDaisyAt && missing && !target();
    }

    function daisyPos() {
        const npc = (G.maps.main.npcs || []).find(function (n) { return n.id === "monsterhunter"; });
        return npc ? { x: npc.position[0], y: npc.position[1] } : null;
    }

    // Leader at Daisy: members still waiting to turn in or to take a hunt (fresh reports).
    function membersPending() {
        return allHunts().filter(function (x) {
            return x.name !== character.name && party.inParty(x.name) && needsDaisy(x.hunt);
        }).map(function (x) { return x.name; });
    }

    function nearDaisy() {
        const p = daisyPos();
        return character.map === "main" && !!p && util.distanceTo(p) < cfg.daisyRange;
    }

    // Turn in a finished hunt and/or take a new one. Needs to stand at Daisy.
    async function talk() {
        if (talking) return;
        talking = true;
        try {
            let h = own();
            if (h && h.c === 0) {
                await interact("monsterhunt");
                util.log("hunt", "turned in " + h.id + " - Monster Token received", "green");
                await sleep(500);
                h = own();
            }
            if (!h) {
                await interact("monsterhunt");
                await sleep(500);
                const fresh = own();
                if (fresh) util.log("hunt", "new hunt: " + fresh.c + "x " + fresh.id, "yellow");
            }
            share(true); // tell the leader right away (it waits for us at Daisy)
        } catch (e) {
            util.log("hunt", "Daisy: " + util.errReason(e), "orange");
        } finally {
            talking = false;
        }
    }

    let interrupted = false;
    async function visitDaisy() {
        busy = true;
        try {
            util.status("visiting Daisy", "yellow");
            await smart_move("monsterhunter");
            await talk();
            // Members arrive and talk to her too: wait until each one reports it is done.
            const start = Date.now();
            await sleep(cfg.waitAtDaisyMs);
            let pending = membersPending();
            while (pending.length && Date.now() - start < (cfg.waitAtDaisyMaxMs || 45000)) {
                util.status("at Daisy, waiting for " + pending.join(", "), "yellow");
                await sleep(1000);
                pending = membersPending();
            }
            if (pending.length) util.log("hunt", "left Daisy - still pending: " + pending.join(", "), "orange");
        } catch (e) {
            const reason = util.errReason(e);
            // Stopped on the way (e.g. the handover to the merchant stands us still): go again
            // right away instead of waiting out the trip cooldown (2026-11-17).
            interrupted = /interrupt|stop/i.test(reason);
            util.log("hunt", "trip to Daisy " + (interrupted ? "interrupted - going again" : "failed: " + reason), interrupted ? "yellow" : "red");
        } finally {
            nextDaisyAt = interrupted ? 0 : Date.now() + cfg.visitCooldownMs;
            lastTripAt = interrupted ? 0 : Date.now();
            interrupted = false;
            busy = false;
        }
    }

    // Called every fighter tick. Returns "busy" while the leader is on a Daisy trip.
    function tick() {
        if (!active()) return "ok";
        share();
        // Members piggyback on the leader's trip: while the leader stands at Daisy, walk
        // up to her (following alone may stop just outside her range) and talk.
        if (party.isMember && needsDaisy(own())) {
            const lead = party.leaderInfo();
            const d = daisyPos();
            if (lead && d && lead.map === "main" && Math.hypot(lead.x - d.x, lead.y - d.y) < cfg.daisyRange + 50) {
                if (nearDaisy()) { if (!talking) talk(); return "busy"; }
                util.status("walking to Daisy", "yellow");
                if (!is_moving(character)) {
                    if (character.map === "main") xmove(d.x, d.y + 30);
                    else smart_move({ map: "main", x: d.x, y: d.y + 30 }).catch(function () {});
                }
                return "busy";
            }
        }
        if (!talking && needsDaisy(own()) && nearDaisy()) talk();
        if (busy) return "busy";
        if (wantsDaisy()) {
            visitDaisy();
            return "busy";
        }
        return "ok";
    }

    // A boss fight came up (fighter.busyStep): stop a Daisy trip on its way. It goes again later
    // (an interrupted trip has no cooldown).
    function abort() {
        if (!busy || talking || !smart.moving) return;
        // Only our own walk to her - not the boss travel that may have replaced it already.
        const d = daisyPos();
        if (d && (smart.map !== "main" || Math.hypot((smart.x || 0) - d.x, (smart.y || 0) - d.y) > 150)) return;
        try { stop("smart"); } catch (e) { /* nothing to stop */ }
    }

    // Open hunts (leader) that only fail the safety check - e.g. every spot of the kind found too strong. The
    // Cavalry plan may reset one of those spots for them (targeting.cavalryPlan, 2026-11-22). Monster names.
    function blocked() {
        if (!leads || !active()) return [];
        const sn = serverName();
        return allHunts().filter(function (x) {
            const h = x.hunt;
            return h && h.c > 0 && h.sn === sn && h.ms > cfg.minRemainingMs && !cfg.deny.includes(h.id) && inXpTop(h.id) && fitsInTime(x) && !isSafe(h.id);
        }).map(function (x) { return x.hunt.id; });
    }

    return { tick: tick, target: target, abort: abort, blocked: blocked };
};
