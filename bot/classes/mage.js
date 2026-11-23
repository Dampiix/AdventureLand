// =====================================================================
// bot_class_mage – Mage skills.
//   support: Energize (lvl 20) – give mana to the party member that runs
//            lowest on MP (e.g. the priest), while we have plenty
//   fight:   basic attacks; Mana Burst (whole MP pool as damage) only when
//            enabled in config, because it empties the mage
//   always:  Blaster mode (v1.224.6) – the carried Blaster (great staff, blast
//            splash) goes on for a pack, staff + book come back afterwards
// =====================================================================

module.exports = function createMage(ctx) {
    const util = ctx.util;
    const c = ctx.config.classes.mage;

    function energizeTarget() {
        let best = null;
        ctx.party.memberNames().forEach(function (name) {
            if (name === character.name) return;
            const p = get_player(name);
            if (!p || p.rip || !p.max_mp) return;
            const ratio = p.mp / p.max_mp;
            if (ratio >= c.energizeBelow) return;
            if (!is_in_range(p, "energize")) return;
            if (!best || ratio < best.ratio) best = { name: name, ratio: ratio };
        });
        return best;
    }

    // ---- Blaster mode (player decision 2026-11-23) ------------------------------------------------
    // Like the warrior's Lolipops: the Blaster costs +160 MP per attack and takes both hands, so it is worn only while a
    // pack stands around our target (at least minNeighbours other monsters within its blast radius, blast / 3.6 px - the
    // warrior's Agitate stacks them) and MP is above minMp. keepMs without a pack, MP below offMp, or a walk bring the
    // staff and the book back - both in one equip_batch call. The gear module's weapon hold keeps its equip pass away.
    const bl = c.blaster || {};
    let blBusy = false, packSeenAt = 0, blLogAt = 0;
    function travelling() { return typeof smart !== "undefined" && !!smart.moving; }
    function isBlaster(i) { return !!(i && (bl.names || ["gstaff"]).includes(i.name)); }
    function blasterIndex() {
        let best = -1;
        character.items.forEach(function (it, i) {
            if (isBlaster(it) && (best === -1 || (it.level || 0) > (character.items[best].level || 0))) best = i;
        });
        return best;
    }
    function blastRadius(it) {
        let b = 0;
        try { b = parent.calculate_item_properties(it).blast || 0; } catch (e) {
            const d = G.items[it.name] || {};
            b = (d.blast || 0) + ((d.upgrade || {}).blast || 0) * (it.level || 0);
        }
        return b / 3.6;
    }
    function packAround(t, r) {
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        return Object.values(parent.entities || {}).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.id === t.id) return false;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            return Math.hypot(ex - tx, ey - ty) < r;
        }).length;
    }
    // The usual weapons: the strongest other weapon for the main hand and the best book (source) for the offhand.
    function usualBatch() {
        let main = -1, mainPow = 0, off = -1, offInt = -1;
        character.items.forEach(function (it, i) {
            const d = it && G.items[it.name];
            if (!d || isBlaster(it)) return;
            if (d.type === "weapon" && !util.isDoublehand(it.name, character.ctype)) {
                const p = util.weaponPower(it.name, it.level || 0, character.ctype);
                if (p > mainPow) { mainPow = p; main = i; }
            } else if (d.type === "source") {
                const v = (d.int || 0) + ((d.compound || {}).int || 0) * (it.level || 0);
                if (v > offInt) { offInt = v; off = i; }
            }
        });
        const batch = [];
        if (main !== -1) batch.push({ num: main, slot: "mainhand" });
        if (off !== -1) batch.push({ num: off, slot: "offhand" });
        return batch;
    }
    async function blasterTick() {
        if (!bl.enabled || blBusy || character.rip) return;
        const t = get_targeted_monster();
        const worn = character.slots && character.slots.mainhand;
        if (isBlaster(worn)) {
            if (t && !t.dead && packAround(t, blastRadius(worn)) >= (bl.minNeighbours || 2)) packSeenAt = Date.now();
            const why = travelling() ? "on the way" : util.mpRatio() < (bl.offMp || 0.2) ? "MP low" :
                Date.now() - packSeenAt > (bl.keepMs || 4000) ? "no pack" : null;
            if (!why) { ctx.gear.holdWeapons(bl.holdMs || 60000); return; }
            const batch = usualBatch();
            if (!batch.length) return;
            blBusy = true;
            try {
                await ctx.gear.equipBatch(batch);
                ctx.gear.holdWeapons(0);
                util.log("mage", "staff and book back (" + why + ")", "white");
            } catch (e) {
                util.log("mage", "blaster off: " + util.errReason(e), "orange");
            } finally { blBusy = false; }
            return;
        }
        if (!t || t.dead || travelling() || util.mpRatio() < (bl.minMp || 0.5) || character.esize < 1) return;
        const idx = blasterIndex();
        if (idx === -1) return;
        const n = packAround(t, blastRadius(character.items[idx]));
        if (n < (bl.minNeighbours || 2)) return;
        blBusy = true;
        try {
            ctx.gear.holdWeapons(bl.holdMs || 60000); // records staff + book as the usual weapons first
            packSeenAt = Date.now();
            await ctx.gear.equipBatch([{ num: idx, slot: "mainhand" }]); // a two-hander: the book goes to the bag
            if (Date.now() - blLogAt > 10 * 1000) {
                blLogAt = Date.now();
                util.log("mage", "Blaster on: " + (n + 1) + " in its blast radius (" + Math.round(blastRadius(character.slots.mainhand || {})) + " px)", "yellow");
            }
        } catch (e) {
            util.log("mage", "blaster on: " + util.errReason(e), "orange");
        } finally { blBusy = false; }
    }

    return {
        name: "mage",

        survive: function () { return false; },

        always: function () { blasterTick(); },

        support: function () {
            if (util.mpRatio() > c.energizeAbove && util.canCast("energize")) {
                const t = energizeTarget();
                if (t) use_skill("energize", t.name).catch(function () {});
            }
            return false; // Energize does not replace the attack
        },

        fight: function (target) {
            if (c.useBurst && util.canCast("burst") && util.mpRatio() > 0.95 &&
                target.hp > character.mp * G.skills.burst.ratio) {
                use_skill("burst", target).catch(function () {});
            }
            return false;
        },
    };
};
