// =====================================================================
// lib/storage.js - Shared storage: the decision journal, the heartbeat, the team's server.
// Split out of lib/util.js (module plan, pilot step 2); util.js re-exports it unchanged.
// =====================================================================

// Decision journal (player request 2026-11-21): why and when the team changes its spot. The
// game log keeps ~200 lines without times; this keeps the last 400 decisions with a timestamp
// per character in the storage ("bot_journal:<name>": [[ms, text], ...]).
// "dps" (2026-11-21): the damage meter's 5-minute lines (team damage/s, kills) for the measurement hours.
const JOURNAL_TAGS = ["target", "drops", "hunt", "event", "party", "cavalry", "dps", "kills", "scout", "rage"]; // rage: v1.238.0
let journalBuf = null;
function journal(text) {
    try {
        const key = "bot_journal:" + character.name;
        if (!journalBuf) journalBuf = get(key) || [];
        journalBuf.push([Date.now(), text]);
        if (journalBuf.length > 400) journalBuf.splice(0, journalBuf.length - 400);
        set(key, journalBuf);
    } catch (e) { /* storage unavailable */ }
}

// Heartbeat for the member watchdog (main.js, player decision 2026-11-20): every 10 s after a
// loop step went through, "bot_beat:<name>" = { at, server } in the storage all our windows
// share. A loop that stops or throws every step stops the beat.
let lastBeatAt = 0;
// role: "leader" | "member" | "solo" | "merchant" (v1.238.3, main.js setBeatRole) - the merchant's team XP value counts only
// the leader's party as it plays now.
let beatRole = null;
function setBeatRole(role) { beatRole = role; lastBeatAt = 0; }
function heartbeat() {
    const now = Date.now();
    if (now - lastBeatAt < 10000) return;
    lastBeatAt = now;
    try {
        const server = typeof parent !== "undefined" && parent.server_region ? parent.server_region + " " + parent.server_identifier : null;
        // hp: for the priest's Party Heal on members out of its sight (2026-11-21).
        set("bot_beat:" + character.name, { at: now, server: server, hp: character.max_hp ? Math.round(character.hp / character.max_hp * 100) / 100 : 1, rip: !!character.rip, role: beatRole });
    } catch (e) { /* storage unavailable */ }
}

// The team's home server, e.g. "EU IV" (player request 2026-11-21: not hard-coded - the team was
// moved to another server by hand and the merchant would have hopped straight back to EU III):
// where the leader runs, from its last heartbeat (any age - a leader restart must not send the
// merchant to the configured server), else merchantRole.pontyRound.home.
function teamServer(config) {
    try {
        const b = get("bot_beat:" + config.leader);
        if (b && b.server) return b.server;
    } catch (e) { /* storage unavailable */ }
    const pr = (config.merchantRole && config.merchantRole.pontyRound) || {};
    return (pr.home || ["EU", "III"]).join(" ");
}

module.exports = {
    JOURNAL_TAGS: JOURNAL_TAGS,
    journal: journal,
    heartbeat: heartbeat,
    setBeatRole: setBeatRole,
    teamServer: teamServer,
};
