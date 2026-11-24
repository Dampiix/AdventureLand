// =====================================================================
// bot_events – live events and world bosses (leader decides, team follows).
//
// Live state comes from server.status: every entry whose key is a G.events
// event or a G.monsters boss and that is not marked live:false counts as
// live. Seasonal events (type "seasonal") count only with policy "always".
//
// Policy per name in config.events.policy: "always" | "never" (default).
//   join events  (G.events[name].join) -> join(name); every member joins too
//   world bosses (server.status gives map/x/y) -> travel there, fight it
//   roaming bosses (config.events.search, e.g. phoenix) -> the leader walks
//     the spawn areas from G.maps every few minutes; a boss that shows up
//     while farming is engaged right away
// Cooperative monsters reward every contributor, so they may be attacked
// even while they fight other players.
// =====================================================================

const game = require("../lib/game.js");
const PARTS = [
    require("../events/witch-cipher.js"),
    require("../encounters/boss-check.js"),
    require("../encounters/boss-tracker.js"),
    require("../encounters/boss-search.js"),
    require("../team/team-port.js"),
    require("../encounters/encounters.js"),
];

module.exports = function createEvents(ctx) {
    // Outside dependencies of the parts (module plan, stage 4c); cave is read when used.
    const deps = {
        game: game, util: ctx.util, config: ctx.config, comms: ctx.comms, party: ctx.party, bus: ctx.bus,
        teamStats: ctx.teamStats, get cave() { return ctx.cave; },
    };
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.events;
    const leads = !party.isMember;
    const SEARCH_KEY = "bot_boss_search:" + character.name;
    const scfg = cfg.scout || {};
    const PAGE = parent;
    const bcfg = cfg.boss || {};
    const PAUSE_KEY = "bot_boss_pause:" + character.name;
    // The internal state shared by the parts; they put their functions here too.
    const evs = {};
    PARTS.forEach(function (install) { install(evs, deps); });

    // ---- state, message handlers and the interface, in the old order (the parts' functions are all there already, as the
    // hoisted functions were) ----

    evs.lastLiveKey = "";
    evs.boss = null;           // { name, seenAt } – roaming boss currently engaged
    evs.searching = false;
    // boss -> timestamp; kept across restarts so a reload doesn't send the leader
    // searching right after a kill.
    evs.nextSearchAt = (function () {
        let stored = {};
        try { stored = get(SEARCH_KEY) || {}; } catch (e) { /* storage unavailable */ }
        // A boss just put on farmBosses still carried the old searchEveryMs time from storage,
        // so the nonstop hunt started up to 30 min late (2026-11-18): cut it to farmBossEveryMs.
        (cfg.farmBosses || []).forEach(function (name) {
            const soon = Date.now() + (cfg.farmBossEveryMs || 60 * 1000);
            if ((stored[name] || 0) > soon) stored[name] = soon;
        });
        return stored;
    })();
    // A runner boss has its own interval (config.events.runner.bosses), everything else searchEveryMs.
    // ---- Witch's Cipher: farming its ingredients (events.witchCipher, 2026-11-23, player decision) ----------------
    // The ingredients (verdantspore, frostscale, embercoal, gloomfeather) drop only during the event's 20-minute
    // gathering phase - 0.3 % per 1,000 monster HP at luck 1, so the yield follows our damage, not the spot. From
    // witchCipher.leadMs before the start until gather_end the leader farms the ingredient the merchant reports as
    // scarcest (roles/scout.js: bot_cipher_stock, ties at random, fixed per round): the first spot of
    // witchCipher.spots[ingredient] that is not blocked (crowded, too strong, a recent death) - targeting.currentFarm,
    // above hunts, drop routes and the guide. Meanwhile no roaming bosses, boss searches or Daisy trips (the whole
    // window counts). No spot passes: the normal choice. The schedule comes from server.status (a week ahead).
    // { ingredient, list, until, at } while the window is open, else null.
    evs.cipherLogged = null;

    // ---- the merchant searches bosses (events.scout, 2026-11-23, player decision) ---------------------
    // The bosses on scout.bosses are searched by the merchant (roles/scout.js) while the fighters farm on; the
    // leader writes what is due into the shared storage (bot_scout_plan) and takes the merchant's results
    // (scoutdone). Fallback: the runner / team search as before while the merchant is not available (no fresh
    // heartbeat on our server, Ponty round, trade trip, paused after a death) or a boss is overdue by
    // scout.fallbackMs.
    evs.scoutAvail = { at: 0, ok: false };
    evs.planSent = { at: 0, key: "" };
    // Respawn-aware searching (player decision 2026-11-20, idea from earthiverse's bot): after a
    // kill we watched, a boss that respawns slowly is searched again only when it can be back -
    // at kill + respawn x respawnFactor (the game's long respawns come up to 28 % early). Jr
    // (7.2 h) and Green Jr (14.4 h) were searched every 30 min for hours. Never sooner than
    // searchEveryMs; the Phoenix (32 s) and anything not seen dying keep the normal timer.
    // The kill comes from the game's "death" message; the listener lives on the game page and
    // is swapped on each load (like the hit log).
    // Its own listener name (v1.232.1): fighter.js's kill log used the same __botDeathFn and, loaded after us, took
    // this listener off - since v1.227.5 every boss ended as "gone without a kill seen", 30 s after it was last seen
    // (the team stood ~10-30 s after each kill), and respawn-aware searching never ran.
    try {
        if (PAGE.__botBossDeathFn) PAGE.socket.off("death", PAGE.__botBossDeathFn);
        PAGE.__botDeaths = PAGE.__botDeaths || {};
        PAGE.__botBossDeathFn = function (d) {
            try {
                if (!d || !d.id) return;
                const now = Date.now();
                PAGE.__botDeaths[d.id] = now;
                Object.keys(PAGE.__botDeaths).forEach(function (id) { if (now - PAGE.__botDeaths[id] > 10 * 60 * 1000) delete PAGE.__botDeaths[id]; });
            } catch (e) { /* bookkeeping only */ }
        };
        PAGE.socket.on("death", PAGE.__botBossDeathFn);
    } catch (e) { /* no socket */ }
    evs.lastJoinTry = 0;
    evs.joined = null;         // leader: { name, map } once we stand on the event map
    evs.joining = null;        // leader: { name, from, at } while a join() is on its way

    // ---- boss check -----------------------------------------------------------
    // The guide never calls a boss safe ("group" monster), and other players are
    // rarely around, so the leader judges a boss itself from everyone's stats
    // (members report them every minute), with the game's damage formula:
    //   burst:   every fighter survives config.events.boss.minHits hits
    //   healing: the boss's damage per second on the tank is covered by the
    //            priests' healing (potions may add healCover - 1 on top)
    //   time:    the team alone kills it within maxFightMinutes (if set)
    // A death while fighting a boss pauses it for pauseAfterDeathMs (persisted).
    // The team's combat stats (shareStats, teamStats) live in team/team-stats.js (stage 4a).
    evs.paused = (function () { try { return get(PAUSE_KEY) || {}; } catch (e) { return {}; } })();
    evs.verdicts = {};             // boss -> { ok, why, at }

    // Can I open on this boss on my own (player decision 2026-11-21)? Anyone may attack a boss alone -
    // unless it is too strong for us alone with its real level (burst, damage vs. own sustain;
    // kiting counts): then we hold it until the team is there (targeting.holdBoss), with the
    // healer the team always manages. Logged when the verdict changes.
    evs.soloSeen = {}; // "type:level" -> { ok, at }

    // Leader: a death while fighting a boss pauses that boss.
    evs.lastDeathNoPause = "";

    evs.skippedForLevel = {};
    evs.searchAbort = null; // name of the boss in sight that stopped the running search

    // Boss sightings shared by the members (player decision 2026-11-20): warrior and ranger saw
    // the Phoenix and walked to it, the priest (leader) did not see it and stood waiting for them
    // until it came into his own sight. Members report a target boss in their sight every 2 s;
    // the leader engages it like one he sees himself and walks to the reported spot.
    evs.sightings = {};      // leader: boss -> { id, map, x, y, from, at }
    evs.lastSightingSent = 0;
    deps.comms.on("bosssight", function (data, from) {
        if (!leads || !data || !data.name || !evs.watched().includes(data.name)) return;
        // Nonstop mode: the runner met its nonstop boss by chance (no job) - it gets the job and kills
        // it alone, no team call (player decision 2026-11-21: the ranger found a Phoenix at the farm
        // spot and the whole team came).
        // Its own nonstop job's boss: never a team call (13:42Z: the job went out in the same second
        // as the runner's report, and the warrior came anyway).
        if (evs.runnerJob && evs.runnerJob.nonstop && evs.runnerJob.who === from && evs.runnerJob.name === data.name) return;
        if (!evs.runnerJob && !evs.current && evs.nonstopRunner(data.name) === from) {
            util.log("event", data.name + " met by " + from + " - nonstop: " + from + " takes it alone", "yellow");
            if (evs.startRunner(data.name)) return;
        }
        if (!evs.sightings[data.name] || Date.now() - evs.sightings[data.name].at > 30 * 1000) {
            util.log("event", data.name + " seen by " + from + " " + (data.info ? evs.infoText(data.info) : "(" + data.map + ")"), "green");
        }
        evs.sightings[data.name] = { id: data.id, map: data.map, x: data.x, y: data.y, fx: data.fx, fy: data.fy, from: from, at: Date.now(), info: data.info || null };
        // The merchant reports and walks on (events.scout, 2026-11-23): its report holds up to scout.holdMs instead
        // of 10 s - the walk from the farm spot takes 60-90 s, and at 06:09 the team turned back after 32 s.
        if (scfg.enabled && from === config.merchant) {
            evs.sightings[data.name].scout = true;
            evs.sightings[data.name].until = Date.now() + (scfg.holdMs || 3 * 60 * 1000);
        }
    });
    // Kills only a member sees (player request 2026-11-21): the leader counted a Phoenix the ranger
    // and nibe2 killed in the cave as "gone without a kill seen" (and searched it again on the
    // plain timer instead of the respawn rule) - it only knew deaths from its own game socket.
    // A member reports the death of a boss it reported; the leader books it like its own.
    deps.comms.on("bossdeath", function (data, from) {
        if (!leads || !data || !data.id) return;
        try {
            PAGE.__botDeaths = PAGE.__botDeaths || {};
            if (!PAGE.__botDeaths[data.id]) PAGE.__botDeaths[data.id] = Math.min(Date.now(), data.at || Date.now());
        } catch (e) { /* bookkeeping only */ }
    });
    evs.reportedBoss = {}; // member: boss id -> { name, at } of our sightings, for the death report
    // Parallel boss search (player decision 2026-11-21, from earthiverse): the leader splits the spawn
    // areas between the fighters in the party (nearest first, in turns); each walks its own and
    // reports a sighting (bosssight) - the team then meets there. Nobody opens the fight alone
    // (targeting holds an unengaged boss until the team is there).
    evs.split = null; // leader: { id, name, members, pending }
    // The merchant's search round is done (roles/scout.js): a boss it did not find (or found, but the team did not
    // engage it) is searched again on its timer; an engaged one is booked by decide().
    deps.comms.on("scoutdone", function (data, from) {
        if (!leads || !data || !data.name || from !== config.merchant) return;
        if (data.found && evs.boss && evs.boss.name === data.name) return; // engaged: decide() books the next search
        evs.searchLater(data.name);
        util.log("event", data.name + (data.found ? " found by " + from + " but not engaged" : " not found by " + from) + " - next search in " + Math.max(1, Math.round((evs.nextSearchAt[data.name] - Date.now()) / 60000)) + " min", "white");
    });
    deps.comms.on("searchdone", function (data, from) {
        if (evs.split && data && data.id === evs.split.id) evs.split.pending = evs.split.pending.filter(function (n) { return n !== from; });
        if (evs.runnerJob && data && data.id === evs.runnerJob.id) {
            const name = evs.runnerJob.name;
            evs.endRunner();
            if (data.died) {
                // The runner died fighting it alone: pause the boss like a team death (pauseAfterDeathMs).
                evs.paused[name] = Date.now() + (bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000);
                try { set(PAUSE_KEY, evs.paused); } catch (e) { /* storage unavailable */ }
                util.log("event", from + " died fighting " + name + " alone - pausing it for " + Math.round((bcfg.pauseAfterDeathMs || 3 * 60 * 60 * 1000) / 3600000) + " h", "red");
                evs.searchLater(name);
            } else if (data.killed) evs.respawnLater(name, data.killed);
            else if (data.interrupted && evs.policy(data.interrupted) !== "always") {
                // A boss we don't take (paused after a death, too strong): no instant new job - the
                // runner stopped again at once, 30 jobs in 5 s next to a paused level-8 Phoenix
                // (2026-11-21). Searched again on the usual timer.
                evs.searchLater(name);
                util.log("event", from + " stopped the " + name + " search for " + data.interrupted + ", which we leave alone now - next search in " +
                    Math.max(1, Math.round((evs.nextSearchAt[name] - Date.now()) / 60000)) + " min", "white");
            } else if (data.interrupted && evs.nonstopRunner(data.interrupted) === from) {
                // Stopped for its own nonstop boss: that job right away (no team call, no loop of the
                // old search being sent again and stopped again).
                util.log("event", from + " stopped the " + name + " search for " + data.interrupted + " - nonstop: it takes it alone", "yellow");
                evs.startRunner(data.interrupted);
            } else if (data.interrupted) util.log("event", from + " stopped the " + name + " search for " + data.interrupted + " - searching it again after that", "white");
            else {
                evs.searchLater(name);
                util.log("event", name + (data.alone ? " fought by " + from + " alone, no kill seen" : data.found ? " found by " + from + " - the team comes" : " not found by " + from) +
                    " - next search in " + Math.max(1, Math.round((evs.nextSearchAt[name] - Date.now()) / 60000)) + " min", data.found ? "green" : "white");
            }
        }
    });

    // One runner per boss (player decision 2026-11-21): the leader sends one fighter to the spawn
    // areas of a runner boss while the rest of the team farms on. It kills a solo boss itself, a strong
    // one it reports (bosssight) and holds until the team is there when holdsFor says so
    // (events.holdForTeam or events.holdFor - both off / [] now).
    evs.runnerJob = null; // leader: { id, name, who, at }
    // The last runner walking back to us after its job: not waited for either (2026-11-21: the priest
    // stopped three times for the warrior on its way back from Dracul and Green Jr.).
    evs.lastRunner = null; // leader: { who, at }
    // Speeds are remembered from when we last saw each fighter. The runner is only sent when it stands
    // near us; on its way back from the last job we wait for it, a dead or offline one is skipped
    // (2026-11-21: Green Jr. went to the second choice while the first walked back from Jr. - the
    // priest stood alone at the spot).
    evs.speedOf = {};
    deps.comms.on("searchack", function (data, from) {
        if (evs.runnerJob && data && data.id === evs.runnerJob.id && from === evs.runnerJob.who) evs.runnerJob.acked = true;
    });
    // Members: walk the areas the leader gave us, stop on its "searchstop" or when we see the boss.
    evs.job = null; // { id, name, spots, stop }
    evs.heldFind = null; // { name, until }: a boss we just found as the runner, held until the leader's event (v1.235.9)
    evs.nonstopUntil = {}; // member: boss -> until when we count as its nonstop runner (no team call)
    deps.comms.on("searchjob", function (data, from) {
        if (leads || from !== config.leader || !data || !Array.isArray(data.spots)) return;
        if (evs.job) evs.job.stop = true;
        evs.job = { id: data.id, name: data.name, spots: data.spots, stop: false, solo: !!data.solo, kill: null, killMs: data.killMs || 0 };
        if (data.nonstop) evs.nonstopUntil[data.name] = Date.now() + 3 * 60 * 1000;
        deps.comms.send(config.leader, "searchack", { id: data.id });
        util.log("event", "searching " + data.name + " for the team: " + data.spots.map(function (s) { return s.map; }).join(", ") + (data.solo ? " (killing it alone)" : ""), "yellow");
        evs.runJob(evs.job);
    });
    deps.comms.on("searchstop", function (data, from) {
        if (from !== config.leader || !evs.job || (data && data.id && data.id !== evs.job.id)) return;
        evs.job.stop = true;
        evs.job = null;
        try { stop(); } catch (e) { /* not walking */ }
    });

    // What the team should do right now, or null (then hunts/farming go on).
    //   { name, join: true }                  -> fight anything in the event map
    //   { name, monster, dest }               -> fight `monster`, travel to dest
    evs.current = null;

    const api = {
        tick: evs.tick,
        current: function () { return evs.current; },
        // Leader: a parallel (split) boss search is under way - the members walk their own areas, no team wait.
        splitSearching: function () { return !!(evs.split && evs.searching); },
        // Our own boss search: a member's share of a split search, or the leader's search walk (v1.235.8, travel magiport).
        searchJob: function () { return !!evs.job || !!evs.searching; },
        // Leader: not waited for - the runner on a job, and the nonstop runner between its laps too.
        runnerOut: function () {
            if (evs.runnerJob) return evs.runnerJob.who;
            if (!leads) return null;
            if (evs.lastRunner && Date.now() - evs.lastRunner.at < 2 * 60 * 1000) return evs.lastRunner.who; // on its way back
            return evs.nonstopActive();
        },
        onOwnDeath: evs.onOwnDeath, // fighter.handleDeath
        // Chat command /phoenix (main.js, player request 2026-11-21): search a boss now, lifting a pause.
        searchNow: function (name) {
            if (!leads) return "only the leader (" + config.leader + ") searches";
            if (!evs.watched().includes(name)) return name + " is not a boss we search (" + evs.watched().join(", ") + ")";
            evs.nextSearchAt[name] = Date.now();
            delete evs.paused[name];
            try { set(SEARCH_KEY, evs.nextSearchAt); set(PAUSE_KEY, evs.paused); } catch (e) { /* storage unavailable */ }
            Object.keys(evs.verdicts).forEach(function (k) { if (k.indexOf(name) === 0 || k.indexOf("solo:" + name) === 0) delete evs.verdicts[k]; });
            util.log("event", name + ": search now (chat command)", "yellow");
            return name + " - searching now" + (evs.searching || evs.runnerJob ? " (after the search under way)" : "");
        },
        soloOk: evs.soloOk,         // targeting.holdBoss: too strong for me alone -> hold for the team
        bossBusy: evs.bossBusy,     // fighter.busyStep: no Daisy trips during a boss fight
        // A roaming boss is in sight (ours or a member's): the leader goes to it, no team wait.
        // Checked live: the team wait runs before tick(), so `current` stays stale while waiting
        // (2026-11-20: the priest waited 45 s for the warrior with the Phoenix reported).
        engaging: function () { return !!(evs.current && evs.current.sighted) || (leads && !!evs.visibleBoss()); },
        publishScoutPlan: evs.publishScoutPlan, // fighter.busyStep: every tick, before the team wait and supply can take it
        cipherFarm: evs.cipherFarm,             // targeting.currentFarm: the Witch's Cipher ingredient spot list, or null
        cipherActive: evs.cipherActive,         // fighter.busyStep: no Daisy trips in the gathering window
        acceptMagiport: evs.acceptMagiport,     // main.js on_magiport
    };
    // On the bus for the party (stage 4a): the current boss event and whether a boss search job runs.
    deps.bus.provide("boss", api.current);
    deps.bus.provide("search", api.searchJob);
    return api;

};
