// Tests for travel/travel.js and travel/rage-walls.js (module plan, stage 3b) against the old code in core/fighter.js.
// Run: node scripts/test-travel.cjs [git ref with the old fighter.js, default c1807d5]
// The old travel and rage-wall parts are cut out of the old fighter.js and run with the same fake game as the new
// modules. Each scenario records every call into the game (path walks, stops, moves, status, log, team goal) and the
// answers of the wrapped can_move / smart_move; old and new must record exactly the same.
const path = require("path");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

const ref = process.argv[2] || "c1807d5";
const oldFighter = execSync("git show " + ref + ":bot/core/fighter.js", { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
function cut(from, to) {
    const a = oldFighter.indexOf(from), b = oldFighter.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error("old code not found: " + from);
    return oldFighter.slice(a, b);
}
const OLD_SRC = cut("    // A target in sight ends the search walk", "    // Solo recovery") +
    cut("    // ---- rage zones as walls for the path search", "    // True while something else");

globalThis.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));
const game = require(path.join(root, "bot", "lib", "game.js"));
const createTravel = require(path.join(root, "bot", "travel", "travel.js"));
const createRageWalls = require(path.join(root, "bot", "travel", "rage-walls.js"));

let NOW = 1e12;
Date.now = () => NOW;
const tick = () => new Promise(r => setImmediate(r));

// One fake world per run. sc: the scenario's state.
function world(sc, calls) {
    const g = globalThis;
    g.window = g;
    delete g.__botOrigCanMove; delete g.__botOrigSmartMove;
    g.G = { maps: {
        main: { monsters: [{ type: "bee" }], npcs: [{ id: "fancypots" }], doors: [[0, 0, 0, 0, "halloween", 0, 0]] },
        halloween: { doors: [[0, 0, 0, 0, "main", 0, 0], [0, 0, 0, 0, "spookytown", 0, 1]], spawns: [[0, 0], [500, 600]] },
        spookytown: { monsters: [{ type: "stoneworm" }], doors: [[0, 0, 0, 0, "halloween", 0, 0], [0, 0, 0, 0, "level2", 0, 1]] },
        level2: { monsters: [{ type: "prat" }] },
        desertland: { monsters: [{ type: "gscorpion" }, { type: "booboo" }] },
        jail: { ignore: true, monsters: [{ type: "gscorpion" }] },
    } };
    g.character = Object.assign({ name: "VizPri", map: "main", x: 0, y: 0, real_x: 0, real_y: 0 }, sc.me || {});
    g.smart = Object.assign({ moving: false }, sc.smart || {});
    g.is_moving = () => !!sc.moving;
    g.stop = (what) => { calls.push(["stop", what === undefined ? null : what]); };
    const fails = (sc.pathFails || []).slice();
    g.smart_move = (d) => {
        calls.push(["smart_move", JSON.stringify(d)]);
        const f = fails.shift();
        return f ? Promise.reject({ reason: f }) : Promise.resolve("arrived");
    };
    const blockedPts = sc.cantMoveTo || [];
    g.can_move_to = (x, y) => !blockedPts.some(p => Math.abs(p[0] - x) < 1 && Math.abs(p[1] - y) < 1) && !(sc.cantMoveAll);
    g.can_move = (m) => !(sc.clientWall && m.going_x > 5000);
    const util = {
        status: (t, c) => calls.push(["status", t, c]),
        log: (tag, t, c) => calls.push(["log", tag, t, c]),
        errReason: e => (e && (e.reason || e.message)) || String(e),
        xy: p => ({ x: p.real_x !== undefined ? p.real_x : p.x, y: p.real_y !== undefined ? p.real_y : p.y }),
    };
    const config = JSON.parse(JSON.stringify(CONFIG));
    Object.assign(config.travel, sc.travel || {});
    const zones = sc.zones || [];
    const inBox = (p, b) => p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3];
    const targeting = {
        spotFor: (m, map) => (sc.noSpot ? null : { map: map || "desertland", x: 100, y: 200 }),
        rageBoxes: () => zones,
        farmNow: () => sc.farmNow || null,
        failingZoneAt: p => zones.some(z => z.failing && inBox(p, z.b)),
        failingZoneNear: (p, margin) => {
            for (const z of zones) {
                if (!z.failing) continue;
                const gap = Math.hypot(Math.max(z.b[0] - p.x, 0, p.x - z.b[2]), Math.max(z.b[1] - p.y, 0, p.y - z.b[3]));
                if (gap <= margin) return { type: z.type, b: z.b, gap: gap };
            }
            return null;
        },
        rageZoneHere: () => { const me = util.xy(g.character); const z = zones.find(z => z.failing && inBox(me, z.b)); return z ? { type: z.type, b: z.b, why: "pack" } : null; },
        holdingBoss: () => !!sc.holding,
        bossHoldRing: () => (sc.ring || null),
    };
    const party = { isLeader: !!sc.leader, isMember: !sc.leader, enabled: true, setGoal: (k, n, p) => calls.push(["setGoal", k, n, JSON.stringify(p)]) };
    const cls = { move: (t) => calls.push(["cls.move", t]) };
    const moveTo = (p) => calls.push(["moveTo", Math.round(p.x), Math.round(p.y)]);
    return { util, config, targeting, party, cls, moveTo };
}

