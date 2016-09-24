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

ipc.config.id = 'Sort_Worker';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.connectTo('Controller');

ipc.of.Controller.on('connect', () => {
  log('Connected to Controller.');
  ipc.of.Controller.emit('SpawnData');
  ipc.of.Controller.emit('Token');
});

ipc.of.Controller.on('SpawnData', spawn => {
  log(`Received Spawn - ${JSON.stringify(spawn)}`);
  ipc.of.Controller.on('Token', worker => {
    log(`Received Worker - ${JSON.stringify(worker)}`);
    client.setAuthInfo('ptc', worker.token); //get token
    client.setPosition(spawn.lat, spawn.lng); //set initial location
    client.init().then(() => {
      scanPokemon(spawn, worker);
    });
  });
});

function scanPokemon(spawn, worker) {
  log(`Start scanning.`)
  client.playerUpdate(); 
  client.getMapObjects([spawn.sid],[0]).then(cellList => {
    const cell = cellList.map_cells[0];
    log(`Cell - ${JSON.stringify(cell)}`);
    log(`Catchable: ${cell.catchable_pokemons}, Wild: ${cell.wild_pokemons}`);

    if (cell.catchable_pokemons.length > 0 && cell.wild_pokemons.length > 0) {
      const pokemon_arr = alasql('SELECT * FROM ? wild LEFT JOIN ? catchable ON wild.encounter_id = catchable.encounter_id AND wild.spawn_point_id = catchable.spawn_point_id ORDER BY catchable.expiration_timestamp_ms DESC', [cell.wild_pokemons, cell.catchable_pokemons])
      const spawn_pokemon = pokemon_arr[0];

      spawn.PokemonLen = pokemon_arr.length;
      spawn.TTH_ms = spawn_pokemon.TTH_ms;

      ipc.of.Controller.emit('PokemonData', spawn);
      ipc.of.Controller.emit('WorkerDone', worker);
    } else {
      spawn.PokemonLen = 0;
      ipc.of.Controller.emit('PokemonData', spawn);
      ipc.of.Controller.emit('WorkerDone', worker);
    }
    process.exit(0);
  })
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - Worker - ${msg}`);
}

process.on('exit', () => {
  log('Worker Exit.')
})