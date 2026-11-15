"use strict";

(function startV2() {
    const settings = require_code("v2_config_settings");
    const characterConfiguration = require_code("v2_config_characters");
    const createLogger = require_code("v2_core_logger");
    const createContext = require_code("v2_core_context");
    const createLocks = require_code("v2_core_locks");
    const createScheduler = require_code("v2_core_scheduler");
    const createCommunication = require_code("v2_services_communication");
    const createMovement = require_code("v2_services_movement");

    const logger = createLogger({
        characterName: character && character.name,
        level: settings.logging.level
    });
    logger.info("Starting " + settings.bot.name);

    const characterConfig = characterConfiguration.getCharacter(character && character.name);
    if (!characterConfig) {
        logger.error("Character is not configured; V2 startup aborted");
        return;
    }

    const previousRuntime = globalThis.__ADVENTURELAND_BOT_V2_RUNTIME__;
    if (previousRuntime && typeof previousRuntime.shutdown === "function") {
        previousRuntime.shutdown();
    }

    const context = createContext({
        characterConfig: characterConfig,
        leaderName: characterConfiguration.leaderName,
        settings: settings
    });
    logger.info("Role resolved: " + context.role);

    const roleFactories = {
        warrior: require_code("v2_roles_warrior"),
        mage: require_code("v2_roles_mage"),
        priest: require_code("v2_roles_priest"),
        merchant: require_code("v2_roles_merchant")
    };
    const createRole = roleFactories[context.role];
    if (!createRole) {
        logger.error("No V2 role module exists for role: " + context.role);
        return;
    }

    const locks = createLocks();
    const scheduler = createScheduler({
        logger: logger,
        defaultIntervalMs: settings.scheduler.defaultIntervalMs
    });
    const communication = createCommunication({ context: context, logger: logger });
    const movement = createMovement();
    const role = createRole({ context: context, logger: logger });
    let stopped = false;

    const runtime = Object.freeze({
        context: context,
        logger: logger,
        locks: locks,
        scheduler: scheduler,
        communication: communication,
        movement: movement,
        role: role,
        shutdown: function () {
            if (stopped) return false;
            stopped = true;
            role.shutdown();
            communication.shutdown();
            scheduler.stop();
            locks.clear();
            return true;
        }
    });

    globalThis.__ADVENTURELAND_BOT_V2_RUNTIME__ = runtime;

    try {
        communication.initialize();
        scheduler.start();
        role.initialize(context);
        logger.info("V2 startup complete");
    } catch (error) {
        runtime.shutdown();
        logger.error("V2 startup failed safely", error);
    }
}());
