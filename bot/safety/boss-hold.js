// =====================================================================
// safety/boss-hold.js - holding an aggressive boss until the team is there: boss list, its box and hold ring, who is there.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const boxDist = tgt.spots.boxDist;

    // No first hit on a roaming boss (events.search / engage) before the whole team is there (player
    // decision 2026-11-21): with the parallel search one fighter may find it alone - a later rogue would
    // not survive the Phoenix on its own. A boss already fighting (anyone, e.g. another player) is fair game.
    function bossList() {
        const ev = config.events || {};
        return (ev.search || []).concat(ev.engage || []);
    }
    // Hold ring of an aggressive boss (2026-11-22): the ranger waited for the team inside Jr.'s spawn box
    // (Jr.: aggro 1, rage 1, roams the box at 40, charges at 90) - Jr. walked into him and the fight began
    // without the team. A boss with aggro or rage >= 0.3 is waited for outside its spawn box on our map, by
    // its range + its charge (or speed) + 50 px. { box, margin } or null (passive boss, or no box near it).
    function bossBox(t) {
        const map = G.maps[character.map] || {};
        let best = null, bd = Infinity;
        (map.monsters || []).forEach(function (pk) {
            if (pk.type !== t.mtype) return;
            const boxes = util.spawnBoxes(pk, character.map);
            boxes.forEach(function (b) { const d = boxDist(util.xy(t), b); if (d < bd) { bd = d; best = b; } });
        });
        return best && bd < 300 ? best : null;
    }
    function bossHoldRing(t) {
        const def = t && G.monsters[t.mtype];
        if (!def || !((def.aggro || 0) >= 0.3 || (def.rage || 0) >= 0.3)) return null;
        const box = bossBox(t);
        if (!box) return null;
        return { box: box, margin: (t.range || def.range || 30) + Math.max(def.charge || 0, def.speed || 0) + 50 };
    }
    function teamAt(t) {
        const fighters = (config.team && config.team.fighters) || [];
        const p = util.xy(t);
        const r = (config.events && config.events.holdRange) || 350;
        const ring = bossHoldRing(t);
        return fighters.every(function (n) {
            if (n !== character.name && !party.inParty(n)) return true; // not with us (offline)
            const f = n === character.name ? character : get_player(n);
            // A dead member is not waited for (2026-11-21: the warrior died at the level-8 Phoenix).
            if (f && f.rip) return true;
            if (!f) return n === character.name;
            const q = util.xy(f);
            // On the hold ring of an aggressive boss counts as "here" too (it may be farther than holdRange).
            return Math.hypot(q.x - p.x, q.y - p.y) <= r || (!!ring && f.map === character.map && boxDist(q, ring.box) <= ring.margin + 120);
        });
    }
    // holdForTeam for every boss, or only for events.holdFor (Dracul: a runner finds him alone, 2026-11-21).
    function holdsFor(mtype) {
        const ev = config.events || {};
        return ev.holdForTeam !== false || (ev.holdFor || []).includes(mtype);
    }
    // Too strong for us alone at its real level (events.soloOk, player decision 2026-11-21): held
    // like an events.holdFor boss until the team is there - not when it is on one of us already.
    function tooStrongAlone(t) {
        if (!t || !party.enabled || !bossList().includes(t.mtype) || !deps.events || !deps.events.soloOk) return false;
        if (t.target && tgt.isOurs(t.target)) return false;
        return !deps.events.soloOk(t);
    }
    function holdBoss(t) {
        if (!t || !party.enabled) return false;
        const strong = tooStrongAlone(t);
        if (!strong && (!holdsFor(t.mtype) || t.target || !bossList().includes(t.mtype))) return false;
        if (teamAt(t)) return false;
        if (Date.now() - tgt.holdLogged > 60 * 1000) { tgt.holdLogged = Date.now(); util.log("target", t.mtype + (strong ? " too strong for me alone" : " not engaged yet") + " - holding until the team is here", "white"); }
        util.status("holding at " + t.mtype, "yellow");
        return true;
    }
    // A held boss within range px (warrior: no Agitate that would pull it).
    function heldBossNear(range) {
        return Object.values(parent.entities || {}).some(function (e) {
            return e && e.type === "monster" && !e.dead && util.distanceTo(e) <= range && holdBossQuiet(e);
        });
    }
    function holdBossQuiet(t) {
        return !!t && party.enabled && !teamAt(t) && (tooStrongAlone(t) || (holdsFor(t.mtype) && !t.target && bossList().includes(t.mtype)));
    }

    Object.assign(tgt, {
        bossList: bossList,
        bossBox: bossBox,
        bossHoldRing: bossHoldRing,
        teamAt: teamAt,
        holdsFor: holdsFor,
        tooStrongAlone: tooStrongAlone,
        holdBoss: holdBoss,
        heldBossNear: heldBossNear,
        holdBossQuiet: holdBossQuiet,
    });
};
