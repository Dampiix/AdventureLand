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
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range + 20 && util.tooSpiky(ctx.config, e);
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
        if (typeof can_move_to === "function" && !can_move_to(p.x, p.y)) return false;
        // Land just short of the target, at most d.max away.
        const step = Math.min(d.max || 150, dist - (character.range || 20) * 0.7);
        if (step < 40) return false;
        const k = step / dist;
        const to = [character.real_x + (p.x - character.real_x) * k, character.real_y + (p.y - character.real_y) * k];
        lastDash = Date.now();
        use_skill("dash", to).catch(function (e) {
            dashPausedUntil = Date.now() + 60 * 1000;
            util.log("warrior", "dash failed: " + util.errReason(e) + " - pausing it for a minute", "orange");
        });
        return true;
    }

    function tryCharge() {
        if (!c.useCharge || !util.canCast("charge") || (character.s && character.s.charging)) return;
        use_skill("charge").catch(function () {});
    }

    return {
        name: "warrior",

        survive: function () {
            const h = c.hardShell || {};
            if (h.enabled && util.hpRatio() < (h.below || 0.45) && util.canCast("hardshell") &&
                around(200, true).some(function (m) { return (G.monsters[m.mtype] || {}).damage_type === "physical"; })) {
                use_skill("hardshell").catch(function () {});
                util.log("warrior", "Hard Shell", "yellow");
            }
            return false; // potions as usual
        },

        support: function () {
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
            const far = target ? util.distanceTo(target) > (c.chargeFrom || 150) : true;
            if (far) tryCharge();
            return target ? tryDash(target) : false;
        },
    };
};
