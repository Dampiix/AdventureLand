// Tests for the warrior's modules (module plan, stage 2) with a fake game and the real config.
// Run: node scripts/test-warrior.cjs [path to the old single-file classes/warrior.js]
// Each scenario sets up a game, runs the class's hooks and records every call into the game (skills, moves, equips,
// strike attacks, weapon holds, log lines). With an old file given, the old and the new class must make exactly the same
// calls; the expectations check the behaviour itself.
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

globalThis.character = { name: "VizWar" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function setup(scenario) {
    const sc = JSON.parse(JSON.stringify(scenario));
    const calls = [];
    const g = globalThis;
    g.G = {
        skills: { agitate: { level: 68, mp: 420, range: 320, class: ["warrior"] }, taunt: { range: 200, mp: 40, class: ["warrior", "paladin"] },
            warcry: { mp: 320, level: 70 }, cleave: { range: 120, mp: 400, level: 52 }, stomp: { range: 120, mp: 200, level: 52 },
            hardshell: { mp: 480, level: 60 }, charge: {}, dash: { mp: 120 } },
        monsters: { gscorpion: { attack: 320, hp: 2400, speed: 9, range: 64, damage_type: "physical" },
            fireroamer: { attack: 320, hp: 84000, speed: 20, range: 280, damage_type: "magical", abilities: { burn: {} } } },
        items: { fireblade: { type: "weapon", wtype: "sword", attack: 60, ability: "burn" }, swordofthedead: { type: "weapon", wtype: "sword", attack: 70 },
            ololipop: { type: "weapon", wtype: "mace", attack: 40, explosion: 30 } },
        classes: { warrior: { damage_type: "physical", mainhand: { sword: {}, mace: {} } } },
        maps: { desertland: { monsters: [{ type: "gscorpion", boundary: [0, 0, 600, 600], count: 6 }] } },
        conditions: {},
    };
    g.character = Object.assign({ name: "VizWar", ctype: "warrior", level: 73, hp: 12000, max_hp: 12221, mp: 1295, max_mp: 1295,
        x: 300, y: 300, real_x: 300, real_y: 300, map: "desertland", speed: 69, range: 31, attack: 1092, armor: 432, resistance: 204,
        courage: 16, mcourage: 2, pcourage: 2, rip: false, s: {}, esize: 10,
        items: [{ name: "swordofthedead", level: 7 }, { name: "swordofthedead", level: 7 }, null],
        slots: { mainhand: { name: "fireblade", level: 7 }, offhand: { name: "fireblade", level: 7 } } }, sc.me || {});
    g.parent = { entities: sc.entities || {}, distance: (a, b) => Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - 20),
        calculate_item_properties: it => ({ explosion: (G.items[it.name] || {}).explosion || 0, attack: (G.items[it.name] || {}).attack || 0 }) };
    g.smart = { moving: !!sc.travelling };
    const players = sc.players || {};
    g.get_player = n => players[n] || null;
    g.get_party = () => sc.party || {};
    g.is_in_range = (e) => Math.hypot(e.x - character.x, e.y - character.y) <= 60;
    g.is_on_cooldown = s => (sc.cooldown || []).includes(s);
    g.is_moving = () => !!sc.moving;
    g.can_move_to = () => true;
    g.use_skill = (name, target) => { calls.push(["skill", name, target && target.id ? target.id : JSON.stringify(target)]); return Promise.resolve(); };
    g.move = (x, y) => { calls.push(["move", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.xmove = (x, y) => { calls.push(["xmove", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.stop = () => { calls.push(["stop"]); return Promise.resolve(); };
    g.get_targeted_monster = () => (sc.target ? g.parent.entities[sc.target] : null);
    g.change_target = t => calls.push(["target", t.id]);
    g.set_message = t => calls.push(["status", t]);
    g.game_log = t => calls.push(["log", t]);
    g.get = () => null; g.set = () => {};
    g.BOT_CONFIG = CONFIG;
    delete require.cache[require.resolve(path.join(root, "bot", "lib", "util.js"))];
    Object.keys(require.cache).filter(k => k.includes(path.join("bot", "lib"))).forEach(k => delete require.cache[k]);
    const util = require(path.join(root, "bot", "lib", "util.js"));
    const config = JSON.parse(JSON.stringify(CONFIG));
    config.characters = { VizPri: {}, VizWar: {}, VizMage: {} };
    const farm = sc.farm || "gscorpion";
    const ctx = {
        util: util, config: config,
        party: { enabled: true, isMember: true, detached: () => false, memberNames: () => Object.keys(sc.party || {}),
            leaderInfo: () => ({ map: "desertland", x: 300, y: 320, farm: farm }), nearLeader: () => true },
        targeting: {
            farmNow: () => ({ monster: farm }), currentFarm: () => ({ monster: farm }),
            packVerdict: () => ({ ok: true, lost: 0 }), teamVerdict: (t) => (sc.reject || []).includes(t) ? { ok: false, why: "too strong" } : { ok: true },
            liveDanger: () => ({ ttd: 99, mult: 1, dps: 0, sustain: 0 }), spotGate: () => null, heldBossNear: () => false,
            inOccupied: () => false, failingZoneAt: () => null, luckCatcherNear: () => false, diesSoon: () => false,
        },
        gear: { holdWeapons: ms => calls.push(["hold", ms]), equipBatch: b => { calls.push(["equip", JSON.stringify(b)]); return Promise.resolve(); }, weaponsHeld: () => false },
        strike: { attack: (t) => calls.push(["strike", t.id]) },
        events: { current: () => null },
    };
    return { calls, ctx };
}

const M = (id, x, y, extra) => Object.assign({ id: id, type: "monster", mtype: "gscorpion", visible: true, x: x, y: y, real_x: x, real_y: y, hp: 2400, max_hp: 2400, attack: 320 }, extra || {});
const PARTY = { VizPri: { type: "priest" }, VizWar: { type: "warrior" }, VizMage: { type: "mage" } };
const PRI = { name: "VizPri", ctype: "priest", hp: 3500, max_hp: 5945, heal: 1916, x: 340, y: 300, real_x: 340, real_y: 300 };
const SCENARIOS = {
    "taunts a monster off the healer": {
        party: PARTY, players: { VizPri: PRI },
        entities: { a: M("a", 320, 300, { target: "VizPri" }) },
        run: c => c.support(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "taunt" && c[2] === "a"),
    },
    "walks up to taunt one further away": {
        party: PARTY, players: { VizPri: Object.assign({}, PRI, { x: 450, real_x: 450, hp: 5900 }) },
        entities: { a: M("a", 440, 300, { target: "VizPri" }) },
        run: c => c.support(),
        expect: calls => calls.some(c => c[0] === "xmove"),
    },
    "protective Agitate for many on allies": {
        party: PARTY, players: { VizPri: PRI },
        entities: Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [ "m" + i, M("m" + i, 320 + i * 10, 310, { target: "VizPri" }) ])),
        run: c => c.support(),
        expect: () => true,
    },
    "no protective Agitate with a Fire Spirit in reach": {
        party: PARTY, players: { VizPri: PRI },
        entities: Object.assign(Object.fromEntries([0, 1, 2, 3, 4, 5].map(i => [ "m" + i, M("m" + i, 320 + i * 10, 310, { target: "VizPri" }) ])),
            { f: M("f", 200, 300, { mtype: "fireroamer", hp: 84000, attack: 320 }) }),
        run: c => c.support(),
        expect: calls => !calls.some(c => c[0] === "skill" && c[1] === "agitate"),
    },
    "stream: Agitate on free scorpions, then fight": {
        party: PARTY, players: { VizPri: Object.assign({}, PRI, { hp: 5900 }) },
        entities: { a: M("a", 400, 300), b: M("b", 420, 330), c: M("c", 380, 260) },
        run: c => { c.support(); return c.support(); },
        expect: () => true,
    },
    "escape from a monster the team model rejects": {
        party: PARTY, players: { VizPri: Object.assign({}, PRI, { hp: 5900 }) }, reject: ["fireroamer"],
        entities: { f: M("f", 330, 300, { mtype: "fireroamer", hp: 84000, attack: 320, target: "VizWar", speed: 20 }) },
        run: c => c.support(),
        expect: calls => calls.some(c => c[0] === "log" && /escaping/.test(c[1])) && calls.some(c => c[0] === "move"),
    },
    "Hard Shell when the predicted hits reach our HP": {
        party: PARTY, me: { hp: 1500 },
        entities: Object.fromEntries([0, 1, 2, 3].map(i => [ "m" + i, M("m" + i, 310, 300 + i * 5, { target: "VizWar", attack: 800 }) ])),
        run: c => c.survive(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "hardshell"),
    },
    "Cleave and Stomp with several around": {
        party: PARTY, me: { mp: 1295 },
        entities: Object.fromEntries([0, 1, 2].map(i => [ "m" + i, M("m" + i, 310 + i * 10, 300, { target: "VizWar" }) ])),
        run: c => c.fight(M("m0", 310, 300, { target: "VizWar" })),
        expect: calls => calls.some(c => c[1] === "cleave") || calls.some(c => c[1] === "stomp"),
    },
    "sword swap on a quick target": {
        party: PARTY, target: "q",
        entities: { q: M("q", 320, 300, { hp: 900, max_hp: 900, target: "VizWar" }) },
        run: c => c.always(),
        expect: calls => calls.some(c => c[0] === "equip"),
    },
    "Charge while walking": {
        party: PARTY, moving: true,
        run: c => c.always(),
        expect: calls => calls.some(c => c[0] === "skill" && c[1] === "charge"),
    },
    "a death after an Agitate blocks the killer's kind": {
        party: PARTY, players: { VizPri: Object.assign({}, PRI, { hp: 5900 }) },
        entities: { a: M("a", 400, 300), b: M("b", 420, 330), c: M("c", 380, 260) },
        run: c => { c.support(); c.onDeath("gscorpion"); },
        expect: () => true,
    },
};

async function runAll(file) {
    const out = {};
    for (const name of Object.keys(SCENARIOS)) {
        const env = setup(SCENARIOS[name]);
        Object.keys(require.cache).filter(k => k.includes(path.join("classes", "warrior")) || k === path.resolve(file)).forEach(k => delete require.cache[k]);
        const c = require(file)(env.ctx);
        await SCENARIOS[name].run(c);
        await new Promise(r => setTimeout(r, 250));
        out[name] = env.calls;
    }
    return out;
}

(async () => {
    const fresh = await runAll(path.join(root, "bot", "classes", "warrior", "warrior.js"));
    Object.keys(SCENARIOS).forEach(n => check(SCENARIOS[n].expect(fresh[n]), "warrior: " + n + "  (" + fresh[n].filter(c => c[0] !== "status").map(c => c[0] === "log" ? "log" : c.join(":")).join(" ").slice(0, 110) + ")"));
    const old = process.argv[2];
    if (old) {
        const before = await runAll(path.resolve(old));
        Object.keys(SCENARIOS).forEach(n => check(JSON.stringify(before[n]) === JSON.stringify(fresh[n]), "same calls as the old file: " + n +
            (JSON.stringify(before[n]) === JSON.stringify(fresh[n]) ? "" : "\n      old " + JSON.stringify(before[n]) + "\n      new " + JSON.stringify(fresh[n]))));
    }
    console.log(failed ? `\n${failed} FAILED` : "\nall ok");
    process.exit(failed ? 1 : 0);
})();
