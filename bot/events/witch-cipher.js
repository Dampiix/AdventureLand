// =====================================================================
// events/witch-cipher.js - the Witch's Cipher: its gathering window and the ingredient spots the leader farms then.
// Part of bot_events (module plan, stage 4c): moved verbatim from the old single-file core/events.js. The parts
// share one internal state (evs: the current event, searches, runners, sightings) and call each other through evs;
// outside dependencies come in deps (game, util, config, comms, party, cave, bus, teamStats).
// =====================================================================

module.exports = function install(evs, deps) {
    const config = deps.config;
    const util = deps.util;
    const cfg = config.events;
    const wcfg = cfg.witchCipher || {};

    function cipherWindow() {
        if (!wcfg.farm) return null;
        const st = (typeof server !== "undefined" && server.status) || {};
        const now = Date.now();
        const gatherMs = ((G.events.witchcipher || {}).gathering || 1200) * 1000;
        const live = st.witchcipher;
        if (live && live.live && live.phase === "gathering" && now < (live.gather_end || 0)) return { at: live.start, until: live.gather_end };
        const ev = ((st.schedule || {}).events || []).find(function (e) {
            return e && e.event === "witchcipher" && typeof e.at === "number" && now >= e.at - (wcfg.leadMs || 10 * 60 * 1000) && now < e.at + gatherMs;
        });
        return ev ? { at: ev.at, until: ev.at + gatherMs } : null;
    }
    // The ingredient to farm now: { ingredient, list, until, at } while the gathering window is open, else null.
    function cipherFarm() {
        const win = cipherWindow();
        if (!win) { evs.cipherLogged = null; return null; }
        let ing = null;
        try {
            const s = get("bot_cipher_stock");
            // The live round's start carries milliseconds (…200568), the schedule's does not (…200000): same round
            // within 5 min (v1.223.4 - after the Snowman the leader fell back to embercoal, "no report").
            if (s && s.choice && Math.abs(s.choice.at - win.at) < 5 * 60 * 1000 && Date.now() - (s.at || 0) < 15 * 60 * 1000) ing = s.choice.ingredient;
        } catch (e) { /* storage unavailable */ }
        const ingredient = ing || wcfg.fallback || "embercoal";
        const list = ((wcfg.spots || {})[ingredient] || []).slice();
        if (evs.cipherLogged !== win.at + ":" + ingredient) {
            evs.cipherLogged = win.at + ":" + ingredient;
            util.log("event", "Witch's Cipher gathering until " + new Date(win.until).toISOString().slice(11, 16) + "Z: farming " + ingredient +
                (ing ? " (the scarcest, merchant)" : " (no report from the merchant)") + " - spots " + list.join(", ") + "; no bosses or Daisy meanwhile", "yellow");
        }
        return { ingredient: ingredient, list: list, until: win.until, at: win.at };
    }
    function cipherActive() { return !!cipherWindow(); }

    Object.assign(evs, {
        cipherWindow: cipherWindow,
        cipherFarm: cipherFarm,
        cipherActive: cipherActive,
    });
};
