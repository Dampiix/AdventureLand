//CODE for AdventureLand
//autorerun

game_log("STARTING MAIN SCRIPT");
var party_list = ["DampiixMerch", "DampiixPri", "Dampiix", "Dampiiix"];

var farm_monster = ["minimush"];
var monster_list = [farm_monster[0],
 "goo", "crab", "bee", "croc", "armadillo", "squig","squigtoad", "snake","osnake", "arcticbee", "porcupine", "minimush"];

var min_potions = 5;                        //number of potions at which to buy new ones
var purchase_amount = 200;                  //amount to buy
var potion_types = ["hpot0", "mpot0"];      //types of potions to resupply
var gold_keep = 10000;                      //amount of gold to keep for buying potions

//Items to sell to traders
var sell_list = ["slimestaff", "hpbelt", "hpamulet", "ringsj", "stinger",
                 "wcap", "wshoes", "wattire", "wbreeches", "wgloves"];
//items to keep, and not send to the merchant
var keep_item_list = [potion_types[0], potion_types[1],"tracker"];

var last_respawn = null;

var state = "farm";

var party_created = false;

if(character.ctype == "merchant"){
    load_code("auto-merchant");
}
if(character.ctype == "priest"){
    load_code("priest");
}
//movement and attack loop
setInterval(function(){
    //changes and sets the state a character is in 
    state_controller();

    //decide what to do depending on the state
    switch(state){
        case "farm":
            farm();
            set_message("farming", "green");
            break;

        case "merchant_state":
            //set_message(character.gold);
            break;
        
        case "get_monsterhunt":
            get_monsterhunt();
            set_message("getting MH");
            break;

        case "monsterhunt":
            do_monsterhunt();
            set_message(character.s.monsterhunt.id);
            break;

        case "snowman":
            snowman_event();
            set_message("SNOWMAN", "blue");
            break;

        case "resupply":
            potion_run();
            set_message("resupplying", "yellow");
            break;  
    }
}, 100); //10 times per second

//Utility Loop
setInterval(function(){
    use_pots();
    create_party();
    manage_inventory();
    manage_respawn();
    loot();  
},500);


function state_controller(){
    //make farm the default state
    var new_state = null;

    if(character.ctype == "merchant" && party_created){
        new_state = "merchant_state";
    }

    //check for potions
    for(type_id in potion_types){
        var type = potion_types[type_id];
        var num_potions = num_items(type);

        if(num_potions < min_potions){
            new_state = "resupply";
            break;
        }
    }

    //potion run has priority
    if(character.ctype != "merchant" && new_state != "resupply"){
        if(parent.S.snowman != undefined){
            new_state = "snowman";
        }else if(character.s.monsterhunt && monster_list.includes(character.s.monsterhunt.id)){
            new_state = "monsterhunt";
        }else if(!character.s.monsterhunt && character.ctype != "priest" ){
            new_state = "get_monsterhunt";
        }else{
            new_state = "farm";
        }
    }

    if(state != new_state){
        state = new_state;
    }
}

function manage_respawn(){
	if (character.rip){
		if(last_respawn == null || new Date() - last_respawn >= 10000){
			respawn();
			last_respawn = new Date();
		}
		return;
	}
}

function use_pots(){

	if(character.hp < character.max_hp-200){
		//use_hp_or_mp();
		use_skill('use_hp');
	}
	if(character.mp <= character.mp_cost *10){
		//use_hp_or_mp();
		use_skill('use_mp');
	}	
}

function farm(){
	var target = find_viable_targets()[0];
	//Attack or move to target
    if (target != null) {
        if (distance_to_point(target.real_x, target.real_y) < character.range) {
            if (can_attack(target)) {
                attack(target);
            }
        }else {
            move_to_target(target);
        }
	}else{
		if (!smart.moving) {
			game_log("finding a target");
            smart_move({ to: farm_monster[0] });
        }
	}
}

