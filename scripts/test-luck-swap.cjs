// Tests for the luck swap (v1.238.8, 2026-11-26): gear/luck-swap.js changes back as soon as the monsters it was for are
// dead (not before minMs, backMs at the latest), the priest's luck catch passes the dying ones, and the mage puts its
// +0 Wanderer's set on for a boss it kills with the next hit.
// Run: node scripts/test-luck-swap.cjs <G.js with "var G = {...}">
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizMage", ctype: "mage" };
const CONFIG = require(path.join(root, "bot", "config.js"));
let NOW = 1795550000000;
Date.now = () => NOW;
const realImmediate = setImmediate;
const item = (name, level) => ({ name, level: level || 0 });

function world(ctype, name, items, slots) {
    const calls = [];
    const store = {};
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); return true; };
    const bag = items.concat(new Array(42).fill(null)).slice(0, 42);
    g.character = { name, id: name, ctype, type: "character", level: 72, items: bag, esize: bag.filter(i => !i).length, slots, s: {}, rip: false, q: {},
        map: "main", x: 0, y: 0, xp: 1, max_xp: 2, str: 50, int: 400, dex: 50, attack: 600, luckm: 1, goldm: 1, hp: 3000, max_hp: 3000 };
    g.equip_batch = (b) => {
        calls.push(["equip_batch", b.map(x => character.items[x.num] && character.items[x.num].name + ">" + x.slot).join(",")]);
        b.forEach(x => { const it = character.items[x.num]; const old = character.slots[x.slot]; character.slots[x.slot] = it; character.items[x.num] = old || null; });
        return Promise.resolve({ success: true });
    };
    g.equip = () => Promise.resolve({ success: true });
    g.unequip = () => Promise.resolve({ success: true });
    g.get_progression = () => ({ rows: [], routes: [] });
    g.is_on_cooldown = () => false;
    g.parent = { calculate_item_properties: (it) => Object.assign({}, G.items[it.name] || {}), entities: {}, socket: { on: () => {}, off: () => {} } };
    g.set_message = () => {}; g.game_log = () => {};
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/](gear|lib)[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util0 = require(path.join(root, "bot", "lib", "util.js"));
    const util = Object.assign({}, util0, { log: (tag, text) => calls.push(["log", tag, text]), status: () => {} });
    const config = JSON.parse(JSON.stringify(CONFIG));
    // the class defaults as the loader fills them in (config wins)
    const defs = require(path.join(root, "bot", "classes", ctype, "defaults.js")).classes[ctype];
    config.classes[ctype] = Object.assign({}, defs, config.classes[ctype], { luckSwap: Object.assign({}, defs.luckSwap, (config.classes[ctype] || {}).luckSwap) });
    config.gearPlan.chainsFor = CONFIG.gearPlan.chainsFor; // functions do not survive the JSON copy
    config.leader = "VizPri"; config.merchant = "VizMerch";
    config.characters = { VizPri: { role: "fighter" }, VizWar: { role: "fighter" }, VizMage: { role: "fighter" }, VizMerch: { role: "merchant" } };
    const comms = { on: () => {}, send: (to, type, data) => { if (type === "wishes") calls.push(["wishes", data.list.map(x => x.name + "+" + x.level).join(",")]); } };
    const gear = require(path.join(root, "bot", "gear", "gear.js"))({ config, util, comms, supply: { requestNow: () => {} }, bus: { provide: () => {}, get: () => null } });
    return { calls, gear, config };
}
async function settle() { for (let k = 0; k < 10; k++) await new Promise(r => realImmediate(r)); }
const swaps = calls => calls.filter(c => c[0] === "equip_batch");

