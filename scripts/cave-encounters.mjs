// Cave of Many Dreams - encounter guide as HTML + PDF (player request 2026-11-24).
//
//   node scripts/cave-encounters.mjs
//
// Reads docs/cave/dreams-event.json (G.events.dreams, saved from get_game_data) and writes
// docs/cave/cave-encounters.html and .pdf (printed with headless Edge/Chrome, like the gear plans).
// The outcome weights and costs come from the game data; effects without data (rescues, conflicts,
// escorts, hunts ...) are described from the guide and the option text and marked "unverified".
// Our picks (REC/AVOID/NOTE) are the first draft from docs/cave-of-many-dreams.md - update both together.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "cave");
const ev = JSON.parse(readFileSync(path.join(outDir, "dreams-event.json"), "utf8"));
const D = ev.data;

// ---- our picks ---------------------------------------------------------------------------------
const REC = { e01: "favor", e02: "e02_0", e03: "e03_4", e04: "e04_0", e05: "e05_2", e06: "cover", e07: "e07_4", e08: "e08_0",
    e09: "e09_1", e10: "e10_4", e11: "testimony", e12: "e12_0", e13: "e13_0", e14: "testimony", e15: "e15_0", e16: "e16_0",
    e17: "e17_1", e18: "e18_0", e19: "e19_0", e20: "watch", e21: "e21_4", e22: "e22_0", e23: "e23_1", e24: "testimony",
    e25: "testimony", e26: "e26_5", e27: "e27_5", e28: "e28_5", e29: "e29_5", e30: "e30_5", e31: "e31_0", e32: "e32_1",
    e33: "e33_1", e34: "e34_1", e35: "e35_0", e36: "e36_1", e37: "e37_0", e38: "e38_0", e39: "e39_0", e40: "e40_0",
    e41: "e41_4", e42: "e42_4", e43: "e43_0", e44: "e44_0", e45: "e45_0", e46: "e46_0", e47: "e47_0", e48: "e48_0",
    e49: "e49_0", e50: "e50_0" };
const AVOID = { e01: ["die"], e10: ["e10_0"], e12: ["e12_2"], e17: ["e17_0"] };
const WHY = {
    e01: "Bets are worth 0 on average; the favor roll gives a helper or two weak guards.",
    e02: "50 % parcel, else 3 guards (1,200 HP) - the worst case is an easy fight.",
    e03: "Sure 2,000 cave gold, no fight, no time (1,000 cave gold is about 1 Amber: the Loaded Die costs 10,000 or 10 Amber). The rats parcel is only in the text.",
    e04: "50 % a BOSS-table roll; else the Lockbreaker - one from an encounter probably pays nothing (no drops, 0 XP), but it is an easy fight.",
    e05: "A hostile traveler (1,200 HP, trivial) - the guide says fights with hostile travelers pay a parcel roll.",
    e06: "First run: cover - no wolf fight, smaller reward; note how many wolves come. Saving pays the rescue table but costs ~20 s per wolf.",
    e07: "Searching the pockets is a sure parcel at no cost and no risk.",
    e08: "Every pen pays the same supply box - three crabs (400 HP) are the quickest; the Lockbreaker gives nothing extra.",
    e09: "50 % a golem ally for the run, else a sentinel fight (16k HP).",
    e10: "Pay 2,000 cave gold for a parcel roll only with spare cave gold (else leave); NEVER the red chain.",
    e11: "Help whoever hits harder - only the winner's side pays the rescue table.",
    e12: "Three guards: 8 % Amber each + XP, quick; the Moth Keeper (14k HP) gives no XP or drops. With a pry bar e12_4. NEVER the red rope.",
    e13: "50 % of the boss table, else a sentinel fight.",
    e14: "Help whoever hits harder - only the winner's side pays.",
    e15: "50 % rescue table + 3,000 cave gold, else 2 travelers (1,200 HP).",
    e16: "50 % parcel + 4,000 cave gold, else 6 bats.",
    e17: "50 % parcel, else 5 bats. NEVER the copy of our strongest fighter.",
    e18: "50 % rescue table, else 8 rats; with a pry bar take e18_2.",
    e19: "50 % parcel + 3,000 cave gold, else 6 bats.",
    e20: "Watching is the only way to Last Word (1 %, ~980k value); a betrayal is harmless (1,200 HP).",
    e21: "A free lamp (leave if we hold one) - 50 % on 3 wolves for half a parcel roll is not worth ~60 s.",
    e22: "50 % of the boss table, else a sentinel fight; with a pry bar take e22_3.",
    e23: "50 % rescue table, else 4 crabs - quicker than the escort.",
    e24: "Help whoever hits harder - only the winner's side pays.",
    e25: "Help whoever hits harder - only the winner's side pays.",
    e26: "Test once: the NPC + 6 guards (all trivial) - six guard drops and probably a parcel roll for the hostile traveler; else _1 (three guards, free).",
    e27: "Test once: the NPC + 6 guards (all trivial) - six guard drops and probably a parcel roll for the hostile traveler; else _1 (three guards, free).",
    e28: "Test once: the NPC + 6 guards (all trivial) - six guard drops and probably a parcel roll for the hostile traveler; else _1 (three guards, free).",
    e29: "Test once: the NPC + 6 guards (all trivial) - six guard drops and probably a parcel roll for the hostile traveler; else _1 (three guards, free).",
    e30: "Test once: the NPC + 6 guards (all trivial) - six guard drops and probably a parcel roll for the hostile traveler; else _1 (three guards, free).",
    e31: "Look at the item; buy with cave gold if it is useful (Loaded Die first).",
    e32: "12 crabs in 90 s is easy for us - twice the supplies.",
    e33: "16 bats in 75 s only if they are close (bats sleep until you come near).",
    e34: "20 rats in 60 s is easy for us - twice the supplies.",
    e35: "Escort to the stairs we walk to anyway: 3,000 cave gold + supplies.",
    e36: "1 Amber for free.",
    e37: "Free roll, a six gives 1 Amber.",
    e38: "Floor 1 without a tool: the pry bar (four encounters use it); later or with a tool: 1 Amber (e38_4).",
    e39: "3 Amber if we pass this room again after a minute, else e39_1 (1 Amber now).",
    e40: "Spar for a supply prize - the trainer cannot kill us.",
    e41: "A guard ally for free; the 2-Amber box is worth less than 2 Amber.",
    e42: "1 Amber for free.",
    e43: "A guard stands down at the next camp and may join us.",
    e44: "Marks the rogue (e20) - Last Word chance.",
    e45: "Escort to the stairs: 3,000 cave gold + supplies.",
    e46: "Look at the item; buy with cave gold if it is useful.",
    e47: "With a lamp the boots in the wall (probably Mothstep Boots), else e47_1 (2 Amber).",
    e48: "Look at the item; buy with cave gold if it is useful.",
    e49: "Floor 1 without a tool: the pry bar (four encounters use it); later or with a tool: 1 Amber (e49_4).",
    e50: "2 Amber is worth more than the parcel's average (~1 Amber).",
};

