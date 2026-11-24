// Old vs new for bot_gear (module plan, stage 7a): the old single file core/gear.js (from a git ref) and the new gear/
// facade + parts run in the same fake game with the real game data (G) and config. Each scenario sets the bag, the worn
// gear and the progression guide's rows and ticks the module (and calls its interface); every equip, unequip, comms
// message, storage write and log line is recorded, and old and new must record exactly the same.
// Run: node scripts/test-gear.cjs <G.js with "var G = {...}"> [git ref of the old core/gear.js, default a7ff5fd]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "a7ff5fd";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizPri", ctype: "priest" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function loadOld() {
    const src = execSync("git show " + ref + ":bot/core/gear.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    const file = path.join(root, "bot", "core", "gear-old.js");
    const m = new Module(file);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}
function loadNew() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]gear[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", "gear", "gear.js"));
}

const realImmediate = setImmediate;
let NOW;
Date.now = () => NOW;
const item = (name, level, extra) => Object.assign({ name, level: level || 0 }, extra || {});

function world(sc, calls) {
    NOW = 1795550000000;
    const store = {};
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k]); return true; };
    const items = JSON.parse(JSON.stringify(sc.items || [])).concat(new Array(42).fill(null)).slice(0, 42);
    g.character = Object.assign({ name: "VizPri", id: "VizPri", ctype: "priest", type: "character", level: 69, items, esize: items.filter(i => !i).length,
        slots: JSON.parse(JSON.stringify(sc.slots || {})), s: {}, rip: false, q: {}, map: "desertland", x: 0, y: 0, xp: 1000, max_xp: 100000,
        str: 50, int: 400, dex: 50, attack: 600, luckm: 1, goldm: 1 }, sc.me || {});
    g.equip = (num, slot) => {
        calls.push(["equip", num, slot || null]);
        const it = character.items[num];
        if (it) { const s = slot || (G.items[it.name] || {}).type; const old = character.slots[s]; character.slots[s] = it; character.items[num] = old || null; }
        return Promise.resolve({ success: true });
    };
    g.unequip = (slot) => { calls.push(["unequip", slot]); return Promise.resolve({ success: true }); };
    g.equip_batch = (b) => { calls.push(["equip_batch", JSON.stringify(b)]); return Promise.resolve({ success: true }); };
    g.get_progression = () => JSON.parse(JSON.stringify(sc.guide || { rows: [], routes: [] }));
    g.is_on_cooldown = () => false;
    g.parent = { calculate_item_properties: (it) => Object.assign({}, G.items[it.name] || {}), entities: {}, socket: { on: () => {}, off: () => {} } };
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]lib[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util0 = require(path.join(root, "bot", "lib", "util.js"));
    const util = Object.assign({}, util0, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]) });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = "VizPri"; config.merchant = "VizMerch";
    config.characters = { VizPri: { role: "fighter" }, VizWar: { role: "fighter" }, VizMage: { role: "fighter" }, VizMerch: { role: "merchant" } };
    const handlers = {};
    const comms = { on: (type, fn) => { handlers[type] = fn; }, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data).slice(0, 240)]) };
    const supply = { requestNow: (why) => calls.push(["supply.requestNow", why || null]) };
    return { ctx: { config, util, comms, supply, bus: { provide: () => {}, get: () => null } }, handlers };
}

const SCENARIOS = [
    { name: "the guide says: equip a better ring", items: [item("ringsj", 2)], slots: { ring1: item("ringsj", 0) },
        guide: { rows: [{ action: { kind: "equip", num: 0, name: "ringsj", level: 2, slot: "ring1" } }], routes: [] }, ticks: 4 },
    { name: "wishes from the guide go to the merchant", slots: { mainhand: item("wand", 3) },
        guide: { rows: [{ request: { name: "intring", level: 3 } }, { request: { name: "wbook0", level: 2 } }, { request: { name: "helmet", level: 5 } }], routes: [] }, ticks: 5 },
    { name: "a better copy of a worn piece in the bag", items: [item("helmet", 6), item("gloves", 3)], slots: { helmet: item("helmet", 4), gloves: item("gloves", 5) }, ticks: 4 },
    { name: "the merchant pings ready", ticks: 3, msgs: [[1, "ready", {}, "VizMerch"]] },
];

async function run(load, sc) {
    const calls = [];
    const w = world(sc, calls);
    let gear;
    try { gear = load()(w.ctx); } catch (e) { calls.push(["create threw", String(e && e.stack).slice(0, 300)]); return calls; }
    for (let i = 0; i < sc.ticks; i++) {
        NOW += 70 * 1000;
        (sc.msgs || []).filter(m => m[0] === i).forEach(m => { try { w.handlers[m[1]] && w.handlers[m[1]](m[2], m[3]); } catch (e) { calls.push(["msg threw", String(e.message)]); } });
        try { calls.push(["tick", JSON.stringify(gear.tick() === undefined ? null : "ret")]); } catch (e) { calls.push(["tick threw", String(e && e.message)]); }
        for (let k = 0; k < 20; k++) await new Promise(r => realImmediate(r));
    }
    character.items.forEach((it, i) => { if (it) { try { calls.push(["isReserved", i, gear.isReserved(it)]); } catch (e) { calls.push(["isReserved threw", String(e.message)]); } } });
    try { calls.push(["luckActive", gear.luckActive()]); calls.push(["weaponsHeld", JSON.stringify(gear.weaponsHeld())]); } catch (e) { calls.push(["api threw", String(e.message)]); }
    return calls;
}

(async function () {
    for (const sc of SCENARIOS) {
        const o = await run(loadOld, sc), n = await run(loadNew, sc);
        const same = JSON.stringify(o) === JSON.stringify(n);
        const errs = o.filter(c => /threw/.test(c[0]));
        check(same && o.length > 3, sc.name + " (" + o.length + " records, " + errs.length + " errors in both)");
        if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
        if (process.env.SHOW) { errs.slice(0, 3).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 300))); o.filter(c => !/^(set|status|tick)$/.test(c[0])).slice(0, 12).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 220))); }
    }
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
