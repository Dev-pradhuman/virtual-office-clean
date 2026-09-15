const { startServer } = require('./backend/server');

// This file is used specifically for hosting the backend on a cloud provider 
// (like Render, Railway, Heroku, or an AWS VPS) 24/7.
// It runs ONLY the Express & Socket.IO server, without launching the Electron Desktop GUI.

startServer();
