#!/usr/bin/env node
// =====================================================================
// Build docs/gear-guide/gear-plan.html (and .pdf via Edge headless) from the
// gear plan in bot/config.js (config.gearPlan) - the same block the bot builds
// its class wishes from - with item names and icons from the live game data.
//
//   node scripts/gear-plan-guide.mjs            # HTML + PDF
//   node scripts/gear-plan-guide.mjs --no-pdf   # HTML only
// =====================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "gear-guide");
// bot/config.js is a CODE module (module.exports = {...}) - load it like the game does.
const cfgModule = { exports: {} };
// It requires its defaults files (stage 7b): give it a require relative to bot/.
new Function("module", "exports", "require", await readFile(path.join(root, "bot", "config.js"), "utf8"))(cfgModule, cfgModule.exports, createRequire(path.join(root, "bot", "config.js")));
const config = cfgModule.exports;
const plan = config.gearPlan;
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
const mainStat = (cls) => G.classes[cls].main_stat;
const resolve = (name, cls) => name.replace("{stat}", cls ? mainStat(cls) : "str");
const missing = new Set();
const usedSets = new Set();
if (G.items.ololipop) G.items.ololipop.name = "Lolipop Mace (orange)";
if (G.items.glolipop) G.items.glolipop.name = "Lolipop Mace (green)";
function title(name) { return G.items[name] ? G.items[name].name : (missing.add(name), name); }

function icon(name, size = 30) {
    const d = G.items[name];
    const p = d && G.positions[d.skin || name];
    if (!p) { missing.add(name); return `<div class="ic miss" style="width:${size}px;height:${size}px">?</div>`; }
    const set = p[0] || "";
    usedSets.add(set);
    const st = sets[set];
    return `<div class="ic" style="width:${size}px;height:${size}px;background-image:var(--s-${set || "pack_20"});background-size:${st.columns * size}px ${st.rows * size}px;background-position:-${p[1] * size}px -${p[2] * size}px"></div>`;
}
function forClasses(f) {
    if (!f) return CLASSES;
    return [...new Set((Array.isArray(f) ? f : [f]).flatMap((x) => plan.groups[x] || [x]))];
}
const chips = (f) => (f ? forClasses(f).map((c) => `<span class="chip" style="--c:${COLOR[c]}">${c.slice(0, 3)}</span>`).join("") : "");
// s: { item, to, from, how, note, scroll, found, for }
function step(s, opts = {}) {
    const name = resolve(s.item, opts.cls);
    let label = title(name);
    if (s.item.includes("{stat}") && !opts.cls) label = label.replace(/Strength/, "main stat");
    const lv = s.to != null ? `<span class="lv">+${s.to}</span>` : "";
    const tags = [];
    if (s.from != null && s.from !== s.to) tags.push("+" + s.from + " … +" + s.to);
    if (s.scroll) tags.push("main-stat scroll");
    if (s.how) tags.push(s.how);
    if (s.found) tags.push("when found");
    if (s.note) tags.push(s.note);
    return `<div class="st${s.found ? " found" : ""}"><div class="iw">${icon(name)}${lv}</div><div class="tx"><b>${esc(label)}</b>${tags.length ? `<span>${esc(tags.join(" · "))}</span>` : ""}${opts.noChips ? "" : chips(s.for)}</div></div>`;
}
const arrow = `<div class="ar">→</div>`;
const ladder = (steps, opts) => `<div class="ladder">${steps.map((s) => step(s, opts)).join(arrow)}</div>`;
const tuple = (t) => ({ item: t[0], to: t[1] == null ? undefined : t[1], how: t[2] === "craft" ? "craft" : undefined, found: t[2] === "found" });

