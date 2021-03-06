const Long = require('long');
const moment = require('moment');

moment.locale('hk');

const ipc = require('node-ipc');
const cp = require('child_process');

const schedule = require('node-schedule');

const config = require('./config.json');

const alasql = require('alasql');
const mysql = require('mysql');

const lib = require('pogobuf');
let Trainer = new lib.PTCLogin();

const pool = mysql.createPool(config.DBConfig);

alasql('create table Workers(username varchar(32), password varchar(32), isWorking boolean, worked int unsigned, token varchar(64))');
alasql.fn.rand = () => Math.random();

config.workers.forEach(worker => {
  alasql('insert into Workers values(?, ?, false, 0, null)', [worker.username, worker.password]);
});

ipc.config.id = 'Controller';
ipc.config.retry = 3000;
ipc.config.silent = true;

ipc.serve();

function refreshToken() {
  log('Refreshing Token.');
  alasql.promise('select * from Workers').then(workers => {
    workers.forEach(worker => {
      Trainer = null;
      Trainer = new lib.PTCLogin();
      Trainer.login(worker.username, worker.password).then(token => {
        alasql('update Workers set token = ? where username = ?', [token, worker.username]);
      });
    });
  }).catch(error => {
    console.log(error);
  });
}

refreshToken();

setInterval(() => {
  refreshToken();
}, 300000);

ipc.server.on('WorkerDone', (doneWorker, socket) => {
  log('WorkerDone');
  alasql('update Workers set isWorking = false and worked = worked + 1 where username = ?', [doneWorker.username]);
});

ipc.server.on('PokemonData', (spawn, socket) => {
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
  const interval = setInterval(() => {
    let AvailableWorker = alasql(`select * from Workers where isWorking = false order by rand() limit 1`)[0]
    if (AvailableWorker != null && AvailableWorker.token != null) {
      log('Forking.')
      const fork = cp.fork(`./worker_service/sort_worker.js`);
      fork.send({spawn:spawn, worker:AvailableWorker})
      alasql('update Workers set isWorking = true where username = ?', [AvailableWorker.username]);
      clearInterval(interval);
    }
  },500)
}

pool.getConnection((err, c) => {
  c.query('select * from Spawns', (err, rows, fields) => {
    log('Getting Spawn from SQL.')
    Round1(rows);
    c.release();
  });
});

function Round1(spawns) {
  //location is already a spawn point data 
  spawns.forEach(spawn => {
    spawn.cell = Long.fromString(spawn.cell, true, 16).toString(10);
    spawn.scanCase = 0;

    const spawnTimeOfCurHour = moment().startOf('hour').add(spawn.time, 's').add(10, 's');

    if (moment().isBefore(spawnTimeOfCurHour) == true) {
      schedule.scheduleJob(spawnTimeOfCurHour.toDate(), scan.bind(null, spawn));
    } else {
      schedule.scheduleJob(spawnTimeOfCurHour.add(1, 'h').toDate(), scan.bind(null, spawn));
    }
  })
}

function log(msg) {
  console.log(`${moment().format('HHmmss')} - Controller - ${msg}`);
}