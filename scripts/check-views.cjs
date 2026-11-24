// Stage 7a: every module main.js creates with moduleView(ctx, [names]) may use only those ctx fields. This check reads
// main.js and each module's entry file (from slots.json) and fails when an entry uses a ctx.<field> its view lacks.
// Run: node scripts/check-views.cjs
const fs = require("fs");
const path = require("path");
const bot = path.join(__dirname, "..", "bot");
const main = fs.readFileSync(path.join(bot, "main.js"), "utf8");
const slots = JSON.parse(fs.readFileSync(path.join(bot, "slots.json"), "utf8")).slots;
const fileOf = name => (slots.find(s => s.name === name) || {}).file;
let bad = 0, checked = 0;
function check(file, names, label) {
    const src = fs.readFileSync(path.join(bot, file), "utf8");
    const used = [...new Set((src.match(/(?<![\w.$])ctx\.[a-zA-Z]+/g) || []).map(m => m.slice(4)))];
    const missing = used.filter(n => !names.includes(n));
    const unused = names.filter(n => !used.includes(n));
    checked++;
    if (missing.length) { bad++; console.log("FAIL  " + label + " (" + file + ") uses " + missing.join(", ") + " - not in its view"); }
    else console.log("ok    " + label + " (" + file + ")" + (unused.length ? " - view has unused: " + unused.join(", ") : ""));
}
const re = /require_code\(("([\w]+)"|classSlot)\)\(moduleView\(ctx, \[([^\]]*)\]\)/g;
let m;
while ((m = re.exec(main))) {
    const names = m[3].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
    if (m[2]) check(fileOf(m[2]), names, m[2]);
    else slots.filter(s => /^bot_class_/.test(s.name)).forEach(s => check(s.file, names, s.name));
}
// No module gets the whole ctx any more (only main's own chat commands).
const whole = (main.match(/require_code\([^)]*\)\(ctx[,)]/g) || []);
if (whole.length) { bad++; console.log("FAIL  modules still created with the whole ctx: " + whole.join(" ")); }
console.log(bad ? bad + " FAILED" : "all ok (" + checked + " modules)");
process.exit(bad ? 1 : 0);
