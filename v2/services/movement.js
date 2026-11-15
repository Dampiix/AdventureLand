"use strict";

// This service is the sole intended gateway for future V2 movement requests.
// Creating it is inert; movement occurs only when a caller invokes a command.
module.exports = function createMovementService() {
    return Object.freeze({
        moveTo: function (x, y) { return move(x, y); },
        smartMove: function (destination) { return smart_move(destination); },
        stop: function () { return stop("move"); },
        isMoving: function () { return Boolean(character.moving); }
    });
};
