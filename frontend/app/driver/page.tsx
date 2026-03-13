"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Mic,
  MicOff,
  ArrowLeft,
  Truck,
  Shield,
  Clock,
  Fuel,
  AlertTriangle,
  CheckCircle,
  Activity,
  Radio,
} from "lucide-react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// ─── Demo scenarios for judges ────────────────────────────────────────────────
const DEMO_SCENARIOS = [
  { label: "Check HOS", text: "Hey Sally, how are my hours looking for Boston?" },
  { label: "Route Question", text: "My GPS is showing a faster route through Merritt Parkway." },
  { label: "Fuel Stop", text: "Sally, I need to find a fuel stop soon." },
  { label: "Breakdown", text: "Sally — tire blowout. I'm on I-95 westbound near Exit 24 New Jersey." },
  { label: "Can I push?", text: "The receiver wants me to push through and deliver tonight. Can I make it?" },
];

interface Transcript {
  id: string;
  speaker: "driver" | "sally";
  text: string;
  timestamp: Date;
}

interface ToolActivity {
  id: string;
  tool: string;
  result?: Record<string, unknown>;
  timestamp: Date;
}

const TOOL_LABELS: Record<string, string> = {
  check_hos_status: "Checking HOS status...",
  check_route_safety: "Checking route safety...",
  find_fuel_stops: "Finding fuel stops...",
  handle_breakdown: "Activating breakdown protocol...",
  notify_stakeholders: "Notifying stakeholders...",
};

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  check_hos_status: Clock,
  check_route_safety: Shield,
  find_fuel_stops: Fuel,
  handle_breakdown: AlertTriangle,
  notify_stakeholders: Radio,
};

