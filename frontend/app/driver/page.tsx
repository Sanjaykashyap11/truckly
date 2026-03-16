"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Mic, MicOff, Truck, Clock, AlertTriangle,
  PhoneCall, PhoneOff, Zap, MapPin,
  Package, MessageSquare, Navigation, ChevronRight, User,
} from "lucide-react";

const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:8080";
const API_URL = process.env.NEXT_PUBLIC_API_URL  || "http://localhost:8080";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#080808";
const CARD    = "rgba(255,255,255,0.04)";
const BORDER  = "rgba(255,255,255,0.08)";
const ACCENT  = "#3b82f6";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const DANGER  = "#ef4444";
const TEXT    = "#f1f5f9";
const TEXT2   = "#94a3b8";
const TEXT3   = "#475569";

const QUICK_PROMPTS = [
  { label: "My hours?",    text: "Hey Trucky, how are my hours looking?" },
  { label: "Fuel stop",    text: "Trucky, I need to find a fuel stop soon." },
  { label: "Route check",  text: "My GPS is showing a faster route through Merritt Parkway. Is it safe for my truck?" },
  { label: "Breakdown!",   text: "Trucky — tire blowout. I'm on I-95 westbound near Exit 24 New Jersey." },
  { label: "Push through?",text: "Receiver wants me to push through and deliver tonight. Can I make it on my hours?" },
  { label: "Msg dispatch", text: "Trucky, please let the dispatcher know I'm running about 45 minutes late due to traffic." },
];

const TOOL_LABELS: Record<string, string> = {
  check_hos_status: "Checking HOS status",
  check_route_safety: "Checking route safety",
  find_fuel_stops: "Finding fuel stops",
  handle_breakdown: "Activating breakdown protocol",
  notify_stakeholders: "Notifying stakeholders",
  send_message_to_dispatcher: "Messaging dispatcher",
};

interface Transcript  { id: string; speaker: "driver" | "trucky"; text: string; timestamp: Date; }
interface ToolActivity { id: string; tool: string; result?: Record<string, unknown>; timestamp: Date; }
interface DriverLoad  { id: string; origin: string; destination: string; status: string; pickup_date: string; delivery_date: string; rate: number; commodity: string; notes?: string; driver_name?: string; }
interface DispatchMsg { id: string; driver_name: string; text: string; new_eta: string; urgency: string; read: boolean; timestamp: string; direction: string; }

