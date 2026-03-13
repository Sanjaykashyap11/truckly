"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";

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
  current_location: { address: string };
  destination?: { address: string };
  hos: HOS;
  route?: { highway: string; eta: string; violations: string[]; restricted_roads_avoided?: string[] };
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
  driver_id: string;
  driver_name?: string;
  tool: string;
  result: Record<string, unknown>;
  timestamp: Date;
}

const TOOL_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  check_hos_status: { label: "HOS Check", icon: Clock, color: "text-blue-400" },
  check_route_safety: { label: "Route Safety", icon: Shield, color: "text-yellow-400" },
  find_fuel_stops: { label: "Fuel Stop", icon: Fuel, color: "text-green-400" },
  handle_breakdown: { label: "Breakdown Protocol", icon: Wrench, color: "text-red-400" },
  notify_stakeholders: { label: "Stakeholders Notified", icon: Radio, color: "text-purple-400" },
};

const STATUS_DOT: Record<string, string> = {
  on_route: "bg-green-400",
  at_shipper: "bg-yellow-400",
  resting: "bg-gray-500",
  off_duty: "bg-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  on_route: "On Route",
  at_shipper: "At Shipper",
  resting: "Resting",
  off_duty: "Off Duty",
};

function HOSBar({ mins }: { mins: number }) {
  const max = 660; // 11 hours
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

export default function DispatcherDashboard() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`${WS_URL}/ws/dispatcher`);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 3000); // auto-reconnect
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "init":
            setDrivers(msg.drivers);
            setAlerts(msg.alerts);
            break;
          case "new_alert":
            setAlerts(prev => [msg.alert, ...prev]);
            break;
          case "tool_activity": {
            setActivities(prev => [...prev.slice(-19), {
              id: Date.now().toString(),
              driver_id: msg.driver_id,
              driver_name: msg.driver_id,
              tool: msg.tool,
              result: msg.result,
              timestamp: new Date(),
            }]);
            break;
          }
        }
      };
    };

    // Fallback: REST polling if WS not available
    const fetchRest = async () => {
      try {
        const [dr, al] = await Promise.all([
          fetch(`${API_URL}/api/drivers`).then(r => r.json()),
          fetch(`${API_URL}/api/alerts`).then(r => r.json()),
        ]);
        setDrivers(dr);
        setAlerts(al);
      } catch {}
    };

    connect();
    fetchRest();
    const interval = setInterval(fetchRest, 30000);
    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
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
              <h1 className="text-base font-bold text-foreground">Truckly</h1>
              <p className="text-xs text-muted-foreground leading-none">Dispatcher Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-xs ${wsConnected ? "text-green-400" : "text-gray-500"}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
              {wsConnected ? "Live" : "Connecting..."}
            </div>
            <Link
              href="/driver"
              className="flex items-center gap-1.5 bg-black dark:bg-white text-white dark:text-black px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
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
            { label: "Active Trucks", value: onRoute, sub: `${drivers.length} total`, icon: Truck, accent: "text-green-400" },
            { label: "Unread Alerts", value: unacked, sub: "require attention", icon: Bell, accent: "text-red-400" },
            { label: "HOS Warnings", value: hosWarnings, sub: "< 2 hours left", icon: Clock, accent: "text-yellow-400" },
            { label: "Sally Active", value: onRoute, sub: "drivers covered", icon: Zap, accent: "text-purple-400" },
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
            <h2 className="text-sm font-semibold text-foreground">Fleet Status</h2>
            {drivers.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
                Loading drivers...
              </div>
            ) : (
              drivers.map(driver => (
                <div key={driver.id} className="bg-card border border-border rounded-xl p-4 hover:border-foreground/20 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${STATUS_DOT[driver.status] || "bg-gray-500"}`} />
                        <span className="font-medium text-foreground text-sm">{driver.name}</span>
                        <span className="text-xs text-muted-foreground">{STATUS_LABEL[driver.status]}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">{driver.truck}</p>

                      <HOSBar mins={driver.hos.drive_time_remaining_mins} />

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
                          <span className="text-muted-foreground truncate">{driver.current_location.address}</span>
                        </div>
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
                      Sally
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right column: Alerts + Activity */}
          <div className="space-y-4">
            {/* Live Sally Activity */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" />
                <h2 className="text-sm font-medium text-foreground">Sally Actions</h2>
                <span className="ml-auto text-xs text-muted-foreground">Live</span>
              </div>
              <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
                {activities.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Sally&apos;s tool actions appear here in real-time
                  </p>
                ) : (
                  [...activities].reverse().map(act => {
                    const meta = TOOL_META[act.tool];
                    const Icon = meta?.icon || Activity;
                    return (
                      <div key={act.id} className="flex items-start gap-2 text-xs">
                        <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${meta?.color || "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground font-medium">{act.driver_name}</span>
                          <span className="text-muted-foreground"> — {meta?.label || act.tool}</span>
                          {act.result?.compliance && (
                            <p className={`${String(act.result.compliance).includes("COMPLIANT") && !String(act.result.compliance).includes("NON") ? "text-green-400" : "text-red-400"}`}>
                              {String(act.result.compliance)}
                            </p>
                          )}
                          {act.result?.safe_for_truck === false && (
                            <p className="text-red-400">⚠ Route blocked — rerouted</p>
                          )}
                          {act.result?.notifications_sent && (
                            <p className="text-green-400">✓ All parties notified</p>
                          )}
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
    </div>
  );
}
