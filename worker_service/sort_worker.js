const Promise = require('bluebird');
const moment = require('moment');

const alasql = require('alasql');
const ipc = require('node-ipc');

const lib = require('pogobuf');
const proto = require('node-pogo-protos')

const client = new lib.Client();

const EventEmitter = require('events');

function randomString(length, chars) {
    var mask = '';
    if (chars.indexOf('a') > -1) mask += 'abcdefghijklmnopqrstuvwxyz';
    if (chars.indexOf('A') > -1) mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (chars.indexOf('#') > -1) mask += '0123456789';
    if (chars.indexOf('!') > -1) mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
    var result = '';
    for (var i = length; i > 0; --i) result += mask[Math.round(Math.random() * (mask.length - 1))];
    return result;
}

const workerName = randomString(6, '#');

ipc.config.id = 'Sort_Worker';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.connectTo('Controller');

process.on('message', data =>{
  let spawn = data.spawn;
  let worker = data.worker;

  client.setAuthInfo('ptc', worker.token); //get token
  client.setPosition(spawn.lat, spawn.lng); //set initial location
  client.init().then(() => {
    scanPokemon(spawn, worker);
  }).error(err => console.log(err));
});

function scanPokemon(spawn, worker) {
  log(`Start scanning.`)
  client.playerUpdate();
  client.getMapObjects([spawn.cell],[0]).then(cellList => {
    const cell = cellList.map_cells[0];
    log(`Catchable: ${cell.catchable_pokemons.length}, Wild: ${cell.wild_pokemons.length}`);

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
  }).error(err => console.log(err));
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - ${workerName} - ${msg}`);
}

process.on('exit', () => {
  log('Worker Exit.')
});