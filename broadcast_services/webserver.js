const fs = require('fs'); //file system access
const http = require('http');

const socketio = require('socket.io'); //socket to send data to webpage
const EventEmitter = require('events');

const config = require(`${__dirname}/../config.json`);

const ioEvent = new EventEmitter(); //create new EventEmitter

const server = http.createServer((req, res) => {
  fs.readFile(`${__dirname}/index.html`, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('The webserver is having a hard time serving you the page.');
    } else {
      res.writeHead(200);
      res.end(data);
    }
  })
});

server.listen(config.WebServerPort)

process.on('message', jsondata => {
  ioEvent.emit('data', jsondata);
});

const io = new socketio();

io.attach(server);

io.on('connection', (socket) => {
  ioEvent.on('data', data => socket.emit('scanner', data)); //sends filtered data to webpage
});