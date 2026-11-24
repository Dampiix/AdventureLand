// Tests for scripts/bundle.mjs (module plan, pilot step 1). Run: node scripts/test-bundle.mjs
//   1. a bundle of nested CommonJS files behaves like loading them in Node (each file runs once);
//   2. a require cycle is refused;
//   3. every slot in bot/slots.json without relative requires is uploaded exactly as its file.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };

// Runs a slot's code the way require_code does: own scope, module.exports returned.
function runSlot(code) {
    const module = { exports: {} };
    new Function("module", "exports", code)(module, module.exports);
    return module.exports;
}

// 1 + 2: a small fake bot folder.
const dir = mkdtempSync(path.join(tmpdir(), "bundle-test-"));
try {
    mkdirSync(path.join(dir, "classes", "mage"), { recursive: true });
    mkdirSync(path.join(dir, "lib"));
    writeFileSync(path.join(dir, "lib", "counter.js"), "globalThis.__runs = (globalThis.__runs || 0) + 1;\nmodule.exports = { n: 0, add: function () { return ++this.n; } };\n");
    writeFileSync(path.join(dir, "classes", "mage", "blink.js"), "const counter = require('../../lib/counter.js');\nmodule.exports = function () { return 'blink ' + counter.add(); }; // a comment at the end");
    writeFileSync(path.join(dir, "classes", "mage", "port.js"), "const counter = require(\"../../lib/counter\");\nexports.port = function () { return 'port ' + counter.add(); };\n");
    writeFileSync(path.join(dir, "classes", "mage", "mage.js"), "const blink = require(\"./blink.js\");\nconst port = require(\"./port.js\").port;\nmodule.exports = function () { return [blink(), port(), blink()].join(', '); };\n");

    const b = bundle(dir, "classes/mage/mage.js");
    check(b.files.length === 4, "bundle lists 4 files: " + b.files.join(", "));
    check(/\/\/ ---- classes\/mage\/blink\.js/.test(b.code), "each part is marked with its path");
    globalThis.__runs = 0;
    const viaBundle = runSlot(b.code)();
    const bundleRuns = globalThis.__runs;
    globalThis.__runs = 0;
    const viaNode = createRequire(import.meta.url)(path.join(dir, "classes", "mage", "mage.js"))();
    check(viaBundle === viaNode && viaBundle === "blink 1, port 2, blink 3", "bundle result equals Node: " + viaBundle);
    check(bundleRuns === 1, "a file required twice runs once in the bundle");

    writeFileSync(path.join(dir, "lib", "a.js"), "require('./b.js'); module.exports = 1;\n");
    writeFileSync(path.join(dir, "lib", "b.js"), "require('./a.js'); module.exports = 2;\n");
    let cycleMsg = "";
    try { bundle(dir, "lib/a.js"); } catch (e) { cycleMsg = e.message; }
    check(/cycle: lib\/a\.js -> lib\/b\.js -> lib\/a\.js/.test(cycleMsg), "a require cycle is refused (" + cycleMsg + ")");

    let missingMsg = "";
    writeFileSync(path.join(dir, "lib", "c.js"), "require('./nope.js');\n");
    try { bundle(dir, "lib/c.js"); } catch (e) { missingMsg = e.message; }
    check(/cannot read lib\/nope\.js \(required by lib\/c\.js\)/.test(missingMsg), "a missing file names who required it");
} finally {
    rmSync(dir, { recursive: true, force: true });
}

// 3: today's slots.
const botDir = path.join(root, "bot");
const { slots } = JSON.parse(readFileSync(path.join(botDir, "slots.json"), "utf8"));
let same = 0, bundles = 0;
slots.forEach(function (s) {
    const b = bundle(botDir, s.file);
    if (b.files.length > 1) { bundles++; return; }
    const file = readFileSync(path.join(botDir, s.file), "utf8").replace(/\r\n/g, "\n");
    if (b.code === file) same++;
    else check(false, s.file + " single file but not uploaded as it is");
});
check(same + bundles === slots.length, `slots.json: ${same} single files uploaded as they are, ${bundles} bundles`);

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
