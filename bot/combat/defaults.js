// Defaults of combat/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
module.exports = {
    // Damage meter: every everyMs the leader (or a solo fighter) logs each member's damage/s over windowMs ("/dps": now).
    meter: { everyMs: 5 * 60 * 1000, windowMs: 5 * 60 * 1000 },

    tickMs: 250,

    combat: {
        // Drink a potion when the damage coming at us reaches this share of our HP (combat/potions.js).
        dangerShare: 1,
        // Kiting (fighter.kiteStep): outranging (by margin px) a slower attacker (charge <= maxSpeedRatio x our speed), we
        // circle it at charge + range + extra px. anchorRadius / farmAnchorMargin: stay near the spawn (boss / normal).
        // farmRisk: a kiteable monster still counts with this share of its damage in the farm checks.
        kite: { enabled: true, margin: 30, extra: 50, rangeSlack: 10, slack: 15, maxSpeedRatio: 0.99, anchorRadius: 280, farmAnchor: true, farmAnchorMargin: 250, everyMs: 250, avoidRadius: 120,
            foreignMargin: 50, // kite/escape/spacing points stay this far beyond the reach of other kinds
            farmRisk: 0.25, farmSpeedRatio: 0.9, farmRangeMargin: 50 },
        potionHpBelow: 0.8,      // below this: an HP potion on every cooldown
        potionMpBelow: 0.5,      // below this MP comes before the HP top-up (HP above half)
        mpFirstAboveHp: 0.65,    // MP before the HP top-up only above this HP
        hpWhenFits: true,        // solo: an HP potion whenever a whole one fits, MP in the gaps
        potionWhenMissing: true, // otherwise drink as soon as a whole potion's worth is missing (HP before MP)
        // passThrough: on the way, leave slower attackers of other kinds behind (above minHp, outside spotRadius).
        // withHealer: potion rules near a priest; losing fastLossPerSec of max HP per second switches back to solo rules.
        passThrough: { enabled: true, minHp: 0.5, speedShare: 0.8, spotRadius: 400, leaveAfterMs: 60 * 1000 },
        withHealer: { potionHpBelow: 0.6, potionWhenMissing: false, fastLossPerSec: 0.06 },
        mpTopUp: 0.5,            // MP: drink as soon as this share of an MP potion is missing
        hpCriticalBelow: 0.3,    // below this HP an HP potion always comes first
        // Solo: after a fight below hpBelow HP or mpBelow MP, pull nothing new and drink up to hpUntil / mpUntil first.
        recover: { enabled: true, hpBelow: 0.5, mpBelow: 0.5, hpUntil: 0.8, mpUntil: 0.8, maxMs: 90 * 1000 },
    },

    potions: {
        hp: "auto",       // "auto": small potions until the pool is big enough, then big ones
        mp: "auto",
        bigFrom: { hp: 1500, mp: 1000 }, // max HP / max MP from which hpot1 / mpot1 are used
        target: 300,       // fighters get topped up to this many of each
        requestBelow: 100, // ask the merchant for more below this
        selfBuyBelow: 20,  // walk to town and buy yourself below this (merchant missing)
    },
};
