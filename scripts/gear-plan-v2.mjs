#!/usr/bin/env node
// =====================================================================
// Gear plan v2 (draft, 2026-11-22): every class, every slot - what the bot does today
// (bot/config.js gearPlan, workshop.gearGoals, materialGoals) merged with the decisions
// of 2026-11-22 that are not built yet, plus what each fighter wears now.
// Output: docs/gear-guide/gear-plan-v2.html and .pdf (Edge/Chrome headless).
// Once the open points are settled, the plan goes into config.gearPlan and this
// draft script is folded back into scripts/gear-plan-guide.mjs.
//
//   node scripts/gear-plan-v2.mjs            # HTML + PDF
//   node scripts/gear-plan-v2.mjs --no-pdf   # HTML only
// =====================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "docs", "gear-guide");
const cfgModule = { exports: {} };
new Function("module", "exports", await readFile(path.join(root, "bot", "config.js"), "utf8"))(cfgModule, cfgModule.exports);
const config = cfgModule.exports;

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
const missing = new Set();
const usedSets = new Set();
if (G.items.ololipop) G.items.ololipop.name = "Lolipop Mace (orange)";
if (G.items.glolipop) G.items.glolipop.name = "Lolipop Mace (green)";
const title = (name) => (G.items[name] ? G.items[name].name : (missing.add(name), name));
function icon(name, size = 30) {
    const d = G.items[name];
    const p = d && G.positions[d.skin || name];
    if (!p) { missing.add(name); return `<div class="ic miss" style="width:${size}px;height:${size}px">?</div>`; }
    const set = p[0] || "";
    usedSets.add(set);
    const st = sets[set];
    return `<div class="ic" style="width:${size}px;height:${size}px;background-image:var(--s-${set || "pack_20"});background-size:${st.columns * size}px ${st.rows * size}px;background-position:-${p[1] * size}px -${p[2] * size}px"></div>`;
}

// ---- the plan -------------------------------------------------------------------
// A step: [item, level, status, how, extra]. status: bot (the bot does it), plan (decided, not built),
// open (not decided), found (worn when we have it, never chased). extra: { now: worn level, note }.
// A slot: { slot, steps: [...], alts: [...], note }.
const B = "bot", P = "plan", O = "open", F = "found";
const shopArmor = (item, now) => [item, 8, B, "NPC shop · +7, then +8", now != null ? { now } : {}];

