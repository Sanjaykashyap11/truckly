"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Truck, AlertTriangle, CheckCircle, Clock, Radio, Activity,
  Shield, Fuel, Wrench, MapPin, Bell, BellOff, Navigation, Zap,
  Mic, MicOff, X, Database, ChevronDown, ChevronUp, Search,
  TrendingUp, Package, RefreshCw, AlertCircle, Timer, Filter,
  ArrowRight, BarChart3, Gauge, Power,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:8080";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HOS {
  drive_time_remaining_mins: number;
  on_duty_remaining_mins: number;
  cycle_remaining_hours: number;
  status: string;
  break_due_in_mins: number;
  violation: boolean;
}
interface Telemetry {
  fuel_percent: number | null;
  engine_state: string;
  odometer_miles: number | null;
}
interface Driver {
  id: string;
  name: string;
  truck: string;
  status: string;
  current_location: { address: string; speed_mph: number; heading: number; lat: number; lng: number };
  hos: HOS;
  telemetry?: Telemetry;
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
interface Insight {
  type: "critical" | "warning" | "info" | "success";
  icon: string;
  title: string;
  body: string;
  drivers: string[];
}
interface TripPlanResult {
  rank: number;
  driver_id: string;
  driver_name: string;
  truck: string;
  status: string;
  location: string;
  speed_mph: number;
  hos_drive_rem: number;
  hos_shift_rem: number;
  plan: {
    can_deliver: boolean;
    scenario: string;
    scenario_label: string;
    compliance: string;
    earliest_display: string;
    drive_time_label: string;
    rest_required: boolean;
    break_required: boolean;
    explanation: string;
    warnings: string[];
    timeline: { event: string; at_mins: number; duration_mins: number | null }[];
  };
  meets_deadline: boolean | null;
}
interface ToolActivity { id: string; session_id: string; is_dispatcher?: boolean; tool: string; result: Record<string, unknown>; timestamp: Date; }
interface Transcript   { id: string; speaker: "dispatcher" | "trucky"; text: string; timestamp: Date; }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  on_route: "bg-green-400 shadow-green-400/50 shadow-sm",
  loading:  "bg-yellow-400",
  at_shipper:"bg-yellow-400",
  resting:  "bg-slate-500",
  unknown:  "bg-slate-600",
};
const STATUS_LABEL: Record<string, string> = {
  on_route: "On Route", loading: "Loading", at_shipper: "At Shipper", resting: "Resting", unknown: "Unknown",
};
const COMPLIANCE_COLOR: Record<string, string> = {
  COMPLIANT:           "text-green-400 bg-green-400/10 border-green-400/30",
  NEEDS_REST:          "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  AVAILABLE_AFTER_REST:"text-blue-400 bg-blue-400/10 border-blue-400/30",
  NEEDS_RESTART:       "text-orange-400 bg-orange-400/10 border-orange-400/30",
  CANNOT_ASSIGN:       "text-red-400 bg-red-400/10 border-red-400/30",
};
const INSIGHT_COLORS: Record<string, string> = {
  critical: "border-l-red-500 bg-red-500/5",
  warning:  "border-l-yellow-500 bg-yellow-500/5",
  info:     "border-l-blue-500 bg-blue-500/5",
  success:  "border-l-green-500 bg-green-500/5",
};
const DISPATCHER_SCENARIOS = [
  { label: "Fleet Status",   text: "Give me a full fleet status update right now." },
  { label: "Available Now",  text: "Which drivers are available for a new load right now?" },
  { label: "HOS Warnings",   text: "Which drivers are running low on hours?" },
  { label: "Plan Load",      text: "Who can deliver to Boston, 250 miles, by tomorrow 5PM?" },
  { label: "Violations",     text: "Any HOS violations or compliance issues right now?" },
  { label: "Fuel Alert",     text: "Which trucks need fuel? Anyone below 25%?" },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function HOSMiniBar({ label, mins, maxMins, warn, danger }: { label: string; mins: number; maxMins: number; warn: number; danger: number }) {
  const pct = Math.min(100, (mins / maxMins) * 100);
  const color = mins < danger ? "bg-red-500" : mins < warn ? "bg-yellow-500" : "bg-emerald-500";
  const h = Math.floor(mins / 60); const m = mins % 60;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500">{label}</span>
        <span className={`font-mono ${mins < danger ? "text-red-400" : mins < warn ? "text-yellow-400" : "text-slate-300"}`}>{h}h {m}m</span>
      </div>
      <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FuelBar({ pct }: { pct: number }) {
  const color = pct < 15 ? "bg-red-500" : pct < 30 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-1.5">
      <Fuel className="w-3 h-3 text-slate-500" />
      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-mono ${pct < 15 ? "text-red-400" : pct < 30 ? "text-yellow-400" : "text-slate-400"}`}>{pct}%</span>
    </div>
  );
}

function DriverCard({ driver, onPlanLoad }: { driver: Driver; onPlanLoad: (d: Driver) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hos  = driver.hos;
  const tel  = driver.telemetry;
  const loc  = driver.current_location;
  const isViolation = hos.violation;
  const isLowHOS = hos.drive_time_remaining_mins < 120 && hos.drive_time_remaining_mins > 0;
  const isBreakSoon = 0 < hos.break_due_in_mins && hos.break_due_in_mins < 30 && driver.status === "on_route";

  return (
    <div className={`bg-slate-900 border rounded-xl overflow-hidden transition-colors ${
      isViolation ? "border-red-500/50" : isLowHOS ? "border-yellow-500/30" : "border-slate-700/60 hover:border-slate-600"
    }`}>
      {/* Compact row */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Status + Name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[driver.status] || "bg-slate-500"}`} />
              <span className="font-semibold text-sm text-white truncate">{driver.name}</span>
              <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{STATUS_LABEL[driver.status] || driver.status}</span>
              {isViolation && <span className="text-[10px] text-red-400 bg-red-400/10 border border-red-400/30 px-1.5 py-0.5 rounded font-medium">HOS VIOLATION</span>}
              {isBreakSoon && <span className="text-[10px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 px-1.5 py-0.5 rounded">BREAK DUE</span>}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{driver.truck}</p>
          </div>

          {/* Engine + Fuel inline */}
          <div className="flex items-center gap-2 shrink-0">
            {tel?.engine_state && (
              <div className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${tel.engine_state === "On" ? "text-green-400 bg-green-400/10 border-green-400/20" : "text-slate-500 bg-slate-800 border-slate-700"}`}>
                <Power className="w-2.5 h-2.5" />
                {tel.engine_state}
              </div>
            )}
            {tel?.fuel_percent != null && (
              <div className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${tel.fuel_percent < 25 ? "text-red-400 bg-red-400/10 border-red-400/20" : "text-slate-400 bg-slate-800 border-slate-700"}`}>
                <Fuel className="w-2.5 h-2.5 inline mr-0.5" />{tel.fuel_percent}%
              </div>
            )}
            <button onClick={() => setExpanded(e => !e)} className="text-slate-500 hover:text-slate-300">
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Location + Speed */}
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{loc.address || "Location unavailable"}</span>
          {loc.speed_mph > 0 && <span className="shrink-0 font-mono text-slate-400">{loc.speed_mph} mph</span>}
        </div>

        {/* HOS bars */}
        <div className="mt-2.5 space-y-1.5">
          <HOSMiniBar label="Drive" mins={hos.drive_time_remaining_mins} maxMins={660} warn={180} danger={60} />
          <HOSMiniBar label="Shift" mins={hos.on_duty_remaining_mins}    maxMins={840} warn={240} danger={60} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-700/60 px-4 py-3 space-y-3 bg-slate-900/50">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">70-Hr Cycle</p>
              <p className="text-white font-mono">{hos.cycle_remaining_hours}h remaining</p>
            </div>
            <div>
              <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Next Break Due</p>
              <p className={`font-mono ${hos.break_due_in_mins < 60 ? "text-yellow-400" : "text-white"}`}>
                {hos.break_due_in_mins > 0 ? `In ${Math.floor(hos.break_due_in_mins/60)}h ${hos.break_due_in_mins%60}m` : "Break needed now"}
              </p>
            </div>
            {tel?.odometer_miles != null && (
              <div>
                <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">Odometer</p>
                <p className="text-white font-mono">{tel.odometer_miles.toLocaleString()} mi</p>
              </div>
            )}
            <div>
              <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1">ELD Status</p>
              <p className="text-slate-300 font-mono text-[11px]">{hos.status}</p>
            </div>
          </div>

          {tel && tel.fuel_percent != null && <FuelBar pct={tel.fuel_percent} />}

          <div className="flex gap-2">
            <button
              onClick={() => onPlanLoad(driver)}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-white text-black rounded-lg px-3 py-1.5 font-medium hover:bg-slate-200 transition-colors"
            >
              <Package className="w-3 h-3" /> Assign Load
            </button>
            <Link
              href={`/driver?id=${driver.id}`}
              className="flex items-center gap-1.5 text-xs border border-slate-700 rounded-lg px-3 py-1.5 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
            >
              <Radio className="w-3 h-3" /> Trucky
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Trip Planner ─────────────────────────────────────────────────────────────

