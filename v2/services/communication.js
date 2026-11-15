"use strict";

module.exports = function createCommunication(options) {
    const context = options.context;
    const logger = options.logger;
    const protocol = context.settings.communication.protocol;
    const version = context.settings.communication.version;
    const handlers = new Map();
    let listener = null;

    function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function onMessage(data) {
        if (!isObject(data) || !isObject(data.message)) return;

        const message = data.message;
        if (message.protocol !== protocol) return;
        if (message.version !== version || typeof message.type !== "string" || !message.type) {
            logger.warn("Ignored malformed V2 CM message");
            return;
        }
        if (typeof data.name !== "string" || !data.name || !isObject(message.payload)) {
            logger.warn("Ignored malformed V2 CM envelope for type " + message.type);
            return;
        }

        const handler = handlers.get(message.type);
        if (!handler) {
            logger.debug("No CM handler registered for type " + message.type);
            return;
        }

        Promise.resolve()
            .then(function () { return handler(message.payload, message, data.name); })
            .catch(function (error) { logger.error("CM handler failed: " + message.type, error); });
    }

    function initialize() {
        if (listener) return false;
        listener = onMessage;
        character.on("cm", listener);
        logger.info("Communication initialized");
        return true;
    }

    function shutdown() {
        if (!listener) return false;
        character.remove("cm", listener);
        listener = null;
        handlers.clear();
        return true;
    }

    return Object.freeze({
        initialize: initialize,
        shutdown: shutdown,
        on: function (type, handler) {
            if (typeof type !== "string" || !type || typeof handler !== "function") {
                throw new TypeError("CM handlers require a message type and function");
            }
            if (handlers.has(type)) return false;
            handlers.set(type, handler);
            return true;
        },
        off: function (type) { return handlers.delete(type); },
        send: function (recipient, type, payload) {
            if (typeof recipient !== "string" || !recipient || typeof type !== "string" || !type) {
                throw new TypeError("CM send requires a recipient and message type");
            }
            send_cm(recipient, {
                protocol: protocol,
                version: version,
                type: type,
                payload: isObject(payload) ? payload : {}
            });
        }
    });
};
