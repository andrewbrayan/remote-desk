import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post(
    "/api/login",
    rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
    (req, res) => {
      const username = typeof req.body?.username === "string" ? req.body.username : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!same(username, config.username) || !same(password, config.password)) {
        res.status(401).json({ error: "Usuario o contraseña incorrectos" });
        return;
      }
      const token = jwt.sign({ role: "controller", sub: username }, config.jwtSecret, { expiresIn: "8h" });
      res.json({ token, iceServers: config.iceServers });
    },
  );

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (process.env.SERVE_WEB !== "false" && fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }
  return app;
}
