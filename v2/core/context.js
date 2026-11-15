"use strict";

module.exports = function createContext(options) {
    if (!options || !options.characterConfig || !options.settings) {
        throw new Error("Cannot create V2 context without character configuration and settings");
    }

    return Object.freeze({
        characterName: options.characterConfig.name,
        role: options.characterConfig.role,
        characterConfig: options.characterConfig,
        leaderName: options.leaderName,
        isLeader: options.characterConfig.name === options.leaderName,
        botName: options.settings.bot.name,
        version: options.settings.bot.version,
        settings: options.settings
    });
};
