// =====================================================================
// bot_cave - Cave of Many Dreams, manual mode (v1.231.0, player decision 2026-11-24).
//
// The player walks the leader outside fights; the bot fights only what the player starts (a target set on the
// leader by hand) or what attacks the party - never a monster on its own (travelers, allies, the rogue and the Dark
// Mage are monsters too, and the next pack or the floor keeper must not be pulled early). Members follow the
// leader as usual and fight with it. Every member votes what its leader voted (a CODE message from the leader's
// own cave_request wrapper, or the leader's vote in the cave state when the server sends one) - never on its own.
// A recorder keeps cave states, requests and the cave's entities in the storage for the later automation.
//
// active(): in the cave (character.cave set) and config.cave.mode "manual". Entering stays the player's job: the
// bot never calls cave_enter().
// =====================================================================

module.exports = function createCave(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const comms = ctx.comms;
    const cfg = config.cave || {};
    const me = character.name;
    const isLeader = me === config.leader;
    const REC_KEY = "dmpx_cave_rec:" + me;
    const PAGE = parent;

    function inCave() { return !!character.cave; }
    function caveManual() { return inCave() && cfg.mode === "manual"; }
    // /manual (v1.231.1, player decision 2026-11-24): the same manual rules outside the cave - the player walks the
    // leader (e.g. to Dorr) without stopping its code, so the leader's position still goes out and the members follow
    // across maps. Kept in the storage across code loads until /manual again. Members take it from the leader's
    // broadcast (party "lead" message, field manual).
    const MANUAL_KEY = "dmpx_manual:" + me;
    let manual = false;
    try { manual = !!get(MANUAL_KEY); } catch (e) { /* storage unavailable */ }
    function setManual(on) {
        manual = !!on;
        try { set(MANUAL_KEY, manual ? Date.now() : null); } catch (e) { /* storage unavailable */ }
        util.log("cave", manual ? "manual mode ON - you walk " + me + "; the bot fights only what you start or what attacks the party (/manual to end)"
            : "manual mode OFF - back to the bot's own plans", "yellow");
    }
    function leaderManual() {
        if (isLeader || !ctx.party || !ctx.party.leaderInfo) return false;
        const l = ctx.party.leaderInfo();
        return !!(l && l.manual);
    }
    function manualOn() { return manual || leaderManual(); }
    function active() { return caveManual() || manualOn(); }
    if (manual) util.log("cave", "manual mode still ON (/manual to end)", "yellow");
    function paused() { return !!(character.cave && character.cave.paused) || !!(lastState && lastState.paused); }

    // ---- recorder -----------------------------------------------------------------------------------------------
    let rec = null;
    function recBuf() {
        if (!rec) { try { rec = get(REC_KEY) || []; } catch (e) { rec = []; } }
        return rec;
    }
    let recSavedAt = 0, recDirty = false;
    function record(kind, data) {
        if (cfg.record === false) return;
        const buf = recBuf();
        let s;
        try { s = JSON.stringify(data); } catch (e) { s = String(data); }
        const max = cfg.recordMaxChars || 3000;
        buf.push([Date.now(), kind, s.length > max ? s.slice(0, max) + "...(" + s.length + ")" : s]);
        const cap = isLeader ? (cfg.recordCapLeader || 300) : (cfg.recordCapMember || 120);
        if (buf.length > cap) buf.splice(0, buf.length - cap);
        recDirty = true;
        if (Date.now() - recSavedAt > 3000) saveRec();
    }
    function saveRec() {
        if (!recDirty) return;
        recSavedAt = Date.now();
        recDirty = false;
        try { set(REC_KEY, recBuf()); } catch (e) { /* storage full or unavailable */ }
    }

    // Cave state pushes (character.on("cave")): every distinct one, at most one per 2 s unless the choice changed.
    let lastState = null, lastStateJson = "", lastStateAt = 0, lastChoiceId = null;
    function onState(state) {
        lastState = state || null;
        const choiceId = state && state.choice ? state.choice.id + (state.choice.resolved ? ":done" : "") : null;
        let json = "";
        try { json = JSON.stringify(state); } catch (e) { return; }
        if (json === lastStateJson) return;
        if (choiceId === lastChoiceId && Date.now() - lastStateAt < 2000) return;
        lastStateJson = json;
        lastStateAt = Date.now();
        lastChoiceId = choiceId;
        record("state", state);
    }
    try { character.on("cave", onState); } catch (e) { util.log("cave", "no cave state events: " + util.errReason(e), "orange"); }

    // Entities on the cave map (every entsEveryMs, when the set of ids/targets changed): monsters with every flat
    // field (cave flags, ally/owner markers are unknown yet), cave NPCs, chests.
    let entsSig = "", entsAt = 0;
    function flat(e) {
        const o = {};
        Object.keys(e).forEach(function (k) {
            const v = e[k];
            if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
                if (!/^(real_|from_|going_|last_|move_num|engaged_move|walking|frame|width|height|lx|ly|mvx|mvy|angle|ref_speed|resync|u$)/.test(k)) o[k] = v;
            } else if (k === "cave" || k === "s") o[k] = v;
        });
        return o;
    }
    function recordEntities() {
        if (!inCave() || Date.now() - entsAt < (cfg.entsEveryMs || 10000)) return;
        entsAt = Date.now();
        const list = Object.values(PAGE.entities || {}).filter(function (e) {
            return e && !e.dead && (e.type === "monster" || e.cave || e.npc || (e.type === "character" && e.ctype === "npc"));
        });
        const sig = list.map(function (e) { return e.id + ">" + (e.target || ""); }).sort().join(",") + "|" + Object.keys(PAGE.chests || {}).length;
        if (sig === entsSig) return;
        entsSig = sig;
        record("ents", { map: character.map, x: Math.round(character.x), y: Math.round(character.y), list: list.map(flat).slice(0, 25),
            chests: Object.keys(PAGE.chests || {}).length });
    }

    // ---- cave_request wrapper: records every request; the leader's votes go to the members --------------------
    // Installed once per page (the original is kept on the page), the hook replaced by every code load.
    try {
        if (!PAGE.__dmpxCaveReqOrig && typeof PAGE.cave_request === "function") {
            PAGE.__dmpxCaveReqOrig = PAGE.cave_request;
            PAGE.cave_request = function (name, args) {
                try { if (PAGE.__dmpxCaveHook) PAGE.__dmpxCaveHook(name, args); } catch (e) { /* hook only */ }
                const p = PAGE.__dmpxCaveReqOrig.apply(this, arguments);
                try {
                    if (p && typeof p.then === "function" && PAGE.__dmpxCaveDone) {
                        p.then(function (r) { try { PAGE.__dmpxCaveDone(name, args, r, null); } catch (e) { /* hook only */ } },
                            function (er) { try { PAGE.__dmpxCaveDone(name, args, null, er); } catch (e) { /* hook only */ } });
                    }
                } catch (e) { /* hook only */ }
                return p;
            };
        }
    } catch (e) { util.log("cave", "could not wrap cave_request: " + util.errReason(e), "orange"); }
    PAGE.__dmpxCaveHook = function (name, args) {
        if (name === "info") return; // asked often by the client, nothing to learn
        record("req", { name: name, args: args || null });
        if (name === "vote" && isLeader && args && args.choice != null && args.option != null) {
            const others = ctx.party.memberNames().filter(function (n) { return n !== me; });
            if (others.length) comms.send(others, "cavevote", { choice: args.choice, option: args.option });
            util.log("cave", "voted " + args.option + " - members follow", "yellow");
        }
    };
    PAGE.__dmpxCaveDone = function (name, args, result, error) {
        if (name === "info") return;
        record("res", { name: name, ok: !error, result: result, error: error ? util.errReason(error) : null });
    };

    // ---- members vote what the leader voted ---------------------------------------------------------------------
    let leaderVote = null; // { choice, option, at }
    const voted = {};      // choice id -> { option, tries, at, done }
    comms.on("cavevote", function (data, from) {
        if (from !== config.leader || !data || data.choice == null || data.option == null) return;
        leaderVote = { choice: data.choice, option: data.option, at: Date.now() };
    });
    function currentChoice() {
        const c = (lastState && lastState.choice) || (character.cave && character.cave.choice) || null;
        return c && !c.resolved ? c : null;
    }
    // The leader's vote in the state itself, if the server sends votes per character (unknown yet).
    function leaderVoteInState(choice) {
        const v = choice.votes || choice.ballots || null;
        if (!v) return null;
        if (Array.isArray(v)) {
            const hit = v.find(function (x) { return x && (x.name === config.leader || x.voter === config.leader); });
            return hit ? (hit.option || hit.id || null) : null;
        }
        return typeof v[config.leader] === "string" ? v[config.leader] : (v[config.leader] && v[config.leader].option) || null;
    }
    function voteTick() {
        if (isLeader || !inCave() || character.rip && cfg.voteWhileDead === false) return;
        const choice = currentChoice();
        if (!choice) return;
        const want = leaderVoteInState(choice) || (leaderVote && leaderVote.choice === choice.id ? leaderVote.option : null);
        if (!want) return;
        const v = voted[choice.id] = voted[choice.id] || { option: null, tries: 0, at: 0, done: false };
        if (v.done && v.option === want) return;
        if (v.tries >= 3 || Date.now() - v.at < 3000) return;
        const opt = (choice.options || []).find(function (o) { return o && o.id === want; });
        if (choice.options && (!opt || opt.unavailable)) {
            if (!v.tries) util.log("cave", "leader voted " + want + " - not available to me (" + (opt ? opt.unavailable : "no such option") + ")", "orange");
            v.tries = 3;
            return;
        }
        v.tries++;
        v.at = Date.now();
        v.option = want;
        Promise.resolve(cave_reply(choice.id, want)).then(function () {
            v.done = true;
            util.log("cave", "voted " + want + " like " + config.leader, "yellow");
        }).catch(function (e) {
            util.log("cave", "vote " + want + " failed: " + util.errReason(e), "orange");
        });
    }

    // ---- chests: everyone opens cave chests within 400 px (cave gold and Amber go to the shared purse) ---------
    let lootAt = 0;
    function lootTick() {
        if (!caveManual() || character.rip || paused() || Date.now() - lootAt < 1000) return;
        lootAt = Date.now();
        Object.keys(PAGE.chests || {}).forEach(function (id) {
            const c = PAGE.chests[id];
            if (!c || (c.map && c.map !== character.map)) return;
            if (Math.hypot((c.x || 0) - character.real_x, (c.y || 0) - character.real_y) > 400) return;
            Promise.resolve(loot(id)).catch(function () {});
        });
    }

    // ---- the fight gate (fighter, targeting) ---------------------------------------------------------------------
    // A monster we may fight in the cave: never the Dark Mage (immune; only his reflected spell kills him).
    function mayFight(m) {
        if (!m || m.type !== "monster" || m.dead) return false;
        return !(cfg.neverFight || ["cave_darkmage"]).includes(m.mtype);
    }

    let wasIn = false;
    setInterval(function () {
        try {
            const now = inCave();
            if (now !== wasIn) {
                wasIn = now;
                util.log("cave", now ? "in the Cave of Many Dreams - manual mode" + (cfg.mode === "manual" ? "" : " OFF (cave.mode)") : "left the cave", now ? "green" : "white");
                record(now ? "enter" : "leave", { map: character.map, cave: character.cave || null });
                if (now && character.cave) onState(character.cave);
            }
            if (!now) { saveRec(); return; }
            voteTick();
            lootTick();
            recordEntities();
            if (Date.now() - recSavedAt > 5000) saveRec();
        } catch (e) { /* next round */ }
    }, 500);

    return {
        active: active,         // manual rules: in the cave (mode "manual") or /manual (ours or the leader's)
        caveManual: caveManual, // in the cave in manual mode (no respawn, pauses, cave chests)
        manualOn: manualOn,
        ownManual: function () { return manual; }, // our own /manual (the leader broadcasts it)
        setManual: setManual,
        inCave: inCave,
        paused: paused,
        mayFight: mayFight,
        state: function () { return lastState || character.cave || null; },
        record: record,
    };
};
