// Defaults of roles/workshop/ (stage 7b): config.js fills these in where it has no value of its own (ours always win).
// Our risk floors, budgets, item lists, gear goals, compound / exchange choices and grace fodder stay in config.js.
module.exports = {
    workshop: {
        enabled: true,
        // Cheapest scroll per step by expected gold; a +0 copy no shop sells is valued at max(drop hours x gold/h, game
        // value x valueFactor), else unknownValue.
        scrollChoice: { enabled: true, valueFactor: 3, unknownValue: 1000000 },
        dropNeverHours: 1000, // a drop slower than this per copy has no known own cost (no buy order at own cost)
        massSkills: true,             // Mass Production / Mass Exchange before upgrades and exchanges
        mainStatOnArmor: true,        // wished armor always gets the class's main stat scroll
        deliveryBatchMs: 10 * 60 * 1000, // finish the open wishes first; a ready item waits at most this long
        giveUpForMs: 60 * 60 * 1000,  // after a stop (risk/no source/wish budget used up) retry in an hour
        onlineMs: 10 * 60 * 1000,     // only fighters with a heartbeat fresher than this are planned for
        // Items with a stat slot go out with the receiver's main stat; these scrolls skip the pots up to maxCost.
        statOnDelivery: { enabled: true, maxCost: 100000 },
        retryAfterBudgetMs: 10 * 60 * 1000, // ...but only 10 min when we merely lack gold right now (or the bag is full)
        bagReserve: 2,                // copies come out of the bank only while this many bag slots stay free
        bankScanEveryMs: 10 * 60 * 1000,
        // Value report: logs gain, cost and gain per hour of every open wish; orderWishes: work on open wishes by value.
        valueReport: { enabled: true, everyMs: 15 * 60 * 1000, top: 6, orderWishes: true },
        // Bases of a wished drop/craft are bought until their chances add up to baseTargetPieces finished pieces.
        baseTargetPieces: 1,
        maxBaseCopies: 20,
        redeliverAfterMs: 6 * 60 * 60 * 1000, // don't fulfil the same wish for a fighter again within 6 h
        // Grace farming: cheap shop items are failed at a level to raise the grace before a risky compound/rare step.
        grace: {
            minLevel: 4,             // only for steps to +4 and higher
            // Gold per target level per 24 h: incomeShare of the merchant's net income, at least budgetPerLevel.
            incomeShare: 0.05,
            budgetPerLevel: 300000,
            maxAttempts: 25,         // fodder attempts per farming round
            // Stop once the fodder's own chance at the target level is above this (now or with the stacks still needed).
            maxFodderChance: 0.5,
            batch: 5,                // helmets prepared at once, then attempted back to back
        },
        // Drop weapons that beat a fighter's worn one are delivered or upgraded until they do.
        betterWeapons: {
            enabled: true,
            margin: 0.03,   // at least 3% stronger than the worn weapon
        },
        // Bonus wishes (no measurable gain, e.g. the priest's Wanderer set): one unit of work every everyMs.
        bonusWishes: { everyMs: 3 * 60 * 1000 },
        gearGoals: {
            enabled: true,
            fromLevel: 0,
            everyMs: 3 * 60 * 1000,   // one gear-goal step this often even while wishes are open
        },
        compound: {
            auto: true,   // combine spare accessories/books when no wish is open
            tidyMaxCost: 50000,       // an auto-compound step costing at most this never waits for a pot
        },
        exchange: {
            enabled: true,
            onDemandBatch: 3, onDemandBankFree: 10, // opened a few at a time and while the bank has room
            batch: 10,     // exchanges per round, so deliveries are not delayed for long
            keepFree: 8,   // stop while fewer bag slots are free (rewards need room)
        },
    },
};
