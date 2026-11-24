// =====================================================================
// safety/rage-zones.js - rage zones (map data rage boxes): which zone we can take, walls for the path search, the zone we stand in.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;
    const rcfg = cfg.rage || {};
    const boxDist = tgt.spots.boxDist;

    function rageZones(mapName) {
        if (!tgt.zonesByMap[mapName]) {
            const map = G.maps[mapName] || {};
            // travel.wallMonsters (2026-11-22): packs without a rage box that attack on sight count as zones too, with their
            // spawn box - the Vampire Rats in level1 (aggro 1, 9,200 HP, level 20): the ranger walked through them on the way
            // out of Spooky Town and died. Every path walk plans around them (rage walls); farming them stays possible.
            const walls = ((config.travel || {}).wallMonsters) || [];
            tgt.zonesByMap[mapName] = [];
            (map.monsters || []).forEach(function (p) {
                if (!G.monsters[p.type]) return;
                if (p.rage) { tgt.zonesByMap[mapName].push({ type: p.type, b: p.rage, count: p.count || 1, key: mapName + ":" + p.rage.join(",") }); return; }
                if (!walls.includes(p.type)) return;
                (p.boundary ? [p.boundary] : (p.boundaries || []).filter(function (x) { return !x[4] || x[4] === mapName; }).map(function (x) { return x.length > 4 ? x.slice(0, 4) : x; }))
                    .forEach(function (bx) { if (bx && bx.length >= 4) tgt.zonesByMap[mapName].push({ type: p.type, b: bx.slice(0, 4), count: p.count || 1, key: mapName + ":" + bx.slice(0, 4).join(",") }); });
            });
        }
        return tgt.zonesByMap[mapName];
    }
    function zoneAt(p, mapName) {
        return rageZones(mapName || character.map).find(function (z) { return boxDist(p, z.b) === 0; }) || null;
    }
    function zoneVerdict(z) {
        const c = tgt.zoneCache[z.key];
        if (c && Date.now() - c.at < 10 * 1000) return c;
        const def = G.monsters[z.type];
        const near = [z.b[0] - 200, z.b[1] - 200, z.b[2] + 200, z.b[3] + 200];
        const seen = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && e.mtype === z.type && !e.dead && boxDist(util.xy(e), near) === 0;
        });
        const n = Math.max(seen.length, z.count);
        const strongest = seen.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0] ||
            { mtype: z.type, attack: def.attack, max_hp: def.hp, hp: def.hp, frequency: def.frequency, level: 1 };
        // Members judge with the team model themselves (every fighter has the team's stats since v1.207.0) - trusting
        // "the leader decides" let warrior and ranger walk into the level-17 booboos before the leader looked (2026-11-22).
        // Ahead of the leader (not near): solo pack check.
        const lead = party.enabled && party.isMember && !party.detached() ? party.leaderInfo() : null;
        // Or the leader stands at this zone (2026-11-22): the ranger coming back to the accepted 4-booboo zone was more
        // than 300 px from the leader in its middle, judged it alone ("I survive 2.4 hits") and stepped out again.
        const leaderNear = !!lead && lead.map === character.map && (Math.hypot(lead.x - character.x, lead.y - character.y) <= ((config.party && config.party.leash) || 300) ||
            boxDist({ x: lead.x, y: lead.y }, z.b) <= 150);
        let v = tgt.teamModelOn() || leaderNear ? tgt.teamVerdict(z.type, strongest, { pull: n }) : tgt.packVerdict(strongest, n);
        if (!v.ok && /waiting for the team/.test(v.why || "")) v = { ok: false, why: "team stats not in yet" };
        const r = { at: Date.now(), ok: !!v.ok, why: n + " at once (level " + (strongest.level || 1) + "+)" + (v.ok ? "" : ": " + v.why) };
        tgt.zoneCache[z.key] = r;
        return r;
    }
    // Every rage box on a map (for the rage walls): { type, b, key }.
    function rageBoxes(mapName) {
        return rcfg.enabled === false ? [] : rageZones(mapName).map(function (z) { return { type: z.type, b: z.b, key: z.key }; });
    }
    // The failing rage zone within `margin` px of point p (outside or inside) on our map, or null - nobody should stand
    // there: a booboo at the edge reaches ~64 px by contact aggro (2026-11-22: the warrior stood 13 px off the big
    // booboo zone after a "Path not found!" and was taken). { type, b, gap }
    function failingZoneNear(p, margin) {
        if (rcfg.enabled === false) return null;
        let best = null;
        rageZones(character.map).forEach(function (z) {
            const gap = boxDist(p, z.b);
            if (gap >= margin || zoneVerdict(z).ok) return;
            if (!best || gap < best.gap) best = { type: z.type, b: z.b, gap: gap };
        });
        return best;
    }
    // The failing rage zone at point p on our map, or null.
    function failingZoneAt(p) {
        if (rcfg.enabled === false) return null;
        const z = zoneAt(p);
        return z && !zoneVerdict(z).ok ? z : null;
    }
    // The failing rage zone we stand in, or null. { type, b, why }
    function rageZoneHere() {
        if (rcfg.enabled === false) return null;
        const z = zoneAt(util.xy(character));
        if (!z) return null;
        const v = zoneVerdict(z);
        return v.ok ? null : { type: z.type, b: z.b, why: v.why };
    }
    function rageBlocks(e) {
        if (rcfg.enabled === false) return null;
        const me = util.xy(character), stand = tgt.standPoint(e), at = util.xy(e);
        const zones = rageZones(character.map);
        if (!zones.length) return null;
        const hit = zones.find(function (z) {
            if (zoneVerdict(z).ok) return false;
            if (boxDist(at, z.b) === 0 || boxDist(stand, z.b) === 0) return true;
            const steps = Math.ceil(Math.hypot(stand.x - me.x, stand.y - me.y) / 25);
            for (let i = 1; i < steps; i++) {
                if (boxDist({ x: me.x + (stand.x - me.x) * i / steps, y: me.y + (stand.y - me.y) * i / steps }, z.b) === 0) return true;
            }
            return false;
        });
        if (!hit) return null;
        if (Date.now() - (tgt.rageLogged[hit.key] || 0) > 2 * 60 * 1000) {
            tgt.rageLogged[hit.key] = Date.now();
            util.log("target", "not going into the " + hit.type + " rage zone: " + zoneVerdict(hit).why, "orange");
        }
        return hit;
    }

    Object.assign(tgt, {
        rageZones: rageZones,
        zoneAt: zoneAt,
        zoneVerdict: zoneVerdict,
        rageBoxes: rageBoxes,
        failingZoneNear: failingZoneNear,
        failingZoneAt: failingZoneAt,
        rageZoneHere: rageZoneHere,
        rageBlocks: rageBlocks,
    });
};
