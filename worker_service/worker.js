const Promise = require('bluebird');
const moment = require('moment');

const alasql = require('alasql');
const ipc = require('node-ipc');

const lib = require('pogobuf');
const proto = require('node-pogo-protos')

const client = new lib.Client();

function randomString(length) {
  let mask = '0123456789';
  let result = '';
  for (let i = length; i > 0; --i) result += mask[Math.round(Math.random() * (mask.length - 1))];
  return result;
}

const workerName = randomString(6);

ipc.config.id = 'Worker';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.connectTo('Controller');

process.on('message', data => {
  let spawn = data.spawn;
  let worker = data.worker;
  client.setAuthInfo('ptc', worker.token); //get token
  client.setPosition(spawn.lat, spawn.lng); //set initial location
  client.init().then(() => {
    scanPokemon(spawn, worker);
  }).error(err => {console.log(err)});
});

function scanPokemon(spawn, worker) {
  log(`Start scanning.`)
  client.playerUpdate(); //update worker (character)

  client.getMapObjects([spawn.cell],[0]).then(cellList => { //get the objects on the map
    const cell = cellList.map_cells[0]; 
    const serverTimeStamp = cell.current_timestamp_ms;

    log(`Cell - ${cell.s2_cell_id} - Catchable: ${cell.catchable_pokemons.length}, Wild: ${cell.wild_pokemons.length}`);

    if (cell.catchable_pokemons.length > 0 && cell.wild_pokemons.length > 0) {
      const pokemon_arr = alasql('SELECT * FROM ? wild LEFT JOIN ? catchable ON wild.encounter_id = catchable.encounter_id AND wild.spawn_point_id = catchable.spawn_point_id ORDER BY catchable.expiration_timestamp_ms DESC', [cell.wild_pokemons, cell.catchable_pokemons]); //Merge wild and catchable and use ORDER to prevent scheduling scan for lured pokemon

      pokemon_arr.forEach(Pokemon => { //each pokemon scanned
        getPokemonObj(Pokemon, spawn.sid, serverTimeStamp, PokemonObj => {
          if (PokemonObj.checkIV == true) {
            client.encounter(PokemonObj.encounter_id, PokemonObj.spawn_point_id).then(response => {
              if (response.wild_pokemon.pokemon_data != null) {
                Pokemon = response.wild_pokemon.pokemon_data;
                PokemonObj = getMoveAndIV(PokemonObj, Pokemon);
                ipc.of.Controller.emit('PokemonData', PokemonObj);
                ipc.of.Controller.emit('WorkerDone', worker);
              } else {
                ipc.of.Controller.emit('PokemonData', PokemonObj);
                ipc.of.Controller.emit('WorkerDone', worker);
              }
            })
          } else {
            ipc.of.Controller.emit('PokemonData', PokemonObj);
            ipc.of.Controller.emit('WorkerDone', worker);
          }
        })
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

function getPokemonObj(Pokemon, workerScannedSpawnPointID, serverTimestamp, callback){ //convert to pokemon object
  let PokemonID;
  if (Pokemon.pokemon_data != null) {
    PokemonID = Pokemon.pokemon_data.pokemon_id; 
  } else {
    PokemonID = Pokemon.pokemon_id
  }
  callback({
    id: PokemonID,
    spawnLat: Pokemon.latitude,
    spawnLong: Pokemon.longitude,
    TTH_ms: Pokemon.time_till_hidden_ms, 
    despawnTime: Pokemon.expiration_timestamp_ms,
    spawn_point_id: Pokemon.spawn_point_id,
    encounter_id: Pokemon.encounter_id,
    workerScannedSpawnPointID: workerScannedSpawnPointID,
    serverTimestamp: serverTimestamp
  })
}

function getMoveAndIV (PokemonObj, Pokemon) {
  PokemonObj.Atk = Pokemon.individual_attack;
  PokemonObj.Def = Pokemon.individual_defense;
  PokemonObj.Stam = Pokemon.individual_stamina;
  PokemonObj.iv = lib.Utils.getIVsFromPokemon(Pokemon, 2).percent;
  PokemonObj.move_1 = lib.Utils.getEnumKeyByValue(proto.Enums.PokemonMove,Pokemon.move_1);
  PokemonObj.move_2 = lib.Utils.getEnumKeyByValue(proto.Enums.PokemonMove,Pokemon.move_2);  
  return PokemonObj;
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - ${workerName} - ${msg}`);
}

process.on('exit', () => {
  log('Worker Exit.')
});