// =====================================================================
// bot_targeting – WHAT to farm and WHICH monster to hit next.
//
// Farm choice, in order:
//   1. a live event / world boss (bot_events)
//   2. an open, safe Monster Hunt of any party fighter (bot_hunts)
//   3. per-character or global farm setting (config.characters[name].farm,
//      config.targeting.farm)
//   4. a drop route for an item the merchant is missing (bot_drops)
//   5. the game's progression guide: get_progression().choices
//      (top safe farm routes for this character's current gear)
//   6. config.targeting.fallback
// Party members use the leader's farm target instead.
//
// Target choice:
//   leader / solo: current target > monster attacking a party member
//                  > nearest free farm monster
//   party member:  current target > monster attacking a party member
//                  > own monster when the farm target is easy (party.spread)
//                  > the leader's target – otherwise members never open fights,
//                  so the tank keeps the aggro
// =====================================================================

module.exports = function createTargeting(ctx) {
    const config = ctx.config;
    const util = ctx.util;
    const party = ctx.party;
    const cfg = config.targeting;
    let farm = null;
    let nextPickAt = 0;
    const crowdedUntil = {}; // monster -> timestamp: skip this guide choice until then
    let idleSince = 0;       // on the farm map without a free target since

    // ---- team safety ------------------------------------------------------------
    // The guide judges a route only for the character asking (the leader, usually
    // the tank). It also offers borderline routes as a careful "trial" and only
    // counts them as proven from fights it watched since CODE started – a restart
    // forgets that. So:
    //  - every member reports its "safe" monsters (trials included) and its "sure"
    //    ones (safe and not a mere trial),
    //  - the leader remembers the team's own experience (survives restarts): a
    //    monster farmed for 15+ minutes without anyone dying counts as proven,
    //    a death there wipes that,
    //  - a spot needs everyone's "safe", and everyone's "sure" or our own proof
    //    (config.targeting.avoidTrial).
    const comms = ctx.comms;
    const reports = {};   // member -> { safe, sure, at }
    let lastReport = 0;
    let lastSkipLog = "";

    const PROVEN_MS = 15 * 60 * 1000;
    const EXP_KEY = "dmpx_farm_experience:" + character.name;
    const experience = (function () { // monster -> { ms, at, bad }
        try { return get(EXP_KEY) || {}; } catch (e) { return {}; }
    })();
    let lastClock = 0;
    let lastSave = 0;

    function saveExperience() {
        try { set(EXP_KEY, experience); } catch (e) { /* storage unavailable */ }
    }
    function provenByUs(monster) {
        const e = experience[monster];
        return !!e && e.ms >= PROVEN_MS && Date.now() - e.at < 24 * 60 * 60 * 1000;
    }
    function recentDeath(monster) {
        const e = experience[monster];
        return !!e && !!e.bad && Date.now() - e.bad < 60 * 60 * 1000;
    }

    // Leader: count the time spent on the current farm target; a death wipes it.
    function clock() {
        const now = Date.now();
        const dt = lastClock ? Math.min(5000, now - lastClock) : 0;
        lastClock = now;
        if (party.isMember || !farm || !farm.monster || farm.any) return;
        const e = experience[farm.monster] || (experience[farm.monster] = { ms: 0, at: now });
        const dead = [character.name].concat(party.memberNames()).find(function (n) {
            const p = n === character.name ? character : get_player(n);
            return p && p.rip;
        });
        if (dead) {
            if (!(e.bad && now - e.bad < 60 * 1000)) {
                util.log("target", dead + " died while farming " + farm.monster + " - not counted as safe for an hour", "red");
                experience[farm.monster] = { ms: 0, at: now, bad: now };
                saveExperience();
                nextPickAt = 0;
            }
            return;
        }
        if (farm.map && character.map !== farm.map) return; // still travelling
        const before = e.ms;
        e.ms += dt;
        e.at = now;
        if (before < PROVEN_MS && e.ms >= PROVEN_MS) util.log("target", farm.monster + ": 15 min without deaths - counts as safe for the team", "green");
        if (now - lastSave > 60 * 1000) { lastSave = now; saveExperience(); }
    }

    if (comms) {
        comms.on("safe", function (data, from) {
            if (!config.characters[from]) return;
            reports[from] = { safe: data.safe || data.list || [], sure: data.sure || data.list || [], at: Date.now() };
            // Our current guide spot is not acceptable for this member: pick again right away.
            if (farm && String(farm.source).startsWith("guide") && objector(farm.monster, null)) nextPickAt = 0;
        });
    }

    // Monsters our own guide calls safe (trials included) and sure (no mere trial),
    // or null when the guide has no route data.
    function ownSafe(advice) {
        const routes = advice && advice.routes;
        if (!Array.isArray(routes)) return null;
        const safe = routes.filter(function (r) { return r && r.safe; });
        return {
            safe: new Set(safe.map(function (r) { return r.monster; })),
            sure: new Set(safe.filter(function (r) { return !r.trial || r.proven; }).map(function (r) { return r.monster; })),
        };
    }

    function shareSafe() {
        if (!party.isMember || !comms || Date.now() - lastReport < 60 * 1000) return;
        lastReport = Date.now();
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (own) comms.send(config.leader, "safe", { safe: Array.from(own.safe), sure: Array.from(own.sure) });
    }

    // Who (if anyone) is not safe at this monster.
    function objector(monster, own) {
        if (recentDeath(monster)) return "the team (recent death)";
        const proven = !cfg.avoidTrial || provenByUs(monster);
        if (own && (!own.safe.has(monster) || (!proven && !own.sure.has(monster)))) return character.name;
        const now = Date.now();
        return Object.keys(reports).find(function (name) {
            const r = reports[name];
            if (!party.inParty(name) || now - r.at > 3 * 60 * 1000) return false;
            return !r.safe.includes(monster) || (!proven && !r.sure.includes(monster));
        }) || null;
    }

    // For bot_hunts: is this monster safe for the whole team right now?
    function isTeamSafe(monster) {
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        return !!own && !objector(monster, own);
    }

    // The guide's farm choices (up to three safe routes, best first) that are safe
    // for the whole team, skipping monsters whose spot was recently found crowded.
    function fromProgression() {
        let list = [];
        try {
            const advice = get_progression();
            if (!advice) return null;
            const own = ownSafe(advice);
            const raw = (advice.choices || [])
                .filter(function (c) { return c.kind === "farm" && G.monsters[c.monster]; });
            list = raw
                .filter(function (c) { return !objector(c.monster, own); })
                .map(function (c) { return { monster: c.monster, map: c.map, source: "guide" }; });
            if (raw.length && list.length < raw.length) {
                // The guide's best pick is too risky for someone: say so once.
                const first = raw[0];
                const who = objector(first.monster, own);
                const msg = who ? first.monster + " is not safe for " + who + (list.length ? " - " + list[0].monster + " instead" : "") : "";
                if (msg && msg !== lastSkipLog) { lastSkipLog = msg; util.log("target", msg, "orange"); }
            }
            if (!list.length && Array.isArray(advice.routes)) {
                // None of the top three is safe for everyone: best other safe route.
                const seen = {};
                list = advice.routes
                    .filter(function (r) { return r && r.safe && G.monsters[r.monster] && !objector(r.monster, own); })
                    .sort(function (a, b) { return (b.xp || 0) - (a.xp || 0); })
                    .filter(function (r) { if (seen[r.monster]) return false; seen[r.monster] = true; return true; })
                    .slice(0, 3)
                    .map(function (r) { return { monster: r.monster, map: r.map, source: "guide, team-safe" }; });
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
        const free = list.find(function (c) { return !(crowdedUntil[c.monster] > now); });
        if (free) return free;
        // Every choice is crowded: take the one that frees up first.
        return list.slice().sort(function (a, b) { return crowdedUntil[a.monster] - crowdedUntil[b.monster]; })[0];
    }

    // Called by the fighter every combat tick. If we stand on the farm map for
    // a while without any free target (other players clear the spot), mark the
    // spot as crowded and move on to the guide's next choice (or the next drop route).
    function reportSearch(found) {
        const src = farm ? String(farm.source) : "";
        if (found || !farm || !(src.startsWith("guide") || src.startsWith("drop")) || character.map !== farm.map) {
            idleSince = 0;
            return;
        }
        const now = Date.now();
        if (!idleSince) idleSince = now;
        if (now - idleSince < cfg.crowdedAfterMs) return;
        crowdedUntil[farm.monster] = now + cfg.crowdedForMs;
        util.log("target", farm.monster + " spot looks crowded - trying another target for " + Math.round(cfg.crowdedForMs / 60000) + " min", "orange");
        idleSince = 0;
        nextPickAt = 0; // pick again right away
    }

    function currentFarm() {
        shareSafe(); // members: tell the leader where we can fight safely
        clock();     // leader: our own experience with the current farm target
        // Events and world bosses come first (bot_events; members get it from the leader).
        const ev = ctx.events ? ctx.events.current() : null;
        if (ev) {
            const next = ev.join
                ? { monster: null, any: true, source: "event " + ev.name }
                : { monster: ev.monster || ev.name, dest: ev.dest || ev.monster || ev.name, source: "event " + ev.name };
            if (!farm || farm.source !== next.source) util.log("target", "now: " + next.source, "yellow");
            farm = next;
            nextPickAt = 0;
            return farm;
        }

        const lead = party.leaderInfo();
        if (lead && lead.farm) {
            if (!farm || farm.monster !== lead.farm) util.log("target", "farm target: " + lead.farm + " (leader)", "yellow");
            farm = { monster: lead.farm, source: "leader" };
            nextPickAt = 0;
            return farm;
        }

        const own = config.characters[character.name] || {};
        const override = own.farm || config.targeting.farm;

        // An open, safe Monster Hunt beats both the guide and a configured farm target;
        // the configured target only replaces the guide's choice.
        const hunt = ctx.hunts ? ctx.hunts.target() : null;
        if (hunt) {
            if (!farm || farm.monster !== hunt.monster) util.log("target", "farm target: " + hunt.monster + " (" + hunt.source + ")", "yellow");
            farm = hunt;
            nextPickAt = 0; // re-evaluate the guide as soon as the hunt is over
            return farm;
        }

        const now = Date.now();

        // Items that can't be bought come before XP: the merchant reports what is
        // missing, the guide names the drop route (bot_drops).
        const drop = !override && ctx.drops ? ctx.drops.target(function (m) { return crowdedUntil[m] > now; }) : null;
        if (drop) {
            if (!farm || farm.monster !== drop.monster) util.log("target", "farm target: " + drop.monster + " (" + drop.source + ")", "yellow");
            farm = drop;
            nextPickAt = 0; // back to the guide as soon as the item is complete
            return farm;
        }

        if (farm && now < nextPickAt) return farm; // hunt/leader/drop targets reset nextPickAt to 0

        let next = override ? { monster: override, source: "config" } : fromProgression();
        if (!next) next = { monster: config.targeting.fallback, source: "fallback" };

        // The guide may not be ready right after login: retry soon instead of waiting minutes.
        nextPickAt = now + (next.source === "fallback" ? 30 * 1000 : config.targeting.refreshMs);

        if (!farm || farm.monster !== next.monster) {
            util.log("target", "farm target: " + next.monster + " (" + next.source + ")", "yellow");
        }
        farm = next;
        return farm;
    }

    function isOurs(name) {
        return name === character.name || party.inParty(name);
    }

    // A monster we can safely handle alone: dies in a few of our hits and barely
    // scratches us (config.party.spread).
    function isEasy(type) {
        const s = config.party.spread;
        const def = G.monsters[type];
        if (!s || !s.enabled || !def || def.cooperative) return false;
        return def.hp <= character.attack * s.maxHits && def.attack <= character.max_hp * s.maxDamageRatio;
    }

    // Cooperative monsters (event bosses, Phoenix, ...) reward every contributor,
    // so fighting them alongside other players is fine.
    function isCoop(t) {
        const def = G.monsters[t.mtype];
        return !!(def && def.cooperative);
    }

    // A target stays valid while it is visible, alive and not fighting someone else.
    function isValid(t) {
        if (!t || !t.visible || t.dead || t.type !== "monster") return false;
        if (t.target && !isOurs(t.target) && !isCoop(t)) return false;
        return true;
    }

    // Nearest monster attacking us or any party member (V1's party-aggro priority).
    function nearestPartyAttacker() {
        const names = party.memberNames();
        if (!names.includes(character.name)) names.push(character.name);
        let best = null;
        let bestDistance = Infinity;
        names.forEach(function (name) {
            const m = get_nearest_monster({ target: name });
            if (!m) return;
            const d = util.distanceTo(m);
            if (d < bestDistance) { best = m; bestDistance = d; }
        });
        return best;
    }

    function pick(farmTarget) {
        const current = get_targeted_monster();
        if (isValid(current)) return current;

        const attacker = nearestPartyAttacker();
        if (attacker) return attacker;

        if (party.isMember) {
            const lead = party.leaderInfo();
            // Easy farm targets (e.g. goos for a hunt): everyone fights its own monster,
            // as long as it stays close to the leader.
            const own = lead && lead.farm && isEasy(lead.farm) ? get_nearest_monster({ type: lead.farm, no_target: true }) : null;
            if (own) {
                const p = util.xy(own);
                if (Math.hypot(p.x - lead.x, p.y - lead.y) <= config.party.leash * 0.8) return own;
            }
            // Otherwise only assist the leader, never pull new monsters –
            // and never wander off to a farm spot of our own.
            const assist = lead && lead.target ? get_monster(lead.target) : null;
            return isValid(assist) && (assist.target || isCoop(assist)) ? assist : null;
        }

        if (farmTarget.any) {
            // Join event: anything in the event map is fair game.
            const m = get_nearest_monster({});
            return isValid(m) ? m : null;
        }
        const type = farmTarget.monster;
        if (G.monsters[type] && G.monsters[type].cooperative) {
            const boss = get_nearest_monster({ type: type });
            if (isValid(boss)) return boss;
        }
        return get_nearest_monster({ type: type, no_target: true });
    }

    return { currentFarm: currentFarm, pick: pick, isValid: isValid, reportSearch: reportSearch, isTeamSafe: isTeamSafe };
};
