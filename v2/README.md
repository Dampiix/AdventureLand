# AdventureLand Bot V2

V2 is a clean rewrite of the AdventureLand bot. The legacy implementation under `codes/` remains untouched and serves only as the behavioral specification for future parity work.

## Current scope

This directory contains an inert runtime foundation: explicit character/role configuration, runtime identity, logging, in-memory locks, a non-overlapping scheduler, defensive character messaging, a centralized movement interface, and empty role lifecycles. Starting V2 performs no movement, combat, skill use, purchasing, inventory work, or other gameplay automation.

## Layout

- `config/` contains character identity and minimal runtime settings.
- `core/` contains context, logging, locks, and scheduling.
- `services/` owns cross-character communication and the future movement gateway.
- `roles/` contains the common `initialize`/`shutdown` role lifecycle.
- `main.js` resolves the current character, assembles the runtime, and starts it safely.

Modules export values or factories through `module.exports` and use structured source references such as `require_code("v2/core/logger")`. The `v2/` tree is the source of truth and must remain structured.

## Build and deployment

From the repository root, generate the Adventure Land deployment artifacts with:

```powershell
cd D:\AdventureLand
.\scripts\build-v2.ps1
```

The script rebuilds `dist/`, flattens source paths into Adventure Land CODE slot names, and rewrites V2 module references in the generated files. For example:

```text
v2/core/logger.js -> dist/v2_core_logger.js
```

Within generated artifacts, `require_code("v2/core/logger")` becomes `require_code("v2_core_logger")`. Deploy the generated files from `dist/` and start the `v2_main` slot. Never manually edit generated files under `dist/`; make changes under `v2/` and rebuild instead.

Re-running `v2_main` shuts down the previous V2 runtime before attaching a new listener or scheduler.

## Architectural rules

Use public CODE APIs only. Cross-character messages go through `send_cm()` and `character.on("cm", ...)`, with listener cleanup through `character.remove("cm", handler)`. Incoming CM events use `{ name, message }`; `name` is the authoritative sender and `message` contains the V2 protocol envelope. Future movement must go through the Movement Service. Long async work must use locks or non-overlapping scheduled jobs. Do not retain live entity references or inventory indexes across async work, access browser frames/DOM, emit directly on sockets, or modify V1 while building V2.
