// Tests for the class modules (module plan, stage 2) with a fake game - no client needed.
// Run: node scripts/test-classes.cjs <class> [path to the old single-file classes/<class>.js]
// Each scenario sets up a game, runs the class's hooks and records every call into the game (skills, heals, equips,
// moves, messages, log lines). Checked: the expected behaviour; with an old file given, also that the old and the new
// class make exactly the same calls.
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

const BASE_G = {
    skills: {
        heal: {}, partyheal: { mp: 400 }, curse: { mp: 400 }, darkblessing: { mp: 900, level: 70 }, absorb: { mp: 200, level: 55, range: 240 },
        revive: {}, taunt: { range: 200, class: ["warrior", "paladin"] }, agitate: { class: ["warrior"], range: 320, mp: 420 },
        "3shot": { level: 60, wtype: "bow", mp: 300, damage_multiplier: 0.7 }, huntersmark: { mp: 240 }, supershot: { mp: 400, wtype: "bow" },
        poisonarrow: { mp: 360 }, rspeed: { level: 40, mp: 320, range: 320 }, invis: { mp: 600 },
        fanofknives: { level: 65, mp: 200, range: 120, slot: [["belt", "knifebelt"]] }, quickstab: { mp: 40, wtype: "dagger" },
        quickpunch: { mp: 40, wtype: "fist" }, mentalburst: { mp: 50, requirements: { int: 64 }, damage_multiplier: 0.6 }, pcoat: { mp: 600 },
        mshield: {}, guardians_oath: { level: 50 }, cleansing_light: { level: 30 }, selfheal: { mp: 20 }, smash: { mp: 380, wtype: "mace" },
    },
    conditions: { poisoned: { cleansable: true }, eburn: { cleansable: true } },
    monsters: { gscorpion: { attack: 320, hp: 2400, speed: 9, range: 64 }, phoenix: { cooperative: true, attack: 300, hp: 300000 },
        crabxx: { attack: 900 } },
    items: { bow: { type: "weapon", wtype: "bow" }, dagger: { type: "weapon", wtype: "dagger" }, mace: { type: "weapon", wtype: "mace" } },
    classes: {}, maps: { desertland: {} },
};

