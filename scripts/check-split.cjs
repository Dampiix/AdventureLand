// Mechanical check for a split module (module plan, stage 4b/4c): every top-level function of the old single file must
// be in exactly one of the new files, and its text - with the shared-state prefix removed ("tgt.") and "deps." read back
// as "ctx." - must equal the old text. The top-level statements must be in the facade in the old order the same way.
// Run: node scripts/check-split.cjs <old file> <state prefix> <facade> <part files...>
const fs = require("fs");
const [oldFile, prefix, facadeFile, ...partFiles] = process.argv.slice(2);
function items(file) {
    const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n");
    const fns = {}, stmts = [];
    let cur = null;
    const flush = () => { if (!cur) return; const text = cur.lines.join("\n").replace(/\s+$/, ""); if (cur.name) fns[cur.name] = text; else stmts.push(text); cur = null; };
    for (const l of lines) {
        if (/^    \/\//.test(l) || l.trim() === "") { if (cur) cur.lines.push(l); continue; }
        if (/^    \S/.test(l) && !/^    [}\])]/.test(l)) {
            flush();
            const m = /^    function (\w+)\(/.exec(l);
            cur = { name: m ? m[1] : null, lines: [l] };
            continue;
        }
        if (/^\S/.test(l)) { flush(); continue; }
        if (cur) cur.lines.push(l);
    }
    flush();
    // strip trailing comment lines of each item (they belong to the next one in the other file's layout)
    const strip = t => t.split("\n").filter(l => !/^\s*\/\//.test(l) && l.trim() !== "").join("\n");
    Object.keys(fns).forEach(k => { fns[k] = strip(fns[k]); });
    return { fns, stmts: stmts.map(strip).filter(Boolean) };
}
const norm = t => t.split(prefix + ".").join("").replace(/(?<![\w.$])deps\./g, "ctx.");
const old = items(oldFile);
const seen = {};
let bad = 0;
partFiles.forEach(f => {
    const it = items(f);
    Object.keys(it.fns).forEach(n => {
        if (seen[n]) { console.log("TWICE " + n + " in " + seen[n] + " and " + f); bad++; }
        seen[n] = f;
        if (!(n in old.fns)) { console.log("NEW function " + n + " in " + f); bad++; return; }
        if (norm(it.fns[n]) !== old.fns[n]) {
            bad++;
            const a = old.fns[n].split("\n"), b = norm(it.fns[n]).split("\n");
            const i = a.findIndex((l, k) => l !== b[k]);
            console.log("DIFF " + n + " (" + f + ") line " + i + ":\n  old " + a[i] + "\n  new " + b[i]);
        }
    });
});
Object.keys(old.fns).forEach(n => { if (!seen[n]) { console.log("MISSING " + n); bad++; } });
// statements: the old ones (without the alias declarations the facade replaces) vs the facade's, in order
const fac = items(facadeFile);
const decl = /^    (?:let|const) /;
const oldStmts = old.stmts.map(s => s.replace(decl, "    "));
const facStmts = fac.stmts.map(s => norm(s)).filter(s => !/^    (?:const|let) /.test(s) && !/^    (?:return|PARTS\.forEach)/.test(s));
const missing = oldStmts.filter(s => !facStmts.includes(s));
// the old alias declarations (config.targeting, ctx.comms, ...) are expected to be "missing": print them for review
console.log("functions: " + Object.keys(seen).length + " of " + Object.keys(old.fns).length + ", statements in the facade: " +
    (oldStmts.length - missing.length) + " of " + oldStmts.length + " (not found, expected: the alias declarations):");
missing.forEach(s => console.log("  " + s.split("\n")[0].trim()));
const order = oldStmts.filter(s => facStmts.includes(s)).map(s => facStmts.indexOf(s));
const inOrder = order.every((v, i) => i === 0 || v > order[i - 1]);
console.log("statement order kept: " + inOrder);
console.log(bad || !inOrder ? "FAILED (" + bad + ")" : "all functions identical");
process.exit(bad || !inOrder ? 1 : 0);