const CLASSES = {
    priest: {
        color: "#e8e8e8", stat: "INT", who: "VizPri", role: "healer · chest opener · luck carrier (luck catch)",
        slots: [
            { slot: "Main hand", steps: [
                ["staff", 8, B, "NPC shop · gear goals"],
                ["firestaff", 7, B, "essence of fire (material goals)"],
                ["staffofthedead", 7, B, "bones (material goals)", { now: 7 }],
                ["lmace", null, P, "end goal · luck 6", { found: true }]] },
            { slot: "Offhand", steps: [
                ["wbook0", 2, B, "worn in normal fights", { now: 2 }]],
              alts: [["mshield", 7, P, "luck swap (or always?) · 10 Fun Tokens · luck 8, +1/level"]] },
            { slot: "Orb", steps: [
                ["orbg", 0, B, "craft"], ["orbg", 1, B, "only to +1", { now: 1 }],
                ["orbofint", 0, B, "craft (Cole) · worn in normal fights"]],
              alts: [["rabbitsfoot", 0, P, "luck swap · 120 Fun Tokens · luck 10"]] },
            { slot: "Helmet", steps: [
                shopArmor("helmet"),
                ["wcap", 8, B, "Wanderer's set (Ponty / craft from stock)", { now: 8 }],
                ["hhelmet", null, P, "Heavy set · Wanderer's Cap stays for the luck swap"]] },
            { slot: "Chest", steps: [
                shopArmor("coat"),
                ["wattire", 8, B, "Wanderer's set · chest opener wish", { now: 8 }],
                ["harmor", null, P, "Heavy set · Wanderer's Attire stays for the luck swap"]] },
            { slot: "Pants", steps: [
                shopArmor("pants", 8),
                ["wbreeches", 8, B, "Wanderer's set · wish open"],
                ["hpants", null, P, "Heavy (still on gear.noEquip)"],
                ["starkillers", null, P, "when one is good enough", { found: true }]],
              alts: [["frankypants", null, P, "11 stats at +7, +6 vit · stands in for Heavy", { found: true }]] },
            { slot: "Gloves", steps: [
                shopArmor("gloves", 8),
                ["wgloves", 8, B, "Wanderer's set · wish open"],
                ["fierygloves", null, P, "craft: gloves + 20 feathers (Big Birds) + 2 essence of fire"]],
              alts: [["supermittens", null, F, "event · when better"]] },
            { slot: "Shoes", steps: [
                shopArmor("shoes"),
                ["wshoes", 8, B, "stand-in (full set: +16 luck)", { now: 8 }],
                ["wingedboots", 7, B, "craft: shoes + 20 magical feathers"]] },
            { slot: "Cape", steps: [["cape", 0, B, "exchange: 40 leather · wish open"]],
              alts: [["gcape", null, F, ""]] },
            { slot: "Rings ×2", steps: [
                ["intring", 2, B, "Winterland drops · compound"], ["intring", 3, B, "", { now: "3 / 2" }], ["intring", 4, B, "item stages"],
                ["glacierseal", 2, P, "craft: INT ring +2 + frost core + 6 essence of frost · INT 12 at +2 (9 crafts) · missing: essence of frost"]],
              alts: [["zapper", 1, P, "INT 13 at +1, +5 STR, +30 res, zap skill · 2nd one?"],
                     ["cring", null, F, "INT 10 + DEX 10 at +3"]] },
            { slot: "Earrings ×2", steps: [
                ["intearring", 2, B, "compound"], ["intearring", 3, B, "", { now: "3 / 3" }], ["intearring", 4, B, "item stages"],
                ["moonshardearring", 2, P, "craft: INT earring +2 + 8 void thread + 40 bat wings + 4 ether · INT 12.5 + 160 MP at +2 (9 crafts)"]],
              alts: [["cloverstud", 0, P, "luck swap · luck 6 at +0 · craft: vit earring +2, verdant core, ash leaf (Ents), spores, slime"]] },
            { slot: "Amulet", steps: [
                ["intamulet", 2, B, "", { now: 2 }], ["intamulet", 3, B, ""], ["intamulet", 4, B, "item stages"],
                ["t2intamulet", null, P, "gem fragments (moles, gem fragment boxes) · once the normal ones are +3 · no Amulet of MP"]] },
            { slot: "Belt", steps: [["intbelt", 0, B, "Spooky Town map drop"], ["intbelt", 2, B, "", { now: 2 }], ["intbelt", 4, B, "item stages"]],
},
            { slot: "Elixir", steps: [["elixirluck", null, P, "Liquid Luck all the time, not swapped · luck 16, 12 h · Winter Inn bartender"]] },
            { slot: "Luck swap", set: true, steps: [
                ["mshield", null, P, ""], ["rabbitsfoot", null, P, ""],
                ["wcap", null, P, ""], ["wattire", null, P, ""], ["wbreeches", null, P, ""], ["wgloves", null, P, ""], ["wshoes", null, P, ""],
                ["cloverstud", null, P, ""]], note: "5 Wanderer pieces = +16 luck" },
        ],
    },
    warrior: {
        color: "#c9a27e", stat: "STR", who: "VizWar", role: "tank · Agitate / Taunt",
        slots: [
            { slot: "Single target", steps: [
                ["blade", 8, B, "NPC shop · both hands"],
                ["swordofthedead", 7, B, "+5 … +7 as steps · bones"],
                ["fireblade", 7, B, "essence of fire · bosses", { now: 7 }]] },
            { slot: "AoE (carried)", steps: [
                ["glolipop", 7, B, "drop: Green Jr. · stand-in"],
                ["ololipop", 7, B, "drop: Jr. · two carried", { now: 7 }],
                ["vhammer", null, P, "lifesteal idea", { found: true }]] },
            { slot: "Orb", steps: [
                ["orbg", 0, B, "craft"], ["orbg", 1, B, "", { now: 1 }],
                ["orbofstr", 0, B, "craft (Cole)"],
                ["cave_loaded_die", null, P, "craft: 10 Cave Amber + 8 seashells + 2 reef glass"]] },
            { slot: "Helmet", steps: [
                shopArmor("helmet"),
                ["helmet1", 7, B, "Rugged · armor boxes", { now: 7 }],
                ["helmet1", 8, P, "Rugged +8"],
                ["hhelmet", null, P, "Heavy"]],
              alts: [["xhelmet", null, P, "Darkforge", { found: true }]] },
            { slot: "Chest", steps: [
                shopArmor("coat"),
                ["coat1", 7, B, "Rugged · armor boxes", { now: 7 }],
                ["coat1", 8, P, "Rugged +8"],
                ["mcape", 7, P, "replaces Rugged only from +7 · on gear.noEquip", { found: true }],
                ["mcape", 8, P, "slowly, 2-3 tries a day"]] },
            { slot: "Pants", steps: [
                shopArmor("pants"),
                ["pants1", 7, B, "Rugged · armor boxes", { now: 7 }],
                ["pants1", 8, P, "Rugged +8"],
                ["hpants", null, P, "Heavy (still on gear.noEquip)"]],
              alts: [["xpants", null, P, "Darkforge", { found: true }]] },
            { slot: "Gloves", steps: [
                shopArmor("gloves"),
                ["gloves1", 7, B, "Rugged · armor boxes", { now: 7 }],
                ["gloves1", 8, P, "Rugged +8"],
                ["fierygloves", null, P, "craft: gloves + 20 feathers (Big Birds) + 2 essence of fire"]],
              alts: [["supermittens", null, F, "event · when better"]] },
            { slot: "Shoes", steps: [
                shopArmor("shoes"),
                ["shoes1", 7, B, "Rugged · armor boxes", { now: 7 }],
                ["shoes1", 8, P, "Rugged +8"],
                ["wingedboots", 7, B, "craft: shoes + 20 magical feathers"]] },
            { slot: "Cape", steps: [["cape", 0, B, "exchange: 40 leather", { now: 0 }]] },
            { slot: "Rings ×2", steps: [
                ["strring", 2, B, "Winterland drops · compound"], ["strring", 3, B, "", { now: "3 / 2" }], ["strring", 4, B, "item stages"],
                ["emberseal", 2, P, "craft: STR ring +2 + ember core + 6 essence of fire · STR 12 at +2 (9 crafts)"],
                ["vring", null, P, "Vampirings over everything as soon as we have any (crypt, 1:20,000)", { found: true }]] },
            { slot: "Earrings ×2", steps: [
                ["strearring", 2, B, "compound"], ["strearring", 3, B, "", { now: "3 / 3" }], ["strearring", 4, B, "item stages"]] },
            { slot: "Amulet", steps: [
                ["stramulet", 4, B, "item stages", { now: 4 }],
                ["t2stramulet", null, P, "gem fragments - next up"]] },
            { slot: "Belt", steps: [["strbelt", 0, B, "Spooky Town map drop"], ["strbelt", 2, B, "", { now: 2 }], ["strbelt", 4, B, "item stages"]] },
            { slot: "Elixir", steps: [["elixirstr0", null, P, "main-stat elixir, 12 h · seashell exchange (20 shells → 1 basic elixir)"]] },
        ],
    },
    ranger: {
        color: "#9ccc65", stat: "DEX", who: "VizRng", role: "main damage · boss runner",
        slots: [
            { slot: "Main hand", steps: [
                ["bow", 8, B, "NPC shop · gear goals"],
                ["hbow", null, P, "Hunting Bow · Cole: 40 dark stones + 2 pleather + 1 feather"],
                ["firebow", 7, B, "essence of fire", { now: 7 }],
                ["crossbow", null, P, "end goal"]] },
            { slot: "AoE (carried)", steps: [
                ["pouchbow", null, P, "Poucher · craft: bow + Pouch of Poof (Halloween candy) · carried like the Lolipops, never handed back"],
                ["alloyquiver", null, P, "Alloy Quiver (explosion) with the Poucher · targetrons 1:4,000"]] },
            { slot: "Quiver", steps: [
                ["quiver", 0, B, "craft: armadillo scale + 200 bee wings"], ["quiver", 7, B, ""], ["quiver", 8, B, "", { now: 8 }],
                ["t2quiver", null, P, "Agile Quiver - end goal (no Storm Quiver)"]] },
            { slot: "Orb", steps: [
                ["orbg", 0, B, "craft"], ["orbg", 1, B, "", { now: 1 }],
                ["orbofdex", 0, B, "craft (Cole)"],
                ["cave_loaded_die", null, P, "craft: 10 Cave Amber + 8 seashells + 2 reef glass"]] },
            { slot: "Helmet", steps: [shopArmor("helmet", 8), ["fury", null, P, "Band of Fury", { found: true }]] },
            { slot: "Chest", steps: [shopArmor("coat", 8), ["coat", 9, P, "shop +9 - needs per-piece caps in the bot"]] },
            { slot: "Pants", steps: [shopArmor("pants", 8)] },
            { slot: "Gloves", steps: [
                shopArmor("gloves", 8),
                ["thundergrips", null, P, "craft: Gloves of the Hunter Ranger +6 (8 Monster Tokens) + 80 storm feathers + 12 essence of ether"]],
              alts: [["supermittens", null, F, "event · when better"]] },
            { slot: "Shoes", steps: [
                shopArmor("shoes"),
                ["wshoes", 8, B, "Wanderer's (found)", { now: 8 }],
                ["wingedboots", 7, B, "craft: shoes + 20 magical feathers"]] },
            { slot: "Cape", steps: [["cape", 0, B, "exchange: 40 leather · wish open"]] },
            { slot: "Rings ×2", steps: [
                ["ringsj", 2, B, "stand-in", { now: 2 }],
                ["dexring", 2, B, "compound"], ["dexring", 3, B, "", { now: 3 }], ["dexring", 4, B, "item stages · stays DEX, no Tri-Stones"],
                ["venomband", 2, P, "craft: DEX ring +2 + verdant core + 12 poison + 4 snake fangs · long-term step (2026-11-23)"]],
              alts: [["suckerpunch", null, B, "drop: crabs · replaces any ring at any time"]] },
            { slot: "Earrings ×2", steps: [
                ["dexearring", 2, B, "compound", { now: "2 / 2" }], ["dexearring", 3, B, ""], ["dexearring", 4, B, "item stages"]] },
            { slot: "Amulet", steps: [
                ["dexamulet", 2, B, ""], ["dexamulet", 3, B, "", { now: 3 }], ["dexamulet", 4, B, "item stages"],
                ["t2dexamulet", null, P, "gem fragments · once the normal ones are +3"]] },
            { slot: "Belt", steps: [["dexbelt", 0, B, "Spooky Town map drop"], ["dexbelt", 2, B, "", { now: 2 }], ["dexbelt", 4, B, "item stages"]],
              alts: [["windbelt", 2, P, "craft: DEX belt +2 + 40 storm feathers + 4 essence of ether · DEX 16, armor 18, speed 3.5 at +2"]] },
            { slot: "Elixir", steps: [["elixirdex0", null, P, "main-stat elixir, 12 h · seashell exchange (20 shells → 1 basic elixir)"]] },
        ],
    },
    // Mage (2026-11-23): next character, levelled solo with Lone Wolf to 65. The priest's INT path plus the Blaster.
    mage: {
        color: "#7fb2ff", stat: "INT", who: "not created yet", role: "magic damage · Energize · later Reflective Shield on the tank, Magiport boss runner",
        slots: [
            { slot: "Main hand", steps: [
                ["staff", 8, B, "NPC shop · gear goals · no +8 staff left (it went into the Blaster)"],
                ["firestaff", 7, P, "essence of fire · needs a mage list in gearPlan.weapons"],
                ["firestaff", 9, P, "community goal"]] },
            { slot: "AoE (carried)", steps: [
                ["gstaff", 3, P, "Blaster · crafted 2026-11-23 · +1…+3 each with a Primling (100 %), no +4 (max 88 %) · great staff: +160 MP per attack, both hands → only for Agitate packs, mode switch like the Lolipops (not built)"]],
              alts: [["sparkstaff", null, F, "Spark Staff · Sparkbot 1:8,000 · weaker than the Blaster"]] },
            { slot: "Offhand", steps: [
                ["wbook0", 2, P, "Book of Knowledge · 4 in the bank (2× +2, 2× +0) · bats 1:250"],
                ["wbook0", 4, P, "compound"]],
              alts: [["wbook1", null, F, "Book of Secrets · INT 16, VIT 6"]] },
            { slot: "Orb", steps: [
                ["orbg", 0, B, "craft"], ["orbg", 1, B, ""], ["orbofint", 0, B, "craft (Cole)"]],
              alts: [["cave_loaded_die", null, P, "craft: 10 Cave Amber + 8 seashells + 2 reef glass"]] },
            { slot: "Helmet", steps: [
                shopArmor("helmet"),
                ["mmhat", 7, P, "Hat of the Hunter Mage · 7 Monster Tokens (5 left) · resistance piercing 40 · the only Hunter piece"]] },
            { slot: "Chest", steps: [shopArmor("coat")] },
            { slot: "Pants", steps: [shopArmor("pants")],
              alts: [["starkillers", null, F, "Star Killer's · armor boxes (held), Halloween candy, xmagex 1:500"]] },
            { slot: "Gloves", steps: [
                shopArmor("gloves"),
                ["fierygloves", 7, P, "craft like the priest's: gloves + 20 feathers + 2 essence of fire"]],
              alts: [["supermittens", null, F, "event · when better"]] },
            { slot: "Shoes", steps: [shopArmor("shoes"), ["wingedboots", 7, B, "craft: shoes + 20 magical feathers"]] },
            { slot: "Cape", steps: [["cape", 0, B, "exchange: 40 leather"]], alts: [["ecape", null, F, "Fluffy Blanket · Easter"]] },
            { slot: "Rings ×2", steps: [
                ["intring", 2, B, "Winterland drops · compound"], ["intring", 3, B, ""], ["intring", 4, B, "item stages"],
                ["glacierseal", 2, P, "craft like the priest's · shares frost cores and essence of frost"]],
              alts: [["cring", null, F, "Ring of the Crypt · crypt bats only"]] },
            { slot: "Earrings ×2", steps: [
                ["intearring", 2, B, "compound"], ["intearring", 3, B, ""], ["intearring", 4, B, "item stages"],
                ["moonshardearring", 2, P, "craft like the priest's · void thread shared with priest and rogue"]] },
            { slot: "Amulet", steps: [
                ["intamulet", 2, B, ""], ["intamulet", 3, B, ""], ["intamulet", 4, B, "item stages"],
                ["t2intamulet", null, P, "Amulet of the Fierce Mage · gem fragments"]] },
            { slot: "Belt", steps: [["intbelt", 0, B, "Spooky Town map drop"], ["intbelt", 2, B, ""], ["intbelt", 4, B, "item stages"]] },
        ],
    },
    // Rogue (2026-11-23): the end-end goal, after the mage - a mass farmer that one-shots a spot with Fan of Knives.
    rogue: {
        color: "#c58cff", stat: "DEX", who: "not created yet", role: "mass farmer (Fan of Knives, 1-2 hits) · own spot · group in an emergency",
        slots: [
            { slot: "Both hands", steps: [
                ["cclaw", 8, P, "Crab Claw ×2 · bought 2026-11-23 (15.2M each) · fist weapon, armor piercing"],
                ["daggerofthedead", 7, P, "bones (material goals)"],
                ["hdagger", null, F, "Dagger of Hallowing · rogue only · Jr. / Green Jr. 0.1 %"],
                ["vdagger", null, F, "Vampiric Dagger · crypt"]],
              note: "No rapier: +70 % attack speed, but the daggers hit harder - what counts for 1-2 hits." },
            { slot: "Belt", steps: [
                ["dexbelt", 0, B, "Spooky Town map drop"], ["dexbelt", 2, B, ""],
                ["knifebelt", 0, P, "craft: DEX belt +2 + 30 spider silk + 8 void thread + 20 bat wings + 12 poison + 350k · unlocks Fan of Knives"]] },
            { slot: "Gloves", steps: [
                shopArmor("gloves"),
                ["fierygloves", 7, P, "stand-in · +2 attack speed"],
                ["hexweavegloves", 7, P, "must: skill MP −20 % · craft: 50 witch parcels + gold ingot + 100 spider silk + 4M (Witch's Cipher)"]] },
            { slot: "Helmet", steps: [shopArmor("helmet"), ["fury", null, P, "Band of Fury · armor boxes (held for a later batch)"]] },
            { slot: "Chest", steps: [shopArmor("coat")],
              alts: [["tshirt9", null, F, "Manasteal · T-Shirt Roll 0.24 %"], ["cave_ambercoat", null, F, "Amberweave · luck, MP, evasion · endgame"]] },
            { slot: "Pants", steps: [
                shopArmor("pants"),
                ["reedpants", 7, P, "craft: pants +6 + 20 frog tongues (squigtoads 0.25 %) + 4 lotus flowers (frogs 0.25 %) + 40 ash leaf + 100k · first farm test"]],
              alts: [["fallen", null, F, "Fallen Master · Halloween bosses"]] },
            { slot: "Shoes", steps: [shopArmor("shoes"), ["wingedboots", 7, B, "craft: shoes + 20 magical feathers"]] },
            { slot: "Cape", steps: [["cape", 0, B, "exchange: 40 leather"]] },
            { slot: "Rings ×2", steps: [
                ["dexring", 2, B, "compound"], ["dexring", 3, B, ""], ["dexring", 4, B, "item stages"],
                ["venomband", 2, P, "craft: DEX ring +2 + verdant core + 12 poison + 4 snake fangs · long-term step"]],
              alts: [["suckerpunch", null, F, "crabs · replaces any ring"]] },
            { slot: "Amulet", steps: [
                ["dexamulet", 2, B, ""],
                ["gloampendant", 0, P, "craft: DEX amulet +2 + 30 void thread + 80 bat wings + 6 essence of ether + 6.4M · 250 MP, skill MP −6 %"]] },
            { slot: "Earrings ×2", steps: [["cloverstud", 0, P, "×2 · solo luck · craft like the priest's (a verdant core each)"]],
              alts: [["dexearring", 4, P, "group play · mode swap (not built)"]] },
            { slot: "Orb", steps: [["rabbitsfoot", 0, P, "solo luck · a second one, 120 Fun Tokens"]],
              alts: [["cave_loaded_die", null, P, "group play · crit"]] },
        ],
    },
};

