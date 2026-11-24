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

// ---- step 2: direct delivery in comms ----
(async function () {
    NOW = 1e12 + 100000;
    globalThis.top = {};
    const cm = [];
    globalThis.send_cm = (to, msg) => { cm.push([to, msg.t]); return Promise.resolve(); };
    const mk = (name) => {
        globalThis.character = { name, on: () => 1, remove: () => {} };
        const c = fresh("lib/comms.js")(config, util);
        const tv = fresh("team/team-view.js")();
        tv.publish({ name, role: "x", game: () => ({}), bot: {}, actions: { deliver: (msg, from) => c.receive(msg, from) } });
        return c;
    };
    config.characters.VizMerch = {};
    const pri = mk("VizPri"), war = mk("VizWar");
    const got = [];
    war.on("stats", (d, from) => got.push([from, d.hp]));
    globalThis.character = { name: "VizPri", on: () => 1, remove: () => {} };
    const payload = { hp: 100 };
    pri.send(["VizWar", "VizMerch"], "stats", payload);
    payload.hp = 999; // the receiver gets a copy as sent, like over the network
    check(got.length === 0, "direct delivery runs after the sending code (not inside send)");
    await Promise.resolve(); await Promise.resolve();
    check(got.length === 1 && got[0][0] === "VizPri" && got[0][1] === 100, "a teammate in our client gets the message directly, as a copy");
    check(cm.length === 1 && JSON.stringify(cm[0][0]) === JSON.stringify(["VizMerch"]) && cm[0][1] === "stats", "a teammate not in our client gets it through the server");
    check(pri.counts().direct === 1 && pri.counts().server === 1, "counts: 1 direct, 1 through the server");
    NOW += 11000; // war's entry goes stale
    pri.send("VizWar", "stats", { hp: 1 });
    check(cm.length === 2 && cm[1][0] === "VizWar", "a stale entry: through the server again");

    // ---- step 2: team stats live from the view ----
    globalThis.top = {};
    globalThis.character = { name: "VizPri", on: () => 1, remove: () => {} };
    const tvWar = fresh("team/team-view.js")();
    let warHp = 5000;
    tvWar.publish({ name: "VizWar", role: "member", game: () => ({}), bot: { stats: () => ({ name: "VizWar", max_hp: warHp }) } });
    const statsUtil = Object.assign({}, util, { combatStats: () => ({ name: "VizPri", max_hp: 3000 }) });
    const cfgStats = Object.assign({}, config, { team: Object.assign({}, config.team, { fighters: ["VizPri", "VizWar", "VizMage"] }) });
    const ts = fresh("team/team-stats.js")({ config: cfgStats, util: statsUtil, comms: { on: () => {}, send: () => {} },
        party: { enabled: true, inParty: () => true } });
    let list = ts.teamStats();
    check(list.length === 2 && list[1].name === "VizWar" && list[1].max_hp === 5000, "team stats: a teammate in our client counts live, without any report");
    warHp = 5200;
    check(ts.teamStats()[1].max_hp === 5200, "team stats: a change is seen at once");
    ts.reports.VizMage = { s: { name: "VizMage", max_hp: 2500 }, at: NOW };
    list = ts.teamStats();
    check(list.length === 3 && list.some(s => s.name === "VizMage"), "team stats: a teammate outside our client counts by its fresh report");
    NOW += 11000;
    list = ts.teamStats();
    check(!list.some(s => s.name === "VizWar") && list.some(s => s.name === "VizMage"), "team stats: a stale entry without a report drops out (as before)");
    console.log(failed ? failed + " FAILED" : "all passed");
    process.exit(failed ? 1 : 0);
})();