//Returns an ordered array of all relevant targets as determined by the following:
////1. The monsters' type is contained in the 'farm_monsters' array.
////2. The monster is attacking you or a party member.
////3. The monster is not targeting someone outside your party.
//The order of the list is as follows:
////Monsters attacking you or party members are ordered first.
////Monsters are then ordered by distance.
function find_viable_targets() {
    var monsters = Object.values(parent.entities).filter(
        mob => (mob.target == null
                || parent.party_list.includes(mob.target)
                || mob.target == character.name)
                && (mob.type == "monster"
                && (parent.party_list.includes(mob.target)
                || mob.target == character.name))
                || farm_monster.includes(mob.mtype));

    for (id in monsters) {
        var monster = monsters[id];

        if (parent.party_list.includes(monster.target)
            || monster.target == character.name) {
            monster.targeting_party = 1;
        }else {
            monster.targeting_party = 0;
        }
    }

    //Order monsters by whether they're attacking us, then by distance.
    monsters.sort(function (current, next) {
        if (current.targeting_party > next.targeting_party) {
            return -1;
        }
        var dist_current = distance(character, current);
        var dist_next = distance(character, next);
        // Else go to the 2nd item
        if (dist_current < dist_next) {
            return -1;
        }else if (dist_current > dist_next) {
            return 1
        }else {
            return 0;
        }
    });

    return monsters;

	
}

//Returns the distance of the character to a point in the world.
function distance_to_point(x, y) {
    return Math.sqrt(Math.pow(character.real_x - x, 2) + Math.pow(character.real_y - y, 2));
}

//This function will ether move straight towards the target entity,
//or utilize smart_move to find their way there.
function move_to_target(target) {
    if (can_move_to(target.real_x, target.real_y)) {
        smart.moving = false;
        smart.searching = false;
        move(
            character.real_x + (target.real_x - character.real_x) / 2,
            character.real_y + (target.real_y - character.real_y) / 2
        );
    }
    else{
        if (!smart.moving) {
            smart_move({ x: target.real_x, y: target.real_y });
        }
    }
}

function potion_run(){
    var potion_merchant = get_npc("fancypots");
    var fancypots_pos = {x: parent.G.maps.main.npcs[5].position[0],y: parent.G.maps.main.npcs[5].position[1], map: "main"};
    var dist_to_merchant = null;

    if(potion_merchant != null){
        dist_to_merchant = distance_to_point(potion_merchant.position[0], potion_merchant.position[1]);
    }
    if (!smart.moving && (dist_to_merchant == null || dist_to_merchant > 250)){
        smart_move(fancypots_pos);
    }
    if(dist_to_merchant != null && dist_to_merchant < 250){
        buy_potions();
    }
}

//
function buy_potions(){
	if(empty_slots() > 0){
		for(type_id in potion_types){
			var type = potion_types[type_id];
			var item_def = parent.G.items[type];
			
			if(item_def != null){
		    	var cost = item_def.g * purchase_amount;
				var num_potions = num_items(type);

				if(num_potions < min_potions){
					buy_with_gold(type, purchase_amount);
				}
			}else{
				game_log("Not Enough Gold!");
			}
		}
	}else{
		game_log("Inventory Full!");
	}
}

//Returns the number of items in your inventory for a given item name;
function num_items(name){
	var item_count = character.items.filter(item => item != null && item.name == name).reduce(function(a,b){ return a + (b["q"] || 1);
	}, 0);
	
	return item_count;
}

function empty_slots(){
	return character.esize;
}

//Gets an NPC by name from the current map.
function get_npc(name){
	var npc = parent.G.maps[character.map].npcs.filter(npc => npc.id == name);
	
	if(npc.length > 0){
		return npc[0];
	}
	return null;
}

function manage_inventory(){
    send_to_merchant();
    var potion_merchant = get_npc("fancypots");
    var dist_to_merchant = null;
    if(potion_merchant != null){
        dist_to_merchant = distance_to_point(potion_merchant.position[0], potion_merchant.position[1]);
    }

    if(empty_slots() < 5){
        if(!smart.moving){
            smart_move({to: "potions"}, function(){
                sell_items();
            });
        }   
    }

    if(dist_to_merchant != null && dist_to_merchant < 250){
        sell_items();
    }

    
}

