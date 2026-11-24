// Tests for stage 4a (module plan): team/party.js reads the bus and safety/spots.js instead of events, cave and
// targeting; safety/spots.js is the spot geometry cut out of targeting. Old code from a git ref, new code from the tree.
// Run: node scripts/test-stage4a.cjs [git ref with the old core/party.js and core/targeting.js, default c70bd4d]
// Each scenario drives the leader's party through a list of states (boss event, search, manual, a route goal, where
// we stand) and records the team goal, atGoal answers, the broadcasts and the log; old and new must record the same.
const path = require("path");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[2] || "c70bd4d";
const show = f => execSync("git show " + ref + ":" + f, { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });

globalThis.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));
let NOW = 1e12;
Date.now = () => NOW;

const g = globalThis;
g.window = g;
g.G = {
    monsters: { gscorpion: { range: 64, hp: 2000 }, booboo: { range: 420, hp: 5000 }, phoenix: { range: 200 } },
    maps: {
        desertland: { monsters: [{ type: "gscorpion", boundary: [0, 0, 400, 300], count: 6 }, { type: "booboo", boundary: [1000, 1000, 1200, 1200], rage: [900, 900, 1300, 1300], count: 4 }] },
        main: { monsters: [] },
    },
};
g.character = { name: "VizPri", map: "desertland", x: 600, y: 150, real_x: 600, real_y: 150, rip: false, party: "VizPri" };
g.parent = { entities: {} };
g.smart = { moving: false };
g.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
g.get = () => null; g.set = () => {};
g.can_move_to = (x, y) => !(x > 450 && x < 520);
g.send_party_invite = () => Promise.resolve(); g.leave_party = () => Promise.resolve(); g.accept_party_invite = () => Promise.resolve();
g.is_moving = () => false;
g.set_message = () => {}; g.game_log = () => {};
const util = require(path.join(root, "bot", "lib", "util.js"));
const game = require(path.join(root, "bot", "lib", "game.js"));

const config = JSON.parse(JSON.stringify(CONFIG));
config.leader = "VizPri";
config.phase = "party";
config.phases = Object.assign({}, config.phases, { party: Object.assign({}, (CONFIG.phases || {}).party, { party: ["VizPri", "VizWar", "VizMage"] }) });
config.team = Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"] });
config.characters = { VizPri: {}, VizWar: {}, VizMage: {} };

// ---- old spot geometry, cut out of the old targeting.js ----
const oldTargeting = show("bot/core/targeting.js");
function cut(src, from, to) { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error("not found: " + from); return src.slice(a, b); }
const OLD_SPOTS = cut(oldTargeting, "    function watchPoint(type) {", "    // Returns \"lone\"") + cut(oldTargeting, "    function spotBox(type, spot) {", "    function gateApplies(f) {");
const oldSpots = new Function("config", "util", "const cfg = config.targeting; const icfg = cfg.isolation || {}; const gcfg = cfg.spotCheck || {};\n" + OLD_SPOTS +
    "\nreturn { watchPoint: watchPoint, inSpotArea: inSpotArea, spotBox: spotBox, boxDist: boxDist };")(config, util);
const newSpots = require(path.join(root, "bot", "safety", "spots.js"))({ game, util, config });

const pts = [];
for (let x = -200; x <= 1500; x += 170) for (let y = -200; y <= 1500; y += 190) pts.push({ x, y });
let spotsSame = true;
for (const p of pts) {
    character.real_x = character.x = p.x; character.real_y = character.y = p.y;
    for (const t of ["gscorpion", "booboo", "phoenix", "nothing"]) {
        const a = JSON.stringify([oldSpots.watchPoint(t), oldSpots.inSpotArea(p, t), oldSpots.inSpotArea(Object.assign({ map: "main" }, p), t)]);
        const b = JSON.stringify([newSpots.watchPoint(t), newSpots.inSpotArea(p, t), newSpots.inSpotArea(Object.assign({ map: "main" }, p), t)]);
        if (a !== b) { spotsSame = false; console.log("  " + t + " " + JSON.stringify(p) + " old " + a + " new " + b); }
    }
}
check(spotsSame, "spots: watchPoint / inSpotArea equal on " + pts.length + " points x 4 kinds");
check(JSON.stringify(oldSpots.spotBox("booboo", { map: "desertland", x: 1100, y: 1100 })) === JSON.stringify(newSpots.spotBox("booboo", { map: "desertland", x: 1100, y: 1100 })), "spots: spotBox with a rage box");

