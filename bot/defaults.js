// Defaults of main.js (stage 7b): config.js fills these in where it has no value of its own (ours always win).
module.exports = {
    // Member watchdog (main.js): a bot window without a heartbeat for silentMs is restarted - at most one restart per
    // gapMs and maxPerHour. A member stopped on purpose comes back too.
    watchdog: { enabled: true, silentMs: 2 * 60 * 1000, checkEveryMs: 15 * 1000, gapMs: 10 * 60 * 1000, maxPerHour: 3 },

    // Client display only (no effect headless).
    ui: {
        hideGoldLogs: true,   // drop the game's "123 gold" loot lines from the log
        hideKillLogs: true,   // drop the game's "X killed a Bee" lines
    },
};