function makeOld(w) {
    const f = new Function("config", "util", "targeting", "party", "cls", "moveTo", OLD_SRC +
        "\nreturn { travel, viaFor, goalFor, endSearchWalk, keepClearOfZones, holdRingStep, leaveRageZone," +
        " searching: function () { return !!searchWalk; }, stopOnPurpose: function () { stoppedOnPurpose = true; } };");
    return f(w.config, w.util, w.targeting, w.party, w.cls, w.moveTo);
}
function makeNew(w) {
    const t = createTravel({ game, util: w.util, config: w.config, party: w.party, targeting: w.targeting, cls: w.cls });
    const r = createRageWalls({ game, util: w.util, config: w.config, party: w.party, targeting: w.targeting, moveTo: w.moveTo, stopOnPurpose: t.stopOnPurpose });
    return Object.assign({}, t, { keepClearOfZones: r.keepClearOfZones, holdRingStep: r.holdRingStep, leaveRageZone: r.leaveRageZone });
}

// steps: async (api, calls, sc) - drives one bot (old or new) through the scenario.
async function run(make, sc, steps) {
    NOW = 1e12;
    const calls = [];
    const w = world(sc, calls);
    const api = make(w);
    await steps(api, calls, sc);
    await tick(); await tick();
    return calls;
}