(async function () {
    const WSET = ["wcap", "wattire", "wbreeches", "wgloves", "wshoes"].map(n => item(n, 0));
    const MAGE_ARMOR = { helmet: item("helmet", 8), chest: item("coat", 8), pants: item("pants", 8), gloves: item("gloves", 8), shoes: item("wingedboots", 7), mainhand: item("firestaff", 7) };

    // ---- mage: the +0 set is the luck set; back as soon as the target is dead ----
    let w = world("mage", "VizMage", WSET.slice(), JSON.parse(JSON.stringify(MAGE_ARMOR)));
    check(JSON.stringify(w.config.classes.mage.luckSwap.items) === JSON.stringify(["wcap", "wattire", "wbreeches", "wgloves", "wshoes"]) && w.config.classes.mage.luckSwap.enabled === true,
        "mage: config + defaults give the five Wanderer pieces, enabled");
    parent.entities = { m1: { id: "m1", mtype: "phoenix", hp: 100, dead: false } };
    check(w.gear.luckOn(null, ["m1"]) === true, "luckOn with the target's id");
    await settle();
    check(swaps(w.calls).length === 1 && swaps(w.calls)[0][1].split(",").length === 5, "all five pieces go on in one equip_batch: " + (swaps(w.calls)[0] || [])[1]);
    NOW += 200; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 1 && w.gear.luckActive(), "target alive: the luck gear stays");
    delete parent.entities.m1; NOW += 100; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 1, "target dead, but before minMs (500): stays");
    NOW += 300; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 2 && !w.gear.luckActive() && character.slots.helmet.name === "helmet" && character.slots.shoes.name === "wingedboots",
        "target dead after minMs: back to the usual armor at once (" + (swaps(w.calls)[1] || [])[1] + ")");

    // ---- a target that lives on: backMs is the limit ----
    w = world("mage", "VizMage", WSET.slice(), JSON.parse(JSON.stringify(MAGE_ARMOR)));
    parent.entities = { m2: { id: "m2", hp: 100000 } };
    w.gear.luckOn(null, ["m2"]); await settle();
    NOW += 2900; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 1, "alive after 2.9 s: still on");
    NOW += 200; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 2 && !w.gear.luckActive(), "after backMs (3 s): back although it lives");

    // ---- priest: several caught monsters; a call without ids keeps the time rule ----
    w = world("priest", "VizPri", [item("wshoes", 8)], { shoes: item("wingedboots", 7), helmet: item("wcap", 8), chest: item("wattire", 8), pants: item("wbreeches", 8), gloves: item("wgloves", 8) });
    parent.entities = { a: { id: "a" }, b: { id: "b" } };
    w.gear.luckOn(null, ["a"]); w.gear.luckOn(null, ["b"]); await settle();
    check(swaps(w.calls).length === 1 && swaps(w.calls)[0][1] === "wshoes>shoes", "priest: only the shoes change (the rest of the set is worn)");
    NOW += 600; delete parent.entities.a; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 1, "one of two caught monsters dead: stays");
    delete parent.entities.b; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 2 && character.slots.shoes.name === "wingedboots", "both dead: back to the Winged Boots");
    w = world("priest", "VizPri", [item("wshoes", 8)], { shoes: item("wingedboots", 7) });
    parent.entities = {};
    w.gear.luckOn(); await settle(); NOW += 1000; w.gear.tick(); await settle();
    check(swaps(w.calls).length === 1 && w.gear.luckActive(), "without ids: the time only, as before");

    // ---- gear plan sets (2026-11-26): the priest's bonus Wanderer's set +0 wishes nothing while it holds the +8 set ----
    w = world("priest", "VizPri", [item("wshoes", 8)], { shoes: item("wingedboots", 7), helmet: item("wcap", 8), chest: item("wattire", 8), pants: item("wbreeches", 8), gloves: item("wgloves", 8) });
    NOW += 600000; w.gear.tick(); await settle();
    let wl = (w.calls.find(c => c[0] === "wishes") || [])[1];
    check(typeof wl === "string" && !["wcap+0", "wattire+0", "wbreeches+0", "wgloves+0", "wshoes+0"].some(n => wl.split(",").includes(n)), "priest with its +8 set (shoes in the bag): no Wanderer +0 wish (" + wl + ")");
    w = world("priest", "VizPri", [], { shoes: item("wingedboots", 7), helmet: item("wcap", 8), chest: item("wattire", 8), pants: item("wbreeches", 8), gloves: item("wgloves", 8) });
    NOW += 600000; w.gear.tick(); await settle();
    wl = (w.calls.find(c => c[0] === "wishes") || [])[1];
    check(typeof wl === "string" && wl.split(",").includes("wshoes+0") && !["wcap+0", "wattire+0", "wbreeches+0", "wgloves+0"].some(n => wl.split(",").includes(n)), "priest without any Wanderer's Shoes: only the missing piece is wished, at +0 (" + wl + ")");
    w = world("mage", "VizMage", [item("wcap", 1), item("wbreeches", 2), item("wgloves", 0), item("wshoes", 0)], JSON.parse(JSON.stringify(MAGE_ARMOR)));
    NOW += 600000; w.gear.tick(); await settle();
    wl = (w.calls.find(c => c[0] === "wishes") || [])[1];
    check(typeof wl === "string" && wl.split(",").includes("wattire+0") && !["wcap+0", "wbreeches+0", "wgloves+0", "wshoes+0"].some(n => wl.split(",").includes(n)), "mage with four pieces: the attire +0 is wished (" + wl + ")");

    // ---- the mage's trigger (classes/mage/mage.js) ----
    const trig = [];
    function mageWith(opts) {
        g.character = Object.assign(g.character, { ctype: "mage", name: "VizMage", hp: opts.hp || 3000, max_hp: 3000, mp: 3000, max_mp: 3000 });
        Object.keys(require.cache).filter(k => /[\\/]bot[\\/](classes|lib)[\\/]/.test(k)).forEach(k => delete require.cache[k]);
        const util = require(path.join(root, "bot", "lib", "util.js"));
        const config = JSON.parse(JSON.stringify(CONFIG));
        const defs = require(path.join(root, "bot", "classes", "mage", "defaults.js")).classes.mage;
        config.classes.mage = Object.assign({}, defs, config.classes.mage, { luckSwap: Object.assign({}, defs.luckSwap, config.classes.mage.luckSwap) },
            { blaster: Object.assign({}, defs.blaster, { enabled: false }) });
        const ctx = { util, config, party: { enabled: !opts.solo, memberNames: () => ["VizPri", "VizWar", "VizMage"], teamGoal: () => null, leaderInfo: () => null },
            gear: { luckOn: (ms, ids) => { trig.push(ids.join(",")); return true; }, luckActive: () => false, holdWeapons: () => {}, equipBatch: () => Promise.resolve() },
            targeting: { diesSoon: (m, hits) => !!opts.dies && hits === 1, farmNow: () => null },
            comms: { send: () => {} }, events: { current: () => null } };
        return require(path.join(root, "bot", "classes", "mage", "mage.js"))(ctx);
    }
    g.parent.entities = {};
    trig.length = 0; mageWith({ dies: true }).fight({ id: "p1", mtype: "phoenix", hp: 500, max_hp: 160000 });
    check(trig.join("|") === "p1", "mage: a boss dying with the next hit - swap for it");
    trig.length = 0; mageWith({ dies: true }).fight({ id: "b1", mtype: "bigbird", hp: 500, max_hp: 32000 });
    check(trig.length === 0, "mage in the party, a normal monster: no swap (everyKill off)");
    trig.length = 0; mageWith({ dies: true, solo: true }).fight({ id: "b2", mtype: "bigbird", hp: 500, max_hp: 32000 });
    check(trig.join("|") === "b2", "mage alone: swap on any kill");
    trig.length = 0; mageWith({ dies: false }).fight({ id: "p2", mtype: "phoenix", hp: 90000, max_hp: 160000 });
    check(trig.length === 0, "boss not dying yet: no swap");
    trig.length = 0; mageWith({ dies: true, hp: 1000 }).fight({ id: "p3", mtype: "phoenix", hp: 500, max_hp: 160000 });
    check(trig.length === 0, "below minHp (0.6): no swap - the armor would come off");

    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
