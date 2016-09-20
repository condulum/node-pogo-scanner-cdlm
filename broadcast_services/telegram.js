const request = require('request'); //to access telegram api
const config = require(`${__dirname}/../config.json`);
const moment = require('moment');

moment.locale('hk'); //change locale of moment to Hong Kong for proper timezone.

const telegramAlertOn = config.telegramAlertOn;
const telegramKey = config.telegramKey;

const LocationOptions = {
  url: `https://api.telegram.org/bot${telegramKey}/sendLocation`,
  headers: {
    'Content-Type': 'application/json'
  }
}

const TextOptions = {
  url: `https://api.telegram.org/bot${telegramKey}/sendMessage`,
  headers: {
    'Content-Type': 'application/json'
  }
}

if (telegramAlertOn == true) {
  process.on('message', jsondata => {
    for (i in config.telegramChannel) {
      if (jsondata.tier == config.telegramChannel.tier) {
        let chat_id = config.telegramChannel.chatID;
      }
    }

    const text = ``;

    if (jsondata.checkIV) {
      text = `#${jsondata.chineseName} (#${jsondata.PokemonName})
      Until ${moment(jsondata.despawnTime).format('HH:mm:ss')} (${moment(jsondata.TTH_ms).format('mm[m]ss[s]')} left)
      ${jsondata.attack}/${jsondata.defense}/${jsondata.stamina} ${jsondata.iv}%
      Moves: ${jsondata.move_1} & ${jsondata.move_2}`;
    } else {
      text = `#${jsondata.chineseName} (#${jsondata.PokemonName})
      Until ${moment(jsondata.despawnTime).format('HH:mm:ss')} (${moment(jsondata.TTH_ms).format('mm[m]ss[s]')} left)`;
    }

    if (chat_id != 0 && jsondata.checkIV != null) {
      request.post(Object.assign(LocationOptions, {form:{chat_id: chat_id, latitude: jsondata.spawnLat, longitude: jsondata.spawnLong}}), function(err, resp, body) { //sends map location to api
        let returnObj = JSON.parse(body);

        request.post(Object.assign(TextOptions, {form: {chat_id: chat_id , reply_to_message_id: returnObj.result.message_id, text: text}, entities: [{type: 'hashtag'}]}), function(err, resp, body) { //sends text related to map location in reply to the location message.
        });
      });
    }
  });
}