// Tests for the mage's skill modules (module plan, pilot step 4) with a fake game - no client needed.
// Run: node scripts/test-mage.cjs [path to an old single-file classes/mage.js]
// Each scenario sets up a game, runs the class's always()/support()/fight() and records every call into the game
// (skills, equips, unequips, target changes, attacks, plan changes, log lines). Checked: the expected behaviour;
// with an old mage.js given, also that the old and the new class make exactly the same calls.
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

function setup(scenario) {
    // A fresh copy per run: the blink changes the plan (smart.plot) in place.
    const sc = JSON.parse(JSON.stringify(scenario));
    const calls = [];
    const g = globalThis;
    const now = Date.now();
    g.G = {
        skills: { energize: { level: 20 }, reflection: { level: 60, mp: 540 }, blink: { mp: 1600, level: 60 }, magiport: { mp: 900 }, burst: { ratio: 0.5 } },
        monsters: { gscorpion: { attack: 320, hp: 2400, speed: 9, range: 64 }, bee: { attack: 15, speed: 20, range: 30 }, phoenix: { cooperative: true, attack: 300 },
            ghost: { attack: 200, damage_type: "magical", speed: 30, range: 40 }, cgoo: { attack: 320, speed: 9, range: 64 } },
        items: { gstaff: { type: "weapon", wtype: "great_staff", attack: 40, blast: 300 }, firestaff: { type: "weapon", wtype: "staff", attack: 35 },
            wbook0: { type: "source", int: 5 } },
        classes: { mage: { mainhand: { staff: {} }, doublehand: { great_staff: {} } } },
        maps: { desertland: { monsters: [{ type: "gscorpion", boundary: [0, 0, 400, 400] }] }, main: {} },
    };
    g.character = Object.assign({ name: "VizMage", ctype: "mage", level: 66, hp: 3700, max_hp: 3758, mp: 4400, max_mp: 4720, x: 100, y: 100, real_x: 100, real_y: 100,
        map: "desertland", speed: 59, range: 201, attack: 1078, int: 252, courage: 2, mcourage: 3, pcourage: 2, esize: 10, rip: false, s: {},
        items: [{ name: "gstaff", level: 3 }, null], slots: { mainhand: { name: "firestaff", level: 7 }, offhand: { name: "wbook0", level: 2 } } }, sc.me || {});
    g.parent = { entities: sc.entities || {}, next_skill: { attack: new Date(now + 100) }, calculate_item_properties: function (it) { return { blast: (G.items[it.name] || {}).blast || 0, int: (G.items[it.name] || {}).int || 0 }; } };
    g.smart = sc.smart || { moving: false };
    const players = sc.players || {};
    g.get_player = n => players[n] || null;
    g.get_party = () => sc.party || {};
    g.is_in_range = () => true;
    g.is_on_cooldown = () => false;
    g.use_skill = (name, target, extra) => { calls.push(["skill", name, JSON.stringify(target), extra]); return Promise.resolve(); };
    g.get_targeted_monster = () => sc.target || null;
    g.get_nearest_monster = f => Object.values(sc.entities || {}).find(e => e.type === "monster" && (!f || !f.type || e.mtype === f.type)) || null;
    g.change_target = t => calls.push(["target", t.id]);
    g.can_attack = () => true;
    g.attack = t => { calls.push(["attack", t.id]); return Promise.resolve(); };
    g.unequip = s => { calls.push(["unequip", s]); return Promise.resolve(); };
    g.can_move_to = () => true;
    g.is_transporting = () => false;
    g.set_message = () => {};
    g.game_log = (t) => calls.push(["log", t]);
    g.get = () => null; g.set = () => {};
    g.BOT_CONFIG = { combat: { kite: { enabled: true, farmRisk: 0.25, farmSpeedRatio: 0.9, farmRangeMargin: 50 } } };
    const util = require(path.join(root, "bot", "lib", "util.js"));
    const config = {
        classes: { mage: { energizeAbove: 0.6, energizeBelow: 0.4, burstLeadMs: 250, reflectMinAttack: 100, reflectKeepMp: 0.25, useBurst: false,
            blaster: { enabled: true, names: ["gstaff"], minNeighbours: 2, minMp: 0.5, offMp: 0.2, keepMs: 4000, holdMs: 60000, singleTarget: false, singleMargin: 0.03, aim: true, blockMs: 6000, fearMax: 0 },
            magiport: { enabled: true, keepMp: 0.3, minDist: 600, bossRange: 800, graceMs: 4000, tries: 3, retryMs: 8000 },
            blinkTravel: { enabled: true, minDist: 400, keepMp: 0.4 } } },
        team: { fighters: ["VizPri", "VizWar", "VizMage"] }, targeting: { teamSafety: { tankClasses: ["warrior", "paladin"] } }, events: { policy: {}, noArea: [] }, characters: {},
    };
    const goal = sc.goal || null;
    const ctx = {
        util: util, config: config,
        party: { enabled: true, memberNames: () => Object.keys(sc.party || {}), teamGoal: () => goal, leaderInfo: () => null,
            atGoal: g2 => !!(g2 && sc.atGoal), goalLabel: g2 => (g2 ? "the " + g2.name + (g2.kind === "spot" ? " spot" : "") : "none") },
        cave: { active: () => false, caveManual: () => false },
        events: { current: () => null, searchJob: () => false },
        targeting: { packVerdict: () => ({ ok: true }), farmNow: () => (goal && goal.kind === "spot" ? { monster: goal.name } : null),
            inSpotArea: (p, type) => type === "gscorpion" && p.map === "desertland" && p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 400 },
        gear: { holdWeapons: ms => calls.push(["hold", ms]), equipBatch: b => { calls.push(["equip", JSON.stringify(b)]); return Promise.resolve(); } },
    };
    return { calls, ctx };
}

