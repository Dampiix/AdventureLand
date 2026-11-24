// =====================================================================
// bot_bus - the team's message bus (module plan, stage 4a): how a lower module learns what a higher one knows without
// calling it (no dependency cycles). One instance per bot, made by main.js and handed to the modules that use it.
//
//   provide(name, fn) / get(name)  current state, read on demand: get calls the provider each time (null without one),
//                                  so a reader sees exactly what a direct call would have returned at that moment.
//   on(name, fn) / emit(name, data) messages, for later steps (boss found, goal reached, ...).
//
// State names in use (stage 4a):
//   boss       events: the current boss event (events.current())        read by party (leader's team goal)
//   search     events: a boss search job runs (events.searchJob())        read by party
//   manual     cave: manual rules on (cave.active())                      read by party
//   manualOwn  cave: our own /manual (cave.ownManual())                   read by party (the leader's broadcast)
//   teamWaitAt fighter: when the leader last waited for the team (ms)      read by events (a stopped walk is no failed try)
//   memberLuck fighter: the members' reported luck { name: { l, at } }   read by drops
// =====================================================================

module.exports = function createBus() {
    const providers = {};
    const handlers = {};
    return {
        provide: function (name, fn) { providers[name] = fn; },
        get: function (name) { const fn = providers[name]; return fn ? fn() : null; },
        on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
        emit: function (name, data) {
            (handlers[name] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* one listener never stops the others */ } });
        },
    };
};
