// =====================================================================
// roles/merchant/fishing.js - fishing (and the walk home to the stand).
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const m = config.merchantRole;
    const st = m.stand || {};

    function fishingDue() {
        const f = (m.gather || {}).fishing;
        if (!f || !f.enabled || Date.now() < mer.nextFishAt || character.esize < 2) return false;
        if (is_on_cooldown("fishing")) return false;
        const rod = function (i) { return i && i.name === "rod"; };
        return util.findItemIndex(rod) !== -1 || rod(character.slots && character.slots.mainhand);
    }
    // The server's check (skill "fishing"/"mining"): one of the four points 24 px up, down,
    // left or right of us lies inside a zone of that type on our map. A few pixels off the
    // configured spot and there is no water in reach (2026-11-17), so we step onto a point
    // that passes the same check before casting.
    function insidePolygon(x, y, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
    function zoneInReach(type, x, y) {
        return ((G.maps[character.map] || {}).zones || []).some(function (z) {
            return z.type === type && [[0, -24], [-24, 0], [24, 0], [0, 24]].some(function (o) {
                return insidePolygon(x + o[0], y + o[1], z.polygon);
            });
        });
    }
    async function stepIntoReach(type, around) {
        if (zoneInReach(type, character.x, character.y)) return true;
        const spots = [];
        for (let r = 0; r <= 48; r += 8) {
            for (let dx = -r; dx <= r; dx += 8) {
                for (let dy = -r; dy <= r; dy += 8) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring by ring, nearest first
                    const x = around.x + dx, y = around.y + dy;
                    if (zoneInReach(type, x, y)) spots.push({ x: x, y: y });
                }
            }
        }
        for (const p of spots.slice(0, 6)) {
            if (typeof can_move_to === "function" && !can_move_to(p.x, p.y)) continue;
            try { await move(p.x, p.y); } catch (e) { continue; }
            if (zoneInReach(type, character.x, character.y)) return true;
        }
        return zoneInReach(type, character.x, character.y);
    }
    async function fish() {
        const f = m.gather.fishing;
        util.status("fishing", "yellow");
        await util.walk(f.spot);
        if (!(await stepIntoReach("fishing", f.spot))) {
            util.log("merchant", "can't fish near " + f.spot.x + "," + f.spot.y + " - no water in reach (standing at " +
                Math.round(character.x) + "," + Math.round(character.y) + ")", "orange");
            mer.nextFishAt = Date.now() + 60 * 60 * 1000;
            try { set(mer.FISH_KEY, mer.nextFishAt); } catch (e) { /* storage unavailable */ }
            return;
        }
        const m0 = character.slots && character.slots.mainhand;
        if (!m0 || m0.name !== "rod") {
            const idx = util.findItemIndex(function (i) { return i.name === "rod"; });
            if (idx === -1) return;
            await equip(idx);
            await sleep(500);
        }
        const freeBefore = character.esize;
        let caught = false;
        let noWater = 0;
        for (let cast = 0; cast < (f.maxCasts || 40) && !caught; cast++) {
            if (character.mp < 150) { await use_skill("use_mp").catch(function () {}); await sleep(2100); }
            await use_skill("fishing").catch(function () {});
            await sleep(800);
            if (!(character.c && character.c.fishing)) {
                // No channel: not next to water (or a hiccup) - give up after a few tries.
                if (++noWater >= 3) {
                    util.log("merchant", "can't fish at " + Math.round(character.x) + "," + Math.round(character.y) + " - the cast did not start", "orange");
                    mer.nextFishAt = Date.now() + 60 * 60 * 1000;
                    break;
                }
                continue;
            }
            for (let t = 0; t < 40 && character.c && character.c.fishing; t++) await sleep(500);
            await sleep(500);
            caught = is_on_cooldown("fishing") || character.esize < freeBefore;
        }
        // The rod costs the merchant 20 speed (class data): back into the bag after fishing.
        if (character.slots && character.slots.mainhand && character.slots.mainhand.name === "rod" && character.esize > 0) {
            await unequip("mainhand").catch(function () {});
        }
        if (caught) {
            mer.nextFishAt = Date.now() + ((G.skills.fishing && G.skills.fishing.reuse_cooldown) || 48 * 60 * 1000) + 30 * 1000;
            util.log("merchant", "caught something - next fishing in 48 min", "green");
        } else if (Date.now() >= mer.nextFishAt) {
            mer.nextFishAt = Date.now() + 10 * 60 * 1000; // no luck this time: try again a bit later
        }
        try { set(mer.FISH_KEY, mer.nextFishAt); } catch (e) { /* storage unavailable */ }
    }

    function homeSpot() {
        return mer.useStand() ? { map: "main", x: st.home.x, y: st.home.y } : null;
    }
    function atHome() {
        const spot = homeSpot();
        if (spot) return character.map === "main" && util.distanceTo(spot) < 15;
        const shop = (G.maps.main.npcs || []).find(function (n) { return n.id === "fancypots"; });
        return character.map === "main" && shop && util.distanceTo({ x: shop.position[0], y: shop.position[1] }) < 200;
    }

    async function goHome() {
        if (!atHome()) {
            util.status("going to town", "yellow");
            const spot = homeSpot();
            if (spot) await util.walk(spot);
            else await util.walk({ to: "potions" });
        }
        mer.keepStand();
    }

    Object.assign(mer, {
        fishingDue: fishingDue,
        insidePolygon: insidePolygon,
        zoneInReach: zoneInReach,
        stepIntoReach: stepIntoReach,
        fish: fish,
        homeSpot: homeSpot,
        atHome: atHome,
        goHome: goHome,
    });
};
