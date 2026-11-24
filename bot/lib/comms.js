// =====================================================================
// bot_comms – CODE messages between our own characters.
// Envelope: { p: PROTOCOL, t: type, d: payload }. Messages from characters
// that are not in config.characters are ignored.
//
// Direct delivery (team view step 2, docs/architecture/team-view.md): a recipient that runs in our client (its team view
// entry is fresh and offers actions.deliver) gets the message handed over directly - no server, no call cost, nothing
// lost - as JSON text like over the network (the receiver parses it in its own frame), right after the code that sent
// it (a microtask, so the order stays as over the network). Every other recipient gets it through the game server as
// before. Decided per message and recipient; the journal notes when a
// recipient switches between the two ways.
// =====================================================================

const PROTOCOL = "bot1";
const createTeamView = require("../team/team-view.js");

module.exports = function createComms(config, util) {
    const handlers = {};
    const teamView = createTeamView(); // read only: who runs in our client
    const way = {};                    // recipient -> "direct" | "server" (the last way used, for the journal)
    const counts = { direct: 0, server: 0 };

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

    function noteWay(name, w) {
        if (way[name] === w) return;
        way[name] = w;
        util.log("party", "messages to " + name + ": " + (w === "direct" ? "direct (same client)" : "through the server"), "white");
    }
    // A teammate in our client that takes messages directly, or null.
    function local(name) {
        if (name === character.name) return null;
        try {
            const e = teamView.member(name);
            return e && e.actions && typeof e.actions.deliver === "function" ? e : null;
        } catch (x) { return null; }
    }
    function viaServer(to, type, msg) {
        return send_cm(to, msg).catch(function (e) {
            util.log("comms", "send " + type + " to " + to + " failed: " + util.errReason(e), "red");
        });
    }

    return {
        on: function (type, handler) { handlers[type] = handler; },
        send: function (to, type, payload) {
            const msg = { p: PROTOCOL, t: type, d: payload || {} };
            const names = Array.isArray(to) ? to : [to];
            const remote = [];
            names.forEach(function (n) {
                const e = local(n);
                if (!e) { remote.push(n); return; }
                // as text, like over the network: the payload as it is now, and the receiver builds its own objects
                const text = JSON.stringify(msg), from = character.name;
                counts.direct++;
                noteWay(n, "direct");
                Promise.resolve().then(function () {
                    try { e.actions.deliver(text, from); } catch (x) {
                        // the frame went away between check and delivery: through the server after all
                        util.log("comms", "direct " + type + " to " + n + " failed (" + util.errReason(x) + ") - through the server", "orange");
                        viaServer(n, type, msg);
                    }
                });
            });
            if (!remote.length) return Promise.resolve();
            remote.forEach(function (n) { counts.server++; noteWay(n, "server"); });
            return viaServer(Array.isArray(to) ? remote : remote[0], type, msg);
        },
        // A message handed over directly by a teammate in our client (its comms.send -> our team view entry's deliver).
        // The text is parsed here, in the receiver's frame, so its handlers get objects of their own realm.
        receive: function (msg, from) {
            let m = msg;
            if (typeof m === "string") { try { m = JSON.parse(m); } catch (x) { return; } }
            onCm({ name: from, message: m });
        },
        counts: function () { return { direct: counts.direct, server: counts.server }; },
        stop: function () { character.remove(listenerId); },
    };
};
