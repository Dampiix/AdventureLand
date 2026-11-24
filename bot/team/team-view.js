// =====================================================================
// bot_team_view (team/team-view.js) - the team view (docs/architecture/team-view.md): our characters see each other
// directly instead of through messages. Every bot publishes one entry in the client's team registry (lib/game.js
// teamRegistry: the game page in the browser, the process headless); the others read it.
//   publish(entry)  our entry: { name, ctype, role, version, game(): our live game object, bot: { getters },
//                   actions: { functions others may call } } - replaces an older entry of ours (a reload)
//   member(name)    a teammate's entry, or null when it is not in this client, its frame stopped (no beat for
//                   STALE_MS) or it runs on another game server (the merchant's Ponty round reopens it elsewhere in
//                   our client; messages never reached another server either) - the caller then falls back to messages
//   members()       every live entry, ours included, whatever server (for /team; entry.server says which)
// Rules: entries are read, never written by others; only listed actions are called; positions are real_x / real_y
// (x / y are the little character frames' display values).
// Readers: party (step 1, the leader report), mage magiport (positions), comms (step 2, direct delivery via
// actions.deliver), team-stats (step 2, bot.stats()).
// deps: { game } (optional - the bundled lib/game.js otherwise)
// =====================================================================

const GAME = require("../lib/game.js");

module.exports = function createTeamView(deps) {
    const game = (deps && deps.game) || GAME;
    const STALE_MS = 10 * 1000;
    let own = null;

    function registry() {
        try { return game.teamRegistry(); } catch (e) { return null; } // another origin: no shared page
    }
    function publish(entry) {
        const reg = registry();
        if (!reg) return false;
        if (!entry.server) { try { entry.server = game.serverName(); } catch (x) { /* no page */ } }
        entry.at = Date.now();
        entry.beat = Date.now();
        reg[entry.name] = entry;
        own = entry;
        return true;
    }
    // Our beat: a stopped or reloaded frame stops beating, so its old entry counts as gone.
    setInterval(function () { if (own) own.beat = Date.now(); }, 2000);

    function fresh(e) {
        try { return !!e && Date.now() - e.beat <= STALE_MS; } catch (x) { return false; } // a freed frame may throw
    }
    function member(name) {
        const reg = registry();
        const e = reg && reg[name];
        if (!fresh(e)) return null;
        let here = null;
        try { here = game.serverName(); } catch (x) { /* no page */ }
        return e.server === here ? e : null;
    }
    function members() {
        const reg = registry();
        if (!reg) return [];
        return Object.keys(reg).map(function (n) { return reg[n]; }).filter(fresh);
    }

    return { publish: publish, member: member, members: members, own: function () { return own; } };
};
