// Tests for the page-level helpers of lib/game.js: onSocket (stage 5) and hook (stage 3b).
// Run: node scripts/test-game.cjs
const path = require("path");
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok    " : "FAIL  ") + what); if (!ok) failed++; };
const game = require(path.join(__dirname, "..", "bot", "lib", "game.js"));

// onSocket: a second install takes the first listener off; another key stays; same page names as before.
const on = {}, calls = [];
globalThis.parent = { socket: {
    on: (ev, fn) => { (on[ev] = on[ev] || []).push(fn); calls.push("on " + ev); },
    off: (ev, fn) => { on[ev] = (on[ev] || []).filter(f => f !== fn); calls.push("off " + ev); },
} };
const a = () => "a", b = () => "b", c = () => "c";
game.onSocket("hit", "Hit", a);
game.onSocket("hit", "Dps", c);
game.onSocket("hit", "Hit", b);
check(on.hit.length === 2 && on.hit.includes(b) && on.hit.includes(c) && !on.hit.includes(a), "onSocket: a reload swaps the listener, another key stays");
check(parent.__botHitFn === b && parent.__botDpsFn === c, "onSocket: kept on the page as __bot<Key>Fn");
check(calls.join(",") === "on hit,on hit,off hit,on hit", "onSocket: off before on, nothing to take off the first time");
let threw = false;
globalThis.parent = {};
try { game.onSocket("hit", "Hit", a); } catch (e) { threw = true; }
check(threw, "onSocket: throws without a socket (callers catch)");

// hook: wraps the original, a second install wraps the original again; once keeps the first wrapper.
globalThis.window = globalThis;
globalThis.can_move = () => "orig";
game.hook("can_move", orig => function () { return "w1(" + orig() + ")"; });
game.hook("can_move", orig => function () { return "w2(" + orig() + ")"; });
check(can_move() === "w2(orig)", "hook: a second install wraps the original, not the wrapper");
globalThis.smart_move = () => "sm";
game.hook("smart_move", orig => () => "x(" + orig() + ")", true);
game.hook("smart_move", orig => () => "y(" + orig() + ")", true);
check(smart_move() === "x(sm)", "hook once: the first wrapper stays");

console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
