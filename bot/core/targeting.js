// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. per-character override (config.characters[name].farm)
//   2. global override (config.targeting.farm)
//   3. the game's progression guide: get_progression().choices
//      (top safe farm routes for this character's current gear)
//   4. config.targeting.fallback
// =====================================================================

module.exports = function createTargeting(ctx) {
    const config = ctx.config;
    const util = ctx.util;
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
        const now = Date.now();
        if (farm && now < nextPickAt) return farm;

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

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (t.target && t.target !== character.name && !isPartyMember(t.target)) return false;
        return true;
    }

    function isPartyMember(name) {
        const party = get_party() || {};
        return Object.prototype.hasOwnProperty.call(party, name);
    }

    // Priority: current target > monsters attacking us > nearest free farm monster.
    function pick(monster) {
        const current = get_targeted_monster();
        if (isValid(current)) return current;

        const attacker = get_nearest_monster({ target: character.name });
        if (attacker) return attacker;

        return get_nearest_monster({ type: monster, no_target: true });
    }

    return { currentFarm: currentFarm, pick: pick, isValid: isValid };
};
