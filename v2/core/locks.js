"use strict";

module.exports = function createLockManager() {
    const locks = new Set();

    function acquire(name) {
        if (!name || locks.has(name)) return false;
        locks.add(name);
        return true;
    }

    function release(name) {
        return locks.delete(name);
    }

    async function withLock(name, task) {
        if (typeof task !== "function") throw new TypeError("Lock task must be a function");
        if (!acquire(name)) return { acquired: false };

        try {
            return { acquired: true, value: await task() };
        } finally {
            release(name);
        }
    }

    return Object.freeze({
        isLocked: function (name) { return locks.has(name); },
        acquire: acquire,
        release: release,
        withLock: withLock,
        clear: function () { locks.clear(); }
    });
};