// ---- the plan per slot ---------------------------------------------------------
const SLOT_LABEL = { helmet: "Helmet", chest: "Chest", pants: "Pants", shoes: "Shoes", gloves: "Gloves", cape: "Cape", earring: "Earrings", ring: "Rings", amulet: "Amulet", belt: "Belt", orb: "Orb", elixir: "Elixir", mainhand: "Main hand", offhand: "Offhand" };
function slotSteps(slot) {
    const out = [];
    if (plan.shop[slot]) out.push({ item: plan.shop[slot], to: plan.caps.armor, scroll: true, how: "NPC shop · gear goals" });
    for (const w of plan.wishes) {
        if (w.slot !== slot || w.carry) continue;
        if (w.steps) w.steps.forEach((s) => out.push({ item: s[0], to: s[1], for: w.for, how: w.how }));
        else out.push({ item: w.item, to: w.to, from: w.from, for: w.for, how: w.how });
    }
    return out;
}
const slotAlts = (slot) => plan.wishes.filter((w) => w.slot === slot).flatMap((w) => w.alts || []);
function commonPage(slots, heading) {
    let rows = "";
    for (const slot of slots) {
        let lad, alt = "", found = "", flags = "";
        if (slot === "elixir") {
            lad = `<div class="ladder">${plan.elixirs.options.map((s) => step(s)).join("")}</div><div class="nt">${esc(plan.elixirs.note)}</div>`;
            flags = `<span class="opt">${plan.elixirs.off ? "off" : "optional"}</span>`;
        } else {
            lad = ladder(slotSteps(slot));
            alt = slotAlts(slot).map((s) => step(s)).join("");
            found = (plan.found[slot] || []).map((s) => step(s)).join("");
            if (["earring", "ring"].includes(slot)) flags = `<span class="x2">×2</span>`;
        }
        rows += `<tr><td class="sl">${SLOT_LABEL[slot]}${flags}</td><td>${lad}</td><td><div class="col">${alt || '<span class="dash">–</span>'}</div></td><td><div class="col fd">${found || '<span class="dash">–</span>'}</div></td></tr>`;
    }
    return `<section class="page common"><h2>${heading}</h2>
    <p class="sub">Generic pieces use the class's main stat (STR, DEX or INT). Levels are targets; armor stops at +${plan.caps.armor}, weapons at +${plan.caps.weapon}. Coloured tags: only for these classes.</p>
    <table class="rules"><tr><th></th><th>Ladder – wished and upgraded</th><th>Alternative – valuation decides</th><th>When found</th></tr>${rows}</table></section>`;
}
function classPage(cls) {
    const c = plan.classes[cls];
    let modes = "";
    const many = Object.keys(c.modes).length > 1;
    for (const [mode, m] of Object.entries(c.modes)) {
        modes += `<div class="mode"><h3>${mode === "aoe" ? "AOE (packs)" : many ? "Single target" : "Weapons"}</h3>
        <div class="hand"><span class="hl">Main hand</span>${ladder(m.mainhand.map(tuple), { cls })}</div>
        ${m.offhand ? `<div class="hand"><span class="hl">Offhand</span>${ladder(m.offhand.map(tuple), { cls })}</div>` : ""}
        ${m.note ? `<div class="nt">${esc(m.note)}</div>` : ""}</div>`;
    }
    const spec = [];
    const only = (f) => f && forClasses(f).includes(cls) && forClasses(f).length < CLASSES.length;
    for (const w of plan.wishes) {
        if (only(w.for)) spec.push({ slot: w.slot, kind: w.carry ? "carried" : "wish", s: w.steps ? { item: w.steps.at(-1)[0], to: w.steps.at(-1)[1], how: w.how } : { item: w.item, to: w.to, from: w.from, how: w.how } });
        for (const a of w.alts || []) if (only(a.for)) spec.push({ slot: w.slot, kind: "alternative", s: a });
    }
    for (const [slot, list] of Object.entries(plan.found)) for (const f of list) if (only(f.for)) spec.push({ slot, kind: "when found", s: f });
    // Bonus (gearPlan.bonus, 2026-11-26): carried for an extra, not for the class's own strength - the luck swap sets.
    const bonusHtml = (plan.bonus || []).filter((w) => only(w.for)).map((w) => `<div class="spr"><span class="sk">${SLOT_LABEL[w.slot] || w.slot}</span>${step({ item: w.item, to: w.to, how: w.how }, { cls, noChips: true })}<span class="kd">${w.count > 1 ? "carried ×" + w.count : "carried"}</span></div>`).join("");
    const specHtml = spec.map(({ slot, kind, s }) => `<div class="spr"><span class="sk">${SLOT_LABEL[slot] || slot}</span>${step(s, { cls, noChips: true })}<span class="kd">${kind}</span></div>`).join("");
    const generic = ["earring", "ring", "amulet", "belt"].map((sl) => { const w = plan.wishes.find((x) => x.slot === sl); return step({ item: w.item, to: w.to }, { cls }); }).join("");
    const sw = (chart.swaps[cls] || []).map((n) => `<div class="sw">${icon(n, 24)}<span>${esc(title(n))}</span></div>`).join("");
    const rules = (c.rules || []).map((t) => `<li>${esc(t)}</li>`).join("");
    return `<section class="page cls" style="--acc:${COLOR[cls]}">
    <div class="ttl"><h2>${cls[0].toUpperCase() + cls.slice(1)}</h2><span class="tag">${mainStat(cls).toUpperCase()}</span>${OURS[cls] ? `<span class="ours">${OURS[cls]}</span>` : ""}</div>
    <div class="grid"><div class="left">${modes}
      ${rules ? `<div class="mode"><h3>Our own rules</h3><ul class="ov">${rules}</ul></div>` : ""}
      <div class="mode"><h3>Class specifics</h3><div class="specs">${specHtml || "<p class=dash>none</p>"}</div></div>
      ${bonusHtml ? `<div class="mode"><h3>Bonus – luck swap</h3><div class="specs">${bonusHtml}</div></div>` : ""}</div>
    <div class="right"><h3>Jewelry end goals</h3><div class="gen">${generic}</div>
      ${sw ? `<h3>Swapouts in the community chart</h3><div class="swl">${sw}</div>` : ""}</div></div></section>`;
}
const decisions = Object.entries(plan.decisions || {}).map(([d, list]) => `<li><b>${esc(d)}:</b> ${list.map(esc).join(" · ")}</li>`).join("");
const cover = `<section class="page cover"><h1>Gear Plan <span class="dr">v${esc(plan.version)}</span></h1>
<p class="lead">${esc(plan.about)} The bot builds its class wishes from exactly this plan (bot/config.js, gearPlan).</p>
<h3>How the bot uses it</h3><ol class="pr">${plan.principles.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
<div class="legend">
 <div><h3>Ladder</h3><p>Left to right. The bot wishes for the next step and upgrades what it wears up to the step's level; an earlier step is the stand-in for a later one.</p></div>
 <div><h3>Alternative</h3><p>A different item for the same slot, worn when the game's valuation rates it higher. While one is worn, the ladder of its slot pauses.</p></div>
 <div><h3>When found</h3><p>Event, boss and box items. Worn when we have them and they rate higher – never farmed or bought on purpose.</p></div>
</div>
${decisions ? `<h3>Decisions</h3><ul class="pr dec">${decisions}</ul>` : ""}
<p class="src">Updated ${esc(plan.updated)} · bot v${esc(config.version)} · icons and names: Adventure Land game data v${G.version}</p></section>`;

const body = [cover,
    commonPage(["helmet", "chest", "pants", "shoes", "gloves", "cape"], "Every class – armor"),
    commonPage(["earring", "ring", "amulet", "belt", "orb", "elixir"], "Every class – jewelry, orb and elixir"),
    ...CLASSES.map(classPage)].join("\n");
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
