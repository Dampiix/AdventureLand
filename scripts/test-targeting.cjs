// Old vs new for bot_targeting (module plan, stage 4b): the old single file (from a git ref) and the new facade + parts
// run in the same fake game with the real game data (G) and the real config. Each scenario drives farm choice, target
// picking and the safety checks; every return value, comms message, storage write, move and log line is recorded, and
// old and new must record exactly the same.
// Run: node scripts/test-targeting.cjs <G.js with "var G = {...}"> [git ref of the old core/targeting.js, default 3aff68b]
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[3] || "3aff68b";

const g = globalThis;
g.window = g;
new Function(fs.readFileSync(process.argv[2], "utf8") + "\nglobalThis.G = G;")();
g.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function loadOld() {
    const src = execSync("git show " + ref + ":bot/core/targeting.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 })
        .replace(/require\("\.\.\/(lib|safety)\/([\w-]+)\.js"\)/g, (m, d, f) => "require(" + JSON.stringify(path.join(root, "bot", d, f + ".js")) + ")");
    const m = new Module(path.join(root, "bot", "core", "targeting-old.js"));
    m.filename = path.join(root, "bot", "core", "targeting-old.js");
    m.paths = Module._nodeModulePaths(path.join(root, "bot", "core"));
    m._compile(src, m.filename);
    return m.exports;
}
function loadNew() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/](core|safety|farming)[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", "core", "targeting.js"));
}

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
    rnd = 12345;
    const store = Object.assign({}, sc.store || {});
    g.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
    g.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); calls.push(["set", k]); return true; };
    g.character = Object.assign({ name: "VizPri", id: "VizPri", ctype: "priest", type: "character", level: 69, hp: 6000, max_hp: 6000, mp: 3000, max_mp: 3000,
        x: 300, y: -1400, real_x: 300, real_y: -1400, map: "desertland", in: "desertland", speed: 60, range: 160, attack: 600, frequency: 1, armor: 300,
        resistance: 300, rip: false, s: {}, slots: {}, items: [], courage: 10, mcourage: 10, pcourage: 10, party: "VizPri", target: null,
        luckm: 1, goldm: 1, xpm: 1, heal: 800, damage_type: "magical", esize: 42, isize: 42 }, sc.me || {});
    const ents = {};
    (sc.monsters || []).forEach(m => { ents[m.id] = JSON.parse(JSON.stringify(m)); });
    (sc.players || []).forEach(p => { ents[p.id] = Object.assign({ type: "character", map: "desertland", in: "desertland", rip: false, s: {} }, p); });
    g.parent = { entities: ents, socket: { on: () => {}, off: () => {} }, distance: (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - 20),
        next_skill: {}, S: {} };
    g.smart = { moving: !!sc.pathing };
    g.is_moving = () => !!sc.moving;
    g.can_move_to = () => true;
    g.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
    g.get_player = n => ents[n] || null;
    g.get_monster = id => ents[id] || null;
    g.get_targeted_monster = () => (character.target && ents[character.target]) || null;
    g.get_nearest_monster = (o) => {
        let best = null, bd = Infinity;
        Object.values(ents).forEach(e => { if (e.type !== "monster" || e.dead || (o && o.type && e.mtype !== o.type)) return; const d = Math.hypot(e.x - character.x, e.y - character.y); if (d < bd) { bd = d; best = e; } });
        return best;
    };
    g.is_in_range = (e) => Math.hypot(e.x - character.x, e.y - character.y) <= character.range;
    g.is_on_cooldown = () => false;
    g.xmove = (x, y) => { calls.push(["xmove", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.move = (x, y) => { calls.push(["move", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.stop = (w) => { calls.push(["stop", w || null]); };
    g.get_progression = () => ({ routes: sc.routes || [] });
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.send_cm = () => {};
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]lib[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    const util = require(path.join(root, "bot", "lib", "util.js"));
    const log = util.log;
    const u = Object.assign({}, util, { log: (tag, text) => calls.push(["log", tag, text]), status: (t) => calls.push(["status", t]) });
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.leader = sc.leader || "VizPri";
    config.characters = { VizPri: {}, VizWar: {}, VizMage: {} };
    config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"], farm: {} });
    Object.assign(config.targeting, sc.targeting || {});
    const isMember = character.name !== config.leader;
    const party = {
        enabled: !sc.solo, isLeader: !isMember && !sc.solo, isMember: isMember && !sc.solo,
        memberNames: () => sc.solo ? [] : ["VizPri", "VizWar", "VizMage"], inParty: n => !sc.solo && ["VizPri", "VizWar", "VizMage"].includes(n),
        leaderInfo: () => sc.lead || null, detached: () => false, spread: () => !!sc.spread, nearLeader: () => true, leash: 400, travelDest: () => null,
    };
    const comms = { on: (type) => calls.push(["comms.on", type]), send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data)]) };
    const war = Object.assign({}, util.combatStats ? util.combatStats() : {}, { name: "VizWar", ctype: "warrior", max_hp: 12000, hp: 12000, armor: 450, resistance: 200, attack: 1000 });
    const ctx = {
        config, util: u, comms, party,
        events: { current: () => sc.event || null, soloOk: () => true, cipherFarm: () => null },
        hunts: { target: () => null, blocked: () => [] },
        drops: { target: () => null },
        cave: { active: () => false, caveManual: () => false, mayFight: () => true },
        teamStats: { teamStats: () => [util.combatStats(), war] },
    };
    return ctx;
}

const RED = { id: "m1", mtype: "gscorpion" };
const SCENARIOS = [
    { name: "leader, solo route: farm choice and a free scorpion", routes: [{ monster: "gscorpion", map: "desertland", safe: true, cycle: 30 }, { monster: "bee", map: "main", safe: true, cycle: 20 }],
        monsters: [mon("m1", "gscorpion", 380, -1420), mon("m2", "gscorpion", 700, -1300)], steps: 6 },
    { name: "a monster on a member is picked", routes: [{ monster: "gscorpion", map: "desertland", safe: true, cycle: 30 }],
        monsters: [mon("m1", "gscorpion", 380, -1420, { target: "VizWar" }), mon("m2", "gscorpion", 330, -1390)],
        players: [{ id: "VizWar", name: "VizWar", x: 360, y: -1420, real_x: 360, real_y: -1420, hp: 12000, max_hp: 12000, ctype: "warrior" }], steps: 4 },
    { name: "member: the leader's farm target and target", leader: "VizWar", lead: { map: "desertland", x: 300, y: -1400, farm: "gscorpion", target: "m1", at: 0 },
        monsters: [mon("m1", "gscorpion", 380, -1420, { target: "VizWar" })], steps: 4 },
    { name: "booboo rage zone and spot check", me: { map: "spookytown", in: "spookytown", x: 0, y: 0, real_x: 0, real_y: 0 },
        routes: [{ monster: "booboo", map: "spookytown", safe: true, cycle: 60 }], steps: 5, zones: true },
    { name: "boss in sight held for the team", routes: [{ monster: "gscorpion", map: "desertland", safe: true, cycle: 30 }],
        monsters: [mon("b1", "phoenix", 500, -1400, { map: "desertland" })], steps: 4 },
    { name: "solo, no guide data", solo: true, routes: [], monsters: [mon("m1", "gscorpion", 380, -1420)], steps: 3 },
    { name: "a strange player on our spot", routes: [{ monster: "gscorpion", map: "desertland", safe: true, cycle: 30 }],
        monsters: [mon("m1", "gscorpion", 380, -1420, { target: "Stranger" })],
        players: [{ id: "Stranger", name: "Stranger", x: 390, y: -1430, real_x: 390, real_y: -1430, hp: 5000, max_hp: 5000, ctype: "warrior", party: null }], steps: 8 },
];

function run(load, sc) {
    const calls = [];
    const ctx = world(sc, calls);
    const create = load();
    let tg;
    try { tg = create(ctx); } catch (e) { calls.push(["create threw", String(e && e.message)]); return calls; }
    const rec = (what, fn) => { try { const r = fn(); calls.push([what, JSON.stringify(r === undefined ? null : r, (k, v) => v instanceof Set ? [...v] : v)]); } catch (e) { calls.push([what + " threw", String(e && e.message)]); } };
    for (let i = 0; i < sc.steps; i++) {
        NOW += 7000;
        rec("currentFarm", () => tg.currentFarm());
        rec("farmNow", () => tg.farmNow());
        rec("pick", () => { const p = tg.pick(tg.farmNow()); return p ? p.id : null; });
        Object.values(parent.entities).filter(e => e.type === "monster").forEach(e => {
            rec("aggressive " + e.id, () => tg.aggressive(e));
            rec("doomed " + e.id, () => tg.doomed(e));
            rec("diesSoon " + e.id, () => tg.diesSoon(e, 3));
            rec("holding " + e.id, () => tg.holdingBoss(e));
            rec("ring " + e.id, () => tg.bossHoldRing(e));
        });
        rec("rageZoneHere", () => tg.rageZoneHere());
        rec("rageBoxes", () => tg.rageBoxes(character.map));
        rec("failingZoneNear", () => tg.failingZoneNear({ x: character.x, y: character.y }, 200));
        rec("waitForLone", () => tg.waitForLone("gscorpion"));
        rec("teamVerdict", () => tg.teamVerdict("booboo"));
        rec("whyUnsafe", () => tg.whyUnsafe("gscorpion"));
        rec("xpRanking", () => tg.xpRanking());
        rec("liveDanger", () => tg.liveDanger());
        rec("spotFor", () => tg.spotFor("gscorpion", "desertland"));
        rec("spotGate", () => tg.spotGate(tg.farmNow()));
        // the world moves on: walk toward the first monster, it moves a bit
        character.x = character.real_x = character.x + 15; parent.entities && Object.values(parent.entities).forEach(e => { if (e.type === "monster") { e.x += 5; e.real_x = e.x; } });
    }
    return calls;
}

for (const sc of SCENARIOS) {
    const o = run(loadOld, sc), n = run(loadNew, sc);
    const same = JSON.stringify(o) === JSON.stringify(n);
    const threw = o.filter(c => /threw/.test(c[0])).length;
    check(same, sc.name + " (" + o.length + " records, " + threw + " threw in both)");
    if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]).slice(0, 300) + "\n  new " + JSON.stringify(n[i]).slice(0, 300)); break; }
    if (process.env.SHOW) o.filter(c => /threw|currentFarm|pick|log/.test(c[0])).slice(0, 12).forEach(c => console.log("    " + JSON.stringify(c).slice(0, 200)));
}
console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