// ---- party: old (ctx with events / cave / targeting) vs new (bus + spots) ----
function makeParty(isNew, st, calls) {
    const comms = { on: () => {}, send: (to, type, data) => calls.push(["send", [].concat(to).join(","), type, JSON.stringify(data)]) };
    const u = Object.assign({}, util, { log: (tag, t) => calls.push(["log", tag, t]), status: () => {} });
    if (!isNew) {
        const src = show("bot/core/party.js");
        const m = { exports: {} };
        new Function("module", "exports", src)(m, m.exports);
        return m.exports({ config, util: u, comms,
            targeting: { inSpotArea: oldSpots.inSpotArea, watchPoint: oldSpots.watchPoint },
            events: { current: () => st.ev, searchJob: () => !!st.search },
            cave: { active: () => !!st.manual, ownManual: () => !!st.own } });
    }
    const bus = require(path.join(root, "bot", "lib", "bus.js"))();
    bus.provide("boss", () => st.ev);
    bus.provide("search", () => !!st.search);
    bus.provide("manual", () => !!st.manual);
    bus.provide("manualOwn", () => !!st.own);
    delete require.cache[require.resolve(path.join(root, "bot", "team", "party.js"))];
    return require(path.join(root, "bot", "team", "party.js"))({ config, util: u, comms, bus });
}
const STEPS = [
    { at: [600, 150] },
    { setGoal: ["spot", "gscorpion", { map: "desertland", x: 200, y: 150 }] },
    { at: [500, 150] }, { at: [380, 150] }, { at: [900, 900] },
    { ev: { monster: "phoenix", dest: { map: "desertland", x: 50, y: 60 } } },
    { at: [60, 60] },
    { ev: { monster: "phoenix", solo: true } },
    { ev: { name: "crabxx", join: true } },
    { ev: null, search: true },
    { search: false, manual: true, own: true },
    { manual: false, own: false },
    { setGoal: ["daisy", "Daisy", { map: "main", x: 10, y: 20 }] },
    { setGoal: ["spot", "booboo", null] }, { at: [1350, 1100] }, { at: [880, 1100] },
];
function runParty(isNew) {
    NOW = 1e12;
    const calls = [], st = { ev: null, search: false, manual: false, own: false };
    character.real_x = character.x = 600; character.real_y = character.y = 150;
    const party = makeParty(isNew, st, calls);
    STEPS.forEach(function (s, i) {
        NOW += 5000;
        ["ev", "search", "manual", "own"].forEach(k => { if (k in s) st[k] = s[k]; });
        if (s.at) { character.real_x = character.x = s.at[0]; character.real_y = character.y = s.at[1]; }
        if (s.setGoal) party.setGoal.apply(null, s.setGoal);
        party.broadcast("gscorpion", null, null);
        const goal = party.teamGoal();
        calls.push(["step", i, JSON.stringify(goal)]);
        ["gscorpion", "booboo"].forEach(t => calls.push(["atGoal", t, party.atGoal({ kind: "spot", name: t, map: "desertland" })]));
    });
    return calls;
}
const o = runParty(false), n = runParty(true);
const same = JSON.stringify(o) === JSON.stringify(n);
check(same && o.length > 40, "party: team goal, atGoal and broadcasts over " + STEPS.length + " states (" + o.length + " records)");
if (!same) for (let i = 0; i < Math.max(o.length, n.length); i++) if (JSON.stringify(o[i]) !== JSON.stringify(n[i])) { console.log("  first difference at " + i + "\n  old " + JSON.stringify(o[i]) + "\n  new " + JSON.stringify(n[i])); break; }
if (process.env.SHOW) o.filter(c => c[0] !== "atGoal").forEach(c => console.log("  " + JSON.stringify(c).slice(0, 220)));

// ---- the bus itself ----
const bus = require(path.join(root, "bot", "lib", "bus.js"))();
let seen = null;
bus.on("x", d => { seen = d; }); bus.on("x", () => { throw new Error("listener"); }); bus.emit("x", 5);
bus.provide("v", () => 7);
check(bus.get("v") === 7 && bus.get("none") === null && seen === 5, "bus: provide/get, on/emit (a throwing listener stops nobody)");

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
