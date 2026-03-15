"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Bell, CheckCircle, ChevronDown,
  ChevronRight, ChevronUp, Clock, Database, ExternalLink,
  Fuel, Gauge, LayoutDashboard, Loader2, Mic, MicOff,
  Package, Plus, Power, Radio, RefreshCw, Search, Shield,
  Trash2, Truck, TrendingUp, X, Zap, Edit3, Navigation,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:8080";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Section = "dashboard" | "loads" | "fleet" | "planner" | "compliance" | "ai";
type LoadStatus = "PENDING" | "ASSIGNED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";

interface HOS { drive_time_remaining_mins: number; on_duty_remaining_mins: number; cycle_remaining_hours: number; status: string; break_due_in_mins: number; violation: boolean; }
interface Telemetry { fuel_percent: number | null; engine_state: string; odometer_miles: number | null; }
interface Location { address: string; speed_mph: number; heading: number; lat: number; lng: number; }
interface Driver { id: string; name: string; truck: string; status: string; current_location: Location; hos: HOS; telemetry?: Telemetry; source?: string; }
interface Insight { type: "critical" | "warning" | "info" | "success"; icon: string; title: string; body: string; drivers: string[]; }
interface FleetStats { total: number; on_route: number; resting: number; available: number; violations: number; low_hos: number; low_fuel: number; idling: number; }
interface Load {
  id: string; status: LoadStatus; origin: string; destination: string;
  pickup_date: string; pickup_time: string; pickup_contact: string; pickup_phone: string;
  delivery_date: string; delivery_time: string; delivery_contact: string; delivery_phone: string;
  commodity: string; weight_lbs: number; distance_miles: number; rate: number; fuel_surcharge: number;
  driver_id: string; driver_name: string; truck: string;
  broker_name: string; broker_mc: string; special_instructions: string;
  po_number: string; reference_number: string; created_at: string;
}
interface TripResult {
  rank: number; driver_id: string; driver_name: string; truck: string; status: string;
  location: string; hos_drive_rem: number; plan: { scenario_label: string; compliance: string; earliest_display: string; explanation: string; warnings: string[]; timeline: { event: string; at_mins: number; duration_mins: number; }[]; };
  meets_deadline: boolean | null;
}
interface SaferResult { dot_number: string; legal_name: string; dba_name: string; physical_address: string; phone: string; operating_status: string; safety_rating: string; carrier_operation: string; mcs_150_date: string; power_units: string; drivers: string; safer_url: string; error?: string; }

// ─── Utility helpers ────────────────────────────────────────────────────────────

