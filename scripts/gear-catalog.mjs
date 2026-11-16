#!/usr/bin/env node
// =====================================================================
// Build docs/gear-catalog/gear-catalog.html (and .pdf via Edge headless)
// from docs/gear-catalog/gear-data.json – a snapshot of every armor piece,
// weapon and offhand in the game: stats at +0/+7/+9 (game formula, main
// stat shown as "stat"), upgrade grades, and every source (shop, craft,
// tokens, monster/map drops, boxes, exchanges, events).
//
//   node scripts/gear-catalog.mjs            # HTML + PDF
// =====================================================================

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "gear-catalog");
const data = JSON.parse(await readFile(path.join(dir, "gear-data.json"), "utf8"));
const byName = Object.fromEntries(data.items.map((i) => [i.n, i]));

// ---- source classification ---------------------------------------------------
const IGNORE = new Set(["glitch", "lglitch"]); // bug-bounty exchanges: everything is in there
const BOX = new Set(["armorbox", "weaponbox", "armorx", "weaponofthedead"]);
const CAVE = /^cave_/;
const EVENT = /^(anniversary|sixcake|basketofeggs|mistletoe|candycane|ornament|candy|gift|.*envelope|xbox|witchparcel|candypop|konami|mysterybox|abtesting|m2|thrash|f1)/;
const EXCHANGE_NAMES = {
    armorbox: "Armor Box", weaponbox: "Weapon Box", armorx: "X Box armor", weaponofthedead: "Weapon of the Dead",
    leather: "40 Leather", lostearring2: "Gold Earring +2", lostearring3: "Gold Earring +3", lostearring4: "Gold Earring +4",
    gemfragment: "Gem Fragments", seashell: "Seashells", troll: "Troll", marketparcel: "Market Parcel",
};
const NPC = { craftsman: "Leo (craftsman)", mcollector: "Cole", witch: "Witch", anniversary_baker: "Anniversary baker" };
const OUR = ["warrior", "priest", "ranger"];
const CLASS_SHORT = { warrior: "War", priest: "Pri", ranger: "Ran", paladin: "Pal", mage: "Mag", rogue: "Rog" };

function pct(x) {
    if (x >= 1) return x + "/kill";
    if (x >= 0.01) return (x * 100).toFixed(1) + "%";
    return "1/" + Math.round(1 / x).toLocaleString("en");
}
function monster(m) {
    const d = data.mon[m];
    return d ? `${d[0]} <span class="dim">(HP ${num(d[1])}, ATK ${num(d[2])})</span>` : m;
}
function num(x) {
    if (x >= 1e6) return (x / 1e6).toFixed(x >= 1e7 ? 0 : 1) + "M";
    if (x >= 1e4) return Math.round(x / 1e3) + "k";
    return String(x);
}
function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Tags and detail lines for any item or ingredient record.
function sources(r) {
    const tags = new Set();
    const lines = [];
    if (r.shop) { tags.add("Shop"); lines.push("Shop: " + esc(r.shop.join(", "))); }
    if (r.craft) {
        tags.add("Craft");
        if (typeof r.craft === "string") lines.push("Craft: " + esc(r.craft));
    }
    if (r.tok) { tags.add("Tokens"); lines.push("Tokens: " + r.tok.map((t) => { const [k, v] = t.split(":"); return v + " " + k.replace("token", " token"); }).join(", ")); }
    const md = (r.md || []).slice().sort((a, b) => b[1] - a[1]);
    if (md.length) { tags.add("Drop"); lines.push("Drops: " + md.slice(0, 4).map((x) => monster(x[0]) + " " + pct(x[1])).join("; ") + (md.length > 4 ? " …" : "")); }
    const mapd = (r.mapd || []).filter((x) => x[1] > 0);
    if (mapd.length) { tags.add("Map drop"); lines.push("Map drop: " + mapd.map((x) => x[0]).join(", ")); }
    const xc = (r.xc || []).filter((x) => !IGNORE.has(x[0]));
    const box = xc.filter((x) => BOX.has(x[0]));
    const cave = xc.filter((x) => CAVE.test(x[0]));
    const event = xc.filter((x) => EVENT.test(x[0]) && !BOX.has(x[0]));
    const other = xc.filter((x) => !BOX.has(x[0]) && !CAVE.test(x[0]) && !EVENT.test(x[0]));
    if (box.length) { tags.add("Box"); lines.push("Box: " + box.map((x) => (EXCHANGE_NAMES[x[0]] || x[0]) + " " + (x[1] * 100).toFixed(1) + "%").join(", ")); }
    if (other.length) { tags.add("Exchange"); lines.push("Exchange: " + other.map((x) => (EXCHANGE_NAMES[x[0]] || x[0]) + " " + (x[1] * 100).toFixed(1) + "%").join(", ")); }
    if (cave.length) { tags.add("Cave"); lines.push("Cave of Many Dreams: " + cave.map((x) => x[0].replace("cave_", "")).join(", ")); }
    if (event.length) { tags.add("Event"); lines.push("Event: " + [...new Set(event.map((x) => x[0]))].join(", ")); }
    if (!tags.size) tags.add("–");
    return { tags: [...tags], lines };
}