function sell_items(){
	for(let i in character.items){
		let slot = character.items[i];
		if(slot != null){
			let item_name = slot.name;
			if(sell_list.includes(item_name)){
				if(!slot.p){
					sell(i,9999);
				}
			}
		}
	}
}

//create a party at the beginning of the script
function create_party(){
    
    if(parent.party != {} &&
        parent.party[party_list[0]] != undefined &&
         parent.party[party_list[1]] != undefined &&
          parent.party[party_list[2]] != undefined &&
           parent.party[party_list[3]] != undefined){

            party_created = true;
            return;
    }

	//for the party leader
	if(character.name == party_list[0]){
		//send invites
		if(Object.keys(parent.party).length < party_list.length){
			for(let i in party_list){
				let player = party_list[i];
				if(player != party_list[0]){
					send_party_invite(player);
				}
			}
		}
	}

	//for party members
	if(!character.party){
		if(character.name != party_list[0]){
			//accept invite
			accept_party_invite(party_list[0])
		}
	
		
	}else{
		if(character.party != party_list[0]){
			//wrong party, better leave
			leave_party();
		}
	}
}

function send_to_merchant(){
	if(character.ctype != "merchant"){
		let merchant = get_player(party_list[0]);
		if(merchant != null){
			//send items to merchant
			if(character.gold > gold_keep * 2){
				send_gold(party_list[0], gold_keep);
			}

			for(let i in character.items){
				let item = character.items[i];
				if(item){
					if(!keep_item_list.includes(item.name)){
						//send items to merchant
						var slot = locate_item(item.name);
						send_item(party_list[0], slot, 9999);
					}
				}
			}
		}
	}
}

function do_monsterhunt(){
    if(character.ctype == "merchant") return;
    var monster_hunter_location = {x: parent.G.maps.main.npcs[23].position[0],y: parent.G.maps.main.npcs[23].position[1], map:"main"};

    if(character.s.monsterhunt){
        //Are there hunt monsters left to kill?
        if(character.s.monsterhunt.c > 0){
            //needs more killing
            var hunt_type = character.s.monsterhunt.id;

            //Is the Monster on the List?
            if(monster_list.includes(hunt_type)){
                var hunt_target = get_nearest_monster({type: hunt_type});
                var target = get_targeted_monster();

                if(!target){
                    if(hunt_target){
                        change_target(hunt_target);
                    }else{
                        if(!smart.moving){
                            smart_move({to: hunt_type});
                        }
                    }
                }else{
                    if (distance_to_point(target.real_x, target.real_y) < character.range) {
                        if (can_attack(target)) {
                            attack(target);
                        }
                    }
                    else {
                        move_to_target(target);
                    }
                }
            }
        }else{
            //done, turn in quest
            if(!smart.moving){
                smart_move(monster_hunter_location,function(){
                    parent.socket.emit("monsterhunt");
                });
            }
        }
    }
}

function get_monsterhunt(){
    //go get a quest from daisy
    var monster_hunter_location = {x: parent.G.maps.main.npcs[23].position[0],y: parent.G.maps.main.npcs[23].position[1], map:"main"};

    if(!smart.moving){
        smart_move(monster_hunter_location,function(){
            parent.socket.emit("monsterhunt");
            setTimeout(function(){
                parent.socket.emit("monsterhunt");
            }, character.ping);
        });
    }
}

function snowman_event(){
    var snowman_map = parent.S.snowman.map;
    var snowman_location = {x: parent.S.snowman.x, y: parent.S.snowman.y, map: parent.S.snowman.map}

	var snowman = get_nearest_monster({type: "snowman"});
	var target = get_targeted_monster();

    if (character.ctype == "merchant") return;
    if(!target){
        if(snowman){
            change_target(snowman);
        }else{
            if(!smart.moving){
                smart_move(snowman_location)
            }
        }
    }else{
        if (distance_to_point(target.real_x, target.real_y) < character.range) {
            if (can_attack(target)) {
                attack(target);
            }
        }
        else {
            move_to_target(target);
        }
    }
}

