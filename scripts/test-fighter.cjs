// Old vs new for bot_fighter (module plan, stage 5): the old single file core/fighter.js (from a git ref) and the new
// combat/fighter.js + parts run in the same fake game with the real game data (G), the real config, and the real party
// and targeting modules (one fresh instance per run). The fighter is started and its two loops (tick, strike loop) run
// for a fixed number of sleeps with a fake clock; every game call (moves, attacks, skills, potions, loot, respawn),
// comms message, storage write, status and log line is recorded, and old and new must record exactly the same.
// Run: node scripts/test-fighter.cjs <G.js with "var G = {...}"> [git ref of the old core/fighter.js, default 087ca1c]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "087ca1c";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function freshRequire(rel) {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]/.test(k) && !/config\.js$/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", rel));
}
function loadOld() {
    const src = execSync("git show " + ref + ":bot/core/fighter.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    const file = path.join(root, "bot", "core", "fighter-old.js");
    const m = new Module(file);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(src, file);
    return m.exports;
}
function loadNew() { return freshRequire("combat/fighter.js"); }

let NOW;
Date.now = () => NOW;
let rnd;
Math.random = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };

function mon(id, mtype, x, y, extra) {
    const d = G.monsters[mtype];
    return Object.assign({ id, type: "monster", mtype, x, y, real_x: x, real_y: y, map: "desertland", in: "desertland", hp: d.hp, max_hp: d.hp, level: 1,
        attack: d.attack, frequency: d.frequency, range: d.range, speed: d.speed, armor: d.armor || 0, resistance: d.resistance || 0,
        damage_type: d.damage_type, xp: d.xp, visible: true, dead: false, target: null, s: {} }, extra || {});
}