// ---- stats ----------------------------------------------------------------------
const MAIN = ["attack", "stat", "armor", "resistance"];
const LABEL = { attack: "ATK", stat: "Stat", armor: "Arm", resistance: "Res", hp: "HP", mp: "MP", frequency: "Freq", speed: "Spd",
    crit: "Crit", critdamage: "CritDmg", apiercing: "APierce", rpiercing: "RPierce", evasion: "Eva", reflection: "Refl",
    lifesteal: "LS", manasteal: "MS", range: "Rng", output: "Out", luck: "Luck", gold: "Gold", xp: "XP", vit: "VIT", for: "FOR",
    int: "INT", str: "STR", dex: "DEX", firesistance: "FireRes", fzresistance: "FrostRes", pnresistance: "PoisonRes",
    courage: "Cour", mcourage: "MCour", pcourage: "PCour", blast: "Blast", explosion: "Expl", stun: "Stun", dreturn: "DmgRet", miss: "Miss" };
function statCell(p, keys) {
    if (!p) return "";
    return keys.filter((k) => p[k]).map((k) => `<b>${p[k]}</b> ${LABEL[k]}`).join("<br>");
}
function extras(p) {
    if (!p) return "";
    return Object.keys(p).filter((k) => !MAIN.includes(k) && k !== "range").map((k) => `${p[k]} ${LABEL[k] || k}`).join(", ");
}
function gradeText(gr) {
    if (!gr) return "";
    // grades[i] = first level that needs scroll i+1; e.g. [7,9,10,12] -> "S0 +0–6 · S1 +7–8 · S2 +9 · S3 +10–11"
    const out = [];
    let start = 0;
    gr.forEach((lvl, i) => {
        if (lvl > start) out.push(`S${i} +${start}` + (lvl - 1 > start ? `–${lvl - 1}` : ""));
        start = Math.max(start, lvl);
    });
    return out.join(" · ");
}
function hands(i) {
    if (i.t !== "weapon") return "";
    const W = { mainhand: ["spear", "short_sword", "sword", "fist", "mace"], double: ["rapier", "bow", "axe", "scythe", "basher", "great_sword"], off: ["short_sword", "sword", "fist", "mace"] };
    const P = { mainhand: ["pmace", "staff"], double: ["wand"] };
    const R = { mainhand: ["bow", "crossbow"], double: ["fist", "dagger"] };
    const out = [];
    const f = (n, c) => {
        const h = [];
        if ((c.mainhand || []).includes(i.wt)) h.push("1H");
        if ((c.double || []).includes(i.wt)) h.push("2H");
        if ((c.off || []).includes(i.wt)) h.push("off");
        if (h.length && (!i.cls || i.cls.includes(n))) out.push(CLASS_SHORT[n] + " " + h.join("/"));
    };
    f("warrior", W); f("priest", P); f("ranger", R);
    return out.join(", ");
}
function classes(i) {
    return (i.use || []).map((c) => OUR.includes(c) ? `<b>${CLASS_SHORT[c]}</b>` : `<span class="dim">${CLASS_SHORT[c]}</span>`).join(" ");
}

// ---- sections ---------------------------------------------------------------------
const SECTIONS = [
    ["Helmets", (i) => i.t === "helmet"], ["Chest", (i) => i.t === "chest"], ["Pants", (i) => i.t === "pants"],
    ["Gloves", (i) => i.t === "gloves"], ["Shoes", (i) => i.t === "shoes"], ["Capes", (i) => i.t === "cape"],
    ["Weapons – swords, maces, axes, bashers (warrior)", (i) => i.t === "weapon" && ["short_sword", "sword", "mace", "axe", "scythe", "basher", "great_sword", "spear", "rapier", "fist"].includes(i.wt)],
    ["Weapons – staffs, priest maces, wands (priest)", (i) => i.t === "weapon" && ["staff", "pmace", "wand", "great_staff", "wblade"].includes(i.wt)],
    ["Weapons – bows, crossbows (ranger)", (i) => i.t === "weapon" && ["bow", "crossbow"].includes(i.wt)],
    ["Weapons – other", (i) => i.t === "weapon" && !["short_sword", "sword", "mace", "axe", "scythe", "basher", "great_sword", "spear", "rapier", "fist", "staff", "pmace", "wand", "great_staff", "wblade", "bow", "crossbow"].includes(i.wt)],
    ["Offhand – shields", (i) => i.t === "shield"], ["Offhand – sources (books, orbs)", (i) => i.t === "source"],
    ["Offhand – quivers", (i) => i.t === "quiver"], ["Offhand – misc", (i) => i.t === "misc_offhand"],
];

