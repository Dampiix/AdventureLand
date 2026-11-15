// =====================================================================
// bot_hunts – Monster Hunts from Daisy (character.s.monsterhunt).
//
// Hunt state: { id: monster key, c: kills remaining, sn: server, ms: time left }
//
// Members share their hunt with the leader every few seconds. The leader:
//   - farms the hunt monster of any party fighter (own or a member's) that
//     is on this server, has kills left, enough time left and is safe –
//     the one expiring first wins
//   - takes the group to Daisy when a hunt is finished (c = 0) or someone
//     has no hunt and there is nothing to hunt right now
// At Daisy every fighter turns in a finished hunt and/or takes a new one.
//
// "Safe" = the progression guide lists a safe farm route for the monster
// (get_progression with a farm goal), unless config.hunts.allow/deny
// overrides it. Unsafe hunts are simply left to expire.
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
    let nextDaisyAt = 0;
    let busy = false;      // leader: Daisy trip running
    let talking = false;   // interact() running
    let sticky = null;     // { name, id } – the hunt the team is working on

    comms.on("hunt", function (data, from) {
        known[from] = { hunt: data.hunt || null, at: Date.now() };
    });

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

    function share() {
        if (!party.isMember || Date.now() - lastShare < cfg.shareMs) return;
        lastShare = Date.now();
        comms.send(config.leader, "hunt", { hunt: own() });
    }

    function isSafe(monster) {
        if (cfg.deny.includes(monster)) return false;
        if (cfg.allow.includes(monster)) return true;
        const def = G.monsters[monster];
        if (!def) return false;
        // Trivially weak for us (goos, bees, ...): no need to ask the guide.
        if (!def.cooperative && def.hp <= character.attack * 5 && def.attack <= character.max_hp * 0.1) return true;
        const cached = safeCache[monster];
        // A "safe" verdict holds for an hour, an "unsafe" one is re-checked after 10 min,
        // so a hunt target doesn't flip back and forth while we work on it.
        if (cached && Date.now() - cached.at < (cached.safe ? 60 : 10) * 60 * 1000) return cached.safe;
        let safe = false;
        try {
            const advice = get_progression({ goal: { kind: "farm", monster: monster } });
            safe = (advice.rows || []).some(function (r) {
                return r.action && r.action.kind === "farm" && r.action.route && r.action.route.monster === monster;
            });
        } catch (e) {
            util.log("hunt", "safety check failed for " + monster + ": " + util.errReason(e), "red");
        }
        safeCache[monster] = { safe: safe, at: Date.now() };
        if (!safe) util.log("hunt", monster + " looks unsafe - not hunting it", "orange");
        return safe;
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

    // Leader: the hunt monster to farm right now, or null.
    function target() {
        if (!cfg.enabled || !leads) return null;
        const sn = serverName();
        const open = allHunts()
            .filter(function (x) {
                const h = x.hunt;
                return h && h.c > 0 && h.sn === sn && h.ms > cfg.minRemainingMs && isSafe(h.id);
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

    function wantsDaisy() {
        if (!cfg.enabled || !leads || Date.now() < nextDaisyAt) return false;
        const hunts = allHunts();
        const finished = hunts.some(function (x) { return x.hunt && x.hunt.c === 0; });
        const missing = hunts.some(function (x) { return !x.hunt; });
        return finished || (missing && !target());
    }

    function nearDaisy() {
        if (character.map !== "main") return false;
        const npc = (G.maps.main.npcs || []).find(function (n) { return n.id === "monsterhunter"; });
        return !!npc && util.distanceTo({ x: npc.position[0], y: npc.position[1] }) < cfg.daisyRange;
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
        } catch (e) {
            util.log("hunt", "Daisy: " + util.errReason(e), "orange");
        } finally {
            talking = false;
        }
    }

    async function visitDaisy() {
        busy = true;
        try {
            util.status("visiting Daisy", "yellow");
            await smart_move("monsterhunter");
            await talk();
            await sleep(cfg.waitAtDaisyMs); // members arrive and talk to her too
        } catch (e) {
            util.log("hunt", "trip to Daisy failed: " + util.errReason(e), "red");
        } finally {
            nextDaisyAt = Date.now() + cfg.visitCooldownMs;
            busy = false;
        }
    }

    // Called every fighter tick. Returns "busy" while the leader is on a Daisy trip.
    function tick() {
        if (!cfg.enabled) return "ok";
        share();
        if (!talking && needsDaisy(own()) && nearDaisy()) talk(); // members piggyback on the leader's trip
        if (busy) return "busy";
        if (wantsDaisy()) {
            visitDaisy();
            return "busy";
        }
        return "ok";
    }

    return { tick: tick, target: target };
};
