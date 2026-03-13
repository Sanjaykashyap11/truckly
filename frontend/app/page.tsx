"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Truck,
  AlertTriangle,
  CheckCircle,
  Clock,
  Radio,
  Activity,
  Shield,
  Fuel,
  Wrench,
  MapPin,
  Bell,
  BellOff,
  Navigation,
  Zap,
  Mic,
  MicOff,
  X,
  Wifi,
  WifiOff,
  Database,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

const DISPATCHER_SCENARIOS = [
  { label: "Fleet Status", text: "Give me a full fleet status update." },
  { label: "HOS Warnings", text: "Which drivers are running low on hours?" },
  { label: "On Route", text: "How many trucks are currently on route?" },
  { label: "Violations", text: "Are there any HOS violations right now?" },
  { label: "Notify All", text: "Send a weather delay alert to all active drivers." },
];

interface HOS {
  drive_time_remaining_mins: number;
  status: string;
  next_mandatory_break?: string;
  break_location?: string;
}

interface Driver {
  id: string;
  name: string;
  truck: string;
  status: string;
  current_location: { address: string; speed_mph?: number };
  destination?: { address: string };
  hos: HOS;
  route?: { highway: string; eta: string; violations: string[]; restricted_roads_avoided?: string[] };
  source?: string;
}

interface Alert {
  id: string;
  driver_id: string;
  driver_name: string;
  type: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  timestamp: string;
  acknowledged: boolean;
  auto_resolved: boolean;
}

interface ToolActivity {
  id: string;
  session_id: string;
  is_dispatcher?: boolean;
  tool: string;
  result: Record<string, unknown>;
  timestamp: Date;
}

interface Transcript {
  id: string;
  speaker: "dispatcher" | "trucky";
  text: string;
  timestamp: Date;
}

const TOOL_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  check_hos_status:    { label: "HOS Check",           icon: Clock,     color: "text-blue-400" },
  check_route_safety:  { label: "Route Safety",         icon: Shield,    color: "text-yellow-400" },
  find_fuel_stops:     { label: "Fuel Stop",            icon: Fuel,      color: "text-green-400" },
  handle_breakdown:    { label: "Breakdown Protocol",   icon: Wrench,    color: "text-red-400" },
  notify_stakeholders: { label: "Stakeholders Notified",icon: Radio,     color: "text-purple-400" },
  get_fleet_status:    { label: "Fleet Status",         icon: Truck,     color: "text-cyan-400" },
  get_driver_details:  { label: "Driver Details",       icon: Activity,  color: "text-indigo-400" },
};

const STATUS_DOT: Record<string, string> = {
  on_route:  "bg-green-400",
  loading:   "bg-yellow-400",
  at_shipper:"bg-yellow-400",
  resting:   "bg-gray-500",
  off_duty:  "bg-gray-600",
  unknown:   "bg-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  on_route:  "On Route",
  loading:   "Loading",
  at_shipper:"At Shipper",
  resting:   "Resting",
  off_duty:  "Off Duty",
  unknown:   "Unknown",
};

