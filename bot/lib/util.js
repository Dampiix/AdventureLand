// =====================================================================
// bot_util - the shared helpers. Since the module plan's pilot (step 2) they live in their own lib files;
// this facade re-exports exactly the old names, so every module keeps using util.xyz unchanged.
//   geometry, names, storage, status, combat-math, items, game, walking, monster-rules, team, basics
// =====================================================================

const combatMath = require("./combat-math.js");
const storage = require("./storage.js");
const monsterRules = require("./monster-rules.js");
const basics = require("./basics.js");
const team = require("./team.js");
const names = require("./names.js");
const walking = require("./walking.js");
const items = require("./items.js");
const game = require("./game.js");
const geometry = require("./geometry.js");
const status = require("./status.js");

module.exports = {
    courageOf: combatMath.courageOf,
    fearRoom: combatMath.fearRoom,
    wouldScare: combatMath.wouldScare,
    incomingDamage: combatMath.incomingDamage,
    damageTypeOf: combatMath.damageTypeOf,
    teamServer: storage.teamServer,
    heartbeat: storage.heartbeat,
    setBeatRole: storage.setBeatRole,
    journal: storage.journal,
    tooSpiky: monsterRules.tooSpiky,
    foreignOnlyBlocks: monsterRules.foreignOnlyBlocks,
    noArea: monsterRules.noArea,
    noAreaNear: monsterRules.noAreaNear,
    setNoAreaHook: monsterRules.setNoAreaHook,
    teamCycle: basics.teamCycle,
    deriveTeam: team.deriveTeam,
    shortName: names.shortName,
    daisyPos: walking.daisyPos,
    isBossKind: monsterRules.isBossKind,
    weaponPower: items.weaponPower,
    viaFirst: walking.viaFirst,
    kiteRisk: combatMath.kiteRisk,
    isDoublehand: items.isDoublehand,
    potionNames: items.potionNames,
    goldAmount: basics.goldAmount,
    hpRatio: game.hpRatio,
    teamLevel: team.teamLevel,
    damageMultiplier: combatMath.damageMultiplier,
    defenseVs: combatMath.defenseVs,
    hitMultiplier: combatMath.hitMultiplier,
    fearMult: combatMath.fearMult,
    quiet: basics.quiet,
    isHealer: combatMath.isHealer,
    spawnBoxes: geometry.spawnBoxes,
    mpLeftAfter: game.mpLeftAfter,
    attackersOnMe: combatMath.attackersOnMe,
    noteHitTaken: combatMath.noteHitTaken,
    mobbing: combatMath.mobbing,
    mobCap: combatMath.mobCap,
    mobNow: combatMath.mobNow,
    predictedHit: combatMath.predictedHit,
    hitFactor: combatMath.hitFactor,
    hitFactors: combatMath.hitFactors,
    combatStats: combatMath.combatStats,
    mpRatio: game.mpRatio,
    canCast: game.canCast,
    mainhandType: game.mainhandType,
    errReason: basics.errReason,
    status: status.status,
    currentStatus: status.currentStatus,
    log: status.log,
    xy: geometry.xy,
    distanceTo: geometry.distanceTo,
    moveToEntity: walking.moveToEntity,
    walk: walking.walk,
    bankLoaded: walking.bankLoaded,
    townChannel: walking.townChannel,
    walkToBank: walking.walkToBank,
    openStand: walking.openStand,
    isNear: geometry.isNear,
    countItem: items.countItem,
    findItemIndex: items.findItemIndex,
};
