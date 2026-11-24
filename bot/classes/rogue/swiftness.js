// =====================================================================
// classes/rogue/swiftness.js - Rogue Swiftness (level 40, 45 min speed buff): ourselves first, then in a party every
// member in reach that lacks it, keeping the MP reserve.
// Interface: createSwiftness(deps, options) -> { tick() }
//   deps: game, members(), partyEnabled(), distanceTo(e), reserve() -> MP to keep
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
};

module.exports = function createSwiftness(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});
    let lastSwift = 0;

    function hasRspeed(p) {
        return !!(p && p.s && p.s.rspeed);
    }
    function tick() {
        const me = game.me(), G = game.data();
        if (!o.enabled || Date.now() - lastSwift < 3000 || !game.canCast("rspeed")) return;
        if (game.mpLeftAfter("rspeed") < deps.reserve()) return;
        let who = !hasRspeed(me) ? me : null;
        if (!who && deps.partyEnabled()) {
            who = deps.members().map(function (n) { return n === me.name ? null : game.player(n); })
                .find(function (p) { return p && !p.rip && !hasRspeed(p) && deps.distanceTo(p) <= G.skills.rspeed.range; }) || null;
        }
        if (!who) return;
        lastSwift = Date.now();
        game.useSkill("rspeed", who).catch(function () {});
    }

    return { tick: tick };
};