const BOOBOO = { type: "booboo", b: [1000, 1000, 1400, 1300], failing: true };
const SCENARIOS = [
    ["leader travels to a farm behind a waypoint", { leader: true }, async (a, c) => {
        a.travel({ map: "spookytown", x: 10, y: 20 }, "to stoneworm", { monster: "stoneworm", map: "spookytown" });
        await tick(); c.push(["searching", a.searching()]);
    }],
    ["event farms set no team goal", { leader: true }, async (a) => { a.travel("bee", "to bee", { monster: "bee", source: "event crabxx" }); }],
    ["waypoint map: to its door first, then the goal", { me: { map: "halloween", real_x: 0, real_y: 0 } }, async (a, c) => {
        c.push(["via", JSON.stringify(a.viaFor({ map: "spookytown", x: 1, y: 2 }))]);
        character.real_x = 470; character.real_y = 590;
        c.push(["via", JSON.stringify(a.viaFor({ map: "spookytown", x: 1, y: 2 }))]);
        c.push(["via", JSON.stringify(a.viaFor("bee"))]);
    }],
    ["a new goal while walking stops the old walk", { moving: true, smart: { moving: true } }, async (a) => {
        a.travel({ map: "desertland", x: 0, y: 0 }, "a");
        a.travel({ map: "desertland", x: 900, y: 0 }, "b");
        a.travel({ map: "desertland", x: 950, y: 0 }, "c");
    }],
    ["a failed walk marks the goal for a minute", { pathFails: ["Path not found!", "Path not found!", "Path not found!", "Path not found!", "Path not found!"], travel: { rageWallSteps: [100, -1] } }, async (a, c) => {
        const farm = { monster: "gscorpion", map: "desertland", dest: { map: "desertland", x: 300, y: 300 } };
        a.travel(a.goalFor(farm), "x", farm);
        for (let i = 0; i < 6; i++) await tick();
        c.push(["goal", JSON.stringify(a.goalFor(farm))]);
        NOW += 61 * 1000;
        c.push(["goal", JSON.stringify(a.goalFor(farm))]);
        c.push(["goal", JSON.stringify(a.goalFor({ monster: "bee", map: "main" }))]);
    }],
    ["a walk we stopped ourselves is no failed goal", { pathFails: ["interrupted"], smart: { moving: true } }, async (a, c) => {
        const d = { map: "desertland", x: 300, y: 300 };
        a.travel(d, "x");
        a.endSearchWalk();
        for (let i = 0; i < 4; i++) await tick();
        c.push(["goal", JSON.stringify(a.goalFor({ monster: "gscorpion", dest: d }))]);
    }],
    ["can_move: rage boxes are walls", { zones: [BOOBOO, { type: "gscorpion", b: [0, 2000, 300, 2300], failing: false }], farmNow: { monster: "gscorpion" }, me: { map: "desertland" } }, async (a, c) => {
        const segs = [[800, 1100, 1600, 1100], [1200, 1100, 1600, 1100], [800, 800, 850, 820], [950, 950, 960, 960], [100, 1900, 100, 2100], [6000, 0, 6100, 0]];
        segs.forEach(s => c.push(["can_move", s.join(","), can_move({ map: "desertland", x: s[0], y: s[1], going_x: s[2], going_y: s[3] })]));
        c.push(["can_move based", can_move({ map: "desertland", x: 800, y: 1100, going_x: 1600, going_y: 1100 }, true)]);
        smart.map = "desertland"; smart.x = 1200; smart.y = 1100; NOW += 3000;
        c.push(["can_move goal zone", can_move({ map: "desertland", x: 800, y: 1100, going_x: 1600, going_y: 1100 })]);
    }],
    ["smart_move: walls loosen on no path, leaveVia leg", { me: { map: "spookytown" }, pathFails: [null, "Path not found!", "Path not found!"] }, async (a, c) => {
        smart_move("bee").then(r => c.push(["done", r]), e => c.push(["fail", e.reason]));
        for (let i = 0; i < 8; i++) await tick();
        smart_move({ map: "level2" }).then(r => c.push(["done", r]));
        smart_move({ to: "fancypots" }).then(r => c.push(["done", r]));
        for (let i = 0; i < 8; i++) await tick();
    }],
    ["smart_move: unreachable goal fails after all steps", { pathFails: ["Path not found!", "Path not found!", "Path not found!", "Path not found!", "Path not found!"] }, async (a, c) => {
        smart_move("bee").then(r => c.push(["done", r]), e => c.push(["fail", e.reason]));
        for (let i = 0; i < 12; i++) await tick();
    }],
    ["keep clear of a zone (straight out)", { zones: [BOOBOO], me: { map: "desertland", real_x: 950, real_y: 1100 } }, async (a, c) => {
        c.push(["r", a.keepClearOfZones()]); NOW += 1000; c.push(["r", a.keepClearOfZones()]);
    }],
    ["keep clear of a zone (16 directions)", { zones: [BOOBOO], me: { map: "desertland", real_x: 950, real_y: 1100 }, cantMoveTo: [[860, 1100]] }, async (a, c) => {
        c.push(["r", a.keepClearOfZones()]);
    }],
    ["keep clear: not while a path walk runs", { zones: [BOOBOO], smart: { moving: true }, me: { map: "desertland", real_x: 950, real_y: 1100 } }, async (a, c) => {
        c.push(["r", a.keepClearOfZones()]);
    }],
    ["hold ring around a boss", { holding: true, ring: { box: [1000, 1000, 1200, 1200], margin: 200 }, me: { map: "desertland", real_x: 1250, real_y: 1100 } }, async (a, c) => {
        const boss = { mtype: "phoenix", dead: false };
        c.push(["r", a.holdRingStep(boss, "phoenix")]);
        character.real_x = 1450;
        c.push(["r", a.holdRingStep(null, "phoenix")]);
        NOW += 61 * 1000;
        c.push(["r", a.holdRingStep(null, "phoenix")]);
    }],
    ["hold ring: the side we can reach", { holding: true, moving: true, ring: { box: [1000, 1000, 1200, 1200], margin: 200 }, me: { map: "desertland", real_x: 1100, real_y: 1150 }, cantMoveTo: [[1100, 1430]] }, async (a, c) => {
        c.push(["r", a.holdRingStep({ dead: false }, "phoenix")]);
    }],
    ["member: no walk into a failing zone", { zones: [BOOBOO], smart: { moving: true, map: "desertland", x: 1100, y: 1100 }, me: { map: "desertland", real_x: 500, real_y: 500 } }, async (a, c) => {
        c.push(["r", a.leaveRageZone()]);
    }],
    ["standing in a zone: step out", { leader: true, zones: [BOOBOO], me: { map: "desertland", real_x: 1050, real_y: 1100 } }, async (a, c) => {
        c.push(["r", a.leaveRageZone()]);
    }],
    ["a walk ending in the zone is stopped", { leader: true, zones: [BOOBOO], smart: { moving: true, map: "desertland", x: 1200, y: 1200 }, me: { map: "desertland", real_x: 1050, real_y: 1100 }, cantMoveAll: true }, async (a, c) => {
        c.push(["r", a.leaveRageZone()]);
    }],
    ["a walk passing through goes on", { leader: true, zones: [BOOBOO], smart: { moving: true, map: "desertland", x: 3000, y: 1200 }, me: { map: "desertland", real_x: 1050, real_y: 1100 } }, async (a, c) => {
        c.push(["r", a.leaveRageZone()]);
    }],
];

(async function () {
    for (const [name, sc, steps] of SCENARIOS) {
        const oldCalls = await run(makeOld, JSON.parse(JSON.stringify(sc)), steps);
        const newCalls = await run(makeNew, JSON.parse(JSON.stringify(sc)), steps);
        const same = JSON.stringify(oldCalls) === JSON.stringify(newCalls);
        check(same && oldCalls.length > 0, name + " (" + oldCalls.length + " calls)");
        if (!same) { console.log("  old: " + JSON.stringify(oldCalls)); console.log("  new: " + JSON.stringify(newCalls)); }
        if (process.env.SHOW) console.log("  " + JSON.stringify(newCalls));
    }
    // A second install wraps the original again, not our wrapper (no double walls after a reload in the same frame).
    const calls = [];
    const w = world({}, calls);
    makeNew(w); const first = can_move; makeNew(w);
    check(can_move !== first && __botOrigCanMove !== first, "a second install wraps the original can_move");
    const sm = smart_move; makeNew(w);
    check(smart_move === sm, "smart_move is wrapped once per page");
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
