import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function iceServers(): IceServer[] {
  const raw = process.env.RTC_ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]';
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("must be an array");
    return value;
  } catch (error) {
    throw new Error(`RTC_ICE_SERVERS must be valid JSON: ${String(error)}`);
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  username: required("WEB_USERNAME", process.env.NODE_ENV === "test" ? "admin" : undefined),
  password: required("WEB_PASSWORD", process.env.NODE_ENV === "test" ? "test-password" : undefined),
  jwtSecret: required("JWT_SECRET", process.env.NODE_ENV === "test" ? "test-secret" : undefined),
  agentToken: required("AGENT_TOKEN", process.env.NODE_ENV === "test" ? "test-agent-token" : undefined),
  iceServers: iceServers(),
};
