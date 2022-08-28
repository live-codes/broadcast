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
app.use((_req, res, next) => {
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
  const userToken =
    req.body.userToken || req.query.userToken || req.query.token;
  if (!userToken) return false;
  return (
    Object.values(process.env).find((value) => value === userToken) != null
  );
};

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, `/index.html`));
});

app.post("/", (req, res) => {
  if (!hasPermission(req)) {
    res.status(401).json({ error: "Permission denied! Invalid user token." });
    return;
  }
  const newChannel = !req.body.channel;
  const channel = newChannel ? generateId() : req.body.channel;
  const result = req.body.result;
  const data = req.body.data;
  const stopBroadcast = req.body.stop;

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
  if (!newChannel && channels[channel] && stopBroadcast) {
    delete channels[channel];
    io.in(channel).disconnectSockets(true);
    res.json({ message: "Broadcast stopped!" });
    return;
  }

  io.in(channel).emit("receive", result, data);

  const channelToken = newChannel
    ? generateId()
    : channels[channel].channelToken;

  const reducedData = JSON.parse(JSON.stringify(data || {}));
  if (reducedData.markup) reducedData.markup.compiled = "";
  if (reducedData.style) reducedData.style.compiled = "";
  if (reducedData.script) reducedData.script.compiled = "";

  channels[channel] = {
    channelToken,
    result: result.length < 300000 ? result : "",
    data: JSON.stringify(reducedData).length < 500000 ? reducedData : {},
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
    const hasData = Object.keys(channels[channel].data || {}).length > 0;
    const view = req.query.view;
    const file = view || (hasData ? "index" : "result");
    res.sendFile(path.join(__dirname, `/${file}.html`));
  } else {
    res.status(404).send("Channel not found!");
  }
});

io.on("connection", (socket) => {
  socket.on("join", (channel) => {
    if (!channels[channel]) return;
    socket.join(channel);
    const { result = "", data = {} } = channels[channel];
    socket.emit("receive", result, data);
  });
});

httpserver.listen(port);
