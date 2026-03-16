"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BarChart3, ChevronDown, ChevronRight,
  ChevronUp, Clock, Database, Droplets, ExternalLink,
  LayoutDashboard, Loader2, MessageSquare, Mic, MicOff, Navigation, Package, Plus,
  Power, Radio, RefreshCw, Search, Shield, Trash2, Truck, TrendingUp,
  X, Edit3, Wrench, Users, FileText, Wifi, WifiOff,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS  = process.env.NEXT_PUBLIC_WS_URL  || "ws://localhost:8080";

type Section = "dashboard" | "loads" | "trucks" | "drivers" | "planner" | "reports" | "compliance";
type LoadStatus = "PENDING" | "ASSIGNED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";

interface HOS { drive_time_remaining_mins: number; on_duty_remaining_mins: number; cycle_remaining_hours: number; status: string; break_due_in_mins: number; violation: boolean; }
interface Telemetry { fuel_percent: number | null; engine_state: string; odometer_miles: number | null; }
interface Driver { id: string; name: string; truck: string; status: string; current_location: { address: string; speed_mph: number; heading: number; lat: number; lng: number }; hos: HOS; telemetry?: Telemetry; source?: string; }
interface Insight { type: "critical" | "warning" | "info" | "success"; icon: string; title: string; body: string; drivers: string[]; }
interface FleetStats { total: number; on_route: number; resting: number; available: number; violations: number; low_hos: number; low_fuel: number; idling: number; }
interface Load { id: string; status: LoadStatus; origin: string; destination: string; pickup_date: string; pickup_time: string; pickup_contact: string; pickup_phone: string; delivery_date: string; delivery_time: string; delivery_contact: string; delivery_phone: string; commodity: string; weight_lbs: number; distance_miles: number; rate: number; fuel_surcharge: number; driver_id: string; driver_name: string; truck: string; broker_name: string; broker_mc: string; special_instructions: string; po_number: string; reference_number: string; created_at: string; }
interface TruckData { truck_name: string; driver_id: string; driver_name: string; status: string; location: string; lat: number; lng: number; speed_mph: number; fuel_percent: number | null; fuel_gallons: number | null; engine_state: string; odometer_miles: number | null; hos_drive_rem: number; maintenance: { oil_change_due: boolean; tire_rotation_due: boolean; inspection_due: boolean }; }
interface RefillEvent { truck: string; timestamp: string; prev_pct: number; new_pct: number; gallons_added: number; est_cost: number; location: string; }
interface TripResult { rank: number; driver_id: string; driver_name: string; truck: string; status: string; location: string; hos_drive_rem: number; plan: { scenario_label: string; compliance: string; earliest_display: string; explanation: string; warnings: string[]; timeline: { event: string; at_mins: number; duration_mins: number }[] }; meets_deadline: boolean | null; }
interface SaferResult { dot_number: string; legal_name: string; dba_name: string; physical_address: string; phone: string; operating_status: string; authority_status: string; safety_rating: string; review_date: string; carrier_operation: string; mcs_150_date: string; power_units: string; drivers: string; mc_number: string; safer_url: string; error?: string; }

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtMins = (m: number) => { const h = Math.floor(m / 60); const min = m % 60; return h > 0 ? `${h}h ${min}m` : `${min}m`; };
const hosColor = (m: number) => m <= 0 ? "#ef4444" : m < 120 ? "#f59e0b" : "#10b981";
const fuelColor = (f: number | null | undefined) => f == null ? "#374151" : f < 20 ? "#ef4444" : f < 40 ? "#f59e0b" : "#10b981";

const NAV: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "dashboard",  label: "Dashboard",    Icon: LayoutDashboard },
  { id: "loads",      label: "Load Board",   Icon: Package },
  { id: "trucks",     label: "Trucks",       Icon: Truck },
  { id: "drivers",    label: "Drivers",      Icon: Users },
  { id: "planner",    label: "Trip Planner", Icon: Navigation },
  { id: "reports",    label: "Reports",      Icon: BarChart3 },
  { id: "compliance", label: "Compliance",   Icon: Shield },
];

// ── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg: "#080808",
  sidebar: "#0f0f0f",
  card: "rgba(255,255,255,0.03)",
  border: "rgba(255,255,255,0.07)",
  text: "#ffffff",
  text2: "#6b7280",
  text3: "#374151",
  accent: "#3b82f6",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
} as const;

// ── Shared primitives ────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    on_route:  { label: "On Route",  color: "#10b981" },
    resting:   { label: "Resting",   color: "#6b7280" },
    loading:   { label: "Loading",   color: "#3b82f6" },
    available: { label: "Available", color: "#a78bfa" },
  };
  const s = map[status] || { label: status, color: "#6b7280" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 500, color: s.color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0, display: "inline-block" }} />
      {s.label}
    </span>
  );
}

function LoadChip({ status }: { status: LoadStatus }) {
  const map: Record<LoadStatus, { label: string; color: string; bg: string }> = {
    PENDING:    { label: "Pending",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
    ASSIGNED:   { label: "Assigned",   color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
    IN_TRANSIT: { label: "In Transit", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
    DELIVERED:  { label: "Delivered",  color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
    CANCELLED:  { label: "Cancelled",  color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99, color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

function HOSBar({ mins, width = 80 }: { mins: number; width?: number }) {
  const pct = Math.min(100, Math.max(0, (mins / 660) * 100));
  const col = hosColor(mins);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: col }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color: col, fontVariantNumeric: "tabular-nums" }}>{fmtMins(mins)}</span>
    </div>
  );
}

function FuelBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ fontSize: 11, color: T.text3 }}>—</span>;
  const col = fuelColor(pct);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: col }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color: col, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
    </div>
  );
}

