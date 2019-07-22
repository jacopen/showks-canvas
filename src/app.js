const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 1024;
const THUMBNAIL_WIDTH = 256;
const THUMBNAIL_HEIGHT = 256;
const REFRESH_INTERVAL = 5000;
const IMAGE_FOLDER = 'showks-canvas/';
const IMAGE_FILE_NAME_DEFAULT = 'canvas-image';
const SAVE_IMAGE_INTERVAL = 5000;
const AUTHOR_JSON = __dirname + '/data/author.json';

const version = process.env.npm_package_version;
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const commandNamespace = io.of('/command');
const notificationNamespace = io.of('/notification');
const port = process.env.PORT || 8080;
const draw = require('./public/scripts/draw.js');
const minio = require('minio');
const fs = require('fs');
const mustacheExpress = require('mustache-express');

// Create a canvas for server-side drawing
const { createCanvas, Image } = require('canvas')
const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
const ctx = canvas.getContext('2d');
const thCanvas = createCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
const thCtx = thCanvas.getContext('2d');

// Access to S3 bucket to save the image
const imageBucketEndpoint = process.env.IMAGE_BUCKET_ENDPOINT;
const imageBucketName = process.env.IMAGE_BUCKET_NAME;
const imageBucketAccessKey = process.env.IMAGE_BUCKET_ACCESS_KEY;
const imageBucketSecretKey = process.env.IMAGE_BUCKET_SECRET_KEY;
const imageMetaData = {
  'Content-Type': 'application/octet-stream'
}
const hasBucket = imageBucketEndpoint === undefined || imageBucketEndpoint === '' ? false : true;
const minioClient = hasBucket ? new minio.Client({
  endPoint: imageBucketEndpoint,
  port: 443,
  useSSL: true,
  accessKey: imageBucketAccessKey,
  secretKey: imageBucketSecretKey
}) : undefined;
// console.log(minioClient.listObjects(imageBucketName, '', false));

function getImagePath() {
  let imagePath = process.env.USER_ID;
  if (imagePath === undefined || imagePath === '') {
    imagePath = IMAGE_FILE_NAME_DEFAULT;
  }
  imagePath = IMAGE_FOLDER + imagePath + '.png';
  return imagePath;
}

function getAuthor() {
  const authorRaw = fs.readFileSync(AUTHOR_JSON);
  const author = JSON.parse(authorRaw);
  return author;
}

const imagePath = getImagePath();
const author = getAuthor()

// Save the image into S3 bucket
// console.log('imageBucketEndpoint: ' + imageBucketEndpoint);
// console.log('imageBucketName: ' + imageBucketName);
// console.log('imageBucketAccessKey: ' + imageBucketAccessKey);
// console.log('imageBucketSecretKey:' + imageBucketSecretKey);
//console.log('imagePath: ' + imagePath);
function saveCanvasImage() {
  let stream = canvas.createPNGStream();
  minioClient.putObject(imageBucketName, imagePath, stream, function(err, etag) {
    if (err) {
      console.log('Failed to upload canvas image.');
      return console.log(err);
    }
    return console.log('Saved canvas image successfully as:' + etag);
  });
}

// Erase background
function eraseBackground() {
  ctx.fillStyle="white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Load image from S3 bucket
function loadCanvasImage() {
  let data = [];
  minioClient.getObject(imageBucketName, imagePath, function(err, dataStream) {
    if (err) {
      console.log(err);
      // Fill the background
      console.log('There is no saved image, filling the background with base color.');
      return eraseBackground();
    }
    console.log('Loading an initial image.');
    dataStream.on('data', function(chunk) {
      data.push(chunk);
    });
    dataStream.on('end', function() {
      let image = new Image();
      image.onload = function() {
        ctx.drawImage(image, 0, 0);
        console.log('Loaded an initial image.');
      };
      image.onerror = function(err) {
        console.log(err);
        // Fill the background
        console.log('There is no saved image, filling the background with base color.');
        eraseBackground();
      };
      image.src = Buffer.concat(data);
    });
  });
}

// socket.io connection handler
let lastUpdated = 0;
let isDirty = false;
function onCommandConnection(socket) {
  console.log('Connected to command namespace.');

  // Receive and broadcast drawing event
  socket.on('drawing', (data) => {
    commandNamespace.emit('drawing', data);
    // console.log(`x:${data.x0}, y:${data.y0}`);
    draw.line(ctx, data.x0, data.y0, data.x1, data.y1, data.color, data.width);
    let updated = Date.now();
    let diff = updated - lastUpdated;
    if (REFRESH_INTERVAL < diff || diff < 0) {
      notificationNamespace.emit('refresh', 1);
      lastUpdated = updated;
      // console.log(`lastUpdated: ${lastUpdated}`);
    }
    isDirty = true;
  });
}

function onNotificationConnection(socket) {
  console.log('Connected to notification namespace.');
}

function onSaveImageTimer() {
  // Save the image
  if (isDirty) {
    saveCanvasImage();
    isDirty = false;
  }
}

function getRequestUrl(req) {
  return req.protocol + '://' + req.get('host');
}

// Initialize the canvas
if (hasBucket) {
  loadCanvasImage();
} else {
  eraseBackground();
}

// Setup the express web app

// Register '.mustache' extension with The Mustache Express
app.engine('html', mustacheExpress());

// Setup view template engine
app.set('view engine', 'mustache');

// GET /
app.get('/', function(req, res) {
  const requestUrl =  getRequestUrl(req);
  let twitterId = author.twitterId;
  let twitter = twitterId !== undefined && twitterId !== '';
  res.render('index.html', {
    'og_url': requestUrl,
    'og_image': requestUrl + '/thumbnail',
    'twitter': twitter,
    'twitter_site': twitterId
  });
});

// GET /
app.use(express.static(__dirname + '/public'));

// GET /version
app.get('/version', function(req, res) {
  res.send(`showKs Canvas version ${version}`);
});

// GET /canvas
app.get('/canvas', function(req, res) {
  res.type("png");
  let stream = canvas.createPNGStream();
  stream.pipe(res);
})

// GET /thumbnail
app.get('/thumbnail', function(req, res) {
  thCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, thCanvas.width, thCanvas.height);
  res.type("png");
  let stream = thCanvas.createPNGStream();
  stream.pipe(res);
})

// GET /author
app.get('/author', function(req, res) {
  res.download(AUTHOR_JSON);
})

// Start listening socket.io
commandNamespace.on('connection', onCommandConnection);
notificationNamespace.on('connection', onNotificationConnection);

// Start listening on the port for HTTP request
http.listen(port, () => console.log('listening on port ' + port));

// Start time to save image
if (hasBucket) {
  setInterval(onSaveImageTimer, SAVE_IMAGE_INTERVAL);
}
