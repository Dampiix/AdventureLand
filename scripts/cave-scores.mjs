// Cave of Many Dreams - every encounter option valued in Amber equivalents (player decision 2026-11-24).
//
//   node scripts/cave-scores.mjs            # writes docs/cave/cave-scores.json, prints the ranking
//   node scripts/cave-scores.mjs e01 e10    # prints only that range
//
// Only 2 of the 6 options are offered per vote, so every option gets a value and the higher one wins. The values
// below were agreed with the player after the first run (2026-11-24); effects without game data are estimates and
// marked "est". Edit V / EFFECT_VALUE / OVERRIDE here, then rebuild the PDF (scripts/cave-encounters.mjs).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = JSON.parse(readFileSync(path.join(root, "docs", "cave", "dreams-event.json"), "utf8")).data;

// ---- agreed values (Amber = 1) -------------------------------------------------------------------------------
const V = {
    goldPer1000: 0.65,   // cave gold stays in the cave; only the Loaded Die (10,000) turns it into full value
    perSecond: 0.02,     // the first run made ~1.2 Amber a minute
    monster: 0.05,       // a regular cave monster: 8 % 1 Amber minus ~1.5 s (all shared 3,665 HP at level 73)
    traveler: -0.16,     // cave_npc / cave_rogue: 19,732 HP, ~8 s, no drops
    keeper: -0.2,        // Lockbreaker / Sentinel / Moth Keeper from an encounter: no drops, ~10 s
    ally: 0.3, tool: 0.2, lamp: 0.1, decoy: 0.05, truce: 0,
    hostileTravelerParcel: true, // guide: fights with hostile travelers pay a parcel roll (unverified)
};
// Item values (player 2026-11-24): only the Loaded Die counts; the rest are throwaway items.
const ITEM = { cave_loaded_die: 10, cave_tunnelaxe: 0.2, gem1: 0.1, scroll1: 0.1, cave_amber: 1 };
function tableValue(name) {
    const t = (name === "cave_farm") ? [[57, "cave_amber", 1], [20, "cave_amber", 2], [10, "scroll1"], [3, "cave_locktooth"], [2, "cave_mothsteps"], [4, "cave_tunnelaxe"], [4, "cave_reedscythe"]]
        : { cave_parcel: [[50, "cave_amber", 1], [22, "cave_amber", 2], [10, "scroll1"], [5, "gem1"], [2, "cave_locktooth"], [1, "cave_mothsteps"], [5, "cave_tunnelaxe"], [5, "cave_reedscythe"]],
            cave_rescue: [[60, "cave_amber", 2], [20, "cave_amber", 3], [10, "gem1"], [3, "cave_counterweight"], [2, "cave_mothsteps"], [5, "cave_tunnelaxe"]],
            cave_boss: [[55, "cave_amber", 3], [15, "cave_locktooth"], [12, "cave_counterweight"], [8, "cave_mothsteps"], [10, "cave_tunnelaxe"]],
            cave_finish: [[45, "cave_amber", 5], [15, "cave_locktooth"], [15, "cave_counterweight"], [10, "cave_mothsteps"], [5, "cave_loaded_die"], [10, "cave_tunnelaxe"]] }[name];
    const w = t.reduce((s, x) => s + x[0], 0);
    return t.reduce((s, x) => s + x[0] / w * (ITEM[x[1]] || 0) * (x[2] || 1), 0);
}
const ROLL = { cave_parcel: tableValue("cave_parcel"), cave_rescue: tableValue("cave_rescue"), cave_boss: tableValue("cave_boss"), cave_finish: tableValue("cave_finish") };
const gold = (g) => (g / 1000) * V.goldPer1000;
const secs = (s) => -s * V.perSecond;

function fightValue(type, n) {
    if (type === "cave_npc" || type === "cave_rogue") return n * V.traveler + (V.hostileTravelerParcel ? ROLL.cave_parcel : 0);
    if (["cave_lockbreaker", "cave_sentinel", "cave_mothkeeper"].includes(type)) return n * V.keeper;
    return n * V.monster;
}

