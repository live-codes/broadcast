const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const socketio = require("socket.io");
const { nanoid } = require("nanoid");

const userTokens = process.env.userTokens === "true";
const port = process.env.PORT || 3000;
const app = express();
const httpserver = http.createServer(app);
const io = new socketio.Server(httpserver);

const channels = {};

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.on("finish", () => {
    Object.keys(channels).forEach((key) => {
      const timeout = 1000 * 60 * 20;
      if (Date.now() - channels[key].lastAccessed > timeout) {
        delete channels[key];
      }
    });
  });
  next();
});

const generateId = () => nanoid(10);
const hasPermission = (req) => {
  if (!userTokens) return true;
  const token = req.body.token || req.query.token;
  if (!token) return false;
  return Object.values(process.env).find((value) => value === token) != null;
};

app.get("/", (req, res) => {
  res.end("LiveCodes Broadcast");
});

app.post("/", (req, res) => {
  if (!hasPermission(req)) {
    res.status(401).json({ error: "Permission denied! Invalid user token." });
    return;
  }
  const newChannel = !req.body.channel;
  const channel = newChannel ? generateId() : req.body.channel;
  const result = req.body.result;

  if (!newChannel && !channels[channel]) {
    res.status(404).json({ error: "Channel not found!" });
    return;
  }
  if (!newChannel && req.body.channelToken !== channels[channel].channelToken) {
    res
      .status(401)
      .json({ error: "Permission denied! Invalid channel token." });
    return;
  }

  io.in(channel).emit("recieve", result);

  const channelToken = newChannel
    ? generateId()
    : channels[channel].channelToken;

  channels[channel] = {
    channelToken,
    result: result.length < 300000 ? result : "",
    lastAccessed: Date.now(),
  };

  const channelUrl = `https://${req.get("host")}/channels/${channel}`;

  res.json({
    channel,
    channelUrl,
    ...(newChannel ? { channelToken } : {}),
  });
});

app.get("/channels/:id", (req, res) => {
  const channel = req.params.id;
  if (channels[channel]) {
    channels[channel].lastAccessed = Date.now();
    res.sendFile(path.join(__dirname, "/index.html"));
  } else {
    res.status(404).send("Channel not found!");
  }
});

io.on("connection", (socket) => {
  socket.on("join", (channel) => {
    if (!channels[channel]) return;
    socket.join(channel);
    socket.emit("join", channels[channel].result);
  });
});

httpserver.listen(port);
