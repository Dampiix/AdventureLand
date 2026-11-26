// Old vs new for bot_workshop (module plan, stage 6a): the old single file roles/workshop.js (from a git ref) and the new
// roles/workshop/ facade + parts run in the same fake game with the real game data (G) and config. Each scenario sends
// the fighters' messages (wishes, worn gear, gold) and runs work() a few rounds; every buy, upgrade, compound,
// exchange, craft, dismantle, bank move, item sent, walk, comms message, storage write and log line is recorded, and
// old and new must record exactly the same. Nothing here touches the real game.
// Run: node scripts/test-workshop.cjs <G.js with "var G = {...}"> [git ref of the old roles/workshop.js, default dea6985]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "dea6985";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizMerch" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function loadOld() {
    const src = execSync("git show " + ref + ":bot/roles/workshop.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    const file = path.join(root, "bot", "roles", "workshop-old.js");
    const m = new Module(file);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}
function loadNew() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]roles[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", "roles", "workshop", "workshop.js"));
}

const realImmediate = setImmediate, realTimeout = setTimeout;
let NOW;
Date.now = () => NOW;
let rnd;
Math.random = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
const item = (name, level, extra) => Object.assign({ name, level: level || 0 }, extra || {});

function world(sc, calls) {
    NOW = 1795550000000;
    rnd = 99;
    const store = JSON.parse(JSON.stringify(sc.store || {}));
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k]); return true; };
    // Every merchant carries its stand (else the first step is buying one).
    const items = [item("stand0", 0)].concat(JSON.parse(JSON.stringify(sc.items || []))).concat(new Array(42).fill(null)).slice(0, 42);
    g.character = Object.assign({ name: "VizMerch", id: "VizMerch", ctype: "merchant", type: "character", level: 60, hp: 3000, max_hp: 3000,
        mp: 1500, max_mp: 1500, x: 0, y: 0, real_x: 0, real_y: 0, map: "main", in: "main", gold: sc.gold || 50000000, items, esize: items.filter(i => !i).length,
        isize: 42, slots: {}, s: {}, rip: false, q: {}, ping: 100, bank: sc.bank ? JSON.parse(JSON.stringify(sc.bank)) : undefined }, sc.me || {});
    const recP = (what) => function () { calls.push([what].concat([].slice.call(arguments).map(a => typeof a === "object" ? JSON.stringify(a) : a))); return Promise.resolve({ success: true }); };
    ["buy", "buy_with_gold", "upgrade", "compound", "exchange", "dismantle", "auto_craft", "craft", "send_item", "bank_store", "bank_retrieve",
        "bank_deposit", "bank_withdraw", "buy_secondhand", "exchange_buy", "sell", "use_skill", "swap", "equip", "unequip", "smart_move", "xmove", "move", "trade_buy"].forEach(n => { g[n] = recP(n); });
    // Walks arrive at once: the bank (its packs appear, as the client loads them inside), a map point, an NPC by name.
    g.smart_move = function (d) {
        calls.push(["smart_move", JSON.stringify(d)]);
        if (d === "bank" || (d && d.map === "bank")) { character.map = character.in = "bank"; character.bank = JSON.parse(JSON.stringify(sc.bank || { items0: [] })); }
        else if (d && typeof d === "object") { character.map = character.in = d.map || character.map; if (typeof d.x === "number") { character.x = character.real_x = d.x; character.y = character.real_y = d.y; } }
        else if (typeof d === "string") { character.map = character.in = "main"; }
        return Promise.resolve();
    };
    // Bank moves change bag and bank like the server does.
    g.bank_retrieve = function (pack, index, to) {
        calls.push(["bank_retrieve", pack, index]);
        const it = character.bank && character.bank[pack] && character.bank[pack][index];
        const free = character.items.findIndex(i => !i);
        if (it && free !== -1) { character.items[free] = it; character.bank[pack][index] = null; character.esize--; }
        return Promise.resolve({ success: true });
    };
    g.bank_store = function (index, pack) {
        calls.push(["bank_store", index, pack || null]);
        const it = character.items[index];
        if (it && character.bank) { const p = pack || "items0"; (character.bank[p] = character.bank[p] || []).push(it); character.items[index] = null; character.esize++; }
        return Promise.resolve({ success: true });
    };
    g.buy = function (name, q) {
        calls.push(["buy", name, q || 1]);
        const free = character.items.findIndex(i => !i);
        if (free !== -1) { character.items[free] = item(name, 0, (G.items[name] || {}).s ? { q: q || 1 } : {}); character.esize--; character.gold -= ((G.items[name] || {}).g || 0) * (q || 1); }
        return Promise.resolve({ success: true });
    };
    // Item changes like the server: a dismantle removes the copy, a compound turns three copies into one a level up, an
    // upgrade raises the level (and uses the scroll), an exchange uses one.
    const take = (i, n) => { const it = character.items[i]; if (!it) return; if ((it.q || 1) > (n || 1)) it.q -= (n || 1); else { character.items[i] = null; character.esize++; } };
    g.dismantle = function (i) { calls.push(["dismantle", i]); take(i); return Promise.resolve({ success: true }); };
    g.compound = function (a, b, c, scroll, offering, only) {
        calls.push(["compound", a, b, c, scroll, offering || null, !!only]);
        if (only) return Promise.resolve({ success: true, chance: 0.9 });
        const it = character.items[a]; take(b); take(c); if (scroll !== undefined && scroll !== null) take(scroll);
        if (it) it.level = (it.level || 0) + 1;
        return Promise.resolve({ success: true });
    };
    g.upgrade = function (i, scroll, offering, only) {
        calls.push(["upgrade", i, scroll, offering || null, !!only]);
        if (only) return Promise.resolve({ success: true, chance: 0.9 });
        const it = character.items[i]; if (scroll !== undefined && scroll !== null) take(scroll);
        if (it) it.level = (it.level || 0) + 1;
        return Promise.resolve({ success: true });
    };
    g.exchange = function (i) { calls.push(["exchange", i]); take(i); return Promise.resolve({ success: true }); };
    g.get_secondhands = () => Promise.resolve([]);
    g.item_grade = (it) => { const d = G.items[it.name] || {}; return d.grades ? (it.level >= d.grades[1] ? 2 : it.level >= d.grades[0] ? 1 : 0) : 0; };
    g.calculate_item_value = (it) => ((G.items[it.name] || {}).g || 0) * (1 + (it.level || 0));
    g.is_moving = () => false;
    g.is_on_cooldown = () => false;
    g.locate_item = (n) => character.items.findIndex(i => i && i.name === n);
    g.quantity = (n) => character.items.reduce((s, i) => s + (i && i.name === n ? (i.q || 1) : 0), 0);
    g.get_player = n => (sc.players || {})[n] || null;
    g.parent = { entities: {}, socket: { on: () => {}, off: () => {}, emit: (n, d) => calls.push(["emit", n, JSON.stringify(d)]) },
        calculate_item_properties: (it) => Object.assign({}, G.items[it.name] || {}), S: {}, server_region: "EU", server_identifier: "IV",
        distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y) };
    g.smart = { moving: false };
    g.setInterval = () => 0;
    g.setTimeout = (fn, ms) => { calls.push(["setTimeout", ms || 0]); NOW += ms || 0; realImmediate(fn); return 0; }; // timers fire at once, the clock moves on
    let sleeps = 0;
    g.sleep = (ms) => { NOW += ms || 0; return ++sleeps > 400 ? Promise.reject({ reason: "test: too many waits" }) : Promise.resolve(); };
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.send_cm = () => {};
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]lib[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util0 = require(path.join(root, "bot", "lib", "util.js"));
    const util = Object.assign({}, util0, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]) });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = "VizPri"; config.merchant = "VizMerch";
    config.characters = { VizPri: { role: "fighter" }, VizWar: { role: "fighter" }, VizMage: { role: "fighter" }, VizMerch: { role: "merchant" } };
    config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"], merchant: "VizMerch" });
    const handlers = {};
    const comms = { on: (type, fn) => { handlers[type] = fn; }, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data).slice(0, 200)]) };
    return { ctx: { config, util, comms }, handlers };
}

