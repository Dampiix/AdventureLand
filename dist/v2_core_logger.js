"use strict";

const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });

module.exports = function createLogger(options) {
    const characterName = options.characterName || "unknown";
    let level = normalizeLevel(options.level);

    function normalizeLevel(value) {
        const candidate = String(value || "INFO").toUpperCase();
        return Object.prototype.hasOwnProperty.call(LEVELS, candidate) ? candidate : "INFO";
    }

    function write(messageLevel, message, error) {
        if (LEVELS[messageLevel] < LEVELS[level]) return;

        let text = "[V2][" + characterName + "][" + messageLevel + "] " + String(message);
        if (error) text += " - " + (error.stack || error.message || String(error));

        if (typeof game_log === "function") game_log(text);
        else if (typeof console !== "undefined" && typeof console.log === "function") console.log(text);
    }

    return Object.freeze({
        debug: function (message, error) { write("DEBUG", message, error); },
        info: function (message, error) { write("INFO", message, error); },
        warn: function (message, error) { write("WARN", message, error); },
        error: function (message, error) { write("ERROR", message, error); },
        setLevel: function (newLevel) { level = normalizeLevel(newLevel); },
        getLevel: function () { return level; }
    });
};
