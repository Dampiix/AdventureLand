// =====================================================================
// farming/farm-choice.js - the farm target: who objects to a kind, XP ranking, the guide's progression, events, hunts, drops, the Witch's Cipher.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;

    // Who (if anyone) is not safe at this monster.
    function objector(monster, own) {
        if (tgt.recentDeath(monster)) return "the team (recent death)";
        // A melee leader cannot farm a damage-return monster at all (members just stand by).
        if (util.tooSpiky(config, monster)) return character.name + " (melee vs. damage return)";
        // Team model: the party as a whole can take it – no single member's veto.
        if (tgt.teamModelOn() && tgt.teamVerdict(monster).ok) return null;
        // A "trial" spot only waits for proof when it could hurt: a monster every fighter
        // survives 20+ hits of (e.g. armadillos, 20 attack) is fine to try right away –
        // otherwise such a spot is never farmed and so never proven.
        const proven = !cfg.avoidTrial || tgt.provenByUs(monster) || tgt.harmless(monster);
        let unlisted = 0; // fighters whose guide doesn't know the monster
        if (own) {
            if (!own.listed.has(monster)) unlisted++;
            else if (tgt.soloRouteSafe(monster)) { /* alone: our own solo check (with kiting) overrides the guide (v1.226.8) */ }
            else if (!own.safe.has(monster) || (!proven && !own.sure.has(monster))) return character.name;
        }
        const now = Date.now();
        const member = Object.keys(tgt.reports).find(function (name) {
            const r = tgt.reports[name];
            if (!party.inParty(name) || now - r.at > 3 * 60 * 1000) return false;
            if (r.listed && !r.listed.includes(monster)) { unlisted++; return false; }
            return !r.safe.includes(monster) || (!proven && !r.sure.includes(monster));
        });
        if (member) return member;
        if (unlisted && !tgt.harmless(monster)) return "the team (" + monster + " unknown to the guide, not harmless)";
        return null;
    }
    function lastingObjector(monster, own) {
        const who = objector(monster, own);
        if (!who) { delete tgt.objectedSince[monster]; return null; }
        const here = tgt.farm && tgt.farm.monster === monster && String(tgt.farm.source).startsWith("guide");
        if (!here || tgt.recentDeath(monster)) return who;
        const now = Date.now();
        if (!tgt.objectedSince[monster]) {
            tgt.objectedSince[monster] = now;
            util.log("target", monster + " looks unsafe for " + who + " - staying unless that lasts " +
                Math.round((cfg.objectionGraceMs || 0) / 60000) + " min", "white");
        }
        return now - tgt.objectedSince[monster] >= (cfg.objectionGraceMs || 0) ? who : null;
    }

    // For bot_hunts: is this monster safe for the whole team right now?
    function isTeamSafe(monster) {
        return !whyUnsafe(monster);
    }
    // null when safe, else who/what objects (for logs).
    function whyUnsafe(monster) {
        let own = null;
        try { own = tgt.ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (!own) return "no guide data yet";
        // Every spot of it taken or found too strong by the spot check (2026-11-22: hunts kept the team there).
        if (tgt.allSpotsTaken(monster)) return "every " + monster + " spot taken or too strong";
        const who = objector(monster, own);
        return who ? "not safe for " + who : null;
    }

    // The guide's computed XP per second for a route: the monster's XP over the route's cycle
    // (player decision 2026-11-18, "nur Rechnung"). A route the guide has observed carries the
    // measured XP instead - with Agitate and the Welcome Back bonus in it goo showed 1426 XP/s
    // against ~800 computed for the others, and the warrior farmed goos.
    function calcXp(r) {
        const d = r && G.monsters[r.monster];
        return d && r.cycle > 0 ? (d.xp || 0) / r.cycle : ((r && r.xp) || 0);
    }
    function walkable(r) {
        if (r.map) {
            const m = G.maps[r.map];
            if (!m || m.instance || m.ignore) return false;
        }
        if (tgt.walkableSeen[r.monster] === undefined) {
            tgt.walkableSeen[r.monster] = Object.keys(G.maps).some(function (k) {
                const m = G.maps[k];
                return !m.instance && !m.ignore && (m.monsters || []).some(function (p) { return p.type === r.monster; });
            });
        }
        return tgt.walkableSeen[r.monster];
    }
    function teamXpRanking() {
        if (tgt.rankCache && Date.now() - tgt.rankCache.at < 60 * 1000) return tgt.rankCache.list;
        let advice = null;
        try { advice = get_progression(); } catch (e) { return null; }
        if (!advice || !Array.isArray(advice.routes)) return null;
        const own = tgt.ownSafe(advice);
        const model = tgt.teamModelOn();
        const seen = {};
        const list = advice.routes
            .filter(function (r) { return r && G.monsters[r.monster] && walkable(r) && (model || r.safe || tgt.soloRouteSafe(r.monster)) && !lastingObjector(r.monster, own); })
            .sort(function (a, b) { return calcXp(b) - calcXp(a); })
            .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
            .map(function (r) { return r.monster; });
        tgt.rankCache = { at: Date.now(), list: list };
        return list;
    }

    // The guide's farm choices (up to three safe routes, best first) that are safe
    // for the whole team, skipping monsters whose spot was recently found crowded.
    function fromProgression() {
        let list = [];
        let spare = []; // other safe routes, for when every choice is crowded
        try {
            const advice = get_progression();
            if (!advice) return null;
            const own = tgt.ownSafe(advice);
            // Team model: the guide's routes (for the leader alone) ranked by XP, keeping
            // every monster the team can take – also ones the guide calls unsafe solo.
            if (tgt.teamModelOn() && Array.isArray(advice.routes)) {
                const seen = {};
                const teamList = advice.routes
                    .filter(function (r) { return r && G.monsters[r.monster] && walkable(r) && !lastingObjector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team model" }; });
                if (teamList.length) {
                    // The best one not crowded/occupied, however far down the list (2026-11-19: with the
                    // top three only, squigtoads and giant scorpions both taken sent the team straight
                    // back to the taken squigtoads); every one blocked: the best one.
                    const now = Date.now();
                    return teamList.find(function (c) { return !(tgt.crowdedUntil[c.monster] > now); }) || teamList[0];
                }
            }
            // The guide's safe routes ranked by its XP number (XP/s), best three monsters
            // (player decision 2026-11-18): its own short list (advice.choices) is not ranked by
            // XP - a level-71 warrior on his own got goo, irritated goo and poisio.
            const seenRaw = {};
            const ranked = Array.isArray(advice.routes) ? advice.routes
                .filter(function (r) { return r && (r.safe || tgt.soloRouteSafe(r.monster)) && G.monsters[r.monster] && walkable(r); })
                .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                .filter(function (r) { if (seenRaw[r.monster]) return false; seenRaw[r.monster] = true; return true; })
                .slice(0, 3)
                .map(function (r) { return { kind: "farm", monster: r.monster, map: r.map }; }) : [];
            const raw = ranked.length ? ranked : (advice.choices || [])
                .filter(function (c) { return c.kind === "farm" && G.monsters[c.monster]; });
            list = raw
                .filter(function (c) { return !lastingObjector(c.monster, own); })
                .map(function (c) { return { monster: c.monster, map: c.map, source: "guide" }; });
            if (raw.length && list.length < raw.length) {
                // The guide's best pick is too risky for someone: say so once.
                const first = raw[0];
                const who = objector(first.monster, own);
                const msg = who ? first.monster + " is not safe for " + who + (list.length ? " - " + list[0].monster + " instead" : "") : "";
                if (msg && msg !== tgt.lastSkipLog) { tgt.lastSkipLog = msg; util.log("target", msg, "orange"); }
            }
            if (!list.length && Array.isArray(advice.routes)) {
                // None of the top three is safe for everyone: best other safe route.
                const seen = {};
                list = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && walkable(r) && !objector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .slice(0, 3)
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team-safe" }; });
            }
            if (Array.isArray(advice.routes)) {
                const seen = {};
                spare = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && walkable(r) && !objector(r.monster, own); })
                    .sort(function (a, b) { return calcXp(b) - calcXp(a); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, next free spot" }; });
            }
            if (!list.length && !raw.length) {
                const row = (advice.rows || []).find(function (r) {
                    return r.action && r.action.kind === "farm" && r.action.route && G.monsters[r.action.route.monster];
                });
                if (row) list = [{ monster: row.action.route.monster, map: row.action.route.map, source: "guide task" }];
            }
        } catch (e) {
            util.log("target", "get_progression failed: " + util.errReason(e), "red");
        }
        if (!list.length) return null;
        const now = Date.now();
        const free = list.find(function (c) { return !(tgt.crowdedUntil[c.monster] > now); });
        if (free) return free;
        // Every choice is crowded: the best other safe route that isn't...
        const other = spare.find(function (c) { return !(tgt.crowdedUntil[c.monster] > now); });
        if (other) return other;
        // ...else the one that frees up first.
        return list.slice().sort(function (a, b) { return tgt.crowdedUntil[a.monster] - tgt.crowdedUntil[b.monster]; })[0];
    }

    // Monster types an event spawns in waves (G.events[name].waves), or null for "anything".
    function eventMonsters(name) {
        // Configured types first (events.joinTypes, e.g. the Giga Crab and its Huge Crabs on the main map).
        const jt = (config.events && config.events.joinTypes) || {};
        if (Array.isArray(jt[name])) return jt[name].slice();
        const waves = G.events[name] && G.events[name].waves;
        if (!Array.isArray(waves)) return null;
        const types = {};
        waves.forEach(function (w) { Object.keys((w && w[1]) || {}).forEach(function (t) { types[t] = true; }); });
        return Object.keys(types);
    }

    // Source kind of a farm target ("leader", "hunt", "drop", "guide" ...): the log line
    // also shows a change of source, not only of the monster (2026-11-18: a member farming on
    // its own kept the leader's mole without a line and died there three times).
    function srcKind(f) { return f ? String(f.source || "").split(",")[0].replace(/ of .*/, "") : ""; }
    function currentFarm() {
        // Cave of Many Dreams, manual mode (bot_cave, v1.231.0): no spot, no travel - pickInner fights only what the
        // player starts or what attacks the party.
        // /manual (v1.231.1) the same outside the cave: the player walks the leader.
        if (deps.cave && deps.cave.active()) {
            const src = deps.cave.caveManual() ? "cave" : "manual";
            if (!tgt.farm || tgt.farm.source !== src) util.log("target", "now: " + src + " (the player walks the leader; fights only what it starts or what attacks us)", "yellow");
            tgt.farm = { monster: null, any: true, types: [], cave: true, source: src };
            tgt.nextPickAt = 0; // v1.231.2: after /manual off a fresh pick at once (the manual farm stuck until refreshMs)
            return tgt.farm;
        }
        tgt.shareSafe(); // members: tell the leader where we can fight safely
        tgt.clock();     // leader: our own experience with the current farm target
        // Events and world bosses come first (bot_events; members get it from the leader).
        const ev = deps.events ? deps.events.current() : null;
        if (ev) {
            const next = ev.join
                ? { monster: null, any: true, types: eventMonsters(ev.name), source: "event " + ev.name }
                : { monster: ev.monster || ev.name, dest: ev.dest || ev.monster || ev.name, source: "event " + ev.name };
            if (!tgt.farm || tgt.farm.source !== next.source) util.log("target", "now: " + next.source, "yellow");
            tgt.farm = next;
            tgt.nextPickAt = 0;
            return tgt.farm;
        }

        const lead = party.leaderInfo();
        if (lead && lead.farm && !party.detached()) {
            if (!tgt.farm || tgt.farm.monster !== lead.farm || srcKind(tgt.farm) !== "leader") util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            tgt.farm = { monster: lead.farm, source: "leader" };
            tgt.nextPickAt = 0;
            return tgt.farm;
        }
        // A member without the leader's farm target yet (right after a restart) waits for it instead of choosing its
        // own (2026-11-22: warrior and ranger ran off to the CGoos in the desert while the leader went to the booboos).
        if (party.enabled && party.isMember && !party.detached()) {
            if (!tgt.farm || tgt.farm.source !== "waiting for the leader") util.log("target", "waiting for the leader's farm target", "white");
            tgt.farm = { monster: null, source: "waiting for the leader" };
            tgt.nextPickAt = 0;
            return tgt.farm;
        }

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;

        // Witch's Cipher gathering (events.witchCipher, 2026-11-23, player decision): the scarcest ingredient's spot
        // list, the first one not blocked - above hunts, drop routes, the config target and the guide.
        const cf = deps.events && deps.events.cipherFarm ? deps.events.cipherFarm() : null;
        if (cf && cf.list.length) {
            const pickC = cf.list.find(function (m) { return G.monsters[m] && !farmBlocked(m); });
            if (pickC) {
                const nextC = { monster: pickC, source: "witch's cipher: " + cf.ingredient };
                if (!tgt.farm || tgt.farm.monster !== nextC.monster || tgt.farm.source !== nextC.source) util.log("target", "farm target: " + pickC + " (" + nextC.source + ")", "yellow");
                tgt.farm = nextC;
                tgt.nextPickAt = 0; // the normal choice right after the window
                return tgt.farm;
            }
        }

        // An open, safe Monster Hunt beats both the guide and a configured farm target;
        // the configured target only replaces the guide's choice.
        // A hunt whose kind is blocked (too strong here, waiting for the Cavalry - or crowded) waits too (v1.235.3): the
        // stoneworm hunt was picked again every 3 s, the spot check blocked it again, and the team stood idle there.
        const huntPick = deps.hunts ? deps.hunts.target() : null;
        const hunt = huntPick && !(tgt.crowdedUntil[huntPick.monster] > Date.now()) ? huntPick : null;
        if (huntPick && !hunt && Date.now() - tgt.huntBlockLogAt > 5 * 60 * 1000) {
            tgt.huntBlockLogAt = Date.now();
            util.log("hunt", huntPick.monster + " hunt waits: the spot is blocked for " + Math.max(1, Math.round((tgt.crowdedUntil[huntPick.monster] - Date.now()) / 60000)) + " min - farming meanwhile", "white");
        }
        if (hunt) {
            if (!tgt.farm || tgt.farm.monster !== hunt.monster || srcKind(tgt.farm) !== srcKind(hunt)) util.log("target", "farm target: " + hunt.monster + " (" + hunt.source + ")", "yellow");
            tgt.farm = hunt;
            tgt.nextPickAt = 0; // re-evaluate the guide as soon as the hunt is over
            return tgt.farm;
        }

        const now = Date.now();

        // Items that can't be bought come before XP: the merchant reports what is
        // missing, the guide names the drop route (bot_drops).
        const drop = !override && deps.drops ? deps.drops.target(function (m) { return tgt.crowdedUntil[m] > now; }) : null;
        if (drop) {
            if (!tgt.farm || tgt.farm.monster !== drop.monster || srcKind(tgt.farm) !== srcKind(drop)) util.log("target", "farm target: " + drop.monster + " (" + drop.source + ")", "yellow");
            tgt.farm = drop;
            tgt.nextPickAt = 0; // back to the guide as soon as the item is complete
            return tgt.farm;
        }

        // Cavalry plan (player design 2026-11-19): the first farm target too strong (skipped as
        // crowded) -> go there and reset it with the Cavalry; the first one fine -> nuke the first
        // spot of cavalry.targets (e.g. dinos: loot at high level) and come back.
        const plan = tgt.cavalryPlan(override);
        if (plan) {
            if (!tgt.farm || tgt.farm.monster !== plan.monster || tgt.farm.source !== plan.source) util.log("target", "farm target: " + plan.monster + " (" + plan.source + ")", "yellow");
            tgt.farm = plan;
            tgt.nextPickAt = 0;
            return tgt.farm;
        }

        if (tgt.farm && now < tgt.nextPickAt) return tgt.farm; // hunt/leader/drop targets reset nextPickAt to 0

        // config.targeting.farm: one monster or a list - the first one not skipped (crowded or too
        // strong, every spot taken, a recent death), else the guide's choice (2026-11-19).
        const list = farmList(override);
        const listed = list.find(function (m) { return !farmBlocked(m); });
        let next = listed ? { monster: listed, source: list.length > 1 ? "config list" : "config" } : (list.length === 1 ? { monster: list[0], source: "config" } : null);
        if (!next) next = fromProgression();
        if (!next) next = { monster: config.targeting.fallback, source: "fallback" };

        // The guide may not be ready right after login: retry soon instead of waiting minutes.
        tgt.nextPickAt = now + (next.source === "fallback" ? 30 * 1000 : config.targeting.refreshMs);

        if (!tgt.farm || tgt.farm.monster !== next.monster || srcKind(tgt.farm) !== srcKind(next)) {
            util.log("target", "farm target: " + next.monster + " (" + next.source + ")", "yellow");
        }
        tgt.farm = next;
        return tgt.farm;
    }

    function farmList(override) {
        return override ? (Array.isArray(override) ? override.slice() : [override]) : [];
    }
    function farmBlocked(m) {
        return tgt.crowdedUntil[m] > Date.now() || tgt.recentDeath(m) || tgt.allSpotsTaken(m);
    }

    Object.assign(tgt, {
        objector: objector,
        lastingObjector: lastingObjector,
        isTeamSafe: isTeamSafe,
        whyUnsafe: whyUnsafe,
        calcXp: calcXp,
        walkable: walkable,
        teamXpRanking: teamXpRanking,
        fromProgression: fromProgression,
        eventMonsters: eventMonsters,
        srcKind: srcKind,
        currentFarm: currentFarm,
        farmList: farmList,
        farmBlocked: farmBlocked,
    });
};