const SCENARIOS = [
    { name: "a wish from the bag", bank: { items0: [] }, items: [item("wbook0", 2)], msgs: [["wishes", { wishes: [{ name: "wbook0", level: 2 }], ctype: "priest" }, "VizPri"]], rounds: 3 },
    { name: "a wish from the bank", bank: { items0: [item("intring", 2)], gold: 0 }, me: { map: "bank", in: "bank" },
        msgs: [["wishes", { wishes: [{ name: "intring", level: 2 }], ctype: "mage" }, "VizMage"]], rounds: 3 },
    { name: "a wish to develop (buy +0, upgrade)", items: [item("scroll0", 0, { q: 20 }), item("scroll1", 0, { q: 5 })],
        msgs: [["wishes", { wishes: [{ name: "helmet", level: 5 }], ctype: "warrior" }, "VizWar"]], rounds: 4 },
    { name: "spare copies to compound", items: [item("hpamulet", 0), item("hpamulet", 0), item("hpamulet", 0), item("cscroll0", 0, { q: 10 })], rounds: 3 },
    { name: "drop weapons to dismantle", items: [item("fireblade", 0), item("firestaff", 0)], rounds: 3 },
    { name: "boxes to exchange", items: [item("gem0", 0, { q: 5 }), item("seashell", 0, { q: 30 }), item("armorbox", 0, { q: 2 })], rounds: 3 },
    { name: "worn gear reports and gear goals", items: [item("scroll0", 0, { q: 50 })],
        msgs: [["gold", { g: 1000000 }, "VizPri"], ["wishes", { wishes: [], worn: { mainhand: item("staff", 3), helmet: item("helmet", 4) }, ctype: "priest" }, "VizPri"]], rounds: 4 },
];

