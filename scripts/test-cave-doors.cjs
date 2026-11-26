// Tests for the cave stairs (v1.238.6, 2026-11-25 second run): bot/cave/cave-doors.js and the members' follow in
// bot/team/party.js - a member walks to the open stairs that lead to the leader's floor and uses them (transport),
// never the exit, and waits when no open door leads there.
// Run: node scripts/test-cave-doors.cjs
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

const doors = require(path.join(root, "bot", "cave", "cave-doors.js"));
const RUN = "3c35";
const F0 = "zone_" + RUN + "_0", F1 = "zone_" + RUN + "_1", F2 = "zone_" + RUN + "_2";
const state = {
    run: RUN, floor: 0,
    doors: [
        { id: 0, map: F0, to: "cave", down: false, locked: false, x: 512, y: 512 },   // the exit
        { id: 1, map: F0, to: F1, down: true, locked: false, x: 3888, y: 2512 },      // the stairs down
        { id: 2, map: F1, to: F0, down: false, locked: false, x: 448, y: 304 },       // floor 2's way back up
        { id: 3, map: F1, to: F2, down: true, locked: true, x: 1248, y: 2496 },       // floor 2's stairs, still sealed
    ],
};

// ---- helpers ----
check((doors.doorTo(state, F0, F1) || {}).id === 1, "doorTo: the open stairs from floor 1 to the leader on floor 2");
check((doors.doorTo(state, F1, F0) || {}).id === 2, "doorTo: back up when the leader went back");
check(doors.doorTo(state, F0, "cave") === null, "doorTo: never the exit (the leader left the cave)");
check(doors.doorTo(state, F1, F2) === null, "doorTo: a sealed door is no way");
check(doors.doorTo(state, F0, F2) === null, "doorTo: no door straight to a floor two away");
check(doors.doorTo(state, F0, "zone_other_1") === null, "doorTo: not a floor of another run");
check(doors.doorTo(Object.assign({}, state, { doors: null }), F0, F1) === null && doors.doorTo(null, F0, F1) === null, "doorTo: no state / no doors");
const maps = { [F0]: { doors: [[512, 512, 40, 40, "cave", 0], [3888, 2512, 64, 32, F1, 2]] } };
check(doors.spawnOf(maps, F0, F1) === 2 && doors.spawnOf(maps, F0, F2) === 0 && doors.spawnOf({}, F0, F1) === 0, "spawnOf: the door's spawn index, 0 when unknown");
check(doors.near(state.doors[1], 3880, 2520) && !doors.near(state.doors[1], 3800, 2512), "near: within ~36 px of the door");

// ---- the member's follow in party.js ----
const CONFIG = require(path.join(root, "bot", "config.js"));
let NOW = 1e12;
Date.now = () => NOW;
const g = globalThis;
g.window = g;
g.G = { maps: Object.assign({ desertland: { monsters: [] } }, maps), monsters: {} };
g.character = { name: "VizWar", map: F0, x: 1000, y: 1000, real_x: 1000, real_y: 1000, rip: false, party: "VizPri", cave: state };
g.parent = { entities: {} };
g.smart = { moving: false };
g.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
g.get = () => null; g.set = () => {};
g.get_player = () => null;
g.is_moving = () => false;
g.set_message = () => {}; g.game_log = () => {};
const calls = [];
g.xmove = (x, y) => calls.push(["xmove", x, y]);
g.smart_move = (p) => { calls.push(["smart_move", p.map]); return Promise.resolve(); };
g.transport = (map, s) => { calls.push(["transport", map, s]); return Promise.resolve(); };
const util = require(path.join(root, "bot", "lib", "util.js"));
const config = JSON.parse(JSON.stringify(CONFIG));
config.leader = "VizPri";
config.mode = "member";
config.phase = "party";
config.phases = Object.assign({}, config.phases, { party: Object.assign({}, (CONFIG.phases || {}).party, { party: ["VizPri", "VizWar", "VizMage"] }) });
const handlers = {};
const comms = { on: (t, f) => { handlers[t] = f; }, send: () => {} };
const bus = require(path.join(root, "bot", "lib", "bus.js"))();
bus.provide("manual", () => true);
const party = require(path.join(root, "bot", "team", "party.js"))({ config, util: Object.assign({}, util, { log: () => {}, status: () => {} }), comms, bus });
const lead = (map, x, y) => { NOW += 3000; handlers.lead({ map, x, y, moving: false, manual: true, goal: null, dest: null, event: null, farm: null, target: null }, "VizPri"); };
const at = (map, x, y) => Object.assign(character, { map, x, y, real_x: x, real_y: y });

check(party.isMember, "party: VizWar is a member");
lead(F1, 448, 304); at(F0, 1000, 1000); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["xmove", 3888, 2512]]), "leader on floor 2, we far from the stairs: walk to them (straight, same map) " + JSON.stringify(calls));
at(F0, 3885, 2515); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["transport", F1, 2]]), "at the stairs: transport to the leader's floor with the door's spawn " + JSON.stringify(calls));
NOW += 500; calls.length = 0; party.idleFollow();
check(calls.length === 0, "no second transport within 2 s");
lead("cave", 912, 288); at(F0, 3885, 2515); calls.length = 0; party.idleFollow();
check(calls.length === 0, "leader outside the cave: no door, no path walk - we wait " + JSON.stringify(calls));
lead(F0, 2000, 1500); at(F0, 1000, 1000); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["xmove", 2000, 1500]]), "leader on our floor: a straight move to it as before " + JSON.stringify(calls));
state.doors[1].locked = true; lead(F1, 448, 304); at(F0, 1000, 1000); calls.length = 0; party.idleFollow();
check(calls.length === 0, "stairs still sealed: we wait " + JSON.stringify(calls));
state.doors[1].locked = false;

// ---- manual mode: no going ahead to the leader's route end (v1.238.7) ----
const leadMoving = (map, x, y, dest, manual) => { NOW += 3000; handlers.lead({ map, x, y, moving: true, manual, goal: null, dest, event: null, farm: null, target: null }, "VizPri"); };
leadMoving(F0, 1200, 1000, { map: F0, x: 3000, y: 2000 }, true); at(F0, 600, 600); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["xmove", 1200, 1000]]), "cave, the leader path-walks to a room: we follow the leader, not its route end " + JSON.stringify(calls));
delete character.cave;
leadMoving("main", 1200, 1000, { map: "main", x: 3000, y: 2000 }, true); at("main", 600, 600); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["xmove", 1200, 1000]]), "outside the cave in /manual: after the leader too, not its route end " + JSON.stringify(calls));
leadMoving("main", 1200, 1000, { map: "main", x: 3000, y: 2000 }, false); at("main", 600, 600); calls.length = 0; party.idleFollow();
check(JSON.stringify(calls) === JSON.stringify([["smart_move", "main"]]), "not manual: ahead to the route end as before (player decision 2026-11-21) " + JSON.stringify(calls));

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
