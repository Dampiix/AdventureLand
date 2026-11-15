#!/usr/bin/env node
// =====================================================================
// Deploy bot/ files into their in-game CODE slots via the Adventure Land
// JSON API (https://adventure.land/mcp_api).
//
// Usage (from the repo root):
//   node scripts/deploy-bot.mjs              # upload files that differ from the slot
//   node scripts/deploy-bot.mjs --all        # upload every file
//   node scripts/deploy-bot.mjs --dry-run    # only show what would change
//
// The account token is read from the ADVENTURELAND_TOKEN environment
// variable and is never printed. Mapping: bot/slots.json.
// =====================================================================

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://adventure.land/mcp_api/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const botDir = path.join(root, "bot");
const args = new Set(process.argv.slice(2));
const uploadAll = args.has("--all");
const dryRun = args.has("--dry-run");

const token = process.env.ADVENTURELAND_TOKEN;
if (!token) {
    console.error("ADVENTURELAND_TOKEN is not set.");
    process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (s) => s.replace(/\r\n/g, "\n");

// POST one API method, waiting and retrying when rate limited.
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

const { slots } = JSON.parse(await readFile(path.join(botDir, "slots.json"), "utf8"));
let uploaded = 0;
let unchanged = 0;
let failed = 0;

for (const entry of slots) {
    const local = normalize(await readFile(path.join(botDir, entry.file), "utf8"));
    const label = `${entry.file.padEnd(20)} -> slot ${String(entry.slot).padStart(3)} ${entry.name}`;

    if (!uploadAll) {
        const remote = await call("get_code", { slot: String(entry.slot) });
        const same = remote.success && remote.code && remote.code.name === entry.name &&
            normalize(remote.code.code || "") === local;
        if (same) {
            unchanged++;
            continue;
        }
    }

    if (dryRun) {
        console.log(`would upload  ${label}`);
        continue;
    }

    const result = await call("save_code", { slot: String(entry.slot), name: entry.name, code: local });
    if (result.success) {
        uploaded++;
        console.log(`uploaded      ${label} (v${result.code && result.code.version})`);
    } else {
        failed++;
        console.log(`FAILED        ${label}: ${result.reason || JSON.stringify(result)}`);
    }
}

console.log(`\n${uploaded} uploaded, ${unchanged} unchanged, ${failed} failed.`);
console.log("Saving a slot does not change running CODE - restart bot_main to load the new version.");
process.exit(failed ? 1 : 0);
