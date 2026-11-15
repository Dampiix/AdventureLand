// =====================================================================
// Learning step 01 – First farm bot (v0)
// ---------------------------------------------------------------------
// A deliberately small bot for ONE character, running in the game client.
// Saved to account CODE slot 10 ("farmbot_v0"). Start it from the CODE
// window with "Run"; "Stop" ends it at any time.
//
// Each tick, in this order:
//   1. Dead?            -> respawn
//   2. Low HP/MP?       -> Paladin self-heal or potion
//   3. Chests around?   -> loot
//   4. Pick a target    -> monsters attacking ME first, then free FARM monsters
//   5. In range?        -> attack, otherwise walk there
//   6. No target?       -> travel to the farming area
// =====================================================================

const CONFIG = {
    farm: "bee",          // monster type, see G.monsters (e.g. "goo", "bee", "crab")
    healBelow: 0.6,       // Paladin self-heal below 60% HP
    potionHpBelow: 0.4,   // HP potion only below 40% HP (self-heal is cheaper)
    potionMpBelow: 0.25,  // MP potion below 25% MP
    useSmash: false,      // Smash (380 MP) – hardly worth it against bees
    tickMs: 250,          // how often the bot thinks
};

let running = true;
let lastRespawnTry = 0;

// ---------- small helpers -------------------------------------------------

function hpRatio() { return character.hp / character.max_hp; }
function mpRatio() { return character.mp / character.max_mp; }

function canCast(skill) {
    const def = G.skills[skill];
    if (!def) return false;
    if (def.level && character.level < def.level) return false;
    if (def.mp && character.mp < def.mp) return false;
    return !is_on_cooldown(skill);
}

function status(text, color) { set_message(text, color || "white"); }

// A target is only valid while it is visible, alive and "ours".
function isValidTarget(t) {
    if (!t || !t.visible || t.dead || t.type !== "monster") return false;
    // Don't steal: if it is already fighting someone else, leave it alone.
    if (t.target && t.target !== character.name) return false;
    return true;
}

// First: who is attacking me? Then: nearest free farm monster.
function pickTarget() {
    const current = get_targeted_monster();
    if (isValidTarget(current)) return current;

    const attacker = get_nearest_monster({ target: character.name });
    if (attacker) return attacker;

    return get_nearest_monster({ type: CONFIG.farm, no_target: true });
}

// ---------- behaviours ----------------------------------------------------

function handleDeath() {
    if (!character.rip) return false;
    status("dead - waiting to respawn", "red");
    if (Date.now() - lastRespawnTry > 5000) {
        lastRespawnTry = Date.now();
        respawn().catch(() => {}); // only succeeds after the death timer ran out
    }
    return true;
}

function handleSurvival() {
    // 1. Cheapest healing first: Paladin self-heal
    if (hpRatio() < CONFIG.healBelow && canCast("selfheal")) {
        use_skill("selfheal").catch(() => {});
        return;
    }
    // 2. Potions as an emergency
    if (is_on_cooldown("use_hp")) return; // HP and MP potions share a cooldown
    if (hpRatio() < CONFIG.potionHpBelow) use_skill("use_hp").catch(() => {});
    else if (mpRatio() < CONFIG.potionMpBelow) use_skill("use_mp").catch(() => {});
}

function handleCombat() {
    const target = pickTarget();

    if (!target) {
        status("searching " + CONFIG.farm, "yellow");
        if (!is_moving(character)) smart_move(CONFIG.farm).catch(() => {});
        return;
    }

    change_target(target);

    if (!is_in_range(target)) {
        status("moving to " + target.mtype, "orange");
        if (!is_moving(character)) {
            // Direct path when possible, pathfinding otherwise (xmove does both)
            xmove(target.real_x, target.real_y);
        }
        return;
    }

    status("fighting: " + target.mtype, "green");

    if (CONFIG.useSmash && canCast("smash") && is_in_range(target, "smash")) {
        use_skill("smash", target).catch(() => {});
    }
    if (can_attack(target)) {
        attack(target).catch(() => {});
    }
}

// ---------- main loop -----------------------------------------------------
// An async loop instead of setInterval on purpose: a tick only starts once
// the previous one finished, so nothing can overlap.

async function mainLoop() {
    game_log("Farm bot v0 started - target: " + CONFIG.farm);
    while (running) {
        try {
            if (!handleDeath()) {
                handleSurvival();
                loot();
                handleCombat();
            }
        } catch (e) {
            game_log("Bot error: " + e.message, "red");
        }
        await sleep(CONFIG.tickMs);
    }
}

// Called when "Stop" is pressed
function on_destroy() {
    running = false;
    status("bot stopped", "gray");
}

mainLoop();