const SCENARIOS = {
    "team port pulls the tank first": {
        goal: { id: "spot:gscorpion@1", kind: "spot", name: "gscorpion" }, atGoal: true,
        party: { VizPri: { type: "priest", map: "main", x: 0, y: 0 }, VizWar: { type: "warrior", map: "main", x: 0, y: 0 }, VizMage: { type: "mage", map: "desertland", x: 100, y: 100 } },
        run: cls => cls.always(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "magiport" && c[2] === '"VizWar"') && !calls.some(c => c[1] === "magiport" && c[2] === '"VizPri"'),
    },
    "team port waits for the boss in sight": {
        goal: { id: "boss:phoenix@1", kind: "boss", name: "phoenix" },
        party: { VizWar: { type: "warrior", map: "main" }, VizMage: { type: "mage", map: "desertland" } },
        run: cls => cls.always(),
        expect: calls => !calls.some(c => c[1] === "magiport") && calls.some(c => c[0] === "log" && /not in my sight yet/.test(c[1])),
    },
    "team port leaves a member we can see close by": {
        goal: { id: "spot:gscorpion@2", kind: "spot", name: "gscorpion" }, atGoal: true,
        party: { VizWar: { type: "warrior", map: "desertland", x: 150, y: 150 }, VizMage: { type: "mage", map: "desertland" } },
        players: { VizWar: { name: "VizWar", x: 150, y: 150, real_x: 150, real_y: 150 } },
        run: cls => cls.always(),
        expect: calls => !calls.some(c => c[1] === "magiport"),
    },
    "blink stops outside the farm spot": {
        goal: { id: "spot:gscorpion@3", kind: "spot", name: "gscorpion" },
        me: { x: 1500, y: 100, real_x: 1500, real_y: 100 },
        smart: { moving: true, found: true, plot: [{ map: "desertland", x: 1200, y: 100 }, { map: "desertland", x: 800, y: 100 }, { map: "desertland", x: 300, y: 100 }, { map: "desertland", x: 200, y: 100 }] },
        run: cls => cls.always(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "blink" && c[2] === "[800,100]"),
    },
    "energize gives MP to the member lowest on MP": {
        party: { VizPri: {}, VizWar: {}, VizMage: {} },
        players: { VizPri: { name: "VizPri", mp: 500, max_mp: 5000 }, VizWar: { name: "VizWar", mp: 300, max_mp: 1300 } },
        run: cls => cls.support(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "energize" && c[2] === '"VizPri"' && c[3] > 50),
    },
    "reflect goes on the member with the most magical attack": {
        party: { VizPri: {}, VizWar: {}, VizMage: {} },
        players: { VizPri: { name: "VizPri", mp: 5000, max_mp: 5000, s: {} }, VizWar: { name: "VizWar", mp: 1300, max_mp: 1300, s: {} } },
        entities: { g1: { id: "g1", type: "monster", mtype: "ghost", target: "VizWar", attack: 220 }, g2: { id: "g2", type: "monster", mtype: "ghost", target: "VizPri", attack: 100 } },
        run: cls => cls.support(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "reflection" && c[2] === '"VizWar"'),
    },
    "blaster goes on for a pack": {
        party: { VizMage: {} },
        target: { id: "t", type: "monster", mtype: "cgoo", x: 300, y: 100, real_x: 300, real_y: 100 },
        entities: { t: { id: "t", type: "monster", mtype: "cgoo", x: 300, y: 100 }, a: { id: "a", type: "monster", mtype: "cgoo", x: 320, y: 110 }, b: { id: "b", type: "monster", mtype: "cgoo", x: 290, y: 90 } },
        run: cls => cls.always(),
        expect: calls => calls.some(c => c[0] === "unequip" && c[1] === "offhand") && calls.some(c => c[0] === "equip" && /mainhand/.test(c[1])),
    },
    "blaster aims at the bigger pack": {
        party: { VizMage: {} },
        // courage 5: the blast on u pulls u and both bees (3) - within our courage, so the aim may take it
        me: { courage: 5, slots: { mainhand: { name: "gstaff", level: 3 } }, items: [{ name: "firestaff", level: 7 }, { name: "wbook0", level: 2 }] },
        entities: { t: { id: "t", type: "monster", mtype: "cgoo", x: 300, y: 100 }, u: { id: "u", type: "monster", mtype: "cgoo", x: 600, y: 600 },
            u1: { id: "u1", type: "monster", mtype: "bee", x: 610, y: 600, target: "VizMage" }, u2: { id: "u2", type: "monster", mtype: "bee", x: 590, y: 605, target: "VizMage" } },
        run: cls => cls.fight({ id: "t", type: "monster", mtype: "cgoo", x: 300, y: 100 }),
        expect: calls => calls.some(c => c[0] === "target" && c[1] === "u") && calls.some(c => c[0] === "attack" && c[1] === "u"),
    },
};

