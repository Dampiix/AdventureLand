//Initialize the scripts

load_code("lists");
//var party_list = ["DampiixMerch", "DampiixPri", "Dampiix", "Dampiiix"];

game_log("STARTING SCRIPTS");
load_code("main");

game_log("LOADING CHARACTERS");
initiate_code();


function initiate_code(){
	if(character.name == party_list[0]){
		start_character(party_list[1], "main");
		start_character(party_list[2], "main");
		start_character(party_list[3], "main");
	}
}