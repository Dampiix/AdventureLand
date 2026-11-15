// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!

var attack_mode=true
var farm_monster = "crab";
var party_list
var pot_stack = 200;

if(character.ctype == "merchant"){
	start_character(party_list[1], "main")
	start_character(party_list[2], "main")
	start_character(party_list[3], "main")
}


setInterval(function(){
	if(character.mp <= character.mp_cost *10)		{
		//use_hp_or_mp();
		use_skill('use_mp');
	}

	if(character.hp < character.max_hp-200)		{
		//use_hp_or_mp();
		use_skill('use_hp');
	}



	if(!attack_mode || character.rip || is_moving(character)) return;

	var target=get_targeted_monster();
	if(!target)
	{
		target=get_nearest_monster({no_target: true, type:farm_monster});
		if(target) change_target(target);
		else
		{
			set_message("No Monsters");
			return;
		}
	}

	if(!is_in_range(target))
	{
		move(
			character.x+(target.x-character.x)/2,
			character.y+(target.y-character.y)/2
			);
		// Walk half the distance
	}
	else if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);
	}

	loot();
},1000/4); // Loops every 1/4 seconds.

// Learn Javascript: https://www.codecademy.com/learn/introduction-to-javascript
// Write your own CODE: https://github.com/kaansoral/adventureland
