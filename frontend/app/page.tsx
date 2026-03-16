"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ACCENT  = "#3b82f6";
const ACCENT2 = "#6366f1";
const BG      = "#050508";
const CARD    = "rgba(255,255,255,0.04)";
const BORDER  = "rgba(255,255,255,0.08)";
const TEXT    = "#f1f5f9";
const TEXT2   = "#94a3b8";
const TEXT3   = "#475569";

const STATS = [
  { value: "49", label: "Live Drivers", sub: "Connected via Samsara ELD" },
  { value: "2.3h", label: "Avg Response", sub: "Down from 4.1h manual" },
  { value: "94%", label: "HOS Compliance", sub: "Zero violations last 30 days" },
  { value: "$18k", label: "Monthly Savings", sub: "Fuel + idle reduction" },
];

const CRISIS_STATS = [
  {
    value: "3,308",
    label: "Distracted Driving Deaths",
    year: "2022",
    source: "NHTSA 2022",
    color: "#ef4444",
    desc: "Truck drivers switching between 5+ apps — GPS, ELD, dispatch, fuel finders — while operating an 80,000 lb vehicle is a crisis hiding in plain sight.",
  },
  {
    value: "80%",
    label: "Bridge Strikes from Consumer GPS",
    year: "of incidents",
    source: "FMCSA / Sen. Schumer",
    color: "#f97316",
    desc: "Most commercial bridge strikes happen because drivers use Google Maps — completely blind to truck height restrictions and parkway bans.",
  },
  {
    value: "~40%",
    label: "Drivers Exceeding HOS Limits",
    year: "surveyed",
    source: "FMCSA Survey 2020",
    color: "#eab308",
    desc: "Almost never defiance — it's the complete lack of intelligent planning tools that factor in real-time conditions, dock delays, and traffic.",
  },
  {
    value: "14%",
    label: "Large Truck Crashes from Fatigue",
    year: "of crashes",
    source: "FMCSA Fatigue Report",
    color: "#a855f7",
    desc: "A direct consequence of unplanned HOS management and no tool to help drivers schedule compliant rest before exhaustion sets in.",
  },
  {
    value: "57%",
    label: "GPS Incidents Result in a Crash",
    year: "28% fatal",
    source: "Northwestern / UMN / UBremen",
    color: "#ec4899",
    desc: "A multi-university study of 158 catastrophic GPS incidents. Commercial trucks are disproportionately affected due to size and route restrictions.",
  },
  {
    value: "$108B",
    label: "Lost to Congestion Annually",
    year: "1.2B hours of delay",
    source: "ATRI 2022",
    color: "#3b82f6",
    desc: "Without real-time rerouting, delays cascade into fatigue, rushed driving, and dangerous decisions at the wheel.",
  },
];

const FEATURES = [
  {
    icon: "🎙️",
    title: "Voice-First Operations",
    desc: "Dispatchers and drivers operate entirely hands-free. Ask Trucky anything — fleet status, HOS, fuel levels, route safety — and get instant spoken + visual responses.",
    demo: "\"Trucky, who can make it to Chicago by 6pm?\"",
  },
  {
    icon: "📋",
    title: "AI Load Board",
    desc: "Create, assign, and track loads by voice. Say \"Assign a load from Boston to New Jersey to Ahmed\" and it appears on the board in real-time.",
    demo: "\"Create a load from Atlanta to Miami, $2,800 rate, assign to Oscar.\"",
  },
  {
    icon: "📡",
    title: "Live Samsara ELD",
    desc: "Real-time telemetry from Samsara — driver locations, HOS clocks, fuel %, engine state, speed — all live, not mocked.",
    demo: "\"Trucky, who has the most fuel right now?\"",
  },
  {
    icon: "💬",
    title: "Driver–Dispatch Messaging",
    desc: "Drivers tell Trucky they're tired, running late, or need help. Messages appear instantly on the dispatcher dashboard with urgency and new ETA.",
    demo: "\"Trucky, tell the dispatcher I'm 2 hours late. New ETA is 9pm.\"",
  },
  {
    icon: "🛡️",
    title: "FMCSA HOS Compliance",
    desc: "Proactive violation warnings. Real OSRM routing calculates exact drive time for any trip. Never guess if a driver can legally make a delivery.",
    demo: "\"Can Ahmed make it to Newark before his 11-hour clock?\"",
  },
  {
    icon: "⛽",
    title: "Fuel Intelligence",
    desc: "7-day refill history from Samsara telemetry. Anomaly detection filters sensor noise. Dispatcher sees every real fill event with gallons and cost.",
    demo: "\"Who's running low on fuel right now?\"",
  },
];

