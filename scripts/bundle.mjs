// =====================================================================
// Bundles one CODE slot from several source files (module plan, pilot step 1).
//
// A slot's entry file may load other bot files with a relative require:
//     const createBlink = require("./blink.js");
// The game has no such require (only require_code by slot name), so the deploy
// script puts the entry and every file it requires into one slot:
//   - each file becomes a function in a small module table, its relative
//     requires point into that table, every file runs once (no cycles allowed);
//   - each part starts with "// ---- <path>" so an error in the game log can be
//     traced back to its source file;
//   - an entry without relative requires is uploaded exactly as it is.
// The source files stay plain CommonJS (module.exports, require("./x.js")), so
// they also run in Node (tests, later the headless client).
//
// CLI (from the repo root):
//   node scripts/bundle.mjs classes/mage/mage.js            # prints the bundle
//   node scripts/bundle.mjs classes/mage/mage.js --files    # lists its files
// =====================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOCAL_REQUIRE = /require\(\s*(["'])(\.{1,2}\/[^"']+)\1\s*\)/g;

const normalize = (s) => s.replace(/\r\n/g, "\n");
const rel = (botDir, abs) => path.relative(botDir, abs).split(path.sep).join("/");

function resolveFrom(fromAbs, spec) {
    let p = path.resolve(path.dirname(fromAbs), spec);
    if (!p.endsWith(".js")) p += ".js";
    return p;
}

// { code, files } for the slot whose entry is `entry` (a path relative to botDir).
export function bundle(botDir, entry) {
    const entryAbs = path.resolve(botDir, entry);
    const sources = new Map(); // id -> source with its relative requires rewritten
    const order = [];
    const visiting = new Set();

    function visit(abs, chain) {
        const id = rel(botDir, abs);
        if (sources.has(id)) return id;
        if (visiting.has(id)) throw new Error("require cycle: " + chain.concat(id).join(" -> "));
        visiting.add(id);
        let src;
        try { src = normalize(readFileSync(abs, "utf8")); } catch (e) {
            throw new Error("cannot read " + id + (chain.length ? " (required by " + chain[chain.length - 1] + ")" : ""));
        }
        // A fresh regex per file: visit() recurses from inside the replace callback.
        const rewritten = src.replace(new RegExp(LOCAL_REQUIRE.source, "g"), function (match, quote, spec) {
            const dep = visit(resolveFrom(abs, spec), chain.concat(id));
            return "__botRequire(" + JSON.stringify(dep) + ")";
        });
        visiting.delete(id);
        sources.set(id, rewritten);
        order.push(id);
        return id;
    }

    const entryId = visit(entryAbs, []);
    if (order.length === 1) return { code: normalize(readFileSync(entryAbs, "utf8")), files: order };

    const parts = [
        "// bundle of " + entryId + " - " + order.length + " files, built by scripts/bundle.mjs.",
        "// Edit the source files in the repo, not this slot.",
        "module.exports = (function () {",
        "var __botFiles = {}, __botCache = {};",
        "function __botRequire(id) {",
        "    if (__botCache[id]) return __botCache[id].exports;",
        "    var m = { exports: {} };",
        "    __botCache[id] = m;",
        "    __botFiles[id](m, m.exports);",
        "    return m.exports;",
        "}",
    ];
    order.forEach(function (id) {
        parts.push("", "// ---- " + id, "__botFiles[" + JSON.stringify(id) + "] = function (module, exports) {", sources.get(id), "};");
    });
    parts.push("", "return __botRequire(" + JSON.stringify(entryId) + ");", "})();", "");
    return { code: parts.join("\n"), files: order };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const entry = process.argv[2];
    if (!entry) {
        console.error("usage: node scripts/bundle.mjs <entry relative to bot/> [--files]");
        process.exit(1);
    }
    const out = bundle(path.join(root, "bot"), entry);
    if (process.argv.includes("--files")) console.log(out.files.join("\n"));
    else process.stdout.write(out.code);
}