function HOSBar({ mins }: { mins: number }) {
  const max = 660;
  const pct = Math.min(100, Math.max(0, (mins / max) * 100));
  const color = mins < 60 ? "bg-red-500" : mins < 180 ? "bg-yellow-500" : "bg-green-500";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">HOS Remaining</span>
        <span className={`font-mono font-medium ${mins < 60 ? "text-red-400" : mins < 180 ? "text-yellow-400" : "text-green-400"}`}>
          {h}h {m}min
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Dispatcher Voice Panel ────────────────────────────────────────────────────

function DispatcherVoicePanel({ onClose }: { onClose: () => void }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTruckyTalking, setIsTruckyTalking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef<number>(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  useEffect(() => () => { disconnectVoice(); }, []);

  const scheduleChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;
    const pcm16 = new Int16Array(pcmBuffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;
    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, playbackTimeRef.current);
    src.start(startAt);
    playbackTimeRef.current = startAt + buf.duration;
    src.onended = () => {
      if (playbackTimeRef.current <= ctx.currentTime + 0.05) {
        setIsTruckyTalking(false);
      }
    };
  }, []);

  const connectVoice = useCallback(async () => {
    setConnectionStatus("connecting");
    setError(null);

    audioCtxRef.current = new AudioContext();
    playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    playbackTimeRef.current = 0;

    const ws = new WebSocket(`${WS_URL}/ws/dispatcher/voice`);
    wsRef.current = ws;

    ws.onopen = () => { setIsConnected(true); setConnectionStatus("connected"); };
    ws.onclose = (e) => {
      setIsConnected(false); setIsListening(false); setIsTruckyTalking(false);
      if (e.code === 1011 || e.code === 1006) {
        setConnectionStatus("connecting");
        setTimeout(() => connectVoice(), 3000);
      } else {
        setConnectionStatus("idle");
      }
    };
    ws.onerror = () => { setError("Connection failed."); setConnectionStatus("error"); };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "audio") {
        const binary = atob(msg.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        setIsTruckyTalking(true);
        scheduleChunk(bytes.buffer);
      } else if (msg.type === "transcript" && msg.text?.trim()) {
        setTranscripts(prev => [...prev, {
          id: Date.now().toString(),
          speaker: msg.speaker === "trucky" ? "trucky" : "dispatcher",
          text: msg.text,
          timestamp: new Date(),
        }]);
      } else if (msg.type === "turn_complete") {
        playbackTimeRef.current = 0;
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };
  }, [scheduleChunk]);

  const disconnectVoice = useCallback(() => {
    stopMic();
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current?.close(); audioCtxRef.current = null;
    playbackCtxRef.current?.close(); playbackCtxRef.current = null;
    setIsConnected(false); setConnectionStatus("idle");
  }, []);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current = null; sourceRef.current = null; streamRef.current = null;
    setIsListening(false);
  }, []);

  const startMic = useCallback(async () => {
    if (!audioCtxRef.current || !wsRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      if (playbackCtxRef.current?.state === "suspended") await playbackCtxRef.current.resume();

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const TARGET = 16000;
      const native = ctx.sampleRate;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const ratio = native / TARGET;
        const outLen = Math.round(float32.length / ratio);
        const resampled = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const src = i * ratio;
          const lo = Math.floor(src);
          const hi = Math.min(lo + 1, float32.length - 1);
          resampled[i] = float32[lo] + (float32[hi] - float32[lo]) * (src - lo);
        }
        const int16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) int16[i] = Math.max(-32768, Math.min(32767, resampled[i] * 32768));
        const binary = String.fromCharCode(...new Uint8Array(int16.buffer));
        wsRef.current.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setIsListening(true);
    } catch {
      setError("Microphone access denied.");
    }
  }, []);

  const sendScenario = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscripts(prev => [...prev, {
      id: Date.now().toString(), speaker: "dispatcher", text, timestamp: new Date(),
    }]);
  }, []);

  return (
    <div className="fixed bottom-0 right-0 w-full sm:w-[420px] bg-card border border-border border-b-0 rounded-t-2xl shadow-2xl z-50 flex flex-col" style={{ maxHeight: "520px" }}>
      {/* Panel header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <div className="bg-black dark:bg-white rounded-lg p-1.5">
          <Zap className="w-3.5 h-3.5 text-white dark:text-black" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground">Trucky Dispatch</h3>
          <p className="text-xs text-muted-foreground leading-none">AI fleet co-pilot</p>
        </div>
        <div className={`ml-auto flex items-center gap-1.5 text-xs ${connectionStatus === "connected" ? "text-green-400" : "text-muted-foreground"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === "connected" ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
          {connectionStatus === "connected" ? "Live" : connectionStatus === "connecting" ? "Connecting..." : "Offline"}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {transcripts.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center mt-6">
            Ask Trucky about your fleet — locations, HOS status, violations.
          </p>
        ) : (
          transcripts.map(t => (
            <div key={t.id} className={`flex gap-2 ${t.speaker === "dispatcher" ? "flex-row-reverse" : ""}`}>
              <div className={`text-xs px-3 py-2 rounded-xl max-w-[85%] ${
                t.speaker === "trucky" ? "bg-muted text-foreground" : "bg-black dark:bg-white text-white dark:text-black"
              }`}>
                <p className="font-medium mb-0.5 opacity-60">{t.speaker === "trucky" ? "Trucky" : "You"}</p>
                <p className="leading-relaxed">{t.text}</p>
              </div>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Controls */}
      <div className="shrink-0 border-t border-border p-3 space-y-3">
        {isConnected && (
          <div className="flex flex-wrap gap-1.5">
            {DISPATCHER_SCENARIOS.map(s => (
              <button key={s.label} onClick={() => sendScenario(s.text)}
                className="text-xs border border-border rounded-lg px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          {isConnected ? (
            <>
              <button
                onClick={() => isListening ? stopMic() : startMic()}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                  isListening ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30"
                  : isTruckyTalking ? "bg-gray-700 cursor-not-allowed"
                  : "bg-black dark:bg-white hover:opacity-90"
                }`}
                disabled={isTruckyTalking}
              >
                {isListening
                  ? <Mic className="w-5 h-5 text-white" />
                  : <MicOff className={`w-5 h-5 ${isTruckyTalking ? "text-gray-400" : "text-white dark:text-black"}`} />
                }
              </button>

              {isTruckyTalking && (
                <div className="flex items-end gap-0.5 h-5">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className={`w-1 bg-purple-400 rounded-full bar-${i}`} style={{ height: `${8 + i * 4}px` }} />
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground flex-1">
                {isListening ? "Listening..." : isTruckyTalking ? "Trucky speaking..." : "Tap mic to ask Trucky"}
              </p>

              <button onClick={disconnectVoice} className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5">
                End
              </button>
            </>
          ) : (
            <button
              onClick={connectVoice}
              disabled={connectionStatus === "connecting"}
              className="flex-1 flex items-center justify-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Zap className="w-4 h-4" />
              {connectionStatus === "connecting" ? "Connecting..." : "Talk to Trucky"}
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}


// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function DispatcherDashboard() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveELD, setLiveELD] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${WS_URL}/ws/dispatcher`);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => { setWsConnected(false); setTimeout(connect, 3000); };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "init":
            setDrivers(msg.drivers);
            setAlerts(msg.alerts);
            setLiveELD(msg.drivers.some((d: Driver) => d.source === "samsara_live"));
            break;
          case "drivers_update":
            setDrivers(msg.drivers);
            setLiveELD(msg.source === "samsara_live");
            break;
          case "new_alert":
            setAlerts(prev => [msg.alert, ...prev]);
            break;
          case "tool_activity":
            setActivities(prev => [...prev.slice(-19), {
              id: Date.now().toString(),
              session_id: msg.session_id || msg.driver_id || "",
              is_dispatcher: msg.is_dispatcher,
              tool: msg.tool,
              result: msg.result,
              timestamp: new Date(),
            }]);
            break;
        }
      };
    };

    const fetchRest = async () => {
      try {
        const [dr, al] = await Promise.all([
          fetch(`${API_URL}/api/drivers`).then(r => r.json()),
          fetch(`${API_URL}/api/alerts`).then(r => r.json()),
        ]);
        setDrivers(dr);
        setAlerts(al);
        setLiveELD(dr.some((d: Driver) => d.source === "samsara_live"));
      } catch {}
    };

    connect();
    fetchRest();
    const interval = setInterval(fetchRest, 30000);
    return () => { clearInterval(interval); wsRef.current?.close(); };
  }, []);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch(`${API_URL}/api/alerts/${alertId}/acknowledge`, { method: "POST" });
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    } catch {}
  };

  const unacked = alerts.filter(a => !a.acknowledged).length;
  const onRoute = drivers.filter(d => d.status === "on_route").length;
  const hosWarnings = drivers.filter(d => d.hos.drive_time_remaining_mins < 120).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black dark:bg-white rounded-lg p-1.5">
              <Truck className="w-4 h-4 text-white dark:text-black" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Trucky</h1>
              <p className="text-xs text-muted-foreground leading-none">Dispatcher Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live ELD badge */}
            <div className={`flex items-center gap-1.5 text-xs ${liveELD ? "text-green-400" : "text-muted-foreground"}`}>
              {liveELD ? <Database className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5 opacity-40" />}
              {liveELD ? "Samsara Live" : "Demo Data"}
            </div>

            {/* WS indicator */}
            <div className={`flex items-center gap-1.5 text-xs ${wsConnected ? "text-green-400" : "text-gray-500"}`}>
              {wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {wsConnected ? "Live" : "Connecting..."}
            </div>

            {/* Talk to Trucky button */}
            <button
              onClick={() => setShowVoice(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                showVoice
                  ? "bg-purple-600 text-white"
                  : "bg-black dark:bg-white text-white dark:text-black hover:opacity-90"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Talk to Trucky
            </button>

            <Link
              href="/driver"
              className="flex items-center gap-1.5 border border-border text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              <Radio className="w-3.5 h-3.5" />
              Driver View
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Active Trucks", value: onRoute, sub: `${drivers.length} total in fleet`, icon: Truck, accent: "text-green-400" },
            { label: "Unread Alerts", value: unacked, sub: "require attention", icon: Bell, accent: "text-red-400" },
            { label: "HOS Warnings", value: hosWarnings, sub: "< 2 hours left", icon: AlertTriangle, accent: "text-yellow-400" },
            { label: "Trucky Active", value: onRoute, sub: liveELD ? "Samsara live data" : "demo mode", icon: Zap, accent: "text-purple-400" },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-2xl font-bold text-foreground">{s.value}</p>
                  <p className="text-xs font-medium text-foreground mt-0.5">{s.label}</p>
                  <p className="text-xs text-muted-foreground">{s.sub}</p>
                </div>
                <s.icon className={`w-5 h-5 ${s.accent}`} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Driver cards */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Fleet Status</h2>
              {liveELD && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Samsara ELD — Live
                </span>
              )}
            </div>

            {drivers.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
                Loading fleet data...
              </div>
            ) : (
              drivers.map(driver => (
                <div key={driver.id} className="bg-card border border-border rounded-xl p-4 hover:border-foreground/20 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${STATUS_DOT[driver.status] || "bg-gray-500"}`} />
                        <span className="font-medium text-foreground text-sm">{driver.name}</span>
                        <span className="text-xs text-muted-foreground">{STATUS_LABEL[driver.status] || driver.status}</span>
                        {driver.source === "samsara_live" && (
                          <span className="text-xs text-green-400 flex items-center gap-0.5">
                            <Database className="w-2.5 h-2.5" /> Live
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">{driver.truck}</p>

                      <HOSBar mins={driver.hos.drive_time_remaining_mins} />

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="text-muted-foreground truncate">{driver.current_location.address}</span>
                        </div>
                        {driver.current_location.speed_mph !== undefined && driver.current_location.speed_mph > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Navigation className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">{driver.current_location.speed_mph} mph</span>
                          </div>
                        )}
                        {driver.destination && (
                          <div className="flex items-start gap-1.5">
                            <Navigation className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                            <span className="text-muted-foreground truncate">→ {driver.destination.address}</span>
                          </div>
                        )}
                        {driver.route?.eta && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-muted-foreground">
                              ETA {new Date(driver.route.eta).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </span>
                          </div>
                        )}
                        {driver.route?.restricted_roads_avoided && driver.route.restricted_roads_avoided.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Shield className="w-3 h-3 text-green-400 shrink-0" />
                            <span className="text-green-400">Route pre-checked</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Link
                      href={`/driver?id=${driver.id}`}
                      className="shrink-0 flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >
                      <Radio className="w-3 h-3" />
                      Trucky
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right column: Activity + Alerts */}
          <div className="space-y-4">
            {/* Live Trucky Activity */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-medium text-foreground">Trucky Actions</h2>
                <span className="ml-auto text-xs text-muted-foreground">Live</span>
              </div>
              <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                {activities.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Trucky&apos;s tool actions appear here in real-time
                  </p>
                ) : (
                  [...activities].reverse().map(act => {
                    const meta = TOOL_META[act.tool];
                    const Icon = meta?.icon || Activity;
                    return (
                      <div key={act.id} className="flex items-start gap-2 text-xs">
                        <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${meta?.color || "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground font-medium">
                            {act.is_dispatcher ? "Dispatcher" : act.session_id}
                          </span>
                          <span className="text-muted-foreground"> — {meta?.label || act.tool}</span>
                          {act.result?.compliance != null && (
                            <p className={String(act.result.compliance).includes("COMPLIANT") && !String(act.result.compliance).includes("NON") ? "text-green-400" : "text-red-400"}>
                              {String(act.result.compliance)}
                            </p>
                          )}
                          {act.result?.safe_for_truck === false && <p className="text-red-400">⚠ Route blocked — rerouted</p>}
                          {act.result?.notifications_sent != null && <p className="text-green-400">✓ All parties notified</p>}
                          {act.result?.fleet_size != null && <p className="text-cyan-400">Fleet: {String(act.result.fleet_size)} drivers</p>}
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {act.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={activityEndRef} />
              </div>
            </div>

            {/* Alerts */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium text-foreground">Alerts</h2>
                </div>
                {unacked > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{unacked}</span>
                )}
              </div>
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">No alerts</p>
                ) : (
                  alerts.map(alert => (
                    <div key={alert.id} className={`p-3 border-l-4 ${
                      alert.severity === "HIGH" ? "border-l-red-500" :
                      alert.severity === "MEDIUM" ? "border-l-yellow-500" : "border-l-blue-500"
                    } ${alert.acknowledged ? "opacity-50" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-medium text-foreground">{alert.driver_name}</span>
                            {alert.auto_resolved && (
                              <span className="flex items-center gap-0.5 text-xs text-green-400">
                                <CheckCircle className="w-3 h-3" /> Auto
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(alert.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </p>
                        </div>
                        {!alert.acknowledged && (
                          <button
                            onClick={() => acknowledgeAlert(alert.id)}
                            className="shrink-0 p-1 hover:text-foreground text-muted-foreground transition-colors"
                            title="Acknowledge"
                          >
                            <BellOff className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Dispatcher Voice Panel */}
      {showVoice && <DispatcherVoicePanel onClose={() => setShowVoice(false)} />}
    </div>
  );
}
