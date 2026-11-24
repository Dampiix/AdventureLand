// Defaults of travel/ and the route settings of main.js (stage 7b): config.js fills these in where it has no value of
// its own (ours always win). Our own waypoints (travel.via, travel.leaveVia) stay in config.js.
module.exports = {
    // rageWalls: rage boxes (+ rageMargin px) and wallMonsters' spawn boxes are walls for path walks (not the goal's own
    // zones); rageWallSteps: margins tried in turn when no path is found (-1 = walls off).
    travel: { rageWalls: true, rageWallSteps: [100, 50, 0, -1], rageMargin: 100, wallMonsters: ["prat"] },

    // Routes (smart_move).
    movement: {
        useTown: true, // the Town skill (teleport to the map's center) where it shortens a route
        townMinDistance: 600, // ...but only from farther than this from the map's center (the route search counts Town as one step)
    },
};
