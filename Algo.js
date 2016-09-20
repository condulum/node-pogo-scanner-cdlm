let spawn;

function scan(spawn, scanCase) {
  //blah blah blah
  callback(spawn, scanCase);
}

const spawnTimeOfCurrentHour = StartOfHour + spawn_point.time;
const spawnTimeOfNextHour = spawnTimeOfCurrentHour + 1

if (now.isBefore(spawnTimeOfCurrentHour)) {
  schedule(spawnTimeOfCurrentHour, scan(spawn, 0));
}

scan(function(spawn, scanCase) {
  const TTH = spawn.TTH;
  switch (scanCase) {
    case 1:
      if (TTH < 0 || TTH > 3600000) {
        //Inva Inva
        //1x45h0, 1x60h0
        nextscan = now + 15
        schedule(nextscan, scan(spawn, 3))
      } else {
        //Inva Norm
        //1x30h0, 1x60h3
        nextscan = now + 30
        schedule(nextscan, scan(spawn, 4))
      }
      break;
    case 2:
      if (Nothing) {
        //Norm Nothing
        //1x15h0, 1x60h23
        nextscan = now + 15
        schedule(nextscan, scan(spawn, 5))
      } else if (TTH < 0 || TTH > 3600000) {
        //Norm Inva
        //1x60h2
      } else {
        //Norm Norm
        //1x45h2
      }
      break;
    case 3:
      if (TTH < 0 || TTH > 3600000) {
        //Inva Inva Inva
        //1x60h0
      } else {
        //Inva Inva Norm
        //1x45h0
      }
      break;
    case 4:
      if(TTH < 0 || TTH > 3600000) {
        //Inva Norm Inva
        //1x60h3
      } else {
        //Inva Norm Nothing
        //1x30h0
      }
      break;
    case 5:
      if(TTH < 0 || TTH > 3600000) {
        //Norm Nothing Inva
        //1x60h23
      } else {
        //Norm Nothing Nothing
        //1x15h0
      }
      break;
    default:
      if (Nothing) {
        schedule(spawnTimeOfNextHour, scan(spawn, 0))
      } else if (TTH < 0 || TTH > 3600000) {
        //Inva
        //1x30h0, 1x45h0, 1x60h0, 1x60h3
        nextscan = now + 15
        schedule(nextscan, scan(spawn, 1))
      } else {
        //Norm
        //1x15h0, 1x45h2, 1x60h2, 1x60h23
        nextscan = now + 30
        schedule(nextscan, scan(spawn, 2))
      }
      break;
  }
})