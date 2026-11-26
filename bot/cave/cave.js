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
//
// deps (module plan, stage 3c): { config, util, comms, party, bus } - party may be a getter; bus (stage 4a) gets
// "manual" and "manualOwn".
// =====================================================================

module.exports = function createCave(deps) {
    const config = deps.config;
    const util = deps.util;
    const comms = deps.comms;
    const cfg = config.cave || {};
    const me = character.name;
    const isLeader = me === config.leader;
    const REC_KEY = "bot_cave_rec:" + me;
    const PAGE = parent;

    function inCave() { return !!character.cave; }
    function caveManual() { return inCave() && cfg.mode === "manual"; }
    // /manual (v1.231.1, player decision 2026-11-24): the same manual rules outside the cave - the player walks the
    // leader (e.g. to Dorr) without stopping its code, so the leader's position still goes out and the members follow
    // across maps. Kept in the storage across code loads until /manual again. Members take it from the leader's
    // broadcast (party "lead" message, field manual).
    const MANUAL_KEY = "bot_manual:" + me;
    let manual = false;
    try { manual = !!get(MANUAL_KEY); } catch (e) { /* storage unavailable */ }
    function setManual(on) {
        manual = !!on;
        try { set(MANUAL_KEY, manual ? Date.now() : null); } catch (e) { /* storage unavailable */ }
        util.log("cave", manual ? "manual mode ON - you walk " + me + "; the bot fights only what you start or what attacks the party (/manual to end)"
            : "manual mode OFF - back to the bot's own plans", "yellow");
    }
    function leaderManual() {
        if (isLeader || !deps.party || !deps.party.leaderInfo) return false;
        const l = deps.party.leaderInfo();
        return !!(l && l.manual);
    }
    function manualOn() { return manual || leaderManual(); }
    function active() { return caveManual() || manualOn(); }
    // Agitate, Cleave and Stomp off under the manual rules, also with /manual outside the cave (v1.231.2).
    if (util.setNoAreaHook) util.setNoAreaHook(function () { return cfg.noArea !== false && active(); });
    if (manual) util.log("cave", "manual mode still ON (/manual to end)", "yellow");
    function paused() { return !!(character.cave && character.cave.paused) || !!(lastState && lastState.paused); }

    // ---- recorder -----------------------------------------------------------------------------------------------
    let rec = null;
    function recBuf() {
        if (!rec) { try { rec = get(REC_KEY) || []; } catch (e) { rec = []; } }
        return rec;
    }
    // v1.231.5 (after the first run 2026-11-24): the clock made every state "new" - 236 of the leader's 300 entries were
    // states one second apart, truncated at 3,000 chars, and floor 1 was overwritten. Now a state is kept only when
    // something besides the clock changed; it is slimmed (no *_message phrase objects, rewards recorded once each as
    // "reward") and kept up to recordMaxChars; entities keep only game fields. A full storage drops the oldest half.
    let recSavedAt = 0, recDirty = false;
    function record(kind, data) {
        if (cfg.record === false) return;
        const buf = recBuf();
        let s;
        try { s = JSON.stringify(data); } catch (e) { s = String(data); }
        const max = cfg.recordMaxChars || 12000;
        buf.push([Date.now(), kind, s.length > max ? s.slice(0, max) + "...(" + s.length + ")" : s]);
        const cap = isLeader ? (cfg.recordCapLeader || 400) : (cfg.recordCapMember || 150);
        if (buf.length > cap) buf.splice(0, buf.length - cap);
        recDirty = true;
        if (Date.now() - recSavedAt > 3000) saveRec();
    }
    function saveRec() {
        if (!recDirty) return;
        recSavedAt = Date.now();
        recDirty = false;
        try { set(REC_KEY, recBuf()); } catch (e) {
            const buf = recBuf(); // storage full: keep the newer half
            buf.splice(0, Math.ceil(buf.length / 2));
            try { set(REC_KEY, buf); } catch (e2) { /* still full or unavailable */ }
        }
    }

    // A cave state without the clock and the phrase objects; rewards go out once each as "reward" entries.
    const CLOCK = { expires: 1, server_time: 1, remaining_ms: 1, paused_at: 1, deadline: 1 };
    function strip(v, top) {
        if (Array.isArray(v)) return v.map(function (x) { return strip(x, false); });
        if (!v || typeof v !== "object") return v;
        const o = {};
        Object.keys(v).forEach(function (k) {
            if (/_message$|_messages$/.test(k) || k === "cx") return;
            if (top && (CLOCK[k] || k === "rewards")) return;
            if (!top && k === "deadline") return;
            o[k] = strip(v[k], false);
        });
        return o;
    }
    const rewardSeen = {};
    function slimState(state) {
        if (!state || typeof state !== "object") return state;
        (state.rewards || []).forEach(function (r) {
            if (!r || r.id == null || rewardSeen[r.id]) return;
            rewardSeen[r.id] = true;
            record("reward", r);
        });
        return strip(state, true);
    }

    // Cave state pushes (character.on("cave")): only when something besides the clock changed.
    let lastState = null, lastSig = "";
    function onState(state) {
        lastState = state || null;
        const slim = slimState(state);
        let sig = "";
        try { sig = JSON.stringify(slim); } catch (e) { return; }
        if (sig === lastSig) return;
        lastSig = sig;
        // v1.238.6: members keep no states (the leader's are the same) - on the second run (2026-11-25) their 150
        // entries were full after ten minutes and their first floor was gone. Rewards above stay (recipient per member).
        if (!isLeader && cfg.recordStatesMember === false) return;
        record("state", Object.assign({ remaining_ms: state && state.remaining_ms }, slim));
    }
    try { character.on("cave", onState); } catch (e) { util.log("cave", "no cave state events: " + util.errReason(e), "orange"); }

    // Entities on the cave map (every entsEveryMs, when the set of ids/targets changed): game fields only (the first
    // run stored the renderer's sprite fields too).
    let entsSig = "", entsAt = 0;
    const ENT_KEYS = ["id", "type", "mtype", "name", "level", "hp", "max_hp", "attack", "armor", "resistance", "xp", "speed", "range",
        "frequency", "rage", "aggro", "damage_type", "target", "npc", "ctype", "cave", "owner", "ally", "citizen"];
    function flat(e) {
        const o = {};
        ENT_KEYS.forEach(function (k) { if (e[k] !== undefined && e[k] !== null) o[k] = e[k]; });
        o.x = Math.round(e.x || 0); o.y = Math.round(e.y || 0);
        if (e.s && typeof e.s === "object") { const s = Object.keys(e.s); if (s.length) o.s = s; }
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
        if (!PAGE.__botCaveReqOrig && typeof PAGE.cave_request === "function") {
            PAGE.__botCaveReqOrig = PAGE.cave_request;
            PAGE.cave_request = function (name, args) {
                try { if (PAGE.__botCaveHook) PAGE.__botCaveHook(name, args); } catch (e) { /* hook only */ }
                const p = PAGE.__botCaveReqOrig.apply(this, arguments);
                try {
                    if (p && typeof p.then === "function" && PAGE.__botCaveDone) {
                        p.then(function (r) { try { PAGE.__botCaveDone(name, args, r, null); } catch (e) { /* hook only */ } },
                            function (er) { try { PAGE.__botCaveDone(name, args, null, er); } catch (e) { /* hook only */ } });
                    }
                } catch (e) { /* hook only */ }
                return p;
            };
        }
    } catch (e) { util.log("cave", "could not wrap cave_request: " + util.errReason(e), "orange"); }
    PAGE.__botCaveHook = function (name, args) {
        if (name === "info") return; // asked often by the client, nothing to learn
        record("req", { name: name, args: args || null });
        if (name === "vote" && isLeader && args && args.choice != null && args.option != null) {
            const others = deps.party.memberNames().filter(function (n) { return n !== me; });
            if (others.length) comms.send(others, "cavevote", { choice: args.choice, option: args.option });
            util.log("cave", "voted " + args.option + " - members follow", "yellow");
        }
    };
    PAGE.__botCaveDone = function (name, args, result, error) {
        if (name === "info") return;
        // A result carrying the whole cave state (talk, enter): the state goes through onState, the entry keeps the rest.
        let r = result;
        if (r && typeof r === "object" && r.state && typeof r.state === "object") {
            const st = r.state;
            r = Object.assign({}, r, { state: "(recorded as state)" });
            try { onState(st); } catch (e) { /* record only */ }
        }
        record("res", { name: name, ok: !error, result: r, error: error ? util.errReason(error) : null });
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
                record(now ? "enter" : "leave", { map: character.map, floor: character.cave ? character.cave.floor : null });
                if (now && character.cave) onState(character.cave);
            }
            if (!now) { saveRec(); return; }
            voteTick();
            lootTick();
            recordEntities();
            if (Date.now() - recSavedAt > 5000) saveRec();
        } catch (e) { /* next round */ }
    }, 500);

    // On the bus for the party (stage 4a): manual rules on, and our own /manual (the leader broadcasts it).
    if (deps.bus) {
        deps.bus.provide("manual", active);
        deps.bus.provide("manualOwn", function () { return manual; });
    }
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
