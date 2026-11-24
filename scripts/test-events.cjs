// Old vs new for bot_events (module plan, stage 4c): the old single file (from a git ref) and the new facade + parts
// run in the same fake game with the real game data (G) and the real config. Each scenario sets a world (bosses in
// sight, server events, stored search times, member messages) and ticks the module; every return value, comms message,
// storage write, walk, stop, join, bus value and log line is recorded, and old and new must record exactly the same.
// Run: node scripts/test-events.cjs <G.js with "var G = {...}"> [git ref of the old core/events.js, default 1f64ea5]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "1f64ea5";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function loadOld() {
    const src = execSync("git show " + ref + ":bot/core/events.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    const file = path.join(root, "bot", "core", "events-old.js");
    const m = new Module(file);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}
function loadNew() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/](core|encounters|events|team)[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", "core", "events.js"));
}

let NOW;
Date.now = () => NOW;
let rnd;
Math.random = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
const tick = () => new Promise(r => setImmediate(r));

function boss(id, mtype, x, y, map, extra) {
    const d = G.monsters[mtype];
    return Object.assign({ id, type: "monster", mtype, x, y, real_x: x, real_y: y, map, in: map, hp: d.hp, max_hp: d.hp, level: 1, attack: d.attack,
        frequency: d.frequency, range: d.range, speed: d.speed, armor: d.armor || 0, resistance: d.resistance || 0, damage_type: d.damage_type,
        xp: d.xp, visible: true, dead: false, target: null, s: {} }, extra || {});
}

function world(sc, calls) {
    NOW = 1795550000000;
    rnd = 4242;
    const store = JSON.parse(JSON.stringify(sc.store || {}));
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k, JSON.stringify(v).slice(0, 200)]); return true; };
    g.character = Object.assign({ name: "VizPri", id: "VizPri", ctype: "priest", type: "character", level: 69, hp: 6000, max_hp: 6000, mp: 3000, max_mp: 3000,
        x: 0, y: 0, real_x: 0, real_y: 0, map: "main", in: "main", speed: 60, range: 160, attack: 600, frequency: 1, armor: 300, resistance: 300,
        rip: false, s: {}, slots: {}, items: [], party: "VizPri", heal: 800, damage_type: "magical", luckm: 1, goldm: 1, xpm: 1 }, sc.me || {});
    const ents = {};
    (sc.monsters || []).forEach(m => { ents[m.id] = JSON.parse(JSON.stringify(m)); });
    g.parent = { entities: ents, socket: { on: (n) => calls.push(["socket.on", n]), off: (n) => calls.push(["socket.off", n]) },
        distance: (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - 20), S: {} };
    g.server = { status: JSON.parse(JSON.stringify(sc.status || {})) };
    g.smart = { moving: !!sc.pathing, map: null, x: null, y: null };
    g.is_moving = () => !!sc.moving;
    g.can_move_to = () => true;
    g.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
    g.get_player = n => ents[n] || null;
    g.get_nearest_monster = (o) => {
        let best = null, bd = Infinity;
        Object.values(ents).forEach(e => { if (e.type !== "monster" || e.dead || (o && o.type && e.mtype !== o.type)) return; const d = Math.hypot(e.x - character.x, e.y - character.y); if (d < bd) { bd = d; best = e; } });
        return best;
    };
    g.smart_move = (d) => { calls.push(["smart_move", JSON.stringify(d)]); return sc.walkFails ? Promise.reject({ reason: "interrupted" }) : Promise.resolve(); };
    g.stop = (w) => { calls.push(["stop", w || null]); };
    g.join = (n) => { calls.push(["join", n]); return Promise.resolve(); };
    g.accept_magiport = (n) => { calls.push(["accept_magiport", n]); return Promise.resolve(); };
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.setTimeout = (fn) => { calls.push(["setTimeout"]); return 0; };
    let sleeps = 0; // a search waits with sleep(): the clock moves on, and after 60 waits the walk is "interrupted"
    g.sleep = (ms) => { NOW += ms || 0; calls.push(["sleep", ms]); return ++sleeps > 60 ? Promise.reject({ reason: "test: too many waits" }) : Promise.resolve(); };
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]lib[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util = require(path.join(root, "bot", "lib", "util.js"));
    const u = Object.assign({}, util, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]) });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = sc.leader || "VizPri";
    config.characters = { VizPri: {}, VizWar: {}, VizMage: {}, VizMerch: {} };
    config.merchant = "VizMerch";
    config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"] });
    Object.assign(config.events, sc.events || {});
    const isMember = character.name !== config.leader;
    const party = {
        enabled: true, isLeader: !isMember, isMember: isMember,
        memberNames: () => ["VizPri", "VizWar", "VizMage"], inParty: n => ["VizPri", "VizWar", "VizMage"].includes(n),
        leaderInfo: () => sc.lead || null, teamGoal: () => sc.goal || null, goalLabel: (gl) => gl ? gl.kind + ":" + (gl.name || "") : "-",
        wasAtGoal: () => !!sc.wasAt, waitMaxMs: 60000, waitDistance: 400, detached: () => false,
    };
    const handlers = {};
    const comms = { on: (type, fn) => { handlers[type] = fn; calls.push(["comms.on", type]); }, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data).slice(0, 300)]) };
    const busProv = {};
    const bus = { provide: (n, fn) => { busProv[n] = fn; }, get: (n) => (busProv[n] ? busProv[n]() : null) };
    if (sc.teamWaitAt) bus.provide("teamWaitAt", () => NOW - 500);
    const war = Object.assign({}, util.combatStats(), { name: "VizWar", ctype: "warrior", max_hp: 12000, hp: 12000, armor: 450, resistance: 200, attack: 1000, heal: 0 });
    const mage = Object.assign({}, util.combatStats(), { name: "VizMage", ctype: "mage", max_hp: 5000, hp: 5000, armor: 150, resistance: 200, attack: 1400, heal: 0 });
    const reports = { VizWar: { s: war, at: NOW }, VizMage: { s: mage, at: NOW } };
    const teamStats = { shareStats: () => calls.push(["shareStats"]), teamStats: () => [util.combatStats(), war, mage], reports };
    const ctx = { config, util: u, comms, party, bus, teamStats, cave: { active: () => !!sc.manual } };
    return { ctx, handlers, bus };
}

