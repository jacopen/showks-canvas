# showk-app
ShowK Participant's App

## How to use

### Run as a container

```
$ docker build -t <your username>/showk-app .
$ docker run -p <desired port>:8080 -d <your username>/showk-app
```

### Run with Node.js runtime

```
$ cd src
$ npm install
$ npm start
```
Open http://\<your host\>:3000 with a web browser.


## Features


## License

[MIT](LICENSE)

This application is forked from [Socket.IO Collaborative Whiteboard example](https://github.com/socketio/socket.io/tree/master/examples/whiteboard).