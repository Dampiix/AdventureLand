// =====================================================================
// roles/merchant/ponty-round.js - the Ponty round over other servers.
// Part of bot_merchant (module plan, stage 6b): moved verbatim from the old single-file roles/merchant.js. The parts
// share one internal state (mer: pickup requests, busy, trips, the stand, timers) and call each other through mer;
// outside dependencies come in deps (config, util, comms, workshop, scout).
// =====================================================================

module.exports = function install(mer, deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const m = config.merchantRole;
    const workshop = deps.workshop;
    const st = m.stand || {};
    const prc = m.pontyRound || {};

    function hereName() { return parent.server_region + " " + parent.server_identifier; }
    function homeName() { return util.teamServer(config); } // where the leader runs (2026-11-21)
    function readRound() { try { return get(mer.ROUND_KEY) || null; } catch (e) { return null; } }
    function saveRound(st) { try { if (st) set(mer.ROUND_KEY, st); else set(mer.ROUND_KEY, null); } catch (e) { /* storage unavailable */ } }
    function requestHop(to) {
        const req = { id: Date.now() + ":" + to, to: to, at: Date.now() };
        try { set(mer.HOP_KEY, req); } catch (e) { /* storage unavailable */ }
        util.log("merchant", "Ponty round: hop to " + to + " requested", "yellow");
    }
    // Which round slot is due: testAt once, else every everyHours at full local hours.
    function dueSlot() {
        let last = null;
        try { last = get(mer.LAST_KEY); } catch (e) { /* storage unavailable */ }
        const now = new Date();
        // /ponty chat command (2026-11-21): a requested round right away (requests older than 10 min drop).
        let force = 0;
        try { force = get("bot_ponty_force") || 0; } catch (e) { /* storage unavailable */ }
        if (force) {
            try { set("bot_ponty_force", 0); } catch (e) { /* storage unavailable */ }
            // In the first half hour it counts as this hour's round (no second round right after it).
            if (Date.now() - force < 10 * 60 * 1000) return now.getMinutes() < 30 ? now.toDateString() + " " + now.getHours() : "manual:" + force;
        }
        const testAt = prc.testAt ? Date.parse(prc.testAt) : NaN;
        if (isFinite(testAt) && now >= testAt && last !== "test:" + prc.testAt) return "test:" + prc.testAt;
        const every = prc.everyHours || 0; // 0: only testAt
        if (!every || now.getHours() % every !== 0 || now.getMinutes() >= 30) return null;
        const slot = now.toDateString() + " " + now.getHours();
        return last === slot ? null : slot;
    }
    function leaderOnline() {
        let b = null;
        try { b = get("bot_beat:" + config.leader); } catch (e) { /* storage unavailable */ }
        const ok = !!(b && b.at && Date.now() - b.at < (prc.leaderFreshMs || 2 * 60 * 1000));
        if (!ok && Date.now() - mer.leaderMissLogAt > 30 * 60 * 1000) {
            mer.leaderMissLogAt = Date.now();
            util.log("merchant", "Ponty round waits: the leader " + config.leader + " is offline (it makes the hops)", "yellow");
        }
        return ok;
    }
    // True while the round holds the merchant (normal work skipped).
    async function pontyRound() {
        if (!prc.enabled) return false;
        const here = hereName(), home = homeName();
        let st = readRound();
        if (!st) {
            if (mer.readTrip()) return false; // a sell trip holds the merchant (tradeTrip)
            if (here !== home) { // away without a round or sell trip (e.g. a restart mid-round): go home
                const req = (function () { try { return get(mer.HOP_KEY); } catch (e) { return null; } })();
                if (!req || req.to !== home || Date.now() - req.at > 3 * 60 * 1000) requestHop(home);
                return true;
            }
            if (!leaderOnline()) return false; // before dueSlot: the slot stays due for the leader's return (first half hour)
            const slot = dueSlot();
            if (!slot) return false;
            const servers = (prc.servers || []).map(function (s) { return s.join(" "); }).filter(function (s) { return s !== home; });
            if (!servers.length) return false;
            try { set(mer.LAST_KEY, slot); } catch (e) { /* storage unavailable */ }
            st = { phase: "prep", queue: servers, target: null, startedAt: Date.now(), at: Date.now(), visits: [] };
            saveRound(st);
            util.log("merchant", "Ponty round starts (" + servers.join(", ") + ") - calling the fighters first", "yellow");
            ((config.team && config.team.fighters) || []).forEach(function (f) { comms.send(f, "callpickup", {}); });
            return false; // prep: normal work serves the pickups
        }
        st.beat = Date.now();
        if (st.phase === "prep") {
            const settled = Date.now() - st.at > (prc.prepSettleMs || 20 * 1000) && mer.requests.size === 0;
            if (!settled && Date.now() - st.at < (prc.prepMaxMs || 8 * 60 * 1000)) { saveRound(st); return false; }
            // Still at home: the leader went offline during the prep - drop the round instead of a hop nobody makes.
            if (!leaderOnline()) { util.log("merchant", "Ponty round dropped: the leader is offline", "yellow"); saveRound(null); return false; }
            await mer.goHome();
            await mer.sellJunk();
            // Store only (2026-11-22 review): a full bank trip ends by taking junk and stand items out of the bank -
            // they would ride along unsold through the whole round and take the bag slots the Ponty buys need.
            await mer.bankTrip(true);
            st.phase = "travel";
            st.target = st.queue.shift();
            st.at = Date.now();
            saveRound(st);
            requestHop(st.target);
            return true;
        }
        if (st.phase === "travel") {
            if (here === st.target) {
                if (character.stand) {
                    try { const p = typeof close_stand === "function" ? close_stand() : parent.close_merchant(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* closed by walking */ }
                }
                util.status("Ponty on " + here, "yellow");
                // Bag full mid-round (player decision 2026-11-21): bank on this server (the bank is the
                // account's) before the visit when it runs tight, and after a visit the bag cut short -
                // then Ponty again, up to pontyRound.bankRetries times.
                if (character.esize < (m.bank.whenFreeBelow || 6)) await mer.bankTrip(true);
                let seen = null;
                try { seen = await workshop.pontyVisit(); } catch (e) { util.log("merchant", "Ponty on " + here + ": " + util.errReason(e), "orange"); }
                for (let n = 0; seen && seen.full && n < (prc.bankRetries || 2); n++) {
                    util.log("merchant", "Ponty on " + here + ": bag full after " + seen.bought + " - banking and back", "yellow");
                    if (!(await mer.bankTrip(true))) break; // nothing fit in the bank
                    let again = null;
                    try { again = await workshop.pontyVisit(); } catch (e) { util.log("merchant", "Ponty on " + here + ": " + util.errReason(e), "orange"); }
                    if (!again) break;
                    seen = { items: again.items, bought: seen.bought + again.bought, full: again.full };
                }
                st.visits.push({ server: here, at: Date.now(), items: seen ? seen.items : null, bought: seen ? seen.bought : 0 });
                util.log("merchant", "Ponty on " + here + ": " + (seen ? seen.items + " items, bought " + seen.bought : "no visit"), "white");
                st.target = st.queue.length ? st.queue.shift() : home;
                if (st.target === home) st.phase = "home";
                st.at = Date.now();
                saveRound(st);
                requestHop(st.target);
                return true;
            }
            // Still waiting for the hop: ask again when nothing happened for a while.
            if (Date.now() - st.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { st.at = Date.now(); requestHop(st.target); }
            saveRound(st);
            return true;
        }
        if (st.phase === "home") {
            if (here === home) {
                const bought = st.visits.reduce(function (s, v) { return s + (v.bought || 0); }, 0);
                util.log("merchant", "Ponty round done in " + Math.round((Date.now() - st.startedAt) / 60000) + " min: " +
                    st.visits.map(function (v) { return v.server + " " + (v.items === null ? "-" : v.items) + "/" + v.bought; }).join(", ") + " (items/bought), " + bought + " bought", "green");
                try { const log = get("bot_ponty_round_log") || []; set("bot_ponty_round_log", log.concat([{ at: Date.now(), visits: st.visits }]).slice(-50)); } catch (e) { /* storage unavailable */ }
                saveRound(null);
                return false;
            }
            if (Date.now() - st.at > (prc.hopTimeoutMs || 2 * 60 * 1000)) { st.at = Date.now(); requestHop(home); }
            saveRound(st);
            return true;
        }
        saveRound(null); // unknown phase: drop it
        return false;
    }

    Object.assign(mer, {
        hereName: hereName,
        homeName: homeName,
        readRound: readRound,
        saveRound: saveRound,
        requestHop: requestHop,
        dueSlot: dueSlot,
        leaderOnline: leaderOnline,
        pontyRound: pontyRound,
    });
};
