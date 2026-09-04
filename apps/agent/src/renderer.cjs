const { ipcRenderer } = require("electron");
const { io } = require("socket.io-client");

let socket;
let peer;
let screenStream;
let controllerId;
let config;
let queuedCandidates = [];

const statusEl = document.getElementById("status");
const sessionEl = document.getElementById("session");
const outputEl = document.getElementById("output");
const remoteAudio = document.getElementById("remoteAudio");

async function start() {
  config = await ipcRenderer.invoke("config");
  document.getElementById("server").textContent = config.apiUrl;
  if (!config.agentToken) {
    statusEl.textContent = "Falta AGENT_TOKEN en .env";
    return;
  }
  await loadAudioOutputs();
  socket = io(config.apiUrl, { auth: { token: config.agentToken }, transports: ["websocket", "polling"] });
  socket.on("connect", () => { statusEl.textContent = "En línea y esperando"; });
  socket.on("disconnect", () => { statusEl.textContent = "Desconectado del servidor"; closeSession(); });
  socket.on("connect_error", (error) => { statusEl.textContent = `Error: ${error.message}`; });
  socket.on("control:request", ({ controllerId: id }) => void createSession(id));
  socket.on("signal", ({ data }) => void receiveSignal(data));
  socket.on("control:stop", closeSession);
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
  if (typeof remoteAudio.setSinkId === "function") {
    await remoteAudio.setSinkId(outputEl.value).catch((error) => { statusEl.textContent = `No se pudo usar la salida: ${error.message}`; });
  }
}

async function createSession(id) {
  closeSession();
  controllerId = id;
  statusEl.textContent = "Compartiendo escritorio…";
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: true,
    });
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
      if (peer?.connectionState === "connected") { statusEl.textContent = "Sesión activa"; sessionEl.textContent = "Control remoto activo"; sessionEl.classList.add("live"); }
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
