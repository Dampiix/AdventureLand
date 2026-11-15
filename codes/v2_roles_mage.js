"use strict";

module.exports = function createMageRole(options) {
    let initialized = false;
    return Object.freeze({
        initialize: function () {
            if (initialized) return false;
            initialized = true;
            options.logger.info("Mage role initialized");
            return true;
        },
        shutdown: function () { initialized = false; }
    });
};