// ---- effects without outcome data: estimates from the guide and the option text -------------------------------
// value, note ("est" = estimate, to be checked on the next runs)
const EST = {
    leave: [0, ""], story: [0, ""], recipes: [0, ""], reveal: [0.05, "marks rooms"], appraise: [0.05, "marks the rogue"],
    careful: [ROLL.cave_parcel + secs(20), "parcel roll - 20 s (est)"],
    inspect: [0.3, "a shop: ~8 % the Loaded Die (10 Amber for 6.5 worth of gold)"],
    free_die: [1 / 6, "a six: 1 Amber"],
    dice: [null, "even bet (0 on average)"], dice6: [null, "even bet (0 on average)"], die: [-99, "NEVER: 6 Amber for a 1-in-6 Loaded Die"],
    favor: [0.5 * V.ally + 0.5 * fightValue("cave_guard", 2), "helper or two guards"],
    dice_room: [fightValue("cave_rat", 4), "four rats or crabs"],
    practice: [null, "spar with the trainer (cannot kill us)"],
    exchange: [ROLL.cave_parcel - 2, "2 Amber for a parcel roll"],
    gift: [2, "2 Amber"],
    pay: [null, "cost only"],
    bad_fight: [fightValue("cave_guard", 3), "three guards"],
    bad_double: [fightValue("cave_npc", 1) + fightValue("cave_guard", 6), "the NPC (hostile: parcel roll, est) + six guards"],
    time: [null, "seconds of the clock"],
    wolves: [-99, "NEVER: six level 100 wolves"],
    use_tool: [ROLL.cave_parcel, "pry bar: a reward (est: parcel roll)"],
    tool: [V.tool, "pry bar"], lamp: [V.lamp, "lamp"], decoy: [V.decoy, "rattle / message"],
    guide: [V.ally, "NPC joins"],
    escort: [gold(3000) + ROLL.cave_rescue + secs(15), "3,000 gold + rescue roll, walking with it (est)"],
    plant: [0.7 * 3 + secs(20), "3 Amber if we come back after 1 min (est 70 %)"],
    moths: [0, "boots in the wall (Mothsteps, worth ~0) - needs a lamp"],
    // rescue scene (traveler + wolves)
    save: [ROLL.cave_rescue + fightValue("cave_wolf", 3), "fight the wolves (est 3), rescue roll"],
    watch: [ROLL.cave_parcel * 0.5, "loot the pack if they die (est)"],
    lure: [ROLL.cave_rescue * 0.7 + fightValue("cave_wolf", 3), "draw the wolves off (est)"],
    hire: [ROLL.cave_rescue + V.ally + fightValue("cave_wolf", 3), "save + hire (cost below)"],
    both: [fightValue("cave_npc", 1) + fightValue("cave_wolf", 3), "attack them and the wolves (est)"],
    cover: [ROLL.cave_parcel, "smaller reward: parcel roll, probably no fight (est)"],
    // conflicts (two NPCs)
    left: [0.5 * ROLL.cave_rescue + V.traveler, "rescue roll only if our side wins (est 50 %)"],
    right: [0.5 * ROLL.cave_rescue + V.traveler, "rescue roll only if our side wins (est 50 %)"],
    testimony: [0.8 * ROLL.cave_rescue + V.traveler, "help the harder hitter (est 80 % win)"],
    neither: [ROLL.cave_parcel * 0.8, "collect what is left (est)"],
    peace: [ROLL.cave_parcel, "pay to stop it (est: parcel roll)"],
    // hunts: "supplies, 5,000 gold and 2 Amber"
    hunt: [ROLL.cave_parcel + gold(5000) + 2, "parcel roll + 5,000 gold + 2 Amber"],
    hunt_double: [2 * ROLL.cave_parcel + gold(5000) + 2, "twice the supplies (est: 2 parcel rolls + gold + Amber)"],
    hunt_quick: [2, "2 Amber"],
    hunt_helper: [ROLL.cave_parcel + gold(5000) + 2 + V.ally, "with a helper (est)"],
    hunt_late: [2, "2 Amber, more time"],
};
const HUNT = { e32: ["cave_crab", 6, 90], e33: ["cave_bat", 8, 75], e34: ["cave_rat", 10, 60] };

