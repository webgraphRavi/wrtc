/*jshint esversion: 6 */
/*jshint node: true */
"use strict";

require('dotenv').config();

const express = require('express')();
const fs = require('fs');
const options = {
    key: fs.readFileSync(process.env.KEY_PATH),
    cert: fs.readFileSync(process.env.CERT_PATH)
};
const https = require('https').Server(options, express);
const io = require('socket.io')(https);
const listner = https.listen(process.env.PORT, function() {
    console.log('Listening on ', listner.address().port);
});

require('./socket')(io, './../recordings/');