async function run(load, sc) {
    const calls = [];
    const w = world(sc, calls);
    let ws;
    try { ws = load()(w.ctx); } catch (e) { calls.push(["create threw", String(e && e.stack).slice(0, 300)]); return calls; }
    (sc.msgs || []).forEach(m => { try { w.handlers[m[0]] && w.handlers[m[0]](JSON.parse(JSON.stringify(m[1])), m[2]); } catch (e) { calls.push(["msg threw", m[0], String(e && e.message)]); } });
    for (let i = 0; i < sc.rounds; i++) {
        NOW += 30000;
        // A work round that never ends (an await the fake game never answers) is cut after 5 s of real time.
        const cut = new Promise(r => realTimeout(() => r("TIMEOUT"), 5000));
        try { calls.push(["work", await Promise.race([ws.work(), cut])]); } catch (e) { calls.push(["work threw", String(e && (e.message || e.reason))]); }
        if (calls[calls.length - 1][1] === "TIMEOUT") { if (process.env.SHOW) console.log("    TIMEOUT after: " + JSON.stringify(calls.slice(-6)).slice(0, 600)); break; }
    }
    ["isReserved", "ownedCount", "needsCopy"].forEach(n => { if (typeof ws[n] === "function") { try { calls.push([n, JSON.stringify(ws[n](sc.items && sc.items[0] ? sc.items[0] : item("hpot0", 0)))]); } catch (e) { calls.push([n + " threw", String(e.message)]); } } });
    try { calls.push(["report", JSON.stringify(ws.report ? ws.report() : null).slice(0, 300)]); } catch (e) { calls.push(["report threw", String(e.message)]); }
    return calls;
}

(async function () {
    for (const sc of SCENARIOS) {
        // v1.238.3 adds a journal line when the team XP value is unknown (the old code was silent) - left out here.
        const o = await run(loadOld, sc), n = (await run(loadNew, sc)).filter(c => !(c[0] === "log" && /team XP value unknown/.test(c[2] || "")));
        const same = JSON.stringify(o) === JSON.stringify(n);
        const errs = o.filter(c => /threw/.test(c[0]));
        check(same && o.length > 3, sc.name + " (" + o.length + " records, " + errs.length + " errors in both)");
        if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
        if (process.env.SHOW) { errs.slice(0, 3).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 300))); o.filter(c => !/^(set|status)$/.test(c[0])).slice(0, 12).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 200))); }
    }
    // v1.238.5 (new only): the fighters' XP values survive a merchant restart (every Ponty hop reopens it) and a fighter's
    // first report after its own restart (no XP rate yet) does not wipe its last known rate.
    {
        const K = "workshop_values:VizMerch", T0 = 1795550000000;
        let calls = [];
        let w = world({ store: {} }, calls);
        loadNew()(w.ctx);
        w.handlers.wishes({ wishes: [], ctype: "warrior", value: { xpPerHour: 20000000, levelPower: 1.01, xpPower: 0.06 } }, "VizWar");
        const saved = g.get(K);
        check(saved && saved.VizWar && saved.VizWar.xpPower === 0.06 && saved.VizWar.xpAt === T0, "values: a fighter's XP rate is stored");
        // the merchant restarts 10 min later (a Ponty hop): the stored values come back
        calls = [];
        w = world({ store: { [K]: saved } }, calls);
        NOW = T0 + 10 * 60 * 1000;
        loadNew()(w.ctx);
        // the warrior restarted too: its first report has no XP rate - the last known one stays
        w.handlers.wishes({ wishes: [], ctype: "warrior", value: { xpPerHour: null, levelPower: 1.01, xpPower: null } }, "VizWar");
        const kept = g.get(K);
        check(kept.VizWar.xpPower === 0.06 && kept.VizWar.xpKept === true && kept.VizWar.xpAt === T0, "values: after a restart the last rate stays for a fighter that reports none yet");
        // a new real rate replaces it
        w.handlers.wishes({ wishes: [], ctype: "warrior", value: { xpPerHour: 25000000, levelPower: 1.01, xpPower: 0.07 } }, "VizWar");
        check(g.get(K).VizWar.xpPower === 0.07 && !g.get(K).VizWar.xpKept, "values: a new rate replaces the kept one");
        // older than 30 min: not loaded, and an empty report stays empty
        calls = [];
        w = world({ store: { [K]: saved } }, calls);
        NOW = T0 + 31 * 60 * 1000;
        loadNew()(w.ctx);
        w.handlers.wishes({ wishes: [], ctype: "warrior", value: { xpPerHour: null, levelPower: 1.01, xpPower: null } }, "VizWar");
        check(g.get(K).VizWar.xpPower === null, "values: a rate older than 30 min is not kept");
    }
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