function TripPlanner({ prefilledDriver }: { prefilledDriver?: Driver }) {
  const [destination, setDestination] = useState("");
  const [miles, setMiles] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TripPlanResult[] | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefilledDriver) {
      setDestination("");
      setMiles("");
      setResults(null);
    }
  }, [prefilledDriver]);

  const search = async () => {
    if (!miles || isNaN(Number(miles))) { setError("Enter valid distance in miles"); return; }
    setLoading(true); setError(null); setResults(null);
    try {
      const body: Record<string, unknown> = { destination: destination || "Destination", distance_miles: Number(miles) };
      if (requiredBy) body.required_by = new Date(requiredBy).toISOString();
      const r = await fetch(`${API_URL}/api/trip/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setResults(d.results || []);
    } catch { setError("Failed to compute trip plan. Backend may be offline."); }
    finally { setLoading(false); }
  };

  const complianceBadge = (c: string) => (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${COMPLIANCE_COLOR[c] || "text-slate-400 border-slate-600"}`}>{c.replace(/_/g," ")}</span>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-700/60 flex items-center gap-2">
        <Package className="w-4 h-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-white">Load Planner</h2>
        <span className="text-[10px] text-slate-500 ml-auto">FMCSA-Compliant HOS</span>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Destination</label>
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="e.g. Boston, MA"
            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Distance (miles)</label>
          <input
            value={miles}
            onChange={e => setMiles(e.target.value)}
            placeholder="e.g. 250"
            type="number"
            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide">Required By (optional)</label>
          <input
            value={requiredBy}
            onChange={e => setRequiredBy(e.target.value)}
            type="datetime-local"
            className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none [color-scheme:dark]"
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? "Computing HOS Plans..." : "Find Best Driver"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {results && (
        <div className="flex-1 overflow-y-auto border-t border-slate-700/60">
          <div className="p-3 space-y-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide px-1">
              {results.length} drivers evaluated — sorted by earliest delivery
            </p>
            {results.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No drivers available for this load.</p>}
            {results.map(r => (
              <div key={r.rank} className={`border rounded-xl overflow-hidden ${
                r.plan.compliance === "COMPLIANT" ? "border-green-500/30 bg-green-500/5" :
                r.plan.compliance === "NEEDS_REST" ? "border-yellow-500/30 bg-yellow-500/5" :
                r.plan.compliance === "CANNOT_ASSIGN" ? "border-slate-700 opacity-60" :
                "border-slate-700 bg-slate-900/50"
              }`}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold text-slate-400">#{r.rank}</span>
                        <span className="text-sm font-semibold text-white">{r.driver_name}</span>
                        {complianceBadge(r.plan.compliance)}
                        {r.meets_deadline === true && <span className="text-[10px] text-green-400">✓ Meets Deadline</span>}
                        {r.meets_deadline === false && <span className="text-[10px] text-red-400">✗ Misses Deadline</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{r.truck}</p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" />{r.location}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-white">{r.plan.earliest_display}</p>
                      <p className="text-[10px] text-slate-500">Drive: {r.plan.drive_time_label}</p>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{r.plan.explanation}</p>

                  {r.plan.warnings.length > 0 && r.plan.warnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-yellow-400 flex items-center gap-1 mt-1">
                      <AlertTriangle className="w-2.5 h-2.5" />{w}
                    </p>
                  ))}

                  {/* HOS mini bars */}
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    <HOSMiniBar label="Drive Rem" mins={r.hos_drive_rem} maxMins={660} warn={180} danger={60} />
                    <HOSMiniBar label="Shift Rem" mins={r.hos_shift_rem} maxMins={840} warn={240} danger={60} />
                  </div>

                  {/* Timeline */}
                  {r.plan.timeline.length > 0 && (
                    <button onClick={() => setExpandedPlan(expandedPlan === r.rank ? null : r.rank)}
                      className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      {expandedPlan === r.rank ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {expandedPlan === r.rank ? "Hide" : "Show"} Trip Timeline
                    </button>
                  )}
                  {expandedPlan === r.rank && (
                    <div className="mt-2 space-y-1">
                      {r.plan.timeline.map((t, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            t.event.includes("Arrive") ? "bg-green-400" :
                            t.event.includes("Rest") ? "bg-blue-400" :
                            t.event.includes("Break") ? "bg-yellow-400" : "bg-slate-400"
                          }`} />
                          <span className="text-slate-300 font-mono">+{Math.floor(t.at_mins/60)}h{t.at_mins%60}m</span>
                          <span className="text-slate-400">{t.event}</span>
                          {t.duration_mins != null && t.duration_mins > 0 && (
                            <span className="text-slate-600">({Math.floor(t.duration_mins/60)}h{t.duration_mins%60}m)</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dispatcher Voice Panel ────────────────────────────────────────────────────

function DispatcherVoicePanel({ onClose }: { onClose: () => void }) {
  const [isConnected, setIsConnected]   = useState(false);
  const [isListening, setIsListening]   = useState(false);
  const [isTruckyTalking, setTruckyTalking] = useState(false);
  const [status, setStatus]   = useState<"idle"|"connecting"|"connected"|"error">("idle");
  const [transcripts, setTranscripts]   = useState<Transcript[]>([]);
  const [error, setError] = useState<string|null>(null);

  const wsRef       = useRef<WebSocket|null>(null);
  const audioCtxRef = useRef<AudioContext|null>(null);
  const playCtxRef  = useRef<AudioContext|null>(null);
  const playTimeRef = useRef(0);
  const procRef     = useRef<ScriptProcessorNode|null>(null);
  const srcRef      = useRef<MediaStreamAudioSourceNode|null>(null);
  const streamRef   = useRef<MediaStream|null>(null);
  const endRef      = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcripts]);
  useEffect(() => () => { disconnectVoice(); }, []);

  const scheduleChunk = useCallback((buf: ArrayBuffer) => {
    const ctx = playCtxRef.current; if (!ctx) return;
    const p = new Int16Array(buf);
    const f = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) f[i] = p[i] / 32768;
    const ab = ctx.createBuffer(1, f.length, 24000);
    ab.getChannelData(0).set(f);
    const s = ctx.createBufferSource(); s.buffer = ab; s.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, playTimeRef.current);
    s.start(at); playTimeRef.current = at + ab.duration;
    s.onended = () => { if (playTimeRef.current <= ctx.currentTime + 0.05) setTruckyTalking(false); };
  }, []);

  const connectVoice = useCallback(async () => {
    setStatus("connecting"); setError(null);
    audioCtxRef.current = new AudioContext();
    playCtxRef.current  = new AudioContext({ sampleRate: 24000 });
    playTimeRef.current = 0;
    const ws = new WebSocket(`${WS_URL}/ws/dispatcher/voice`);
    wsRef.current = ws;
    ws.onopen  = () => { setIsConnected(true); setStatus("connected"); };
    ws.onclose = e => {
      setIsConnected(false); setIsListening(false); setTruckyTalking(false);
      if (e.code === 1011 || e.code === 1006) { setStatus("connecting"); setTimeout(connectVoice, 3000); }
      else setStatus("idle");
    };
    ws.onerror = () => { setError("Connection failed."); setStatus("error"); };
    ws.onmessage = async ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "audio") {
        const b = atob(msg.data); const u = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
        setTruckyTalking(true); scheduleChunk(u.buffer);
      } else if (msg.type === "transcript" && msg.text?.trim()) {
        setTranscripts(p => [...p, { id: Date.now().toString(), speaker: msg.speaker === "trucky" ? "trucky" : "dispatcher", text: msg.text, timestamp: new Date() }]);
      } else if (msg.type === "turn_complete") { playTimeRef.current = 0; }
      else if (msg.type === "error") setError(msg.message);
    };
  }, [scheduleChunk]);

  const stopMic = useCallback(() => {
    procRef.current?.disconnect(); srcRef.current?.disconnect(); streamRef.current?.getTracks().forEach(t => t.stop());
    procRef.current = null; srcRef.current = null; streamRef.current = null; setIsListening(false);
  }, []);

  const disconnectVoice = useCallback(() => {
    stopMic(); wsRef.current?.close(); wsRef.current = null;
    audioCtxRef.current?.close(); audioCtxRef.current = null;
    playCtxRef.current?.close(); playCtxRef.current = null;
    setIsConnected(false); setStatus("idle");
  }, [stopMic]);

  const startMic = useCallback(async () => {
    if (!audioCtxRef.current || !wsRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream;
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      if (playCtxRef.current?.state === "suspended") await playCtxRef.current.resume();
      const src = ctx.createMediaStreamSource(stream); srcRef.current = src;
      const RATE = 16000; const native = ctx.sampleRate;
      const proc = ctx.createScriptProcessor(4096, 1, 1); procRef.current = proc;
      proc.onaudioprocess = e => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const f = e.inputBuffer.getChannelData(0); const r = native / RATE;
        const out = Math.round(f.length / r); const rs = new Float32Array(out);
        for (let i = 0; i < out; i++) { const s = i * r; const lo = Math.floor(s); const hi = Math.min(lo+1, f.length-1); rs[i] = f[lo] + (f[hi]-f[lo])*(s-lo); }
        const i16 = new Int16Array(out);
        for (let i = 0; i < out; i++) i16[i] = Math.max(-32768, Math.min(32767, rs[i]*32768));
        wsRef.current.send(JSON.stringify({ type: "audio", data: btoa(String.fromCharCode(...new Uint8Array(i16.buffer))) }));
      };
      src.connect(proc); proc.connect(ctx.destination); setIsListening(true);
    } catch { setError("Microphone access denied."); }
  }, []);

  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscripts(p => [...p, { id: Date.now().toString(), speaker: "dispatcher", text, timestamp: new Date() }]);
  }, []);

  return (
    <div className="fixed bottom-0 right-0 w-full sm:w-[400px] bg-slate-900 border border-slate-700 border-b-0 rounded-t-2xl shadow-2xl z-50 flex flex-col" style={{ maxHeight: 500 }}>
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-700 shrink-0">
        <div className="bg-purple-600 rounded-lg p-1.5"><Zap className="w-3.5 h-3.5 text-white" /></div>
        <div><h3 className="text-sm font-bold text-white">Trucky Dispatch AI</h3><p className="text-[10px] text-slate-500">Voice-powered fleet intelligence</p></div>
        <div className={`ml-auto text-[10px] flex items-center gap-1.5 ${status === "connected" ? "text-green-400" : "text-slate-500"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-green-400 animate-pulse" : "bg-slate-600"}`} />
          {status === "connected" ? "Live" : status === "connecting" ? "Connecting..." : "Offline"}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white ml-2"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {transcripts.length === 0
          ? <p className="text-xs text-slate-500 text-center mt-8">Ask Trucky about your fleet, loads, HOS, violations…</p>
          : transcripts.map(t => (
            <div key={t.id} className={`flex gap-2 ${t.speaker === "dispatcher" ? "flex-row-reverse" : ""}`}>
              <div className={`text-xs px-3 py-2 rounded-xl max-w-[85%] ${t.speaker === "trucky" ? "bg-slate-800 text-slate-200" : "bg-purple-700 text-white"}`}>
                <p className="font-medium mb-0.5 opacity-60 text-[10px]">{t.speaker === "trucky" ? "Trucky" : "You"}</p>
                <p className="leading-relaxed">{t.text}</p>
              </div>
            </div>
          ))}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-slate-700 p-3 space-y-2.5">
        {isConnected && (
          <div className="flex flex-wrap gap-1.5">
            {DISPATCHER_SCENARIOS.map(s => (
              <button key={s.label} onClick={() => sendText(s.text)} className="text-[10px] border border-slate-700 rounded-lg px-2 py-1 text-slate-400 hover:text-white hover:border-slate-500 transition-colors">{s.label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          {isConnected ? (
            <>
              <button onClick={() => isListening ? stopMic() : startMic()} disabled={isTruckyTalking}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${isListening ? "bg-red-500 hover:bg-red-600" : isTruckyTalking ? "bg-slate-700 cursor-not-allowed" : "bg-purple-600 hover:bg-purple-500"}`}>
                {isListening ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-white opacity-70" />}
              </button>
              {isTruckyTalking && (
                <div className="flex items-end gap-0.5 h-5">
                  {[6,10,14,10,6].map((h,i) => <div key={i} className="w-1 bg-purple-400 rounded-full animate-pulse" style={{ height: h }} />)}
                </div>
              )}
              <p className="text-xs text-slate-500 flex-1">{isListening ? "Listening..." : isTruckyTalking ? "Trucky speaking..." : "Tap to ask Trucky"}</p>
              <button onClick={disconnectVoice} className="text-xs text-slate-500 hover:text-white border border-slate-700 rounded-lg px-2.5 py-1.5">End</button>
            </>
          ) : (
            <button onClick={connectVoice} disabled={status === "connecting"} className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors disabled:opacity-50">
              <Zap className="w-4 h-4" />{status === "connecting" ? "Connecting..." : "Talk to Trucky Dispatch"}
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

// ─── Insights Panel ────────────────────────────────────────────────────────────

function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <div className="space-y-2">
      {insights.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">Loading fleet intelligence…</p>
      ) : insights.map((ins, i) => (
        <div key={i} className={`border-l-2 rounded-r-lg p-3 ${INSIGHT_COLORS[ins.type] || "border-l-slate-600"}`}>
          <p className="text-xs font-semibold text-white">{ins.title}</p>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{ins.body}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function DispatcherDashboard() {
  const [drivers,   setDrivers]   = useState<Driver[]>([]);
  const [alerts,    setAlerts]    = useState<Alert[]>([]);
  const [insights,  setInsights]  = useState<Insight[]>([]);
  const [stats,     setStats]     = useState<Record<string, number>>({});
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveELD,   setLiveELD]   = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [search,    setSearch]    = useState("");
  const [filter,    setFilter]    = useState("all");
  const [planDriver, setPlanDriver] = useState<Driver | undefined>();
  const [showAlerts, setShowAlerts] = useState(false);
  const wsRef = useRef<WebSocket|null>(null);

  const fetchInsights = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/fleet/insights`);
      const d = await r.json();
      setInsights(d.insights || []);
      setStats(d.stats || {});
    } catch {}
  }, []);

  useEffect(() => {
    fetchInsights();
    const iv = setInterval(fetchInsights, 60000);
    return () => clearInterval(iv);
  }, [fetchInsights]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${WS_URL}/ws/dispatcher`);
      wsRef.current = ws;
      ws.onopen  = () => setWsConnected(true);
      ws.onclose = () => { setWsConnected(false); setTimeout(connect, 3000); };
      ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "init") {
          setDrivers(msg.drivers || []); setAlerts(msg.alerts || []);
          setLiveELD(msg.drivers?.some((d: Driver) => d.source === "samsara_live"));
        } else if (msg.type === "drivers_update") {
          setDrivers(msg.drivers || []); setLiveELD(msg.source === "samsara_live");
          fetchInsights();
        } else if (msg.type === "new_alert") {
          setAlerts(p => [msg.alert, ...p]);
        } else if (msg.type === "tool_activity") {
          setActivities(p => [...p.slice(-19), { id: Date.now().toString(), session_id: msg.session_id || msg.driver_id || "", is_dispatcher: msg.is_dispatcher, tool: msg.tool, result: msg.result, timestamp: new Date() }]);
        }
      };
    };

    const fetchRest = async () => {
      try {
        const [dr, al] = await Promise.all([
          fetch(`${API_URL}/api/drivers`).then(r => r.json()),
          fetch(`${API_URL}/api/alerts`).then(r => r.json()),
        ]);
        setDrivers(dr); setAlerts(al);
        setLiveELD(dr.some((d: Driver) => d.source === "samsara_live"));
      } catch {}
    };

    connect(); fetchRest();
    const iv = setInterval(fetchRest, 30000);
    return () => { clearInterval(iv); wsRef.current?.close(); };
  }, [fetchInsights]);

  const ackAlert = async (id: string) => {
    try {
      await fetch(`${API_URL}/api/alerts/${id}/acknowledge`, { method: "POST" });
      setAlerts(p => p.map(a => a.id === id ? { ...a, acknowledged: true } : a));
    } catch {}
  };

  const filtered = drivers.filter(d => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.truck.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || (filter === "on_route" && d.status === "on_route") || (filter === "resting" && d.status === "resting") || (filter === "low_hos" && d.hos.drive_time_remaining_mins < 120) || (filter === "violations" && d.hos.violation) || (filter === "available" && d.hos.drive_time_remaining_mins >= 300 && d.status !== "on_route");
    return matchSearch && matchFilter;
  });

  const unacked = alerts.filter(a => !a.acknowledged).length;

  // Stats
  const total    = stats.total    || drivers.length;
  const onRoute  = stats.on_route || drivers.filter(d => d.status === "on_route").length;
  const avail    = stats.available || 0;
  const hosWarn  = stats.low_hos  || 0;
  const viols    = stats.violations || 0;
  const lowFuel  = stats.low_fuel || 0;
  const idling   = stats.idling   || 0;

  const KPI = [
    { label: "Total Fleet",    value: total,   sub: "drivers",         icon: Truck,        color: "text-slate-300" },
    { label: "On Route",       value: onRoute,  sub: "active now",     icon: Navigation,   color: "text-green-400" },
    { label: "Available",      value: avail,    sub: "for new loads",  icon: Package,      color: "text-blue-400" },
    { label: "HOS Warnings",   value: hosWarn,  sub: "< 2h left",      icon: Timer,        color: "text-yellow-400" },
    { label: "Violations",     value: viols,    sub: "must stop now",  icon: AlertCircle,  color: "text-red-400" },
    { label: "Low Fuel",       value: lowFuel,  sub: "below 25%",      icon: Fuel,         color: "text-orange-400" },
    { label: "Idling",         value: idling,   sub: "engine on, parked", icon: Gauge,     color: "text-purple-400" },
    { label: "Unread Alerts",  value: unacked,  sub: "need attention", icon: Bell,         color: "text-pink-400" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-white rounded-lg p-1.5"><Truck className="w-4 h-4 text-black" /></div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">Trucky</h1>
              <p className="text-[10px] text-slate-500 leading-none">Fleet Intelligence Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {liveELD && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-2 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <Database className="w-3 h-3" /> Samsara Live
              </div>
            )}
            <div className={`flex items-center gap-1.5 text-[10px] ${wsConnected ? "text-slate-400" : "text-slate-600"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-slate-400 animate-pulse" : "bg-slate-700"}`} />
              {wsConnected ? "WS Connected" : "Reconnecting"}
            </div>
            <button onClick={() => setShowAlerts(v => !v)} className={`relative flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${showAlerts ? "bg-slate-700 border-slate-600 text-white" : "border-slate-700 text-slate-400 hover:text-white hover:border-slate-600"}`}>
              <Bell className="w-3.5 h-3.5" /> Alerts
              {unacked > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">{unacked}</span>}
            </button>
            <button onClick={() => setShowVoice(v => !v)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${showVoice ? "bg-purple-700 text-white" : "bg-purple-600 hover:bg-purple-500 text-white"}`}>
              <Zap className="w-3.5 h-3.5" /> Talk to Trucky
            </button>
            <Link href="/driver" className="flex items-center gap-1.5 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] text-slate-400 hover:text-white hover:border-slate-600 transition-colors">
              <Radio className="w-3.5 h-3.5" /> Driver
            </Link>
          </div>
        </div>
      </header>

      {/* ── KPI Bar ── */}
      <div className="border-b border-slate-800 bg-slate-900/40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-4 sm:grid-cols-8 divide-x divide-slate-800">
            {KPI.map(k => (
              <div key={k.label} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xl font-bold text-white">{k.value}</p>
                  <k.icon className={`w-4 h-4 ${k.color}`} />
                </div>
                <p className="text-[10px] font-medium text-slate-300 leading-tight">{k.label}</p>
                <p className="text-[10px] text-slate-600 leading-tight">{k.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Alerts Panel (slide-down) ── */}
      {showAlerts && (
        <div className="border-b border-slate-800 bg-slate-900/60 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.length === 0 ? <p className="text-xs text-slate-500 col-span-3 text-center py-2">No alerts</p> : alerts.map(a => (
              <div key={a.id} className={`flex items-start gap-2 p-2.5 rounded-lg border-l-2 ${a.severity === "HIGH" ? "border-l-red-500 bg-red-500/5" : a.severity === "MEDIUM" ? "border-l-yellow-500 bg-yellow-500/5" : "border-l-blue-500 bg-blue-500/5"} ${a.acknowledged ? "opacity-40" : ""}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-white">{a.driver_name}</p>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{a.message}</p>
                </div>
                {!a.acknowledged && <button onClick={() => ackAlert(a.id)} className="shrink-0 text-slate-500 hover:text-white"><BellOff className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main 3-column layout ── */}
      <div className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_280px] gap-4 h-full">

          {/* ── LEFT: Trip Planner ── */}
          <div className="bg-slate-900 border border-slate-700/60 rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 220px)" }}>
            <TripPlanner prefilledDriver={planDriver} />
          </div>

          {/* ── CENTER: Fleet Grid ── */}
          <div className="flex flex-col gap-3">
            {/* Search + Filter bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search driver or truck…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                {["all","on_route","resting","available","low_hos","violations"].map(f => (
                  <button key={f} onClick={() => setFilter(f)} className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${filter === f ? "bg-white text-black border-white" : "border-slate-700 text-slate-400 hover:border-slate-500"}`}>
                    {f.replace("_"," ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
              <span>{filtered.length} drivers shown</span>
              {liveELD && <span className="flex items-center gap-1 text-emerald-400"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Samsara ELD — refreshes every 30s</span>}
            </div>

            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 270px)" }}>
              {filtered.length === 0 ? (
                <div className="bg-slate-900 border border-slate-700/60 rounded-xl p-8 text-center text-slate-500 text-sm">
                  {drivers.length === 0 ? "Loading fleet data from Samsara…" : "No drivers match your filter"}
                </div>
              ) : (
                filtered.map(d => <DriverCard key={d.id} driver={d} onPlanLoad={setPlanDriver} />)
              )}
            </div>
          </div>

          {/* ── RIGHT: Intelligence + Activity ── */}
          <div className="flex flex-col gap-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
            {/* Fleet Intelligence */}
            <div className="bg-slate-900 border border-slate-700/60 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/60 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-white">Fleet Intelligence</h2>
                <button onClick={fetchInsights} className="ml-auto text-slate-500 hover:text-white"><RefreshCw className="w-3 h-3" /></button>
              </div>
              <div className="p-3">
                <InsightsPanel insights={insights} />
              </div>
            </div>

            {/* Live Tool Activity */}
            <div className="bg-slate-900 border border-slate-700/60 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/60 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-semibold text-white">Trucky Activity</h2>
                <span className="ml-auto text-[10px] text-slate-500">Live</span>
              </div>
              <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                {activities.length === 0
                  ? <p className="text-[11px] text-slate-500 text-center py-4">Trucky&apos;s tool actions appear here</p>
                  : [...activities].reverse().map(a => (
                    <div key={a.id} className="flex items-start gap-2 text-[11px]">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0 mt-1" />
                      <div className="flex-1 min-w-0">
                        <span className="text-white font-medium">{a.is_dispatcher ? "Dispatch" : a.session_id.slice(0,8)}</span>
                        <span className="text-slate-400"> — {a.tool.replace(/_/g," ")}</span>
                        {a.result?.compliance != null && <p className={String(a.result.compliance).includes("COMPLIANT") ? "text-green-400" : "text-yellow-400"}>{String(a.result.compliance)}</p>}
                        {a.result?.safe_for_truck === false && <p className="text-red-400">⚠ Route blocked</p>}
                        {a.result?.notifications_sent != null && <p className="text-green-400">✓ Notified</p>}
                        {a.result?.top_drivers != null && <p className="text-blue-400">Trip plan computed</p>}
                      </div>
                      <span className="text-slate-600 shrink-0">{a.timestamp.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false})}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showVoice && <DispatcherVoicePanel onClose={() => setShowVoice(false)} />}
    </div>
  );
}
