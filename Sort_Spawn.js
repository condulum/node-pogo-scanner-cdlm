/*
variable needed from scanner: spawn_point_id, time, TTH, length of catchable/wild (to check if there's anything.)

spawn_type:
1: 1x15h0
2: 1x30h0
3: 1x45h0
4: 1x60h0
5: 1x45h2
6: 1x60h2
7: 1x60h3
8: 1x60h23
*/

const Long = require('long');
const moment = require('moment');

const ipc = require('node-ipc');
const cp = require('child_process');

const schedule = require('node-schedule');

const config = require('./config.json');

const alasql = require('alasql');
const mysql = require('mysql');

alasql('create table Workers(username varchar(32), password varchar(32), isWorking boolean, worked int unsigned)');
alasql.fn.rand = () => Math.random();

for (i in config.workers) {
  alasql('insert into Workers values(?, ?, false, 0)', [config.workers[i].username, config.workers[i].password]);
}

ipc.config.id = 'Controller';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.serve();

ipc.server.on('WorkerData', (data, socket) => {
  const getWorker = setInterval(() => {
    AvailableWorker = alasql(`select * from Workers where isWorking=false order by rand() limit 1`);

    if (AvailableWorker.length != 0) {
      log(`Assigning worker: \n${JSON.stringify(AvailableWorker[0])}\n`)
      ipc.server.emit(socket, 'WorkerData', AvailableWorker[0]);
      alasql('update Workers set isWorking = true where username = ?', [AvailableWorker.username]);
      clearInterval(getWorker);
    }
  }, 20000)
});

ipc.server.on('WorkerDone', (doneWorker, socket) => {
  alasql('update Workers set isWorking = false and worked = worked + 1 where username = ?', [doneWorker.username]);
});

ipc.server.on('PokemonData', (spawn, socket) => {
  log(JSON.stringify(spawn));
  pool.getConnection((err, c) => {
    const TTH = spawn.TTH_ms //TTH
    const PokemonLen = spawn.PokemonLen //Check if there is pokemon or not.

    let nextscan;
    switch (spawn.scanCase) {
      case 1:
        if (TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, case 1, rescan 15`)
          nextscan = moment().add(15, 'm');
          spawn.scanCase = 3;
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn));
        } else {
          log(`${spawn.sid}, case 1, rescan 30`)
          nextscan = moment().add(30, 'm')
          spawn.scanCase = 4;
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn));
        }
        break;
      case 2:
        if (PokemonLen == 0) {
          log(`${spawn.sid}, case 2, rescan 15`)
          nextscan = moment().add(15, 'm')
          spawn.scanCase = 5
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
        } else if (TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, st6`)
          c.query('update Spawns set spawn_type=6 where sid=?', [spawn.sid]);
        } else {
          log(`${spawn.sid}, st5`)
          c.query('update Spawns set spawn_type=5 where sid=?', [spawn.sid]);
        }
        break;
      case 3:
        if (TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, st4`)
          c.query('update Spawns set spawn_type=4 where sid=?', [spawn.sid]);
        } else {
          log(`${spawn.sid}, st3`)
          c.query('update Spawns set spawn_type=3 where sid=?', [spawn.sid]);
        }
        break;
      case 4:
        if(TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, st7`)
          c.query('update Spawns set spawn_type=7 where sid=?', [spawn.sid]);
        } else {
          log(`${spawn.sid}, st2`)
          c.query('update Spawns set spawn_type=2 where sid=?', [spawn.sid]);
        }
        break;
      case 5:
        if(TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, st8`)
          c.query('update Spawns set spawn_type=8 where sid=?', [spawn.sid]);
        } else {
          log(`${spawn.sid}, st1`)
          c.query('update Spawns set spawn_type=1 where sid=?', [spawn.sid]);
        }
        break;
      default:
        if (PokemonLen == 0) {
          log(`${spawn.sid}, nothing found, scheduling next hour.`)
          nextscan = moment().startOf('hour').add(spawn.time, 's');
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
        } else if (TTH < 0 || TTH > 3600000) {
          log(`${spawn.sid}, case def, rescan 15`)
          nextscan = moment().add(15, 'm')
          spawn.scanCase = 1
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
        } else {
          log(`${spawn.sid}, case def, rescan 30`)
          nextscan = moment().add(30, 'm')
          spawn.scanCase = 2
          schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
        }
        break;
    }
    c.release();
  })
})

ipc.server.start();

function scan(spawn) {
  log('Forking.')
  const worker = cp.fork(`./worker_service/sort_worker.js`);
  ipc.server.on('SpawnData', (data, socket) => {
    ipc.server.emit(socket, 'SpawnData', spawn);
  });
}


const pool = mysql.createPool(config.DBConfig);

pool.getConnection((err, c) => {
  c.query('select * from Spawns', (err, rows, fields) => {
    log('Getting Spawn from SQL.')
    Round1(rows, 0, rows.length - 1);
    c.release();
  });
});

function Round1(spawns, index, numOfLocs) {
  //location is already a spawn point data 
  const spawn = spawns[index];
  spawn.cell = Long.fromString(spawn.cell, true, 16).toString(10);
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
      Round1(spawns, ++index, numOfLocs);
    } else if (index == numOfLocs) {
      index = 0;
    };
  }, 15000);
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - ${msg}`);
}