function fmtMins(m: number) { const h = Math.floor(m / 60); const min = m % 60; return h > 0 ? `${h}h ${min}m` : `${min}m`; }
function hosColor(mins: number) { if (mins <= 0) return "text-red-400"; if (mins < 120) return "text-amber-400"; return "text-emerald-400"; }
function hosBg(mins: number) { if (mins <= 0) return "bg-red-500"; if (mins < 120) return "bg-amber-500"; return "bg-emerald-500"; }
function statusBadge(s: string) {
  const map: Record<string, string> = { on_route: "bg-blue-500/20 text-blue-300 border border-blue-500/30", resting: "bg-slate-600/40 text-slate-300 border border-slate-500/30", loading: "bg-amber-500/20 text-amber-300 border border-amber-500/30", available: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" };
  return map[s] || "bg-slate-700 text-slate-300";
}
function loadStatusBadge(s: LoadStatus) {
  const map: Record<LoadStatus, string> = { PENDING: "bg-amber-500/20 text-amber-300 border border-amber-500/30", ASSIGNED: "bg-blue-500/20 text-blue-300 border border-blue-500/30", IN_TRANSIT: "bg-violet-500/20 text-violet-300 border border-violet-500/30", DELIVERED: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30", CANCELLED: "bg-red-500/20 text-red-300 border border-red-500/30" };
  return map[s] || "bg-slate-700 text-slate-300";
}
function fuelColor(f: number | null | undefined) { if (f == null) return "text-slate-500"; if (f < 20) return "text-red-400"; if (f < 40) return "text-amber-400"; return "text-emerald-400"; }

// ─── Nav items ─────────────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "dashboard",  label: "Dashboard",   Icon: LayoutDashboard },
  { id: "loads",      label: "Load Board",  Icon: Package },
  { id: "fleet",      label: "Fleet",       Icon: Truck },
  { id: "planner",    label: "Trip Planner",Icon: Navigation },
  { id: "compliance", label: "Compliance",  Icon: Shield },
  { id: "ai",         label: "Trucky AI",   Icon: Radio },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════

export default function TruckyTMS() {
  const [section, setSection] = useState<Section>("dashboard");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loads, setLoads]     = useState<Load[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [stats, setStats]     = useState<FleetStats>({ total:0, on_route:0, resting:0, available:0, violations:0, low_hos:0, low_fuel:0, idling:0 });
  const [liveDrivers, setLiveDrivers] = useState(false);
  const [clock, setClock]     = useState(new Date());
  const [unread, setUnread]   = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alertItems, setAlertItems] = useState<string[]>([]);

  // Clock tick
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  // Fetch drivers
  const fetchDrivers = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/drivers`);
      const data: Driver[] = await r.json();
      setDrivers(data);
      setLiveDrivers(data.some(d => d.source === "samsara_live"));
    } catch { /* ignore */ }
  }, []);

  // Fetch insights & stats
  const fetchInsights = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/fleet/insights`);
      const data = await r.json();
      setInsights(data.insights || []);
      setStats(data.stats || {});
      // Build alerts from insights
      const alerts = (data.insights as Insight[]).filter(i => i.type === "critical" || i.type === "warning").map(i => i.title);
      setAlertItems(alerts);
      setUnread(alerts.length);
    } catch { /* ignore */ }
  }, []);

  // Fetch loads
  const fetchLoads = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/loads`);
      const data = await r.json();
      if (Array.isArray(data)) setLoads(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchDrivers();
    fetchInsights();
    fetchLoads();
    const t1 = setInterval(fetchDrivers, 30000);
    const t2 = setInterval(fetchInsights, 60000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchDrivers, fetchInsights, fetchLoads]);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-800">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm leading-tight">Trucky TMS</div>
            <div className="text-xs text-slate-500 leading-tight">Fleet Management</div>
          </div>
        </div>
        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                section === id
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {id === "loads" && loads.filter(l => l.status === "PENDING").length > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {loads.filter(l => l.status === "PENDING").length}
                </span>
              )}
              {id === "compliance" && stats.violations > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {stats.violations}
                </span>
              )}
            </button>
          ))}
        </nav>
        {/* Status */}
        <div className="p-3 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${liveDrivers ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span className="text-slate-400">{liveDrivers ? "Samsara ELD Live" : "Demo Mode"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-400">{stats.total} drivers synced</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center gap-4 px-6 flex-shrink-0">
          <div className="flex-1">
            <h1 className="font-semibold text-white text-sm capitalize">{NAV.find(n => n.id === section)?.label}</h1>
            <p className="text-xs text-slate-500">
              {clock.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — {clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <button onClick={fetchInsights} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative">
            <button onClick={() => setShowAlerts(!showAlerts)} className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <Bell className="w-4 h-4" />
              {unread > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
            </button>
            {showAlerts && (
              <div className="absolute right-0 top-10 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                  <span className="font-semibold text-sm text-white">Alerts</span>
                  <button onClick={() => setShowAlerts(false)}><X className="w-4 h-4 text-slate-400" /></button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-700">
                  {alertItems.length === 0 ? (
                    <div className="px-4 py-6 text-center text-slate-500 text-sm">No active alerts</div>
                  ) : alertItems.map((a, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-slate-300">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {section === "dashboard"  && <DashboardSection drivers={drivers} stats={stats} insights={insights} loads={loads} onSection={setSection} />}
          {section === "loads"      && <LoadsSection loads={loads} drivers={drivers} setLoads={setLoads} onRefresh={fetchLoads} />}
          {section === "fleet"      && <FleetSection drivers={drivers} onRefresh={fetchDrivers} />}
          {section === "planner"    && <PlannerSection drivers={drivers} setLoads={setLoads} />}
          {section === "compliance" && <ComplianceSection drivers={drivers} stats={stats} />}
          {section === "ai"         && <AISection drivers={drivers} stats={stats} />}
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function DashboardSection({ drivers, stats, insights, loads, onSection }: { drivers: Driver[]; stats: FleetStats; insights: Insight[]; loads: Load[]; onSection: (s: Section) => void }) {
  const kpis = [
    { label: "Total Fleet",    value: stats.total,      Icon: Truck,         color: "text-blue-400",    bg: "bg-blue-500/10"   },
    { label: "On Route",       value: stats.on_route,   Icon: Navigation,    color: "text-violet-400",  bg: "bg-violet-500/10" },
    { label: "Available",      value: stats.available,  Icon: CheckCircle,   color: "text-emerald-400", bg: "bg-emerald-500/10"},
    { label: "Open Loads",     value: loads.filter(l => ["PENDING","ASSIGNED"].includes(l.status)).length, Icon: Package, color: "text-amber-400", bg: "bg-amber-500/10" },
    { label: "HOS Warnings",   value: stats.low_hos,    Icon: Clock,         color: "text-orange-400",  bg: "bg-orange-500/10" },
    { label: "Violations",     value: stats.violations, Icon: AlertTriangle, color: "text-red-400",     bg: "bg-red-500/10"    },
    { label: "Low Fuel",       value: stats.low_fuel,   Icon: Fuel,          color: "text-rose-400",    bg: "bg-rose-500/10"   },
    { label: "Idling",         value: stats.idling,     Icon: Zap,           color: "text-cyan-400",    bg: "bg-cyan-500/10"   },
  ];

  const onRoute = drivers.filter(d => d.status === "on_route");

  return (
    <div className="p-6 space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
        {kpis.map(({ label, value, Icon, color, bg }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-1 leading-tight">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Active drivers */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <span className="font-semibold text-sm text-white">Active Drivers</span>
            <button onClick={() => onSection("fleet")} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
            {onRoute.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-500 text-sm">No drivers currently on route</div>
            ) : onRoute.map(d => (
              <div key={d.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{d.name}</div>
                  <div className="text-xs text-slate-500 truncate">{d.current_location.address}</div>
                </div>
                <div className="text-xs text-slate-400">{d.truck}</div>
                <div className="text-xs font-medium text-blue-300">{d.current_location.speed_mph} mph</div>
                <div className={`text-xs font-semibold ${hosColor(d.hos.drive_time_remaining_mins)}`}>
                  {fmtMins(d.hos.drive_time_remaining_mins)} HOS
                </div>
              </div>
            ))}
            {drivers.filter(d => d.status !== "on_route").slice(0, 6).map(d => (
              <div key={d.id} className="px-5 py-3 flex items-center gap-4 opacity-60">
                <div className="w-2 h-2 rounded-full bg-slate-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{d.name}</div>
                  <div className="text-xs text-slate-500 truncate">{d.current_location.address}</div>
                </div>
                <div className="text-xs text-slate-400">{d.truck}</div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(d.status)}`}>{d.status}</span>
                <div className={`text-xs font-semibold ${hosColor(d.hos.drive_time_remaining_mins)}`}>
                  {fmtMins(d.hos.drive_time_remaining_mins)} HOS
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <span className="font-semibold text-sm text-white">Fleet Intelligence</span>
          </div>
          <div className="divide-y divide-slate-800 max-h-80 overflow-y-auto">
            {insights.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-500 text-sm">Loading insights…</div>
            ) : insights.map((ins, i) => {
              const colorMap = { critical: "border-l-red-500", warning: "border-l-amber-500", info: "border-l-blue-500", success: "border-l-emerald-500" };
              const textMap = { critical: "text-red-400", warning: "text-amber-400", info: "text-blue-400", success: "text-emerald-400" };
              return (
                <div key={i} className={`px-4 py-3 border-l-2 ${colorMap[ins.type]}`}>
                  <div className={`text-xs font-semibold ${textMap[ins.type]} mb-0.5`}>{ins.title}</div>
                  <div className="text-xs text-slate-400">{ins.body}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent loads */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <span className="font-semibold text-sm text-white">Recent Loads</span>
          <button onClick={() => onSection("loads")} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            Load Board <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {loads.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">No loads created yet. Go to Load Board to add your first load.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-2 text-left">Load #</th>
              <th className="px-4 py-2 text-left">Route</th>
              <th className="px-4 py-2 text-left">Driver</th>
              <th className="px-4 py-2 text-left">Rate</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800">
              {loads.slice(0, 5).map(l => (
                <tr key={l.id} className="hover:bg-slate-800/40">
                  <td className="px-5 py-3 font-mono text-xs text-blue-300">{l.id}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{l.origin} → {l.destination}</td>
                  <td className="px-4 py-3 text-slate-400">{l.driver_name || "Unassigned"}</td>
                  <td className="px-4 py-3 text-emerald-400 font-medium">${(l.rate + l.fuel_surcharge).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${loadStatusBadge(l.status)}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD BOARD
// ═══════════════════════════════════════════════════════════════════════════════

const BLANK_LOAD: Partial<Load> = {
  status: "PENDING", origin: "", destination: "", pickup_date: "", pickup_time: "08:00",
  pickup_contact: "", pickup_phone: "", delivery_date: "", delivery_time: "17:00",
  delivery_contact: "", delivery_phone: "", commodity: "General Freight", weight_lbs: 0,
  distance_miles: 0, rate: 0, fuel_surcharge: 0, driver_id: "", driver_name: "Unassigned",
  truck: "", broker_name: "", broker_mc: "", special_instructions: "",
  po_number: "", reference_number: "",
};

function LoadsSection({ loads, drivers, setLoads, onRefresh }: { loads: Load[]; drivers: Driver[]; setLoads: (l: Load[]) => void; onRefresh: () => void }) {
  const [filter, setFilter] = useState<LoadStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editLoad, setEditLoad] = useState<Partial<Load>>(BLANK_LOAD);
  const [saving, setSaving]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  const filtered = loads.filter(l => {
    if (filter !== "ALL" && l.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.id.toLowerCase().includes(q) || l.origin.toLowerCase().includes(q) || l.destination.toLowerCase().includes(q) || (l.driver_name || "").toLowerCase().includes(q);
    }
    return true;
  });

  async function calcDistance() {
    if (!editLoad.destination) return;
    setCalcLoading(true);
    try {
      const r = await fetch(`${API}/api/distance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: editLoad.origin, destination: editLoad.destination }) });
      const data = await r.json();
      if (data.distance_miles) setEditLoad(prev => ({ ...prev, distance_miles: data.distance_miles }));
    } finally {
      setCalcLoading(false);
    }
  }

  async function saveLoad() {
    setSaving(true);
    try {
      if ((editLoad as Load).id && (editLoad as Load).created_at) {
        // Update
        const r = await fetch(`${API}/api/loads/${(editLoad as Load).id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editLoad) });
        const updated = await r.json();
        setLoads(loads.map(l => l.id === updated.id ? updated : l));
      } else {
        const r = await fetch(`${API}/api/loads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editLoad) });
        const created = await r.json();
        setLoads([...loads, created]);
      }
      setShowModal(false);
      setEditLoad(BLANK_LOAD);
    } finally {
      setSaving(false);
    }
  }

  async function deleteLoad(id: string) {
    if (!confirm("Delete this load?")) return;
    await fetch(`${API}/api/loads/${id}`, { method: "DELETE" });
    setLoads(loads.filter(l => l.id !== id));
  }

  async function updateStatus(id: string, status: LoadStatus) {
    const r = await fetch(`${API}/api/loads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const updated = await r.json();
    setLoads(loads.map(l => l.id === updated.id ? updated : l));
  }

  const availableDrivers = drivers.filter(d => d.hos.drive_time_remaining_mins >= 180 && d.status !== "on_route");

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loads, drivers, routes…" className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
          {(["ALL","PENDING","ASSIGNED","IN_TRANSIT","DELIVERED","CANCELLED"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filter === f ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>
              {f === "IN_TRANSIT" ? "In Transit" : f.charAt(0) + f.slice(1).toLowerCase()}
              {f !== "ALL" && <span className="ml-1 opacity-60">({loads.filter(l => l.status === f).length})</span>}
              {f === "ALL" && <span className="ml-1 opacity-60">({loads.length})</span>}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditLoad(BLANK_LOAD); setShowModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Load
        </button>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-3 text-left">Load #</th>
              <th className="px-4 py-3 text-left">Route</th>
              <th className="px-4 py-3 text-left">Pickup</th>
              <th className="px-4 py-3 text-left">Delivery</th>
              <th className="px-4 py-3 text-left">Driver</th>
              <th className="px-4 py-3 text-left">Commodity</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-500">No loads found. Click <strong className="text-white">New Load</strong> to create your first rate confirmation.</td></tr>
            )}
            {filtered.map(l => (
              <>
                <tr key={l.id} className="hover:bg-slate-800/40 cursor-pointer" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                  <td className="px-5 py-3 font-mono text-xs text-blue-300 font-semibold">{l.id}</td>
                  <td className="px-4 py-3">
                    <div className="text-white text-xs font-medium truncate max-w-48">{l.origin || "—"}</div>
                    <div className="text-slate-500 text-xs flex items-center gap-1"><ChevronDown className="w-3 h-3" />{l.destination || "—"}</div>
                    {l.distance_miles > 0 && <div className="text-slate-600 text-xs">{l.distance_miles} mi</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{l.pickup_date ? `${l.pickup_date} ${l.pickup_time}` : "—"}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{l.delivery_date ? `${l.delivery_date} ${l.delivery_time}` : "—"}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{l.driver_name || <span className="text-slate-600 italic">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-32">{l.commodity}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-emerald-400 font-semibold">${(l.rate + l.fuel_surcharge).toLocaleString()}</div>
                    <div className="text-slate-600 text-xs">${l.rate.toLocaleString()} + ${l.fuel_surcharge} FSC</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <select value={l.status} onChange={e => { e.stopPropagation(); updateStatus(l.id, e.target.value as LoadStatus); }}
                      onClick={e => e.stopPropagation()}
                      className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer font-medium ${loadStatusBadge(l.status)} bg-transparent`}>
                      {["PENDING","ASSIGNED","IN_TRANSIT","DELIVERED","CANCELLED"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditLoad(l); setShowModal(true); }} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition-colors"><Edit3 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteLoad(l.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
                {expandedId === l.id && (
                  <tr key={`${l.id}-exp`}>
                    <td colSpan={9} className="px-5 py-4 bg-slate-800/50">
                      <div className="grid grid-cols-4 gap-6 text-xs">
                        <div><div className="text-slate-500 font-medium mb-2">PICKUP</div>
                          <div className="text-white">{l.pickup_contact || "—"}</div>
                          <div className="text-slate-400">{l.pickup_phone || "—"}</div></div>
                        <div><div className="text-slate-500 font-medium mb-2">DELIVERY</div>
                          <div className="text-white">{l.delivery_contact || "—"}</div>
                          <div className="text-slate-400">{l.delivery_phone || "—"}</div></div>
                        <div><div className="text-slate-500 font-medium mb-2">BROKER</div>
                          <div className="text-white">{l.broker_name || "—"}</div>
                          <div className="text-slate-400">MC# {l.broker_mc || "—"}</div></div>
                        <div><div className="text-slate-500 font-medium mb-2">REFERENCES</div>
                          <div className="text-white">PO: {l.po_number || "—"}</div>
                          <div className="text-slate-400">Ref: {l.reference_number || "—"}</div>
                          {l.special_instructions && <div className="text-amber-300 mt-1">{l.special_instructions}</div>}</div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h2 className="font-semibold text-white">{(editLoad as Load).id ? "Edit Load" : "New Rate Confirmation"}</h2>
                {(editLoad as Load).id && <p className="text-xs text-slate-500 font-mono">{(editLoad as Load).id}</p>}
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {/* Route */}
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Route</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Origin *</label>
                    <input value={editLoad.origin || ""} onChange={e => setEditLoad(p => ({...p, origin: e.target.value}))} placeholder="City, State or full address" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Destination *</label>
                    <input value={editLoad.destination || ""} onChange={e => setEditLoad(p => ({...p, destination: e.target.value}))} placeholder="City, State or full address" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={calcDistance} disabled={calcLoading || !editLoad.destination} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-300 hover:text-blue-300 text-xs rounded-lg transition-all disabled:opacity-40">
                    {calcLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />}
                    Calculate Distance
                  </button>
                  {(editLoad.distance_miles ?? 0) > 0 && (
                    <span className="text-xs text-emerald-400 font-semibold">{editLoad.distance_miles} miles</span>
                  )}
                </div>
              </div>

              {/* Pickup + Delivery */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pickup</div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-xs text-slate-400 mb-1">Date</label><input type="date" value={editLoad.pickup_date || ""} onChange={e => setEditLoad(p => ({...p, pickup_date: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Time</label><input type="time" value={editLoad.pickup_time || "08:00"} onChange={e => setEditLoad(p => ({...p, pickup_time: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                    </div>
                    <input value={editLoad.pickup_contact || ""} onChange={e => setEditLoad(p => ({...p, pickup_contact: e.target.value}))} placeholder="Contact name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <input value={editLoad.pickup_phone || ""} onChange={e => setEditLoad(p => ({...p, pickup_phone: e.target.value}))} placeholder="Phone number" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Delivery</div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-xs text-slate-400 mb-1">Date</label><input type="date" value={editLoad.delivery_date || ""} onChange={e => setEditLoad(p => ({...p, delivery_date: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Time</label><input type="time" value={editLoad.delivery_time || "17:00"} onChange={e => setEditLoad(p => ({...p, delivery_time: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                    </div>
                    <input value={editLoad.delivery_contact || ""} onChange={e => setEditLoad(p => ({...p, delivery_contact: e.target.value}))} placeholder="Contact name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <input value={editLoad.delivery_phone || ""} onChange={e => setEditLoad(p => ({...p, delivery_phone: e.target.value}))} placeholder="Phone number" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              {/* Commodity */}
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Freight Details</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2"><label className="block text-xs text-slate-400 mb-1">Commodity</label><input value={editLoad.commodity || ""} onChange={e => setEditLoad(p => ({...p, commodity: e.target.value}))} placeholder="General Freight" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Weight (lbs)</label><input type="number" value={editLoad.weight_lbs || ""} onChange={e => setEditLoad(p => ({...p, weight_lbs: +e.target.value}))} placeholder="40000" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div><label className="block text-xs text-slate-400 mb-1">PO Number</label><input value={editLoad.po_number || ""} onChange={e => setEditLoad(p => ({...p, po_number: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Reference #</label><input value={editLoad.reference_number || ""} onChange={e => setEditLoad(p => ({...p, reference_number: e.target.value}))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                </div>
              </div>

              {/* Rate */}
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Rate</div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="block text-xs text-slate-400 mb-1">Linehaul Rate ($)</label><input type="number" value={editLoad.rate || ""} onChange={e => setEditLoad(p => ({...p, rate: +e.target.value}))} placeholder="2500" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Fuel Surcharge ($)</label><input type="number" value={editLoad.fuel_surcharge || ""} onChange={e => setEditLoad(p => ({...p, fuel_surcharge: +e.target.value}))} placeholder="250" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Total</label><div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-emerald-400 font-bold text-sm">${((editLoad.rate || 0) + (editLoad.fuel_surcharge || 0)).toLocaleString()}</div></div>
                </div>
              </div>

              {/* Broker + Driver */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Broker / Shipper</div>
                  <div className="space-y-2">
                    <input value={editLoad.broker_name || ""} onChange={e => setEditLoad(p => ({...p, broker_name: e.target.value}))} placeholder="Broker / Shipper name" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <input value={editLoad.broker_mc || ""} onChange={e => setEditLoad(p => ({...p, broker_mc: e.target.value}))} placeholder="MC # or DOT #" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Assign Driver</div>
                  <select value={editLoad.driver_id || ""} onChange={e => {
                    const drv = availableDrivers.find(d => d.id === e.target.value);
                    setEditLoad(p => ({...p, driver_id: e.target.value, driver_name: drv?.name || "Unassigned", truck: drv?.truck || ""}));
                  }} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">Unassigned</option>
                    {availableDrivers.map(d => (
                      <option key={d.id} value={d.id}>{d.name} — {fmtMins(d.hos.drive_time_remaining_mins)} HOS — {d.truck}</option>
                    ))}
                  </select>
                  {editLoad.truck && <div className="text-xs text-slate-500 mt-1">{editLoad.truck}</div>}
                </div>
              </div>

              {/* Special instructions */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Special Instructions</label>
                <textarea value={editLoad.special_instructions || ""} onChange={e => setEditLoad(p => ({...p, special_instructions: e.target.value}))} rows={2} placeholder="TONU conditions, hazmat, temp requirements, etc." className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={saveLoad} disabled={saving || !editLoad.origin || !editLoad.destination} className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                {(editLoad as Load).created_at ? "Update Load" : "Create Load"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLEET
// ═══════════════════════════════════════════════════════════════════════════════

function FleetSection({ drivers, onRefresh: _onRefresh }: { drivers: Driver[]; onRefresh: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filters = [
    { id: "all",        label: "All" },
    { id: "on_route",   label: "On Route" },
    { id: "resting",    label: "Resting" },
    { id: "violations", label: "Violations" },
    { id: "low_fuel",   label: "Low Fuel" },
  ];

  const filtered = drivers.filter(d => {
    if (filter === "on_route"   && d.status !== "on_route") return false;
    if (filter === "resting"    && d.status !== "resting") return false;
    if (filter === "violations" && !d.hos.violation) return false;
    if (filter === "low_fuel"   && ((d.telemetry?.fuel_percent ?? 100) >= 25)) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.truck.toLowerCase().includes(q) || d.current_location.address.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, truck, location…" className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filter === f.id ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={_onRefresh} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700 transition-colors"><RefreshCw className="w-4 h-4" /></button>
        <span className="text-xs text-slate-500">{filtered.length} / {drivers.length} drivers</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(d => {
          const isExpanded = expandedId === d.id;
          const driveRem = d.hos.drive_time_remaining_mins;
          const shiftRem = d.hos.on_duty_remaining_mins;
          const fuel = d.telemetry?.fuel_percent ?? null;
          const eng = d.telemetry?.engine_state ?? "Unknown";
          const odo = d.telemetry?.odometer_miles ?? null;
          return (
            <div key={d.id} className={`bg-slate-900 border rounded-xl overflow-hidden transition-all ${d.hos.violation ? "border-red-500/50" : "border-slate-800"}`}>
              <div className="px-4 py-3 flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${d.status === "on_route" ? "bg-blue-400" : d.hos.violation ? "bg-red-400" : "bg-slate-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white truncate">{d.name}</span>
                    {d.hos.violation && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{d.truck}</div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{d.current_location.address}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(d.status)}`}>{d.status}</span>
                  {d.current_location.speed_mph > 0 && <span className="text-xs text-blue-300 font-medium">{d.current_location.speed_mph} mph</span>}
                </div>
              </div>

              {/* HOS bars always visible */}
              <div className="px-4 pb-3 space-y-1.5">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Drive</span>
                    <span className={hosColor(driveRem)}>{fmtMins(driveRem)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${hosBg(driveRem)}`} style={{ width: `${Math.min(100, driveRem / 660 * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Shift</span>
                    <span className={hosColor(shiftRem)}>{fmtMins(shiftRem)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${hosBg(shiftRem)}`} style={{ width: `${Math.min(100, shiftRem / 840 * 100)}%` }} />
                  </div>
                </div>
              </div>

              {/* Telemetry badges */}
              <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                {fuel != null && (
                  <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 ${fuelColor(fuel)}`}>
                    <Fuel className="w-3 h-3" />
                    {fuel}%
                  </div>
                )}
                <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 ${eng === "On" ? "text-emerald-400" : eng === "Off" ? "text-slate-400" : "text-slate-500"}`}>
                  <Power className="w-3 h-3" />
                  {eng}
                </div>
                {odo != null && (
                  <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    <Gauge className="w-3 h-3" />
                    {odo.toLocaleString()} mi
                  </div>
                )}
                {d.hos.break_due_in_mins > 0 && d.hos.break_due_in_mins < 60 && (
                  <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                    <Clock className="w-3 h-3" />
                    Break in {d.hos.break_due_in_mins}m
                  </div>
                )}
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-slate-800 px-4 py-3 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-slate-500 mb-1">Cycle Remaining</div>
                      <div className="text-white font-medium">{d.hos.cycle_remaining_hours}h</div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1">ELD Status</div>
                      <div className="text-white font-medium">{d.hos.status}</div>
                    </div>
                  </div>
                  {d.hos.violation && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-300">
                      ⚠ HOS VIOLATION — Driver must stop immediately
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIP PLANNER
// ═══════════════════════════════════════════════════════════════════════════════

function PlannerSection({ drivers, setLoads }: { drivers: Driver[]; setLoads: (fn: (prev: Load[]) => Load[]) => void }) {
  const [origin, setOrigin]     = useState("");
  const [dest, setDest]         = useState("");
  const [distMiles, setDistMiles] = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading]   = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [results, setResults]   = useState<TripResult[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);

  async function calcDistance() {
    if (!dest) return;
    setCalcLoading(true);
    try {
      const r = await fetch(`${API}/api/distance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination: dest }) });
      const data = await r.json();
      if (data.distance_miles) setDistMiles(data.distance_miles);
      else alert(data.error || "Could not calculate distance");
    } finally {
      setCalcLoading(false);
    }
  }

  async function plan() {
    if (!dest || !distMiles) return;
    setLoading(true);
    setResults([]);
    try {
      const r = await fetch(`${API}/api/trip/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: dest, distance_miles: distMiles, required_by: deadline || undefined }) });
      const data = await r.json();
      setResults(data.results || []);
    } finally {
      setLoading(false);
    }
  }

  async function assignDriver(res: TripResult) {
    const load = {
      origin: origin || "Fleet Location",
      destination: dest,
      distance_miles: typeof distMiles === "number" ? distMiles : 0,
      driver_id: res.driver_id,
      driver_name: res.driver_name,
      truck: res.truck,
      status: "ASSIGNED",
      delivery_date: deadline ? deadline.split("T")[0] : "",
      delivery_time: deadline ? (deadline.split("T")[1] || "17:00") : "17:00",
    };
    const r = await fetch(`${API}/api/loads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(load) });
    const created = await r.json();
    setLoads(prev => [...prev, created]);
    setAssigned(res.driver_id);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-5 gap-6">
        {/* Form */}
        <div className="col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2"><Navigation className="w-4 h-4 text-blue-400" /> Plan a Load</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Origin (optional)</label>
                <input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Leave blank to use nearest driver" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Destination *</label>
                <input value={dest} onChange={e => setDest(e.target.value)} placeholder="e.g. Chicago, IL" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>

              {/* Auto-distance */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Distance (miles)</label>
                  <input type="number" value={distMiles} onChange={e => setDistMiles(+e.target.value || "")} placeholder="Auto-calculate ↓" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <button onClick={calcDistance} disabled={calcLoading || !dest} className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 border border-slate-700 hover:border-blue-500 text-slate-300 hover:text-blue-300 text-xs rounded-lg transition-all disabled:opacity-40 whitespace-nowrap">
                  {calcLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Navigation className="w-3 h-3" />} Calculate
                </button>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Delivery Deadline (optional)</label>
                <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>

              <button onClick={plan} disabled={loading || !dest || !distMiles} className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Finding Drivers…</> : <><TrendingUp className="w-4 h-4" /> Find Best Drivers</>}
              </button>
            </div>
          </div>

          {/* Legend */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
            <div className="font-semibold text-slate-300 mb-2">FMCSA Rules Applied</div>
            <div>• 11h max driving / 14h shift window</div>
            <div>• 30-min break after 8h continuous driving</div>
            <div>• 10h off-duty rest if shift exhausted</div>
            <div>• 70h/8-day cycle limit</div>
            <div>• 34h restart if cycle exhausted</div>
          </div>
        </div>

        {/* Results */}
        <div className="col-span-3 space-y-3">
          {results.length === 0 && !loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col items-center justify-center py-24 text-center">
              <Navigation className="w-8 h-8 text-slate-600 mb-3" />
              <div className="text-slate-500 text-sm">Enter a destination and click Find Best Drivers</div>
              <div className="text-slate-600 text-xs mt-1">Uses real Samsara HOS data for all {drivers.length} drivers</div>
            </div>
          )}
          {loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center py-24">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
                <div className="text-slate-400 text-sm">Evaluating {drivers.length} drivers against FMCSA rules…</div>
              </div>
            </div>
          )}
          {results.map(res => {
            const isExp = expanded === res.rank;
            const compColor = res.plan.compliance === "COMPLIANT" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : res.plan.compliance === "NEEDS_REST" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" : "text-red-400 bg-red-500/10 border-red-500/20";
            const isAssigned = assigned === res.driver_id;
            return (
              <div key={res.rank} className={`bg-slate-900 border rounded-xl overflow-hidden transition-all ${res.rank === 1 ? "border-blue-500/50" : "border-slate-800"}`}>
                {res.rank === 1 && <div className="bg-blue-600 text-white text-xs font-semibold px-4 py-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Recommended</div>}
                <div className="p-4 flex items-start gap-4">
                  <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0">#{res.rank}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white">{res.driver_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${compColor}`}>{res.plan.compliance}</span>
                      {res.meets_deadline === true && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">On time</span>}
                      {res.meets_deadline === false && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">Late</span>}
                    </div>
                    <div className="text-xs text-slate-500 mb-1">{res.truck} — {res.location}</div>
                    <div className="text-xs text-slate-400 mb-2">{res.plan.scenario_label}</div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className="text-slate-400">HOS Remaining: <span className={hosColor(res.hos_drive_rem)}>{fmtMins(res.hos_drive_rem)}</span></div>
                      <div className="text-slate-400">Arrives: <span className="text-white font-semibold">{res.plan.earliest_display}</span></div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {isAssigned ? (
                      <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Assigned</span>
                    ) : (
                      <button onClick={() => assignDriver(res)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors">Assign</button>
                    )}
                    <button onClick={() => setExpanded(isExp ? null : res.rank)} className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
                      Timeline {isExp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                {isExp && (
                  <div className="border-t border-slate-800 px-4 py-3 space-y-2">
                    <div className="text-xs text-slate-400 mb-3">{res.plan.explanation}</div>
                    <div className="flex gap-0">
                      {res.plan.timeline.map((t, i) => {
                        const isRest = t.event.includes("Rest") || t.event.includes("Break");
                        return (
                          <div key={i} className="flex-1 min-w-0">
                            <div className={`h-4 text-xs flex items-center justify-center text-white rounded-sm mx-0.5 ${isRest ? "bg-amber-600" : t.event === "Arrive" ? "bg-emerald-600" : "bg-blue-600"}`} />
                            <div className="text-xs text-slate-500 mt-1 text-center truncate">{t.event}</div>
                          </div>
                        );
                      })}
                    </div>
                    {res.plan.warnings.length > 0 && (
                      <div className="text-xs text-amber-400 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{res.plan.warnings.join(" • ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════════

function ComplianceSection({ drivers, stats }: { drivers: Driver[]; stats: FleetStats }) {
  const [sortBy, setSortBy] = useState<"drive" | "shift" | "name">("drive");
  const [dotNumber, setDotNumber] = useState("");
  const [safer, setSafer]         = useState<SaferResult | null>(null);
  const [saferLoading, setSaferLoading] = useState(false);
  const [hosFilter, setHosFilter] = useState("all");

  async function lookupSafer() {
    if (!dotNumber) return;
    setSaferLoading(true);
    setSafer(null);
    try {
      const r = await fetch(`${API}/api/safer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dot_number: dotNumber }) });
      setSafer(await r.json());
    } finally {
      setSaferLoading(false);
    }
  }

  const sorted = [...drivers]
    .filter(d => {
      if (hosFilter === "violations") return d.hos.violation;
      if (hosFilter === "low_hos") return d.hos.drive_time_remaining_mins < 120 && !d.hos.violation;
      if (hosFilter === "on_route") return d.status === "on_route";
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "shift") return a.hos.on_duty_remaining_mins - b.hos.on_duty_remaining_mins;
      return a.hos.drive_time_remaining_mins - b.hos.drive_time_remaining_mins;
    });

  const compliancePct = drivers.length > 0 ? Math.round((drivers.length - stats.violations) / drivers.length * 100) : 100;

  return (
    <div className="p-6 space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Compliant", value: drivers.length - stats.violations, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Violations", value: stats.violations, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Low HOS (<2h)", value: stats.low_hos, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Compliance Rate", value: `${compliancePct}%`, color: "text-blue-400", bg: "bg-blue-500/10" },
        ].map(c => (
          <div key={c.label} className={`${c.bg} border border-slate-800 rounded-xl p-4`}>
            <div className={`text-3xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-slate-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* HOS Table */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <span className="font-semibold text-sm text-white">HOS Status — All Drivers</span>
            <div className="flex items-center gap-2">
              <select value={hosFilter} onChange={e => setHosFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none">
                <option value="all">All Drivers</option>
                <option value="violations">Violations Only</option>
                <option value="low_hos">Low HOS</option>
                <option value="on_route">On Route</option>
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as "drive" | "shift" | "name")} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none">
                <option value="drive">Sort: Drive Rem</option>
                <option value="shift">Sort: Shift Rem</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-340px)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-2 text-left">Driver</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Drive Rem</th>
                  <th className="px-4 py-2 text-left">Shift Rem</th>
                  <th className="px-4 py-2 text-left">Cycle</th>
                  <th className="px-4 py-2 text-center">HOS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sorted.map(d => (
                  <tr key={d.id} className={`hover:bg-slate-800/40 ${d.hos.violation ? "bg-red-500/5" : ""}`}>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-white">{d.name}</div>
                      <div className="text-slate-600">{d.truck}</div>
                    </td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full ${statusBadge(d.status)}`}>{d.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className={`font-semibold ${hosColor(d.hos.drive_time_remaining_mins)}`}>{fmtMins(d.hos.drive_time_remaining_mins)}</div>
                      <div className="h-1 bg-slate-800 rounded-full mt-1 w-20">
                        <div className={`h-full rounded-full ${hosBg(d.hos.drive_time_remaining_mins)}`} style={{ width: `${Math.min(100, d.hos.drive_time_remaining_mins / 660 * 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className={hosColor(d.hos.on_duty_remaining_mins)}>{fmtMins(d.hos.on_duty_remaining_mins)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">{d.hos.cycle_remaining_hours}h</td>
                    <td className="px-4 py-2.5 text-center">
                      {d.hos.violation
                        ? <span className="text-red-400 flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3" />VIOLATION</span>
                        : d.hos.drive_time_remaining_mins < 120
                        ? <span className="text-amber-400">LOW HOS</span>
                        : <span className="text-emerald-400">OK</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SAFER lookup */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="font-semibold text-sm text-white mb-4 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" /> SAFER / FMCSA Lookup</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">USDOT Number</label>
                <input value={dotNumber} onChange={e => setDotNumber(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupSafer()} placeholder="e.g. 1234567" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <button onClick={lookupSafer} disabled={saferLoading || !dotNumber} className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors">
                {saferLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {saferLoading ? "Looking up…" : "Lookup Carrier"}
              </button>
            </div>

            {safer && (
              <div className="mt-4 space-y-3">
                {safer.error && !safer.legal_name ? (
                  <div className="text-red-400 text-xs">{safer.error}</div>
                ) : (
                  <>
                    <div className="border-t border-slate-800 pt-3">
                      <div className="font-semibold text-white text-sm">{safer.legal_name || "—"}</div>
                      {safer.dba_name && safer.dba_name !== "N/A" && <div className="text-xs text-slate-400">DBA: {safer.dba_name}</div>}
                    </div>
                    {[
                      { label: "Address",    value: safer.physical_address },
                      { label: "Phone",      value: safer.phone },
                      { label: "Status",     value: safer.operating_status },
                      { label: "Safety Rtg", value: safer.safety_rating },
                      { label: "Operation",  value: safer.carrier_operation },
                      { label: "Power Units",value: safer.power_units },
                      { label: "Drivers",    value: safer.drivers },
                      { label: "MCS-150",    value: safer.mcs_150_date },
                    ].map(({ label, value }) => value && value !== "N/A" ? (
                      <div key={label} className="flex justify-between text-xs">
                        <span className="text-slate-500">{label}</span>
                        <span className={`text-slate-300 text-right max-w-40 ${label === "Status" && value.toLowerCase().includes("authorized") ? "text-emerald-400" : ""}`}>{value}</span>
                      </div>
                    ) : null)}
                    <a href={safer.safer_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 pt-1">
                      <ExternalLink className="w-3 h-3" /> View full SAFER report
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI (TRUCKY VOICE)
// ═══════════════════════════════════════════════════════════════════════════════

function AISection({ drivers: _drivers, stats }: { drivers: Driver[]; stats: FleetStats }) {
  const [connected, setConnected]   = useState(false);
  const [active, setActive]         = useState(false);
  const [transcript, setTranscript] = useState<{ speaker: string; text: string }[]>([]);
  const [toolLog, setToolLog]       = useState<{ tool: string; result: Record<string, unknown> }[]>([]);
  const wsRef  = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextTimeRef = useRef(0);
  const txRef = useRef(transcript);
  txRef.current = transcript;

  const suggestions = [
    "What's the status of the entire fleet right now?",
    "Who has HOS violations?",
    "What is Hector's fuel level?",
    "Who can make a 400 mile delivery to Chicago today?",
    "Which drivers are available for new loads?",
    "Show me drivers with low fuel",
  ];

  useEffect(() => { return () => disconnect(); }, []);

  function disconnect() {
    procRef.current?.disconnect();
    srcRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();
    ctxRef.current?.close();
    procRef.current = null; srcRef.current = null; streamRef.current = null; wsRef.current = null; ctxRef.current = null;
    setConnected(false); setActive(false);
  }

  async function connect() {
    if (connected) { disconnect(); return; }
    const ws = new WebSocket(`${WS}/ws/dispatcher/voice`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setActive(false); };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "audio" && msg.data) {
        const ctx = ctxRef.current || new AudioContext({ sampleRate: 24000 });
        ctxRef.current = ctx;
        const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
        const pcm = new Int16Array(bytes.buffer);
        const float = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768;
        const buf = ctx.createBuffer(1, float.length, 24000);
        buf.copyToChannel(float, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const now = ctx.currentTime;
        const start = Math.max(now, nextTimeRef.current);
        src.start(start);
        nextTimeRef.current = start + buf.duration;
      }
      if (msg.type === "transcript" && msg.speaker === "trucky") {
        setTranscript(prev => [...prev.slice(-30), { speaker: "Trucky", text: msg.text }]);
      }
      if (msg.type === "tool_result") {
        setToolLog(prev => [...prev.slice(-10), { tool: msg.tool, result: msg.result as Record<string, unknown> }]);
      }
    };
  }

  async function toggleMic() {
    if (!connected) return;
    if (active) {
      procRef.current?.disconnect(); srcRef.current?.disconnect();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setActive(false); return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
    streamRef.current = stream;
    const ctx = ctxRef.current || new AudioContext();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const targetLen = Math.round(raw.length * 16000 / ctx.sampleRate);
      const resampled = new Int16Array(targetLen);
      for (let i = 0; i < targetLen; i++) {
        const idx = Math.min(Math.floor(i * ctx.sampleRate / 16000), raw.length - 1);
        resampled[i] = Math.max(-32768, Math.min(32767, raw[idx] * 32768));
      }
      const b64 = btoa(String.fromCharCode(...new Uint8Array(resampled.buffer)));
      wsRef.current.send(JSON.stringify({ type: "audio", data: b64 }));
    };
    src.connect(proc); proc.connect(ctx.destination);
    srcRef.current = src; procRef.current = proc;
    setActive(true);
  }

  function sendText(text: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscript(prev => [...prev.slice(-30), { speaker: "You", text }]);
  }

  return (
    <div className="p-6 grid grid-cols-3 gap-6 h-[calc(100vh-56px)]">
      {/* Voice panel */}
      <div className="col-span-2 flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}`} />
            <span className="font-semibold text-white">Trucky AI — Dispatcher Mode</span>
            {connected && <span className="text-xs bg-violet-500/20 border border-violet-500/30 text-violet-300 px-2 py-0.5 rounded-full">Live</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleMic} disabled={!connected} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${active ? "bg-red-600 hover:bg-red-500 text-white" : "bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"}`}>
              {active ? <><MicOff className="w-4 h-4" /> Stop</> : <><Mic className="w-4 h-4" /> Speak</>}
            </button>
            <button onClick={connect} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${connected ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-violet-600 hover:bg-violet-500 text-white"}`}>
              <Radio className="w-4 h-4" />
              {connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {transcript.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Radio className="w-10 h-10 text-slate-700 mb-4" />
              <div className="text-slate-500 text-sm mb-2">Connect to start talking to Trucky</div>
              <div className="text-slate-600 text-xs">Ask about your fleet, drivers, fuel levels, HOS status</div>
            </div>
          )}
          {transcript.map((t, i) => (
            <div key={i} className={`flex gap-3 ${t.speaker === "You" ? "flex-row-reverse" : ""}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${t.speaker === "Trucky" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300"}`}>
                {t.speaker[0]}
              </div>
              <div className={`max-w-lg rounded-xl px-4 py-2.5 text-sm ${t.speaker === "Trucky" ? "bg-slate-800 text-slate-100" : "bg-blue-600/20 text-slate-100 border border-blue-500/20"}`}>
                {t.text}
              </div>
            </div>
          ))}
        </div>

        {/* Suggestions */}
        <div className="border-t border-slate-800 p-4">
          <div className="text-xs text-slate-500 mb-2">Quick questions:</div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button key={s} onClick={() => sendText(s)} className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-700 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panels */}
      <div className="flex flex-col gap-4">
        {/* Fleet snapshot */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Fleet Snapshot</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { label: "Total", value: stats.total, color: "text-white" },
              { label: "On Route", value: stats.on_route, color: "text-blue-400" },
              { label: "Available", value: stats.available, color: "text-emerald-400" },
              { label: "Violations", value: stats.violations, color: "text-red-400" },
            ].map(s => (
              <div key={s.label} className="bg-slate-800 rounded-lg p-2.5">
                <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tool activity */}
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tool Activity</span>
          </div>
          <div className="overflow-y-auto h-full divide-y divide-slate-800/50">
            {toolLog.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-600 text-xs">Tool calls will appear here</div>
            ) : toolLog.slice().reverse().map((t, i) => (
              <div key={i} className="px-4 py-3">
                <div className="text-xs font-mono text-violet-300 mb-1">{t.tool}()</div>
                <div className="text-xs text-slate-500 truncate">{JSON.stringify(t.result).slice(0, 80)}…</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