function DriverPageInner() {
  const searchParams = useSearchParams();
  const driverId = searchParams.get("id") || "D001";

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSallyTalking, setIsSallyTalking] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [driverInfo, setDriverInfo] = useState<Record<string, unknown> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);   // mic capture context
  const playbackCtxRef = useRef<AudioContext | null>(null);    // Sally playback context (persistent)
  const playbackTimeRef = useRef<number>(0);                   // running clock for gapless scheduling
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Fetch driver info
  useEffect(() => {
    fetch(`${API_URL}/api/drivers/${driverId}`)
      .then((r) => r.json())
      .then(setDriverInfo)
      .catch(() => {});
  }, [driverId]);

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // ─── Audio playback ──────────────────────────────────────────────────────

  // Schedule one PCM16 chunk on the persistent playback context.
  // Each chunk starts exactly when the previous one ends → no cracks.
  const scheduleChunk = useCallback((pcmBuffer: ArrayBuffer) => {
    const ctx = playbackCtxRef.current;
    if (!ctx) return;

    const pcm16 = new Int16Array(pcmBuffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Start at the later of "right now" or "when the previous chunk ends"
    const startAt = Math.max(ctx.currentTime + 0.02, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + audioBuffer.duration;

    source.onended = () => {
      // If nothing else is scheduled, mark Sally as done talking
      if (playbackTimeRef.current <= ctx.currentTime + 0.05) {
        setIsSallyTalking(false);
        isPlayingRef.current = false;
      }
    };
  }, []);

  const playAudioQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    setIsSallyTalking(true);

    while (audioQueueRef.current.length > 0) {
      const buf = audioQueueRef.current.shift()!;
      scheduleChunk(buf);
    }
  }, [scheduleChunk]);

  // ─── WebSocket connection ────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus("connecting");
    setError(null);

    // Mic capture context at native rate (we resample to 16kHz before sending)
    audioContextRef.current = new AudioContext();
    // Persistent 24kHz playback context for gapless Sally audio
    playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    playbackTimeRef.current = 0;

    const ws = new WebSocket(`${WS_URL}/ws/voice/${driverId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionStatus("connected");
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      setIsListening(false);
      setIsSallyTalking(false);
      stopMic();
      // Auto-reconnect on transient Gemini server errors (1011)
      if (event.code === 1011 || event.code === 1006) {
        setConnectionStatus("connecting");
        setTranscripts(prev => [...prev, {
          id: Date.now().toString(),
          speaker: "sally" as const,
          text: "Connection lost — reconnecting...",
          timestamp: new Date(),
        }]);
        setTimeout(() => connect(), 3000);
      } else {
        setConnectionStatus("idle");
      }
    };

    ws.onerror = () => {
      setError("Connection failed. Make sure the backend is running on port 8080.");
      setConnectionStatus("error");
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "audio": {
            const binary = atob(msg.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            audioQueueRef.current.push(bytes.buffer);
            playAudioQueue();
            break;
          }

          case "transcript": {
            if (msg.text?.trim()) {
              setTranscripts((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  speaker: msg.speaker === "sally" ? "sally" : "driver",
                  text: msg.text,
                  timestamp: new Date(),
                },
              ]);
            }
            break;
          }

          case "tool_start": {
            setToolActivities((prev) => [
              ...prev.slice(-9),
              {
                id: Date.now().toString(),
                tool: msg.tool,
                timestamp: new Date(),
              },
            ]);
            break;
          }

          case "tool_result": {
            setToolActivities((prev) =>
              prev.map((a) =>
                a.tool === msg.tool && !a.result
                  ? { ...a, result: msg.result }
                  : a
              )
            );
            break;
          }

          case "turn_complete":
            // Let scheduled audio finish; clock resets naturally
            playbackTimeRef.current = 0;
            break;

          case "error":
            setError(msg.message);
            break;

          case "reconnect_needed":
            // Will be handled by onclose
            break;
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    };
  }, [driverId, playAudioQueue]);

  const disconnect = useCallback(() => {
    stopMic();
    wsRef.current?.close();
    wsRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    playbackTimeRef.current = 0;
  }, []);

  // ─── Microphone ──────────────────────────────────────────────────────────

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    setIsListening(false);
  }, []);

  const startMic = useCallback(async () => {
    if (!audioContextRef.current || !wsRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      // Also resume playback context (browser may suspend it until user gesture)
      if (playbackCtxRef.current?.state === "suspended") {
        await playbackCtxRef.current.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Capture at native rate then resample to 16kHz for Gemini
      const TARGET_RATE = 16000;
      const nativeRate = ctx.sampleRate; // typically 44100 or 48000
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);

        // Downsample from nativeRate → 16kHz via linear interpolation
        const ratio = nativeRate / TARGET_RATE;
        const outputLen = Math.round(float32.length / ratio);
        const resampled = new Float32Array(outputLen);
        for (let i = 0; i < outputLen; i++) {
          const src = i * ratio;
          const lo = Math.floor(src);
          const hi = Math.min(lo + 1, float32.length - 1);
          resampled[i] = float32[lo] + (float32[hi] - float32[lo]) * (src - lo);
        }

        // Convert to Int16 PCM
        const int16 = new Int16Array(outputLen);
        for (let i = 0; i < outputLen; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, resampled[i] * 32768));
        }

        const binary = String.fromCharCode(...new Uint8Array(int16.buffer));
        wsRef.current.send(
          JSON.stringify({ type: "audio", data: btoa(binary) })
        );
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsListening(true);
    } catch (e) {
      setError("Microphone access denied. Please allow microphone in browser settings.");
    }
  }, []);

  const toggleMic = useCallback(() => {
    if (isListening) stopMic();
    else startMic();
  }, [isListening, startMic, stopMic]);

  // ─── Text/demo input ─────────────────────────────────────────────────────

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscripts((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        speaker: "driver",
        text,
        timestamp: new Date(),
      },
    ]);
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const hos = driverInfo?.hos as Record<string, number | string> | undefined;
  const driveRemaining = (hos?.drive_time_remaining_mins as number) || 0;
  const hosHours = Math.floor(driveRemaining / 60);
  const hosMins = driveRemaining % 60;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="bg-black dark:bg-white rounded-lg p-1.5">
                <Truck className="w-4 h-4 text-white dark:text-black" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground">Sally</h1>
                <p className="text-xs text-muted-foreground">
                  {(driverInfo?.name as string) || "Loading..."}
                </p>
              </div>
            </div>
          </div>

          {/* HOS badge */}
          {hos && (
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span
                className={`text-sm font-mono font-medium ${
                  driveRemaining < 60
                    ? "text-red-400"
                    : driveRemaining < 180
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {hosHours}h {hosMins}min
              </span>
              <span className="text-xs text-muted-foreground">HOS left</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {/* Connection / Voice control */}
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center gap-6">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-green-400"
                  : connectionStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : connectionStatus === "error"
                  ? "bg-red-400"
                  : "bg-gray-500"
              }`}
            />
            <span className="text-sm text-muted-foreground">
              {connectionStatus === "connected"
                ? "Connected to Sally"
                : connectionStatus === "connecting"
                ? "Connecting..."
                : connectionStatus === "error"
                ? "Connection failed"
                : "Not connected"}
            </span>
          </div>

          {/* Main voice button */}
          {isConnected ? (
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={toggleMic}
                className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 ${
                  isListening
                    ? "bg-red-500 hover:bg-red-600 voice-pulse shadow-lg shadow-red-500/30"
                    : isSallyTalking
                    ? "bg-gray-700 cursor-not-allowed"
                    : "bg-black dark:bg-white hover:opacity-90 shadow-lg"
                }`}
                disabled={isSallyTalking}
              >
                {isListening ? (
                  <Mic className="w-10 h-10 text-white" />
                ) : (
                  <MicOff className={`w-10 h-10 ${isSallyTalking ? "text-gray-400" : "text-white dark:text-black"}`} />
                )}
              </button>

              {/* Waveform when Sally talks */}
              {isSallyTalking && (
                <div className="flex items-end gap-1 h-6">
                  <div className="w-1.5 bg-gray-400 rounded-full bar-1" />
                  <div className="w-1.5 bg-gray-400 rounded-full bar-2" />
                  <div className="w-1.5 bg-gray-400 rounded-full bar-3" />
                  <div className="w-1.5 bg-gray-400 rounded-full bar-4" />
                  <div className="w-1.5 bg-gray-400 rounded-full bar-5" />
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                {isListening
                  ? "Listening... tap to stop"
                  : isSallyTalking
                  ? "Sally is speaking..."
                  : "Tap mic to talk to Sally"}
              </p>

              <button
                onClick={disconnect}
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 transition-colors"
              >
                End Session
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connectionStatus === "connecting"}
              className="flex items-center gap-3 bg-black dark:bg-white text-white dark:text-black px-8 py-4 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Radio className="w-5 h-5" />
              {connectionStatus === "connecting" ? "Connecting to Sally..." : "Start Talking to Sally"}
            </button>
          )}

          {error && (
            <p className="text-sm text-red-400 text-center max-w-sm">{error}</p>
          )}
        </div>

        {/* Demo scenarios */}
        {isConnected && (
          <div>
            <p className="text-xs text-muted-foreground mb-2 px-1">
              Demo scenarios — click to trigger (or speak them):
            </p>
            <div className="flex flex-wrap gap-2">
              {DEMO_SCENARIOS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendText(s.text)}
                  className="text-xs border border-border rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
          {/* Transcript */}
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">Conversation</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[320px]">
              {transcripts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center mt-8">
                  Connect and start talking to see the conversation here.
                </p>
              ) : (
                transcripts.map((t) => (
                  <div
                    key={t.id}
                    className={`flex gap-2 ${t.speaker === "driver" ? "flex-row-reverse" : ""}`}
                  >
                    <div
                      className={`text-xs px-3 py-2 rounded-xl max-w-[85%] ${
                        t.speaker === "sally"
                          ? "bg-muted text-foreground"
                          : "bg-black dark:bg-white text-white dark:text-black"
                      }`}
                    >
                      <p className="font-medium mb-0.5 opacity-60">
                        {t.speaker === "sally" ? "Sally" : "You"}
                      </p>
                      <p className="leading-relaxed">{t.text}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* Tool Activity */}
          <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">Sally Actions</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[200px] max-h-[320px]">
              {toolActivities.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center mt-8">
                  Sally's actions will appear here (HOS checks, route safety, stakeholder alerts).
                </p>
              ) : (
                [...toolActivities].reverse().map((activity) => {
                  const Icon = TOOL_ICONS[activity.tool] || Activity;
                  const label = TOOL_LABELS[activity.tool] || activity.tool;
                  return (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg border border-border/50"
                    >
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{label}</p>
                        {activity.result && (
                          <div className="mt-1 space-y-0.5">
                            {activity.result.compliance && (
                              <p
                                className={`text-xs font-medium ${
                                  String(activity.result.compliance).includes("COMPLIANT") &&
                                  !String(activity.result.compliance).includes("NON")
                                    ? "text-green-400"
                                    : "text-red-400"
                                }`}
                              >
                                {String(activity.result.compliance)}
                              </p>
                            )}
                            {activity.result.safe_for_truck !== undefined && (
                              <p
                                className={`text-xs font-medium flex items-center gap-1 ${
                                  activity.result.safe_for_truck ? "text-green-400" : "text-red-400"
                                }`}
                              >
                                {activity.result.safe_for_truck ? (
                                  <CheckCircle className="w-3 h-3" />
                                ) : (
                                  <AlertTriangle className="w-3 h-3" />
                                )}
                                {activity.result.safe_for_truck ? "Route approved" : String(activity.result.reason)}
                              </p>
                            )}
                            {activity.result.notifications_sent && (
                              <p className="text-xs text-green-400 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                All stakeholders notified
                              </p>
                            )}
                            {activity.result.emergency_activated && (
                              <p className="text-xs text-red-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Emergency protocol activated
                              </p>
                            )}
                            {activity.result.drive_time_remaining && (
                              <p className="text-xs text-muted-foreground">
                                HOS: {String(activity.result.drive_time_remaining)} remaining
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {activity.timestamp.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DriverPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading...</div>}>
      <DriverPageInner />
    </Suspense>
  );
}
