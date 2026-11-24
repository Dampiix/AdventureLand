// Stage 7b: config.js keeps our decisions and fills the tuning from the defaults.js files next to the modules. The
// result must be the config of before, value by value. Run: node scripts/check-defaults.cjs <old config.js> [new config.js]
// - values: compared with the keys sorted (a filled key comes after ours - the order of keys is no value)
// - key order: every object whose keys now come in another order is listed; code that walks an object's keys in
//   order (Object.keys(...).find / forEach with a first-wins rule) must not be among them - checked by hand
// - one owner per setting: a default file that sets a key another default file sets too fails
const path = require("path");
const fs = require("fs");
globalThis.character = { name: "VizPri", ctype: "priest" };
function load(file) {
    const abs = path.resolve(file);
    Object.keys(require.cache).forEach(k => { if (k.indexOf(path.dirname(abs)) === 0) delete require.cache[k]; });
    return require(abs);
}
const norm = (k, v) => typeof v === "function" ? "fn:" + v.toString() : v instanceof RegExp ? "re:" + v.toString() : v;
function canon(v) {
    v = norm(null, v);
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; }
    return v;
}
const oldCfg = load(process.argv[2]);
const newFile = process.argv[3] || path.join(__dirname, "..", "bot", "config.js");
const newCfg = load(newFile);
let bad = 0;
// version differs on purpose
const a = Object.assign({}, oldCfg, { version: "-" }), b = Object.assign({}, newCfg, { version: "-" });
const ja = JSON.stringify(canon(a)), jb = JSON.stringify(canon(b));
if (ja === jb) console.log("values identical: " + ja.length + " chars");
else {
    bad++;
    let i = 0; while (i < ja.length && ja[i] === jb[i]) i++;
    console.log("VALUES DIFFER at char " + i + ":\n  old ..." + ja.slice(Math.max(0, i - 150), i + 150) + "\n  new ..." + jb.slice(Math.max(0, i - 150), i + 150));
}
// key order
const moved = [];
(function walk(x, y, p) {
    if (!x || !y || typeof x !== "object" || typeof y !== "object" || Array.isArray(x)) return;
    const kx = Object.keys(x).join(","), ky = Object.keys(y).join(",");
    if (kx !== ky && p) moved.push(p);
    Object.keys(x).forEach(k => walk(x[k], y[k], p ? p + "." + k : k));
})(oldCfg, newCfg, "");
console.log("objects with another key order (" + moved.length + "): " + (moved.join(", ") || "none"));
// one owner per setting
const src = fs.readFileSync(newFile, "utf8");
const files = [...src.matchAll(/require\("(\.\/(?:[^"]+\/)?defaults\.js)"\)/g)].map(m => m[1]);
const seen = {};
(function () {
    files.forEach(f => {
        const d = require(path.resolve(path.dirname(newFile), f));
        (function leaves(o, p) {
            Object.keys(o).forEach(k => {
                const v = o[k], q = p ? p + "." + k : k;
                if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof RegExp)) leaves(v, q);
                else { if (seen[q]) { bad++; console.log("TWICE " + q + ": " + seen[q] + " and " + f); } seen[q] = f; }
            });
        })(d, "");
    });
})();
console.log("default files: " + files.length + ", settings in them: " + Object.keys(seen).length);
console.log(bad ? "FAILED" : "ok");
process.exit(bad ? 1 : 0);
