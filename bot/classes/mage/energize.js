// =====================================================================
// classes/mage/energize.js - Energize (level 20; costs no MP itself, hands over the MP we pass and gives the target
// "energized": +80 % attack speed for 0.8 s; cooldown 4 s, range 320).
//   1) MP to a member below energizeBelow, keeping energizeAbove of ours (the Blaster needs it);
//   2) else a speed burst (1 MP) on the strongest damage dealer that is fighting - solo ourselves, timed just before our
//      next attack. The server counts both as our party contribution (XP share).
// Interface: createEnergize(deps, options) -> { tick() }
//   deps:    game (lib/game.js), members() -> party member names, log(tag, text, color), errReason(e)
//   options: see DEFAULTS
// Works for any class that has the skill (it only asks the game whether we can cast it).
// =====================================================================

const DEFAULTS = {
    enabled: true,
    energizeBelow: 0.4,  // a member below this MP ratio gets MP
    energizeAbove: 0.6,  // only while we have more than this (and keep this share)
    burstLeadMs: 250,    // our own burst only when our next attack is due within this
};

module.exports = function createEnergize(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function energizeTarget() {
        const me = game.me();
        let best = null;
        deps.members().forEach(function (name) {
            if (name === me.name) return;
            const p = game.player(name);
            if (!p || p.rip || !p.max_mp) return;
            const ratio = p.mp / p.max_mp;
            if (ratio >= o.energizeBelow) return;
            if (!game.inRange(p, "energize")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio, missing: p.max_mp - p.mp };
        });
        return best;
    }

    let selfEnergizeOk = true, energizeLogAt = 0;
    function fighting(p) { return !!(p && !p.rip && (p.target || (p === game.me() && game.targetedMonster()))); }
    function burstTarget() {
        const me = game.me();
        let best = null, bestPow = 0;
        const consider = function (p, self) {
            if (!p || !fighting(p) || (!self && !game.inRange(p, "energize"))) return;
            if (p.s && p.s.energized) return;
            const pow = (p.attack || 0) * (p.frequency || 1);
            if (pow > bestPow) { bestPow = pow; best = { p: p, self: self }; }
        };
        if (selfEnergizeOk) consider(me, true);
        deps.members().forEach(function (name) { if (name !== me.name) consider(game.player(name), false); });
        return best;
    }
    function tick() {
        const me = game.me();
        if (!o.enabled || me.level < (game.data().skills.energize.level || 20) || !game.canCast("energize")) return;
        const t = energizeTarget();
        if (t && game.mpRatio() > o.energizeAbove) {
            const give = Math.floor(Math.min(t.missing, me.mp - me.max_mp * o.energizeAbove));
            if (give >= 50) { game.useSkill("energize", t.name, give).catch(function () {}); return; }
        }
        const b = burstTarget();
        if (!b) return;
        if (b.self) {
            // Our own burst only right before the next attack: the 0.8 s window then holds a faster one.
            const next = game.nextAttackAt();
            const left = next ? next - new Date() : 0;
            if (left > (o.burstLeadMs || 250)) return;
        }
        game.useSkill("energize", b.self ? me.name : b.p.name, 1).catch(function (e) {
            if (b.self && selfEnergizeOk) {
                selfEnergizeOk = false; // the server refuses ourselves: members only
                deps.log("mage", "Energize on myself refused (" + deps.errReason(e) + ") - only on members", "orange");
            }
        });
        if (Date.now() - energizeLogAt > 10 * 60 * 1000) {
            energizeLogAt = Date.now();
            deps.log("mage", "Energize burst on " + (b.self ? "myself" : b.p.name), "white");
        }
    }

    return { tick: tick };
};