const RULES_BOT = [
    "Every slot has a ladder: base → better pieces → end goal. The worn piece keeps going up until the next step is in hand.",
    "Shop weapons and armor go up in team-wide stages: every fighter's shop gear to +7, then everyone to +8. High scrolls from +5 → +6; armor gets the main-stat scroll.",
    "Jewelry (rings, earrings, amulets, belts) to +4 with item stages: a +4 wish waits until every wish for that item at +3 is fulfilled.",
    "Weapons per class from the back of the list: the best item we hold a copy of goes up to +7. Fire weapons from essence of fire, the \"of the Dead\" weapons from bones.",
    "Shop, craft and farmable drops are wished and pursued. Event and boss items (\"found\") are worn when we have them, never chased.",
    "A missing item has a stand-in (green Lolipop for the orange one). A worn alternative pauses its slot's ladder.",
    "Wanderer's set only for the priest (v1.224.0): he opens the chests and catches the luck - 4 pieces with the cap = +10 % gold, full set = +16 luck. Once his Wanderer goals are done, spare copies are sold.",
    "Winged Boots to +7. Elixirs off.",
    "Priest luck swap (v1.219.0): right before Absorb Sins one equip_batch puts on the luck pieces he has (Wanderer's set, later Shield M, Rabbit's Foot, 2 Clover Studs) and changes back 3 s after the last catch. The warrior's weapon swaps use one equip_batch too (v1.223.6).",
];
const RULES_PLAN = [
    "First a permanently reachable base for every slot; event items come on top later.",
    "No Monster Hunter sets - except the ranger gloves (Thundergrips base) and the mage hat (resistance piercing 40). Fun Tokens are saved for Shield M (10) and two Rabbit's Feet (priest, rogue; 120 each). 50 Monster Tokens were sold on 2026-11-23 (1M each); 5 left.",
    "Luck: drops roll with the luck of the monster's target at death. The priest's luck catch (Absorb Sins) lets ~88 % of kills die on him - luck gear belongs on the priest.",
    "Warrior: Rugged set to +8. Dracul's Attire only from +7 (no stat drop below +7), then slowly to +8.",
    "Ranger: Hunting Bow → Fire Bow → Crossbow; Poucher + Alloy Quiver for AoE, carried like the warrior's Lolipops. Agile Quiver is the quiver end goal (no Storm Quiver). Sucker Punch (ranger and rogue) replaces any ring at any time.",
    "2026-11-23: a long farm goal between two steps beats \"no upgrade until the rare drop\" - it is an idle game. So the Venom Band comes between the DEX rings and the Sucker Punch, for ranger and rogue.",
    "Mage (next character, solo to 65): the priest's INT path - Fiery Staff, Book of Knowledge, Moonshard, Glacier Seal, Fiery Gloves, T2 amulet; both compete for void thread, frost cores and essences. Hunter Mage Hat for resistance piercing. The Blaster +3 only for Agitate packs (165 MP per attack).",
    "Rogue (end-end goal, after the mage): daggers, Knife Belt, Hexweave Gloves (must), Reed Pants, Gloam Pendant, shop chest. Solo luck: 2 Clover Studs + Rabbit's Foot; group play: DEX earrings + Loaded Die (mode swap, not built).",
    "Path B (idea, not for now): a +0 Wanderer swap set in the bag and the armor straight from shop +8 to Heavy (no Rugged) - for a new priest, once the swap is shown to be fast enough.",
    "Elixirs: the main-stat elixir for warrior (STR) and ranger (DEX), Liquid Luck for the priest - all the time, never swapped. Seashells: frogs 16 %, squigtoads 5 % (or buy). Built after the gear plan.",
    "Essence of ether is the shared bottleneck: Moonshard 4, Wind Belt 4, Thundergrips 12 - we hold 9 (gargoyles, booboos 0.5 %).",
    "Not planned: Belt of Hallowed Trials (for now), Wooden Shield, Amulet of MP, Ring of Luck (drop ~7 in 10M), Storm Quiver, Beastmantle, Starcloak, Black Cat Bell. Djinn Crown untested. Verdant cores (Venom Band, Clover Stud) come from Ents or 1:3,000 Sprawlings - not event-only.",
];
const OPEN = [
    "Priest: Shield M in the swap set or worn all the time?",
    "Priest rings: a second Zapper? Better than an INT ring +4; next to Glacier Seals only a sidegrade.",
    "Build: per-piece armor caps (ranger chest +9), Hunting Bow and Crossbow into the ranger's weapon list, Dracul's Attire and Heavy Underarmor off gear.noEquip, elixirs; for the mage a weapon list and the Blaster mode switch.",
];

