// AdventureLand V2 slot bootstrap
// Run this once from any temporary CODE slot.
// Creates the server-side V2 slots.

const v2Slots = [
    [51, "v2_config_characters"],
    [52, "v2_config_settings"],
    [53, "v2_core_context"],
    [54, "v2_core_locks"],
    [55, "v2_core_logger"],
    [56, "v2_core_scheduler"],
    [57, "v2_role_mage"],
    [58, "v2_role_merchant"],
    [59, "v2_role_priest"],
    [60, "v2_role_warrior"],
    [61, "v2_services_communication"],
    [62, "v2_services_movement"],
    [63, "v2_main"]
];

game_log(
    "[V2 BOOTSTRAP] Creating " +
    v2Slots.length +
    " code slots..."
);

let chain = Promise.resolve();

v2Slots.forEach(function (entry) {
    const slot = entry[0];
    const name = entry[1];

    chain = chain.then(function () {
        game_log(
            "[V2 BOOTSTRAP] " +
            slot +
            " -> " +
            name
        );

        return upload_code(
            slot,
            name,
            "// V2 placeholder - replace from local dist build\n"
        );
    });
});

chain
    .then(function () {
        game_log("[V2 BOOTSTRAP] Complete.");
        game_log(
            "[V2 BOOTSTRAP] Open /codes and verify v2_*.51-63.js files."
        );
    })
    .catch(function (error) {
        game_log(
            "[V2 BOOTSTRAP] FAILED: " +
            (
                error && error.message
                    ? error.message
                    : JSON.stringify(error)
            )
        );

        console.error(error);
    });