const SCENARIOS = [
    { name: "leader: a Phoenix in sight", monsters: [boss("p1", "phoenix", 200, 50, "main")], ticks: 4 },
    { name: "leader: boss search due (stored times in the past)", store: { "bot_boss_search:VizPri": { phoenix: 1, mvampire: 1 } }, ticks: 4, events: { scout: { enabled: false } } },
    { name: "leader: a member reports a sighting, then its death", ticks: 3,
        msgs: [[1, "bosssight", { name: "mvampire", id: "mv1", map: "cave", x: -200, y: -1100, hp: 1, at: 0 }, "VizWar"], [2, "bossdeath", { name: "mvampire", id: "mv1" }, "VizWar"]] },
    { name: "member: search job from the leader", me: { name: "VizWar", ctype: "warrior" }, leader: "VizPri", ticks: 3,
        msgs: [[0, "searchjob", { id: "j1", name: "phoenix", spots: [{ map: "main", x: 100, y: 100 }] }, "VizPri"], [2, "searchstop", { id: "j1" }, "VizPri"]] },
    { name: "a join event live (crabxx) and the Goo Brawl", status: { crabxx: { live: true, map: "main", x: -1000, y: 1800 }, goobrawl: { live: true } }, ticks: 3 },
    { name: "Witch's Cipher gathering window", status: { witchcipher: { live: true, gather_end: new Date(1795550000000 + 15 * 60000).toISOString(), map: "main" } }, ticks: 2 },
    { name: "manual mode, team waiting", manual: true, teamWaitAt: true, monsters: [boss("s1", "skeletor", 300, 0, "main")], ticks: 2 },
];

async function run(load, sc) {
    const calls = [];
    const w = world(sc, calls);
    let ev;
    try { ev = load()(w.ctx); } catch (e) { calls.push(["create threw", String(e && e.message)]); return calls; }
    const rec = (what, fn) => { try { const r = fn(); calls.push([what, JSON.stringify(r === undefined ? null : r)]); } catch (e) { calls.push([what + " threw", String(e && e.message)]); } };
    for (let i = 0; i < sc.ticks; i++) {
        NOW += 6000;
        (sc.msgs || []).filter(m => m[0] === i).forEach(m => rec("msg " + m[1], () => { const d = JSON.parse(JSON.stringify(m[2])); if (d.at === 0) d.at = NOW; return w.handlers[m[1]](d, m[3]); }));
        rec("tick", () => ev.tick());
        await tick(); await tick();
        rec("current", () => ev.current());
        rec("searchJob", () => ev.searchJob());
        rec("bus boss", () => w.bus.get("boss"));
        rec("bus search", () => w.bus.get("search"));
        rec("splitSearching", () => ev.splitSearching());
        rec("runnerOut", () => ev.runnerOut());
        rec("bossBusy", () => ev.bossBusy());
        rec("engaging", () => ev.engaging());
        rec("cipherActive", () => ev.cipherActive());
        rec("cipherFarm", () => ev.cipherFarm());
        rec("soloOk phoenix", () => ev.soloOk("phoenix"));
        rec("publishScoutPlan", () => ev.publishScoutPlan());
    }
    rec("searchNow", () => ev.searchNow("phoenix"));
    rec("acceptMagiport", () => ev.acceptMagiport("VizMage"));
    rec("onOwnDeath", () => ev.onOwnDeath("phoenix"));
    await tick();
    return calls;
}

(async function () {
    for (const sc of SCENARIOS) {
        const o = await run(loadOld, sc), n = await run(loadNew, sc);
        const same = JSON.stringify(o) === JSON.stringify(n);
        const threw = o.filter(c => /threw/.test(c[0]));
        check(same, sc.name + " (" + o.length + " records, " + threw.length + " threw in both)");
        if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
        if (process.env.SHOW) o.filter(c => /threw|^tick|log|send|smart_move|join|accept/.test(c[0])).slice(0, 14).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 220)));
    }
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
