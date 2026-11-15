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
//
// Safety: scripts/.deploy-state.json remembers what was last deployed per
// slot. If a slot changed in game since then, it is NOT overwritten –
// run --pull first (or --force to discard the in-game edit).
//
// The account token is read from ADVENTURELAND_TOKEN and never printed.
// =====================================================================

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://adventure.land/mcp_api/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const botDir = path.join(root, "bot");
const statePath = path.join(root, "scripts", ".deploy-state.json");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const pull = args.has("--pull");
const force = args.has("--force");

const token = process.env.ADVENTURELAND_TOKEN;
if (!token) {
    console.error("ADVENTURELAND_TOKEN is not set.");
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
    const local = normalize(await readFile(file, "utf8"));
    const label = `${entry.file.padEnd(20)} slot ${String(entry.slot).padStart(3)} ${entry.name}`;
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
