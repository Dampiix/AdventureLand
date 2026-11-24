// Old vs new for bot_merchant (module plan, stage 6b): the old single file roles/merchant.js (from a git ref) and the new
// roles/merchant/ facade + parts run in the same fake game with the real game data (G) and config, with a recording fake
// workshop and scout. The merchant is started and its loop runs a fixed number of sleeps with a fake clock; every buy,
// sale, stand order, bank move, item sent, skill, walk, comms message, storage write and log line is recorded, and old
// and new must record exactly the same. Nothing here touches the real game.
// Run: node scripts/test-merchant.cjs <G.js with "var G = {...}"> [git ref of the old roles/merchant.js, default fbb3dce]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "fbb3dce";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizMerch" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function loadOld() {
    const src = execSync("git show " + ref + ":bot/roles/merchant.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    const file = path.join(root, "bot", "roles", "merchant-old.js");
    const m = new Module(file);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}
function loadNew() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]roles[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", "roles", "merchant", "merchant.js"));
}

const realImmediate = setImmediate;
let NOW;
Date.now = () => NOW;
let rnd;
Math.random = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
const item = (name, level, extra) => Object.assign({ name, level: level || 0 }, extra || {});

function world(sc, calls) {
    NOW = 1795550000000;
    rnd = 1234;
    const store = JSON.parse(JSON.stringify(sc.store || {}));
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k]); return true; };
    const items = [item("stand0", 0)].concat(JSON.parse(JSON.stringify(sc.items || []))).concat(new Array(42).fill(null)).slice(0, 42);
    g.character = Object.assign({ name: "VizMerch", id: "VizMerch", ctype: "merchant", type: "character", level: 60, hp: 3000, max_hp: 3000,
        mp: 1500, max_mp: 1500, x: 0, y: 0, real_x: 0, real_y: 0, map: "main", in: "main", gold: 50000000, items, esize: items.filter(i => !i).length,
        isize: 42, slots: {}, s: {}, rip: false, q: {}, ping: 100, stand: false, moving: false }, sc.me || {});
    const rec = (what, ret) => function () { calls.push([what].concat([].slice.call(arguments).map(a => typeof a === "object" ? JSON.stringify(a) : a))); return Promise.resolve(ret === undefined ? { success: true } : ret); };
    ["buy", "sell", "send_item", "bank_store", "bank_retrieve", "use_skill", "equip", "unequip", "xmove", "move", "trade", "trade_buy", "trade_sell",
        "join", "respawn", "accept_party_invite"].forEach(n => { g[n] = rec(n); });
    g.smart_move = function (d) {
        calls.push(["smart_move", JSON.stringify(d)]);
        if (d === "bank") { character.map = character.in = "bank"; character.bank = { items0: [] }; }
        else if (d && typeof d === "object") { character.map = character.in = d.map || character.map; if (typeof d.x === "number") { character.x = character.real_x = d.x; character.y = character.real_y = d.y; } }
        else if (typeof d === "string") { character.map = character.in = "main"; }
        return Promise.resolve();
    };
    g.open_stand = () => { character.stand = true; calls.push(["open_stand"]); };
    g.close_stand = () => { character.stand = false; calls.push(["close_stand"]); return Promise.resolve(); };
    g.is_moving = () => false;
    g.is_on_cooldown = () => false;
    g.can_use = () => true;
    g.locate_item = (n) => character.items.findIndex(i => i && i.name === n);
    g.quantity = (n) => character.items.reduce((s, i) => s + (i && i.name === n ? (i.q || 1) : 0), 0);
    g.get_player = n => (sc.players || {})[n] || null;
    g.get_party = () => ({});
    g.get_nearest_monster = () => null;
    g.parent = { entities: JSON.parse(JSON.stringify(sc.entities || {})), socket: { on: () => {}, off: () => {}, emit: (n, d) => calls.push(["emit", n, JSON.stringify(d)]) },
        S: {}, server_region: "EU", server_identifier: "IV", distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
        calculate_item_properties: (it) => Object.assign({}, G.items[it.name] || {}), close_merchant: () => { character.stand = false; } };
    g.smart = { moving: false };
    g.setInterval = () => 0;
    g.setTimeout = (fn, ms) => { calls.push(["setTimeout", ms || 0]); realImmediate(fn); return 0; };
    let sleeps = 0;
    g.sleep = (ms) => { if (++sleeps > sc.sleeps) return new Promise(() => {}); NOW += ms || 0; return Promise.resolve(); };
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.send_cm = () => {};
    g.change_server = () => calls.push(["change_server"]);
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]lib[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util0 = require(path.join(root, "bot", "lib", "util.js"));
    const util = Object.assign({}, util0, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]), heartbeat: () => {} });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = "VizPri"; config.merchant = "VizMerch";
    config.characters = { VizPri: { role: "fighter" }, VizWar: { role: "fighter" }, VizMage: { role: "fighter" }, VizMerch: { role: "merchant" } };
    config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"], merchant: "VizMerch" });
    // The Ponty round and the trade trips come first in every work round: off unless a scenario is about them.
    if (!sc.ponty) config.merchantRole.pontyRound = Object.assign({}, config.merchantRole.pontyRound, { enabled: false });
    if (!sc.trade) config.market.sellTo = Object.assign({}, config.market.sellTo, { enabled: false });
    Object.assign(config.merchantRole, sc.merchantRole || {});
    const handlers = {};
    const comms = { on: (type, fn) => { handlers[type] = fn; }, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data).slice(0, 200)]) };
    // A recording workshop: every call is logged with its arguments, answers are plain defaults.
    const workshop = new Proxy({}, { get: (t, name) => {
        if (name === "then") return undefined;
        return function () {
            calls.push(["workshop." + String(name)].concat([].slice.call(arguments).map(a => (a && typeof a === "object") ? JSON.stringify(a).slice(0, 80) : a)));
            if (name === "work") return Promise.resolve("idle");
            if (name === "report") return "report";
            if (name === "deliveryIndexes") return new Set();
            if (name === "ownedCount") return 0;
            if (name === "wishBuyOrders" || name === "playerOffers") return [];
            if (name === "refreshBank" || name === "pontyVisit") return Promise.resolve(null);
            return false;
        };
    } });
    const scout = { work: () => { calls.push(["scout.work"]); return Promise.resolve(false); } };
    return { ctx: { config, util, comms, workshop, scout }, handlers };
}

