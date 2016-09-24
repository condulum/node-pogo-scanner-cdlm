const Promise = require('bluebird');
const moment = require('moment');

const alasql = require('alasql');
const ipc = require('node-ipc');

const lib = require('pogobuf');
const proto = require('node-pogo-protos')

const client = new lib.Client();
const Trainer = new lib.PTCLogin();

const EventEmitter = require('events');

log(`Start.`)

ipc.config.id = 'Worker';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.connectTo('Controller');

process.on('message', data => {
  let spawn = data.spawn;
  let worker = data.worker;
  log(`Received: ${JSON.stringify(data)}`);
  client.setAuthInfo('ptc', worker.token); //get token
  client.setPosition(spawn.lat, spawn.lng); //set initial location
  client.init().then(() => {
    scanPokemon(spawn, worker);
  }).error(err => {console.log(err)});
});

function scanPokemon(spawn, worker) {
  log(`Start scanning.`)
  client.playerUpdate(); //update worker (character)

  client.getMapObjects([spawn.sid], [0]).then(cellList => { //get the objects on the map
    const cell = cellList.map_cells[0]; 
    const serverTimeStamp = cell.current_timestamp_ms;

    log(`Cell - ${JSON.stringify(cell)}`);
    log(`Catchable: ${cell.catchable_pokemons}, Wild: ${cell.wild_pokemons}`);

    if (cell.catchable_pokemons.length > 0 && cell.wild_pokemons.length > 0) {
      const pokemon_arr = alasql('SELECT * FROM ? wild LEFT JOIN ? catchable ON wild.encounter_id = catchable.encounter_id AND wild.spawn_point_id = catchable.spawn_point_id ORDER BY catchable.expiration_timestamp_ms DESC', [cell.wild_pokemons, cell.catchable_pokemons]); //Merge wild and catchable and use ORDER to prevent scheduling scan for lured pokemon

      pokemon_arr.forEach(Pokemon => { //each pokemon scanned
        getPokemonObj(Pokemon, spawn.sid, serverTimeStamp)
          .then(PokemonObj => {
            if (PokemonObj.checkIV == true) {
              return client.encounter(PokemonObj.encounter_id, PokemonObj.spawn_point_id)
            } else {
              log(`Thrown.`)
              throw null;
            }
          })
          .then(response => {
            if (response.wild_pokemon.pokemon_data != null) {
              Pokemon = response.wild_pokemon.pokemon_data;
              PokemonObj = getMoveAndIV(PokemonObj, Pokemon);
            } else {
              log(`Thrown.`)
              throw null;
            }
          }).catch(error => {
            log(`Error from getPokemonObj.\nError Details:\n${error}`);
            PokemonObj.checkIV = false;
            ipc.of.Controller.emit('PokemonData', PokemonData);
            ipc.of.Controller.emit('WorkerDone', worker);
          });
      });

    } else if (cell.catchable_pokemons.length == 0 ) {
      log(`Found Nothing.`)
      ipc.of.Controller.emit('nothing', spawn);
      ipc.of.Controller.emit('WorkerDone', worker);
    }
    process.exit(0);
  }).catch(error => {
    log(`Error from getMapObjects.\nError Details:\n${error}`);
    ipc.of.Controller.emit('WorkerDone', worker);
    throw(error);
  });
}

//HELPER FUNCTION

function getPokemonObj(Pokemon, workerScannedSpawnPointID, serverTimestamp){ //convert to pokemon object
  return new Promise(function(resolve){
    let PokemonID;
    if (Pokemon.pokemon_data != null) {
      PokemonID = Pokemon.pokemon_data.pokemon_id; 
    } else {
      PokemonID = Pokemon.pokemon_id
    }
    resolve({
      id: PokemonID,
      spawnLat: Pokemon.latitude,
      spawnLong: Pokemon.longitude,
      TTH_ms: Pokemon.time_till_hidden_ms, 
      despawnTime: Pokemon.expiration_timestamp_ms,
      spawn_point_id: Pokemon.spawn_point_id,
      encounter_id: Pokemon.encounter_id,
      workerScannedSpawnPointID: workerScannedSpawnPointID,
      serverTimestamp: serverTimestamp
    });
  })
}

function getMoveAndIV (PokemonObj, Pokemon) {
  PokemonObj.attack = Pokemon.individual_attack;
  PokemonObj.defense = Pokemon.individual_defense;
  PokemonObj.stamina = Pokemon.individual_stamina;
  PokemonObj.iv = lib.Utils.getIVsFromPokemon(Pokemon, 2).percent;
  PokemonObj.move_1 = lib.Utils.getEnumKeyByValue(proto.Enums.PokemonMove,Pokemon.move_1);
  PokemonObj.move_2 = lib.Utils.getEnumKeyByValue(proto.Enums.PokemonMove,Pokemon.move_2);  
  return PokemonObj;
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - Worker - ${msg}`);
}