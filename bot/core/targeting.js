// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. per-character override (config.characters[name].farm)
//   2. global override (config.targeting.farm)
//   3. the game's progression guide: get_progression().choices
//      (top safe farm routes for this character's current gear)
//   4. config.targeting.fallback
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
    let farm = null;
    let nextPickAt = 0;

    function fromProgression() {
        try {
            const advice = get_progression();
            if (!advice) return null;
            const choice = (advice.choices || []).find(function (c) {
                return c.kind === "farm" && G.monsters[c.monster];
            });
            if (choice) return { monster: choice.monster, map: choice.map, source: "guide" };
            const row = (advice.rows || []).find(function (r) {
                return r.action && r.action.kind === "farm" && r.action.route && G.monsters[r.action.route.monster];
            });
            if (row) return { monster: row.action.route.monster, map: row.action.route.map, source: "guide task" };
        } catch (e) {
            util.log("target", "get_progression failed: " + util.errReason(e), "red");
        }
        return null;
    }

    function currentFarm() {
        const lead = party.leaderInfo();
        if (lead && lead.farm) {
            if (!farm || farm.monster !== lead.farm) util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            farm = { monster: lead.farm, source: "leader" };
            return farm;
        }

        const now = Date.now();
        if (farm && farm.source !== "leader" && now < nextPickAt) return farm;

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;
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

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (t.target && !isOurs(t.target)) return false;
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

    function pick(monster) {
        const current = get_targeted_monster();
        if (isValid(current)) return current;

        const attacker = nearestPartyAttacker();
        if (attacker) return attacker;

        const lead = party.leaderInfo();
        if (lead) {
            // Party member: only assist the leader, never pull new monsters.
            const assist = lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && assist.target ? assist : null;
        }

        return get_nearest_monster({ type: monster, no_target: true });
    }

    return { currentFarm: currentFarm, pick: pick, isValid: isValid };
};
