// CODE to store all lists used in other code
game_log("LOADING LISTS");

var party_list = ["DampiixWar","Dampiiix","DampiixPri","DampiixMerch" ];

var farm_monster = ["cgoo"];
var monster_list = [farm_monster[0],
                    "goo", "crab", "bee", "croc", "armadillo", "frog",
                     "squig", "squigtoad","osnake", "snake", "arcticbee",
                     "porcupine", "minimush","bat","goldenbat"];

 var potion_types = ["hpot1", "mpot1"];      //types of potions to resupply

 //Items to sell to traders
var sell_list = ["whiteegg","spores",
                 "slimestaff", "hpbelt", "hpamulet", "ringsj", "mushroomstaff", "stinger",
                "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
                "vitearring","vitring",
                "vitscroll",
                "stramulet", "dexamulet","bwing",
                "coat","gloves","shoes","pants","helmet"
                /*,
                "intearring", "strearring", "dexearring",
                "intring", "strring", "dexring",
                "intamulet", "stramulet", "dexamulet",
                "wbook0"*/];

//items to keep, and not send to the merchant
var keep_item_list = [potion_types[0], potion_types[1],"tracker"];

var upgradeWhitelist = {
    //ItemName, Max Level
    t2bow: 6,
    sword: 4,
    pmace: 6,
    crossbow: 6,
    basher: 6



};

var combineWhitelist = {
    //ItemName, Max Level
    intamulet: 1,
    stramulet: 1,
    dexamulet: 1,
    vitamulet: 1,
    intring: 1,
    dexring: 1,
    strring: 1,
    vitring: 1

}