function setup(scenario, cls) {
    const sc = JSON.parse(JSON.stringify(scenario)); // a fresh copy per run
    const calls = [];
    const g = globalThis;
    g.G = JSON.parse(JSON.stringify(BASE_G));
    g.character = Object.assign({ name: "VizPri", ctype: "priest", level: 69, hp: 5900, max_hp: 5945, mp: 5000, max_mp: 5080,
        x: 100, y: 100, real_x: 100, real_y: 100, map: "desertland", attack: 805, courage: 2, mcourage: 14, pcourage: 2, rip: false, s: {},
        items: [{ name: "essenceoflife", q: 1 }], slots: {} }, sc.me || {});
    g.parent = { entities: sc.entities || {} };
    const players = sc.players || {};
    g.get_player = n => players[n] || null;
    g.get_party = () => sc.party || {};
    g.is_in_range = (e, skill) => !(e && e.far);
    g.is_on_cooldown = s => (sc.cooldown || []).includes(s);
    g.is_moving = () => false;
    g.use_skill = (name, target, extra) => { calls.push(["skill", name, target && target.name ? target.name : JSON.stringify(target), extra]); return Promise.resolve(); };
    g.xmove = (x, y) => { calls.push(["xmove", Math.round(x), Math.round(y)]); return Promise.resolve(); };
    g.stop = what => { calls.push(["stop", what]); return Promise.resolve(); };
    g.set_message = () => {};
    g.game_log = t => calls.push(["log", t]);
    const store = sc.store || {};
    Object.keys(store).forEach(k => { if (store[k] && store[k].at === "now") store[k].at = Date.now(); });
    g.get = k => (k in store ? store[k] : null);
    g.set = () => {};
    g.BOT_CONFIG = {};
    const util = require(path.join(root, "bot", "lib", "util.js"));
    const config = {
        classes: { priest: { healBelow: 0.75, selfHealBelow: 0.6, partyHealBelow: 0.65, partyHealDanger: 0.35, partyHealOne: 0.5, useCurse: true, mpReserveRatio: 0.4,
            useRevive: true, absorb: { enabled: true, below: 0.35, selfAbove: 0.6 },
            luckCatch: { enabled: true, hits: 2, maxPull: 5, minHp: 0.6, everyMs: 1500, tankRange: 400, logEveryMs: 600000 },
            darkBlessing: { enabled: true, sturdyHits: 10 } },
            ranger: { sturdyHits: 3, mpReserveRatio: 0.3, usePoisonArrow: true },
            rogue: { mpReserveRatio: 0.25, swiftness: true, smokeBelow: 0.25, smokeUntil: 0.6, smokeClear: 200, mentalBurst: true, fanFrom: 3, poisonCoat: { enabled: true, minHits: 40 } },
            paladin: { selfHealBelow: 0.6, useSmash: true, mpReserve: 150, oathBelow: 0.5, useCleansingLight: true, manaShield: { onBelow: 0.35, offAbove: 0.7, minMp: 0.25 } } },
        targeting: { teamSafety: { tankClasses: ["warrior", "paladin"] } }, events: { noArea: ["crabxx"] }, characters: {},
    };
    const ctx = {
        util: util, config: config,
        party: { enabled: sc.solo ? false : true, isMember: !!sc.member, detached: () => false, memberNames: () => Object.keys(sc.party || {}) },
        strike: { heal: e => calls.push(["strike.heal", e.name]), skill: (name, t) => calls.push(["strike.skill", name, t.map(e => e.id).join(",")]) },
        comms: { send: (to, type) => calls.push(["send", to, type]) },
        gear: { luckOn: () => calls.push(["luckOn"]) },
        targeting: { diesSoon: m => (sc.dying || []).includes(m.id), rageBoxes: () => sc.rageBoxes || [] },
    };
    return { calls, ctx };
}

