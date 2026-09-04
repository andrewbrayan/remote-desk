const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

let inputBridge;

function exitCompletely() {
  if (inputBridge) {
    inputBridge.kill();
    inputBridge = undefined;
  }
  app.exit(0);
}

function parseIceServers(value) {
  try {
    const servers = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(servers)) throw new Error("ICE servers must be an array");
    return servers.filter((server) => {
      const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
      return urls.length > 0 && urls.every((url) => typeof url === "string" && /^(stun|turn|turns):/.test(url));
    }).map((server) => ({
      urls: server.urls,
      ...(typeof server.username === "string" && server.username ? { username: server.username } : {}),
      ...(typeof server.credential === "string" && server.credential ? { credential: server.credential } : {}),
    }));
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

function defaultConfig() {
  return {
    apiUrl: process.env.API_URL ?? "http://localhost:8787",
    agentToken: process.env.AGENT_TOKEN ?? "",
    iceServers: parseIceServers(process.env.RTC_ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]'),
    audioOutputDeviceId: process.env.AUDIO_OUTPUT_DEVICE_ID ?? "default",
    platform: process.platform,
  };
}

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  try {
    const stored = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return sanitizeConfig({ ...defaultConfig(), ...stored });
  } catch {
    return defaultConfig();
  }
}

function sanitizeConfig(value) {
  const apiUrl = typeof value?.apiUrl === "string" ? value.apiUrl.trim().replace(/\/+$/, "") : "";
  const agentToken = typeof value?.agentToken === "string" ? value.agentToken.trim() : "";
  if (!/^https?:\/\//i.test(apiUrl)) throw new Error("La URL debe comenzar con http:// o https://");
  if (!agentToken) throw new Error("El token del agente es obligatorio");
  const iceServers = parseIceServers(value.iceServers);
  if (!iceServers.length) throw new Error("Debes configurar al menos un servidor STUN o TURN");
  return {
    apiUrl,
    agentToken,
    iceServers,
    audioOutputDeviceId: typeof value.audioOutputDeviceId === "string" ? value.audioOutputDeviceId : "default",
    platform: process.platform,
  };
}

function saveConfig(value) {
  const safeConfig = sanitizeConfig(value);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(safeConfig, null, 2), { encoding: "utf8", mode: 0o600 });
  return safeConfig;
}

function bridgePath() {
  return app.isPackaged ? path.join(process.resourcesPath, "input-bridge.ps1") : path.join(__dirname, "../resources/input-bridge.ps1");
}

function startInputBridge() {
  if (process.platform !== "win32") return;
  inputBridge = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", bridgePath()], {
    windowsHide: true,
    stdio: ["pipe", "ignore", "pipe"],
  });
  inputBridge.stderr.on("data", (data) => console.error(`Input bridge: ${data}`));
  inputBridge.on("exit", () => { inputBridge = undefined; });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 790,
    minWidth: 480,
    minHeight: 650,
    title: "Remote Desk Agent",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    callback({ video: sources[0], ...(request.audioRequested ? { audio: "loopback" } : {}) });
  });
  ipcMain.on("input", (_event, value) => {
    if (inputBridge?.stdin.writable) inputBridge.stdin.write(`${JSON.stringify(value)}\n`);
  });
  ipcMain.on("app:quit", exitCompletely);
  ipcMain.handle("config:load", loadConfig);
  ipcMain.handle("config:save", (_event, value) => saveConfig(value));
  startInputBridge();
  createWindow();
});

app.on("window-all-closed", exitCompletely);
app.on("before-quit", () => inputBridge?.kill());
