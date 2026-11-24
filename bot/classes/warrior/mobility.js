// =====================================================================
// classes/warrior/mobility.js - Charge whenever we walk and Dash towards a monster in a fight (off in the config).
// Part of the warrior (module plan, stage 2): moved verbatim from the old single-file warrior.js. The warrior's parts
// share one internal state (w: the pack, the auto decision, the last Agitate, the speed reference) and call each
// other through w; outside dependencies come in deps (game, util, config, party, targeting, gear, strike, events).
// =====================================================================

module.exports = function install(w, deps) {
    const game = deps.game;
    const util = deps.util;
    const quiet = util.quiet;
    const c = deps.config.classes.warrior;
    const ag = c.agitate || {};
    const mpLeftAfter = util.mpLeftAfter;

    // Dash: a short jump towards a point ([x, y]). It has no cooldown, so we space the
    // jumps ourselves (dash.everyMs) – otherwise every tick jumps and drains the MP.
    // A failure pauses it instead of retrying every tick.
    // Combat dash (player decision 2026-11-21, earthiverse's useWarriorDash): only when we go for a
    // monster in a fight - our target, or the member it hits (the priest pulled it, we meet it there
    // and taunt it off) - never on a route (fighter.travel passes no target). The server jumps at
    // most 50 px (farther fails and the MP is gone) at speed 500 and finds a safe landing spot itself
    // (also at 80 % / 60 % of the way) - ~0.5 s saved per jump at our speed. The jump lands short of
    // the monster (range x 0.8), only above minMpRatio MP (the reserve for Taunt and Cleave stays),
    // one per everyMs (the server's dash state lasts 1 s). After it lands we walk on at once - the
    // old dash stood still after the hop because no move followed in the same tick.
    let dashPausedUntil = 0;
    let lastDash = 0;
    function tryDash(target) {
        const d = c.dash || {};
        if (!d.enabled || !target || Date.now() < dashPausedUntil || Date.now() - lastDash < (d.everyMs || 1000)) return false;
        if (game.me().s && game.me().s.dash) return false;
        if ((game.path() && game.path().moving)) return false; // routes: Charge only
        if (!util.canCast("dash") || util.mpRatio() < (d.minMpRatio || 0.5) || mpLeftAfter("dash") < w.reserve()) return false;
        const dist = util.distanceTo(target);
        if (dist < (d.from || 80)) return false;
        const p = util.xy(target);
        const step = Math.min(d.max || 49, dist - (game.me().range || 20) * 0.8);
        if (step < 20) return false;
        const k = step / dist;
        const to = [game.me().real_x + (p.x - game.me().real_x) * k, game.me().real_y + (p.y - game.me().real_y) * k];
        lastDash = Date.now();
        game.useSkill("dash", to).then(function () {
            // Landed (~0.1 s): on towards the monster right away.
            setTimeout(function () {
                try { const q = util.xy(target); if (!target.dead) game.walkStraight(q.x, q.y); } catch (e) { /* gone */ }
            }, 150);
        }).catch(function (e) {
            dashPausedUntil = Date.now() + (d.pauseMs || 10 * 1000);
            util.log("warrior", "dash failed: " + util.errReason(e) + " - pausing it for " + Math.round((d.pauseMs || 10000) / 1000) + " s", "orange");
        });
        return true;
    }

    function tryCharge() {
        if (!c.useCharge || !util.canCast("charge") || (game.me().s && game.me().s.charging)) return;
        game.useSkill("charge").catch(function () {});
    }

    Object.assign(w, {
        tryDash: tryDash,
        tryCharge: tryCharge,
    });
};
