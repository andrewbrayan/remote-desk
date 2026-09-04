const { ipcRenderer } = require("electron");
const { io } = require("socket.io-client");

let socket;
let peer;
let screenStream;
let controllerId;
let config;
let queuedCandidates = [];
let systemAudioAvailable = true;

const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session");
const outputEl = document.getElementById("output");
const remoteAudio = document.getElementById("remoteAudio");
const settingsEl = document.getElementById("settings");
const settingsErrorEl = document.getElementById("settingsError");
const saveEl = document.getElementById("save");

async function start() {
  config = await ipcRenderer.invoke("config:load");
  fillSettings();
  settingsEl.addEventListener("submit", saveSettings);
  document.getElementById("quit").addEventListener("click", () => ipcRenderer.send("app:quit"));
  await loadAudioOutputs();
  if (!config.agentToken) {
    statusEl.textContent = "Configura la conexión";
    return;
  }
  connectAgent();
}

function serverUrl(server) {
  return Array.isArray(server?.urls) ? server.urls[0] : server?.urls;
}

function fillSettings() {
  document.getElementById("apiUrl").value = config.apiUrl ?? "";
  document.getElementById("agentToken").value = config.agentToken ?? "";
  const stun = config.iceServers?.find((server) => serverUrl(server)?.startsWith("stun:"));
  const turn = config.iceServers?.find((server) => /^turns?:/.test(serverUrl(server) ?? ""));
  document.getElementById("stunUrl").value = serverUrl(stun) ?? "stun:stun.l.google.com:19302";
  document.getElementById("turnUrl").value = serverUrl(turn) ?? "";
  document.getElementById("turnUsername").value = turn?.username ?? "";
  document.getElementById("turnCredential").value = turn?.credential ?? "";
  document.getElementById("server").textContent = config.apiUrl || "Sin configurar";
}

async function saveSettings(event) {
  event.preventDefault();
  settingsErrorEl.textContent = "";
  saveEl.disabled = true;
  const stunUrl = document.getElementById("stunUrl").value.trim();
  const turnUrl = document.getElementById("turnUrl").value.trim();
  const iceServers = [];
  if (stunUrl) iceServers.push({ urls: stunUrl });
  if (turnUrl) iceServers.push({
    urls: turnUrl,
    username: document.getElementById("turnUsername").value.trim(),
    credential: document.getElementById("turnCredential").value,
  });
  try {
    config = await ipcRenderer.invoke("config:save", {
      apiUrl: document.getElementById("apiUrl").value,
      agentToken: document.getElementById("agentToken").value,
      iceServers,
      audioOutputDeviceId: outputEl.value,
    });
    fillSettings();
    connectAgent();
  } catch (error) {
    settingsErrorEl.textContent = error.message;
  } finally {
    saveEl.disabled = false;
  }
}

function connectAgent() {
  closeSession(false);
  socket?.removeAllListeners();
  socket?.disconnect();
  document.getElementById("server").textContent = config.apiUrl;
  statusEl.textContent = "Conectando…";
  const activeSocket = io(config.apiUrl, { auth: { token: config.agentToken }, transports: ["websocket", "polling"] });
  socket = activeSocket;
  activeSocket.on("connect", () => { if (socket === activeSocket) statusEl.textContent = "En línea y esperando"; });
  activeSocket.on("disconnect", () => { if (socket === activeSocket) { statusEl.textContent = "Desconectado del servidor"; closeSession(false); } });
  activeSocket.on("connect_error", (error) => { if (socket === activeSocket) statusEl.textContent = `Error: ${error.message}`; });
  activeSocket.on("control:request", ({ controllerId: id }) => void createSession(id));
  activeSocket.on("signal", ({ data }) => void receiveSignal(data));
  activeSocket.on("control:stop", closeSession);
}

