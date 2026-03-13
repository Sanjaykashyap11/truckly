"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Truck,
  AlertTriangle,
  CheckCircle,
  Clock,
  Radio,
  Activity,
  Shield,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Driver {
  id: string;
  name: string;
  truck: string;
  status: string;
  current_location: { address: string };
  destination?: { address: string };
  hos: {
    drive_time_remaining_mins: number;
    status: string;
    next_mandatory_break?: string;
    break_location?: string;
  };
  route?: { highway: string; eta: string; violations: string[] };
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

const STATUS_COLORS: Record<string, string> = {
  on_route: "text-green-400",
  at_shipper: "text-yellow-400",
  resting: "text-gray-400",
  off_duty: "text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  on_route: "On Route",
  at_shipper: "At Shipper",
  resting: "Resting",
  off_duty: "Off Duty",
};

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: "border-l-red-500 bg-red-950/30",
  MEDIUM: "border-l-yellow-500 bg-yellow-950/30",
  LOW: "border-l-blue-500 bg-blue-950/20",
};

function formatHOS(mins: number): string {
  if (mins <= 0) return "0h 0min";
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

function hosColor(mins: number): string {
  if (mins <= 0) return "text-red-400";
  if (mins < 60) return "text-red-400";
  if (mins < 180) return "text-yellow-400";
  return "text-green-400";
}

export default function DispatcherDashboard() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [driversRes, alertsRes] = await Promise.all([
        fetch(`${API_URL}/api/drivers`),
        fetch(`${API_URL}/api/alerts`),
      ]);
      if (driversRes.ok) setDrivers(await driversRes.json());
      if (alertsRes.ok) setAlerts(await alertsRes.json());
    } catch {
      // backend may be offline during dev
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch(`${API_URL}/api/alerts/${alertId}/acknowledge`, {
        method: "POST",
      });
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
      );
    } catch {}
  };

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;
  const activeDrivers = drivers.filter((d) => d.status === "on_route").length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black dark:bg-white rounded-lg p-2">
              <Truck className="w-5 h-5 text-white dark:text-black" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Truckly</h1>
              <p className="text-xs text-muted-foreground">Dispatcher Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-6 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="w-4 h-4 text-green-400" />
                <span className="text-foreground font-medium">{activeDrivers}</span> active
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="text-foreground font-medium">{unacknowledgedCount}</span> alerts
              </span>
            </div>
            <Link
              href="/driver"
              className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Radio className="w-4 h-4" />
              Driver View
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Trucks", value: activeDrivers, icon: Truck, color: "text-green-400" },
            { label: "Alerts", value: unacknowledgedCount, icon: AlertTriangle, color: "text-yellow-400" },
            { label: "HOS Compliant", value: `${drivers.filter(d => d.hos.drive_time_remaining_mins > 60).length}/${drivers.length}`, icon: Shield, color: "text-blue-400" },
            { label: "Sally Active", value: activeDrivers, icon: Radio, color: "text-purple-400" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Drivers Table */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-foreground">Active Fleet</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sally is monitoring all drivers in real time
              </p>
            </div>

            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Loading driver data...
              </div>
            ) : drivers.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No drivers found. Make sure the backend is running.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Driver</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">Location</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">HOS Left</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {drivers.map((driver) => (
                      <tr key={driver.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-medium text-foreground">{driver.name}</p>
                          <p className="text-xs text-muted-foreground">{driver.truck}</p>
                        </td>
                        <td className="px-4 py-4 hidden md:table-cell">
                          <p className="text-foreground truncate max-w-[180px]">
                            {driver.current_location.address}
                          </p>
                          {driver.destination && (
                            <p className="text-xs text-muted-foreground">
                              → {driver.destination.address}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`font-mono font-medium ${hosColor(driver.hos.drive_time_remaining_mins)}`}>
                            {formatHOS(driver.hos.drive_time_remaining_mins)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`text-xs font-medium ${STATUS_COLORS[driver.status] || "text-gray-400"}`}>
                            {STATUS_LABELS[driver.status] || driver.status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <Link
                            href={`/driver?id=${driver.id}`}
                            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
                          >
                            Open Sally
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Alerts Feed */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Live Alerts</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Auto-generated by Sally</p>
              </div>
              {unacknowledgedCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {unacknowledgedCount}
                </span>
              )}
            </div>

            <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No alerts
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-4 border-l-4 ${SEVERITY_STYLES[alert.severity]} ${
                      alert.acknowledged ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {alert.driver_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {alert.message}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(alert.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {alert.auto_resolved && (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Auto-resolved
                            </span>
                          )}
                        </div>
                      </div>
                      {!alert.acknowledged && (
                        <button
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 transition-colors"
                        >
                          Ack
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* How Sally Works */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-4">How Sally Works</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Radio, title: "Voice First", desc: "Drivers talk hands-free. Sally handles everything." },
              { icon: Shield, title: "HOS Guard", desc: "Warns 45 min before limits. Zero violations." },
              { icon: Truck, title: "Truck-Safe GPS", desc: "Every parkway ban enforced. Zero bridge strikes." },
              { icon: Clock, title: "Auto Dispatch", desc: "ETAs, delays, breakdowns — all handled automatically." },
            ].map((item) => (
              <div key={item.title} className="text-center p-3">
                <item.icon className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