function rowFor(i) {
    const s = sources(i);
    const isWeapon = i.t === "weapon";
    const keys = isWeapon ? ["attack", "stat"] : ["stat", "armor", "resistance"];
    const name = `<b>${esc(i.nm)}</b> <span class="dim">${i.n}</span>` + (i.set ? `<br><span class="set">set: ${i.set}</span>` : "") +
        (isWeapon ? `<br><span class="dim">${i.wt}${hands(i) ? " · " + hands(i) : ""}</span>` : "");
    const tagHtml = s.tags.map((t) => `<span class="tag t-${t.replace(/\s/g, "")}">${t}</span>`).join(" ");
    return `<tr class="${i.craft ? "craft" : ""}">
<td>${name}</td><td class="c">${i.tier ?? "–"}</td><td>${classes(i)}</td>
<td>${statCell(i.p0, keys)}</td><td>${i.up ? statCell(i.p7, keys) : (i.cp ? "<span class='dim'>compound</span>" : "–")}</td><td>${i.up ? statCell(i.p9, keys) : ""}</td>
<td class="small">${esc(extras(i.p0))}</td><td class="small">${gradeText(i.gr)}</td>
<td>${tagHtml}<div class="small">${s.lines.join("<br>")}</div></td></tr>`;
}

function craftBlock(i) {
    const r = i.craft;
    const ings = r.i.map(([q, n, lvl]) => {
        const rec = data.ing[n] || {};
        const item = byName[n];
        const s = sources(item ? Object.assign({}, item, { craft: item.craft ? "see " + item.nm : undefined }) : rec);
        const nm = (rec.nm || (item && item.nm) || n) + (lvl ? ` +${lvl}` : "");
        return `<tr><td class="r">${q}×</td><td><b>${esc(nm)}</b> <span class="dim">${n}</span></td><td>${s.tags.map((t) => `<span class="tag t-${t.replace(/\s/g, "")}">${t}</span>`).join(" ")}<div class="small">${s.lines.join("<br>") || (rec.craft ? "Craft: " + esc(rec.craft) : "")}</div></td></tr>`;
    }).join("");
    const keys = i.t === "weapon" ? ["attack", "stat"] : ["stat", "armor", "resistance"];
    return `<div class="recipe"><h3>${esc(i.nm)} <span class="dim">${i.n} · ${i.t}${i.wt ? " (" + i.wt + ")" : ""} · tier ${i.tier ?? "–"} · ${classes(i)}</span></h3>
<div class="small">+0: ${statCell(i.p0, keys).replace(/<br>/g, ", ")}${i.up ? " · +7: " + statCell(i.p7, keys).replace(/<br>/g, ", ") + " · +9: " + statCell(i.p9, keys).replace(/<br>/g, ", ") : ""} · ${gradeText(i.gr)}${extras(i.p0) ? " · " + esc(extras(i.p0)) : ""}</div>
<div class="small">At ${NPC[r.npc] || r.npc}${r.c ? ", fee " + num(r.c) + " gold" : ""}</div>
<table class="ing">${ings}</table></div>`;
}

// ---- document -------------------------------------------------------------------------
const shopRef = ["helmet", "coat", "pants", "gloves", "shoes"].map((n) => byName[n]).filter(Boolean);
const ourCraft = data.items.filter((i) => i.craft && (i.use || []).some((c) => OUR.includes(c)))
    .sort((a, b) => (a.t > b.t ? 1 : a.t < b.t ? -1 : (a.tier || 0) - (b.tier || 0)));