const P = (name, ctype, hp, max, extra) => Object.assign({ name: name, ctype: ctype, hp: hp, max_hp: max, x: 120, y: 100, real_x: 120, real_y: 100 }, extra || {});
const SCENARIOS = {
    priest: {
        "heals the most hurt member": {
            party: { VizPri: {}, VizWar: {}, VizMage: {} },
            players: { VizWar: P("VizWar", "warrior", 7500, 12221), VizMage: P("VizMage", "mage", 3700, 3758) }, // 61 %: above partyHealOne
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "strike.heal" && c[1] === "VizWar"),
        },
        "Party Heal for two hurt members": {
            party: { VizPri: {}, VizWar: {}, VizMage: {} },
            players: { VizWar: P("VizWar", "warrior", 7000, 12221), VizMage: P("VizMage", "mage", 2300, 3758) },
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "partyheal"),
        },
        "Party Heal for a member out of sight (heartbeat)": {
            party: { VizPri: {}, VizWar: {}, VizMage: {} },
            players: { VizMage: P("VizMage", "mage", 3700, 3758) },
            store: { "bot_beat:VizWar": { at: "now", hp: 0.3, rip: false } },
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "partyheal"),
        },
        "Absorb Sins for a member in danger without a tank near": {
            party: { VizPri: {}, VizMage: {} },
            players: { VizMage: P("VizMage", "mage", 1000, 3758) },
            entities: { m1: { id: "m1", type: "monster", mtype: "gscorpion", target: "VizMage" } },
            cooldown: ["partyheal"],
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "absorb" && c[2] === "VizMage"),
        },
        "luck catch: dying monster on the tank": {
            party: { VizPri: {}, VizWar: {} },
            players: { VizWar: P("VizWar", "warrior", 11000, 12221) },
            entities: { m1: { id: "m1", type: "monster", mtype: "gscorpion", target: "VizWar" }, m2: { id: "m2", type: "monster", mtype: "gscorpion", target: "VizWar" } },
            dying: ["m1"],
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "luckOn") && calls.some(c => c[0] === "skill" && c[1] === "absorb" && c[2] === "VizWar"),
        },
        "revives a fallen member": {
            party: { VizPri: {}, VizWar: {} },
            players: { VizWar: P("VizWar", "warrior", 12221, 12221, { rip: true }) },
            run: c => c.support(),
            expect: calls => calls.some(c => c[0] === "send" && c[2] === "revive_wait") && calls.some(c => c[0] === "skill" && c[1] === "revive"),
        },
        "no revive at a rage zone": {
            party: { VizPri: {}, VizWar: {} },
            players: { VizWar: P("VizWar", "warrior", 12221, 12221, { rip: true }) },
            rageBoxes: [{ type: "booboo", b: [130, 90, 300, 300] }],
            run: c => c.support(),
            expect: calls => !calls.some(c => c[1] === "revive") && calls.some(c => c[0] === "log" && /rage zone/.test(c[1])),
        },
        "Curse and Dark Blessing on a boss": {
            party: { VizPri: {} }, me: { level: 70 }, // Dark Blessing needs level 70
            run: c => c.fight({ id: "b", name: "phx", mtype: "phoenix", hp: 300000, s: {} }),
            expect: calls => calls.some(c => c[1] === "curse") && calls.some(c => c[1] === "darkblessing"),
        },
        "heals itself when low (survive)": {
            party: { VizPri: {} }, me: { hp: 3000 },
            run: c => c.survive(),
            expect: calls => calls.some(c => c[0] === "strike.heal" && c[1] === "VizPri"),
        },
        "heals in place while busy": {
            party: { VizPri: {}, VizWar: {} },
            players: { VizWar: P("VizWar", "warrior", 8500, 12221) },
            run: c => c.supportInPlace(),
            expect: calls => calls.some(c => c[0] === "strike.heal" && c[1] === "VizWar"),
        },
    },
    ranger: {
        "3-Shot on three monsters on the team": {
            party: { VizRng: {}, VizWar: {} }, me: { name: "VizRng", ctype: "ranger", slots: { mainhand: { name: "bow", level: 5 } } },
            entities: { a: {"id":"a","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400,"target":"VizWar"}, b: {"id":"b","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400,"target":"VizRng"}, c: {"id":"c","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400,"target":"VizWar"} },
            run: c => c.fight({"id":"a","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400,"target":"VizWar"}),
            expect: calls => calls.some(c => c[0] === "strike.skill" && c[1] === "3shot" && c[2].split(",").length === 3),
        },
        "Hunter's Mark, Supershot and Poison Arrow on a sturdy target": {
            party: { VizRng: {} }, me: { name: "VizRng", ctype: "ranger", slots: { mainhand: { name: "bow", level: 5 } }, items: [{ name: "poison", q: 3 }] },
            run: c => c.fight({"id":"t","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":20000,"s":{}}),
            expect: calls => ["huntersmark", "supershot", "poisonarrow"].every(n => calls.some(c => c[0] === "skill" && c[1] === n)),
        },
    },
    rogue: {
        "Rogue Swiftness on ourselves": {
            party: { VizRog: {} }, me: { name: "VizRog", ctype: "rogue", level: 60, max_mp: 2000, mp: 2000, s: {} },
            run: c => c.always(),
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "rspeed" && c[2] === "VizRog"),
        },
        "Assassin's Smoke and hiding at low HP": {
            party: { VizRog: {} }, me: { name: "VizRog", ctype: "rogue", level: 60, hp: 1000, max_hp: 5000, max_mp: 2000, mp: 2000, s: {} },
            entities: { a: {"id":"a","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400,"target":"VizRog"} },
            run: c => { c.survive(); return c.support(); },
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "invis") && calls.some(c => c[0] === "xmove"),
        },
        "Fan of Knives with the Knife Belt, Quick Stab, Mental Burst": {
            party: { VizRog: {} }, me: { name: "VizRog", ctype: "rogue", level: 70, int: 70, attack: 900, max_mp: 2000, mp: 2000, s: {},
                slots: { belt: { name: "knifebelt" }, mainhand: { name: "dagger", level: 5 } } },
            entities: { a: {"id":"a","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400}, b: {"id":"b","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400}, c: {"id":"c","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":2400} },
            run: c => c.fight({"id":"a","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":300}),
            expect: calls => ["fanofknives", "quickstab", "mentalburst"].every(n => calls.some(c => c[0] === "skill" && c[1] === n)),
        },
        "visible again for the party": {
            party: { VizRog: {}, VizPri: {} }, member: true, me: { name: "VizRog", ctype: "rogue", level: 60, s: { invis: {}, rspeed: {} } },
            run: c => c.always(),
            expect: calls => calls.some(c => c[0] === "stop" && c[1] === "invis"),
        },
    },
    paladin: {
        "Mana Shield and self-heal at low HP": {
            party: { VizPal: {} }, me: { name: "VizPal", ctype: "paladin", hp: 1500, max_hp: 6000, mp: 3000, max_mp: 3000, s: {} },
            run: c => c.survive(),
            expect: calls => calls.some(c => c[1] === "mshield") && calls.some(c => c[1] === "selfheal"),
        },
        "Guardian's Oath and Cleansing Light on allies": {
            party: { VizPal: {}, VizMage: {} }, me: { name: "VizPal", ctype: "paladin", level: 60 },
            players: { VizMage: P("VizMage", "mage", 1500, 3758, { s: { poisoned: {} } }) },
            run: c => c.support(),
            expect: calls => calls.some(c => c[1] === "guardians_oath" && c[2] === "\"VizMage\"") && calls.some(c => c[1] === "cleansing_light"),
        },
        "Smash on a sturdy target": {
            party: { VizPal: {} }, me: { name: "VizPal", ctype: "paladin", mp: 3000, max_mp: 3000, slots: { mainhand: { name: "mace", level: 5 } } },
            run: c => c.fight({"id":"t","type":"monster","mtype":"gscorpion","visible":true,"x":130,"y":100,"real_x":130,"real_y":100,"hp":20000}),
            expect: calls => calls.some(c => c[0] === "skill" && c[1] === "smash"),
        },
    },
};

async function runAll(cls, file) {
    const out = {};
    for (const name of Object.keys(SCENARIOS[cls])) {
        const sc = SCENARIOS[cls][name];
        const env = setup(sc, cls);
        Object.keys(require.cache).filter(k => k.includes(path.join("classes", cls)) || k === path.resolve(file)).forEach(k => delete require.cache[k]);
        const c = require(file)(env.ctx);
        await sc.run(c);
        await new Promise(r => setTimeout(r, 50));
        out[name] = env.calls;
    }
    return out;
}

(async () => {
    const cls = process.argv[2];
    if (!SCENARIOS[cls]) { console.log("usage: node scripts/test-classes.cjs <" + Object.keys(SCENARIOS).join("|") + "> [old file]"); process.exit(1); }
    const fresh = await runAll(cls, path.join(root, "bot", "classes", cls, cls + ".js"));
    Object.keys(SCENARIOS[cls]).forEach(n => check(SCENARIOS[cls][n].expect(fresh[n]), cls + ": " + n));
    const old = process.argv[3];
    if (old) {
        const before = await runAll(cls, path.resolve(old));
        Object.keys(SCENARIOS[cls]).forEach(n => check(JSON.stringify(before[n]) === JSON.stringify(fresh[n]), "same calls as the old file: " + n +
            (JSON.stringify(before[n]) === JSON.stringify(fresh[n]) ? "" : "\n      old " + JSON.stringify(before[n]) + "\n      new " + JSON.stringify(fresh[n]))));
    }
    console.log(failed ? `\n${failed} FAILED` : "\nall ok");
    process.exit(failed ? 1 : 0);
})();
