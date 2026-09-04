import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { attachSignaling } from "./signaling.js";

const server = http.createServer(createApp());
const io = new Server(server, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 100_000 });
attachSignaling(io);
server.listen(config.port, () => console.log(`Remote Desk API listening on :${config.port}`));