async function runAll(file) {
    const out = {};
    for (const name of Object.keys(SCENARIOS)) {
        const sc = SCENARIOS[name];
        const env = setup(sc);
        delete require.cache[require.resolve(file)];
        Object.keys(require.cache).filter(k => k.includes(path.join("classes", "mage"))).forEach(k => delete require.cache[k]);
        const cls = require(file)(env.ctx);
        await sc.run(cls);
        await new Promise(r => setTimeout(r, 400)); // promise chains and the blink's 350 ms follow-up
        out[name] = env.calls;
    }
    return out;
}

(async () => {
    const fresh = await runAll(path.join(root, "bot", "classes", "mage", "mage.js"));
    Object.keys(SCENARIOS).forEach(n => check(SCENARIOS[n].expect(fresh[n]), n));
    const old = process.argv[2];
    if (old) {
        const before = await runAll(path.resolve(old));
        Object.keys(SCENARIOS).forEach(n => check(JSON.stringify(before[n]) === JSON.stringify(fresh[n]), "same calls as the old mage.js: " + n +
            (JSON.stringify(before[n]) === JSON.stringify(fresh[n]) ? "" : "\n      old " + JSON.stringify(before[n]) + "\n      new " + JSON.stringify(fresh[n]))));
    }
    console.log(failed ? `\n${failed} FAILED` : "\nall ok");
    process.exit(failed ? 1 : 0);
})();