function world(sc, calls) {
    NOW = 1795550000000;
    rnd = 777;
    const store = JSON.parse(JSON.stringify(sc.store || {}));
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k]); return true; };
    g.character = Object.assign({ name: "VizPri", id: "VizPri", ctype: "priest", type: "character", level: 69, hp: 6000, max_hp: 6000, mp: 3000, max_mp: 3000,
        x: 300, y: -1400, real_x: 300, real_y: -1400, map: "desertland", in: "desertland", speed: 60, range: 160, attack: 600, frequency: 1, armor: 300,
        resistance: 300, rip: false, s: {}, slots: {}, items: [{ name: "hpot1", q: 50 }, { name: "mpot1", q: 50 }], courage: 10, mcourage: 10, pcourage: 10,
        party: "VizPri", target: null, luckm: 1, goldm: 1, xpm: 1, heal: 800, damage_type: "magical", esize: 42, isize: 42, gold: 1000, moving: false }, sc.me || {});
    const ents = {};
    (sc.monsters || []).forEach(m => { ents[m.id] = JSON.parse(JSON.stringify(m)); });
    (sc.players || []).forEach(p => { ents[p.id] = Object.assign({ type: "character", map: "desertland", in: "desertland", rip: false, s: {}, hp: 1, max_hp: 1 }, p); });
    g.parent = { entities: ents, socket: { on: (n) => calls.push(["socket.on", n]), off: (n) => calls.push(["socket.off", n]) },
        distance: (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - 20), next_skill: {}, S: {}, character: g.character, chests: JSON.parse(JSON.stringify(sc.chests || {})) };
    g.server = { status: {} };
    g.smart = { moving: false };
    g.is_moving = (e) => !!(e && e.moving);
    g.can_move_to = () => true;
    g.can_move = () => true;
    g.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
    g.get_player = n => ents[n] || null;
    g.get_monster = id => ents[id] || null;
    g.get_targeted_monster = () => (character.target && ents[character.target]) || null;
    g.change_target = (t) => { character.target = t ? t.id : null; calls.push(["change_target", t ? t.id : null]); };
    g.get_nearest_monster = (o) => {
        let best = null, bd = Infinity;
        Object.values(ents).forEach(e => { if (e.type !== "monster" || e.dead || (o && o.type && e.mtype !== o.type)) return; const d = Math.hypot(e.x - character.x, e.y - character.y); if (d < bd) { bd = d; best = e; } });
        return best;
    };
    g.is_in_range = (e) => Math.hypot(e.x - character.x, e.y - character.y) <= character.range;
    g.is_on_cooldown = (s) => (sc.cooldowns || []).includes(s);
    g.is_disabled = () => false;
    g.can_attack = () => true;
    g.attack = (t) => { calls.push(["attack", t && t.id]); return Promise.resolve(); };
    g.heal = (t) => { calls.push(["heal", t && (t.id || t.name)]); return Promise.resolve(); };
    g.use_skill = (n, t) => { calls.push(["skill", n, t && (t.id || t.name || JSON.stringify(t))]); return Promise.resolve(); };
    g.reduce_cooldown = () => {};
    g.loot = (id) => { calls.push(["loot", id || null]); };
    g.respawn = () => { calls.push(["respawn"]); return Promise.resolve(); };
    g.xmove = (x, y) => { calls.push(["xmove", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.move = (x, y) => { calls.push(["move", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.smart_move = (d) => { calls.push(["smart_move", JSON.stringify(d)]); return Promise.resolve(); };
    g.stop = (w) => { calls.push(["stop", w || null]); };
    g.interact = (n) => { calls.push(["interact", n]); };
    g.send_party_invite = () => Promise.resolve(); g.leave_party = () => Promise.resolve(); g.accept_party_invite = () => Promise.resolve();
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.send_cm = () => {};
    g.start_character = () => {};
    g.BOT_DPS_REPORT = null; g.BOT_KILLS_REPORT = null;
    let sleeps = 0;
    g.sleep = (ms) => { if (++sleeps > sc.sleeps) return new Promise(() => {}); NOW += ms || 0; return Promise.resolve(); };
    const util0 = freshRequire("lib/util.js");
    const util = Object.assign({}, util0, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]), heartbeat: () => {} });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = sc.leader || "VizPri";
    config.characters = { VizPri: {}, VizWar: {}, VizMage: {} };
    config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"], farm: {} });
    config.phase = "party";
    config.phases = Object.assign({}, config.phases, { party: Object.assign({}, (CONFIG.phases || {}).party, { party: sc.solo ? ["VizPri"] : ["VizPri", "VizWar", "VizMage"] }) });
    const handlers = {};
    const comms = { on: (type, fn) => { handlers[type] = fn; }, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data).slice(0, 200)]) };
    const bus = freshRequire("lib/bus.js")();
    const ctx = { config, util, comms, bus };
    ctx.party = require(path.join(root, "bot", "team", "party.js"))({ config, util, comms, bus });
    ctx.teamStats = { teamStats: () => [util.combatStats()], shareStats: () => {}, reports: {} };
    ctx.cave = { active: () => false, caveManual: () => false, paused: () => false, mayFight: () => true, inCave: () => false };
    ctx.hunts = { tick: () => "ok", abort: () => {}, target: () => null, blocked: () => [] };
    ctx.drops = { target: () => null };
    ctx.events = { current: () => sc.event || null, tick: () => "ok", bossBusy: () => false, cipherActive: () => false, publishScoutPlan: () => {},
        runnerOut: () => null, splitSearching: () => false, engaging: () => false, onOwnDeath: (k) => calls.push(["events.onOwnDeath", k]), soloOk: () => true, cipherFarm: () => null, searchJob: () => false };
    bus.provide("boss", ctx.events.current); bus.provide("search", () => false);
    ctx.targeting = require(path.join(root, "bot", "core", "targeting.js"))(ctx);
    ctx.gear = { tick: () => {} };
    ctx.supply = { tick: () => "ok", inCave: () => false };
    const cls = {
        name: "priest",
        survive: () => { calls.push(["cls.survive"]); return false; },
        support: () => false,
        fight: (t) => { calls.push(["cls.fight", t && t.id]); return false; },
        move: (t) => false,
        always: () => {},
    };
    return { ctx, cls, handlers };
}

const ROUTES = [{ monster: "gscorpion", map: "desertland", safe: true, cycle: 30 }];
const TEAM = [{ id: "VizWar", name: "VizWar", ctype: "warrior", x: 320, y: -1410, real_x: 320, real_y: -1410, hp: 12000, max_hp: 12000, party: "VizPri" },
    { id: "VizMage", name: "VizMage", ctype: "mage", x: 290, y: -1380, real_x: 290, real_y: -1380, hp: 5000, max_hp: 5000, party: "VizPri" }];
