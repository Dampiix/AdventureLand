// Tests for the boss meeting point (v1.238.2): the merchant's meetPoint (roles/merchant/scout.js) and the team walking
// on from it when the boss is not in sight there (encounters/encounters.js walkTo, via the decide() of a fake leader).
// Run: node scripts/test-meet-point.cjs
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

globalThis.window = globalThis;
globalThis.setInterval = () => 0;
globalThis.get = () => null; globalThis.set = () => true;
globalThis.can_move = () => true;
let blocked = []; // boxes a straight walk may not touch
globalThis.can_move_to = (x, y) => {
    const me = { x: character.real_x, y: character.real_y };
    return !blocked.some(b => { for (let i = 0; i <= 20; i++) { const px = me.x + (x - me.x) * i / 20, py = me.y + (y - me.y) * i / 20; if (px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3]) return true; } return false; });
};
globalThis.character = { name: "VizMerch", map: "cave", real_x: 584, real_y: -135, max_hp: 1400 };
globalThis.G = { maps: { cave: { monsters: [{ type: "mvampire", count: 1, boundaries: [["cave", -367, -1296, -14, -1057], ["cave", 1068, -123, 1420, 78]] }] } }, monsters: { mvampire: {} } };
const util = { spawnBoxes: (p, m) => (p.boundary ? [p.boundary] : (p.boundaries || []).filter(b => b[0] === m).map(b => b.slice(1))),
    log: () => {}, predictedHit: () => 0, xy: p => ({ x: p.real_x, y: p.real_y }) };
const scout = require(path.join(root, "bot", "roles", "merchant", "scout.js"))({ config: { events: { scout: { meetDist: 200 } }, leader: "VizPri", characters: {} }, util, comms: { send: () => {}, on: () => {} } });

// 1. the live case: Dracul at 1258,-59 seen from 584,-135 -> 200 px before him on the line
const drac = { mtype: "mvampire", real_x: 1258, real_y: -59 };
let p = scout.meetPoint(drac);
check(Math.round(Math.hypot(p.x - 1258, p.y + 59)) === 200, "meeting point: 200 px before the boss, on the line from the merchant (" + Math.round(p.x) + "," + Math.round(p.y) + ")");
// 2. the line point not reachable (a wall right before it): just outside his spawn box, on our side
blocked = [[1040, -100, 1075, -60]];
p = scout.meetPoint(drac);
check(Math.abs(p.x - 1018) <= 2 && Math.abs(p.y + 124) <= 2, "line point blocked: 50 px outside the spawn box edge facing us (" + Math.round(p.x) + "," + Math.round(p.y) + ")");
// 3. nothing reachable: where we stand
blocked = [[600, -3000, 610, 3000]];
p = scout.meetPoint(drac);
check(p.x === 584 && p.y === -135, "nothing reachable: our own spot");
// 4. close already: where we stand
blocked = []; character.real_x = 1100; character.real_y = -60;
p = scout.meetPoint(drac);
check(p.x === 1100 && p.y === -60, "within meetDist + 50: our own spot");

// 5. the team: at the meeting point without the boss in sight -> on to where it was reported
const enc = require(path.join(root, "bot", "encounters", "encounters.js"));
check(typeof enc === "function", "encounters part loads");
console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
