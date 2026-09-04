import type { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

type Role = "agent" | "controller";
type AuthSocket = Socket & { data: { role: Role } };

export function attachSignaling(io: Server) {
  let agentId: string | undefined;
  let controllerId: string | undefined;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string") return next(new Error("unauthorized"));
    if (token === config.agentToken) {
      socket.data.role = "agent";
      return next();
    }
    try {
      const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
      if (payload.role !== "controller") throw new Error("bad role");
      socket.data.role = "controller";
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthSocket;
    if (socket.data.role === "agent") {
      if (agentId && agentId !== socket.id) io.sockets.sockets.get(agentId)?.disconnect(true);
      agentId = socket.id;
      io.emit("agent:status", { online: true });
    } else {
      socket.emit("agent:status", { online: Boolean(agentId) });
    }

    socket.on("control:request", () => {
      if (socket.data.role !== "controller") return;
      if (!agentId) return socket.emit("control:error", { message: "El PC no está conectado" });
      if (controllerId && controllerId !== socket.id) {
        return socket.emit("control:error", { message: "El PC ya está siendo controlado" });
      }
      controllerId = socket.id;
      io.to(agentId).emit("control:request", { controllerId: socket.id });
    });

    socket.on("signal", (message: { target?: string; data?: unknown }) => {
      if (!message || !message.data) return;
      if (socket.data.role === "agent" && controllerId && message.target === controllerId) {
        io.to(controllerId).emit("signal", { from: socket.id, data: message.data });
      } else if (socket.data.role === "controller" && socket.id === controllerId && agentId) {
        io.to(agentId).emit("signal", { from: socket.id, data: message.data });
      }
    });

    socket.on("control:stop", () => {
      if (socket.data.role === "controller" && socket.id === controllerId) {
        if (agentId) io.to(agentId).emit("control:stop");
        controllerId = undefined;
      }
    });

    socket.on("disconnect", () => {
      if (socket.id === agentId) {
        agentId = undefined;
        controllerId = undefined;
        io.emit("agent:status", { online: false });
      }
      if (socket.id === controllerId) {
        controllerId = undefined;
        if (agentId) io.to(agentId).emit("control:stop");
      }
    });
  });
}
