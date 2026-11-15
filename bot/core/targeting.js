// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. a live event / world boss (bot_events)
//   2. an open, safe Monster Hunt of any party fighter (bot_hunts)
//   3. per-character or global farm setting (config.characters[name].farm,
//      config.targeting.farm)
//   4. the game's progression guide: get_progression().choices
//      (top safe farm routes for this character's current gear)
//   5. config.targeting.fallback
// Party members use the leader's farm target instead.
//
// Target choice:
//   leader / solo: current target > monster attacking a party member
//                  > nearest free farm monster
//   party member:  current target > monster attacking a party member
//                  > the leader's target – members never open fights,
//                  so the tank keeps the aggro
// =====================================================================

module.exports = function createTargeting(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const party = ctx.party;
    const cfg = config.targeting;
    let farm = null;
    let nextPickAt = 0;
    const crowdedUntil = {}; // monster -> timestamp: skip this guide choice until then
    let idleSince = 0;       // on the farm map without a free target since

    // The guide's farm choices (up to three safe routes, best first), skipping
    // monsters whose spot was recently found crowded.
    function fromProgression() {
        let list = [];
        try {
            const advice = get_progression();
            if (!advice) return null;
            list = (advice.choices || [])
                .filter(function (c) { return c.kind === "farm" && G.monsters[c.monster]; })
                .map(function (c) { return { monster: c.monster, map: c.map, source: "guide" }; });
            if (!list.length) {
                const row = (advice.rows || []).find(function (r) {
                    return r.action && r.action.kind === "farm" && r.action.route && G.monsters[r.action.route.monster];
                });
                if (row) list = [{ monster: row.action.route.monster, map: row.action.route.map, source: "guide task" }];
            }
        } catch (e) {
            util.log("target", "get_progression failed: " + util.errReason(e), "red");
        }
        if (!list.length) return null;
        const now = Date.now();
        const free = list.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (free) return free;
        // Every choice is crowded: take the one that frees up first.
        return list.slice().sort(function (a, b) { return crowdedUntil[a.monster] - crowdedUntil[b.monster]; })[0];
    }

    // Called by the fighter every combat tick. If we stand on the farm map for
    // a while without any free target (other players clear the spot), mark the
    // spot as crowded and move on to the guide's next choice.
    function reportSearch(found) {
        if (found || !farm || !String(farm.source).startsWith("guide") || character.map !== farm.map) {
            idleSince = 0;
            return;
        }
        const now = Date.now();
        if (!idleSince) idleSince = now;
        if (now - idleSince < cfg.crowdedAfterMs) return;
        crowdedUntil[farm.monster] = now + cfg.crowdedForMs;
        util.log("target", farm.monster + " spot looks crowded - trying another target for " + Math.round(cfg.crowdedForMs / 60000) + " min", "orange");
        idleSince = 0;
        nextPickAt = 0; // pick again right away
    }

    function currentFarm() {
        // Events and world bosses come first (bot_events; members get it from the leader).
        const ev = ctx.events ? ctx.events.current() : null;
        if (ev) {
            const next = ev.join
                ? { monster: null, any: true, source: "event " + ev.name }
                : { monster: ev.monster || ev.name, dest: ev.dest || ev.monster || ev.name, source: "event " + ev.name };
            if (!farm || farm.source !== next.source) util.log("target", "now: " + next.source, "yellow");
            farm = next;
            nextPickAt = 0;
            return farm;
        }

        const lead = party.leaderInfo();
        if (lead && lead.farm) {
            if (!farm || farm.monster !== lead.farm) util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            farm = { monster: lead.farm, source: "leader" };
            nextPickAt = 0;
            return farm;
        }

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;

        // An open, safe Monster Hunt beats both the guide and a configured farm target;
        // the configured target only replaces the guide's choice.
        const hunt = ctx.hunts ? ctx.hunts.target() : null;
        if (hunt) {
            if (!farm || farm.monster !== hunt.monster) util.log("target", "farm target: " + hunt.monster + " (" + hunt.source + ")", "yellow");
            farm = hunt;
            nextPickAt = 0; // re-evaluate the guide as soon as the hunt is over
            return farm;
        }

        const now = Date.now();
        if (farm && now < nextPickAt) return farm; // hunt/leader targets reset nextPickAt to 0

        let next = override ? { monster: override, source: "config" } : fromProgression();
        if (!next) next = { monster: config.targeting.fallback, source: "fallback" };

        // The guide may not be ready right after login: retry soon instead of waiting minutes.
        nextPickAt = now + (next.source === "fallback" ? 30 * 1000 : config.targeting.refreshMs);

        if (!farm || farm.monster !== next.monster) {
            util.log("target", "farm target: " + next.monster + " (" + next.source + ")", "yellow");
        }
        farm = next;
        return farm;
    }

    function isOurs(name) {
        return name === character.name || party.inParty(name);
    }

    // Cooperative monsters (event bosses, Phoenix, ...) reward every contributor,
    // so fighting them alongside other players is fine.
    function isCoop(t) {
        const def = G.monsters[t.mtype];
        return !!(def && def.cooperative);
    }

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (t.target && !isOurs(t.target) && !isCoop(t)) return false;
        return true;
    }

    // Nearest monster attacking us or any party member (V1's party-aggro priority).
    function nearestPartyAttacker() {
        const names = party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        let best = null;
        let bestDistance = Infinity;
        names.forEach(function (name) {
            const m = get_nearest_monster({ target: name });
            if (!m) return;
            const d = util.distanceTo(m);
            if (d < bestDistance) { best = m; bestDistance = d; }
        });
        return best;
    }

    function pick(farmTarget) {
        const current = get_targeted_monster();
        if (isValid(current)) return current;

        const attacker = nearestPartyAttacker();
        if (attacker) return attacker;

        if (party.isMember) {
            // Party member: only assist the leader, never pull new monsters –
            // and never wander off to a farm spot of our own.
            const lead = party.leaderInfo();
            const assist = lead && lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && (assist.target || isCoop(assist)) ? assist : null;
        }

        if (farmTarget.any) {
            // Join event: anything in the event map is fair game.
            const m = get_nearest_monster({});
            return isValid(m) ? m : null;
        }
        const type = farmTarget.monster;
        if (G.monsters[type] && G.monsters[type].cooperative) {
            const boss = get_nearest_monster({ type: type });
            if (isValid(boss)) return boss;
        }
        return get_nearest_monster({ type: type, no_target: true });
    }

    return { currentFarm: currentFarm, pick: pick, isValid: isValid, reportSearch: reportSearch };
};