// ═══════════════════════════════════════════════════════════════
// DRIVER SELECTOR SCREEN
// ═══════════════════════════════════════════════════════════════
function DriverSelector() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/api/drivers`)
      .then(r => r.json())
      .then(data => { setDrivers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = drivers.filter(d => {
    const name = (d.name as string || "").toLowerCase();
    const truck = (d.truck as string || "").toLowerCase();
    const q = search.toLowerCase();
    return !q || name.includes(q) || truck.includes(q);
  });

  const statusColor = (s: string) =>
    s === "on_route" ? ACCENT : s === "resting" ? SUCCESS : s === "off_duty" ? TEXT3 : WARNING;

  const statusLabel = (s: string) =>
    s === "on_route" ? "On Route" : s === "resting" ? "Resting" : s === "off_duty" ? "Off Duty" : "Available";

  return (
    <div style={{ minHeight: "100dvh", background: BG, fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", WebkitFontSmoothing: "antialiased", color: TEXT }}>
      {/* Header */}
      <div style={{ padding: "24px 20px 16px", borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: BG, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Truck style={{ width: 18, height: 18, color: "#fff" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}>Trucky Driver</div>
            <div style={{ fontSize: 12, color: TEXT3 }}>Select your profile to continue</div>
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search driver or truck..."
          style={{
            width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 12,
            border: `1px solid ${BORDER}`, background: CARD, color: TEXT,
            fontSize: 14, outline: "none",
          }}
        />
      </div>

      {/* Driver list */}
      <div style={{ padding: "12px 20px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: TEXT3 }}>Loading fleet...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: TEXT3 }}>No drivers found</div>
        ) : filtered.map((d, i) => {
          const hos = d.hos as Record<string, number> | undefined;
          const driveRem = hos?.drive_time_remaining_mins ?? 0;
          const dh = Math.floor(driveRem / 60);
          const dm = driveRem % 60;
          const status = (d.status as string) || "available";
          const tel = d.telemetry as Record<string, unknown> | null | undefined;
          const fuel = tel?.fuel_percent != null ? Math.round(Number(tel.fuel_percent)) : null;
          const loc = (d.current_location as Record<string, unknown> | undefined)?.address as string || "";

          return (
            <button
              key={String(d.id) + i}
              onClick={() => router.push(`/driver?id=${d.id}`)}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16,
                cursor: "pointer", textAlign: "left", width: "100%", transition: "border-color 0.15s",
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(59,130,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <User style={{ width: 22, height: 22, color: ACCENT }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>{d.name as string}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: `${statusColor(status)}18`, color: statusColor(status) }}>
                    {statusLabel(status)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: TEXT3, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Truck style={{ width: 11, height: 11 }} /> {d.truck as string || "N/A"}
                  </span>
                  {loc && <span style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <MapPin style={{ width: 10, height: 10, flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{loc.split(",")[0]}</span>
                  </span>}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: driveRem < 60 ? DANGER : driveRem < 180 ? WARNING : SUCCESS, fontVariantNumeric: "tabular-nums" }}>
                  {dh}h {String(dm).padStart(2, "0")}m
                </span>
                {fuel != null && (
                  <span style={{ fontSize: 11, color: fuel < 20 ? DANGER : fuel < 40 ? WARNING : TEXT3 }}>
                    ⛽ {fuel}%
                  </span>
                )}
              </div>
              <ChevronRight style={{ width: 16, height: 16, color: TEXT3, flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN DRIVER SESSION
// ═══════════════════════════════════════════════════════════════
function DriverSession({ driverId }: { driverId: string }) {
  const router = useRouter();

  const [isConnected, setIsConnected]     = useState(false);
  const [isListening, setIsListening]     = useState(false);
  const [isTruckyTalking, setIsTruckyTalking] = useState(false);
  const [transcripts, setTranscripts]     = useState<Transcript[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [connStatus, setConnStatus]       = useState<"idle"|"connecting"|"connected"|"error">("idle");
  const [driverInfo, setDriverInfo]       = useState<Record<string, unknown> | null>(null);
  const [allLoads, setAllLoads]           = useState<DriverLoad[]>([]); // all loads — filtered to driver at render time
  const [messages, setMessages]           = useState<DispatchMsg[]>([]);
  const [activeTab, setActiveTab]         = useState<"chat"|"loads"|"messages">("chat");

  const wsRef           = useRef<WebSocket | null>(null);
  const playbackCtxRef  = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef<number>(0);
  const processorRef    = useRef<ScriptProcessorNode | null>(null);
  const sourceRef       = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const truckyBufRef     = useRef("");
  const truckyTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userBufRef       = useRef("");
  const userTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedup: suppress identical text shown within 8 seconds (backend sometimes sends twice)
  const lastShownRef     = useRef<Record<string, {text: string; at: number}>>({});

  // Fetch driver info & loads & messages — chain driver fetch first so name is fresh for filtering
  const refresh = useCallback(() => {
    fetch(`${API_URL}/api/drivers/${driverId}`)
      .then(r => r.json())
      .then(info => {
        setDriverInfo(info);
        // Fetch loads using fresh driver info (not stale state)
        return fetch(`${API_URL}/api/loads`).then(r => r.json()).then((loads: DriverLoad[]) => {
          if (!Array.isArray(loads)) return;
          setAllLoads(loads); // store all loads — filter at render time with fresh driverInfo
        });
      })
      .catch(() => {});
    fetch(`${API_URL}/api/messages?driver_id=${driverId}`).then(r => r.json()).then((msgs: DispatchMsg[]) => {
      if (Array.isArray(msgs)) setMessages(msgs.reverse());
    }).catch(() => {});
  }, [driverId]);

  useEffect(() => {
    const t = setInterval(refresh, 10000);
    refresh();
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // ─── Audio playback ──────────────────────────────────────────
  const scheduleChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const pcm16  = new Int16Array(pcmBuffer);
    const f32    = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) f32[i] = pcm16[i] / 32768.0;
    const ab = ctx.createBuffer(1, f32.length, 24000);
    ab.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = ab; src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, playbackTimeRef.current);
    src.start(startAt);
    playbackTimeRef.current = startAt + ab.duration;
    src.onended = () => { if (playbackTimeRef.current <= ctx.currentTime + 0.05) setIsTruckyTalking(false); };
  }, []);

  // ─── WebSocket ───────────────────────────────────────────────
  const stopMic = useCallback(() => {
    processorRef.current?.disconnect(); sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current = null; sourceRef.current = null; streamRef.current = null;
    setIsListening(false);
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnStatus("connecting"); setError(null);
    audioCtxRef.current = new AudioContext();
    playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    playbackTimeRef.current = 0;

    const ws = new WebSocket(`${WS_URL}/ws/voice/${driverId}`);
    wsRef.current = ws;
    ws.onopen  = () => { setIsConnected(true); setConnStatus("connected"); };
    ws.onclose = (ev) => {
      setIsConnected(false); setIsListening(false); setIsTruckyTalking(false); stopMic();
      if (ev.code === 1011 || ev.code === 1006) {
        setConnStatus("connecting");
        setTranscripts(p => [...p, { id: Date.now().toString(), speaker: "trucky", text: "Connection lost — reconnecting...", timestamp: new Date() }]);
        setTimeout(() => connect(), 3000);
      } else setConnStatus("idle");
    };
    ws.onerror = () => { setError("Connection failed."); setConnStatus("error"); };
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "audio": {
            const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
            setIsTruckyTalking(true);
            scheduleChunk(bytes.buffer);
            break;
          }
          case "transcript": {
            const chunk = msg.text?.trim();
            if (!chunk) break;
            if (msg.speaker === "trucky") {
              truckyBufRef.current = chunk;
              if (truckyTimerRef.current) clearTimeout(truckyTimerRef.current);
              truckyTimerRef.current = setTimeout(() => {
                const text = truckyBufRef.current.trim();
                const prev = lastShownRef.current["trucky"];
                if (text && !(prev?.text === text && Date.now() - prev.at < 8000)) {
                  lastShownRef.current["trucky"] = { text, at: Date.now() };
                  setTranscripts(p => [...p, { id: Date.now().toString(), speaker: "trucky", text, timestamp: new Date() }]);
                  setActiveTab("chat");
                }
                truckyBufRef.current = "";
                truckyTimerRef.current = null;
              }, 1000);
            } else {
              userBufRef.current = chunk;
              if (userTimerRef.current) clearTimeout(userTimerRef.current);
              userTimerRef.current = setTimeout(() => {
                const text = userBufRef.current.trim();
                const prev = lastShownRef.current["driver"];
                if (text && !(prev?.text === text && Date.now() - prev.at < 8000)) {
                  lastShownRef.current["driver"] = { text, at: Date.now() };
                  setTranscripts(p => [...p, { id: Date.now().toString(), speaker: "driver", text, timestamp: new Date() }]);
                  setActiveTab("chat");
                }
                userBufRef.current = "";
                userTimerRef.current = null;
              }, 1200);
            }
            break;
          }
          case "tool_start":
            setToolActivities(p => [...p.slice(-9), { id: Date.now().toString(), tool: msg.tool, timestamp: new Date() }]);
            if (msg.tool === "send_message_to_dispatcher") setActiveTab("messages");
            break;
          case "tool_result":
            setToolActivities(p => p.map(a => a.tool === msg.tool && !a.result ? { ...a, result: msg.result } : a));
            refresh();
            break;
          case "load_update":
            // Dispatcher assigned a load — refresh immediately
            refresh();
            break;
          case "new_message":
            if (msg.message) {
              const m = msg.message;
              // Only show messages relevant to this driver
              const isForMe = m.direction === "dispatcher_to_driver"
                ? m.to_driver_id === driverId
                : m.driver_id === driverId;
              if (isForMe) {
                setMessages(p => p.some(x => x.id === m.id) ? p : [m, ...p].slice(0, 50));
                if (m.direction === "dispatcher_to_driver") setActiveTab("messages");
              }
            }
            break;
          case "turn_complete":
            playbackTimeRef.current = 0;
            break;
          case "error":
            setError(msg.message);
            break;
        }
      } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, scheduleChunk, stopMic]);

  const disconnect = useCallback(() => {
    stopMic(); wsRef.current?.close(); wsRef.current = null;
    audioCtxRef.current?.close(); audioCtxRef.current = null;
    playbackCtxRef.current?.close(); playbackCtxRef.current = null;
    playbackTimeRef.current = 0;
    setIsConnected(false); setConnStatus("idle");
  }, [stopMic]);

  const startMic = useCallback(async () => {
    if (!audioCtxRef.current || !wsRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      if (playbackCtxRef.current?.state === "suspended") await playbackCtxRef.current.resume();
      const source = ctx.createMediaStreamSource(stream); sourceRef.current = source;
      const nativeRate = ctx.sampleRate;
      const processor = ctx.createScriptProcessor(4096, 1, 1); processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const ratio = nativeRate / 16000;
        const len = Math.round(f32.length / ratio);
        const res = new Float32Array(len);
        for (let i = 0; i < len; i++) { const s = i * ratio; const lo = Math.floor(s); const hi = Math.min(lo+1, f32.length-1); res[i] = f32[lo] + (f32[hi]-f32[lo]) * (s-lo); }
        const i16 = new Int16Array(len);
        for (let i = 0; i < len; i++) i16[i] = Math.max(-32768, Math.min(32767, res[i]*32768));
        wsRef.current.send(JSON.stringify({ type: "audio", data: btoa(String.fromCharCode(...new Uint8Array(i16.buffer))) }));
      };
      source.connect(processor); processor.connect(ctx.destination);
      setIsListening(true);
    } catch { setError("Microphone access denied."); }
  }, []);

  const toggleMic = useCallback(() => { if (isListening) stopMic(); else startMic(); }, [isListening, startMic, stopMic]);

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscripts(p => [...p, { id: Date.now().toString(), speaker: "driver", text, timestamp: new Date() }]);
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  // ─── Derived data ─────────────────────────────────────────────
  const hos      = driverInfo?.hos as Record<string, number|string|boolean> | undefined;
  const driveRem = (hos?.drive_time_remaining_mins as number) || 0;
  const shiftRem = (hos?.on_duty_remaining_mins as number) || 0;
  const violation = hos?.violation === true;
  const driveH   = Math.floor(driveRem / 60); const driveM = driveRem % 60;
  const shiftH   = Math.floor(shiftRem / 60); const shiftM = shiftRem % 60;
  const tel      = driverInfo?.telemetry as Record<string, unknown> | null | undefined;
  const fuelPct  = tel?.fuel_percent != null ? Number(tel.fuel_percent) : null;
  const driverName = (driverInfo?.name as string) || "Driver";
  const truckName  = (driverInfo?.truck as string) || "Truck";
  const dest      = (driverInfo?.destination as Record<string, string> | undefined)?.address || "";

  const driveColor = driveRem < 60 ? DANGER : driveRem < 180 ? WARNING : SUCCESS;
  const fuelColor  = fuelPct != null ? (fuelPct < 20 ? DANGER : fuelPct < 40 ? WARNING : SUCCESS) : SUCCESS;

  const orbBg  = !isConnected ? "#1a1a1a" : isListening ? DANGER : ACCENT;
  const orbGlow = !isConnected ? "none"
    : isListening ? `0 0 48px rgba(239,68,68,0.5), 0 0 96px rgba(239,68,68,0.2)`
    : isTruckyTalking ? `0 0 48px rgba(59,130,246,0.6), 0 0 96px rgba(59,130,246,0.25)`
    : `0 0 32px rgba(59,130,246,0.35)`;

  const statusLabel = !isConnected ? "Not connected"
    : isListening ? "Listening..."
    : isTruckyTalking ? "Trucky is speaking..."
    : "Tap to speak";

  const unreadMsgs = messages.filter(m => !m.read && m.direction === "dispatcher_to_driver").length;

  // Filter loads for this driver — match on first name since dispatcher may use partial names
  const driverFirstName = ((driverInfo?.name as string) || "").split(" ")[0].toLowerCase();
  const assignedLoads = allLoads.filter(l => {
    if (!driverFirstName) return false;
    const ln = (l.driver_name || "").toLowerCase();
    return ln.includes(driverFirstName) || driverFirstName.includes(ln.split(" ")[0]);
  });

  const statusColor = (s: string) =>
    s === "IN_TRANSIT" ? ACCENT : s === "ASSIGNED" ? SUCCESS : s === "DELIVERED" ? TEXT3 : s === "PENDING" ? WARNING : TEXT3;

  return (
    <div style={{ minHeight: "100dvh", maxWidth: 430, margin: "0 auto", background: BG, display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", WebkitFontSmoothing: "antialiased", color: TEXT }}>

      {/* ── Header ── */}
      <header style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 50, background: BG }}>
        <button onClick={() => router.push("/driver")} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT3, padding: "4px 8px 4px 0", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          ← Fleet
        </button>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Truck style={{ width: 17, height: 17, color: "#fff" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>{driverName}</div>
          <div style={{ fontSize: 11, color: TEXT3 }}>{truckName}{dest ? ` · ${dest.split(",")[0]}` : ""}</div>
        </div>
        {hos && (
          <div style={{ background: `${driveColor}18`, border: `1px solid ${driveColor}40`, borderRadius: 100, padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}>
            <Clock style={{ width: 10, height: 10, color: driveColor }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: driveColor, fontVariantNumeric: "tabular-nums" }}>{driveH}h {driveM}m</span>
          </div>
        )}
        {isConnected && (
          <button onClick={disconnect} style={{ background: "none", border: "none", cursor: "pointer", color: DANGER, fontSize: 12, display: "flex", alignItems: "center", gap: 4, padding: "4px 0" }}>
            <PhoneOff style={{ width: 13, height: 13 }} /> End
          </button>
        )}
      </header>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Voice orb ── */}
        <section style={{ padding: "28px 24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: connStatus === "connected" ? SUCCESS : connStatus === "connecting" ? WARNING : connStatus === "error" ? DANGER : TEXT3, display: "flex", alignItems: "center", gap: 6 }}>
            {connStatus !== "idle" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: connStatus === "connected" ? SUCCESS : connStatus === "connecting" ? WARNING : DANGER, display: "inline-block" }} />}
            {connStatus === "connected" ? "Connected" : connStatus === "connecting" ? "Connecting..." : connStatus === "error" ? "Error" : "Tap to connect"}
          </div>

          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isListening && <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", border: `2px solid ${DANGER}`, animation: "orbPulse 1.4s ease-out infinite", opacity: 0.6 }} />}
            {isTruckyTalking && !isListening && <div style={{ position: "absolute", width: 160, height: 160, borderRadius: "50%", border: `2px solid ${ACCENT}`, animation: "orbPulse 1.8s ease-out infinite", opacity: 0.5 }} />}
            <button
              onClick={isConnected ? toggleMic : connect}
              disabled={connStatus === "connecting" || isTruckyTalking}
              style={{ width: 110, height: 110, borderRadius: "50%", border: "none", cursor: (connStatus === "connecting" || isTruckyTalking) ? "not-allowed" : "pointer", background: orbBg, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: orbGlow, transition: "background 0.3s, box-shadow 0.3s", opacity: (connStatus === "connecting" || isTruckyTalking) ? 0.75 : 1, position: "relative", zIndex: 1 }}
            >
              {!isConnected ? <PhoneCall style={{ width: 40, height: 40, color: "#6b7280" }} />
                : isListening ? <Mic style={{ width: 40, height: 40, color: "#fff" }} />
                : <MicOff style={{ width: 40, height: 40, color: "#fff" }} />}
            </button>
          </div>

          {isTruckyTalking && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 20 }}>
              {[3,5,7,5,7,5,3].map((h, i) => <div key={i} style={{ width: 3, borderRadius: 2, background: ACCENT, height: `${h*3}px`, animation: `wave 0.7s ease-in-out ${i*0.09}s infinite alternate` }} />)}
            </div>
          )}

          <p style={{ fontSize: 14, fontWeight: 500, color: isConnected ? TEXT : TEXT3, textAlign: "center" }}>{statusLabel}</p>

          {!isConnected && (
            <button onClick={connect} disabled={connStatus === "connecting"} style={{ width: "100%", padding: "15px 0", borderRadius: 14, border: "none", background: ACCENT, color: "#fff", fontSize: 15, fontWeight: 600, cursor: connStatus === "connecting" ? "not-allowed" : "pointer", opacity: connStatus === "connecting" ? 0.7 : 1 }}>
              {connStatus === "connecting" ? "Connecting..." : "Connect to Trucky"}
            </button>
          )}

          {error && (
            <div style={{ width: "100%", background: `${DANGER}14`, border: `1px solid ${DANGER}30`, borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle style={{ width: 14, height: 14, color: DANGER, flexShrink: 0 }} />
              <span style={{ color: "#fca5a5", fontSize: 13, flex: 1 }}>{error}</span>
              <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT3, padding: 0, fontSize: 18 }}>×</button>
            </div>
          )}
        </section>

        {/* ── HOS Cards ── */}
        {hos && (
          <section style={{ padding: "0 20px 20px" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { label: "Drive", value: `${driveH}h ${String(driveM).padStart(2,"0")}m`, color: driveColor, extra: violation ? "VIOLATION" : null },
                { label: "Shift", value: `${shiftH}h ${String(shiftM).padStart(2,"0")}m`, color: TEXT },
                fuelPct != null ? { label: "Fuel", value: `${Math.round(fuelPct)}%`, color: fuelColor } : null,
              ].filter(Boolean).map((c, i) => c && (
                <div key={i} style={{ flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: TEXT3, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>{c.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
                  {c.extra && <div style={{ fontSize: 9, color: DANGER, marginTop: 3, fontWeight: 700 }}>{c.extra}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Quick Prompts ── */}
        {isConnected && (
          <section style={{ paddingBottom: 20 }}>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingLeft: 20, paddingRight: 20, scrollbarWidth: "none" }}>
              {QUICK_PROMPTS.map(p => (
                <button key={p.label} onClick={() => sendText(p.text)} style={{ flexShrink: 0, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 100, padding: "8px 14px", cursor: "pointer", color: "#d1d5db", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                  {p.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Tabs ── */}
        <div style={{ padding: "0 20px 12px", display: "flex", gap: 4 }}>
          {(["chat", "loads", "messages"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: activeTab === tab ? ACCENT : CARD, color: activeTab === tab ? "#fff" : TEXT3, position: "relative" }}>
              {tab === "chat" ? "Chat" : tab === "loads" ? `Loads${assignedLoads.length ? ` (${assignedLoads.length})` : ""}` : `Messages${unreadMsgs ? ` ●` : ""}`}
            </button>
          ))}
        </div>

        {/* ── Chat tab ── */}
        {activeTab === "chat" && (
          <section style={{ padding: "0 20px 32px" }}>
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ minHeight: 220, maxHeight: 400, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {transcripts.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: 8 }}>
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Truck style={{ width: 17, height: 17, color: TEXT3 }} />
                    </div>
                    <p style={{ color: TEXT3, fontSize: 13, textAlign: "center" }}>Start talking to Trucky</p>
                  </div>
                ) : transcripts.map(t => (
                  <div key={t.id} style={{ display: "flex", flexDirection: t.speaker === "driver" ? "row-reverse" : "row", gap: 8, alignItems: "flex-end" }}>
                    {t.speaker === "trucky" && (
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Truck style={{ width: 12, height: 12, color: "#fff" }} />
                      </div>
                    )}
                    <div style={{ maxWidth: "76%", background: t.speaker === "driver" ? ACCENT : "rgba(255,255,255,0.07)", borderRadius: t.speaker === "driver" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "10px 14px" }}>
                      <p style={{ fontSize: 14, lineHeight: 1.5, color: t.speaker === "driver" ? "#fff" : "#e5e7eb", margin: 0 }}>{t.text}</p>
                      <p style={{ fontSize: 10, color: t.speaker === "driver" ? "rgba(255,255,255,0.55)" : TEXT3, marginTop: 4, marginBottom: 0, textAlign: t.speaker === "driver" ? "right" : "left" }}>
                        {t.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {/* Tool activity */}
            {toolActivities.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {[...toolActivities].reverse().slice(0, 4).map(a => (
                  <div key={a.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <Zap style={{ width: 12, height: 12, color: ACCENT, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, color: "#d1d5db", fontWeight: 500, margin: 0 }}>{TOOL_LABELS[a.tool] || a.tool}</p>
                      {a.result && (
                        <p style={{ fontSize: 11, color: a.result.success === false ? DANGER : SUCCESS, margin: "2px 0 0", fontWeight: 600 }}>
                          {a.result.confirmation as string || (a.result.safe_for_truck ? "Approved" : a.result.compliance as string || "")}
                        </p>
                      )}
                    </div>
                    <span style={{ color: TEXT3, fontSize: 10 }}>{a.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Loads tab ── */}
        {activeTab === "loads" && (
          <section style={{ padding: "0 20px 32px" }}>
            {assignedLoads.length === 0 ? (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "40px 20px", textAlign: "center" }}>
                <Package style={{ width: 32, height: 32, color: TEXT3, margin: "0 auto 12px" }} />
                <p style={{ color: TEXT3, fontSize: 14, margin: 0 }}>No loads assigned yet</p>
                <p style={{ color: TEXT3, fontSize: 12, marginTop: 6 }}>Your dispatcher will assign loads here</p>
              </div>
            ) : assignedLoads.map((load: DriverLoad) => (
              <div key={load.id} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 16, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: TEXT3, letterSpacing: "0.06em" }}>#{load.id}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99, background: `${statusColor(load.status)}18`, color: statusColor(load.status), letterSpacing: "0.06em" }}>{load.status}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <p style={{ fontSize: 10, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 3px" }}>Origin</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: TEXT, margin: 0 }}>{load.origin}</p>
                  </div>
                  <Navigation style={{ width: 16, height: 16, color: ACCENT, flexShrink: 0 }} />
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <p style={{ fontSize: 10, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 3px" }}>Destination</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: TEXT, margin: 0 }}>{load.destination}</p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                  {load.pickup_date && <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 10, color: TEXT3, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pickup</p>
                    <p style={{ fontSize: 12, color: TEXT2, fontWeight: 500, margin: 0 }}>{load.pickup_date}</p>
                  </div>}
                  {load.commodity && <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 10, color: TEXT3, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Cargo</p>
                    <p style={{ fontSize: 12, color: TEXT2, fontWeight: 500, margin: 0 }}>{load.commodity}</p>
                  </div>}
                  {load.rate > 0 && <div>
                    <p style={{ fontSize: 10, color: TEXT3, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Rate</p>
                    <p style={{ fontSize: 12, color: SUCCESS, fontWeight: 600, margin: 0 }}>${load.rate.toLocaleString()}</p>
                  </div>}
                </div>
                {load.notes && <p style={{ fontSize: 12, color: TEXT3, margin: "10px 0 0", borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>{load.notes}</p>}

                <button onClick={() => sendText(`Trucky, I'm picking up load ${load.id} going from ${load.origin} to ${load.destination}. Check my HOS for this trip.`)}
                  style={{ width: "100%", marginTop: 12, padding: "9px 0", borderRadius: 10, border: "none", background: "rgba(59,130,246,0.12)", color: ACCENT, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Ask Trucky about this trip
                </button>
              </div>
            ))}
          </section>
        )}

        {/* ── Messages tab ── */}
        {activeTab === "messages" && (
          <section style={{ padding: "0 20px 32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: TEXT3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Dispatch Messages</span>
              {isConnected && (
                <button onClick={() => sendText("Trucky, please send a message to the dispatcher with my current status.")}
                  style={{ fontSize: 11, color: ACCENT, background: "rgba(59,130,246,0.1)", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontWeight: 600 }}>
                  + New message
                </button>
              )}
            </div>
            {messages.length === 0 ? (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "40px 20px", textAlign: "center" }}>
                <MessageSquare style={{ width: 32, height: 32, color: TEXT3, margin: "0 auto 12px" }} />
                <p style={{ color: TEXT3, fontSize: 14, margin: 0 }}>No messages yet</p>
                <p style={{ color: TEXT3, fontSize: 12, marginTop: 6 }}>Say "Tell the dispatcher..." to send a message</p>
              </div>
            ) : messages.map(m => (
              <div key={m.id} style={{ background: m.direction === "dispatcher_to_driver" ? "rgba(59,130,246,0.06)" : CARD, border: `1px solid ${m.direction === "dispatcher_to_driver" && !m.read ? ACCENT : BORDER}`, borderRadius: 14, padding: 14, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.direction === "dispatcher_to_driver" ? ACCENT : TEXT2 }}>
                    {m.direction === "dispatcher_to_driver" ? "Dispatcher" : "You → Dispatch"}
                  </span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {m.urgency && m.urgency !== "low" && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: m.urgency === "emergency" ? `${DANGER}20` : `${WARNING}20`, color: m.urgency === "emergency" ? DANGER : WARNING }}>
                        {m.urgency.toUpperCase()}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: TEXT3 }}>{new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                  </div>
                </div>
                <p style={{ fontSize: 13, color: TEXT, lineHeight: 1.5, margin: 0 }}>{m.text}</p>
                {m.new_eta && <p style={{ fontSize: 11, color: WARNING, marginTop: 6, marginBottom: 0, fontWeight: 600 }}>New ETA: {m.new_eta}</p>}
              </div>
            ))}
          </section>
        )}
      </div>

      <style>{`
        @keyframes orbPulse { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(1.55); opacity: 0; } }
        @keyframes wave { from { transform: scaleY(0.35); } to { transform: scaleY(1.0); } }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INNER (handles param reading)
// ═══════════════════════════════════════════════════════════════
function DriverPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  if (!id) return <DriverSelector />;
  return <DriverSession driverId={id} />;
}

export default function DriverPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080808", color: "#6b7280", fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", fontSize: 15 }}>
        Loading...
      </div>
    }>
      <DriverPageInner />
    </Suspense>
  );
}
