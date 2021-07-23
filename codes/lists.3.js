// CODE to store all lists used in other code
game_log("LOADING LISTS");

var party_list = ["DampiixMerch","Dampiix","DampiixWar","DampiixPri" ];

var farm_monster = ["arcticbee"];
var monster_list = [farm_monster[0],
                    "goo", "crab", "bee", "croc", "armadillo", "frog",
                     "squig", "squigtoad", "snake","osnake", "arcticbee",
                     "porcupine", "minimush","bat"];

 var potion_types = ["hpot1", "mpot1"];      //types of potions to resupply

 //Items to sell to traders
var sell_list = ["whiteegg","spores",
                 "slimestaff", "hpbelt", "hpamulet", "ringsj", "mushroomstaff", "stinger",
                "wcap", "wshoes", "wattire", "wbreeches", "wgloves",
                "vitearring","vitring",
                "vitscroll"
                /*,
                "intearring", "strearring", "dexearring",
                "intring", "strring", "dexring",
                "intamulet", "stramulet", "dexamulet",
                "wbook0"*/];

//items to keep, and not send to the merchant
var keep_item_list = [potion_types[0], potion_types[1],"tracker"];

var upgradeWhitelist = {
    //ItemName, Max Level
    /*hbow: 6,
    firestaff: 6,
    fireblade: 6 */
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

