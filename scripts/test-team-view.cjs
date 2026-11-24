// Tests for the team view (docs/architecture/team-view.md): the registry (step 0) and the leader's live report read by
// a member (step 1). The leader's and the member's party modules run side by side with one fake team registry.
// Run: node scripts/test-team-view.cjs
const path = require("path");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

globalThis.top = {};
globalThis.setInterval = () => 0;
let NOW = 1e12;
Date.now = () => NOW;
globalThis.character = { name: "VizPri" };
const CONFIG = require(path.join(root, "bot", "config.js"));

function fresh(rel) {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/](team|lib|safety)[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return require(path.join(root, "bot", rel));
}
function setGlobals(me) {
    globalThis.character = me;
    globalThis.smart = me.__smart || { moving: false };
    globalThis.get_party = () => ({ VizPri: {}, VizWar: {}, VizMage: {} });
    globalThis.G = { maps: { desertland: { monsters: [] } }, monsters: {} };
    globalThis.get = () => null; globalThis.set = () => {};
    globalThis.game_log = () => {}; globalThis.set_message = () => {};
    globalThis.parent = { entities: {} };
}
const config = JSON.parse(JSON.stringify(CONFIG));
config.leader = "VizPri"; config.phase = "party";
config.phases = Object.assign({}, config.phases, { party: Object.assign({}, (CONFIG.phases || {}).party, { party: ["VizPri", "VizWar", "VizMage"] }) });
config.characters = { VizPri: {}, VizWar: {}, VizMage: {} };
const sent = [], logs = [];
const comms = () => ({ on: () => {}, send: (to, type, data) => sent.push([to, type, data]) });
const util = Object.assign({}, fresh("lib/util.js"), { log: (tag, t) => logs.push(t), status: () => {} });
const bus = () => { const p = {}; return { provide: (n, f) => { p[n] = f; }, get: n => (p[n] ? p[n]() : null) }; };

// the leader
const pri = { name: "VizPri", map: "desertland", x: 400, y: -1400, real_x: 400, real_y: -1400, __smart: { moving: true, map: "desertland", x: 600, y: -1300 } };
setGlobals(pri);
const leaderParty = fresh("team/party.js")({ config, util, comms: comms(), bus: bus() });
const tvLeader = fresh("team/team-view.js")();
tvLeader.publish({ name: "VizPri", role: "leader", game: () => pri, bot: { lead: () => leaderParty.leadData() } });
leaderParty.setGoal("spot", "gscorpion", { map: "desertland", x: 391, y: -1422 });
leaderParty.broadcast({ monster: "gscorpion" }, { id: "m1" }, null);
const msg = sent.find(s => s[1] === "lead");
check(!!msg, "the leader still sends the lead message (fallback)");

// a member in the same client
const war = { name: "VizWar", map: "desertland", x: 64, y: 30, real_x: 380, real_y: -1380 };
setGlobals(war);
const memberParty = fresh("team/party.js")({ config, util, comms: comms(), bus: bus() });
setGlobals(pri); // the leader's report is computed in the leader's realm (its character and smart)
const live = memberParty.leaderInfo();
setGlobals(war);
const strip = o => { const c = Object.assign({}, o); delete c.at; return JSON.stringify(c); };
check(live && strip(live) === JSON.stringify(msg[2]), "a member reads the same report live from the team view");
check(memberParty.leadVia() === "view", "the member's source is the team view");
// the leader moves on: the member sees it at once, without a new message
pri.x = 700; pri.real_x = 700;
setGlobals(pri);
const moved = memberParty.leaderInfo();
check(moved && moved.x === 700, "the leader's new position is seen at once (no message in between)");
// the leader's frame stops beating: the member falls back to the (empty) message state
NOW += 11000;
check(memberParty.leaderInfo() === null && memberParty.leadVia() === null, "a stale leader entry falls back to messages (none here)");
check(logs.some(t => /live from the team view/.test(t)), "the journal notes the source");

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
