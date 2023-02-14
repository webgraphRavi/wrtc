import React, { useState, useEffect } from "react";
import "./css/fa.min.css";
import "./css/toastr.min.css";
import "./css/theme.min.css";
import "./css/style.css";
import "../node_modules/bootstrap/dist/js/bootstrap";

import Timer from "easytimer.js";
import $ from "jquery";

import io, { connect } from "socket.io-client";
import {
  signalingURL,
  stunUrl,
  turnPassword,
  turnUrl,
  turnUsername,
} from "./js/config";
import SocketIOFileUpload from "socketio-file-upload";
import CanvasDesigner from "./js/canvasDesigner";
import toastr from "toastr";
import MultiStreamsMixer from "multistreamsmixer";
import filePng from "./images/file.png";
import loaderGif from "./images/loader.gif";
import fs from "fs";
import path from "path";
import mt from "./sounds/message.mp3";

const messageTone = new Audio(mt);
// import event from "event-stream";

function App() {
  const localVideo = document.getElementById("localVideo");

  const socket = io.connect(signalingURL);
  socket.on("connect", function () {
    console.log("connected");
  });

  const userInfo = {
    userName: "john",
    room: "test3",
  };
  const configuration = {
    iceServers: [
      {
        urls: stunUrl,
      },
      {
        urls: turnUrl,
        username: turnUsername,
        credential: turnPassword,
      },
    ],
  };

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const timeNow = +new Date();

  let mixer;
  let uploader;
  let recorder;
  let constraints;
  let localStream;
  let screenStream;
  let localVideoTrack;
  let displayFileUrl;
  let facingMode = "user";
  let micMuted = false;
  let videoMuted = false;
  let initiator = false;
  let screenShared = false;
  let meetingEnded = false;
  let whiteboardAdded = false;
  let timer = new Timer();
  // let messageTone = new Audio("sounds/message.mp3");

  let connections = [];
  let userNames = [];

  let designer = new CanvasDesigner();

  designer.widgetHtmlURL = "/widget";

  // designer.widgetJsURL = "http://localhost/loot-learn-delivery/js/widget.js";
  designer.widgetJsURL = "http://localhost:9000/static/js/widget.js";

  //! listen for timer update event and display during the call
  timer.addEventListener("secondsUpdated", function () {
    $("#timer").html(getCurrentTime());
  });

  //! initialize the call
  function init() {
    $(".callOptions, .call_logo, #videos").show();
    $("body").css("background-color", "#000");

    document.getElementById("localVideo").srcObject = localStream;
    // layout(); todo: check later
    userInfo.type = "join";
    send(userInfo);
    timer.start({
      precision: "seconds",
      startValues: {
        seconds: 0,
      },
    });
    manageOptions();
    $("#localVideo").next("span").text(userInfo.userName);
    if (isMobile) {
      $("#toggleCam").show();
    }
    if (!isMobile) $("#screenShare").show();
    if (!localStorage.getItem("tripDone")) {
      setTimeout(function () {
        showInfo("Double click on the video to make it fullscreen!");
        showInfo(
          "Single click on the video to turn picture-in-picture mode on."
        );
        localStorage.setItem("tripDone", true);
      }, 3000);
    }
    showWhiteboard();
    if (initiator) setTimeout(startRecording, 1000);
  }

  //! hide/show certain call related details
  function manageOptions() {
    $(".start").hide();
    $("#roomName").html(userInfo.room);
    $(".room_info, .videoUserName").show();
  }

  //! socket connected
  socket.on("connect", function () {
    uploader = new SocketIOFileUpload(socket);

    //listen on sendFile button click event
    uploader.listenOnSubmit($("#sendFile")[0], $("#file")[0]);

    //start file upload
    uploader.addEventListener("start", function (event) {
      event.file.meta.extension = event.file.name.substring(
        event.file.name.lastIndexOf(".")
      );
      event.file.meta.username = userInfo.userName;
      showInfo("Uploading the file...");
    });

    //append file when file upload is completed
    uploader.addEventListener("complete", function (event) {
      console.log(event.detail);
      appendFile(event.detail.file, event.detail.extension, null, true);
    });

    //handle file upload error
    uploader.addEventListener("error", function (event) {
      showError(event.message);
    });

    if (1) {
      //check if the room is full or not
      send({
        type: "checkRoom",
        room: userInfo.room,
      });
    } else {
      $("#log").text("Authentication failed!");
    }
  });

  //! handle file
  function handleFile(data) {
    if ($(".chat_panel").is(":hidden")) {
      $("#openMessenger").addClass("notify");
      messageTone.play();
    }
    appendFile(data.file, data.extension, data.username, false);
  }

  //! listen for socket message event and handle it
  socket.on("message", function (data) {
    data = JSON.parse(data);

    switch (data.type) {
      case "join":
        handleJoin(data);
        break;
      case "offer":
        handleOffer(data);
        break;
      case "answer":
        handleAnswer(data);
        break;
      case "candidate":
        handleCandidate(data);
        break;
      case "leave":
        handleLeave(data);
        break;
      case "message":
        handleMessage(data);
        break;
      case "checkRoomResult":
        handleCheckRoomResult(data);
        break;
      case "file":
        handleFile(data);
        break;
      case "whiteboard":
        handleWhiteboard(data.data);
        break;
      case "clearWhiteboard":
        designer.clearCanvas();
        designer.sync();
        break;
      case "sync":
        designer.sync();
        break;
      default:
        return null;
    }
  });

  //! manage checkRoom result
  async function handleCheckRoomResult(data) {
    if (data.result) {
      initiator = data.initiator;

      //the room has space, get the media and initiate the call
      constraints = {
        audio: true,
        video: true,
      };

      try {
        //get user media
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        //show an error if the media device is not available
        showError(
          "Could not get the devices, please check the permissions and try again."
        );
      }

      //init the call if media is available
      if (localStream) {
        init();
      }
    } else {
      //the room is full, show an error to the user
      showError("The room is full!");
    }
  }

  //! create and send an offer for newly joined user
  function handleJoin(data) {
    userNames[data.socketId] = data.userName;

    //initialize a new connection
    let connection = new RTCPeerConnection(configuration);
    connections[data.socketId] = connection;

    setupListeners(connection, data.socketId);

    connection
      .createOffer({
        offerToReceiveVideo: true,
      })
      .then(function (offer) {
        return connection.setLocalDescription(offer);
      })
      .then(function () {
        send({
          type: "offer",
          sdp: connection.localDescription,
          room: userInfo.room,
          userName: userInfo.userName,
          fromSocketId: socket.id,
          toSocketId: data.socketId,
        });
      })
      .catch(function (e) {
        console.log("An error occurred: ", e);
      });
  }

  //! handle offer from initiator, create and send an answer
  function handleOffer(data) {
    userNames[data.fromSocketId] = data.userName;

    //initialize a new connection
    let connection = new RTCPeerConnection(configuration);
    connections[data.fromSocketId] = connection;

    connection.setRemoteDescription(data.sdp);
    //todo: if ice error occurs then setup ".then" after setRemoteDescription

    setupListeners(connection, data.fromSocketId);

    connection
      .createAnswer()
      .then((answer) => {
        setDescriptionAndSendAnswer(answer, data.fromSocketId);
      })
      .catch(function (e) {
        console.log(e);
      });
  }

  function setDescriptionAndSendAnswer(answer, fromSocketId) {
    connections[fromSocketId].setLocalDescription(answer);
    send({
      type: "answer",
      answer: answer,
      room: userInfo.room,
      fromSocketId: socket.id,
      toSocketId: fromSocketId,
    });
  }

  //! handle answer and set remote description
  function handleAnswer(data) {
    let currentConnection = connections[data.fromSocketId];
    if (currentConnection) {
      currentConnection.setRemoteDescription(data.answer);
    }
  }

  //! handle candidate and add ice candidate
  function handleCandidate(data) {
    let currentConnection = connections[data.fromSocketId];

    if (data.candidate && currentConnection) {
      currentConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  var layoutContainer = document.getElementById("videos");
  // var layout = initLayoutContainer(layoutContainer).layout;

  function layout() {
    //
  }

  var resizeTimeout;
  window.onresize = function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function () {
      layout();
    }, 20);
  };

  //! add local track to the connection,
  //! manage remote track,
  //! ice candidate and state change event
  function setupListeners(connection, socketId) {
    localStream
      .getTracks()
      .forEach((track) => connection.addTrack(track, localStream));

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          type: "candidate",
          candidate: event.candidate,
          fromSocketId: socket.id,
          toSocketId: socketId,
        });
      }
    };

    connection.ontrack = (event) => {
      if (document.getElementById("video-" + socketId)) {
        return;
      }

      let videoRemote = document.createElement("video");
      videoRemote.id = "video-" + socketId;
      videoRemote.setAttribute("autoplay", "");
      videoRemote.setAttribute("playsinline", "");
      videoRemote.srcObject = event.streams[0];

      videoRemote.onloadedmetadata = function (e) {
        videoRemote.play();
      };

      if (initiator) console.log("Event steam", event.streams[0]);
      if (initiator) mixer.appendStreams(event.streams[0]); //todo: check later

      let containerDiv = document.createElement("div");
      containerDiv.id = "container-" + socketId;
      containerDiv.className = "videoContainer";

      let containerText = document.createElement("span");
      containerText.className = "videoUserName";
      containerText.innerText = userNames[socketId];

      containerDiv.appendChild(videoRemote);
      containerDiv.appendChild(containerText);
      document.getElementById("videos").appendChild(containerDiv);
      // layoutContainer.appendChild(containerDiv); //todo: check later

      layout();
    };

    connection.addEventListener("connectionstatechange", () => {
      if (connection.connectionState === "connected") {
        showSuccess(userNames[socketId] + " has joined the call.");
        if (designer.pointsLength <= 0) {
          setTimeout(function () {
            send({
              type: "sync",
            });
          }, 1000);
        }
      }
    });
  }

  //! handle when opponent leaves the call
  function handleLeave(data) {
    showWarning(userNames[data.fromSocketId] + " has left the call.");

    let video = document.getElementById("video-" + data.fromSocketId);
    let container = document.getElementById("container-" + data.fromSocketId);

    if (video && container) {
      video.pause();
      video.srcObject = null;
      video.load();
      container.removeChild(video);
      //   videos.removeChild(container); //todo: check later
      layoutContainer.removeChild(container);
      layout();
    }

    let currentConnection = connections[data.fromSocketId];

    if (currentConnection) {
      currentConnection.close();
      currentConnection.onicecandidate = null;
      currentConnection.ontrack = null;
      delete connections[data.fromSocketId];
    }

    if (initiator) mixer.resetVideoStreams(getVideoStreams());
  }

  //! mute/unmute local video
  // $("#toggleVideo").click(
  function toggleVideo() {
    if (videoMuted) {
      localStream.getVideoTracks().forEach((track) => (track.enabled = true));
      // $(this).html("<i class='fa fa-video-slash'></i>");
      document.getElementById("toggleVideo").innerHTML =
        "<i class='fa fa-video-slash'></i>";
      videoMuted = false;
      showSuccess("Video has been unmute.");
    } else {
      localStream.getVideoTracks().forEach((track) => (track.enabled = false));
      // $(this).html("<i class='fa fa-video'></i>");
      document.getElementById("toggleVideo").innerHTML =
        "<i class='fa fa-video'></i>";

      videoMuted = true;
      showSuccess("Video has been muted.");
    }
  }
  // );

  //! mute/unmute local audio
  // $("#toggleMic").click(
  function toggleMic() {
    console.log("micMuted", micMuted);
    if (micMuted) {
      localStream.getAudioTracks().forEach((track) => (track.enabled = true));
      // $(this).html("<i class='fa fa-microphone-slash'></i>");
      document.getElementById("toggleMic").innerHTML =
        "<i class='fa fa-microphone-slash '></i>";
      micMuted = false;
      showSuccess("Mic has been unmute.");
    } else {
      localStream.getAudioTracks().forEach((track) => (track.enabled = false));
      // $(this).html("<i class='fa fa-microphone'></i>");
      document.getElementById("toggleMic").innerHTML =
        "<i class='fa fa-microphone'></i>";
      micMuted = true;
      showSuccess("Mic has been muted.");
    }
  }
  // );

  //! switch front/back camera for mobile users
  // $("#toggleCam").click(
  //   console.log("camera toggle");
  //   alert("camera toggled");
  //   localStream.getVideoTracks().forEach((track) => track.stop());
  //   localStream.removeTrack(localStream.getVideoTracks()[0]);

  //   facingMode = facingMode === "user" ? "environment" : "user";

  //   navigator.mediaDevices
  //     .getUserMedia({
  //       video: {
  //         facingMode: {
  //           exact: facingMode,
  //         },
  //       },
  //     })
  //     .then(function (stream) {
  //       replaceVideoTrack(stream.getVideoTracks()[0]);
  //       // localVideo.srcObject = localStream; //todo: check if needed.
  //     })
  //     .catch(function () {
  //       showError();
  //     });
  // });

  // );

  //! stringify the data and send it to opponent
  function send(data) {
    socket.emit("message", JSON.stringify(data));
  }

  //! before leaving the page, close socket and peer connections
  window.onbeforeunload = function () {
    endMeeting();
  };

  //! end the meeting
  function endMeeting() {
    if (meetingEnded) return;
    if (initiator && recorder) stopRecording();
    if(initiator == false){
      alert("is not an initiator");
      localStream.getTracks().forEach((track) => track.stop());
      $("#localVideo").remove();
  
      $("body")
        .html("<div id='log'>Thank you!</div>")
        .css("background-color", "#202124");
  
      meetingEnded = true;
    }
    else{
      alert("is an initiator");
      socket.close();
      Object.keys(connections).forEach((key) => {
      connections[key].close();
      let video = document.getElementById("video-" + key);
      video.pause();
      video.srcObject = null;
      video.load();
      video.parentNode.removeChild(video);
    });
      localStream.getTracks().forEach((track) => track.stop());
      $("#localVideo").remove();
  
      $("body")
        .html("<div id='log'>Thank you!</div>")
        .css("background-color", "#202124");
  
      meetingEnded = true;
    }
  }

  //! toggle chat panel
  // $(".chat_option").click(
  function chat_option() {
    $(".chat_panel").animate({
      width: "toggle",
    });
    $(".chat_panel").toggleClass("activeChat");
    if ($(".chat_panel").hasClass("activeChat")) {
      $("#videos").css("width", "80%");
      layout();
    } else {
      $("#videos").css("width", "100%");
      layout();
    }

    if ($("#openMessenger").hasClass("notify"))
      $("#openMessenger").removeClass("notify");
  }
  // );

  //! close chat panel
  // $(".close_option").click(
  function close_option() {
    $(".chat_panel").animate({
      width: "toggle",
    });
    $(".chat_panel").removeClass("activeChat");
    $("#videos").css("width", "100%");
    layout();
  }
  // );

  //! enter into fullscreen mode with double click on video
  $(document).on("dblclick", "video", function () {
    if (this.readyState === 4 && this.srcObject.getVideoTracks().length) {
      try {
        this.requestFullscreen();
      } catch (e) {
        showError("Fullscreen mode is not supported in this browser.");
      }
    } else {
      showError("The video is not playing or has no video track.");
    }
  });

  //! toggle picture-in-picture mode with click on video
  $(document).on("click", "video", function () {
    if (isMobile) return;

    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else {
      if (this.readyState === 4 && this.srcObject.getVideoTracks().length) {
        try {
          this.requestPictureInPicture();
        } catch (e) {
          showError(
            "Picture-in-picture mode is not supported in this browser."
          );
        }
      } else {
        showError("The video is not playing or has no video track.");
      }
    }
  });

  //! listen for message form submit event and send message
  // $(document).on("submit", "messengerForm",
  function onSubmit(e) {
    console.log("evens", e.target[0].value);
    e.preventDefault();

    let message = e.target[0].value;
    // $("#messageInput").val().trim();
    // console.log("message", message);

    if (message) {
      $("#messageInput").val("");
      appendMessage(message, null, true);

      send({
        type: "message",
        message: message,
        username: userInfo.userName,
      });
    }
  }
  // );

  //! handle message and append it
  function handleMessage(data) {
    if ($(".chat_panel").is(":hidden")) {
      $("#openMessenger").addClass("notify");
      messageTone.play();
    }
    appendMessage(data.message, data.username, false);
  }

  //! append message to chat body
  function appendMessage(message, username, self) {
    if ($(".empty_chat_body")) {
      $(".empty_chat_body").remove();
    }

    let messageDiv =
      "<div class='" +
      (self ? "my_chat_right" : "user_chat_left") +
      "'>" +
      "<div>" +
      (username
        ? "<span class='remote-chat-name'>" + username + ": </span>"
        : "") +
      message +
      "</div>" +
      "</div>";

    $(".chat_body")
      .append(messageDiv)
      .animate(
        {
          scrollTop: $(".chat_body").prop("scrollHeight"),
        },
        1000
      );
  }

  //! toggle screen share
  // $("#screenShare").click(
  function screenShare() {
    if (screenShared) {
      stopScreenSharing();
    } else {
      startScreenSharing();
    }
  }
  // );

  //! stop screen share
  function stopScreenSharing() {
    localStream.getVideoTracks().forEach((track) => track.stop());
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    screenStream = null;
    replaceVideoTrack(localVideoTrack);
    screenShared = false;
  }

  function replaceVideoTrack(videoTrack) {
    Object.values(connections).forEach((connection) => {
      let sender = connection.getSenders().find(function (s) {
        return s.track.kind === videoTrack.kind;
      });

      sender.replaceTrack(videoTrack);
    });

    localStream.addTrack(videoTrack);
  }

  //! start screen share
  async function startScreenSharing() {
    let displayMediaOptions = {
      video: {
        cursor: "always",
      },
      audio: false,
    };

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia(
        displayMediaOptions
      );
    } catch (e) {
      showError(
        "Could not share the screen, please check the permissions and try again."
      );
    }

    if (screenStream) {
      screenShared = true;

      let screenVideoTrack = screenStream.getVideoTracks()[0];
      replaceVideoTrack(screenVideoTrack);
      //todo: exchange the order of replaceVideoTrack and removeTrack
      localVideoTrack = localStream.getVideoTracks()[0];
      localStream.removeTrack(localStream.getVideoTracks()[0]);

      screenStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScreenSharing();
      });
    }
  }

  //! get current call time in readable format
  function getCurrentTime() {
    return timer.getTimeValues().toString(["minutes", "seconds"]);
  }

  //! show success toaster
  function showSuccess(message) {
    toastr.success(message);
  }

  //! show warning toaster
  function showWarning(message) {
    toastr.warning(message);
  }

  //! show error toaster
  function showError(message) {
    toastr.error(message || "An error occurred, please try again.");
  }

  //! show warning toaster
  function showInfo(message) {
    toastr.info(message);
  }

  //! open file exploler
  $(document).on("click", "#selectFile", function () {
    $("#file").trigger("click");
  });

  //! dispay file on button click
  $(document).on("click", ".fileMessage", function () {
    let filename = $(this).data("file");
    let extension = $(this).data("extension");

    $("#displayImage").attr("src", loaderGif);
    $("#displayFilename").text(filename + extension);
    // $("#displayModal").modal("show");
    document.getElementById("displayModal").style.display = "block";
    document.getElementById("displayModal").classList.add("show");

    /* console.log(
      "file detch",
      "./file_uploads/" + userInfo.room + "/" + filename + extension
    ); */

    fetch("./file_uploads/" + userInfo.room + "/" + filename + extension)
      .then((res) => {
        console.log("res", res);
        return res.blob();
      })
      .then((blob) => {
        displayFileUrl = window.URL.createObjectURL(blob);

        console.log("=====", displayFileUrl);

        //  " D:/Projects/office_projects/lootlearn/lootlearn_web_rtc/file_uploads/test2/1674472117188.png"
        // console.log("display", displayFileUrl, blob);
        // displayFileUrl = Buffer.from(
        //   "./file_uploads/" + userInfo.room + "/" + filename + extension
        // );

        if ([".png", ".jpg", ".jpeg", ".gif"].includes(extension)) {
          $("#displayImage").attr("src", displayFileUrl);
        } else {
          $("#displayImage").attr("src", filePng);
        }
      })
      .catch((error) => {
        showError();
        console.log("Error", error);
      });
  });

  //! download file on button click
  $(document).on("click", "#downloadFile", function () {
    // let fileDetails = $(".fileMessage"),
    //   filename = fileDetails.data("file"),
    //   extension = fileDetails.data("extension");
    // let filename = document.getElementById("file");

    // let filename = $(this).data("file");
    // let extension = $(this).data("extension");

    // console.log("filename", filename);
    // let extension = $(this).data("extension");

    // console.log(
    //   "file path",
    //   "./file_uploads/" + userInfo.room + "/" + "1674472117188.png"
    // );
    // window.open(
    //   "./file_uploads/" + userInfo.room + "/" + filename + extension,
    //   "_blank"
    // );
    /* const link = document.createElement("a");
    link.style.display = "none";
    // link.href = "./file_uploads/" + userInfo.room + "/" + filename + extension;
    link.download = $("#displayFilename").text(); //todo: check
    console.log(link.href);
    console.log(link);
    document.body.appendChild(link);
    link.click();
    // $("#displayModal").modal("hide");
    document.getElementById("displayModal").style.display = "none";
    document.getElementById("displayModal").classList.remove("show");
    window.URL.revokeObjectURL(
      "./file_uploads/" + userInfo.room + "/" + filename + extension
    ); */

    //original code
    const link = document.createElement("a");
    link.style.display = "none";
    link.href = displayFileUrl;
    link.download = $("#displayFilename").text();
    document.body.appendChild(link);
    link.click();
    $("#displayModal").modal("hide");
    window.URL.revokeObjectURL(displayFileUrl);
  });

  //! empty file value on modal close
  $("#previewModal").on("hidden.bs.modal", function () {
    // $("#file").val("");
    document.getElementById("file").value = "";
    alert("file cleared");
  });

  //! hide modal on file send button click
  $(document).on("click", "#sendFile", function () {
    // $("#previewModal").modal("hide");
    document.getElementById("previewModal").style.display = "none";
    document.getElementById("previewModal").classList.remove("show");
  });

  //! append file to the chat panel
  function appendFile(file, extension, username, self) {
    if ($(".empty_chat_body")) {
      $(".empty_chat_body").remove();
    }

    let remoteUsername = username
      ? '<span class="remote-chat-name">' + username + ": </span>"
      : "";

    let className = self ? "my_chat_right" : "user_chat_left",
      fileDiv =
        "<div class='" +
        className +
        "'>" +
        "<div>" +
        remoteUsername +
        "<button class='btn btn-primary fileMessage' title='View File' data-file='" +
        file +
        "' data-extension='" +
        extension +
        "'><i class='fa fa-file'></i> " +
        file +
        extension +
        "</button></div>";

    $(".chat_body").append(fileDiv);
    $(".chat_body").animate(
      {
        scrollTop: $(".chat_body").prop("scrollHeight"),
      },
      1000
    );
  }

  //! listen on file input change
  // $("#file").on("change",
  async function fileChange(e) {
    let inputFile = e.target.files;
    let maxFilesize = $(this).data("max");
    let filename = $(this).data("file");
    let extension = $(this).data("extension");

    if (inputFile && inputFile[0]) {
      if (inputFile[0].size > maxFilesize * 1024 * 1024) {
        showError("Maximum file size allowed (MB): " + maxFilesize);
        return;
      }

      $("#previewImage").attr("src", loaderGif);
      $("#previewFilename").text(inputFile[0].name);

      document.getElementById("previewModal").style.display = "block";
      document.getElementById("previewModal").classList.add("show");
      // $("#previewModal").modal("show");

      if (inputFile[0].type.includes("image")) {
        let reader = new FileReader();
        reader.onload = function (e) {
          $("#previewImage").attr("src", e.target.result);
        };
        reader.readAsDataURL(inputFile[0]);
        // fs.writeFile(
        //   "./file_uploads/" + userInfo.room + "/" + filename + extension,
        //   reader.readAsDataURL(inputFile[0]),
        //   "base64",
        //   function (err) {
        //     console.log("Error in Upload file to uploads", err);
        //   }
        // );
      } else {
        $("#previewImage").attr("src", filePng);
      }
    } else {
      showError();
    }
  }
  // );

  //! add listner to whiteboard
  designer.addSyncListener(function (data) {
    send({
      type: "whiteboard",
      data: data,
    });
  });

  //! set whiteboard tools
  designer.setTools({
    line: true,
    arrow: true,
    pencil: true,
    marker: true,
    dragSingle: false,
    dragMultiple: false,
    eraser: true,
    rectangle: true,
    arc: false,
    bezier: false,
    quadratic: true,
    text: true,
    image: false,
    pdf: false,
    zoom: false,
    lineWidth: false,
    colorsPicker: false,
    extraOptions: false,
    code: false,
    undo: true,
    snap: true,
    clear: true,
  });

  designer.icons = {
    pencil: "http://localhost:9000/static/images/pencil.png",
    marker: "http://localhost:9000/static/images/marker.png",
    eraser: "http://localhost:9000/static/images/eraser.png",
    text: "http://localhost:9000/static/images/text.png",
    line: "http://localhost:9000/static/images/line.png",
    arrow: "http://localhost:9000/static/images/arrow.png",
    rectangle: "http://localhost:9000/static/images/rectangle.png",
    quadratic: "http://localhost:9000/static/images/curve.png",
    undo: "http://localhost:9000/static/images/undo.png",
    snap: "http://localhost:9000/static/images/camera.png",
    clear: "http://localhost:9000/static/images/clear.png",
  };

  //! show whiteboard
  function showWhiteboard() {
    $("#videos").addClass("set-videos");
    $("#whiteboardSection").addClass("set-whiteboard");
    layout();

    appendWhiteboard();
  }

  //! append whiteboard
  function appendWhiteboard() {
    if (whiteboardAdded) return;
    designer.appendTo(document.getElementById("whiteboardSection"));
    whiteboardAdded = true;

    //! set onload event on iframe
    $("iframe").on("load", function () {
      $("iframe")
        .contents()
        .on("click", "#clear", function () {
          send({
            type: "clearWhiteboard",
          });
        });
    });
  }

  //! handle new event on whiteboard
  function handleWhiteboard(data) {
    if (whiteboardAdded) {
      designer.syncData(data);
    } else {
      showWhiteboard();

      setTimeout(function () {
        designer.syncData(data);
      }, 3000);
    }
  }

  //! page scroll
  $("a.page-scroll").bind("click", function (event) {
    var $anchor = $(this);
    $("html, body")
      .stop()
      .animate(
        {
          scrollTop: $($anchor.attr("href")).offset().top - 20,
        },
        1000
      );
    event.preventDefault();
  });

  //! start the recording and send chunks to the server
  function startRecording() {
    console.log("in startRecording.......");
    mixer = new MultiStreamsMixer(getVideoStreams());
    console.log("mixer", mixer);
    mixer.frameInterval = 1;
    mixer.startDrawingFrames();

    recorder = new MediaRecorder(mixer.getMixedStream(), {
      mimeType: "video/webm;codecs=vp8,opus",
    });

    recorder.start(1000);

    recorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) {
        socket.emit("recordedChunk", {
          room: userInfo.room + "_" + timeNow,
          chunk: e.data,
        });
      }
    };
  }

  //! stop recording and notify opponent
  function stopRecording() {
    mixer.releaseStreams();
    recorder.stop();
  }

  //! get all the audio and video streams
  function getVideoStreams() {
    let videoStreams = [];

    $("video").each((key, value) => {
      videoStreams.push(value.srcObject);
    });

    console.log($("iframe").contents().find("#main-canvas")[0]);

    videoStreams.push(
      $("iframe").contents().find("#main-canvas")[0].captureStream()
    );

    designer.renderStream();

    return videoStreams;
  }

  return (
    <div className="App">
      <div>
        <div id="log">Please wait...</div>
        <div className="room_info">
          <span id="roomName" className=""></span>
          <span id="timer" className="">
            00:00
          </span>
        </div>

        {/* chat panel starts here  */}
        <div className="chat_panel">
          <div className="chat_box">
            <div className="chat_header">
              Messages
              <i
                className="fas fa-times close_option"
                onClick={() => close_option()}
              ></i>
            </div>
            <div className="chat_body">
              <div className="empty_chat_body">
                <i className="fa fa-comments chat_icon_show"></i>
              </div>
            </div>
            <div className="chat_footer">
              <form id="messengerForm" onSubmit={onSubmit}>
                <div className="input-group">
                  <input
                    type="text"
                    name="messageInput"
                    id="messageInput"
                    className="form-control note_input"
                    placeholder="Type a message"
                    autoComplete="new-message"
                  />
                  <div className="input-group-append">
                    <button
                      id="sendMessage"
                      name="sendMessage"
                      className="btn btn-outline-secondary"
                      type="submit"
                      title="Send"
                    >
                      SEND
                    </button>
                    <button
                      id="selectFile"
                      className="btn btn-outline-secondary"
                      title="Attach File"
                      type="button"
                    >
                      <i className="fas fa-paperclip"></i>
                    </button>
                  </div>
                </div>
              </form>
              <input
                type="file"
                name="file"
                id="file"
                data-max="50"
                hidden
                onChange={fileChange}
              />
            </div>
          </div>
        </div>
        {/* chat panel ends here  */}

        <a className="navbar-brand heading-black call_logo" href="/">
          Loot Learn
        </a>

        <div className="row">
          <div id="videos">
            <div className="videoContainer">
              <video id="localVideo" autoPlay playsInline muted></video>
              <span className="videoUserName"></span>
              <span className="recording_icon">
                <i className="fas fa-circle"></i>
              </span>
            </div>
          </div>
        </div>

        <div id="whiteboardSection"></div>

        <div className="callOptions">
          <button
            className="btn action_opt_btn chat_option"
            title="Messenger"
            id="openMessenger"
            onClick={() => chat_option()}
          >
            {" "}
            <i className="far fa-comment-alt"></i>{" "}
          </button>
          <button
            className="btn action_opt_btn"
            title="Toggle Mic"
            id="toggleMic"
            onClick={() => toggleMic()}
          >
            <i className="fa fa-microphone"></i>
          </button>
          <button
            className="btn action_opt_btn"
            title="Toggle Video"
            id="toggleVideo"
            onClick={() => toggleVideo()}
          >
            {" "}
            <i className="fas fa-video-slash"></i>{" "}
          </button>
          <button
            className="btn action_opt_btn"
            title="Toggle Camera"
            id="toggleCam"
            // onClick={() => toggleCam()}
          >
            {" "}
            <i className="fas fa-camera"></i>{" "}
          </button>
          <button
            className="btn action_opt_btn"
            title="ScreenShare"
            id="screenShare"
            onClick={() => screenShare()}
          >
            {" "}
            <i className="fa fa-desktop"></i>{" "}
          </button>
          <button
            className="btn btn-danger"
            title="Hangup"
            id="hangup"
            onClick={() => endMeeting()}
          >
            {" "}
            <i className="fas fa-phone"></i>{" "}
          </button>
        </div>

        <div
          className="modal fade"
          id="previewModal"
          tabIndex="-1"
          role="dialog"
          aria-labelledby="previewModalLabel"
          aria-hidden="true"
        >
          <div className="modal-dialog" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="previewModalLabel">
                  File Preview
                </h5>
                <button
                  type="button"
                  className="close"
                  data-dismiss="modal"
                  aria-label="Close"
                  onClick={() => {
                    document.getElementById("previewModal").style.display =
                      "none";
                    document
                      .getElementById("previewModal")
                      .classList.remove("show");
                  }}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <img id="previewImage" src="" alt="previewImg" />
                <p id="previewFilename"></p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-dismiss="modal"
                >
                  Cancel
                </button>
                <button type="button" id="sendFile" className="btn btn-primary">
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          className="modal fade"
          id="displayModal"
          tabIndex="-1"
          role="dialog"
          aria-labelledby="displayModalLabel"
          aria-hidden="true"
        >
          <div className="modal-dialog" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="displayModalLabel">
                  File Display
                </h5>
                <button
                  type="button"
                  className="close"
                  data-dismiss="modal"
                  aria-label="Close"
                  onClick={() => {
                    document.getElementById("displayModal").style.display =
                      "none";
                    document
                      .getElementById("displayModal")
                      .classList.remove("show");
                  }}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="modal-body">
                <img id="displayImage" src="" alt="dispImg" />
                <p id="displayFilename"></p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-dismiss="modal"
                >
                  Close
                </button>
                <button
                  type="button"
                  id="downloadFile"
                  className="btn btn-primary"
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