function SectionHeader({ title, liveData, onRefresh, clock }: { title: string; liveData: boolean; onRefresh: () => void; clock: Date | null }) {
  return (
    <header style={{
      height: 48, display: "flex", alignItems: "center", gap: 12, padding: "0 24px",
      borderBottom: `1px solid ${T.border}`, background: T.bg, flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{title}</span>
      <span style={{
        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, letterSpacing: "0.05em",
        background: liveData ? "rgba(16,185,129,0.12)" : "rgba(107,114,128,0.1)",
        color: liveData ? T.success : T.text3,
        display: "flex", alignItems: "center", gap: 4,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: liveData ? T.success : T.text3 }} />
        {liveData ? "LIVE" : "DEMO"}
      </span>
      {clock && (
        <span style={{ fontSize: 11, color: T.text3, fontVariantNumeric: "tabular-nums" }}>
          {clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
      <button onClick={onRefresh} title="Refresh" style={{ padding: 6, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", color: T.text3, display: "flex" }}>
        <RefreshCw size={14} />
      </button>
    </header>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, ...style }}>
      {children}
    </div>
  );
}

function CardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 20px", borderBottom: `1px solid rgba(255,255,255,0.05)`, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function TruckyTMS() {
  const [section, setSection] = useState<Section>("dashboard");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loads, setLoads]     = useState<Load[]>([]);
  const [trucks, setTrucks]   = useState<TruckData[]>([]);
  const [refills, setRefills] = useState<RefillEvent[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [stats, setStats] = useState<FleetStats>({ total: 0, on_route: 0, resting: 0, available: 0, violations: 0, low_hos: 0, low_fuel: 0, idling: 0 });
  const [liveData, setLiveData] = useState(false);
  const [clock, setClock] = useState<Date | null>(null);

  useEffect(() => {
    setClock(new Date());
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [dRes, iRes, lRes, vRes] = await Promise.all([
        fetch(`${API}/api/drivers`),
        fetch(`${API}/api/fleet/insights`),
        fetch(`${API}/api/loads`),
        fetch(`${API}/api/fleet/vehicles`),
      ]);
      const dData: Driver[] = await dRes.json();
      const iData = await iRes.json();
      const lData = await lRes.json();
      const vData = await vRes.json();
      setDrivers(dData);
      setLiveData(dData.some(d => d.source === "samsara_live"));
      setInsights(iData.insights || []);
      setStats(iData.stats || {});
      if (Array.isArray(lData)) setLoads(lData);
      setTrucks(vData.trucks || []);
      setRefills(vData.refills || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 8000);  // Poll every 8s so voice-created loads appear fast
    return () => clearInterval(t);
  }, [fetchAll]);

  const pendingCount = loads.filter(l => l.status === "PENDING").length;
  const currentNav = NAV.find(n => n.id === section);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: T.bg }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 200, flexShrink: 0, display: "flex", flexDirection: "column",
        background: T.sidebar, borderRight: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* Logo */}
        <div style={{
          height: 48, display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
        }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: T.accent,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <Truck size={14} color="#fff" />
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: T.text, letterSpacing: "-0.02em" }}>Trucky</span>
          </a>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ id, label, Icon }) => {
            const isActive = section === id;
            const badge = id === "loads" && pendingCount > 0 ? pendingCount
              : id === "compliance" && stats.violations > 0 ? stats.violations
              : null;
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                  borderRadius: 8, background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                  borderLeftWidth: 2, borderLeftStyle: "solid",
                  borderLeftColor: isActive ? T.accent : "transparent",
                  borderTop: "none", borderRight: "none", borderBottom: "none",
                  color: isActive ? T.text : T.text2, fontSize: 12, fontWeight: 500,
                  cursor: "pointer",
                  width: "100%", textAlign: "left",
                }}
              >
                <Icon size={14} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
                {badge !== null && (
                  <span style={{
                    width: 16, height: 16, borderRadius: "50%", fontSize: 10, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: id === "compliance" ? T.danger : T.warning, color: "#000",
                  }}>{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: liveData ? T.success : T.warning, flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, color: T.text2 }}>{stats.total} drivers · ELD {liveData ? "Live" : "Demo"}</span>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <SectionHeader
          title={currentNav?.label || ""}
          liveData={liveData}
          onRefresh={fetchAll}
          clock={clock}
        />
        <main style={{ flex: 1, overflowY: "auto" }}>
          {section === "dashboard"  && <DashboardSection drivers={drivers} stats={stats} insights={insights} loads={loads} onSection={setSection} />}
          {section === "loads"      && <LoadsSection loads={loads} drivers={drivers} setLoads={setLoads} />}
          {section === "trucks"     && <TrucksSection trucks={trucks} refills={refills} onRefresh={fetchAll} />}
          {section === "drivers"    && <DriversSection drivers={drivers} stats={stats} />}
          {section === "planner"    && <PlannerSection drivers={drivers} setLoads={setLoads} />}
          {section === "reports"    && <ReportsSection drivers={drivers} trucks={trucks} refills={refills} loads={loads} stats={stats} />}
          {section === "compliance" && <ComplianceSection drivers={drivers} stats={stats} />}
        </main>
      </div>

      {/* ── AI Panel ── */}
      <AIPanel stats={stats} onRefresh={fetchAll} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function DashboardSection({ drivers, stats, insights, loads, onSection }: {
  drivers: Driver[]; stats: FleetStats; insights: Insight[]; loads: Load[]; onSection: (s: Section) => void;
}) {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* KPI pills row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {[
          { label: "On Route",   value: stats.on_route,   color: T.accent },
          { label: "Available",  value: stats.available,  color: T.success },
          { label: "Violations", value: stats.violations, color: T.danger },
          { label: "Low Fuel",   value: stats.low_fuel,   color: T.warning },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
            borderRadius: 99, background: T.card, border: `1px solid ${T.border}`,
          }}>
            <span style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: 11, color: T.text2, whiteSpace: "nowrap" }}>{label}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "Total",   value: stats.total,   color: T.text },
            { label: "Resting", value: stats.resting, color: T.text2 },
            { label: "Idling",  value: stats.idling,  color: T.text3 },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ fontSize: 11, color: T.text3 }}>
              <span style={{ color, fontWeight: 600 }}>{value}</span> {label}
            </div>
          ))}
        </div>
      </div>

      {/* Main grid: activity + insights */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>

        {/* Activity list */}
        <Card>
          <CardHeader>
            <span style={{ fontSize: 11, fontWeight: 600, color: T.text2, textTransform: "uppercase", letterSpacing: "0.07em", flex: 1 }}>Fleet Activity</span>
            <button onClick={() => onSection("drivers")} style={{ fontSize: 11, color: T.accent, cursor: "pointer", background: "none", border: "none", display: "flex", alignItems: "center", gap: 3 }}>
              All Drivers <ChevronRight size={12} />
            </button>
          </CardHeader>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 90px 110px 120px 80px",
            padding: "8px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            {["Driver", "Status", "Location", "HOS Remaining", "Speed"].map((h, i) => (
              <span key={h} style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: i === 4 ? "right" : "left" }}>{h}</span>
            ))}
          </div>
          {drivers.slice(0, 12).map((d, index) => (
            <div
              key={d.id || `driver-${index}`}
              style={{
                display: "grid", gridTemplateColumns: "1fr 90px 110px 120px 80px",
                padding: "10px 20px", borderBottom: "1px solid rgba(255,255,255,0.03)",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text, lineHeight: 1.3 }}>{d.name}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 1 }}>{d.truck.replace("FREIGHTLINER ", "")}</div>
              </div>
              <div><StatusDot status={d.status} /></div>
              <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>
                {d.current_location.address.split(",")[0]}
              </div>
              <div><HOSBar mins={d.hos.drive_time_remaining_mins} /></div>
              <div style={{ fontSize: 11, color: d.current_location.speed_mph > 0 ? T.text : T.text3, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {d.current_location.speed_mph > 0 ? `${d.current_location.speed_mph} mph` : "—"}
              </div>
            </div>
          ))}
        </Card>

        {/* Right column: insights + recent loads */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <CardHeader>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.text2, textTransform: "uppercase", letterSpacing: "0.07em" }}>Fleet Intelligence</span>
            </CardHeader>
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {insights.length === 0 ? (
                <div style={{ padding: "24px 20px", textAlign: "center", fontSize: 12, color: T.text3 }}>No insights yet</div>
              ) : insights.map((ins, i) => {
                const col = ({ critical: T.danger, warning: T.warning, info: T.accent, success: T.success } as Record<string, string>)[ins.type] || T.text2;
                const bg = ({ critical: "rgba(239,68,68,0.06)", warning: "rgba(245,158,11,0.06)", info: "rgba(59,130,246,0.06)", success: "rgba(16,185,129,0.06)" } as Record<string, string>)[ins.type] || "transparent";
                return (
                  <div key={i} style={{ padding: "10px 16px 10px 14px", borderLeft: `2px solid ${col}`, background: bg, borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: col, marginBottom: 2 }}>{ins.title}</div>
                    <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.5 }}>{ins.body}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {loads.length > 0 && (
            <Card>
              <CardHeader>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.text2, textTransform: "uppercase", letterSpacing: "0.07em", flex: 1 }}>Recent Loads</span>
                <button onClick={() => onSection("loads")} style={{ fontSize: 11, color: T.accent, cursor: "pointer", background: "none", border: "none" }}>View all</button>
              </CardHeader>
              {loads.slice(0, 5).map(l => (
                <div key={l.id} style={{ padding: "9px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: T.accent }}>{l.id}</div>
                    <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.destination || "—"}</div>
                  </div>
                  <LoadChip status={l.status} />
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOADS
// ═══════════════════════════════════════════════════════════════════════════════
const BLANK: Partial<Load> = { status: "PENDING", origin: "", destination: "", pickup_date: "", pickup_time: "08:00", pickup_contact: "", pickup_phone: "", delivery_date: "", delivery_time: "17:00", delivery_contact: "", delivery_phone: "", commodity: "General Freight", weight_lbs: 0, distance_miles: 0, rate: 0, fuel_surcharge: 0, driver_id: "", driver_name: "Unassigned", truck: "", broker_name: "", broker_mc: "", special_instructions: "", po_number: "", reference_number: "" };

const INP_STYLE: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#fff", width: "100%", outline: "none" };

function LoadsSection({ loads, drivers, setLoads }: { loads: Load[]; drivers: Driver[]; setLoads: (l: Load[]) => void }) {
  const [filter, setFilter] = useState<LoadStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editLoad, setEditLoad] = useState<Partial<Load>>(BLANK);
  const [saving, setSaving] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = loads.filter(l => {
    if (filter !== "ALL" && l.status !== filter) return false;
    if (search) { const q = search.toLowerCase(); return l.id?.toLowerCase().includes(q) || l.origin?.toLowerCase().includes(q) || l.destination?.toLowerCase().includes(q) || (l.driver_name || "").toLowerCase().includes(q); }
    return true;
  });

  async function calcDist() {
    if (!editLoad.destination) return;
    setCalcLoading(true);
    try {
      const r = await fetch(`${API}/api/distance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: editLoad.origin, destination: editLoad.destination }) });
      const d = await r.json();
      if (d.distance_miles) setEditLoad(p => ({ ...p, distance_miles: d.distance_miles }));
    } finally { setCalcLoading(false); }
  }

  async function save() {
    setSaving(true);
    try {
      const isEdit = !!(editLoad as Load).created_at;
      const r = await fetch(isEdit ? `${API}/api/loads/${(editLoad as Load).id}` : `${API}/api/loads`, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editLoad) });
      const result = await r.json();
      setLoads(isEdit ? loads.map(l => l.id === result.id ? result : l) : [...loads, result]);
      setShowModal(false); setEditLoad(BLANK);
    } finally { setSaving(false); }
  }

  async function del(id: string) {
    if (!confirm("Delete this load?")) return;
    await fetch(`${API}/api/loads/${id}`, { method: "DELETE" });
    setLoads(loads.filter(l => l.id !== id));
  }

  async function updateStatus(id: string, status: LoadStatus) {
    const r = await fetch(`${API}/api/loads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const u = await r.json();
    setLoads(loads.map(l => l.id === u.id ? u : l));
  }

  const avail = drivers.filter(d => d.hos.drive_time_remaining_mins >= 180 && d.status !== "on_route");
  const filterTabs: (LoadStatus | "ALL")[] = ["ALL", "PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.text3 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search loads…"
            style={{ ...INP_STYLE, width: 200, paddingLeft: 30 }}
          />
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.02)", border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 10, padding: 4 }}>
          {filterTabs.map(f => {
            const count = f === "ALL" ? loads.length : loads.filter(l => l.status === f).length;
            const label = f === "IN_TRANSIT" ? "Transit" : f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase();
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "none",
                background: filter === f ? T.accent : "transparent", color: filter === f ? "#fff" : T.text2,
              }}>
                {label} <span style={{ opacity: 0.6 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => { setEditLoad(BLANK); setShowModal(true); }}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}
        >
          <Plus size={13} /> New Load
        </button>
      </div>

      {/* Table */}
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
              {["Load #", "Route", "Pickup", "Driver", "Commodity", "Rate", "Status", ""].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: "48px 20px", textAlign: "center", fontSize: 13, color: T.text3 }}>
                No loads. Click <strong style={{ color: T.text }}>New Load</strong> to create one.
              </td></tr>
            )}
            {filtered.map(l => (
              <React.Fragment key={l.id}>
                <tr
                  onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}
                >
                  <td style={{ padding: "11px 16px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: T.accent }}>{l.id}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{l.origin || "—"}</div>
                    <div style={{ fontSize: 11, color: T.text2 }}>→ {l.destination || "—"}</div>
                    {l.distance_miles > 0 && <div style={{ fontSize: 10, color: T.text3 }}>{l.distance_miles} mi</div>}
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: T.text2 }}>{l.pickup_date || "—"}</td>
                  <td style={{ padding: "11px 16px", fontSize: 12, color: l.driver_name ? T.text : T.text3 }}>{l.driver_name || "Unassigned"}</td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: T.text2, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.commodity}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.success }}>${(l.rate + l.fuel_surcharge).toLocaleString()}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>+${l.fuel_surcharge} FSC</div>
                  </td>
                  <td style={{ padding: "11px 16px" }} onClick={e => e.stopPropagation()}>
                    <select
                      value={l.status}
                      onChange={e => updateStatus(l.id, e.target.value as LoadStatus)}
                      style={{ background: "transparent", border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", outline: "none", color: ({ PENDING: T.warning, ASSIGNED: T.accent, IN_TRANSIT: T.success, DELIVERED: T.text2, CANCELLED: T.danger } as Record<string, string>)[l.status] }}
                    >
                      {["PENDING","ASSIGNED","IN_TRANSIT","DELIVERED","CANCELLED"].map(s => <option key={s} value={s} style={{ background: "#1a1a1a" }}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "11px 16px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => { setEditLoad(l); setShowModal(true); }} style={{ padding: 6, borderRadius: 6, background: "none", border: "none", cursor: "pointer", color: T.text3 }}><Edit3 size={13} /></button>
                      <button onClick={() => del(l.id)} style={{ padding: 6, borderRadius: 6, background: "none", border: "none", cursor: "pointer", color: T.text3 }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
                {expanded === l.id && (
                  <tr key={`${l.id}-exp`}>
                    <td colSpan={8} style={{ background: "rgba(255,255,255,0.015)", padding: "16px 20px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, fontSize: 11 }}>
                        {[
                          { label: "Pickup Contact", lines: [l.pickup_contact || "—", l.pickup_phone || "—", l.pickup_time] },
                          { label: "Delivery Contact", lines: [l.delivery_contact || "—", l.delivery_phone || "—", l.delivery_time] },
                          { label: "Broker", lines: [l.broker_name || "—", `MC# ${l.broker_mc || "—"}`] },
                          { label: "References", lines: [`PO: ${l.po_number || "—"}`, `Ref: ${l.reference_number || "—"}`, l.special_instructions || ""] },
                        ].map(({ label, lines }) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                            {lines.map((line, i) => line ? <div key={i} style={{ color: i === 0 ? T.text : T.text2, marginBottom: 2 }}>{line}</div> : null)}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
          <div style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.8)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: T.text, margin: 0 }}>{(editLoad as Load).id ? "Edit Load" : "New Rate Confirmation"}</h2>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: T.text2, padding: 4, borderRadius: 6, display: "flex" }}><X size={16} /></button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Route */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Route</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Origin</label>
                    <input value={editLoad.origin || ""} onChange={e => setEditLoad(p => ({...p, origin: e.target.value}))} placeholder="City, State" style={INP_STYLE} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Destination *</label>
                    <input value={editLoad.destination || ""} onChange={e => setEditLoad(p => ({...p, destination: e.target.value}))} placeholder="City, State" style={INP_STYLE} />
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <button onClick={calcDist} disabled={calcLoading || !editLoad.destination} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: T.text2, cursor: "pointer", opacity: (!editLoad.destination || calcLoading) ? 0.4 : 1 }}>
                    {calcLoading ? <Loader2 size={12} /> : <Navigation size={12} />} Auto-Calculate Miles
                  </button>
                  {(editLoad.distance_miles ?? 0) > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: T.success }}>{editLoad.distance_miles} miles</span>}
                </div>
              </div>
              {/* Pickup + Delivery */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {[
                  { label: "Pickup", dateKey: "pickup_date", timeKey: "pickup_time", contactKey: "pickup_contact", phoneKey: "pickup_phone" },
                  { label: "Delivery", dateKey: "delivery_date", timeKey: "delivery_time", contactKey: "delivery_contact", phoneKey: "delivery_phone" },
                ].map(({ label, dateKey, timeKey, contactKey, phoneKey }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Date</label>
                          <input type="date" value={(editLoad as Record<string, unknown>)[dateKey] as string || ""} onChange={e => setEditLoad(p => ({...p, [dateKey]: e.target.value}))} style={INP_STYLE} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Time</label>
                          <input type="time" value={(editLoad as Record<string, unknown>)[timeKey] as string || ""} onChange={e => setEditLoad(p => ({...p, [timeKey]: e.target.value}))} style={INP_STYLE} />
                        </div>
                      </div>
                      <input value={(editLoad as Record<string, unknown>)[contactKey] as string || ""} onChange={e => setEditLoad(p => ({...p, [contactKey]: e.target.value}))} placeholder="Contact name" style={INP_STYLE} />
                      <input value={(editLoad as Record<string, unknown>)[phoneKey] as string || ""} onChange={e => setEditLoad(p => ({...p, [phoneKey]: e.target.value}))} placeholder="Phone" style={INP_STYLE} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Freight details */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Freight Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Commodity</label>
                    <input value={editLoad.commodity || ""} onChange={e => setEditLoad(p => ({...p, commodity: e.target.value}))} style={INP_STYLE} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Weight (lbs)</label>
                    <input type="number" value={editLoad.weight_lbs || ""} onChange={e => setEditLoad(p => ({...p, weight_lbs: +e.target.value}))} style={INP_STYLE} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>PO #</label>
                    <input value={editLoad.po_number || ""} onChange={e => setEditLoad(p => ({...p, po_number: e.target.value}))} style={INP_STYLE} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Reference #</label>
                    <input value={editLoad.reference_number || ""} onChange={e => setEditLoad(p => ({...p, reference_number: e.target.value}))} style={INP_STYLE} />
                  </div>
                </div>
              </div>
              {/* Rate */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Rate</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Linehaul ($)</label>
                    <input type="number" value={editLoad.rate || ""} onChange={e => setEditLoad(p => ({...p, rate: +e.target.value}))} style={INP_STYLE} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Fuel Surcharge ($)</label>
                    <input type="number" value={editLoad.fuel_surcharge || ""} onChange={e => setEditLoad(p => ({...p, fuel_surcharge: +e.target.value}))} style={INP_STYLE} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Total</label>
                    <div style={{ padding: "7px 12px", borderRadius: 8, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", fontSize: 14, fontWeight: 700, color: T.success }}>
                      ${((editLoad.rate || 0) + (editLoad.fuel_surcharge || 0)).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
              {/* Broker + Driver */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Broker / Shipper</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input value={editLoad.broker_name || ""} onChange={e => setEditLoad(p => ({...p, broker_name: e.target.value}))} placeholder="Broker / Shipper name" style={INP_STYLE} />
                    <input value={editLoad.broker_mc || ""} onChange={e => setEditLoad(p => ({...p, broker_mc: e.target.value}))} placeholder="MC # or DOT #" style={INP_STYLE} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Assign Driver</div>
                  <select
                    value={editLoad.driver_id || ""}
                    onChange={e => { const drv = avail.find(d => d.id === e.target.value); setEditLoad(p => ({...p, driver_id: e.target.value, driver_name: drv?.name || "Unassigned", truck: drv?.truck || ""})); }}
                    style={{ ...INP_STYLE, cursor: "pointer" }}
                  >
                    <option value="">Unassigned</option>
                    {avail.map(d => <option key={d.id} value={d.id}>{d.name} — {fmtMins(d.hos.drive_time_remaining_mins)} HOS</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Special Instructions</label>
                <textarea value={editLoad.special_instructions || ""} onChange={e => setEditLoad(p => ({...p, special_instructions: e.target.value}))} rows={2} style={{ ...INP_STYLE, resize: "none" }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "8px 16px", fontSize: 13, color: T.text2, background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving || !editLoad.destination} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", opacity: (saving || !editLoad.destination) ? 0.5 : 1 }}>
                {saving && <Loader2 size={13} />}
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
// TRUCKS
// ═══════════════════════════════════════════════════════════════════════════════
function TrucksSection({ trucks, refills, onRefresh }: { trucks: TruckData[]; refills: RefillEvent[]; onRefresh: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = trucks.filter(t => {
    if (filter === "active" && t.engine_state !== "On") return false;
    if (filter === "low_fuel" && (t.fuel_percent ?? 100) >= 25) return false;
    if (filter === "maintenance" && !t.maintenance.oil_change_due && !t.maintenance.tire_rotation_due && !t.maintenance.inspection_due) return false;
    if (search) { const q = search.toLowerCase(); return t.truck_name.toLowerCase().includes(q) || t.driver_name.toLowerCase().includes(q); }
    return true;
  });

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.text3 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search trucks…" style={{ ...INP_STYLE, width: 200, paddingLeft: 30 }} />
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 4 }}>
          {[["all","All"],["active","Engine On"],["low_fuel","Low Fuel"],["maintenance","Maint. Due"]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "none", background: filter === id ? T.accent : "transparent", color: filter === id ? "#fff" : T.text2 }}>{label}</button>
          ))}
        </div>
        <button onClick={onRefresh} style={{ marginLeft: "auto", padding: 8, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", color: T.text3, display: "flex" }}>
          <RefreshCw size={14} />
        </button>
        <span style={{ fontSize: 11, color: T.text3 }}>{filtered.length}/{trucks.length}</span>
      </div>

      {/* Cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {filtered.map((t, i) => {
          const needsMaint = t.maintenance.oil_change_due || t.maintenance.tire_rotation_due || t.maintenance.inspection_due;
          return (
            <div key={`${t.truck_name}-${i}`} style={{
              background: T.card, borderRadius: 12, overflow: "hidden",
              border: `1px solid ${needsMaint ? "rgba(245,158,11,0.25)" : T.border}`,
            }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{t.truck_name}</div>
                  <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{t.driver_name}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {needsMaint && (
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, color: T.warning, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Wrench size={10} /> Maint
                    </span>
                  )}
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, display: "flex", alignItems: "center", gap: 3, color: t.engine_state === "On" ? T.success : T.text3, background: t.engine_state === "On" ? "rgba(16,185,129,0.1)" : "rgba(55,65,81,0.2)" }}>
                    <Power size={10} /> {t.engine_state}
                  </span>
                </div>
              </div>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.location}</div>
                {t.speed_mph > 0 && <div style={{ fontSize: 11, fontWeight: 500, color: T.accent }}>{t.speed_mph} mph</div>}
                {t.fuel_percent != null && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                      <span style={{ color: T.text3 }}>Fuel</span>
                      <span style={{ color: fuelColor(t.fuel_percent), fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{t.fuel_percent}% · ~{t.fuel_gallons?.toFixed(0)} gal</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.05)" }}>
                      <div style={{ width: `${t.fuel_percent}%`, height: "100%", borderRadius: 99, background: fuelColor(t.fuel_percent) }} />
                    </div>
                  </div>
                )}
                {t.odometer_miles != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: T.text3 }}>{t.odometer_miles.toLocaleString()} mi</span>
                    <span style={{ color: T.warning }}>{t.maintenance.oil_change_due ? "Oil due" : t.maintenance.tire_rotation_due ? "Tires due" : ""}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <Clock size={11} color={T.text3} />
                  <span style={{ fontWeight: 500, color: hosColor(t.hos_drive_rem) }}>{fmtMins(t.hos_drive_rem)} drive</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fuel refills */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Droplets size={15} color={T.accent} />
          <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Fuel Refill Events</span>
          <span style={{ fontSize: 11, color: T.text3 }}>past 7 days</span>
        </div>
        <Card>
          {refills.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <Droplets size={24} color={T.text3} style={{ margin: "0 auto 12px" }} />
              <p style={{ fontSize: 13, color: T.text3, margin: 0 }}>No fuel refill events detected in the past 7 days.</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Truck", "When", "Location", "Gallons", "Est. Cost", "Fuel Level"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refills.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 500, color: T.text }}>{r.truck}</td>
                    <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(r.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                      {new Date(r.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </td>
                    <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.location}</td>
                    <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: T.accent, fontVariantNumeric: "tabular-nums" }}>+{r.gallons_added} gal</td>
                    <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: T.success, fontVariantNumeric: "tabular-nums" }}>${r.est_cost.toFixed(2)}</td>
                    <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{r.prev_pct}% → {r.new_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVERS
// ═══════════════════════════════════════════════════════════════════════════════
function DriversSection({ drivers, stats }: { drivers: Driver[]; stats: FleetStats }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"drive" | "name">("drive");

  const filtered = [...drivers]
    .filter(d => {
      if (filter === "violations" && !d.hos.violation) return false;
      if (filter === "low_hos" && (d.hos.drive_time_remaining_mins >= 120 || d.hos.violation)) return false;
      if (filter === "on_route" && d.status !== "on_route") return false;
      if (search) { const q = search.toLowerCase(); return d.name.toLowerCase().includes(q) || d.truck.toLowerCase().includes(q); }
      return true;
    })
    .sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : a.hos.drive_time_remaining_mins - b.hos.drive_time_remaining_mins);

  const compRate = drivers.length > 0 ? Math.round((drivers.length - stats.violations) / drivers.length * 100) : 100;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI pills */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "Compliant",       value: drivers.length - stats.violations, color: T.success },
          { label: "Violations",      value: stats.violations,                  color: T.danger },
          { label: "Low HOS (<2h)",   value: stats.low_hos,                     color: T.warning },
          { label: "Compliance Rate", value: `${compRate}%`,                    color: T.accent },
        ].map(c => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 99, background: T.card, border: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: c.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{c.value}</span>
            <span style={{ fontSize: 11, color: T.text2 }}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.text3 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search drivers…" style={{ ...INP_STYLE, width: 200, paddingLeft: 30 }} />
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 4 }}>
          {[["all","All"],["violations","Violations"],["low_hos","Low HOS"],["on_route","On Route"]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{ padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "none", background: filter === id ? T.accent : "transparent", color: filter === id ? "#fff" : T.text2 }}>{label}</button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as "drive" | "name")} style={{ ...INP_STYLE, width: "auto", marginLeft: "auto", cursor: "pointer" }}>
          <option value="drive">Sort: Drive Remaining</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["Driver", "Status", "Location", "Drive Remaining", "Shift Rem", "Cycle", "Fuel", "HOS Status"].map(h => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, index) => {
              const driveColor = hosColor(d.hos.drive_time_remaining_mins);
              return (
                <tr key={d.id || `driver-${index}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: d.hos.violation ? "rgba(239,68,68,0.04)" : "transparent" }}>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: T.text3 }}>{d.truck.replace("FREIGHTLINER ", "")}</div>
                  </td>
                  <td style={{ padding: "11px 16px" }}><StatusDot status={d.status} /></td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: T.text2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.current_location.address}</td>
                  <td style={{ padding: "11px 16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 80, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
                          <div style={{ width: `${Math.min(100, (d.hos.drive_time_remaining_mins / 660) * 100)}%`, height: "100%", borderRadius: 99, background: driveColor }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 500, color: driveColor, fontVariantNumeric: "tabular-nums" }}>{fmtMins(d.hos.drive_time_remaining_mins)}</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{fmtMins(d.hos.on_duty_remaining_mins)}</td>
                  <td style={{ padding: "11px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{d.hos.cycle_remaining_hours}h</td>
                  <td style={{ padding: "11px 16px" }}><FuelBar pct={d.telemetry?.fuel_percent ?? null} /></td>
                  <td style={{ padding: "11px 16px" }}>
                    {d.hos.violation
                      ? <span style={{ fontSize: 11, fontWeight: 600, color: T.danger, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} /> VIOLATION</span>
                      : d.hos.drive_time_remaining_mins < 120
                      ? <span style={{ fontSize: 11, fontWeight: 500, color: T.warning }}>LOW HOS</span>
                      : <span style={{ fontSize: 11, color: T.success }}>OK</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIP PLANNER
// ═══════════════════════════════════════════════════════════════════════════════
function PlannerSection({ drivers, setLoads }: { drivers: Driver[]; setLoads: (fn: (p: Load[]) => Load[]) => void }) {
  const [dest, setDest]       = useState("");
  const [origin, setOrigin]   = useState("");
  const [dist, setDist]       = useState<number | "">("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [results, setResults] = useState<TripResult[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);

  async function calcDist() {
    if (!dest) return;
    setCalcLoading(true);
    try {
      const r = await fetch(`${API}/api/distance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination: dest }) });
      const d = await r.json();
      if (d.distance_miles) setDist(d.distance_miles);
      else alert(d.error || "Could not calculate distance");
    } finally { setCalcLoading(false); }
  }

  async function plan() {
    if (!dest || !dist) return;
    setLoading(true); setResults([]);
    try {
      const r = await fetch(`${API}/api/trip/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: dest, distance_miles: dist, required_by: deadline || undefined }) });
      const d = await r.json();
      setResults(d.results || []);
    } finally { setLoading(false); }
  }

  async function assignDriver(res: TripResult) {
    const r = await fetch(`${API}/api/loads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: origin || "Fleet", destination: dest, distance_miles: typeof dist === "number" ? dist : 0, driver_id: res.driver_id, driver_name: res.driver_name, truck: res.truck, status: "ASSIGNED", delivery_date: deadline ? deadline.split("T")[0] : "" }) });
    const created = await r.json();
    setLoads(prev => [...prev, created]);
    setAssigned(res.driver_id);
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Navigation size={15} color={T.accent} />
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Trip Planner</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Origin (optional)</label>
                <input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Leave blank — auto fleet centroid" style={INP_STYLE} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Destination *</label>
                <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Chicago, IL" style={INP_STYLE} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Miles</label>
                  <input type="number" value={dist} onChange={e => setDist(+e.target.value || "")} placeholder="Auto →" style={INP_STYLE} />
                </div>
                <div style={{ alignSelf: "flex-end" }}>
                  <button onClick={calcDist} disabled={calcLoading || !dest} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: T.text2, cursor: "pointer", opacity: (!dest || calcLoading) ? 0.4 : 1 }}>
                    {calcLoading ? <Loader2 size={12} /> : <Navigation size={12} />} Calc
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.text2, display: "block", marginBottom: 4 }}>Delivery Deadline</label>
                <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} style={INP_STYLE} />
              </div>
              <button onClick={plan} disabled={loading || !dest || !dist} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", opacity: (loading || !dest || !dist) ? 0.5 : 1 }}>
                {loading ? <><Loader2 size={15} /> Evaluating {drivers.length} drivers…</> : <><TrendingUp size={15} /> Find Best Drivers</>}
              </button>
            </div>
          </Card>
          <Card style={{ padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>FMCSA Rules Applied</div>
            {["11h max drive / 14h shift window", "30-min break after 8h driving", "10h rest if shift exhausted", "70h/8-day cycle limit", "34h restart if cycle exhausted"].map(r => (
              <div key={r} style={{ fontSize: 11, color: T.text2, padding: "2px 0" }}>· {r}</div>
            ))}
          </Card>
        </div>

        {/* Results */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {results.length === 0 && !loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 240, gap: 8, color: T.text3 }}>
              <Navigation size={32} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Enter destination, calculate distance, then find drivers</div>
            </div>
          )}
          {results.map(res => {
            const compCol = res.plan.compliance === "COMPLIANT" ? T.success : res.plan.compliance === "NEEDS_REST" ? T.warning : T.danger;
            return (
              <div key={res.rank} style={{ borderRadius: 12, border: `1px solid ${res.rank === 1 ? "rgba(59,130,246,0.35)" : T.border}`, background: T.card, overflow: "hidden" }}>
                {res.rank === 1 && (
                  <div style={{ padding: "6px 16px", background: "rgba(59,130,246,0.15)", borderBottom: "1px solid rgba(59,130,246,0.2)", fontSize: 11, fontWeight: 600, color: T.accent, display: "flex", alignItems: "center", gap: 6 }}>
                    <TrendingUp size={12} /> Top Recommendation
                  </div>
                )}
                <div style={{ padding: 16, display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.text2, flexShrink: 0 }}>
                    #{res.rank}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{res.driver_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 99, color: compCol, background: `${compCol}20` }}>{res.plan.compliance}</span>
                      {res.meets_deadline === true && <span style={{ fontSize: 11, color: T.success }}>On time</span>}
                      {res.meets_deadline === false && <span style={{ fontSize: 11, color: T.danger }}>Late</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>{res.truck} · {res.location}</div>
                    <div style={{ fontSize: 11, color: T.text2, marginBottom: 8 }}>{res.plan.scenario_label}</div>
                    <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                      <span style={{ color: T.text3 }}>HOS: <span style={{ color: hosColor(res.hos_drive_rem), fontWeight: 500 }}>{fmtMins(res.hos_drive_rem)}</span></span>
                      <span style={{ color: T.text3 }}>Arrives: <span style={{ color: T.text, fontWeight: 600 }}>{res.plan.earliest_display}</span></span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    {assigned === res.driver_id
                      ? <span style={{ fontSize: 11, fontWeight: 500, color: T.success }}>Assigned</span>
                      : <button onClick={() => assignDriver(res)} style={{ padding: "6px 14px", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none" }}>Assign</button>}
                    <button onClick={() => setExpanded(expanded === res.rank ? null : res.rank)} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3, color: T.text3, background: "none", border: "none", cursor: "pointer" }}>
                      Timeline {expanded === res.rank ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>
                {expanded === res.rank && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "12px 16px", background: "rgba(255,255,255,0.015)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, color: T.text2 }}>{res.plan.explanation}</div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {res.plan.timeline.map((t, i) => (
                        <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                          <div style={{ height: 10, borderRadius: 3, margin: "0 1px", background: t.event.includes("Rest") || t.event.includes("Break") ? "#92400e" : t.event === "Arrive" ? "#065f46" : "#1e3a5f" }} />
                          <div style={{ fontSize: 9, marginTop: 3, color: T.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.event.split(" ")[0]}</div>
                        </div>
                      ))}
                    </div>
                    {res.plan.warnings.length > 0 && (
                      <div style={{ fontSize: 11, color: T.warning, display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} /> {res.plan.warnings.join(" · ")}
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
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsSection({ trucks, refills, loads, stats }: { drivers?: Driver[]; trucks: TruckData[]; refills: RefillEvent[]; loads: Load[]; stats: FleetStats }) {
  const totalMiles = loads.reduce((s, l) => s + (l.distance_miles || 0), 0);
  const totalRevenue = loads.reduce((s, l) => s + l.rate + l.fuel_surcharge, 0);
  const deliveredLoads = loads.filter(l => l.status === "DELIVERED").length;
  const avgFuel = trucks.filter(t => t.fuel_percent != null).reduce((s, t, _, a) => s + (t.fuel_percent ?? 0) / a.length, 0);
  const totalGallons = refills.reduce((s, r) => s + r.gallons_added, 0);
  const totalFuelCost = refills.reduce((s, r) => s + r.est_cost, 0);
  const avgMPG = totalMiles > 0 && totalGallons > 0 ? (totalMiles / totalGallons).toFixed(1) : "—";
  const utilizationPct = stats.total > 0 ? Math.round(stats.on_route / stats.total * 100) : 0;
  const maintenance = trucks.filter(t => t.maintenance.oil_change_due || t.maintenance.tire_rotation_due || t.maintenance.inspection_due);

  const kpis = [
    { label: "Total Revenue",     value: `$${totalRevenue.toLocaleString()}`, color: T.success },
    { label: "Miles Dispatched",  value: totalMiles.toLocaleString(),          color: T.accent },
    { label: "Loads Delivered",   value: deliveredLoads,                       color: "#a78bfa" },
    { label: "Fleet Utilization", value: `${utilizationPct}%`,                 color: T.warning },
    { label: "Avg Fuel Level",    value: `${avgFuel.toFixed(0)}%`,             color: T.success },
    { label: "Fuel Purchased",    value: totalGallons > 0 ? `${totalGallons.toFixed(0)} gal` : "—", color: "#22d3ee" },
    { label: "Fuel Cost",         value: totalFuelCost > 0 ? `$${totalFuelCost.toFixed(0)}` : "—",  color: "#f472b6" },
    { label: "Est. Fleet MPG",    value: avgMPG,                               color: "#fb923c" },
  ];

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {kpis.map(({ label, value, color }) => (
          <div key={label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Maintenance */}
        <Card>
          <CardHeader>
            <Wrench size={14} color={T.warning} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>Maintenance Schedule</span>
            {maintenance.length > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, color: T.warning, background: "rgba(245,158,11,0.1)" }}>{maintenance.length} due</span>}
          </CardHeader>
          {maintenance.length === 0
            ? <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: T.text3 }}>All trucks up to date</div>
            : maintenance.map((t, i) => (
              <div key={`${t.truck_name}-${i}`} style={{ padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{t.truck_name}</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>{t.odometer_miles?.toLocaleString()} mi</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                  {t.maintenance.oil_change_due && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, color: T.warning, background: "rgba(245,158,11,0.1)" }}>Oil Change</span>}
                  {t.maintenance.tire_rotation_due && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, color: "#f97316", background: "rgba(249,115,22,0.1)" }}>Tire Rotation</span>}
                  {t.maintenance.inspection_due && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, color: T.danger, background: "rgba(239,68,68,0.1)" }}>Inspection</span>}
                </div>
              </div>
            ))}
        </Card>

        {/* IFTA */}
        <Card>
          <CardHeader>
            <FileText size={14} color={T.accent} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>IFTA Fuel Summary (Est.)</span>
          </CardHeader>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                ["Total Miles", totalMiles.toLocaleString()],
                ["Fuel Consumed", totalGallons > 0 ? `${totalGallons.toFixed(0)} gal` : "Track refills"],
                ["Fleet MPG", avgMPG],
                ["Fuel Tax Est.", totalGallons > 0 ? `$${(totalGallons * 0.445).toFixed(0)}` : "—"],
              ].map(([l, v]) => (
                <div key={l} style={{ borderRadius: 8, padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 11, color: T.text3 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.5 }}>* IFTA estimates based on tracked refills and dispatched miles. Connect Samsara for state-by-state breakdown.</div>
          </div>
        </Card>
      </div>

      {/* Load performance */}
      {loads.length > 0 && (
        <Card>
          <CardHeader>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Load Performance</span>
          </CardHeader>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Load #", "Route", "Driver", "Miles", "Rate", "RPM", "Status"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.text3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loads.map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 16px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: T.accent }}>{l.id}</td>
                  <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.origin} → {l.destination}</td>
                  <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2 }}>{l.driver_name || "—"}</td>
                  <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{l.distance_miles > 0 ? l.distance_miles : "—"}</td>
                  <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: T.success, fontVariantNumeric: "tabular-nums" }}>${(l.rate + l.fuel_surcharge).toLocaleString()}</td>
                  <td style={{ padding: "10px 16px", fontSize: 11, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{l.distance_miles > 0 ? `$${((l.rate + l.fuel_surcharge) / l.distance_miles).toFixed(2)}/mi` : "—"}</td>
                  <td style={{ padding: "10px 16px" }}><LoadChip status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════════
function ComplianceSection({ drivers, stats: _stats }: { drivers: Driver[]; stats: FleetStats }) {
  const [dotNumber, setDotNumber] = useState("");
  const [safer, setSafer] = useState<SaferResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup() {
    if (!dotNumber) return;
    setLoading(true); setSafer(null);
    try {
      const r = await fetch(`${API}/api/safer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dot_number: dotNumber }) });
      setSafer(await r.json());
    } finally { setLoading(false); }
  }

  const violators = drivers.filter(d => d.hos.violation);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* HOS Violations */}
        <Card>
          <CardHeader>
            <AlertTriangle size={14} color={T.danger} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>HOS Violations</span>
            {violators.length > 0 && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, color: T.danger, background: "rgba(239,68,68,0.1)" }}>{violators.length} active</span>}
          </CardHeader>
          {violators.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 13, color: T.success }}>
              No violations — fleet is compliant
            </div>
          ) : violators.map(d => (
            <div key={d.id} style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(239,68,68,0.04)" }}>
              <AlertTriangle size={16} color={T.danger} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{d.name}</div>
                <div style={{ fontSize: 11, color: T.text2 }}>{d.truck} · {d.current_location.address}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.danger }}>STOP NOW</span>
            </div>
          ))}
        </Card>

        {/* SAFER Lookup */}
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Shield size={15} color={T.accent} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>FMCSA SAFER Lookup</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={dotNumber}
              onChange={e => setDotNumber(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lookup()}
              placeholder="Enter USDOT number"
              style={{ ...INP_STYLE, flex: 1 }}
            />
            <button onClick={lookup} disabled={loading || !dotNumber} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", opacity: (loading || !dotNumber) ? 0.5 : 1 }}>
              {loading ? <Loader2 size={14} /> : <Database size={14} />}
              {loading ? "…" : "Lookup"}
            </button>
          </div>
          {safer && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              {safer.error && !safer.legal_name
                ? <div style={{ color: T.danger }}>{safer.error}</div>
                : <>
                  <div style={{ paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{safer.legal_name}</div>
                    {safer.dba_name && safer.dba_name !== "N/A" && <div style={{ color: T.text2, fontSize: 11 }}>DBA: {safer.dba_name}</div>}
                  </div>
                  {([
                    ["USDOT Status", safer.operating_status, safer.operating_status?.toUpperCase().includes("ACTIVE") ? T.success : T.danger],
                    ["MC Number", safer.mc_number, T.accent],
                    ["Address", safer.physical_address, undefined],
                    ["Phone", safer.phone, undefined],
                    ["Safety Rating", safer.safety_rating, undefined],
                    ["Review Date", safer.review_date, undefined],
                    ["MCS-150 Date", safer.mcs_150_date, undefined],
                    ["Power Units", safer.power_units, undefined],
                    ["Drivers", safer.drivers, undefined],
                  ] as [string, string, string | undefined][]).map(([label, val, col]) => val && val !== "N/A" ? (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: T.text3 }}>{label}</span>
                      <span style={{ color: col || "#e2e8f0", textAlign: "right", maxWidth: "60%" }}>{val}</span>
                    </div>
                  ) : null)}
                  <a href={safer.safer_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, color: T.accent, fontSize: 11, marginTop: 4, textDecoration: "none" }}>
                    <ExternalLink size={12} /> Full SAFER report
                  </a>
                </>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI PANEL
// ═══════════════════════════════════════════════════════════════════════════════
interface DriverMessage { id: string; driver_name: string; text: string; new_eta: string; urgency: string; read: boolean; timestamp: string; direction: string; }

function AIPanel({ stats, onRefresh }: { stats: FleetStats; onRefresh?: () => void }) {
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "speaking">("idle");
  const [transcript, setTranscript] = useState<{ speaker: string; text: string }[]>([]);
  const [textInput, setTextInput] = useState("");
  const [driverMessages, setDriverMessages] = useState<DriverMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "messages">("chat");
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextTimeRef = useRef(0);
  const txEnd = useRef<HTMLDivElement>(null);
  const truckyTurnDone = useRef(true); // true = next Trucky msg starts a new bubble

  // Poll messages every 10s
  useEffect(() => {
    const fetchMsgs = () =>
      fetch(`${API}/api/messages`).then(r => r.json()).then((msgs: DriverMessage[]) => {
        if (Array.isArray(msgs)) setDriverMessages(msgs.slice(-30).reverse());
      }).catch(() => {});
    fetchMsgs();
    const t = setInterval(fetchMsgs, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { txEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [transcript]);
  useEffect(() => () => { disconnect(); }, []);

  function disconnect() {
    procRef.current?.disconnect(); srcRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close(); ctxRef.current?.close();
    procRef.current = null; srcRef.current = null; streamRef.current = null; wsRef.current = null; ctxRef.current = null;
    setConnected(false); setActive(false); setVoiceState("idle");
  }

  async function connect() {
    if (connected) { disconnect(); return; }
    const ws = new WebSocket(`${WS}/ws/dispatcher/voice`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setActive(false); setVoiceState("idle"); };
    ws.onmessage = async ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "audio" && msg.data) {
        setVoiceState("speaking");
        const ctx = ctxRef.current || new AudioContext({ sampleRate: 24000 });
        ctxRef.current = ctx;
        const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
        const pcm = new Int16Array(bytes.buffer);
        const float = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768;
        const buf = ctx.createBuffer(1, float.length, 24000);
        buf.copyToChannel(float, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination);
        const now = ctx.currentTime;
        const start = Math.max(now, nextTimeRef.current);
        src.start(start); nextTimeRef.current = start + buf.duration;
        src.onended = () => { if (nextTimeRef.current <= ctx.currentTime + 0.05) setVoiceState(active ? "listening" : "idle"); };
      }
      if (msg.type === "transcript" && msg.text?.trim()) {
        const speaker = (msg.speaker === "user" || msg.speaker === "dispatcher") ? "You" : "Trucky";
        if (speaker === "Trucky") {
          setTranscript(p => {
            const last = p[p.length - 1];
            if (!truckyTurnDone.current && last?.speaker === "Trucky") {
              return [...p.slice(0, -1), { speaker, text: msg.text }];
            }
            truckyTurnDone.current = false; // inside this turn now
            return [...p.slice(-40), { speaker, text: msg.text }];
          });
        } else {
          setTranscript(p => {
            const last = p[p.length - 1];
            if (msg.partial && last?.speaker === "You") {
              return [...p.slice(0, -1), { speaker, text: msg.text }];
            }
            return [...p.slice(-40), { speaker, text: msg.text }];
          });
        }
      }
      if (msg.type === "turn_complete") {
        truckyTurnDone.current = true; // next Trucky message starts a fresh bubble
      }
      if (msg.type === "tool_result") {
        onRefresh?.();
      }
      if (msg.type === "load_update" && msg.load) {
        onRefresh?.();  // immediate refresh
      }
      if (msg.type === "new_message" && msg.message) {
        setDriverMessages(p => p.some(x => x.id === msg.message.id) ? p : [msg.message, ...p.slice(0, 29)]);
      }
      if (msg.type === "messages_snapshot" && Array.isArray(msg.messages)) {
        setDriverMessages(msg.messages.slice().reverse());
      }
    };
  }

  async function toggleMic() {
    if (!connected) return;
    if (active) {
      procRef.current?.disconnect(); srcRef.current?.disconnect();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setActive(false); setVoiceState("idle"); return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    streamRef.current = stream;
    const ctx = ctxRef.current || new AudioContext();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = e => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const tLen = Math.round(raw.length * 16000 / ctx.sampleRate);
      const res = new Int16Array(tLen);
      for (let i = 0; i < tLen; i++) { const idx = Math.min(Math.floor(i * ctx.sampleRate / 16000), raw.length - 1); res[i] = Math.max(-32768, Math.min(32767, raw[idx] * 32768)); }
      wsRef.current.send(JSON.stringify({ type: "audio", data: btoa(String.fromCharCode(...new Uint8Array(res.buffer))) }));
    };
    src.connect(proc); proc.connect(ctx.destination);
    srcRef.current = src; procRef.current = proc; setActive(true); setVoiceState("listening");
  }

  function sendText(text: string) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    setTranscript(p => [...p.slice(-20), { speaker: "You", text }]);
    setTextInput("");
  }

  const chips = [["Fleet status?", "Fleet status?"], ["Violations?", "Who has violations?"], ["Fuel levels?", "Fuel levels?"], ["Best driver?", "Best driver for Chicago?"]];

  const micBg = active ? T.danger : connected ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)";
  const micBorder = active ? T.danger : connected ? T.accent : "rgba(255,255,255,0.1)";
  const micGlow = active ? "0 0 24px rgba(239,68,68,0.45)" : connected ? "0 0 24px rgba(59,130,246,0.3)" : "none";
  const unreadCount = driverMessages.filter(m => !m.read && m.direction === "driver_to_dispatcher").length;
  const urgColor = (u: string) => u === "emergency" ? T.danger : u === "high" ? "#f59e0b" : T.text3;

  return (
    <aside style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", background: "#111", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

      {/* Header */}
      <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? T.accent : "#374151" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Trucky AI</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99, letterSpacing: "0.08em", background: connected ? "rgba(59,130,246,0.15)" : "rgba(55,65,81,0.3)", color: connected ? T.accent : T.text3 }}>
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        <button onClick={connect} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: "pointer", border: "none", background: connected ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.15)", color: connected ? T.text2 : T.accent }}>
          {connected ? <><WifiOff size={12} /> Disconnect</> : <><Wifi size={12} /> Connect</>}
        </button>
      </div>

      {/* Mic area */}
      <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, gap: 12 }}>
        <button onClick={connected ? toggleMic : connect} style={{ width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: micBg, border: `2px solid ${micBorder}`, boxShadow: micGlow, cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
          {active ? <MicOff size={18} color="#fff" /> : <Mic size={18} color={connected ? T.accent : T.text3} />}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: voiceState === "listening" ? T.danger : voiceState === "speaking" ? T.accent : connected ? T.text2 : T.text3 }}>
            {voiceState === "listening" ? "Listening…" : voiceState === "speaking" ? "Speaking…" : connected ? "Tap mic to speak" : "Connect to start"}
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{stats.total} drivers · {stats.on_route} on route</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "8px 12px 0", gap: 4, flexShrink: 0 }}>
        {(["chat", "messages"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: activeTab === tab ? T.accent : "rgba(255,255,255,0.04)", color: activeTab === tab ? "#fff" : T.text3, position: "relative" }}>
            {tab === "chat" ? "Chat" : `Messages${unreadCount ? ` (${unreadCount})` : ""}`}
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {activeTab === "chat" && <>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          {transcript.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: T.text3 }}>
              <Radio size={26} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>Connect and ask anything<br />about your fleet</div>
            </div>
          ) : transcript.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, flexDirection: t.speaker === "You" ? "row-reverse" : "row", alignItems: "flex-end" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, background: t.speaker === "Trucky" ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.1)", color: t.speaker === "Trucky" ? T.accent : T.text }}>
                {t.speaker[0]}
              </div>
              <div style={{ maxWidth: 210, borderRadius: t.speaker === "You" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", padding: "8px 12px", fontSize: 12, lineHeight: 1.5, color: "#e2e8f0", background: t.speaker === "Trucky" ? "rgba(255,255,255,0.06)" : "rgba(59,130,246,0.15)", border: t.speaker === "You" ? "1px solid rgba(59,130,246,0.25)" : "none" }}>
                {t.text}
              </div>
            </div>
          ))}
          <div ref={txEnd} />
        </div>

        {/* Quick chips */}
        <div style={{ padding: "6px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, flexShrink: 0 }}>
          {chips.map(([label, text]) => (
            <button key={label} onClick={() => sendText(text)} style={{ padding: "5px 7px", borderRadius: 7, fontSize: 11, cursor: "pointer", textAlign: "left", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: T.text2 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Text input */}
        <div style={{ padding: "8px 12px 14px", flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => e.key === "Enter" && textInput.trim() && sendText(textInput.trim())} placeholder={connected ? "Type a question…" : "Connect to chat"} disabled={!connected} style={{ ...INP_STYLE, flex: 1, fontSize: 12, opacity: connected ? 1 : 0.4 }} />
            <button onClick={() => textInput.trim() && sendText(textInput.trim())} disabled={!connected || !textInput.trim()} style={{ padding: "7px 12px", borderRadius: 8, background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", opacity: (!connected || !textInput.trim()) ? 0.4 : 1 }}>
              Send
            </button>
          </div>
        </div>
      </>}

      {/* Messages tab */}
      {activeTab === "messages" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {driverMessages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: T.text3 }}>
              <MessageSquare size={26} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>No driver messages yet.<br />Drivers can message you via Trucky.</div>
            </div>
          ) : driverMessages.map(m => {
            const isIncoming = m.direction === "driver_to_dispatcher";
            const isUnread = !m.read && isIncoming;
            return (
            <div key={m.id} style={{ background: isUnread ? "rgba(59,130,246,0.07)" : "rgba(255,255,255,0.03)", border: `1px solid ${isUnread ? T.accent : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: isIncoming ? "rgba(59,130,246,0.15)" : "rgba(34,197,94,0.15)", color: isIncoming ? T.accent : T.success }}>
                    {isIncoming ? "FROM DRIVER" : "SENT TO DRIVER"}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isIncoming ? T.accent : T.success }}>
                    {isIncoming ? m.driver_name : (m as any).to_driver_name || "Driver"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {m.urgency && m.urgency !== "low" && m.urgency !== "medium" && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: `${urgColor(m.urgency)}20`, color: urgColor(m.urgency) }}>{m.urgency.toUpperCase()}</span>
                  )}
                  <span style={{ fontSize: 10, color: T.text3 }}>{new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.5, margin: 0 }}>{m.text}</p>
              {m.new_eta && <p style={{ fontSize: 11, color: "#f59e0b", marginTop: 5, marginBottom: 0, fontWeight: 600 }}>New ETA: {m.new_eta}</p>}
              {isUnread && (
                <button onClick={() => fetch(`${API}/api/messages/${m.id}/read`, { method: "POST" }).then(() => setDriverMessages(p => p.map(x => x.id === m.id ? { ...x, read: true } : x)))}
                  style={{ marginTop: 8, fontSize: 10, color: T.text3, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Mark read
                </button>
              )}
            </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
