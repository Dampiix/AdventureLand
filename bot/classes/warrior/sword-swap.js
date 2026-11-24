// =====================================================================
// classes/warrior/sword-swap.js - sword swap: Swords of the Dead on targets that fall within maxHits hits, the fire blades (burn) back on longer fights and bosses.
// Part of the warrior (module plan, stage 2): moved verbatim from the old single-file warrior.js. The warrior's parts
// share one internal state (w: the pack, the auto decision, the last Agitate, the speed reference) and call each
// other through w; outside dependencies come in deps (game, util, config, party, targeting, gear, strike, events).
// =====================================================================

module.exports = function install(w, deps) {
    const game = deps.game;
    const util = deps.util;
    const quiet = util.quiet;
    const c = deps.config.classes.warrior;
    const ag = c.agitate || {};
    const mpLeftAfter = util.mpLeftAfter;

    // ---- sword swap (player decision 2026-11-21) ---------------------------------------------
    // Fire blades are the end goal (burn), but burn needs ~5 s and never procs on the killing hit: on
    // a target that falls in classes.warrior.swordSwap.maxHits hits the carried Swords of the Dead
    // (more attack, 10 STR) go on, held like the Agitate maces; a target that takes longer (and every
    // boss / event target) brings the fire blades back. Only once fire blades are worn - before that
    // the swords are our usual weapons anyway.
    const sw = c.swordSwap || {};
    let swordsOn = false, swordBusy = false, swordLogAt = 0;
    function isBurn(i) { return !!(i && game.data().items[i.name] && game.data().items[i.name].ability === "burn"); }
    function quickSwords() {
        const names = sw.names || ["swordofthedead"];
        return game.me().items.map(function (it, num) { return { it: it, num: num }; }).filter(function (x) {
            return x.it && names.includes(x.it.name) && util.weaponPower(x.it.name, 0, game.me().ctype) > 0;
        }).sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    }
    function hitsToKill(t) {
        let mult = 1;
        mult = util.hitMultiplier(game.data().monsters[t.mtype] || t, game.me().damage_type || ((game.data().classes[game.me().ctype] || {}).damage_type), game.me());
        return (t.max_hp || t.hp || 1) / Math.max(1, (game.me().attack || 1) * mult);
    }
    async function putOn(list, why) {
        swordBusy = true;
        try {
            // Both swords in ONE equip_batch call (v1.223.6, like the maces).
            const off = game.me().slots && game.me().slots.offhand;
            const batch = [];
            if (list[0]) batch.push({ num: list[0].num, slot: "mainhand" });
            if (list[1] && (!off || game.data().items[off.name].type === "weapon")) batch.push({ num: list[1].num, slot: "offhand" });
            if (batch.length) await deps.gear.equipBatch(batch);
            util.log("warrior", why + ": " + ["mainhand", "offhand"].map(function (s) {
                const i = game.me().slots[s]; return i ? i.name + " +" + (i.level || 0) : "-";
            }).join(", "), "yellow");
        } catch (e) {
            util.log("warrior", "sword swap: " + util.errReason(e), "orange");
        } finally {
            swordBusy = false;
        }
    }
    function swordSwap() {
        if (!sw.enabled || swordBusy || w.pack.busy || w.wearingSplash() || game.me().rip) return;
        const t = game.targetedMonster();
        if (!t || t.dead || t.type !== "monster") return;
        const def = game.data().monsters[t.mtype] || {};
        const longFight = !!(deps.events && deps.events.current()) || def.cooperative || hitsToKill(t) > (sw.maxHits || 5);
        const main = game.me().slots && game.me().slots.mainhand;
        if (!longFight) {
            if (isBurn(main)) {
                const list = quickSwords();
                if (!list.length) return;
                deps.gear.holdWeapons(sw.holdMs || 60 * 1000); // records the fire blades as our usual weapons first
                swordsOn = true;
                putOn(list, "swords on (" + t.mtype + " falls in ~" + Math.ceil(hitsToKill(t)) + " hits)");
            } else if (swordsOn) {
                deps.gear.holdWeapons(sw.holdMs || 60 * 1000); // still quick targets: keep the swords
            }
            return;
        }
        if (swordsOn && !isBurn(main)) {
            swordsOn = false;
            deps.gear.holdWeapons(0); // the equip pass puts the stronger (burn-rated) fire blades back
            if (Date.now() - swordLogAt > 10 * 1000) {
                swordLogAt = Date.now();
                util.log("warrior", "fire blades back (" + t.mtype + ": ~" + Math.ceil(hitsToKill(t)) + " hits" + (def.cooperative ? ", boss" : "") + ")", "yellow");
            }
        }
    }

    Object.assign(w, {
        isBurn: isBurn,
        quickSwords: quickSwords,
        hitsToKill: hitsToKill,
        putOn: putOn,
        swordSwap: swordSwap,
    });
};