// ---- rendering --------------------------------------------------------------
function step(s) {
    const [item, to, status, how, extra = {}] = s;
    const lv = to != null ? `<span class="lv">+${to}</span>` : "";
    const now = extra.now != null ? `<span class="now">worn +${esc(extra.now)}</span>` : "";
    const found = extra.found ? " fnd" : "";
    return `<div class="st2 ${status}${found}"><div class="iw sm">${icon(item, 24)}${lv}</div><div class="tx"><b>${esc(title(item))}${now}</b>${how ? `<span>${esc(how)}</span>` : ""}</div></div>`;
}
const arrow = `<div class="ar">→</div>`;
const plus = `<div class="ar">+</div>`;
function classPage(key) {
    const c = CLASSES[key];
    const rows = c.slots.map((s) => `<tr${s.set ? ' class="setrow"' : ""}><td class="sl">${esc(s.slot)}</td><td><div class="ladder">${s.steps.map(step).join(s.set ? plus : arrow)}</div>${s.note && !s.set ? `<div class="snote">${esc(s.note)}</div>` : ""}</td><td><div class="col">${(s.alts || []).map(step).join("") || '<span class="dash">–</span>'}</div></td></tr>`).join("");
    return `<section class="page cls2" style="--acc:${c.color}">
    <div class="ttl"><h2>${key[0].toUpperCase() + key.slice(1)}</h2><span class="tag">${c.stat}</span><span class="role">${esc(c.role)}</span><span class="ours">${c.who}</span></div>
    <table class="rules r2"><tr><th></th><th>Ladder (left to right)</th><th>Alternatives / when found</th></tr>${rows}</table></section>`;
}
const legend = `<div class="lg">
  <div><span class="sw2 bot"></span><b>Bot</b> the bot does this today</div>
  <div><span class="sw2 plan"></span><b>Plan</b> decided, not built yet</div>
  <div><span class="sw2 open"></span><b>Open</b> not decided</div>
  <div><span class="sw2 found"></span><b>Found</b> worn when we have it, never chased</div>
  <div><span class="now">worn +X</span> what the fighter wears now</div></div>`;
