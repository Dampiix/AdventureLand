// =====================================================================
// safety/live-safety.js - live checks on the monster in front of us (its real level and stats), the mobbing guard, live danger, doomed targets (dying anyway, in-flight hits).
// Part of bot_targeting (module plan, stage 4b): moved verbatim from the old single-file core/targeting.js. The parts
// share one internal state (tgt: the farm target, caches, spot and gate state) and call each other through tgt; outside
// dependencies come in deps (game, util, config, comms, party, events, hunts, drops, cave, teamStats).
// =====================================================================

module.exports = function install(tgt, deps) {
    const config = deps.config;
    const util = deps.util;
    const party = deps.party;
    const cfg = config.targeting;
    const lcfg = cfg.live || {};
    const mcfg = cfg.mobbing || {};
    const PAGE = parent;

    function liveSafe(e) {
        if (!e || (e.level || 1) < (lcfg.fromLevel || 2)) return true;
        const def = G.monsters[e.mtype];
        if (!def || def.cooperative) return true;
        // Bosses are judged by the events boss check with their real level (player decision
        // 2026-11-21): this farm check took a level-8 Dracul for a pack of 2-3 ("VizWar would lose
        // 157636 HP over ~1343 s") while the boss check rightly said 738 damage/s vs 1158 healing/s.
        // Who may open alone is targeting.holdBoss (events.soloOk).
        if (tgt.bossList().includes(e.mtype)) return true;
        const now = Date.now();
        const c = tgt.liveChecked[e.id];
        if (c && c.level === e.level && now - c.at < 30 * 1000) return c.ok;
        // Harmless even at its real attack (every fighter survives 20+ hits, e.g. a level-7
        // armadillo with 27 attack): no further check.
        const team = deps.teamStats ? deps.teamStats.teamStats() : [];
        const fighters = team.length ? team : [util.combatStats()];
        const harmlessNow = !(def.abilities && Object.keys(def.abilities).length) && fighters.every(function (f) {
            return f.max_hp >= 20 * (e.attack || def.attack || 0) * 1.1 * util.hitMultiplier(f, def.damage_type, def) * util.hitFactor(e.mtype);
        });
        if (harmlessNow) {
            tgt.liveChecked[e.id] = { level: e.level, ok: true, at: now };
            return true;
        }
        const ratioCheck = function (tolerance) {
            const ratio = ((e.attack || def.attack) * (e.frequency || def.frequency || 1)) / Math.max(1, def.attack * (def.frequency || 1));
            return ratio <= tolerance ? { ok: true } : { ok: false, why: "hits " + ratio.toFixed(1) + "x as hard as at level 1" };
        };
        // Members (and solo fighters) pulling their own target: we must survive ownHits of its
        // real hits ourselves (the warrior shrugs off a level-7 CGoo, a priest may not).
        // Kiteable for us (util.kiteRisk): its hits count with the residual risk only (2026-11-21).
        const kite = util.kiteRisk(def, e, { speed: character.speed, range: character.range });
        const ownCheck = function () {
            const me = util.combatStats();
            const d = util.defenseVs(me, def.damage_type, def);
            const hits = me.max_hp / Math.max(1, (e.attack || def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) * kite);
            return hits >= (lcfg.ownHits || 6) ? { ok: true } : { ok: false, why: "I survive " + hits.toFixed(1) + " of its hits (need " + (lcfg.ownHits || 6) + ")" };
        };
        // Alone (no party): the fight must be survivable over its whole length – the
        // monster's real damage per second against what we heal ourselves (a potion per
        // cooldown, a priest's own heals, lifesteal), for as long as it takes us to kill it.
        // A level-12 CGoo (800 attack, 1.6 hits/s) killed the solo warrior though he
        // survives 12 of its single hits (2026-11-16).
        const soloCheck = function () {
            const first = ownCheck();
            if (!first.ok) return first;
            const me = util.combatStats();
            const d = util.defenseVs(me, def.damage_type, def);
            const pull = (def.aggro || 0) >= 1 ? Math.max(1, tgt.densePack(e.mtype)) : 1;
            // The MP potions share the cooldown (2026-11-22 review: packVerdict had this fix, soloCheck not).
            let sustain = tgt.potionHps() * tgt.hpPotionShare(0, me);
            if (me.ctype === "priest") sustain += (me.heal || me.attack || 0) * (me.frequency || 1) * 0.5; // half its actions heal
            const myDef = util.defenseVs(def, me.damage_type, me);
            const over = Math.max(0, pull - util.courageOf(def.damage_type || "physical")); // fear (see packVerdict)
            const fearMult = util.fearMult(over);
            const myDps = Math.max(1, (me.attack || 0) * fearMult * (me.frequency || 1) * util.damageMultiplier(myDef));
            sustain += myDps * ((character.lifesteal || 0) / 100);
            const killSec = (e.hp || e.max_hp || def.hp) * pull / myDps;
            // A dense aggressive pack of more than 3 mobs us (2026-11-22): its average multiplier over the fight.
            const freq = e.frequency || def.frequency || 1;
            const mob = util.mobbing(e.attack || def.attack || 0, pull, pull * freq, killSec);
            const incoming = (e.attack || def.attack || 0) * 1.1 * util.damageMultiplier(d) * util.hitFactor(e.mtype) * freq * pull * kite * mob.avg;
            const lost = Math.max(0, incoming - sustain) * killSec;
            const budget = me.max_hp * (lcfg.soloHpUse || 0.5);
            tgt.soloCostById[e.id] = lost;
            return lost <= budget ? { ok: true }
                : { ok: false, why: Math.round(incoming) + " dmg/s vs " + Math.round(sustain) + " healed/s for ~" + Math.round(killSec) +
                    " s: I'd lose " + Math.round(lost) + " HP (max " + Math.round(budget) + ")" };
        };
        let v = tgt.teamModelOn() ? tgt.teamVerdict(e.mtype, e) : (party.enabled ? ownCheck() : soloCheck());
        // Team stats not in yet (right after a restart, or a member was away): the level-1
        // monster passed the team check already, so only a big level jump is refused.
        if (!v.ok && /waiting for the team/.test(v.why || "")) v = ratioCheck(lcfg.waitTolerance || 2.5);
        tgt.liveChecked[e.id] = { level: e.level, ok: v.ok, at: now };
        const k = e.mtype + ":" + e.level;
        if (!v.ok && now - (tgt.liveLogged[k] || 0) > 10 * 60 * 1000) {
            tgt.liveLogged[k] = now;
            util.log("target", "skipping " + e.mtype + " level " + e.level + " (attack " + Math.round(e.attack || 0) + "): " + v.why, "orange");
        }
        return v.ok;
    }

    // Cooperative monsters (event bosses, Phoenix, ...) reward every contributor,
    // so fighting them alongside other players is fine.
    function isCoop(t) {
        const def = G.monsters[t.mtype];
        return !!(def && def.cooperative);
    }
    // Dies within `hits` hits of our strongest fighter (or the damage on its way kills it already). For the luck catch
    // (2026-11-22, player decision): drops are rolled with the luck of the character the monster TARGETS when it dies.
    function diesSoon(m, hits) {
        if (!m || m.dead) return false;
        if (doomed(m)) return true;
        const def = G.monsters[m.mtype] || {};
        const team = deps.teamStats ? deps.teamStats.teamStats() : [util.combatStats()];
        let best = 0;
        team.forEach(function (f) {
            const hit = (f.attack || 0) * util.hitMultiplier(def, f.damage_type, f);
            if (hit > best) best = hit;
        });
        return best > 0 && (m.hp || 0) <= best * (hits || 1);
    }
    // A party member that catches dying monsters for its luck (Absorb Sins, classes.priest.luckCatch) within `range` px
    // of p (default: us), or null. Any class that has the skill counts.
    function luckCatcherNear(p, range) {
        const lc = ((config.classes || {}).priest || {}).luckCatch || {};
        if (!lc.enabled || !party.enabled) return null;
        const at = p ? util.xy(p) : util.xy(character);
        const skillClasses = (G.skills.absorb && G.skills.absorb.class) || [];
        const names = party.memberNames();
        for (const n of names) {
            const pl = n === character.name ? character : get_player(n);
            if (!pl || pl.rip || !skillClasses.includes(pl.ctype)) continue;
            if (pl.level < ((G.skills.absorb && G.skills.absorb.level) || 0)) continue;
            const q = util.xy(pl);
            if (Math.hypot(q.x - at.x, q.y - at.y) <= (range || 400)) return pl;
        }
        return null;
    }
    // Will the damage already on its way kill this monster? (armor/resistance via util.damageMultiplier)
    function doomed(t) {
        const fl = PAGE.__botInflight;
        if (!t || !fl) return false;
        const def = G.monsters[t.mtype] || {};
        if (t.avoidance || def.avoidance) return false;
        const now = Date.now();
        let sum = 0;
        for (const pid in fl) {
            const p = fl[pid];
            if (p.until < now) { delete fl[pid]; continue; }
            if (p.target !== t.id) continue;
            const a = p.attacker === character.id ? character : (PAGE.entities && PAGE.entities[p.attacker]);
            const mh = a && a.slots && a.slots.mainhand && G.items[a.slots.mainhand.name];
            const dtype = (p.type !== "attack" && G.skills[p.type] && G.skills[p.type].damage_type) ||
                (mh && mh.damage_type) || (a && G.classes[a.ctype] && G.classes[a.ctype].damage_type) || "physical";
            if (dtype === "magical" && (t.reflection || def.reflection)) continue;
            if (dtype === "physical" && (t.evasion || def.evasion)) continue;
            const defense = dtype === "magical" ? (t.resistance != null ? t.resistance : (def.resistance || 0)) : (t.armor != null ? t.armor : (def.armor || 0));
            sum += def["1hp"] ? 1 : p.damage * util.damageMultiplier(defense) * 0.9;
            if (sum >= t.hp) return true;
        }
        return false;
    }
    function skipDoomed(t) {
        if (!doomed(t)) return false;
        PAGE.__botDoomedSkips = (PAGE.__botDoomedSkips || 0) + 1;
        return true;
    }
    function onFighter(name) {
        return Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === name;
        }).length;
    }
    function mobGuard(t) {
        if (mcfg.enabled === false || mcfg.guard === false || !t || t.target) return false;
        if (util.mobCap(t.attack || (G.monsters[t.mtype] || {}).attack) <= (mcfg.guardMinMult || 1.25)) return false;
        const names = [character.name].concat(party.enabled ? party.memberNames() : []);
        const most = names.reduce(function (best, n) {
            const c = onFighter(n);
            return c > best.c ? { n: n, c: c } : best;
        }, { n: null, c: 0 });
        if (most.c < (mcfg.maxOnOne || 3)) return false;
        if (Date.now() - tgt.mobLogged > 60 * 1000) {
            tgt.mobLogged = Date.now();
            util.log("target", "not pulling " + t.mtype + ": " + most.c + " already on " + most.n + " (a 4th starts the mobbing bonus)", "white");
        }
        return true;
    }
    // What the monsters on us deal right now, with the live mobbing combo (util.mobNow) carried
    // mobbing.projectSec ahead: { dps, sustain, ttd (s until dead, Infinity if we gain), onMe, mult }.
    function liveDanger() {
        const me = character;
        const on = Object.values(parent.entities || {}).filter(function (e) {
            return e && e.type === "monster" && !e.dead && e.target === me.name;
        });
        if (!on.length) return { dps: 0, sustain: 0, ttd: Infinity, onMe: 0, mult: 1 };
        const now = util.mobNow(0);
        let dps = 0, hps = 0, maxMult = 1;
        on.forEach(function (e) {
            const def = G.monsters[e.mtype] || {};
            const reach = (e.range || def.range || 30) + 60;
            if (util.distanceTo(e) > reach) return; // still on its way - no hits yet
            hps += e.frequency || def.frequency || 1;
        });
        // The combo the next projectSec of hits will reach (only while more than 3 target us).
        const combo = on.length > 3 ? Math.max(now.combo, 1) + Math.round(hps * (mcfg.projectSec || 4)) : 0;
        on.forEach(function (e) {
            const def = G.monsters[e.mtype] || {};
            if (util.distanceTo(e) > (e.range || def.range || 30) + 60) return;
            const att = e.attack || def.attack || 0;
            const mult = combo ? Math.min(combo > 10 ? combo / 4 : 2, util.mobCap(att)) : 1;
            maxMult = Math.max(maxMult, mult);
            dps += util.predictedHit(e, me) * util.hitFactor(e.mtype) * mult * (e.frequency || def.frequency || 1);
        });
        // Party (2026-11-22): every living healer within its range of us heals too - its heal per second
        // (reported stats) x mobbing.healShare, as it heals others now and then.
        let healing = 0;
        if (party.enabled) {
            const team = deps.teamStats ? deps.teamStats.teamStats() : [];
            team.forEach(function (f) {
                if (!f || !(f.heal > 0) || f.name === me.name) return;
                const p = get_player(f.name);
                if (!p || p.rip || util.distanceTo(p) > (f.range || p.range || 0) + 20) return;
                healing += f.heal * (f.frequency || 1) * (mcfg.healShare || 0.8);
            });
        }
        const sustain = tgt.potionHps() + healing;
        const net = dps - sustain;
        return { dps: dps, sustain: sustain, healing: healing, ttd: net > 0 ? me.hp / net : Infinity, onMe: on.length, mult: maxMult };
    }

    Object.assign(tgt, {
        liveSafe: liveSafe,
        isCoop: isCoop,
        diesSoon: diesSoon,
        luckCatcherNear: luckCatcherNear,
        doomed: doomed,
        skipDoomed: skipDoomed,
        onFighter: onFighter,
        mobGuard: mobGuard,
        liveDanger: liveDanger,
    });
};
