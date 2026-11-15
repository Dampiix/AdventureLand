// =====================================================================
// bot_class_mage – Mage skills.
// v1 keeps the mage on basic attacks (long range, high damage).
// Burst, Energize and Magiport come with the party logic in v2.
// =====================================================================

module.exports = function createMage() {
    return {
        name: "mage",
        survive: function () { return false; },
        support: function () { return false; },
        fight: function () { return false; },
    };
};