const cover = `<section class="page cover"><h1>Gear Plan <span class="dr">v2</span></h1>
<p class="lead">Every class, every slot: what the bot does today (bot/config.js) merged with the decisions of 2026-11-22 and 2026-11-23 that are not built yet (mage and rogue added), and what each fighter wears now. Once the open points are settled, this goes into config.gearPlan.</p>
${legend}
<div class="two"><div><h3>How the bot works today</h3><ol class="pr sm">${RULES_BOT.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></div>
<div><h3>Decided 2026-11-22 / 23 (not built yet)</h3><ol class="pr sm">${RULES_PLAN.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
<h3>Open points</h3><ol class="pr sm open">${OPEN.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></div></div>
<p class="src">In the bot since v1.219.0 (2026-11-22) · bot v${esc(config.version)} · worn gear read live · icons and names: Adventure Land game data v${G.version}</p></section>`;

const CSS_EXTRA = `
.st2 { display: flex; align-items: center; gap: 4px; background: #1b1e26; border: 1.5px solid #262a35; border-radius: 5px; padding: 1px 5px 1px 1px; min-height: 27px; max-width: 70mm; }
.iw.sm { width: 24px; height: 24px; }
.st2.bot { border-color: #4f9a5b; }
.st2.plan { border-color: #e0b44f; }
.st2.open { border-color: #e05f5f; border-style: dashed; }
.st2.found { border-color: #6b7488; border-style: dashed; }
.st2.fnd { border-style: dashed; }
.st2 .tx b { font-size: 9.5px; line-height: 1.15; }
.st2 .tx span { font-size: 8px; line-height: 1.15; }
.now { display: inline-block !important; margin-left: 4px; vertical-align: 1px; font-size: 8px !important; font-weight: 700; color: #14161c !important; background: #7fd3ff; border-radius: 3px; padding: 0 4px; margin-top: 1px; line-height: 12px !important; }
.cls2 .ttl { margin-bottom: 4px; }
.role { font-size: 11px; color: #b9bfcc; }
table.r2 th:first-child { width: 78px; }
.setrow td { background: #1f1a10 !important; }
.setrow .sl { color: #e0b44f; }
table.r2 th:nth-child(2) { width: 74%; }
table.r2 { border-spacing: 0 2px; }
table.r2 td { padding: 1px 5px; }
.cls2 { padding: 5mm 10mm; }
.cls2 .ladder { gap: 3px; }
.cls2 .ar { font-size: 12px; }
.r2 .sl { font-size: 10.5px; }
.lg { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 10px 0 4px; font-size: 11.5px; color: #cfd4de; align-items: center; }
.lg > div { display: flex; align-items: center; gap: 6px; }
.sw2 { display: inline-block; width: 22px; height: 14px; border-radius: 3px; border: 2px solid; background: #1b1e26; }
.sw2.bot { border-color: #4f9a5b; } .sw2.plan { border-color: #e0b44f; } .sw2.open { border-color: #e05f5f; border-style: dashed; } .sw2.found { border-color: #6b7488; border-style: dashed; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
.pr.sm { font-size: 10.5px; line-height: 1.35; }
.pr.sm li { margin-bottom: 2px; }
.pr.open li::marker { color: #e05f5f; }
.snote { font-size: 8px; color: #9aa3b5; margin-top: 1px; }
`;

