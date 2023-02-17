const path = require("path");

require("dotenv").config();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
app.use("/static", express.static(path.join(__dirname, "uploads")));
const io = require("socket.io").listen(server);
app.use(express.static(path.join(__dirname, '../build')));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, '../build', 'index.html'));
});
const listner = server.listen(process.env.PORT, function () {
  console.log("Listening on", listner.address().port);
});

require("./socket")(io, "./../src/recordings/");
