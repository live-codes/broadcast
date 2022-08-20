const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const socketio = require("socket.io");
const { nanoid } = require("nanoid");

const port = process.env.PORT || 3000;
const app = express();
const httpserver = http.createServer(app);
const io = new socketio.Server(httpserver);

const channels = {};
const results = {};

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  Object.keys(results).forEach((key) => {
    const timeout = 1000 * 60 * 20;
    if (Date.now() - results[key].lastAccessed > timeout) {
      delete results[key];
    }
  });
  next();
});

const generateId = () => nanoid(10);

app.get("/", (req, res) => {
  res.end("LiveCodes Broadcast");
});

app.post("/", (req, res) => {
  const result = req.body.result;
  const channel = req.body.channel || generateId();
  io.in(channel).emit("recieve", result);
  results[channel] = {
    result,
    lastAccessed: Date.now(),
  };
  const url = `${req.protocol}://${req.get("host")}/channels/${channel}`;
  res.json({ channel, url });
});

app.get("/channels/:id", (req, res) => {
  const channel = req.params.id;
  if (results[channel]) {
    results[channel].lastAccessed = Date.now();
    res.sendFile(path.join(__dirname, "/index.html"));
  } else {
    res.status(404).send("Channel not found!");
  }
});

io.on("connection", (socket) => {
  socket.on("join", (channel) => {
    if (!results[channel]) return;
    channels[socket.id] = channel;
    socket.join(channel);
    socket.emit("join", results[channel].result);
  });

  socket.on("disconnect", () => {
    delete channels[socket.id];
  });
});

httpserver.listen(port);