async function loadAudioOutputs() {
  // Device labels are visible after any media permission has been granted.
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audiooutput");
  outputEl.replaceChildren();
  const fallback = document.createElement("option");
  fallback.value = "default"; fallback.textContent = "Salida predeterminada"; outputEl.appendChild(fallback);
  devices.filter((item) => item.deviceId !== "default").forEach((item, index) => {
    const option = document.createElement("option");
    option.value = item.deviceId; option.textContent = item.label || `Salida de audio ${index + 1}`; outputEl.appendChild(option);
  });
  outputEl.value = [...outputEl.options].some((option) => option.value === config?.audioOutputDeviceId) ? config.audioOutputDeviceId : "default";
  outputEl.addEventListener("change", applyAudioOutput);
}

async function applyAudioOutput() {
  if (config) {
    config.audioOutputDeviceId = outputEl.value;
    void ipcRenderer.invoke("config:save", config).catch(() => undefined);
  }
  if (typeof remoteAudio.setSinkId === "function") {
    await remoteAudio.setSinkId(outputEl.value).catch((error) => { statusEl.textContent = `No se pudo usar la salida: ${error.message}`; });
  }
}

async function createSession(id) {
  closeSession();
  controllerId = id;
  statusEl.textContent = "Compartiendo escritorio…";
  try {
    const videoConstraints = { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } };
    systemAudioAvailable = true;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: true });
    } catch (audioError) {
      console.warn("Desktop audio capture failed; retrying with video only", audioError);
      systemAudioAvailable = false;
      statusEl.textContent = "Audio del PC no disponible; conectando solo video…";
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
    }
    peer = new RTCPeerConnection({ iceServers: config.iceServers });
    screenStream.getTracks().forEach((track) => {
      const sender = peer.addTrack(track, screenStream);
      if (track.kind === "video") {
        const parameters = sender.getParameters();
        parameters.encodings = [{ ...(parameters.encodings?.[0] ?? {}), maxBitrate: 8_000_000, maxFramerate: 30 }];
        parameters.degradationPreference = "maintain-framerate";
        void sender.setParameters(parameters).catch(() => undefined);
      }
    });
    const channel = peer.createDataChannel("input", { ordered: false, maxRetransmits: 0 });
    channel.onmessage = ({ data }) => {
      try { ipcRenderer.send("input", JSON.parse(data)); } catch { /* ignore malformed input */ }
    };
    peer.ontrack = ({ streams }) => {
      remoteAudio.srcObject = streams[0];
      void applyAudioOutput();
      void remoteAudio.play().catch(() => undefined);
    };
    peer.onicecandidate = ({ candidate }) => candidate && socket.emit("signal", { target: controllerId, data: { candidate: candidate.toJSON() } });
    peer.onconnectionstatechange = () => {
      if (peer?.connectionState === "connected") {
        statusEl.textContent = systemAudioAvailable ? "Sesión activa" : "Sesión activa · sin audio del PC";
        sessionEl.textContent = systemAudioAvailable ? "Control remoto activo" : "Control activo · revisa salida de audio de Windows";
        sessionEl.classList.add("live");
      }
      if (["failed", "closed"].includes(peer?.connectionState)) closeSession();
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("signal", { target: controllerId, data: peer.localDescription });
  } catch (error) {
    statusEl.textContent = `No se pudo capturar la pantalla: ${error.message}`;
    closeSession(false);
  }
}

async function receiveSignal(data) {
  if (!peer) return;
  if (data.type === "answer") {
    await peer.setRemoteDescription(data);
    for (const candidate of queuedCandidates.splice(0)) await peer.addIceCandidate(candidate).catch(() => undefined);
  } else if (data.candidate) {
    if (peer.remoteDescription) await peer.addIceCandidate(data.candidate).catch(() => undefined);
    else queuedCandidates.push(data.candidate);
  }
}

function closeSession(resetStatus = true) {
  peer?.close();
  screenStream?.getTracks().forEach((track) => track.stop());
  remoteAudio.srcObject = null;
  peer = undefined; screenStream = undefined; controllerId = undefined; queuedCandidates = [];
  sessionEl.textContent = "Sin sesión activa"; sessionEl.classList.remove("live");
  if (resetStatus && socket?.connected) statusEl.textContent = "En línea y esperando";
}

start().catch((error) => { statusEl.textContent = `Error: ${error.message}`; });
