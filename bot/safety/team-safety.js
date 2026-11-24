// =====================================================================
// safety/team-safety.js - the safety model: our own and the team's verdict on a monster kind (team model: burst, sustain, pulls), packs, aggressive kinds, solo routes.
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const comms = deps.comms;
    const cfg = config.targeting;
    const ts = cfg.teamSafety || {};
    const lcfg = cfg.live || {};
    const icfg = cfg.isolation || {};

    // Monsters our own guide calls safe (trials included) and sure (no mere trial),
    // or null when the guide has no route data.
    function ownSafe(advice) {
        const routes = advice && advice.routes;
        if (!Array.isArray(routes)) return null;
        const safe = routes.filter(function (r) { return r && r.safe; });
        return {
            listed: new Set(routes.filter(Boolean).map(function (r) { return r.monster; })),
            safe: new Set(safe.map(function (r) { return r.monster; })),
            sure: new Set(safe.filter(function (r) { return !r.trial || r.proven; }).map(function (r) { return r.monster; })),
        };
    }

    // Monsters the guide doesn't list at all (e.g. goos once we outgrew them) are not
    // "unsafe", just unknown: harmless if every fighter survives 20+ of their hits
    // (team stats from bot_team_stats, the game's damage formula).
    // attack (optional): a live monster's real attack instead of the level-1 value.
    // n (optional, 2026-11-22): how many come at once - above 3 the hits count with the full
    // mobbing multiplier (util.mobbing): nothing is harmless in a mob.
    function harmless(monster, attack, n) {
        const m = G.monsters[monster];
        if (!m || m.cooperative || (m.abilities && Object.keys(m.abilities).length)) return false;
        const team = deps.teamStats ? deps.teamStats.teamStats() : [util.combatStats()];
        const att = attack || m.attack || 0;
        const mob = (n || 1) > 3 ? util.mobCap(att) : 1;
        return team.every(function (f) {
            // Pure damage ignores armor and resistance (2026-11-22 review: booboos hit "pure" and counted as reduced).
            return f.max_hp >= 20 * att * mob * 1.1 * util.hitMultiplier(f, m.damage_type, m) * util.hitFactor(monster);
        });
    }

    function shareSafe() {
        if (!party.isMember || !comms || Date.now() - tgt.lastReport < 60 * 1000) return;
        tgt.lastReport = Date.now();
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        if (own) comms.send(config.leader, "safe", { listed: Array.from(own.listed), safe: Array.from(own.safe), sure: Array.from(own.sure) });
    }
    function teamModelOn() {
        return !!ts.enabled && party.enabled && !party.isMember;
    }
    // Aggressive monsters packed tightly (spawn area per monster below ts.denseArea px²)
    // all come at once – e.g. 5 vampire rats in a 150x195 box at the level1 entrance
    // wiped the team in seconds (2026-11-16). Largest such pack on any map, else 0.
    function densePack(monster) {
        let most = 0;
        Object.keys(G.maps).forEach(function (mapName) {
            const map = G.maps[mapName];
            if (map.ignore || map.instance) return;
            (map.monsters || []).forEach(function (pack) {
                if (pack.type !== monster || !pack.count) return;
                const boxes = util.spawnBoxes(pack);
                boxes.forEach(function (b) {
                    const area = Math.abs((b[2] - b[0]) * (b[3] - b[1]));
                    if (area / pack.count < (ts.denseArea || 15000)) most = Math.max(most, pack.count);
                });
            });
        });
        return most;
    }

    // HP per second from drinking a potion on every cooldown.
    // Share of the potion cooldowns left for HP potions when we burn mpPerSec mana (plus the
    // attacks' own MP cost) beyond the natural regeneration.
    function hpPotionShare(mpPerSec, me) {
        const cd = ((G.skills.use_mp && G.skills.use_mp.cooldown) || 2000) / 1000;
        const mpName = util.potionNames(config.potions).mp;
        const mpGives = ((G.items[mpName] && G.items[mpName].gives) || []).find(function (x) { return x[0] === "mp"; });
        const perSec = (mpGives ? mpGives[1] : 300) / cd;
        const need = Math.max(0, mpPerSec + (me.mp_cost || character.mp_cost || 0) * (me.frequency || 1) - (character.mp_regen || 0));
        return Math.max(0, 1 - need / Math.max(1, perSec));
    }
    function potionHps() {
        const cd = ((G.skills.use_hp && G.skills.use_hp.cooldown) || 2000) / 1000;
        const potName = util.potionNames(config.potions).hp;
        const potGives = ((G.items[potName] && G.items[potName].gives) || []).find(function (x) { return x[0] === "hp"; });
        return (potGives ? potGives[1] : 200) / cd;
    }

    // `live` (optional): a monster entity – its real attack/frequency (higher levels hit
    // harder) replace the base values from G.monsters.
    // opts.pull: check this many at once (the pack check below) instead of the usual count.
    function teamVerdict(monster, live, opts) {
        const base = G.monsters[monster];
        const m = base && live ? Object.assign({}, base, { attack: live.attack || base.attack, frequency: live.frequency || base.frequency }) : base;
        if (!m || m.cooperative) return { ok: false, why: "no data / cooperative" };
        const odd = Object.keys(m.abilities || {}).filter(function (a) { return !(ts.abilities || []).includes(a); });
        if (odd.length) return { ok: false, why: "abilities: " + odd.join(", ") };
        const team = deps.teamStats ? deps.teamStats.teamStats() : [util.combatStats()];
        const expected = config.team.fighters.filter(function (f) { return f === character.name || party.inParty(f); }).length;
        if (team.length < expected) return { ok: false, why: "waiting for the team's stats" };
        // No tank class in the party (2026-11-22): whoever pulls - we, the leader - takes the hits in the
        // model instead of refusing every spot ("no tank in the party").
        const tank = team.filter(function (f) { return (ts.tankClasses || []).includes(f.ctype); })
            .sort(function (a, b) { return b.max_hp - a.max_hp; })[0] ||
            team.find(function (f) { return f.name === character.name; }) || team[0];
        if (!tank) return { ok: false, why: "no team stats" };
        const hitOn = function (f) {
            return (m.attack || 0) * 1.1 * util.hitMultiplier(f, m.damage_type, m) * util.hitFactor(monster);
        };
        // Monsters we pull one at a time (isolation) come as one plus a possible add
        // (pullLone) – a level-12 White Wolf failed "5.1 volleys of 3" though we never pull
        // three (2026-11-17). Dense packs still count whole.
        const lonePull = icfg.enabled && joinsFights(m) && !(opts && opts.pull);
        // Passive monsters (aggro and rage below the isolation limits) come one at a time (2026-11-21: the
        // level-26 CGoos, aggro 0.1, failed as "2 at once" by 1 % and the team skipped them all).
        const passive = (m.aggro || 0) < (icfg.minAggro || 0.3) && (m.rage || 0) < (icfg.minRage || 0.3);
        const pull = opts && opts.pull ? opts.pull : (m.aggro || 0) >= 1
            ? Math.max(lonePull ? (ts.pullLone || 2) : (ts.pullAggressive || 3), densePack(monster))
            : passive ? (ts.pullPassive || 1) : (ts.pull || 2);
        // Fear on the tank (2026-11-22, server rule): more of one damage type on it than its courage for that
        // type cuts its attack to 60/40/20 % (members report their courage with their stats).
        const dtype = m.damage_type || "physical";
        const tankCourage = dtype === "pure" ? tank.pcourage : dtype === "magical" ? tank.mcourage : tank.courage;
        const fearOver = typeof tankCourage === "number" ? Math.max(0, pull - tankCourage) : 0;
        const tankFear = util.fearMult(fearOver);
        // Kill time of the whole pull (for the mobbing combo) and of the fight below.
        const teamDps = team.reduce(function (s, f) {
            if ((f.heal || 0) > 0) return s; // a healer's actions are counted as healing above
            return s + (f.attack || 0) * (f === tank ? tankFear : 1) * (f.frequency || 1) * util.hitMultiplier(m, f.damage_type, f);
        }, 0);
        const monsterHp = (live && (live.hp || live.max_hp)) || m.hp || 0;
        // Mobbing (2026-11-22): more than 3 on the tank multiply every hit (util.mobbing) - the
        // volley check with the highest multiplier the fight reaches, the rates with its average.
        const mob = util.mobbing(m.attack, pull, pull * (m.frequency || 1), monsterHp * pull / Math.max(1, teamDps));
        const volley = hitOn(tank) * pull * mob.peak;
        // Healing per second from the party: every fighter with a heal stat (a priest today;
        // no class names - player request 2026-11-17).
        const healing = team.reduce(function (s, f) { return s + ((f.heal || 0) > 0 ? f.heal * (f.frequency || 1) : 0); }, 0);
        // Volleys the tank survives, with what the healers heal between two volleys (none
        // solo): 3 level-1 moles failed "5.9 volleys (need 6)" though the priest heals all
        // along (player idea 2026-11-17).
        const healedPerVolley = healing / (m.frequency || 1);
        const netVolley = volley - healedPerVolley;
        const tankHits = netVolley <= 0 ? Infinity : tank.max_hp / netVolley;
        const mobWhy = (mob.peak > 1 ? ", mobbing up to " + mob.peak.toFixed(1) + "x" : "") + (fearOver ? ", " + tank.name + " scared (attack x" + tankFear + ")" : "");
        if (tankHits < (ts.tankHits || 6)) return { ok: false, why: tank.name + " survives " + tankHits.toFixed(1) + " volleys of " + pull + (healing ? " with healing" : "") + mobWhy + " (need " + (ts.tankHits || 6) + ")" };
        const incoming = hitOn(tank) * pull * mob.avg * (m.frequency || 1);
        if (incoming > healing * (ts.healCover || 1.5)) return { ok: false, why: Math.round(incoming) + " dmg/s on " + tank.name + mobWhy + " vs " + Math.round(healing) + " healing/s" };
        // The whole fight, not only its rate: what heals and potions don't cover is lost for
        // as long as the kill takes (a level-12 White Wolf has 312k HP). Lone pulls
        // (isolation) start with one monster; the volley check above keeps the margin for adds.
        const fightPull = lonePull ? 1 : pull;
        const killSec = monsterHp * fightPull / Math.max(1, teamDps);
        const lost = Math.max(0, hitOn(tank) * fightPull * (fightPull > 3 ? mob.avg : 1) * (m.frequency || 1) - healing - potionHps()) * killSec;
        if (lost > tank.max_hp * (ts.fightHpUse || 0.5)) {
            return { ok: false, why: tank.name + " would lose " + Math.round(lost) + " HP over ~" + Math.round(killSec) + " s (max " + Math.round(tank.max_hp * (ts.fightHpUse || 0.5)) + ")" };
        }
        for (const f of team) {
            if (f === tank) continue;
            const hits = f.max_hp / Math.max(1, hitOn(f));
            if (hits < (ts.otherHits || 3)) return { ok: false, why: f.name + " survives " + hits.toFixed(1) + " hits (need " + (ts.otherHits || 3) + ")" };
        }
        return { ok: true, why: tank.name + " tanks " + pull + " (" + tankHits.toFixed(1) + " volleys, " + Math.round(incoming) + " dmg/s vs " + Math.round(healing) + " healing/s" + mobWhy + ")" };
    }
    function soloRouteSafe(monster) {
        if (party.enabled || cfg.soloOwnCheck === false) return false;
        const c = tgt.soloSafeCache[monster];
        if (c && Date.now() - c.at < 60 * 1000) return c.ok;
        const def = G.monsters[monster];
        let ok = false;
        if (def && !def.cooperative && !tgt.bossList().includes(monster) && !(def.abilities && Object.keys(def.abilities).length)) {
            const lc = cfg.live || {};
            const me = util.combatStats();
            const kite = util.kiteRisk(def, null, { speed: character.speed, range: character.range });
            const d = util.defenseVs(me, def.damage_type, def);
            const hit = (def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(monster) * kite;
            if (me.max_hp / Math.max(1, hit) >= (lc.ownHits || 6)) {
                const pull = (def.aggro || 0) >= 1 ? Math.max(1, densePack(monster)) : 1;
                let sustain = potionHps() * hpPotionShare(0, me);
                if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5;
                const myDef = util.defenseVs(def, me.damage_type, me);
                const fearMult = util.fearMult(Math.max(0, pull - util.courageOf(def.damage_type || "physical")));
                const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef));
                sustain += myDps * ((character.lifesteal || 0) / 100);
                const killSec = (def.hp || 1) * pull / myDps;
                const freq = def.frequency || 1;
                const mob = util.mobbing(def.attack || 0, pull, pull * freq, killSec);
                const incoming = hit * freq * pull * mob.avg;
                ok = Math.max(0, incoming - sustain) * killSec <= me.max_hp * (lc.soloHpUse || 0.5);
            }
        }
        tgt.soloSafeCache[monster] = { at: Date.now(), ok: ok };
        return ok;
    }
    function joinsFights(def) {
        return (def.aggro || 0) >= (icfg.minAggro || 0.3) && (def.rage || 0) >= (icfg.minRage || 0.3);
    }
    function packOk(e) {
        const def = G.monsters[e.mtype];
        const n = Math.max(icfg.packOf || ts.pullAggressive || 3, densePack(e.mtype));
        if (teamModelOn()) {
            const v = teamVerdict(e.mtype, e, { pull: n });
            // Why a pack is too much, once per type and level every 10 min (2026-11-17).
            const lk = e.mtype + ":" + (e.level || 1);
            // Right after a restart the members' stats are not in yet: no verdict, ask again soon.
            if (!v.ok && /waiting for the team/.test(v.why || "")) return null;
            if (!v.ok && Date.now() - (tgt.packLogged[lk] || 0) > 10 * 60 * 1000) {
                tgt.packLogged[lk] = Date.now();
                util.log("target", e.mtype + " level " + (e.level || 1) + " one at a time - " + n + " at once: " + v.why, "white");
            }
            return v.ok;
        }
        if (party.enabled) return false; // members: the leader decides who is pulled
        const v = packVerdict(e, n);
        const lk = e.mtype + ":" + (e.level || 1);
        if (!v.ok && Date.now() - (tgt.packLogged[lk] || 0) > 10 * 60 * 1000) {
            tgt.packLogged[lk] = Date.now();
            util.log("target", e.mtype + " level " + (e.level || 1) + " one at a time - " + n + " at once: " + v.why, "white");
        }
        return v.ok;
    }
    // Solo: can we take n of these at once - the burst (ownHits of their combined hits) AND the
    // whole fight: their damage per second (falling as they die, so on average (n+1)/2 of them)
    // against what we heal, for as long as killing all n takes, within live.soloHpUse of max HP.
    // The burst check alone let the warrior walk into the Boo Boo pack (2026-11-17: 10k HP
    // survive three hits easily, but five 8k-HP Boo Boos hit for minutes). Shared with the
    // Agitate decision (a pull is a pack on purpose). { ok, why, lost, killSec }
    // opts.mpPerSec (2026-11-18): mana we burn during the fight (e.g. Agitate) - MP potions
    // share the HP potions' cooldown, so that share of the cooldowns heals nothing. The bats
    // killed the warrior three times while the check counted every cooldown as an HP potion.
    // opts.splash: extra targets each hit also damages (kill time shrinks with the splash).
    function packVerdict(e, n, opts) {
        opts = opts || {};
        const def = G.monsters[e.mtype] || {};
        const me = util.combatStats();
        const d = util.defenseVs(me, def.damage_type, def);
        const att = e.attack || def.attack || 0;
        const freq = e.frequency || def.frequency || 1;
        // Kiteable for us (v1.227.1, util.kiteRisk: slower than us, shorter reach, no abilities): its hits count with the
        // residual risk only, like the solo check - two Huge Crabs (speed 8) standing together blocked the mage's spot
        // ("I survive 5.5 of their combined hits"). Melee fighters and the warrior's pulls are never kiteable (factor 1).
        const hit = att * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) *
            util.kiteRisk(def, e, { speed: character.speed, range: character.range });
        let sustain = potionHps() * hpPotionShare(opts.mpPerSec || 0, me);
        if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5;
        const myDef = util.defenseVs(def, me.damage_type, me);
        // Fear (server.js, 2026-11-22): more attackers of one damage type than our courage for it cut our
        // attack to 60/40/20 % (and our speed by 20/40/70+). 3 booboos (pure courage 2) scared the warrior,
        // the fight took longer and he died. Counted only when the pull itself goes over our courage.
        const over = Math.max(0, n - util.courageOf(def.damage_type || "physical"));
        const fearMult = util.fearMult(over);
        const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef) * (1 + 0.7 * Math.min(opts.splash || 0, Math.max(0, n - 1))));
        sustain += myDps * ((character.lifesteal || 0) / 100);
        const killSec = (e.max_hp || def.hp || 1) * n / myDps;
        // Mobbing (2026-11-22): while more than 3 of them are alive every hit is multiplied (util.mobbing).
        // Those on their way don't hit - opts.hitters caps how many stand on us at once (default all).
        // The burst check uses the highest multiplier the fight reaches; the HP loss the average over
        // the mobbed part of the fight (the first (n-3)/n of it - after that 3 are left).
        const hitters = Math.min(n, opts.hitters || n);
        const mobSec = n > 3 ? killSec * (n - 3) / n : 0;
        const mob = util.mobbing(att, n, hitters * freq, mobSec);
        const mobShare = n > 3 ? (n - 3) / n : 0;
        const hits = me.max_hp / Math.max(1, hit * hitters * mob.peak);
        const mobWhy = mob.peak > 1 ? ", mobbing up to " + mob.peak.toFixed(1) + "x" : "";
        if (hits < (lcfg.ownHits || 6)) return { ok: false, why: "I survive " + hits.toFixed(1) + " of their combined hits" + mobWhy + " (need " + (lcfg.ownHits || 6) + ")" };
        const incoming = hit * freq * Math.min(hitters, (n + 1) / 2) * (mobShare * mob.avg + (1 - mobShare));
        const lost = Math.max(0, incoming - sustain) * killSec;
        const budget = me.max_hp * (lcfg.soloHpUse || 0.5);
        const fearWhy = over ? ", scared (attack x" + fearMult + ")" : "";
        return lost <= budget ? { ok: true, lost: lost, killSec: killSec, mob: mob.peak }
            : { ok: false, lost: lost, killSec: killSec, mob: mob.peak, why: Math.round(incoming) + " dmg/s" + mobWhy + fearWhy + " vs " + Math.round(sustain) + " healed/s for ~" +
                Math.round(killSec) + " s: I'd lose " + Math.round(lost) + " HP (max " + Math.round(budget) + ")" };
    }
    function aggressive(e) {
        const def = e && G.monsters[e.mtype];
        if (!def || !joinsFights(def)) return false;
        const now = Date.now();
        const k = e.mtype + ":" + Math.round(e.attack || def.attack || 0);
        const c = tgt.harmlessSeen[k];
        // A dense spawn comes as a whole - harmless only if it stays harmless as a mob (2026-11-22).
        if (!c || now - c.at > 30 * 1000) tgt.harmlessSeen[k] = { ok: harmless(e.mtype, e.attack, densePack(e.mtype)), at: now };
        if (tgt.harmlessSeen[k].ok) return false;
        const pk = e.mtype + ":" + (e.level || 1);
        const p = tgt.packSeen[pk];
        if (!p || now - p.at > 30 * 1000) {
            const r = packOk(e);
            // null = unknown yet (team stats missing): treated as too much, checked again in 5 s
            tgt.packSeen[pk] = { ok: r === true, at: r === null ? now - 25 * 1000 : now };
        }
        return !tgt.packSeen[pk].ok;
    }
    // n of this kind at once: the team model (leader), a member trusting its leader, or our own pack check (solo, or
    // a detached member - 2026-11-22: the warrior ran ahead into the 5-booboo spawn).
    function pullVerdict(type, strongest, n) {
        if (teamModelOn()) return teamVerdict(type, strongest, { pull: n });
        if (party.enabled && party.isMember && !party.detached()) return { ok: true };
        return packVerdict(strongest, n);
    }

    // Leader command "/safety [map]": every monster of the map (default: ours) with each
    // member's own guide verdict and the team model's verdict – to see why a spot is closed.
    function safetyReport(mapName) {
        const mapId = (mapName || "").trim() || character.map;
        const map = G.maps[mapId];
        if (!map) { util.log("safety", "unknown map " + mapId, "orange"); return; }
        let own = null;
        try { own = ownSafe(get_progression()); } catch (e) { /* guide not ready */ }
        const types = Array.from(new Set((map.monsters || []).map(function (p) { return p.type; }))).filter(function (t) { return G.monsters[t]; });
        util.log("safety", mapId + ": " + types.length + " monster types" + (ts.enabled ? "" : " (team model is off)"), "yellow");
        types.forEach(function (t) {
            const members = [];
            if (own) members.push(character.name + ":" + (own.safe.has(t) ? (own.sure.has(t) ? "safe" : "trial") : own.listed.has(t) ? "UNSAFE" : "?"));
            Object.keys(tgt.reports).forEach(function (n) {
                const r = tgt.reports[n];
                if (!party.inParty(n)) return;
                members.push(n + ":" + (r.safe.includes(t) ? (r.sure.includes(t) ? "safe" : "trial") : r.listed && r.listed.includes(t) ? "UNSAFE" : "?"));
            });
            const v = teamVerdict(t);
            util.log("safety", t + " | " + members.join(" ") + " | team: " + (v.ok ? "OK - " : "no - ") + v.why, v.ok ? "green" : "white");
            // Its rage zones (2026-11-22): the whole spawn at once, as the bot decides there (level 1 stats here).
            tgt.rageZones(mapId).filter(function (z) { return z.type === t; }).forEach(function (z) {
                const rv = teamVerdict(t, null, { pull: z.count });
                util.log("safety", "  " + t + " rage zone (" + z.count + " at once): " + (rv.ok ? "OK - " : "no - ") + rv.why, rv.ok ? "green" : "orange");
            });
        });
        // Learned hit factors (real / predicted damage per hit, 2026-11-22), strongest first.
        const hf = util.hitFactors().slice(0, 12).map(function (x) { return x[0] + " " + x[1].toFixed(2) + " (" + x[2] + " hits)"; });
        if (hf.length) util.log("safety", "hit factors: " + hf.join(", "), "white");
    }

    Object.assign(tgt, {
        ownSafe: ownSafe,
        harmless: harmless,
        shareSafe: shareSafe,
        teamModelOn: teamModelOn,
        densePack: densePack,
        hpPotionShare: hpPotionShare,
        potionHps: potionHps,
        teamVerdict: teamVerdict,
        soloRouteSafe: soloRouteSafe,
        joinsFights: joinsFights,
        packOk: packOk,
        packVerdict: packVerdict,
        aggressive: aggressive,
        pullVerdict: pullVerdict,
        safetyReport: safetyReport,
    });
};
