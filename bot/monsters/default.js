// =====================================================================
// monsters/default.js - what applies to every monster (module plan "encounters: one module per monster when needed").
// A monsters/<type>.js exists only for a special case and sets just the fields that differ (monsters/monsters.js
// merges it over this). General rules - safety check, rage zones, mobbing guard - stay general and are not copied here.
// =====================================================================

module.exports = {
    // Does approaching a spawn of this monster bring the whole spawn at once?
    //   "auto"  the game's map data decides per spawn: a spawn with a rage box pulls every monster of it at once when
    //           we stand in the box (server rage_logic, every 4.2 s) - today the mummies (9) and both booboo spawns in
    //           Spooky Town, the d2 wizard and the spider instance. Other spawns of the same monster (the mummies in
    //           level3 / level4) have none and count as usual.
    //   true    the whole spawn on every spawn of it (its spawn box), even without a rage box
    //   false   never (a rage box of it is ignored by the safety check and the walls)
    wholeSpawn: "auto",
};
