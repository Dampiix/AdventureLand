//This CODE is to automate everything the merchant has to do for now
//This is what he is supposed to do:
//1. collect gold and items from characters
//2. sell junk items to vendor
//3. exchange collected items if possible
//4. upgrade and compound items from a list to a set level


//Visit every party member once every X minutes
//after that go and do other stuff 

game_log("STARTING AUTO-MERCHANT SCRIPT");

var state = "selling";
var max_timer = 100;
var timer = max_timer;
var current_member = 1;
var collection_done = false;

load_code("upgrade_compound");

setInterval(function(){


    state_controller();

    switch(state){
         case "collecting":
            set_message("collecting", "green");
            collecting();
            //merchant_mluck();
            break;
        case "selling":
            set_message("selling", "yellow");
            selling();
            //merchant_mluck();
            break;
        case "exchanging":
            set_message("exchanging", "blue");

            //merchant_mluck();
            break;
        case "upgrading":
            set_message("upgrading", "orange");
            upgrading();
            //merchant_mluck();
            break;
    }
    timer--;   
    //game_log(timer);
},1000);

function state_controller(){
    var new_state = "selling";

    if(timer < 0 && !collection_done){
        new_state = "collecting";  
    }else if(timer < 0 && collection_done){
        timer = max_timer;
        collection_done = false;
        stop("smart");
    }
    
    if(new_state == "selling" && check_for_upgrades() != undefined && check_for_upgrades() != null){
        new_state = "upgrading";
    }
      
    if(new_state != state){
        state = new_state;
    }
}

function collecting(){
    //go to each player in the party
    party_member_loop();
}

function party_member_loop(){
    let num_members = party_list.length;
    setTimeout(function(){
        if(current_member < num_members){
            if(distance_to_point(parent.party[party_list[current_member]].x, parent.party[party_list[current_member]].y) > 200){
                if(!smart.moving){
                    smart_move(parent.party[party_list[current_member]]);     
                }
            }else{
                current_member++;
            }
        }else{
            current_member = 1;
            collection_done = true;
        }
    },5000);
}

function selling(){
    //when inventory is full, go to a vendor and sell junk
    if(distance_to_point(0, 0) > 100){
        if(!smart.moving){
            smart_move({map: "main"});
        }
    }else{
        sell_items();
    }
    
    
    
}

function exchanging(){
    //look for exchangable items, go to the npc and exchange
}

function upgrading(){
    //look for items that should be upgraded, go to the npc and upgrade them
    var upgrade_vendor_pos = {x: parent.G.maps.main.npcs[0].position[0], y: parent.G.maps.main.npcs[0].position[1], map: "main"};
    if(distance_to_point(upgrade_vendor_pos.x, upgrade_vendor_pos.y) > 100){
        if(!smart.moving){
            smart_move(upgrade_vendor_pos);
        }
    }else{
        if(!smart.moving){
            upgrade();
        }
        
    }
    
}

function merchant_mluck(){
    //give the luck buff to everyone in range
    for (m in parent.entities){

        if(parent.entities[m]  && parent.entities[m].type == "character" && !parent.entities[m].s.mluck && character.mp > G.skills.mluck.mp 
        && distance(character, parent.entities[m]) < G.skills.mluck.range && can_use("mluck")){
        //log('Buffing [' + m + "] with Merchant's Luck", 'green');
            use_skill('mluck', m);
        }
        
        
    }
}

