// Tests for the team config (docs/architecture/team-config.md): deriveTeam from account / leader / team, the mode per
// start (leader, member started by the leader, solo), and the same derived team as the old shape for today's setup.
// Run: node scripts/test-team-config.cjs [git ref of the old config.js + lib/team.js, default feafcde]
const path = require("path"), fs = require("fs"), os = require("os");
const { execSync } = require("child_process");
const root = path.resolve(__dirname, "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const ref = process.argv[2] || "feafcde";

function fresh() {
    Object.keys(require.cache).filter(k => /[\\/]bot[\\/]/.test(k)).forEach(k => delete require.cache[k]);
    return { config: JSON.parse(JSON.stringify(require(path.join(root, "bot", "config.js")))), team: require(path.join(root, "bot", "lib", "team.js")) };
}
function as(name, topName) {
    globalThis.character = { name: name };
    globalThis.top = { character: { name: topName || name } };
    const f = fresh();
    return f.team.deriveTeam(f.config);
}

// 1. the leader
let c = as("VizPri");
check(c.mode === "leader" && c.leader === "VizPri" && c.merchant === "VizMerch", "leader: mode leader");
check(JSON.stringify(c.phases.party.party) === JSON.stringify(["VizPri", "VizWar", "VizMage"]), "party: leader + team");
check(JSON.stringify(c.phases.party.startWithLeader) === JSON.stringify(["VizWar", "VizMage", "VizMerch"]), "the leader starts the team and the merchant");
check(JSON.stringify(c.team.fighters) === JSON.stringify(["VizPri", "VizWar", "VizMage", "VizRng"]) && JSON.stringify(c.team.solo) === JSON.stringify(["VizRng"]), "fighters: every account character; solo: the rest");
check(Object.keys(c.characters).length === 5 && c.characters.VizMerch.role === "merchant" && c.characters.VizRng.role === "fighter", "characters: four fighters + the merchant (trusted)");
// 2. a team member started by the leader (hidden frame in its page) / by the player (own window)
c = as("VizWar", "VizPri");
check(c.mode === "member" && c.startedByLeader === true, "VizWar in the leader's page: member");
c = as("VizWar", "VizWar");
check(c.mode === "solo" && c.startedByLeader === false, "VizWar in its own window: solo");
check(JSON.stringify(c.phases.party.party) === JSON.stringify(["VizPri", "VizWar", "VizMage"]), "solo: the party list stays the same (the merchant reads it)");
// 3. other account characters and the merchant
check(as("VizRng", "VizPri").mode === "solo", "VizRng (not in the team), even in the leader's page: solo");
check(as("VizMerch", "VizPri").mode === "merchant", "the merchant: merchant");
// 4. a second call (main.js after the config) gives the same
globalThis.character = { name: "VizMage" }; globalThis.top = { character: { name: "VizPri" } };
let f = fresh(); const once = JSON.stringify(f.team.deriveTeam(f.config)); const twice = JSON.stringify(f.team.deriveTeam(f.config));
check(once === twice, "deriveTeam twice: the same result");
// 5. today's setup: the same team, characters and party as the old shape (old config + old deriveTeam from git)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "teamcfg-"));
execSync("git archive " + ref + " bot | tar -x -C \"" + tmp.replace(/\\/g, "/") + "\"", { cwd: root, shell: "bash" });
Object.keys(require.cache).forEach(k => delete require.cache[k]);
globalThis.character = { name: "VizPri" }; globalThis.top = { character: { name: "VizPri" } };
const oldCfg = JSON.parse(JSON.stringify(require(path.join(tmp, "bot", "config.js"))));
require(path.join(tmp, "bot", "lib", "team.js")).deriveTeam(oldCfg);
c = as("VizPri");
const pick = x => JSON.stringify({ leader: x.leader, merchant: x.merchant, characters: x.characters, phases: x.phases, fighters: x.team.fighters, solo: x.team.solo });
check(pick(oldCfg) === pick(c), "today's setup: leader, merchant, characters, phases, fighters and solo as before");
if (pick(oldCfg) !== pick(c)) { console.log("  old " + pick(oldCfg)); console.log("  new " + pick(c)); }
fs.rmSync(tmp, { recursive: true, force: true });

// 6. the leader rescue (main.js startLeaderRescue): run the function with a fake page, storage and clock
{
    const src = fs.readFileSync(path.join(root, "bot", "main.js"), "utf8").split("\r\n").join("\n");
    const fn = src.slice(src.indexOf("let leaderRescueOn = false;"), src.indexOf("}, lr.checkMs || 30 * 1000);\n}") + "}, lr.checkMs || 30 * 1000);\n}".length);
    let NOW = 1e12, tick = null; const store = {}, calls = [], logs = [];
    const page = { character: { name: "VizPri" }, code_run: true, api_call: (n, a) => calls.push([n, a]) };
    const make = new Function("BOT_CONFIG", "BOT_UTIL", "top", "get", "set", "setInterval", "character", "Date", fn + "\nreturn startLeaderRescue;");
    const FakeDate = { now: () => NOW };
    const start = make({ leader: "VizPri", mode: "member", party: { leaderRescue: { silentMs: 180000, gapMs: 300000, checkMs: 30000, slot: 20 } } },
        { log: (t, m) => logs.push(m), errReason: e => String(e) }, page, k => store[k] || null, (k, v) => { store[k] = v; },
        (f) => { tick = f; }, { name: "VizWar" }, FakeDate);
    start();
    store["bot_beat:VizPri"] = { at: NOW };
    NOW += 60000; tick();
    check(calls.length === 0, "rescue: a heartbeat 1 min old - nothing");
    NOW += 150000; tick();
    check(calls.length === 1 && calls[0][0] === "load_code" && calls[0][1].name === "20" && calls[0][1].run === "1", "rescue: 3.5 min silent - the leader's code restarts (slot 20)");
    check(logs.some(m => /VizPri's code is silent \(4 min\)/.test(m)), "rescue: journal line");
    NOW += 60000; tick();
    check(calls.length === 1, "rescue: not again within gapMs (claim in the shared storage)");
    page.code_run = false; NOW += 400000; tick();
    check(calls.length === 1, "rescue: not when the player stopped the leader's code (code_run false)");
    page.code_run = true; page.character.name = "VizWar"; tick();
    check(calls.length === 1, "rescue: not outside the leader's page");
}

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
