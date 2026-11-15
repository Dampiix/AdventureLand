"use strict";

const characters = Object.freeze({
    DampiixWar: Object.freeze({ name: "DampiixWar", role: "warrior" }),
    Dampiiix: Object.freeze({ name: "Dampiiix", role: "mage" }),
    DampiixPri: Object.freeze({ name: "DampiixPri", role: "priest" }),
    DampiixMerch: Object.freeze({ name: "DampiixMerch", role: "merchant" })
});

module.exports = Object.freeze({
    leaderName: "DampiixWar",
    characters: characters,
    getCharacter: function (name) {
        return characters[name] || null;
    }
});
