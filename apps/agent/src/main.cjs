const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");

let inputBridge;

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
    width: 560,
    height: 580,
    minWidth: 480,
    minHeight: 480,
    title: "Remote Desk Agent",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    callback({ video: sources[0], audio: "loopback" });
  });
  ipcMain.on("input", (_event, value) => {
    if (inputBridge?.stdin.writable) inputBridge.stdin.write(`${JSON.stringify(value)}\n`);
  });
  ipcMain.handle("config", () => ({
    apiUrl: process.env.API_URL ?? "http://localhost:8787",
    agentToken: process.env.AGENT_TOKEN ?? "",
    iceServers: JSON.parse(process.env.RTC_ICE_SERVERS ?? '[{"urls":"stun:stun.l.google.com:19302"}]'),
    audioOutputDeviceId: process.env.AUDIO_OUTPUT_DEVICE_ID ?? "default",
    platform: process.platform,
  }));
  startInputBridge();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => inputBridge?.kill());
