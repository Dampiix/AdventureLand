// Tests for whole-spawn rage zones (v1.238.0): the monster rules (monsters/monsters.js wholeSpawn), the remembered
// strongest level (bot_rage_seen), the spawn choice (failingSpawnAt) and the farm / hunt objection (rageSpawnObjection).
// The team verdict is faked: it passes when pull x attack stays below a limit.
// Run: node scripts/test-rage-spawns.cjs
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

let NOW = 1e12;
Date.now = () => NOW;
const store = {};
globalThis.get = k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null);
globalThis.set = (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); return true; };
globalThis.character = { name: "VizPri", map: "main", real_x: 0, real_y: 0 };
globalThis.parent = { entities: {} };
globalThis.G = {
    monsters: { mummy: { attack: 420, hp: 12000, frequency: 1 }, booboo: { attack: 220, hp: 8000, frequency: 1 }, bee: { attack: 20, hp: 500, frequency: 1 } },
    maps: {
        spookytown: { monsters: [
            { type: "mummy", count: 9, boundary: [31, -1571, 480, -1293], rage: [-124, -1631, 614, -1130] },
            { type: "booboo", count: 5, boundary: [286, -842, 544, -562], rage: [286, -842, 544, -562] },
            { type: "booboo", count: 4, boundary: [-820, -940, -570, -630], rage: [-820, -940, -570, -630] },
        ] },
        level3: { monsters: [{ type: "mummy", count: 3, boundary: [-451, -397, -241, -65] }] },
        main: { monsters: [{ type: "bee", count: 6, boundary: [0, 0, 300, 300] }] },
    },
};

function fresh(rel) {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", rel));
}
const util = {
    xy: p => ({ x: p.real_x !== undefined ? p.real_x : p.x, y: p.real_y !== undefined ? p.real_y : p.y }),
    spawnBoxes: p => (p.boundary ? [p.boundary] : []),
    log: () => {},
};
let LIMIT = 2000; // the fake team takes pull x attack up to this
function makeTgt() {
    const spots = fresh("safety/spots.js")({ game: { me: () => character, data: () => G, canMoveTo: () => true }, util, config: { targeting: {} } });
    const tgt = { spots, zonesByMap: {}, zoneCache: {}, rageLogged: {},
        teamModelOn: () => true,
        teamVerdict: (type, live, opts) => {
            const pull = (opts && opts.pull) || 3;
            const ok = pull * (live.attack || 0) <= LIMIT;
            return { ok, why: ok ? "fine" : pull + " x " + live.attack + " too much" };
        },
        packVerdict: () => ({ ok: true }) };
    fresh("safety/rage-zones.js")(tgt, { config: { targeting: { rage: {} }, travel: { wallMonsters: [] } }, util,
        party: { enabled: false, isMember: false } });
    return { tgt, spots };
}

// 1. zones from the map data: every rage box is a whole-spawn zone; level3's mummies (no box) are none
let { tgt, spots } = makeTgt();
check(tgt.zonesOf("mummy").length === 1 && tgt.zonesOf("booboo").length === 2 && tgt.zonesOf("bee").length === 0, "zones: the mummy and both booboo rage boxes, nothing for the bees");
check(spots.spotBox("mummy", { map: "spookytown", x: 256, y: -1432 }).rage === true && spots.spotBox("mummy", { map: "level3", x: -346, y: -231 }).rage === false,
    "spotBox: the Spooky Town mummies come as one spawn, the level3 ones not");

// 2. the spawn choice: 9 mummies fail, the level3 spot has no zone; no objection (another spawn is left)
const spook = { map: "spookytown", x: 256, y: -1432 }, l3 = { map: "level3", x: -346, y: -231 };
check(/9 at once/.test(String(tgt.failingSpawnAt("mummy", spook))) && tgt.failingSpawnAt("mummy", l3) === false, "spawn choice: the 9-mummy rage spawn fails, level3 is free");
check(tgt.rageSpawnObjection("mummy") === null, "objection: none for mummies (level3 has no rage box - the usual checks decide)");

// 3. booboos: both spawns are rage zones - 5 x 220 and 4 x 220 pass at limit 2000? 5 x 220 = 1100, fine
check(tgt.rageSpawnObjection("booboo") === null, "objection: none while one booboo spawn passes");
LIMIT = 800; ({ tgt } = makeTgt());
check(/booboo rage zone: [45] at once/.test(String(tgt.rageSpawnObjection("booboo"))), "objection: every booboo spawn fails -> the team objects with the reason");

// 4. the remembered level: a member saw a level-8 booboo (attack 400) at the 4-spawn; the leader elsewhere judges with it
LIMIT = 1000; ({ tgt } = makeTgt());
check(tgt.failingSpawnAt("booboo", { map: "spookytown", x: -695, y: -785 }) === false, "level 1 (4 x 220 = 880): the 4-booboo spawn passes");
character.map = "spookytown";
parent.entities = { b1: { type: "monster", mtype: "booboo", level: 8, attack: 400, max_hp: 30000, frequency: 1, real_x: -700, real_y: -800 },
    b2: { type: "monster", mtype: "booboo", level: 2, attack: 240, max_hp: 9000, frequency: 1, real_x: -650, real_y: -700 } };
NOW += 11000; // the verdict is cached 10 s: a new look
tgt.zoneVerdict(tgt.zonesOf("booboo").find(z => z.count === 4));
character.map = "main"; parent.entities = {};
({ tgt } = makeTgt()); // a fresh character (another frame): only the shared storage knows
const why = tgt.failingSpawnAt("booboo", { map: "spookytown", x: -695, y: -785 });
check(/level 8\+, seen earlier/.test(String(why)), "remembered: another character's level-8 sighting fails the spawn from afar (" + why + ")");
// a partial view at a lower level does not lower it; a good view (half the spawn) does
character.map = "spookytown";
parent.entities = { b3: { type: "monster", mtype: "booboo", level: 1, attack: 220, max_hp: 8000, frequency: 1, real_x: -700, real_y: -800 } };
NOW += 11000; ({ tgt } = makeTgt());
tgt.zoneVerdict(tgt.zonesOf("booboo").find(z => z.count === 4));
check(get("bot_rage_seen")["spookytown:-820,-940,-570,-630"].level === 8, "one level-1 booboo in sight keeps the level 8");
parent.entities = { b3: parent.entities.b3, b4: Object.assign({}, parent.entities.b3, { real_x: -680 }) };
NOW += 11000; ({ tgt } = makeTgt());
tgt.zoneVerdict(tgt.zonesOf("booboo").find(z => z.count === 4));
check(get("bot_rage_seen")["spookytown:-820,-940,-570,-630"].level === 1, "two of four at level 1 (after a Cavalry reset): the level goes down");
NOW += 31 * 60 * 1000; character.map = "main"; parent.entities = {}; ({ tgt } = makeTgt());
check(!/seen earlier/.test(String(tgt.zoneVerdict(tgt.zonesOf("booboo").find(z => z.count === 4)).why)), "after 30 min the sighting is forgotten");

// 5. the monster rules: a special file can switch it off or on
const M = fresh("monsters/monsters.js");
check(M.wholeSpawn("mummy", { rage: [1, 2, 3, 4] }) === true && M.wholeSpawn("mummy", {}) === false && M.of("bee").wholeSpawn === "auto", "rules: auto follows the rage box");

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
