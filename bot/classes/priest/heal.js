// =====================================================================
// classes/priest/heal.js - healing: the most hurt member (or ourselves), and Party Heal (400 MP) when several members
// are hurt, one is in danger, or one - also out of sight, from its heartbeat - is below partyHealOne. The heal shares
// the attack cooldown, so it replaces an attack; the strike loop casts it the moment the cooldown ends.
// Interface: createHeal(deps, options) -> { hurtMembers(), heal(entity, whileCooling), partyHeal(hurt) }
//   hurtMembers(): visible members and ourselves with their HP ratio, most hurt first
//   heal(): true when this tick's action was used (heal cast or walking to the target); on cooldown `whileCooling`
//   partyHeal(): true when Party Heal was cast
//   deps: game, members(), partyEnabled(), strikeHeal(entity), moveToEntity(entity)
//   options: see DEFAULTS
// =====================================================================

const DEFAULTS = {
    partyHealBelow: 0.65,   // Party Heal when 2+ members are below this ...
    partyHealDanger: 0.35,  // ... or one member is below this (party only) ...
    partyHealOne: 0.5,      // ... or any member (also out of sight, from its heartbeat) is below this
};

module.exports = function createHeal(deps, options) {
    const game = deps.game;
    const o = Object.assign({}, DEFAULTS, options || {});

    function hurtMembers() {
        const me = game.me();
        const names = deps.members();
        if (!names.includes(me.name)) names.push(me.name);
        return names
            .map(function (name) {
                const entity = name === me.name ? me : game.player(name);
                if (!entity || entity.rip) return null;
                return { entity: entity, ratio: entity.hp / entity.max_hp };
            })
            .filter(Boolean)
            .sort(function (a, b) { return a.ratio - b.ratio; });
    }

    function heal(entity, whileCooling) {
        const me = game.me();
        if (game.onCooldown("heal")) {
            // The strike loop heals the moment the cooldown ends - only one we reach.
            if (whileCooling && (entity === me || game.inRange(entity, "heal"))) deps.strikeHeal(entity);
            return whileCooling; // heal shares the attack cooldown
        }
        if (entity !== me && !game.inRange(entity, "heal")) {
            if (!game.isMoving(me)) deps.moveToEntity(entity);
            return true;
        }
        deps.strikeHeal(entity);
        return true;
    }

    // A member out of our sight below partyHealOne, from its heartbeat (fresh within 15 s) - Party Heal reaches the
    // whole party wherever it is.
    function farMemberLow() {
        if (!deps.partyEnabled()) return null;
        const me = game.me();
        return deps.members().find(function (n) {
            if (n === me.name || game.player(n)) return false;
            let b = null;
            try { b = game.storageGet("bot_beat:" + n); } catch (e) { /* storage unavailable */ }
            return !!b && Date.now() - b.at < 15000 && !b.rip && typeof b.hp === "number" && b.hp < (o.partyHealOne || 0.5);
        }) || null;
    }
    function partyHeal(hurt) {
        if (!game.canCast("partyheal")) return false;
        const me = game.me();
        const wounded = hurt.filter(function (m) { return m.ratio < o.partyHealBelow; }).length;
        const danger = hurt.length && hurt[0].ratio < o.partyHealDanger;
        // One member below partyHealOne is enough (party only: solo the normal heal does it).
        const oneLow = deps.partyEnabled() && (hurt.some(function (m) { return m.entity !== me && m.ratio < (o.partyHealOne || 0.5); }) || !!farMemberLow());
        if (wounded < 2 && !(danger && deps.partyEnabled()) && !oneLow) return false;
        game.useSkill("partyheal").catch(function () {});
        return true;
    }

    return { hurtMembers: hurtMembers, heal: heal, partyHeal: partyHeal };
};
