"use strict";

module.exports = function createWarriorRole(options) {
    let initialized = false;
    return Object.freeze({
        initialize: function () {
            if (initialized) return false;
            initialized = true;
            options.logger.info("Warrior role initialized");
            return true;
        },
        shutdown: function () { initialized = false; }
    });
};
