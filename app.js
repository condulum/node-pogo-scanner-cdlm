const Long = require('long');
const moment = require('moment');

//removed: bluebird, lodash

const ipc = require('node-ipc');
const cp = require('child_process');

const schedule = require('node-schedule');

const config = require('./config.json');

if (config.telegramAlert) {
  const Telegram = cp.fork(`${__dirname}/broadcast_services/telegram.js`);
}

const Web = cp.fork(`${__dirname}/broadcast_services/webserver.js`);

const alasql = require('alasql');
const mysql = require('mysql');

alasql('create table Workers(username varchar(32), password varchar(32), isWorking boolean, worked int unsigned)');
alasql.fn.rand = () => Math.random();

for (i in config.workers) {
  alasql('insert into Workers values(?, ?, false, 0)', [config.workers[i].username, config.workers[i].password]);
}

ipc.config.id = 'Controller';
ipc.config.retry = 3000;

ipc.serve();

ipc.server.on('WorkerData', (data, socket) => {
  AvailableWorker = alasql(`select * from Workers where isWorking=false order by rand() limit 1`);
  if (AvailableWorker.length == 0) {
    ipc.server.emit(socket, 'kill');
  } else {
    ipc.server.emit(socket, 'WorkerData', AvailableWorker[0]);
    alasql('update Workers set isWorking = true where username = ?', [AvailableWorker.username]);
  }
});

ipc.server.on('WorkerDone', (doneWorker, socket) => {
  alasql('update Workers set isWorking = false and worked = worked + 1 where username = ?', [doneWorker.username]);
});

ipc.server.on('PokemonData', (PokemonData, socket) => {
  c.query('select * from ScannerData where encounter_id = ?', [PokemonData.encounter_id], (err,rows,fields) => {
    if (rows.length == 0) {
      c.query(`insert into ScannerData values (null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        PokemonData.id, 
        PokemonData.spawnLat, 
        PokemonData.spawnLong, 
        PokemonData.TTH_ms, 
        PokemonData.despawnTime, 
        PokemonData.spawn_point_id, 
        PokemonData.encounter_id,
        PokemonData.workerScannedSpawnPointID,
        PokemonData.serverTimestamp,
        PokemonData.attack, 
        PokemonData.defense,
        PokemonData.stamina,
        PokemonData.iv,
        PokemonData.move_1,
        PokemonData.move_2
      ]);
    }
  });
  switch(PokemonData.tier) {
    case 4:
    case 3:
    case 2:
      switch(config.telegramAlert) {
        case true:
          Telegram.send(PokemonData);
        default:
          Web.send(PokemonData);
          break;
      }
      break;
    default:
      break;
  }
});

//If the sort spawn is correct, this part should not be needed.
/*
ipc.server.on('nothing', (spawn, socket) => {
  const spawnTimeOfCurrentHour = moment().startOf('hour').add(spawn.time, 's');
  if (moment().isBefore(spawnTimeOfCurrentHour)) {
    schedule.scheduleJob(spawnTimeOfCurrentHour.toDate(), forkWorker.bind(spawn));
  } else {
    schedule.scheduleJob(spawnTimeOfCurrentHour.add(1, 'h').toDate(), forkWorker.bind(spawn));
  }
});

ipc.server.on('invalidTTH', (spawn, socket) => {
  schedule.scheduleJob(moment().add(15, 'm').toDate(), forkWorker.bind(null,spawn));
});

ipc.server.on('error', (spawn, socket) => {
  schedule.scheduleJob(moment().add(10, 's').toDate(), forkWorker.bind(null,spawn));
});
*/

ipc.server.start();

function scan(spawn) {
  const worker = cp.fork(`./worker_service/worker.js`);
  ipc.server.on('SpawnData', (data, socket) => {
    ipc.server.emit(socket, 'SpawnData', spawn);
  });
}

const c = mysql.createConnection(config.DBConfig);

c.query('select * from Spawns', (err, rows, fields) => {
  let spawns;
  alasql('create table spawns (lat double,cell string,lng double,sid string,time int unsigned)'); //Create table for spawns.json
  alasql.tables.spawns.data = rows;//Put data into alasql table
  spawns = alasql('SELECT * FROM ? ORDER BY time', [rows]); //Order by time
  const total_sec_of_current_hr = moment.duration(moment().minute(), 'm').asSeconds() + moment().seconds() + 28; //get total second of current hour and plus the timeout time of first scan
  const spawns1 = alasql('SELECT * FROM ? WHERE time >= ?', [spawns, total_sec_of_current_hr]); //get the spawns point with seconds larger than seconds of hour now
  const spawns2 = alasql('SELECT * FROM ? WHERE time < ?', [spawns, total_sec_of_current_hr]); //get the spawns point with seconds smaller than seconds of hour now
  spawns = alasql('SELECT * FROM ? UNION ALL CORRESPONDING SELECT * FROM ?', [spawns1, spawns2]); //Union to scan larger first
  spawns = alasql('SELECT ROWNUM() AS rnum, lat, cell, lng, sid, time FROM ?', [spawns]); //Set row num
  spawns = alasql('SELECT (rnum - 1) % ? + 1 AS gp, * FROM ?', [config.workers.length, spawns]); //calcuate the point will send to which worker
  spawns = alasql('SELECT * FROM ? ORDER BY gp, rnum ', [spawns]); // Order by worker, row
  spawns = alasql('SELECT lat, cell, lng, sid, time FROM ?', [spawns]); // Clean up temp columns
  Round1(spawns, 0, spawns.length);
});

function Round1(locations, index, numOfLocs) {
  //location is already a spawn point data 
  const spawn = locations[index];
  spawn.cell = Long.fromString(locations[index].cell, true, 16).toString(10);
  spawn.scanCase = 0;

  const spawnTimeOfCurHour = moment().startOf('hour').add(spawn.time, 's');
  if (moment().isBefore(spawnTimeOfCurHour)) {
    schedule.scheduleJob(spawnTimeOfCurHour.toDate(), scan.bind(null, spawn));
  } else {
    schedule.scheduleJob(spawnTimeOfCurHour.add(1, 'h').toDate(), scan.bind(null, spawn));
  }

  setTimeout(() =>{
    scan(spawn); //scan location, with case 0 (Entry point, default at switch)

    if (index < numOfLocs) {
      firstScan(locations, ++index, numOfLocs);
    } else if (index = numOfLocs) {
      index = 0;
    };
  }, 15000);
}