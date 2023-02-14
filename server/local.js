const path = require("path");

require("dotenv").config();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
app.use("/static", express.static(path.join(__dirname, "uploads")));
const io = require("socket.io").listen(server);

app.get("/", (req, res) => {
  res.send("hello from lootlearn webrtc server");
});
const listner = server.listen(process.env.PORT, function () {
  console.log("Listening on", listner.address().port);
});

require("./socket")(io, "./../src/recordings/");
