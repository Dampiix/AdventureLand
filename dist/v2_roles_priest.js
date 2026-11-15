"use strict";

module.exports = function createPriestRole(options) {
    let initialized = false;
    return Object.freeze({
        initialize: function () {
            if (initialized) return false;
            initialized = true;
            options.logger.info("Priest role initialized");
            return true;
        },
        shutdown: function () { initialized = false; }
    });
};
