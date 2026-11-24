// =====================================================================
// classes/mage/team-port.js - Team Magiport: one rule for every team goal (a farm spot, a boss, Daisy, ...), whoever
// leads. The leader sets the goal, everyone walks there on its own path, and once WE are there we pull every team
// fighter still farther than minDist px (or on another map) to us - the tank first, then in the team's order. 900 MP
// each, only while keepMp of our MP stays; at most `tries` per member and goal, retryMs apart.
//   there: a farm spot or Daisy - as the members' "there" (atGoal); a boss - in our sight within bossRange px for
//          graceMs (map changes and entities settle first).
//   never: under the manual rules, without a goal, during a boss search (a find becomes the leader's boss goal).
// A member we saw within minDist px while we were at the goal has been there: not pulled again for this goal. Party
// positions lag behind: a member we can see counts by its live position, one we can't see by its live position from the
// team view (memberPos, when it runs in our client) or else its party info.
// The journal (tag party) says why we don't pull someone on another map, at most every 30 s.
// Interface: createTeamPort(deps, options) -> { tick() }
//   deps: game, log, errReason, distanceTo, partyEnabled(), members(), teamGoal(), atGoal(goal), goalLabel(goal),
//         manual(), searchActive() -> our own boss search runs, fighters() -> team fighter names, tankClasses(),
//         memberPos(name) -> { map, x, y, rip, type } live from the team view, or null (optional)
//   options: see DEFAULTS
// Works for any class that has the skill.
// =====================================================================

const DEFAULTS = {
    enabled: true,
    keepMp: 0.3,      // MP share kept after each port
    minDist: 600,     // members farther than this (or on another map) are pulled
    bossRange: 800,   // a boss goal counts as reached with the boss in sight this close ...
    graceMs: 4000,    // ... for this long
    tries: 3,         // per member and goal
    retryMs: 8000,    // between two tries
};

module.exports = function createTeamPort(deps, options) {
    const game = deps.game;
    const mpc = Object.assign({}, DEFAULTS, options || {});
    const portTries = {};  // member -> { goal, n, at }
    const portSeen = {};   // goal id -> { member: true } - members seen at the goal with us
    let portBusy = false, portBoss = null, portWhyAt = 0, portLowAt = 0; // portBoss: { id, since } - the boss in our sight

    function tick() {
        const me = game.me(), G = game.data();
        if (!mpc.enabled || portBusy || me.rip || !deps.partyEnabled() || !G.skills.magiport) return;
        if (deps.manual()) return; // magiport can't enter or leave the cave; manual rules
        const g = deps.teamGoal();
        if (!g || g.kind === "search") return;
        // Our own share of a boss search without a find: no port (a find turns the goal into the boss).
        if (g.kind !== "boss" && deps.searchActive()) return;
        const info = game.partyInfo();
        const fighters = deps.fighters();
        const others = deps.members().filter(function (n) { return n !== me.name && fighters.includes(n) && info[n] && !info[n].rip; });
        if (!others.length) return;
        const label = deps.goalLabel(g);
        const why = function (r) {
            if (Date.now() - portWhyAt < 30 * 1000) return;
            const away = others.filter(function (n) { return ((deps.memberPos && deps.memberPos(n)) || info[n]).map !== me.map; });
            if (!away.length) return;
            portWhyAt = Date.now();
            deps.log("party", "magiport to " + label + " for " + away.join(", ") + " waits: " + r, "white");
        };
        // Are we there?
        if (g.kind === "boss") {
            const boss = game.nearestMonster({ type: g.name });
            if (!boss || boss.dead || deps.distanceTo(boss) > (mpc.bossRange || 800)) { portBoss = null; return why("the " + g.name + " not in my sight yet"); }
            if (!portBoss || portBoss.id !== boss.id) portBoss = { id: boss.id, since: Date.now() };
            if (Date.now() - portBoss.since < (mpc.graceMs || 4000)) return;
        } else if (!deps.atGoal(g)) {
            return why("not at " + label + " yet");
        }
        const now = Date.now();
        const seen = portSeen[g.id] || (portSeen[g.id] = {});
        const ids = Object.keys(portSeen);
        if (ids.length > 30) ids.slice(0, ids.length - 30).forEach(function (k) { delete portSeen[k]; });
        const minDist = mpc.minDist || 600;
        const waiting = [];
        const far = others.filter(function (n) {
            const p = (deps.memberPos && deps.memberPos(n)) || info[n]; // live from the team view, else party info
            const live = game.player(n);
            if (live && live.rip) return false;
            if (live && deps.distanceTo(live) <= minDist) { seen[n] = true; return false; }
            if (!live && p.map === me.map && typeof p.x === "number" && Math.hypot(p.x - me.real_x, p.y - me.real_y) <= minDist) return false;
            if (seen[n]) return false; // was here with us at this goal
            const t = portTries[n];
            if (t && t.goal === g.id && (t.n >= (mpc.tries || 3) || now - t.at < (mpc.retryMs || 8000))) { waiting.push(n); return false; }
            return true;
        });
        const tanks = deps.tankClasses();
        far.sort(function (a, b) {
            const ta = tanks.includes(info[a].type) ? 0 : 1, tb = tanks.includes(info[b].type) ? 0 : 1;
            return ta - tb || fighters.indexOf(a) - fighters.indexOf(b);
        });
        if (!far.length) {
            if (waiting.length) why("tries for " + waiting.join(", "));
            return;
        }
        const cost = G.skills.magiport.mp || 900;
        const keep = mpc.keepMp === undefined ? 0.3 : mpc.keepMp;
        if (me.mp - cost < me.max_mp * keep) {
            if (now - portLowAt > 30 * 1000) {
                portLowAt = now;
                deps.log("party", "magiport to " + label + " for " + far.join(", ") + " waits: " + Math.round(me.mp) + " MP (keeping " + Math.round(keep * 100) + " %)", "white");
            }
            return;
        }
        if (game.onCooldown("magiport")) return;
        const who = far[0];
        const prev = portTries[who];
        portTries[who] = { goal: g.id, n: prev && prev.goal === g.id ? prev.n + 1 : 1, at: now };
        portBusy = true;
        const lv = game.player(who);
        deps.log("party", "magiport " + who + " to " + label + " (" + (lv ? Math.round(deps.distanceTo(lv)) + " px away" : "on " + (((deps.memberPos && deps.memberPos(who)) || info[who]).map)) + ", try " + portTries[who].n + ")", "yellow");
        Promise.resolve(game.useSkill("magiport", who))
            .catch(function (e) { deps.log("party", "magiport " + who + ": " + deps.errReason(e), "orange"); })
            .finally(function () { portBusy = false; });
    }

    return { tick: tick };
};
