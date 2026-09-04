import { FormEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type Signal = { type: "offer" | "answer"; sdp: string } | { candidate: RTCIceCandidateInit };
type InputEvent =
  | { type: "move"; x: number; y: number }
  | { type: "button"; button: number; down: boolean; x: number; y: number }
  | { type: "wheel"; delta: number }
  | { type: "key"; key: string; code: string; down: boolean; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };

const API_URL = import.meta.env.VITE_API_URL ?? window.location.origin;

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("remote-token") ?? "");
  const [iceServers, setIceServers] = useState<IceServer[]>(() => JSON.parse(sessionStorage.getItem("remote-ice") ?? "[]"));
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState("Desconectado");
  const [micEnabled, setMicEnabled] = useState(true);
  const [stats, setStats] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | undefined>(undefined);
  const peerRef = useRef<RTCPeerConnection | undefined>(undefined);
  const channelRef = useRef<RTCDataChannel | undefined>(undefined);
  const micRef = useRef<MediaStream | undefined>(undefined);
  const candidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, { auth: { token }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => setStatus("Listo"));
    socket.on("connect_error", (error) => {
      setStatus(error.message === "unauthorized" ? "Sesión expirada" : "Error de conexión");
      if (error.message === "unauthorized") logout();
    });
    socket.on("agent:status", ({ online }: { online: boolean }) => setOnline(online));
    socket.on("control:error", ({ message }: { message: string }) => setStatus(message));
    socket.on("signal", ({ data }: { data: Signal }) => void receiveSignal(data));
    return () => { socket.disconnect(); closePeer(); };
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const pc = peerRef.current;
      if (!pc || pc.connectionState !== "connected") return;
      let fps = 0, width = 0, height = 0;
      (await pc.getStats()).forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") fps = report.framesPerSecond ?? 0;
        if (report.type === "track" && report.kind === "video") { width = report.frameWidth ?? 0; height = report.frameHeight ?? 0; }
      });
      setStats(`${width || "?"}×${height || "?"} · ${Math.round(fps)} fps`);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  function logout() {
    sessionStorage.clear();
    setToken("");
    setIceServers([]);
  }

  async function receiveSignal(data: Signal) {
    if ("type" in data && data.type === "offer") {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers });
      peerRef.current = pc;
      pc.ontrack = ({ streams }) => { if (videoRef.current) videoRef.current.srcObject = streams[0]; };
      pc.ondatachannel = ({ channel }) => {
        channelRef.current = channel;
        channel.onopen = () => setStatus("Controlando");
        channel.onclose = () => setStatus("Conexión cerrada");
      };
      pc.onicecandidate = ({ candidate }) => candidate && socketRef.current?.emit("signal", { data: { candidate: candidate.toJSON() } });
      pc.onconnectionstatechange = () => setStatus(pc.connectionState === "connected" ? "Controlando" : pc.connectionState);
      if (micEnabled) {
        try {
          micRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
          micRef.current.getTracks().forEach((track) => pc.addTrack(track, micRef.current!));
        } catch { setStatus("Sin permiso de micrófono; video disponible"); }
      }
      await pc.setRemoteDescription(data);
      for (const candidate of candidatesRef.current.splice(0)) await pc.addIceCandidate(candidate).catch(() => undefined);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit("signal", { data: pc.localDescription });
    } else if ("candidate" in data) {
      if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(data.candidate).catch(() => undefined);
      else candidatesRef.current.push(data.candidate);
    }
  }

  function closePeer() {
    channelRef.current?.close();
    peerRef.current?.close();
    micRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = undefined;
    peerRef.current = undefined;
    micRef.current = undefined;
    candidatesRef.current = [];
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stop() {
    socketRef.current?.emit("control:stop");
    closePeer();
    setStatus("Desconectado");
  }

  function sendInput(event: InputEvent) {
    const channel = channelRef.current;
    if (channel?.readyState === "open" && channel.bufferedAmount < 64_000) channel.send(JSON.stringify(event));
  }

  function position(event: ReactMouseEvent<HTMLVideoElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const videoRatio = event.currentTarget.videoWidth / event.currentTarget.videoHeight;
    const boxRatio = rect.width / rect.height;
    const drawnWidth = boxRatio > videoRatio ? rect.height * videoRatio : rect.width;
    const drawnHeight = boxRatio > videoRatio ? rect.height : rect.width / videoRatio;
    const left = rect.left + (rect.width - drawnWidth) / 2;
    const top = rect.top + (rect.height - drawnHeight) / 2;
    return { x: Math.max(0, Math.min(1, (event.clientX - left) / drawnWidth)), y: Math.max(0, Math.min(1, (event.clientY - top) / drawnHeight)) };
  }

  if (!token) return <Login onLogin={(newToken, servers) => { setToken(newToken); setIceServers(servers); }} />;
  return (
    <main className="desk" tabIndex={0}
      onKeyDown={(e) => { if (!e.repeat) sendInput({ type: "key", key: e.key, code: e.code, down: true, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }); e.preventDefault(); }}
      onKeyUp={(e) => { sendInput({ type: "key", key: e.key, code: e.code, down: false, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }); e.preventDefault(); }}>
      <header>
        <div><span className="logo">RD</span><strong>Remote Desk</strong></div>
        <div className="actions">
          <span className={online ? "dot online" : "dot"} />{online ? "PC conectado" : "PC desconectado"}
          <label><input type="checkbox" checked={micEnabled} onChange={(e) => setMicEnabled(e.target.checked)} /> Enviar micrófono</label>
          <button disabled={!online} onClick={() => { setStatus("Conectando…"); socketRef.current?.emit("control:request"); }}>Conectar</button>
          <button className="secondary" onClick={stop}>Parar</button>
          <button className="ghost" onClick={logout}>Salir</button>
        </div>
      </header>
      <section className="viewer">
        <video ref={videoRef} autoPlay playsInline
          onMouseMove={(e) => { const now = performance.now(); if (now - lastMoveRef.current > 25) { lastMoveRef.current = now; sendInput({ type: "move", ...position(e) }); } }}
          onMouseDown={(e) => { sendInput({ type: "button", button: e.button, down: true, ...position(e) }); e.currentTarget.parentElement?.parentElement?.focus(); }}
          onMouseUp={(e) => sendInput({ type: "button", button: e.button, down: false, ...position(e) })}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => { sendInput({ type: "wheel", delta: e.deltaY }); e.preventDefault(); }} />
        {!peerRef.current && <div className="empty">Pulsa Conectar para controlar el PC</div>}
        <div className="status">{status}{stats && ` · ${stats}`}</div>
      </section>
    </main>
  );
}

function Login({ onLogin }: { onLogin: (token: string, servers: IceServer[]) => void }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API_URL}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    if (!response.ok) return setError("Usuario o contraseña incorrectos");
    const data = await response.json();
    sessionStorage.setItem("remote-token", data.token);
    sessionStorage.setItem("remote-ice", JSON.stringify(data.iceServers));
    onLogin(data.token, data.iceServers);
  }
  return <main className="login"><form onSubmit={submit}><span className="logo big">RD</span><h1>Remote Desk</h1><p>Acceso al escritorio remoto</p><label>Usuario<input name="username" autoComplete="username" required autoFocus /></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="error">{error}</div>}<button>Entrar</button></form></main>;
}
