let fileStream;
let recordingFolder;

const fs = require("fs");
const path = require("path");
const siofu = require("socketio-file-upload");

module.exports = function (io, folder) {
  recordingFolder = folder;

  //handle connection event
  io.sockets.on("connection", function (socket) {
    //recorded chunk event handles the incoming chunk
    socket.on("recordedChunk", function (data) {
      handleRecordedChunk(data);
    });

    socket.on("message", function (data) {
      data = JSON.parse(data);

      switch (data.type) {
        case "join":
          handleJoin(socket, data);
          break;
        case "checkRoom":
          handleCheckRoom(socket, data, io);
          break;
        case "offer":
        case "answer":
        case "candidate":
          sendToPeer(io, data);
          break;
        case "message":
        case "whiteboard":
        case "clearWhiteboard":
        case "sync":
          sendToRoom(socket, data);
          break;
      }
    });

    socket.on("disconnect", function () {
      handleDisconnect(socket, io);
    });
  });
};

//handle join event
function handleJoin(socket, data) {
  socket.room = data.room;
  socket.join(data.room);
  data.socketId = socket.id;
  sendToRoom(socket, data);
  handleFileTransfer(socket, data.room);
}

//handle file transfer
function handleFileTransfer(socket, room) {
  var uploader = new siofu();

  // uploader.dir = `${__dirname}/../file_uploads/${room}`;
  uploader.dir = path.join(__dirname, "../public/file_uploads/" + room);

  if (!fs.existsSync(uploader.dir)) {
    fs.mkdirSync(uploader.dir);
  }

  uploader.maxFileSize = process.env.MAX_FILESIZE * 1024 * 1024;

  uploader.listen(socket);

  uploader.on("start", function (event) {
    event.file.name = event.file.name.replaceAll(" ", "_");
  });

  uploader.on("saved", function (event) {
    event.file.clientDetail.file = event.file.base;
    event.file.clientDetail.extension = event.file.meta.extension;
    event.file.clientDetail.username = event.file.meta.userName;

    sendToRoom(socket, {
      type: "file",
      file: event.file.base,
      extension: event.file.meta.extension,
      username: event.file.meta.username,
    });
  });

  //keep this line to prevent crash
  uploader.on("error", function (event) {});
}

//handle disconnect event
function handleDisconnect(socket, io) {
  //remove file_uploads folder by room
  let dirName = path.join(__dirname, "./file_uploads/" + socket.room);
  if (!io.sockets.adapter.rooms[socket.room] && fs.existsSync(dirName)) {
    fs.rmdirSync(dirName, { recursive: true });
  }

  socket.leave(socket.room);
  sendToRoom(socket, { type: "leave", fromSocketId: socket.id });
}

//check room length at the time of login
function handleCheckRoom(socket, data, io) {
  let result;
  let room = io.sockets.adapter.rooms[data.room];

  if (!room || room.length < process.env.USER_LIMIT_PER_ROOM) {
    result = true;
  } else {
    result = false;
  }

  socket.emit(
    "message",
    JSON.stringify({
      type: "checkRoomResult",
      result: result,
      socketId: socket.id,
      initiator: !room,
    })
  );
}

//send the message in particular room
function sendToRoom(socket, data) {
  socket.broadcast.to(socket.room).emit("message", JSON.stringify(data));
}

function sendToPeer(io, data) {
  io.to(data.toSocketId).emit("message", JSON.stringify(data));
}

//write the incoming chunk in the file
function handleRecordedChunk(data) {
  let fileName = recordingFolder + data.room + ".webm";

  fs.stat(fileName, function (err, stat) {
    if (err == null) {
      //file exists
      fileStream.write(Buffer.from(new Uint8Array(data.chunk)));
    } else if (err.code === "ENOENT") {
      //file does not exist
      fileStream = fs.createWriteStream(fileName, { flags: "a" });
      fileStream.write(Buffer.from(new Uint8Array(data.chunk)));
    } else {
      console.log("Some other error: ", err.code);
    }
  });
}
