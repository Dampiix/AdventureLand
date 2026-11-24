// =====================================================================
// classes/rogue/fanofknives.js - Fan of Knives (level 65): five knives on the monsters around us, with at least fanFrom
// of them in reach (free or on us, no damage-return ones). The skill comes from the Knife Belt: only while it is worn in
// the belt slot (the skill's slot requirement), keeping the MP reserve. Works for any class wearing the belt.
// Interface: createFanOfKnives(deps, options) -> { fight(target) }
//   deps: game, distanceTo(e), tooSpiky(m), reserve() -> MP to keep
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    fanFrom: 3,   // with this many monsters around (0 = off)
};

module.exports = function createFanOfKnives(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function wearsKnifeBelt() {
        const me = game.me(), G = game.data();
        const b = me.slots && me.slots.belt;
        const need = (G.skills.fanofknives.slot || []).find(function (s) { return s[0] === "belt"; });
        return !!(b && need && b.name === need[1]);
    }
    function fight() {
        const me = game.me(), G = game.data();
        if (o.fanFrom && game.canCast("fanofknives") && wearsKnifeBelt() && game.mpLeftAfter("fanofknives") >= deps.reserve()) {
            const near = Object.values(game.entities()).filter(function (e) {
                return e && e.type === "monster" && !e.dead && deps.distanceTo(e) <= G.skills.fanofknives.range &&
                    (!e.target || e.target === me.name) && !deps.tooSpiky(e);
            });
            if (near.length >= o.fanFrom) game.useSkill("fanofknives").catch(function () {});
        }
    }

    return { fight: fight };
};