const HOW_IT_WORKS = [
  { step: "01", title: "Connect", desc: "Tap Connect on the dispatcher or driver app. Trucky joins live via Gemini 2.5 Flash Native Audio." },
  { step: "02", title: "Speak", desc: "Ask anything. Trucky has your entire fleet in context — 49 live drivers, HOS clocks, fuel, loads, and route data." },
  { step: "03", title: "Act", desc: "Trucky executes — assigns loads, routes drivers, alerts dispatch, calculates compliance — all in one voice command." },
];

export default function HomePage() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div style={{ background: BG, color: TEXT, fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif", WebkitFontSmoothing: "antialiased", minHeight: "100vh", overflowX: "hidden" }}>

      {/* ── Nav ── */}
      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", background: scrolled ? "rgba(5,5,8,0.92)" : "transparent", backdropFilter: scrolled ? "blur(12px)" : "none", borderBottom: scrolled ? `1px solid ${BORDER}` : "none", transition: "all 0.2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚛</div>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px" }}>Trucky</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "rgba(59,130,246,0.15)", color: ACCENT, letterSpacing: "0.08em" }}>AI</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a href="#impact" style={{ color: TEXT2, fontSize: 13, textDecoration: "none", padding: "6px 12px" }}>The Crisis</a>
          <a href="#features" style={{ color: TEXT2, fontSize: 13, textDecoration: "none", padding: "6px 12px" }}>Features</a>
          <a href="#how" style={{ color: TEXT2, fontSize: 13, textDecoration: "none", padding: "6px 12px" }}>How it works</a>
          <button onClick={() => router.push("/driver")} style={{ padding: "7px 14px", borderRadius: 8, background: CARD, border: `1px solid ${BORDER}`, color: TEXT2, fontSize: 13, cursor: "pointer" }}>
            Driver App
          </button>
          <button onClick={() => router.push("/dispatcher")} style={{ padding: "7px 16px", borderRadius: 8, background: ACCENT, border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Open TMS
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "80px 24px 60px", position: "relative", overflow: "hidden" }}>
        {/* Background glow */}
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%, -50%)", width: 800, height: 500, background: "radial-gradient(ellipse, rgba(59,130,246,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "60%", left: "30%", width: 400, height: 300, background: "radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

        {/* Badge */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 99, border: `1px solid rgba(59,130,246,0.3)`, background: "rgba(59,130,246,0.08)", marginBottom: 28, fontSize: 12, fontWeight: 600, color: ACCENT, letterSpacing: "0.05em" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT, display: "inline-block", animation: "pulse 2s ease-in-out infinite" }} />
          LIVE DEMO — 49 REAL DRIVERS ON SAMSARA ELD
        </div>

        {/* Headline */}
        <h1 style={{ fontSize: "clamp(44px, 7vw, 82px)", fontWeight: 900, letterSpacing: "-2px", lineHeight: 1.05, margin: "0 0 24px", maxWidth: 900 }}>
          The AI-Native<br />
          <span style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT2} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Fleet OS
          </span>
          {" "}for Trucking
        </h1>

        {/* Subhead */}
        <p style={{ fontSize: "clamp(16px, 2.5vw, 22px)", color: TEXT2, maxWidth: 640, lineHeight: 1.6, margin: "0 0 40px" }}>
          Voice-first TMS powered by Gemini 2.5 Flash and live Samsara ELD data.
          Dispatchers manage loads hands-free. Drivers get a co-pilot that never sleeps.
        </p>

        {/* CTA buttons */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginBottom: 60 }}>
          <button
            onClick={() => router.push("/dispatcher")}
            style={{ padding: "14px 32px", borderRadius: 12, background: ACCENT, border: "none", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 0 40px rgba(59,130,246,0.35)", letterSpacing: "-0.2px" }}
          >
            Try Dispatcher TMS →
          </button>
          <button
            onClick={() => router.push("/driver")}
            style={{ padding: "14px 28px", borderRadius: 12, background: CARD, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 16, fontWeight: 600, cursor: "pointer" }}
          >
            Try Driver App
          </button>
        </div>

        {/* Terminal preview */}
        <div style={{ maxWidth: 680, width: "100%", background: "#0d0d0f", border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 40px 80px rgba(0,0,0,0.6)", position: "relative" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {["#ef4444","#f59e0b","#10b981"].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}
            </div>
            <span style={{ fontSize: 11, color: TEXT3, marginLeft: 4 }}>Trucky Dispatcher — Live Session</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "pulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 10, color: "#10b981", fontWeight: 600 }}>LIVE · 49 DRIVERS</span>
            </div>
          </div>
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, fontFamily: "monospace" }}>
            {[
              { side: "you", text: "Who can make it from Boston to Newark before 6pm?" },
              { side: "ai",  text: "Ahmed Hassan can make it — 4h 12m drive, 6h 20m HOS remaining. Truck T-204, currently in Providence. Fuel at 67%. Assign him?" },
              { side: "you", text: "Yes, create the load and assign it to Ahmed." },
              { side: "ai",  text: "✓ Load B7F2 created. Boston → Newark assigned to Ahmed Hassan. Pickup 08:00, delivery by 14:30. Rate: $1,850. Load board updated." },
            ].map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", flexDirection: m.side === "you" ? "row-reverse" : "row" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: m.side === "you" ? "rgba(255,255,255,0.08)" : ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                  {m.side === "you" ? "👤" : "🚛"}
                </div>
                <div style={{ maxWidth: "80%", background: m.side === "you" ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.1)", border: `1px solid ${m.side === "you" ? "rgba(255,255,255,0.07)" : "rgba(59,130,246,0.2)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, lineHeight: 1.6, color: m.side === "you" ? TEXT2 : TEXT, textAlign: "left" }}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section style={{ padding: "60px 32px", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1, background: BORDER }}>
          {STATS.map((s, i) => (
            <div key={i} style={{ background: BG, padding: "32px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 42, fontWeight: 900, color: TEXT, letterSpacing: "-2px", marginBottom: 6 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: TEXT3 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Impact & Compliance ── */}
      <section id="impact" style={{ padding: "100px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "40%", left: "50%", transform: "translate(-50%, -50%)", width: 900, height: 600, background: "radial-gradient(ellipse, rgba(239,68,68,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 72 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>THE CRISIS ON AMERICAN ROADS</p>
            <h2 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, letterSpacing: "-1.5px", margin: "0 0 20px", lineHeight: 1.08 }}>
              500,000 crashes a year.<br />
              <span style={{ color: "#ef4444" }}>Most were preventable.</span>
            </h2>
            <p style={{ fontSize: 17, color: TEXT2, maxWidth: 620, margin: "0 auto", lineHeight: 1.7 }}>
              Large trucks account for <strong style={{ color: TEXT }}>10% of all fatal U.S. crashes</strong> despite being 4% of vehicles on the road.
              The root causes are well-documented. The tools to solve them haven't existed — until now.
            </p>
          </div>

          {/* Crisis stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 64 }}>
            {CRISIS_STATS.map((s, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid rgba(255,255,255,0.07)`, borderRadius: 16, padding: "28px 28px 24px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: s.color, borderRadius: "16px 16px 0 0" }} />
                <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: "-2px", color: s.color, lineHeight: 1, marginBottom: 6 }}>{s.value}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: s.color, opacity: 0.7, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.year}</div>
                <p style={{ fontSize: 13, color: TEXT2, lineHeight: 1.65, margin: "0 0 14px" }}>{s.desc}</p>
                <div style={{ fontSize: 11, color: TEXT3, fontStyle: "italic" }}>Source: {s.source}</div>
              </div>
            ))}
          </div>

          {/* FMCSA compliance banner */}
          <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)", borderRadius: 20, padding: "40px 48px", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: "1 1 320px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>FMCSA ALIGNMENT</p>
              <h3 style={{ fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 900, letterSpacing: "-0.8px", margin: "0 0 12px", lineHeight: 1.15 }}>
                Built around the same goals as federal regulators.
              </h3>
              <p style={{ fontSize: 14, color: TEXT2, lineHeight: 1.75, margin: 0 }}>
                Trucky's mission directly mirrors FMCSA's mandate: reduce commercial motor vehicle fatalities and injuries on U.S. highways. Every feature — HOS enforcement, truck-safe routing, fatigue detection, real-time alerts — closes a gap that federal data proves is killing people.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 240px" }}>
              {[
                { label: "HOS Violations Prevented", detail: "Real-time FMCSA rule enforcement, 11h/14h/70h cycle" },
                { label: "Bridge Strike Elimination", detail: "Truck-restricted road database with auto-rerouting" },
                { label: "Fatigue Early Warning", detail: "Driver messages fatigue → dispatcher alerted instantly" },
                { label: "Hands-Free by Design", detail: "Zero screen interaction required while driving" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: TEXT3 }}>{item.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ padding: "100px 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: ACCENT, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>CAPABILITIES</p>
            <h2 style={{ fontSize: "clamp(32px, 5vw, 52px)", fontWeight: 900, letterSpacing: "-1.5px", margin: 0, lineHeight: 1.1 }}>
              Everything your fleet needs.<br />
              <span style={{ color: TEXT3 }}>All by voice.</span>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 2, background: BORDER }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{ background: BG, padding: "32px 28px", position: "relative", overflow: "hidden" }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.3px" }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: TEXT2, lineHeight: 1.7, margin: "0 0 18px" }}>{f.desc}</p>
                <div style={{ background: "rgba(59,130,246,0.07)", border: `1px solid rgba(59,130,246,0.15)`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: ACCENT, fontFamily: "monospace", fontStyle: "italic" }}>
                  {f.demo}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" style={{ padding: "80px 32px", background: "rgba(255,255,255,0.015)", borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: ACCENT, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>HOW IT WORKS</p>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, letterSpacing: "-1px", margin: "0 0 56px", lineHeight: 1.1 }}>
            Three steps to a smarter fleet
          </h2>
          <div style={{ display: "flex", gap: 0, position: "relative" }}>
            <div style={{ position: "absolute", top: 28, left: "15%", right: "15%", height: 1, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})`, opacity: 0.3 }} />
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "0 20px" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", boxShadow: "0 0 30px rgba(59,130,246,0.3)", position: "relative", zIndex: 1 }}>
                  {step.step}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, letterSpacing: "-0.3px" }}>{step.title}</h3>
                <p style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech stack ── */}
      <section style={{ padding: "60px 32px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: TEXT3, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>BUILT WITH</p>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
            {["Gemini 2.5 Flash Native Audio", "Samsara ELD API", "FastAPI + WebSockets", "Next.js 14", "OSRM Routing", "Nominatim Geocoding", "Real-Time HOS Compliance"].map(t => (
              <span key={t} style={{ padding: "7px 16px", borderRadius: 99, background: CARD, border: `1px solid ${BORDER}`, fontSize: 13, color: TEXT2 }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ padding: "100px 32px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(59,130,246,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <h2 style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 900, letterSpacing: "-2px", margin: "0 0 20px", lineHeight: 1.05 }}>
            Ready to see it live?
          </h2>
          <p style={{ fontSize: 18, color: TEXT2, margin: "0 0 40px", lineHeight: 1.6 }}>
            49 real drivers. Live ELD data. Instant voice commands.<br />No setup required.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/dispatcher")}
              style={{ padding: "16px 40px", borderRadius: 14, background: ACCENT, border: "none", color: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer", boxShadow: "0 0 60px rgba(59,130,246,0.4)", letterSpacing: "-0.3px" }}
            >
              Open Dispatcher TMS →
            </button>
            <button
              onClick={() => router.push("/driver")}
              style={{ padding: "16px 32px", borderRadius: 14, background: CARD, border: `1px solid ${BORDER}`, color: TEXT, fontSize: 18, fontWeight: 600, cursor: "pointer" }}
            >
              Open Driver App
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ padding: "24px 32px", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🚛</div>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Trucky AI</span>
          <span style={{ fontSize: 12, color: TEXT3 }}>— AI-Native Fleet OS</span>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <button onClick={() => router.push("/dispatcher")} style={{ background: "none", border: "none", color: TEXT3, fontSize: 13, cursor: "pointer" }}>Dispatcher TMS</button>
          <button onClick={() => router.push("/driver")} style={{ background: "none", border: "none", color: TEXT3, fontSize: 13, cursor: "pointer" }}>Driver App</button>
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}
