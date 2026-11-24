// =====================================================================
// classes/mage/blaster.js - Blaster mode: the carried Blaster (great staff, blast splash, +160 MP per attack, both
// hands) goes on while a pack stands around our target (minNeighbours others within its blast radius, blast / 3.6 px)
// and MP is above minMp; with singleTarget also whenever it beats the best staff + book on one target. keepMs without a
// pack, MP below offMp, a walk, a boss or a dangerous bystander bring staff and book back (one equip_batch). The gear
// module's weapon hold keeps its equip pass away meanwhile.
// fight(): with the Blaster in hand, aim at the monster of the target's kind with the most others in its blast radius,
// never fire a blast that would hit a free boss or a monster we can't kite, or pull more than our courage and the solo
// pack check allow (the mage died terrified at the Squigs).
// Interface: createBlaster(deps, options) -> { tick(), fight(target) -> true when it took the turn }
//   deps: game, members(), log, errReason, distanceTo, kiteRisk, attackersOnMe, courageOf, weaponPower, isDoublehand,
//         noArea(m), foreignOnlyBlocks(m), isBoss(m), bossEventActive(), manualBlocks(), packVerdict(strongest, n)
//         (null when not available), holdWeapons(ms), equipBatch(batch)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    enabled: true,
    names: ["gstaff"],    // Blaster items
    minNeighbours: 2,     // others in the blast radius of the target
    minMp: 0.5,           // put on only above this MP ratio
    offMp: 0.2,           // staff + book back below this
    keepMs: 4000,         // staff + book back after this long without a pack
    holdMs: 60000,        // the gear module keeps its hands off this long
    singleTarget: true,   // also on one target when it beats staff + book ...
    singleMargin: 0.03,   // ... by this share
    aim: true,            // shoot the same kind's best pack in range
    blockMs: 6000,        // staff + book this long after an unsafe blast was held
    fearMax: 0,           // a blast may pull courage + this many per damage type
    bossClear: 400,       // no Blaster with a boss this close
};

