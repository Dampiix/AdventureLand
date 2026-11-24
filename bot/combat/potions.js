// =====================================================================
// combat/potions.js - potions (HP, MP, the healer near, HP loss rate), the solo rest and the top-up before a pull.
// Part of bot_fighter (module plan, stage 5): moved verbatim from the old single-file core/fighter.js. The parts share
// one internal state (ftr: the farm target, walks, waits, the strike intent, chests) and call each other through ftr;
// outside dependencies come in deps (game, util, config, comms, bus, party, targeting, supply, events, cave, hunts,
// gear, teamStats, cls - the class module).
// =====================================================================

module.exports = function install(ftr, deps) {
    const config = deps.config;
    const util = deps.util;
    const targeting = deps.targeting;
    const party = deps.party;

    // HP and MP potions share one cooldown (2 s). Below the thresholds they are urgent; on
    // top of that a potion is drunk as soon as a whole one's worth is missing (combat.
    // potionWhenMissing) – waiting for 45 % let a solo warrior sink against the Phoenix,
    // one sip per dip below the line instead of one every cooldown (2026-11-16).
    function potionGives(kind) {
        const name = util.potionNames(config.potions)[kind];
        const g = G.items[name] && G.items[name].gives;
        const e = g && g.find(function (x) { return x[0] === kind; });
        return e ? e[1] : (kind === "hp" ? 200 : 300);
    }
    // A living priest in our party close by (or we are one): it heals, so potions are only
    // an emergency (combat.withHealer) – solo we drink on every cooldown.
    function healerNear() {
        if (character.ctype === "priest") return true;
        if (!party.enabled) return false;
        return party.memberNames().some(function (n) {
            if (n === character.name) return false;
            const p = get_player(n);
            return !!p && !p.rip && util.isHealer(p) && util.distanceTo(p) < 600;
        });
    }
    function hpLossRate() {
        const now = Date.now();
        ftr.hpTrail.push({ t: now, hp: character.hp });
        while (ftr.hpTrail.length && now - ftr.hpTrail[0].t > 3000) ftr.hpTrail.shift();
        const first = ftr.hpTrail[0];
        const secs = (now - first.t) / 1000;
        return secs > 0.5 ? Math.max(0, first.hp - character.hp) / secs / character.max_hp : 0;
    }
    function handlePotions() {
        const loss = hpLossRate();
        if (is_on_cooldown("use_hp")) return;
        // Emergency brake (after earthiverse's avoid_death, player decision 2026-11-21): when the next
        // hits of everything on us (max damage, fear-scaled) reach our HP, an HP potion now - with a
        // healer near too, and even while Town channels.
        const danger = util.incomingDamage();
        if (danger > 0 && danger >= character.hp * (config.combat.dangerShare || 1) && character.hp < character.max_hp) {
            use_skill("use_hp").catch(function () {});
            if (Date.now() - ftr.lastDangerLog > 30 * 1000) {
                ftr.lastDangerLog = Date.now();
                util.log("combat", "danger: next hits up to " + Math.round(danger) + " vs " + Math.round(character.hp) + " HP - potion", "orange");
            }
            return;
        }
        // No potion while Town channels (it would cancel the teleport) - unless HP is critical.
        if (util.townChannel() && util.hpRatio() >= (config.combat.hpCriticalBelow || 0.3)) return;
        // With a healer potions are only an emergency - unless we lose HP fast: Jr. took the
        // warrior from full to dead in 10 s next to the priest, 2 HP potions drunk (2026-11-18).
        // Then the solo rules apply (a potion on every cooldown when one is missing).
        const fast = loss >= ((config.combat.withHealer || {}).fastLossPerSec || 0.06);
        const c = healerNear() && !fast ? Object.assign({}, config.combat, config.combat.withHealer || {}) : config.combat;
        const hpMissing = character.max_hp - character.hp;
        const mpMissing = character.max_mp - character.mp;
        const hp = util.hpRatio(), mp = util.mpRatio();
        // Without MP there is no attack (and no skill): MP first unless HP is critical.
        const mpEmpty = character.mp < Math.max(1, character.mp_cost || 0) * 3;
        // A whole MP potion fits (player decision 2026-11-21): MP before the HP top-up while HP is above
        // combat.mpFirstAboveHp (65 %: well above the 50 % rest line) - the warrior's own attacks drain
        // ~10 MP/s, one potion every ~30 s keeps him full.
        const mpFits = mpMissing >= potionGives("mp");
        const mpFirst = hp >= (c.mpFirstAboveHp !== undefined ? c.mpFirstAboveHp : 0.65);
        // combat.hpWhenFits (player test 2026-11-21): an HP potion whenever a whole one fits, MP only in
        // the gaps (or when MP is nearly empty) - the solo warrior still fell below the 50 % rest line.
        // Off with a healer near (withHealer.potionWhenMissing false).
        const hpFirst = c.hpWhenFits && c.potionWhenMissing && hpMissing >= potionGives("hp");
        if (hp < (c.hpCriticalBelow || 0.3)) use_skill("use_hp").catch(function () {});
        else if (hpFirst && !mpEmpty) use_skill("use_hp").catch(function () {});
        else if (mpEmpty || ((mp < c.potionMpBelow || mpFits) && (mpFirst || c.hpWhenFits))) use_skill("use_mp").catch(function () {});
        else if (hp < c.potionHpBelow) use_skill("use_hp").catch(function () {});
        else if (mp < c.potionMpBelow) use_skill("use_mp").catch(function () {});
        else if (c.potionWhenMissing && hpMissing >= potionGives("hp")) use_skill("use_hp").catch(function () {});
        // MP has its own rule (combat.mpTopUp: share of a potion that may be missing): mana
        // is healing for the priest and Cleave/3-Shot for the others – it stays topped up
        // also in the party, where HP potions are only an emergency (player decision 2026-11-17).
        else if (c.mpTopUp !== undefined ? mpMissing >= potionGives("mp") * c.mpTopUp : (c.potionWhenMissing && mpMissing >= potionGives("mp"))) use_skill("use_mp").catch(function () {});
    }
    function resting() {
        const r = config.combat.recover;
        // Solo only (player request): in a party the ranger rested while the priest was a
        // few hundred px behind on the way to Daisy (2026-11-17).
        if (!r || !r.enabled || party.enabled || healerNear()) { ftr.recovering = false; return false; }
        const hp = util.hpRatio(), mp = util.mpRatio();
        const attacked = !!get_nearest_monster({ target: character.name });
        if (!ftr.recovering) {
            if (attacked) return false; // still fighting
            if (hp >= r.hpBelow && mp >= r.mpBelow) return false;
            ftr.recovering = true;
            ftr.restSince = Date.now();
            util.log("combat", "resting after the fight: HP " + Math.round(hp * 100) + "%, MP " + Math.round(mp * 100) + "%", "yellow");
        }
        // Done – or resting too long (no potions left, slow natural regeneration).
        if ((hp >= r.hpUntil && mp >= r.mpUntil) || Date.now() - ftr.restSince > (r.maxMs || 90 * 1000)) {
            ftr.recovering = false;
            util.log("combat", "rested: HP " + Math.round(hp * 100) + "%, MP " + Math.round(mp * 100) + "%", "green");
            return false;
        }
        if (attacked) return false; // something hits us while we rest: fight back
        // Drink up to the targets: the normal rule only drinks once a whole potion is
        // missing, so a 935-MP warrior stopped at ~46% MP and rested for good (2026-11-17).
        if (!is_on_cooldown("use_hp") && !util.townChannel()) {
            if (hp < r.hpUntil && (hp / r.hpUntil <= mp / r.mpUntil || mp >= r.mpUntil)) use_skill("use_hp").catch(function () {});
            else if (mp < r.mpUntil) use_skill("use_mp").catch(function () {});
        }
        if (ftr.walks.searching()) ftr.endSearchWalk();
        else if (is_moving(character)) stop();
        util.status("rest " + Math.round(Math.min(hp / r.hpUntil, mp / r.mpUntil) * 100) + "%", "white");
        return true;
    }
    function topUpFor(target) {
        const cost = targeting.soloCost(target);
        if (!cost) return false;
        const reserve = character.max_hp * (1 - ((config.targeting.live || {}).soloHpUse || 0.5));
        const need = Math.min(character.max_hp, cost + reserve);
        if (character.hp >= need) return false;
        if (!ftr.topUpSince) {
            ftr.topUpSince = Date.now();
            util.log("combat", "healing up before " + target.mtype + ": " + Math.round(character.hp) + "/" + Math.round(need) + " HP", "yellow");
        }
        // Natural regeneration is slow: after the rest cap we go anyway (potions empty).
        if (Date.now() - ftr.topUpSince > ((config.combat.recover || {}).maxMs || 90 * 1000)) return false;
        if (!is_on_cooldown("use_hp")) use_skill("use_hp").catch(function () {});
        if (ftr.walks.searching()) ftr.endSearchWalk();
        else if (is_moving(character)) stop();
        util.status("heal up " + Math.round(character.hp / need * 100) + "% for " + target.mtype, "white");
        return true;
    }

    Object.assign(ftr, {
        potionGives: potionGives,
        healerNear: healerNear,
        hpLossRate: hpLossRate,
        handlePotions: handlePotions,
        resting: resting,
        topUpFor: topUpFor,
    });
};
