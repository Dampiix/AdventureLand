// =====================================================================
// bot_comms – CODE messages between our own characters.
// Envelope: { p: PROTOCOL, t: type, d: payload }. Messages from characters
// that are not in config.characters are ignored.
// =====================================================================

const PROTOCOL = "dmpx1";

module.exports = function createComms(config, util) {
    const handlers = {};

    function trusted(name) {
        return Object.prototype.hasOwnProperty.call(config.characters, name);
    }

    function onCm(data) {
        if (!data || !trusted(data.name)) return;
        const msg = data.message;
        if (!msg || msg.p !== PROTOCOL || !handlers[msg.t]) return;
        try {
            handlers[msg.t](msg.d || {}, data.name);
        } catch (e) {
            util.log("comms", "handler " + msg.t + " failed: " + util.errReason(e), "red");
        }
    }

    const listenerId = character.on("cm", onCm);

    return {
        on: function (type, handler) { handlers[type] = handler; },
        send: function (to, type, payload) {
            return send_cm(to, { p: PROTOCOL, t: type, d: payload || {} }).catch(function (e) {
                util.log("comms", "send " + type + " to " + to + " failed: " + util.errReason(e), "red");
            });
        },
        stop: function () { character.remove(listenerId); },
    };
};