const SCENARIOS = [
    { name: "farming: a scorpion in range", sleeps: 30, players: TEAM, monsters: [mon("m1", "gscorpion", 380, -1420), mon("m2", "gscorpion", 700, -1300)] },
    { name: "farming: walk to a far scorpion", sleeps: 30, players: TEAM, monsters: [mon("m1", "gscorpion", 900, -1100)] },
    { name: "low HP with a monster on us", sleeps: 25, me: { hp: 1500, mp: 400 }, monsters: [mon("m1", "gscorpion", 330, -1400, { target: "VizPri" })] },
    { name: "dead: respawn", sleeps: 20, me: { rip: true, hp: 0 } },
    { name: "a member on us: team wait / spacing", sleeps: 25, monsters: [mon("m1", "gscorpion", 320, -1380, { target: "VizWar" })],
        players: [{ id: "VizWar", name: "VizWar", ctype: "warrior", x: 340, y: -1390, real_x: 340, real_y: -1390, hp: 9000, max_hp: 12000, party: "VizPri" }] },
    { name: "solo, nothing in sight", solo: true, sleeps: 20 },
    // 2026-11-24: two team wipes by Fire Roamers next to the gscorpion spot - old and new must pick the same
    { name: "a grown Fire Roamer passing by (free)", sleeps: 25, players: TEAM, monsters: [mon("m1", "gscorpion", 380, -1420), mon("f1", "fireroamer", 520, -1200, { level: 8 })] },
    { name: "a grown Fire Roamer on the mage", sleeps: 25, players: TEAM, monsters: [mon("m1", "gscorpion", 380, -1420), mon("f1", "fireroamer", 450, -1300, { level: 8, target: "VizMage" })] },
    { name: "a chest after a kill", sleeps: 20, players: TEAM, chests: { c1: { x: 310, y: -1400, map: "desertland", items: 2, skin: "chest3" } } },
    { name: "member: following the leader", sleeps: 25, me: { name: "VizWar", id: "VizWar", ctype: "warrior" }, players: [{ id: "VizPri", name: "VizPri", ctype: "priest", x: 600, y: -1200, real_x: 600, real_y: -1200, hp: 6000, max_hp: 6000, party: "VizPri" }], monsters: [mon("m1", "gscorpion", 620, -1210, { target: "VizPri" })] },
];

async function run(load, sc) {
    const calls = [];
    sc.routes = ROUTES;
    const w = world(sc, calls);
    g.get_progression = () => ({ routes: ROUTES });
    let f;
    try { f = load()(w.ctx, w.cls); } catch (e) { calls.push(["create threw", String(e && e.stack).slice(0, 300)]); return calls; }
    try { f.start(); } catch (e) { calls.push(["start threw", String(e && e.message)]); }
    for (let i = 0; i < 400; i++) await new Promise(r => setImmediate(r));
    calls.push(["strike", typeof w.ctx.strike, w.ctx.strike ? Object.keys(w.ctx.strike).join(",") : ""]);
    calls.push(["bus memberLuck", JSON.stringify(w.ctx.bus.get("memberLuck"))]);
    calls.push(["bus teamWaitAt", w.ctx.bus.get("teamWaitAt")]);
    calls.push(["dps report", typeof g.BOT_DPS_REPORT]);
    f.stop();
    return calls;
}

(async function () {
    for (const sc of SCENARIOS) {
        const o = await run(loadOld, sc), n = await run(loadNew, sc);
        const same = JSON.stringify(o) === JSON.stringify(n);
        const errs = o.filter(c => /threw|tick error/.test(JSON.stringify(c)));
        check(same && o.length > 10, sc.name + " (" + o.length + " records, " + errs.length + " errors in both)");
        if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
        if (process.env.SHOW) { errs.slice(0, 3).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 300))); o.filter(c => !/^(set|status|socket)/.test(c[0])).slice(0, 14).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 200))); }
    }
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
