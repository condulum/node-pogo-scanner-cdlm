const Promise = require('bluebird');
const moment = require('moment');

const alasql = require('alasql');
const ipc = require('node-ipc');

const lib = require('pogobuf');
const proto = require('node-pogo-protos')

const client = new lib.Client();
const Trainer = new lib.PTCLogin();

const EventEmitter = require('events');
const Work = new EventEmitter();

ipc.config.id = 'Worker';
ipc.config.retry = 3000;

ipc.connectTo('Controller', () => {
  ipc.of.Controller.on('connect', () => {
    ipc.of.Controller.emit('SpawnData');
  });
  ipc.of.Controller.on('kill', () => {
    process.exit(0);
  });
  ipc.of.Controller.on('WorkerData', worker => {
    Work.emit('WorkerData', worker);
  });
  ipc.of.Controller.on('SpawnData', spawn => {
    Work.emit('SpawnData', spawn);
    ipc.of.Controller.emit('WorkerData');
  });
  Work.on('ScanData', PokemonData => {
    ipc.of.Controller.emit('ScanData', PokemonData);
  });
  Work.on('done', worker => {
    ipc.of.Controller.emit('WorkerDone', worker);
  });
  Work.on('nothing', spawn => {
    ipc.of.Controller.emit('nothing', spawn);
  });
  Work.on('invalidTTH', spawn => {
    ipc.of.Controller.emit('invalidTTH', spawn);
  });
  Work.on('error', spawn => {
    ipc.of.Controller.emit('error', spawn);
  })
});

Work.on('SpawnData', spawn => {
  Work.on('WorkerData', worker => {
    Trainer.login(worker.username, worker.password).then(token => {
      client.setAuthInfo('ptc', token); //get token
      client.setPosition(spawn.lat, spawn.lng); //set initial location
      return client.init();
    }).then(() => {
      scanPokemon(spawn, worker, scanCount)
    })
  });
});

function scanPokemon(spawn, worker, scanCount) {
  client.playerUpdate(); //update worker (character)

  client.getMapObjects([spawn.sid], [0]).then(cellList => { //get the objects on the map
    const cell = cellList.map_cells[0]; 
    const serverTimeStamp = cell.current_timestamp_ms;

    if (cell.catchable_pokemons.length > 0 && cell.wild_pokemons.length > 0) {
      let pokemon_arr = alasql('SELECT * FROM ? wild LEFT JOIN ? catchable ON wild.encounter_id = catchable.encounter_id AND wild.spawn_point_id = catchable.spawn_point_id ORDER BY catchable.expiration_timestamp_ms DESC', [cell.wild_pokemons, cell.catchable_pokemons]); //Merge wild and catchable and use ORDER to prevent scheduling scan for lured pokemon

      pokemon_arr.forEach(Pokemon => { //each pokemon scanned
        getPokemonObj(Pokemon, spawn.sid, serverTimeStamp).then(PokemonObj => {
          if (PokemonObj.TTH_ms < 0 || PokemonObj.TTH_ms > 3600000) { // check Invalid TTH_ms
            Work.emit('invalidTTH', spawn); //schedule rescan event
          } else {
            if (PokemonObj.checkIV == true) {
              client.encounter(PokemonObj.encounter_id, PokemonObj.spawn_point_id).then(response => {
                if (response.wild_pokemon.pokemon_data != null) {
                  Pokemon = response.wild_pokemon.pokemon_data;
                  PokemonObj = getMoveAndIV(PokemonObj, Pokemon);
                } else {
                  PokemonObj.checkIV = false;
                  Work.emit('ScanData', PokemonObj)
                  Work.emit('done', worker)
                }
              }).catch(error => {
                PokemonObj.checkIV = false;
                Work.emit('ScanData', PokemonObj)
                Work.emit('done', worker);
              });
            } else {
              Work.emit('ScanData', PokemonObj)
              Work.emit('done', worker);
            }
          }
        })
      })
    }
  }).catch(error => {
    Work.emit('error', spawn);
    Work.emit('done', worker);
  });
}

//HELPER FUNCTION

function getPokemonObj(Pokemon, workerScannedSpawnPointID, serverTimestamp){ //convert to pokemon object
  return new Promise(function(resolve){
    let TempPokemon = {};
    let PokemonID;
    if (Pokemon.pokemon_data != null) {
      PokemonID = Pokemon.pokemon_data.pokemon_id; 
    } else {
      PokemonID = Pokemon.pokemon_id
    }
    getPokemonByID(PokemonID).then(TempPokemon => {
      resolve({
        id: TempPokemon.id,
        PokemonName: TempPokemon.name,
        chineseName: TempPokemon.chineseName,
        tier: TempPokemon.tier,
        checkIV: TempPokemon.checkIV,
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

function getPokemonByID(pokemon_id){ //get pokemon data by pokemon_id
  return new Promise(resolve => {
    c.query('select * from Pokemons where id=?', [pokemon_id], (err, rows, fields) => {
      resolve(rows[0])
    })
  })
}