const SCENARIOS = [
    { name: "a quiet round in town (stand, chores, workshop)", sleeps: 12 },
    { name: "junk and potions to sell, a nearly full bag", sleeps: 12, items: [item("hpot0", 0, { q: 200 }), item("ringsj", 0), item("cclaw", 0), item("crabclaw", 0, { q: 5 })].concat(new Array(36).fill(0).map((_, i) => item("beewings", 0, { q: 1 + i }))) },
    { name: "a pickup request from a fighter", sleeps: 14, msgs: [[1, "pickup", { map: "main", x: 300, y: 300, items: [], gold: 0 }, "VizWar"]],
        players: { VizWar: { id: "VizWar", name: "VizWar", map: "main", x: 300, y: 300, real_x: 300, real_y: 300, rip: false, items: [] } } },
    { name: "dead: respawn", sleeps: 8, me: { rip: true, hp: 0 } },
    { name: "a Ponty round is due", ponty: true, sleeps: 10 },
    { name: "a trade scan is due", trade: true, sleeps: 10 },
    { name: "Merchant's Luck on a player in reach", sleeps: 10, entities: { Other: { id: "Other", name: "Other", type: "character", ctype: "warrior", x: 50, y: 50, map: "main", s: {}, rip: false, npc: false } } },
];

async function run(load, sc) {
    const calls = [];
    const w = world(sc, calls);
    let mer;
    try { mer = load()(w.ctx); } catch (e) { calls.push(["create threw", String(e && e.stack).slice(0, 300)]); return calls; }
    try { mer.start(); } catch (e) { calls.push(["start threw", String(e && e.message)]); }
    for (let i = 0; i < 600; i++) {
        (sc.msgs || []).filter(m => m[0] === i).forEach(m => { try { w.handlers[m[1]] && w.handlers[m[1]](JSON.parse(JSON.stringify(m[2])), m[3]); } catch (e) { calls.push(["msg threw", String(e.message)]); } });
        await new Promise(r => realImmediate(r));
    }
    mer.stop();
    return calls;
}

(async function () {
    for (const sc of SCENARIOS) {
        const o = await run(loadOld, sc), n = await run(loadNew, sc);
        const same = JSON.stringify(o) === JSON.stringify(n);
        const errs = o.filter(c => /threw|tick error|work failed/.test(JSON.stringify(c)));
        check(same && o.length > 2, sc.name + " (" + o.length + " records, " + errs.length + " errors in both)");
        if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
        if (process.env.SHOW) { errs.slice(0, 3).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 300))); o.filter(c => !/^(set|status)$/.test(c[0])).slice(0, 16).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 200))); }
    }
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