module.exports = function createBlaster(deps, options) {
    const game = deps.game;
    const bl = Object.assign({}, DEFAULTS, options || {});

    let blBusy = false, packSeenAt = 0, blLogAt = 0;
    function travelling() { const s = game.path(); return !!(s && s.moving); }
    function isBlaster(i) { return !!(i && (bl.names || ["gstaff"]).includes(i.name)); }
    function blasterIndex() {
        const me = game.me();
        let best = -1;
        me.items.forEach(function (it, i) {
            if (isBlaster(it) && (best === -1 || (it.level || 0) > (me.items[best].level || 0))) best = i;
        });
        return best;
    }
    function blastRadius(it) {
        let b = 0;
        try { b = game.itemProps(it).blast || 0; } catch (e) {
            const d = game.data().items[it.name] || {};
            b = (d.blast || 0) + ((d.upgrade || {}).blast || 0) * (it.level || 0);
        }
        return b / 3.6;
    }
    function packAround(t, r) {
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        return Object.values(game.entities()).filter(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.id === t.id) return false;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            return Math.hypot(ex - tx, ey - ty) < r;
        }).length;
    }
    // A free monster within r of t that the blast must not touch: a boss or one we can't kite away from
    // (kiteRisk 1: faster than us, longer reach, special abilities). names: us and members.
    let noBlasterUntil = 0, blockLogAt = 0;
    function dangerNear(t, r, names) {
        const me = game.me(), G = game.data();
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        return Object.values(game.entities()).some(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.id === t.id || (e.target && names.includes(e.target))) return false;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            if (Math.hypot(ex - tx, ey - ty) >= r) return false;
            const def = G.monsters[e.mtype] || {};
            if (deps.isBoss(e)) return true;
            return deps.kiteRisk(def, e, { speed: me.speed, range: me.range }) === 1;
        });
    }
    // Pull limit: a blast on t pulls every free monster within r of it (t too, if free); with those already on us they
    // must stay within our courage per damage type (+ fearMax) and pass the solo pack check for that many.
    function pullOk(t, r) {
        const G = game.data();
        const tx = t.real_x !== undefined ? t.real_x : t.x, ty = t.real_y !== undefined ? t.real_y : t.y;
        const all = deps.attackersOnMe().slice();
        Object.values(game.entities()).forEach(function (e) {
            if (!e || e.type !== "monster" || e.dead || e.target || all.indexOf(e) !== -1) return;
            const ex = e.real_x !== undefined ? e.real_x : e.x, ey = e.real_y !== undefined ? e.real_y : e.y;
            if (e.id === t.id || Math.hypot(ex - tx, ey - ty) < r) all.push(e);
        });
        const byType = {};
        all.forEach(function (e) {
            const dt = e.damage_type || (G.monsters[e.mtype] || {}).damage_type || "physical";
            byType[dt] = (byType[dt] || 0) + 1;
        });
        const over = Object.keys(byType).some(function (dt) { return byType[dt] > deps.courageOf(dt) + (bl.fearMax || 0); });
        if (over) return false;
        if (all.length <= 1) return true;
        const strongest = all.slice().sort(function (a, b) { return (b.attack || 0) - (a.attack || 0); })[0];
        const v = deps.packVerdict(strongest, all.length);
        return v === null ? true : !!v.ok;
    }
    function blockBlaster() {
        noBlasterUntil = Date.now() + (bl.blockMs || 6000);
        if (Date.now() - blockLogAt > 30 * 1000) {
            blockLogAt = Date.now();
            deps.log("mage", "Blaster held: its blast would hit a boss, a monster I can't outrun, or pull more than I can take", "orange");
        }
    }
    // The usual weapons: the strongest other weapon for the main hand and the best book (source) for the offhand.
    function usualBatch() {
        const me = game.me(), G = game.data();
        let main = -1, mainPow = 0, off = -1, offInt = -1;
        me.items.forEach(function (it, i) {
            const d = it && G.items[it.name];
            if (!d || isBlaster(it)) return;
            if (d.type === "weapon" && !deps.isDoublehand(it.name, me.ctype)) {
                const p = deps.weaponPower(it.name, it.level || 0, me.ctype);
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
    // Single target: the Blaster stays on whenever it beats the best staff + book on one target - weapon power against
    // the staff's power x the book's INT share. MP is kept up with potions; only below offMp the staff comes back.
    function bookInt(it) {
        const d = it && game.data().items[it.name];
        if (!d || d.type !== "source") return 0;
        try { return game.itemProps(it).int || 0; } catch (e) { return (d.int || 0) + ((d.compound || {}).int || 0) * (it.level || 0); }
    }
    function staffValue() {
        const me = game.me(), G = game.data();
        let mainPow = 0, book = 0;
        const slots = me.slots || {};
        const cand = me.items.concat([slots.mainhand, slots.offhand]);
        cand.forEach(function (it) {
            const d = it && G.items[it.name];
            if (!d || isBlaster(it)) return;
            if (d.type === "weapon" && !deps.isDoublehand(it.name, me.ctype)) mainPow = Math.max(mainPow, deps.weaponPower(it.name, it.level || 0, me.ctype));
            else if (d.type === "source") book = Math.max(book, bookInt(it));
        });
        const baseInt = Math.max(1, (me.int || 1) - bookInt(slots.offhand));
        return mainPow * (1 + book / baseInt);
    }
    function blasterBetter(it) {
        if (!bl.singleTarget || !it) return false;
        return deps.weaponPower(it.name, it.level || 0, game.me().ctype) > staffValue() * (1 + (bl.singleMargin || 0));
    }
    async function tick() {
        const me = game.me();
        if (!bl.enabled || blBusy || me.rip) return;
        const t = game.targetedMonster();
        const worn = me.slots && me.slots.mainhand;
        if (isBlaster(worn)) {
            if (t && !t.dead && packAround(t, blastRadius(worn)) >= (bl.minNeighbours || 2)) packSeenAt = Date.now();
            const better = blasterBetter(worn);
            // Off under /manual outside the cave; inside the cave it is allowed (the groups are small and apart there).
            const why = deps.manualBlocks() ? "manual" : t && !t.dead && deps.isBoss(t) ? "boss" : Date.now() < noBlasterUntil ? "dangerous bystander" : game.mpRatio() < (bl.offMp || 0.2) ? "MP low" : better ? null :
                travelling() ? "on the way" : Date.now() - packSeenAt > (bl.keepMs || 4000) ? "no pack" : null;
            if (!why) { deps.holdWeapons(bl.holdMs || 60000); return; }
            const batch = usualBatch();
            // No other main-hand weapon in the bag: the Blaster stays on (a lone book would push it off) - a blocked shot
            // then simply waits (fight() keeps returning) until the target is safe again.
            if (!batch.some(function (b) { return b.slot === "mainhand"; })) return;
            blBusy = true;
            try {
                await deps.equipBatch(batch);
                deps.holdWeapons(0);
                deps.log("mage", "staff and book back (" + why + ")", "white");
            } catch (e) {
                deps.log("mage", "blaster off: " + deps.errReason(e), "orange");
            } finally { blBusy = false; }
            return;
        }
        if (Date.now() < noBlasterUntil || game.mpRatio() < (bl.minMp || 0.5) || me.esize < 1) return;
        if (deps.manualBlocks()) return; // /manual outside the cave: no blast splash (allowed in the cave)
        const idx = blasterIndex();
        if (idx === -1) return;
        if (t && !t.dead && deps.isBoss(t)) return; // bosses: staff + book, whatever is stronger
        // No Blaster during a boss event either: at the Phoenix the mage kept trying it on the small monsters around -
        // and a boss within bossClear px (the blast or a pull could reach it).
        if (deps.bossEventActive()) return;
        if (Object.values(game.entities()).some(function (e) { return e && e.type === "monster" && !e.dead && deps.isBoss(e) && deps.distanceTo(e) < (bl.bossClear || 400); })) return;
        const better = blasterBetter(me.items[idx]);
        if (!better && (!t || t.dead || travelling())) return;
        const n = t && !t.dead ? packAround(t, blastRadius(me.items[idx])) : 0;
        if (!better && n < (bl.minNeighbours || 2)) return;
        blBusy = true;
        try {
            deps.holdWeapons(bl.holdMs || 60000); // records staff + book as the usual weapons first
            packSeenAt = Date.now();
            // A two-hander needs an empty offhand: the book comes off first, then the Blaster goes on.
            if (me.slots && me.slots.offhand) await game.unequipSlot("offhand");
            const now = me.items.findIndex(function (it) { return isBlaster(it); });
            await deps.equipBatch([{ num: now !== -1 ? now : idx, slot: "mainhand" }]);
            if (Date.now() - blLogAt > 10 * 1000) {
                blLogAt = Date.now();
                deps.log("mage", "Blaster on: " + (better ? "beats staff + book on one target" : (n + 1) + " in its blast radius (" + Math.round(blastRadius(me.slots.mainhand || {})) + " px)"), "yellow");
            }
        } catch (e) {
            deps.log("mage", "blaster on: " + deps.errReason(e), "orange");
        } finally { blBusy = false; }
    }

    // Aim and splash safety while the Blaster is in hand. true: this turn is taken (we shot, or staff + book first).
    function fight(target) {
        const me = game.me();
        const worn = me.slots && me.slots.mainhand;
        if (isBlaster(worn) && target && target.mtype && deps.isBoss(target)) { blockBlaster(); return true; } // staff + book first
        if (isBlaster(worn) && target && target.mtype) {
            const r = blastRadius(worn);
            const names = deps.members().concat([me.name]);
            const safeAt = function (t) { return !dangerNear(t, r, names) && pullOk(t, r); };
            let best = null, bestN = safeAt(target) ? packAround(target, r) : -1;
            Object.values(game.entities()).forEach(function (m) {
                if (!m || m.type !== "monster" || m.dead || m.id === target.id || m.mtype !== target.mtype) return;
                if (m.target && !names.includes(m.target)) return; // another player's
                if (deps.noArea(m) || deps.foreignOnlyBlocks(m)) return;
                if (!game.inRange(m) || !safeAt(m)) return;
                const n = packAround(m, r);
                // Better pack (aim), or any safe one when the core's target is not safe.
                if ((bl.aim !== false || bestN < 0) && n > bestN) { bestN = n; best = m; }
            });
            if (best) {
                game.changeTarget(best);
                if (!game.onCooldown("attack") && game.canAttack(best)) game.attackTarget(best).catch(function () {});
                return true;
            }
            if (bestN < 0) { blockBlaster(); return true; } // staff + book come on (tick), then the core shoots
        }
        return false;
    }

    return { tick: tick, fight: fight };
};