// ---- effects without outcome data (from the guide and the option texts) -------------------------
const EFFECT = {
    leave: "Nothing - move on.",
    story: "Information only.",
    careful: "Takes the stated seconds of the clock, then the supplies (no risk).",
    save: "Fight the wolves to save them - a success pays the rescue table. (unverified)",
    watch: "Wait; if they die, loot their pack. (unverified)",
    lure: "Draw the wolves away from them. (unverified)",
    hire: "Save them and hire them as a fighter. (unverified)",
    both: "Attack them and the wolves / both sides together. (unverified)",
    cover: "Bring them behind us - smaller reward (parcel roll), probably no fight. (unverified)",
    left: "Fight on this side - the rescue table only if our side wins.",
    right: "Fight on this side - the rescue table only if our side wins.",
    neither: "Let them fight, collect what is left. (unverified)",
    peace: "Pay to stop the fight. (unverified)",
    testimony: "Help whoever hits harder (the likely winner).",
    escort: "Walk the NPC to the stairs: 3,000 cave gold + supplies.",
    escort_safe: "Walk the NPC to the stairs: 3,000 cave gold + supplies.",
    guide: "The NPC joins us as a fighter.",
    tool: "Take a pry bar (opens locked hatches in later encounters).",
    lamp: "Take a lamp (needed for the moth nest, e47).",
    decoy: "Take a rattle / message: the next patrol is drawn away (8 s) or a guard stands down.",
    plant: "Plant now, come back after 1 minute and open the chest: 3 Amber.",
    moths: "Needs a lamp: uncovers the boots in the wall (probably Mothstep Boots). (unverified)",
    reveal: "Marks rooms (or travelers) on the map.",
    appraise: "Marks where the rogue was seen.",
    recipes: "Shows Cole's recipes (information).",
    inspect: "Opens the one-item shop - pay with cave gold; a random original member gets it.",
    free_die: "Free roll: a six gives a chest with 1 Amber.",
    dice: "Bet; roll 4-6 wins the payout (0 on average).",
    dice6: "Bet on a six (0 on average).",
    die: "Bet 6 Amber: a six wins a Loaded Die (1 in 6; the recipe costs 10 Amber).",
    favor: "Roll 4-6: a helper joins; 1-3: two guards attack.",
    dice_room: "A fight: four rats or four crabs.",
    practice: "Spar with the trainer (stops at 1 HP, cannot kill us); win in time for the prize.",
    exchange: "Pay the Amber for a supply box (parcel roll).",
    gift: "Chest with 2 Amber.",
    pay: "Pay and pass.",
    bad_fight: "Fight the three guards (1,200 HP, 35 attack each) - costs nothing.",
    bad_double: "Fight the NPC and six guards.",
    time: "Lose the stated seconds of the clock.",
    wolves: "SIX LEVEL 100 WOLVES.",
    use_tool: "Needs a pry bar: opens it for a reward. (unverified)",
    hunt: "Timed hunt - kill the marked ones in time.",
    hunt_double: "Timed hunt, twice the count - twice the supplies.",
    hunt_quick: "Short timed hunt for 2 Amber.",
    hunt_helper: "Timed hunt with a helper.",
    hunt_late: "Longer time for 2 Amber.",
};
const REWARD = { cave_parcel: "parcel roll", cave_rescue: "rescue roll", cave_boss: "BOSS roll", cave_finish: "finish roll" };
const MON = { cave_rat: "rat", cave_crab: "crab", cave_bat: "bat", cave_wolf: "WOLF", cave_guard: "guard", cave_npc: "traveler",
    cave_rogue: "rogue (captain)", cave_lockbreaker: "Lockbreaker", cave_sentinel: "Sentinel", cave_mothkeeper: "Moth Keeper",
    cave_spider: "spider", cave_scorpion: "scorpion", cave_snake: "snake", cave_broodmother: "Broodmother" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const names = (s) => esc(String(s).replace(/\{npc\}/g, "the NPC").replace(/\{rival\}/g, "the rival"));

function cost(o) {
    const c = [];
    if (o.cost) c.push(o.cost.toLocaleString("en") + " gold");
    if (o.amber) c.push(o.amber + " Amber");
    if (o.seconds) c.push(o.seconds + " s");
    if (o.needs) c.push("needs " + o.needs);
    if (o.effect === "careful") c.push("20 s");
    return c.join(", ") || "-";
}
function what(o) {
    if (Array.isArray(o.outcomes) && o.outcomes.length) {
        const tw = o.outcomes.reduce((s, x) => s + (x.weight || 1), 0);
        return o.outcomes.map((x) => {
            const r = [];
            if (x.reward) r.push(REWARD[x.reward] || x.reward);
            if (x.gold) r.push(x.gold.toLocaleString("en") + " cave gold");
            if (x.amber) r.push(x.amber + " Amber");
            if (x.flags) r.push(x.flags.map((f) => ({ tool: "pry bar", lamp: "lamp", decoy: "rattle", truce: "guard pass" }[f] || f)).join(", "));
            if (x.ally) r.push("ally: " + (MON[x.ally] || x.ally));
            if (x.join) r.push("NPC joins");
            if (x.shadow) r.push("<b class=bad>fight a copy of our strongest</b>");
            if (x.fight) r.push("<b class=" + (x.fight[0] === "cave_wolf" ? "bad" : "fight") + ">fight " + x.fight[1] + " " + (MON[x.fight[0]] || x.fight[0]) + "</b>");
            const pct = o.outcomes.length > 1 ? Math.round(100 * (x.weight || 1) / tw) + "%: " : "";
            return pct + r.join(" + ");
        }).join("<br>");
    }
    const t = o.result ? names(o.result) : "";
    const e = EFFECT[o.effect] || ("effect " + o.effect);
    if (o.effect === "wolves") return "<b class=bad>" + e + "</b>";
    return t && !/unverified/.test(e) && ["pay", "careful", "guide", "tool", "lamp", "decoy", "recipes", "story", "inspect", "gift", "exchange", "plant"].includes(o.effect) ? t : esc(e);
}

function card(e) {
    const rows = e.options.map((o) => {
        const rec = REC[e.id] === o.id, avoid = (AVOID[e.id] || []).includes(o.id);
        const tag = rec ? "<span class='tag rec'>PICK</span>" : avoid ? "<span class='tag avoid'>NEVER</span>" : "";
        return `<tr class="${rec ? "rec" : avoid ? "avoid" : ""}"><td class=oid>${esc(o.id)}</td><td>${names(o.label)} ${tag}</td><td class=cost>${esc(cost(o))}</td><td>${what(o)}</td></tr>`;
    }).join("");
    const grp = { bad: "toll", positive: "helpful", mixed: "mixed" }[e.group] || e.group;
    return `<section class="card ${e.group}"><header><span class=id>${e.id}</span><h2>${esc(e.name)}</h2><span class="grp ${e.group}">${grp}</span></header>
<p class=text>${names(e.text)}</p>
<table><thead><tr><th>id</th><th>option</th><th>cost</th><th>what happens</th></tr></thead><tbody>${rows}</tbody></table>
<p class=why><b>Pick:</b> ${esc(WHY[e.id] || "")}</p></section>`;
}

const css = `@page { size: A4; margin: 9mm 9mm 10mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #14161c; color: #e6e6e6; font-family: "Segoe UI", system-ui, sans-serif; font-size: 10.5px; }
h1 { font-size: 26px; color: #fff; margin: 0 0 4px; } h2 { font-size: 13px; margin: 0; color: #fff; font-weight: 600; }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #8fa3c7; margin: 12px 0 5px; }
.lead { color: #b9bfcc; font-size: 12px; line-height: 1.45; margin: 0 0 6px; }
ul.rules { margin: 0; padding-left: 16px; line-height: 1.5; color: #d4d8e0; } ul.rules li { margin-bottom: 2px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.box { background: #1d2029; border: 1px solid #2a2f3b; border-radius: 6px; padding: 7px 10px; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { text-align: left; color: #8fa3c7; font-weight: 600; font-size: 9.5px; border-bottom: 1px solid #2f3543; padding: 2px 4px; }
td { padding: 3px 4px; border-bottom: 1px solid #252a35; vertical-align: top; line-height: 1.35; }
td.oid { color: #7d8597; font-family: Consolas, monospace; font-size: 9.5px; white-space: nowrap; }
td.cost { white-space: nowrap; color: #c9b27a; }
tr.rec td { background: #16301f; } tr.avoid td { background: #3a1a1c; }
.tag { font-size: 8.5px; font-weight: 700; border-radius: 3px; padding: 0 4px; margin-left: 3px; }
.tag.rec { background: #3fb36b; color: #0e1a12; } .tag.avoid { background: #e0525a; color: #1a0d0e; }
b.bad { color: #ff7b81; } b.fight { color: #f0b86b; font-weight: 600; }
.card { background: #1a1d25; border: 1px solid #2a2f3b; border-left: 4px solid #5d6aa0; border-radius: 6px; padding: 6px 9px 5px; margin-bottom: 8px; break-inside: avoid; }
.card.bad { border-left-color: #d9734f; } .card.positive { border-left-color: #4fa96b; }
.card header { display: flex; align-items: baseline; gap: 8px; }
.card .id { font-family: Consolas, monospace; color: #8fa3c7; font-size: 12px; }
.grp { margin-left: auto; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #9aa3b5; }
.grp.bad { color: #e9a07f; } .grp.positive { color: #7fd39a; }
.text { color: #aeb5c3; font-style: italic; margin: 3px 0 2px; line-height: 1.35; }
.why { margin: 4px 0 0; color: #cfe8d6; } .why b { color: #7fd39a; }
.src { color: #6c7486; font-size: 9px; margin-top: 8px; }
.cover { break-after: page; }`;

const rulesHtml = `<ul class=rules>
<li><b>3 characters, 3 floors, 24 minutes</b>; forced votes pause the clock (1 minute to vote, a majority ends it early). One visit per account per day.</li>
<li>Each floor: guard camp (3 packs; each cleared pack: a camp roll + a chest with 1,500 cave gold + 1 Amber), floor keeper (a BOSS roll + chest: 4,000 cave gold), marked encounter - all three open the stairs. Floor 3 done: a finish roll + 10,000 cave gold + 5 Amber.</li>
<li><b>A "roll"</b> (parcel, rescue, BOSS, camp, finish) is one draw from that table right away - not an item to keep. Items go to a random member of the original party (bag, or MAIL when full).</li>
<li><b>Value of cave gold:</b> about 1,000 cave gold = 1 Amber (Loaded Die: 10,000 cave gold or 10 Amber at Cole).</li>
<li><b>Death costs nothing</b>; revive at the floor doorway is free, in place 1 Amber. Exit leaves for good.</li>
<li><b>Cave gold stays in the cave</b> - spend it (merchant near each floor's doorway, upper wall). Unspent Amber goes to the party. Limits per run: 60,000 cave gold, 36 Amber.</li>
<li><b>Never:</b> the red chain / red rope (six level 100 wolves), the copying shadow, the Dark Mage (100,000 magic damage, mages first - run).</li>
<li><b>Time is the scarcest currency:</b> a 50/50 with an easy fight is usually better than a 20-45 s option.</li>
<li>Our bots: you vote on the priest, warrior and mage copy your vote at once.</li></ul>`;
const tables = `<div class=grid>
<div class=box><h3 style="margin-top:0">Reward tables (one roll each)</h3><table>
<tr><td><b>camp</b></td><td>per cleared camp pack (cave_farm, likely): 57 % 1 Amber, 20 % 2 Amber, 10 % scroll1, 4 % Tunnel Axe, 4 % Reed Scythe, 3 % Locktooth, 2 % Mothstep Boots</td></tr>
<tr><td><b>parcel</b></td><td>50 % 1 Amber, 22 % 2 Amber, 10 % scroll1, 5 % gem1, 5 % Tunnel Axe, 5 % Reed Scythe, 2 % Locktooth, 1 % Mothstep Boots</td></tr>
<tr><td><b>rescue</b></td><td>60 % 2 Amber, 20 % 3 Amber, 10 % gem1, 5 % Tunnel Axe, 3 % Counterweight, 2 % Mothstep Boots</td></tr>
<tr><td><b>BOSS</b></td><td>55 % 3 Amber, 15 % Locktooth, 12 % Counterweight, 10 % Tunnel Axe, 8 % Mothstep Boots</td></tr>
<tr><td><b>finish</b></td><td>45 % 5 Amber, 15 % Locktooth, 15 % Counterweight, 10 % Tunnel Axe, 10 % Mothstep Boots, 5 % Loaded Die</td></tr></table></div>
<div class=box><h3 style="margin-top:0">Fights (HP / attack)</h3><table>
<tr><td>rat 820/80 · crab 400/24 · snake 720/24 · guard, traveler 1,200/35</td><td>trivial</td></tr>
<tr><td>bat 9.6k/50 · broodmother 8k/80 · spider 18k/80 · scorpion 24k/100</td><td>easy</td></tr>
<tr><td>Lockbreaker 12k/100 · Moth Keeper 14k/90 (magic) · Sentinel 16k/140</td><td>keepers, easy</td></tr>
<tr><td><b class=bad>Cave Wolf 48k/480</b>, armor 300, res 200, speed 80</td><td>the real test</td></tr></table>
<h3>Monster drops (own table, luck counts)</h3><div>Every cave monster: 8 % 1 Amber - plus spider 3 % Spider Silk, scorpion 3 % Cobra Scale, snake 3 % Snake Oil. <b>Broodmother 100 % 1 Amber</b> + 10 % Spider Silk. Travelers, rogue and keepers: nothing (their reward is the roll). Dark Mage: 100 % Nightjudge (staff, 1.2M) - only his own reflected spell kills him. XP x10 in the cave (guard 1,000, wolf 488,000).</div>
<h3>Cave merchant (cave gold)</h3><div>Loaded Die 10,000 · Counterweight 8,000 · Tunnel Axe 6,000 · Locktooth 6,000 · Mothstep Boots 6,000 · Reed Scythe 2,500 · gem1 5,000 · scroll1 2,000 · tshirts 16,000 · broom 48,000</div></div></div>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cave of Many Dreams - encounters</title><style>${css}</style></head><body>
<div class=cover><h1>Cave of Many Dreams - the 50 encounters</h1>
<p class=lead>Every vote the cave can put to us, with each option's cost, what happens (weights from the game data) and our pick.
<b style="color:#3fb36b">PICK</b> = our choice, <b style="color:#e0525a">NEVER</b> = never take it. Effects marked "unverified" come from the guide and the option text - the first runs will tell.</p>
<h3>Rules that matter</h3>${rulesHtml}${tables}
<p class=src>Source: G.events.dreams (game data version ${ev.version}, ${ev.retrieved}), guide "Cave of Many Dreams", G.drops/G.monsters cave_*. Picks: draft 2026-11-24, reviewed with the player the same day (docs/cave-of-many-dreams.md). Generated by scripts/cave-encounters.mjs.</p></div>
${D.encounters.map(card).join("\n")}
</body></html>`;

mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, "cave-encounters.html");
const pdfPath = path.join(outDir, "cave-encounters.pdf");
writeFileSync(htmlPath, html);
const browsers = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"];
const browser = browsers.find((b) => existsSync(b));
if (!browser) { console.log("no browser found - HTML only: " + htmlPath); process.exit(0); }
const profile = path.join(os.tmpdir(), "cave-encounters-pdf-profile");
execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + profile, "--no-pdf-header-footer", "--print-to-pdf=" + pdfPath, pathToFileURL(htmlPath).href], { stdio: "ignore" });
console.log("written " + htmlPath + "\n        " + pdfPath);
