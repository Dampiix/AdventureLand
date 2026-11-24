#!/usr/bin/env node
// =====================================================================
// Deploy bot/ files into their in-game CODE slots via the Adventure Land
// JSON API (https://adventure.land/mcp_api).
//
// Usage (from the repo root):
//   node scripts/deploy-bot.mjs              # upload files that differ from the slot
//   node scripts/deploy-bot.mjs --dry-run    # only show what would change
//   node scripts/deploy-bot.mjs --pull       # copy slots that were edited in game into the repo
//   node scripts/deploy-bot.mjs --force      # upload even over in-game edits
//   node scripts/deploy-bot.mjs --account viz  # another account: token from ADVENTURELAND_TOKEN_VIZ
//
// Safety: scripts/.deploy-state.json remembers what was last deployed per
// slot. If a slot changed in game since then, it is NOT overwritten –
// run --pull first (or --force to discard the in-game edit).
//
// The account token is read from ADVENTURELAND_TOKEN (or ADVENTURELAND_TOKEN_<ACCOUNT> with
// --account <name>) and never printed. Each account keeps its own deploy state file.
// =====================================================================

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.mjs";

const API = "https://adventure.land/mcp_api/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const botDir = path.join(root, "bot");
const argv = process.argv.slice(2);
const args = new Set(argv);
const accountAt = argv.indexOf("--account");
const account = accountAt >= 0 ? String(argv[accountAt + 1] || "").toLowerCase() : "";
const statePath = path.join(root, "scripts", account ? ".deploy-state." + account + ".json" : ".deploy-state.json");
const dryRun = args.has("--dry-run");
const pull = args.has("--pull");
const force = args.has("--force");

const tokenVar = account ? "ADVENTURELAND_TOKEN_" + account.toUpperCase() : "ADVENTURELAND_TOKEN";
const token = process.env[tokenVar];
if (!token) {
    console.error(tokenVar + " is not set.");
    process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.replace(/\r\n/g, "\n");
const hash = (s) => createHash("sha256").update(normalize(s)).digest("hex");

async function call(method, body) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch(API + method, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, ...body }),
        });
        const data = await res.json().catch(() => ({ failed: true, reason: "invalid_json", status: res.status }));
        const limited = res.status === 429 || data.reason === "rate_limited" || data.reason === "code_rate_limited";
        if (!limited) return data;
        await sleep((data.retry_after_ms || 2000) + 250);
    }
    return { failed: true, reason: "still_rate_limited" };
}

let state = {};
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch { state = {}; }

const { slots } = JSON.parse(await readFile(path.join(botDir, "slots.json"), "utf8"));
const counts = { uploaded: 0, unchanged: 0, pulled: 0, conflict: 0, failed: 0 };

for (const entry of slots) {
    const file = path.join(botDir, entry.file);
    // A slot may be built from several files (scripts/bundle.mjs, module plan pilot): the entry plus every file it
    // loads with a relative require. An entry without such requires is uploaded exactly as it is.
    let built;
    try { built = bundle(botDir, entry.file); } catch (e) {
        counts.failed++;
        console.log(`FAILED        ${entry.file}: ${e.message}`);
        continue;
    }
    const local = built.code;
    const bundled = built.files.length > 1;
    const label = `${entry.file.padEnd(20)} slot ${String(entry.slot).padStart(3)} ${entry.name}` + (bundled ? ` (bundle of ${built.files.length} files)` : "");
    const remote = await call("get_code", { slot: String(entry.slot) });
    const remoteCode = remote.success && remote.code ? normalize(remote.code.code || "") : null;
    const remoteHash = remoteCode === null ? null : hash(remoteCode);
    const known = state[entry.slot];
    const editedInGame = remoteHash !== null && known && remoteHash !== known && remoteHash !== hash(local);

    if (remoteCode !== null && remoteCode === local) {
        state[entry.slot] = remoteHash;
        counts.unchanged++;
        continue;
    }

    if (pull) {
        // A bundle can't be pulled back into its source files: edit those in the repo.
        if (bundled && (editedInGame || (!known && remoteCode !== null))) {
            counts.conflict++;
            console.log(`NOT PULLED    ${label} - a bundle; make the change in its source files`);
            continue;
        }
        if (editedInGame || (!known && remoteCode !== null)) {
            if (!dryRun) {
                await writeFile(file, remoteCode);
                state[entry.slot] = remoteHash;
            }
            counts.pulled++;
            console.log(`pulled        ${label} (v${remote.code.version})`);
        }
        continue;
    }

    if (editedInGame && !force) {
        counts.conflict++;
        console.log(`CHANGED IN GAME ${label} (v${remote.code.version}) – not overwritten, run --pull first`);
        continue;
    }

    if (dryRun) {
        console.log(`would upload  ${label}`);
        continue;
    }

    const result = await call("save_code", { slot: String(entry.slot), name: entry.name, code: local });
    if (result.success) {
        state[entry.slot] = hash(local);
        counts.uploaded++;
        console.log(`uploaded      ${label} (v${result.code && result.code.version})`);
    } else {
        counts.failed++;
        console.log(`FAILED        ${label}: ${result.reason || JSON.stringify(result)}`);
    }
}

if (!dryRun) await writeFile(statePath, JSON.stringify(state, null, 2) + "\n");

console.log(`\n${counts.uploaded} uploaded, ${counts.unchanged} unchanged, ${counts.pulled} pulled, ${counts.conflict} changed in game, ${counts.failed} failed.`);
if (counts.uploaded) console.log("Saving a slot does not change running CODE - restart bot_main to load the new version.");
process.exit(counts.failed || counts.conflict ? 1 : 0);
