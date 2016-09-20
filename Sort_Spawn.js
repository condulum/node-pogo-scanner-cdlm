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

ipc.config.id = 'categorize';
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

ipc.server.on('ScanResult', (spawn, socket) => {
  const TTH = spawn.TTH_ms //TTH
  const PokemonLen = spawn.PokemonLen //Check if there is pokemon or not.

  let nextscan;
  switch (spawn.scanCase) {
    case 1:
      if (TTH < 0 || TTH > 3600000) {
        nextscan = moment().add(15, 'm');
        spawn.scanCase = 3;
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      } else {
        nextscan = moment().add(30, 'm')
        spawn.scanCase = 4;
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      }
      break;
    case 2:
      if (PokemonLen == 0) {
        nextscan = moment().add(15, 'm')
        spawn.scanCase = 5
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      } else if (TTH < 0 || TTH > 3600000) {
        c.query('update Spawns set spawn_type=6 where sid=?', [spawn.sid]);
      } else {
        c.query('update Spawns set spawn_type=5 where sid=?', [spawn.sid]);
      }
      break;
    case 3:
      if (TTH < 0 || TTH > 3600000) {
        c.query('update Spawns set spawn_type=4 where sid=?', [spawn.sid]);
      } else {
        c.query('update Spawns set spawn_type=3 where sid=?', [spawn.sid]);
      }
      break;
    case 4:
      if(TTH < 0 || TTH > 3600000) {
        c.query('update Spawns set spawn_type=7 where sid=?', [spawn.sid]);
      } else {
        c.query('update Spawns set spawn_type=2 where sid=?', [spawn.sid]);
      }
      break;
    case 5:
      if(TTH < 0 || TTH > 3600000) {
        c.query('update Spawns set spawn_type=8 where sid=?', [spawn.sid]);
      } else {
        c.query('update Spawns set spawn_type=1 where sid=?', [spawn.sid]);
      }
      break;
    default:
      if (PokemonLen == 0) {
        nextscan = moment().startOf('hour').add(spawn.time, 's');
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      } else if (TTH < 0 || TTH > 3600000) {
        nextscan = moment().add(15, 'm')
        spawn.scanCase = 1
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      } else {
        nextscan = moment().add(30, 'm')
        spawn.scanCase = 2
        schedule.scheduleJob(nextscan.toDate(), scan.bind(null, spawn))
      }
      break;
  }
})

ipc.server.start();

function scan(spawn) {
  const worker = cp.fork(`./worker_service/sort_worker.js`);
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
  Round1(spawns, 0, spawns.length)
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
      Round1(locations, ++index, numOfLocs);
    } else if (index = numOfLocs) {
      index = 0;
    };
  }, 15000);
}