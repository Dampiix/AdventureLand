"use strict";

module.exports = function createMerchantRole(options) {
    let initialized = false;
    return Object.freeze({
        initialize: function () {
            if (initialized) return false;
            initialized = true;
            options.logger.info("Merchant role initialized");
            return true;
        },
        shutdown: function () { initialized = false; }
    });
};
