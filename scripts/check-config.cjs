// Compares the config object of two config.js files value by value (module plan, stage 3a: shortening the comments
// must not change a single value). Run: node scripts/check-config.cjs <old config.js> <new config.js>
const path = require("path");
function load(file) {
    globalThis.character = { name: "VizPri" };
    delete require.cache[require.resolve(path.resolve(file))];
    const cfg = require(path.resolve(file));
    return JSON.stringify(cfg, function (k, v) { return typeof v === "function" ? "fn:" + v.toString() : v instanceof RegExp ? "re:" + v.toString() : v; });
}
const a = load(process.argv[2]), b = load(process.argv[3]);
if (a === b) { console.log("identical: " + a.length + " chars of config values"); process.exit(0); }
let i = 0;
while (i < a.length && a[i] === b[i]) i++;
console.log("DIFFERENT at char " + i + ":\n  old ..." + a.slice(Math.max(0, i - 120), i + 120) + "\n  new ..." + b.slice(Math.max(0, i - 120), i + 120));
process.exit(1);
