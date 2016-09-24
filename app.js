const Long = require('long');
const moment = require('moment');

//removed: bluebird, lodash

//IMPORTANT: GET A PROPER LOGGER.

const ipc = require('node-ipc');
const cp = require('child_process');

const schedule = require('node-schedule');

const config = require('./config.json');

//const Web = cp.fork(`${__dirname}/broadcast_services/webserver.js`);

const alasql = require('alasql');
const mysql = require('mysql');

const pool = mysql.createPool(config.DBConfig);

alasql('create table Workers(username varchar(32), password varchar(32), isWorking boolean, worked int unsigned, token varchar(64))');
alasql.fn.rand = () => Math.random();

for (i in config.workers) {
  alasql('insert into Workers values(?, ?, false, 0, null)', [config.workers[i].username, config.workers[i].password]);
}
//const spawnType = ['0', '1x15h0', '1x30h0', '1x45h0', '1x60h0', '1x45h2', '1x60h2', '1x60h3', '1x60h23'];
ipc.config.id = 'Controller';
ipc.config.retry = 3000;

ipc.serve();

setInterval(() => {
  alasql.promise('select * from Workers').each(worker => {
    Trainer.login(worker.username, worker.password).then(token => {
      alasql('update Workers set token = ? where username = ?', [token, worker.username])
    });
  });
}, 300000)

ipc.server.on('Token', (data, socket) => {
  const getWorker = setInterval(() => {
    AvailableWorker = alasql(`select token, username from Workers where isWorking is false and token is not null order by rand() limit 1`);

    if (AvailableWorker.length != 0) {
      log(`Assigning worker: \n${JSON.stringify(AvailableWorker[0])}\n`);
      ipc.server.emit(socket, 'Token', AvailableWorker[0].token);
      alasql('update Workers set isWorking = true where username = ?', [AvailableWorker.username]);
      clearInterval(getWorker);
    }
  },20000)
});

ipc.server.on('WorkerDone', (doneWorker, socket) => {
  alasql('update Workers set isWorking = false and worked = worked + 1 where username = ?', [doneWorker.username]);
});

ipc.server.on('PokemonData', (PokemonData, socket) => {
  log(JSON.stringify(PokemonData));
  pool.getConnection((err, c) => {
    c.query('select * from Encountered where encounter_id = ?', [PokemonData.encounter_id], (err,rows,fields) => {
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
        c.query('insert into Encountered values (?, ?, ?)', [PokemonData.encounter_id, PokemonData.despawnTime, moment().valueOf()]); //inserts into Encountered with id, despawn time and scanner time
      }
      c.release();
    });
  })
  //Web.send(PokemonData);
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

ipc.server.on('nothing', (spawn, socket) => {
  log(`Found Nothing, rescheduling (30s).`);
  schedule.scheduleJob(moment().add(30,'s').toDate(), scan.bind(null, spawn));
});

ipc.server.start();

function scan(spawn) {
  log(`Forking.`)
  const worker = cp.fork(`./worker_service/worker.js`);
  ipc.server.on('SpawnData', (data, socket) => {
    ipc.server.emit(socket, 'SpawnData', spawn);
  });
}

pool.getConnection((err, c) => {
  c.query('select * from Spawns', (err, rows, fields) => {
    log('Getting Spawn points from MySQL.')
    c.release();
    let spawns;
    alasql('create table spawns (lat double,cell string,lng double,sid string,time int unsigned, spawn_type tinyint unsigned)'); //Create table for spawns.json
    alasql.tables.spawns.data = rows;//Put data into alasql table
    const total_sec_of_current_hr = moment.duration(moment().minute(), 'm').asSeconds() + moment().seconds() + 28; //get total second of current hour and plus the timeout time of first scan
    const spawns1 = alasql('SELECT * FROM spawns WHERE time >= ? order by time', [total_sec_of_current_hr]); //get the spawns point with seconds larger than seconds of hour now
    const spawns2 = alasql('SELECT * FROM spawns WHERE time < ? order by time', [total_sec_of_current_hr]); //get the spawns point with seconds smaller than seconds of hour now
    spawns = alasql('SELECT * FROM ? UNION ALL CORRESPONDING SELECT * FROM ?', [spawns1, spawns2]); //Union to scan larger first
    spawns = alasql('SELECT *, ROWNUM() AS rnum FROM ?', [spawns]); //Set row num
    spawns = alasql('SELECT (rnum - 1) % ? + 1 AS gp, * FROM ?', [config.workers.length, spawns]); //calcuate the point will send to which worker
    spawns = alasql('SELECT * FROM ? ORDER BY gp, rnum', [spawns]); // Order by worker, row
    spawns = alasql('SELECT * FROM ?', [spawns]); // Clean up temp columns
    initialScheduler(spawns);
  });
});

function initialScheduler(spawns) {
  log('Scheduling.')
  spawns.forEach(spawn => {
    spawn.cell = Long.fromString(spawn.cell, true, 16).toString(10);

    const spawnTimeOfCurHour = moment().startOf('hour').add(spawn.time, 's');
    const rule = new schedule.RecurrenceRule();
    rule.minute = moment(spawnTimeOfCurHour).minute();
    rule.second = moment(spawnTimeOfCurHour).second();
    schedule.scheduleJob(rule, scan.bind(null, spawn));
  })
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - ${msg}`);
}