const otherCraft = data.items.filter((i) => i.craft && !(i.use || []).some((c) => OUR.includes(c)));

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Adventure Land – armor & weapon catalog</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 8.2pt; color: #1d1d1f; }
h1 { font-size: 18pt; margin: 0 0 4px; } h2 { font-size: 12.5pt; margin: 14px 0 4px; break-after: avoid; border-bottom: 2px solid #4a6fa5; padding-bottom: 2px; }
h3 { font-size: 9.5pt; margin: 6px 0 2px; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #cfd6df; padding: 2px 4px; vertical-align: top; }
th { background: #e8eef6; text-align: left; font-size: 7.6pt; } tr { break-inside: avoid; }
tr.craft td:first-child { border-left: 3px solid #2e8b57; }
.dim { color: #7a8594; } .small { font-size: 7.2pt; } .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
.set { color: #8a4baf; font-size: 7.2pt; }
.tag { display: inline-block; padding: 0 4px; border-radius: 3px; font-size: 6.8pt; font-weight: 600; color: #fff; background: #888; margin: 0 1px 1px 0; }
.t-Shop { background: #4a6fa5; } .t-Craft { background: #2e8b57; } .t-Tokens { background: #b8860b; } .t-Drop { background: #a0522d; }
.t-Mapdrop { background: #8b5a2b; } .t-Box { background: #6a5acd; } .t-Exchange { background: #008b8b; } .t-Cave { background: #556b2f; } .t-Event { background: #b03a5b; }
.recipe { break-inside: avoid; border: 1px solid #cfd6df; border-left: 3px solid #2e8b57; padding: 4px 6px; margin: 6px 0; }
table.ing td { border: none; border-top: 1px dotted #d8dde3; padding: 1px 4px; }
.note { background: #f4f7fb; border: 1px solid #cfd6df; padding: 6px 8px; margin: 6px 0; }
.cols { columns: 2; column-gap: 14px; }
</style></head><body>
<h1>Armor &amp; weapon catalog</h1>
<div class="dim">Adventure Land game data (snapshot ${new Date().toISOString().slice(0, 10)}): ${data.items.length} armor pieces, weapons and offhands, ${Object.keys(data.ing).length} craft ingredients. Generated by scripts/gear-catalog.mjs.</div>
<div class="note">
<b>How to read.</b> Stats come from the game's own item formula at +0, +7 and +9. <b>Stat</b> is the item's main-stat slot (scroll it to STR/INT/DEX; the number is what it gives).
<b>Classes</b>: our team in <b>bold</b> (War, Pri, Ran), others grey. Weapons also show how our classes can hold them (1H, 2H, off = offhand / dual wield).
<b>Grades</b>: which upgrade scroll a level needs – S0 scroll0 (1k), S1 scroll1 (40k), S2 scroll2 (1.6M), S3 scroll3. A grade jump also means a sharp drop in success chance.
<b>Sources</b>: Shop · <span class="tag t-Craft">Craft</span> (green bar on the left, recipes in the craft section) · Tokens · Drop (per kill) · Map drop · Box (Armor/Weapon Box share) · Exchange · Cave (Cave of Many Dreams) · Event (seasonal). The bug-bounty "glitch" exchanges are left out – nearly everything is in them.
<br><b>Reference – shop armor:</b> ${shopRef.map((i) => `${i.nm} +7: ${i.p7.stat} stat / ${i.p7.armor} armor, +9: ${i.p9.stat} stat`).join(" · ")}.
</div>
<h2>Craftable gear our classes can use (${ourCraft.length})</h2>
<div class="dim small">Recipe, fee and crafter, and where each ingredient comes from (monster HP and attack in brackets).</div>
<div class="cols">${ourCraft.map(craftBlock).join("")}</div>
${SECTIONS.map(([title, f]) => {
        const list = data.items.filter(f).sort((a, b) => (a.tier || 1) - (b.tier || 1) || a.nm.localeCompare(b.nm));
        if (!list.length) return "";
        return `<h2>${title} (${list.length})</h2><table><thead><tr><th style="width:15%">Item</th><th>Tier</th><th>Classes</th><th>+0</th><th>+7</th><th>+9</th><th style="width:12%">Other (+0)</th><th style="width:9%">Grades</th><th style="width:30%">Sources</th></tr></thead><tbody>${list.map(rowFor).join("")}</tbody></table>`;
    }).join("")}
<h2>Craftable gear for other classes (${otherCraft.length})</h2>
<div class="cols">${otherCraft.map(craftBlock).join("")}</div>
</body></html>`;

const htmlPath = path.join(dir, "gear-catalog.html");
await writeFile(htmlPath, html);
console.log("wrote", htmlPath);

const browsers = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"];
const browser = browsers.find((b) => existsSync(b));
if (browser) {
    const pdfPath = path.join(dir, "gear-catalog.pdf");
    execFileSync(browser, ["--headless", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf=" + pdfPath, pathToFileURL(htmlPath).href], { stdio: "ignore" });
    console.log("wrote", pdfPath);
} else {
    console.log("no Edge/Chrome found – open the HTML and print it to PDF");
}
