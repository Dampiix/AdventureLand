#!/usr/bin/env node
// =====================================================================
// Build docs/gear-guide/gear-plan.html (and .pdf via Edge headless) from
// docs/gear-guide/gear-plan.json – our general gear progression rules –
// with item names and icons from the live game data.
//
//   node scripts/gear-plan-guide.mjs
// =====================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "gear-guide");
const plan = JSON.parse(await readFile(path.join(dir, "gear-plan.json"), "utf8"));
const chart = JSON.parse(await readFile(path.join(dir, "gear-guide-data.json"), "utf8")); // matched community chart

// ---- game data and item sprites --------------------------------------------
const BASE = "https://adventure.land";
const dataJs = await (await fetch(BASE + "/data.js")).text();
const G = JSON.parse(dataJs.slice(dataJs.indexOf("{"), dataJs.lastIndexOf("}") + 1));
const sets = { ...G.imagesets, "": G.imagesets.pack_20 };
const sheetData = {};
async function sheet(set) {
    if (!sheetData[set]) {
        const buf = Buffer.from(await (await fetch(BASE + sets[set].file)).arrayBuffer());
        sheetData[set] = "data:image/png;base64," + buf.toString("base64");
    }
    return sheetData[set];
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CLASSES = ["warrior", "ranger", "priest", "rogue", "mage", "paladin"];
const COLOR = { warrior: "#c9a27e", ranger: "#9ccc65", priest: "#e8e8e8", rogue: "#f5d742", mage: "#5bc0eb", paladin: "#f06292" };
const OURS = { warrior: "DmpxWar", ranger: "DmpxRanger", priest: "DmpxPriest", rogue: "DmpxRogue", paladin: "DmpxPala" };
const mainStat = (cls) => G.classes[cls].main_stat; // str / dex / int
const resolve = (name, cls) => name.replace("{stat}", cls ? mainStat(cls) : "str");
const missing = new Set();
const usedSets = new Set();
function title(name) { return G.items[name] ? G.items[name].name : (missing.add(name), name); }
if (G.items.ololipop) G.items.ololipop.name = "Lolipop Mace (orange)";
if (G.items.glolipop) G.items.glolipop.name = "Lolipop Mace (green)";

function icon(name, size = 30) {
    const d = G.items[name];
    if (!d) { missing.add(name); return `<div class="ic miss" style="width:${size}px;height:${size}px">?</div>`; }
    const p = G.positions[d.skin || name];
    if (!p) return `<div class="ic miss" style="width:${size}px;height:${size}px">?</div>`;
    const set = p[0] || "";
    usedSets.add(set);
    const st = sets[set];
    return `<div class="ic" style="width:${size}px;height:${size}px;background-image:var(--s-${set || "pack_20"});background-size:${st.columns * size}px ${st.rows * size}px;background-position:-${p[1] * size}px -${p[2] * size}px"></div>`;
}
// group / class filter
function forClasses(f) {
    if (!f) return CLASSES;
    const list = Array.isArray(f) ? f : [f];
    return [...new Set(list.flatMap((x) => plan.groups[x] || [x]))];
}
function chips(f) {
    if (!f) return "";
    return forClasses(f).map((c) => `<span class="chip" style="--c:${COLOR[c]}">${c.slice(0, 3)}</span>`).join("");
}
// a step: icon with level badge, name, how/notes; {stat} shown generically
function step(s, opts = {}) {
    const generic = s.item.includes("{stat}");
    const name = resolve(s.item, opts.cls);
    let label = title(name);
    if (generic && !opts.cls) label = label.replace(/Strength/, "main stat");
    const lv = s.to != null ? `<span class="lv">+${s.to}</span>` : "";
    const tags = [];
    if (s.scroll) tags.push("main-stat scroll");
    if (s.how) tags.push(s.how);
    if (s.found) tags.push("when found");
    if (s.note) tags.push(s.note);
    return `<div class="st${s.found ? " found" : ""}"><div class="iw">${icon(name)}${lv}</div><div class="tx"><b>${esc(label)}</b>${tags.length ? `<span>${esc(tags.join(" · "))}</span>` : ""}${chips(s.for)}</div></div>`;
}
const arrow = `<div class="ar">→</div>`;
const ladder = (steps, opts) => `<div class="ladder">${steps.map((s) => step(s, opts)).join(arrow)}</div>`;

// ---- pages ---------------------------------------------------------------------
const SLOT_LABEL = { helmet: "Helmet", chest: "Chest", pants: "Pants", shoes: "Shoes", gloves: "Gloves", cape: "Cape", earring: "Earrings", ring: "Rings", amulet: "Amulet", belt: "Belt", orb: "Orb", elixir: "Elixir" };
function commonPage(slots, heading) {
    let rows = "";
    for (const [slot, r] of Object.entries(plan.slots).filter(([k]) => slots.includes(k))) {
        const alt = (r.alt || []).map((s) => step(s)).join("");
        const found = (r.found || []).map((s) => step({ ...s, found: false })).join("");
        rows += `<tr><td class="sl">${SLOT_LABEL[slot]}${r.pair ? `<span class="x2">×2</span>` : ""}${r.optional ? `<span class="opt">optional</span>` : ""}</td>
        <td>${r.choice ? `<div class="ladder">${r.ladder.map((s) => step(s)).join("")}</div>` : ladder(r.ladder)}${r.note ? `<div class="nt">${esc(r.note)}</div>` : ""}</td><td><div class="col">${alt || '<span class="dash">–</span>'}</div></td><td><div class="col fd">${found || '<span class="dash">–</span>'}</div></td></tr>`;
    }
    return `<section class="page common"><h2>${heading}</h2>
    <p class="sub">Generic pieces use the class's main stat (STR, DEX or INT). Levels are targets; armor stops at +${plan.caps.armor}, weapons at +${plan.caps.weapon}.</p>
    <table class="rules"><tr><th></th><th>Ladder – wished and upgraded</th><th>Alternative – valuation decides</th><th>When found</th></tr>${rows}</table></section>`;
}
const r_choice = (slot) => !!plan.slots[slot].choice;
function classPage(cls) {
    const c = plan.classes[cls];
    let modes = "";
    for (const [mode, m] of Object.entries(c.modes)) {
        modes += `<div class="mode"><h3>${mode === "aoe" ? "AOE (packs)" : Object.keys(c.modes).length > 1 ? "Single target" : "Weapons"}</h3>
        <div class="hand"><span class="hl">Main hand</span>${ladder(m.mainhand, { cls })}</div>
        ${m.offhand ? `<div class="hand"><span class="hl">Offhand</span>${ladder(m.offhand, { cls })}</div>` : ""}
        ${m.alt ? `<div class="hand"><span class="hl">Also</span><div class="ladder">${m.alt.map((s) => step(s, { cls })).join("")}</div></div>` : ""}
        ${m.note ? `<div class="nt">${esc(m.note)}</div>` : ""}</div>`;
    }
    // class-specific entries from the common rules
    const spec = [];
    for (const [slot, r] of Object.entries(plan.slots)) {
        for (const kind of ["alt", "found", "ladder"]) for (const s of r[kind] || []) {
            if (s.for && forClasses(s.for).includes(cls) && forClasses(s.for).length < CLASSES.length) spec.push({ slot, kind, s });
        }
    }
    const specHtml = spec.map(({ slot, kind, s }) => `<div class="spr"><span class="sk">${SLOT_LABEL[slot]}</span>${step({ ...s, for: null }, { cls })}<span class="kd">${kind === "found" ? "when found" : kind === "alt" ? "alternative" : r_choice(slot) ? "option" : "ladder"}</span></div>`).join("");
    const generic = ["earring", "ring", "amulet", "belt"].map((sl) => step({ item: plan.slots[sl].ladder.at(-1).item, to: plan.slots[sl].ladder.at(-1).to }, { cls })).join("");
    const sw = (chart.swaps[cls] || []).map((n) => `<div class="sw">${icon(n, 24)}<span>${esc(title(n))}</span></div>`).join("");
    const over = (c.overrides || []).map((o) => `<li>${esc(o.text)}</li>`).join("");
    return `<section class="page cls" style="--acc:${COLOR[cls]}">
    <div class="ttl"><h2>${cls[0].toUpperCase() + cls.slice(1)}</h2><span class="tag">${mainStat(cls).toUpperCase()}</span>${OURS[cls] ? `<span class="ours">${OURS[cls]}</span>` : ""}</div>
    <div class="grid"><div class="left">${modes}
      ${over ? `<div class="mode"><h3>Our own rules</h3><ul class="ov">${over}</ul></div>` : ""}
      <div class="mode"><h3>Class specifics from the common rules</h3><div class="specs">${specHtml || "<p class=dash>none</p>"}</div></div></div>
    <div class="right"><h3>Jewelry end goals</h3><div class="gen">${generic}</div>
      
      ${sw ? `<h3>Swapouts in the community chart</h3><div class="swl">${sw}</div>` : ""}</div></div></section>`;
}
const cover = `<section class="page cover"><h1>Gear Plan <span class="dr">${esc(plan.version)}</span></h1>
<p class="lead">${esc(plan.about)}</p>
<h3>How the bot uses it</h3><ol class="pr">${plan.principles.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
<div class="legend">
 <div><h3>Ladder</h3><p>Left to right. The bot wishes for the next step and upgrades what it wears up to the step's level; an earlier step is the stand-in for a later one.</p></div>
 <div><h3>Alternative</h3><p>A different item for the same slot. Worn only when the game's valuation rates it higher than the ladder piece.</p></div>
 <div><h3>When found</h3><p>Event, boss and box items. Worn when we have them and they rate higher – never farmed or bought on purpose.</p></div>
</div>
<p class="src">Updated ${esc(plan.updated)} · data: docs/gear-guide/gear-plan.json · icons and names: Adventure Land game data v${G.version}</p></section>`;

const body = [cover, commonPage(["helmet", "chest", "pants", "shoes", "gloves", "cape"], "Every class – armor"), commonPage(["earring", "ring", "amulet", "belt", "orb", "elixir"], "Every class – jewelry, orb and elixir"), ...CLASSES.map(classPage)].join("\n");
for (const s of usedSets) await sheet(s);
const css = await readFile(path.join(dir, "gear-plan.css"), "utf8");
const vars = `:root{${[...usedSets].map((s) => `--s-${s || "pack_20"}:url(${sheetData[s]})`).join(";")}}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gear Plan</title><style>${css}\n${vars}</style></head><body>${body}</body></html>`;
const htmlPath = path.join(dir, "gear-plan.html");
await writeFile(htmlPath, html);
console.log("wrote", htmlPath, html.length);
if (missing.size) console.log("MISSING items:", [...missing].join(", "));

const browsers = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"];
const browser = browsers.find((b) => existsSync(b));
if (browser && !process.argv.includes("--no-pdf")) {
    const profile = path.join(os.tmpdir(), "gear-plan-pdf-profile");
    await mkdir(profile, { recursive: true });
    const pdfPath = path.join(dir, "gear-plan.pdf");
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + profile, "--no-pdf-header-footer", "--print-to-pdf=" + pdfPath, pathToFileURL(htmlPath).href], { stdio: "ignore" });
    console.log("wrote", pdfPath);
}