// One block per class, in this order (mage and rogue added 2026-11-23; paladin follows when we play it).
const ORDER = ["warrior", "priest", "ranger", "mage", "rogue"];
const body = [cover, ...ORDER.map(classPage)].join("\n");
for (const s of usedSets) await sheet(s);
const css = await readFile(path.join(dir, "gear-plan.css"), "utf8");
const vars = `:root{${[...usedSets].map((s) => `--s-${s || "pack_20"}:url(${sheetData[s]})`).join(";")}}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gear Plan v2</title><style>${css}\n${CSS_EXTRA}\n${vars}</style></head><body>${body}</body></html>`;
const htmlPath = path.join(dir, "gear-plan-v2.html");
await writeFile(htmlPath, html);
console.log("wrote", htmlPath, html.length);
if (missing.size) console.log("MISSING items:", [...missing].join(", "));

const browsers = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"];
const browser = browsers.find((b) => existsSync(b));
if (browser && !process.argv.includes("--no-pdf")) {
    const profile = path.join(os.tmpdir(), "gear-plan-pdf-profile");
    await mkdir(profile, { recursive: true });
    const pdfPath = path.join(dir, "gear-plan-v2.pdf");
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + profile, "--no-pdf-header-footer", "--print-to-pdf=" + pdfPath, pathToFileURL(htmlPath).href], { stdio: "ignore" });
    console.log("wrote", pdfPath);
}