function valueOf(e, o) {
    const notes = [];
    let v = 0;
    if (Array.isArray(o.outcomes) && o.outcomes.length) {
        const tw = o.outcomes.reduce((s, x) => s + (x.weight || 1), 0);
        o.outcomes.forEach((x) => {
            let w = 0;
            if (x.reward) w += ROLL[x.reward] || 0;
            if (x.gold) w += gold(x.gold);
            if (x.amber) w += x.amber;
            if (x.ally || x.join) w += V.ally;
            (x.flags || []).forEach((f) => { w += V[f] || 0; });
            if (x.fight) w += fightValue(x.fight[0], x.fight[1]);
            if (x.shadow) w = -99;
            v += (x.weight || 1) / tw * w;
        });
        if (o.outcomes.some((x) => x.shadow)) notes.push("NEVER: copy of our strongest");
    } else {
        const est = EST[o.effect];
        if (est && est[0] !== null) v += est[0];
        if (est && est[1]) notes.push(est[1]);
        if (!est) notes.push("unknown effect " + o.effect);
        if (HUNT[e.id] && /^hunt/.test(o.effect)) {
            const [type, n0, s] = HUNT[e.id];
            const n = o.effect === "hunt_double" ? 2 * n0 : o.effect === "hunt_quick" ? n0 / 2 : n0;
            v += n * V.monster;
        }
        if (o.effect === "time" && o.seconds) v += secs(o.seconds);
        if (o.effect === "dice" && o.win) v += 0.5 * gold(o.win);   // 4-6 wins
        if (o.effect === "dice6" && o.win) v += gold(o.win) / 6;    // a six wins
        // Sparring: a reward_amber variant pays that Amber; a time limit risks a miss (est 70 % within 15 s); ~15 s of fighting.
        if (o.effect === "practice") v += (o.reward_amber ? o.reward_amber : (o.seconds && o.seconds < 30 ? 0.7 : 1) * ROLL.cave_parcel) + secs(o.reward_amber ? 10 : 15);
        // Conflicts: "both" fights both NPCs for the chest (est: two travelers + a parcel roll); a rescue scene: them and the wolves.
        if (o.effect === "both" && ["conflict", "twins"].includes(e.kind)) { v = 2 * V.traveler + ROLL.cave_parcel; notes.length = 0; notes.push("fight both NPCs for the chest (est)"); }
        // The Cornered Rogue: watching is the only way to Last Word (1 %, valued ~20 Amber: no rogue of ours yet).
        if (e.id === "e20" && o.effect === "watch") { v += 0.01 * 20; notes.push("1 % Last Word (~20 Amber)"); }
    }
    if (o.cost) v -= gold(o.cost);
    if (o.amber && o.effect !== "die") v -= o.amber;
    if (o.needs) notes.push("needs a " + (o.needs === "tool" ? "pry bar" : o.needs));
    return { v: Math.round(v * 100) / 100, notes };
}

const out = D.encounters.map((e) => {
    const opts = e.options.map((o) => Object.assign({ id: o.id, label: o.label, effect: o.effect }, valueOf(e, o)));
    const ranked = opts.slice().sort((a, b) => b.v - a.v);
    ranked.forEach((o, i) => { o.rank = i + 1; });
    return { id: e.id, name: e.name, kind: e.kind, group: e.group, options: ranked };
});
writeFileSync(path.join(root, "docs", "cave", "cave-scores.json"), JSON.stringify({ values: V, items: ITEM, rolls: ROLL, encounters: out }, null, 1));

const [from, to] = [process.argv[2] || "e01", process.argv[3] || "e50"];
console.log("rolls:", Object.entries(ROLL).map(([k, v]) => k.replace("cave_", "") + " " + v.toFixed(2)).join(", "));
out.filter((e) => e.id >= from && e.id <= to).forEach((e) => {
    console.log("\n" + e.id + " " + e.name + " (" + e.kind + ")");
    e.options.forEach((o) => console.log("  " + o.rank + ". " + o.id.padEnd(9) + String(o.v.toFixed(2)).padStart(7) + "  " + o.label.replace(/\{npc\}/g, "NPC").replace(/\{rival\}/g, "rival") + (o.notes.length ? "  [" + o.notes.join("; ") + "]" : "")));
});
