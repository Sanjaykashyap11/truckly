"""Trucky Backend — FastAPI + Gemini Live API voice agent
Integrates with Samsara ELD for real fleet data."""

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime
from html.parser import HTMLParser as _HTMLParser

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

import httpx
from mock_data import MOCK_ALERTS, MOCK_DRIVERS
from tools import get_tools, get_dispatcher_tools, handle_tool_call, handle_dispatcher_tool_call
import samsara as samsara_module
from trip_planner import rank_drivers_for_load, generate_fleet_insights, calculate_trip_plan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="Trucky API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Live driver state (Samsara-powered, falls back to mock) ──────────────────

ACTIVE_DRIVERS: dict = dict(MOCK_DRIVERS)  # starts as mock; replaced by Samsara data
import state as _state
LOADS = _state.LOADS        # shared with tools.py via state module
MESSAGES = _state.MESSAGES  # shared with tools.py via state module

async def sync_from_samsara():
    """Fetch live fleet data from Samsara ELD and update ACTIVE_DRIVERS"""
    global ACTIVE_DRIVERS
    client = samsara_module.get_client()
    if not client:
        return
    try:
        snapshot = await client.get_fleet_snapshot()
        drivers = snapshot.get("drivers", [])
        if drivers:
            ACTIVE_DRIVERS = {d["id"]: d for d in drivers}
            logger.info(f"Samsara sync: {len(drivers)} drivers loaded")
            await broadcast({
                "type": "drivers_update",
                "drivers": list(ACTIVE_DRIVERS.values()),
                "source": "samsara_live",
                "timestamp": datetime.now().isoformat(),
            })
        else:
            logger.info("Samsara returned 0 drivers — keeping current data")
    except Exception as e:
        logger.error(f"Samsara sync error: {e}")


async def samsara_background_sync():
    """Background task: refresh Samsara data every 30 seconds"""
    while True:
        await sync_from_samsara()
        await asyncio.sleep(30)


@app.on_event("startup")
async def startup_event():
    await sync_from_samsara()
    asyncio.create_task(samsara_background_sync())
    # Await 7-day fuel history so it's ready before the first API request
    client = samsara_module.get_client()
    if client:
        await client.load_fuel_history(days=7)
    logger.info("Trucky backend started — Samsara sync active")


def get_driver(driver_id: str) -> dict:
    """Look up driver from ACTIVE_DRIVERS; fall back to first available"""
    return ACTIVE_DRIVERS.get(driver_id) or (
        list(ACTIVE_DRIVERS.values())[0] if ACTIVE_DRIVERS else {}
    )


# ─── Dispatcher broadcast ─────────────────────────────────────────────────────

dispatcher_connections = _state.dispatcher_connections


from state import broadcast  # uses state.dispatcher_connections


# ─── Gemini client ────────────────────────────────────────────────────────────

USE_VERTEX = os.environ.get("USE_VERTEX_AI", "false").lower() == "true"

if USE_VERTEX:
    client = genai.Client(
        vertexai=True,
        project=os.environ.get("GCP_PROJECT_ID"),
        location=os.environ.get("GCP_REGION", "us-central1"),
    )
else:
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
        http_options=types.HttpOptions(api_version="v1alpha"),
    )

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest")


# ─── System prompts ───────────────────────────────────────────────────────────


def get_driver_system_prompt(driver_id: str) -> str:
    from state import LOADS
    driver = get_driver(driver_id)
    if not driver:
        return "You are Trucky, an AI co-pilot for truck drivers. Be helpful and safety-focused."

    hos = driver.get("hos", {})
    dh = hos.get("drive_time_remaining_mins", 0) // 60
    dm = hos.get("drive_time_remaining_mins", 0) % 60
    route = driver.get("route", {})
    dest = driver.get("destination", {}).get("address", "your destination") if driver.get("destination") else "your destination"
    source_label = " (LIVE from Samsara ELD)" if driver.get("source") == "samsara_live" else " (demo data)"
    driver_name = driver.get("name", "Driver")
    first_name = driver_name.split()[0]
    truck = driver.get("truck", "N/A")
    truck_height = driver.get("truck_height", "13'6\"")
    truck_weight = driver.get("truck_weight", "80,000 lbs")
    location_addr = driver.get("current_location", {}).get("address", "Unknown")
    speed = driver.get("current_location", {}).get("speed_mph", 0)
    on_duty_h = hos.get("on_duty_remaining_mins", 0) // 60
    on_duty_m = hos.get("on_duty_remaining_mins", 0) % 60
    cycle_h = hos.get("cycle_remaining_hours", "N/A")
    next_break = hos.get("next_mandatory_break", "N/A")
    break_loc = hos.get("break_location", "TBD")
    highway = route.get("highway", "N/A")
    eta = route.get("eta", "N/A")
    avoided = ", ".join(route.get("restricted_roads_avoided", [])) or "None"

    # Fetch assigned loads for this driver from the live load board
    first_lower = first_name.lower()
    my_loads = [l for l in LOADS if first_lower in (l.get("driver_name") or "").lower()]
    if my_loads:
        load_lines = []
        for l in my_loads:
            load_lines.append(
                f"  • Load {l['id']}: {l['origin']} → {l['destination']} | Status: {l['status']} "
                f"| Cargo: {l.get('commodity','General Freight')} | Rate: ${l.get('rate',0):,.0f}"
                + (f" | Pickup: {l['pickup_date']}" if l.get('pickup_date') else "")
                + (f" | Notes: {l['notes']}" if l.get('notes') else "")
            )
        loads_block = "\n".join(load_lines)
    else:
        loads_block = "  No loads currently assigned on the load board."

    return f"""You are Trucky, the AI voice co-pilot for commercial truck drivers — hands-free, safety-first.
You are speaking with {driver_name}.

DRIVER STATUS{source_label}:
• Driver: {driver_name}
• Truck: {truck} | Height: {truck_height} | Weight: {truck_weight}
• Current location: {location_addr}
• Speed: {speed} mph
• Destination: {dest}
• HOS drive time remaining: {dh}h {dm}min
• HOS status: {hos.get("status", "unknown")}
• On-duty remaining: {on_duty_h}h {on_duty_m}min
• 70-hour cycle remaining: {cycle_h}h
• Next mandatory break: {next_break} at {break_loc}
• Route: {highway} — ETA {eta}
• Restricted roads avoided: {avoided}

ASSIGNED LOADS (from live load board):
{loads_block}

YOUR ROLE:
Replace GPS apps, ELD screens, dispatch calls, fuel finders — all hands-free in one conversation.

RULES:
1. ALWAYS call check_hos_status before answering hours questions
2. ALWAYS call check_route_safety when driver mentions a specific road or shortcut
3. IMMEDIATELY call handle_breakdown if driver reports ANY mechanical issue or emergency
4. Warn driver proactively when HOS < 45 minutes remaining
5. ALWAYS call notify_stakeholders after any delay, route change, or ETA update
6. Keep responses SHORT — driver is operating an 80,000 lb vehicle
7. Be calm, professional, safety-focused — never flustered
8. Handle interruptions gracefully — driver may cut you off
9. Never suggest anything that could cause an HOS violation
10. When asked about loads, deliveries, or destinations — ALWAYS call get_my_loads first to get LIVE data. The load board updates in real-time; never rely only on the context above.
11. When driver says they are tired, need rest, or wants a day off — call send_message_to_dispatcher immediately with that info

PERSONALITY: Calm, trustworthy co-pilot. Confident. Safety-first. Data-driven.
Open with: "Hey {first_name}, Trucky here. I've got your ELD data live. How can I help?"
"""


def get_dispatcher_system_prompt() -> str:
    drivers = list(ACTIVE_DRIVERS.values())
    source_label = "LIVE from Samsara ELD" if any(d.get("source") == "samsara_live" for d in drivers) else "demo data"

    fleet_summary = []
    violations = []
    for d in drivers:
        hos = d.get("hos", {})
        mins = hos.get("drive_time_remaining_mins", 0)
        h, m = mins // 60, mins % 60
        status = d.get("status", "unknown")
        loc = d.get("current_location", {}).get("address", "unknown")
        speed = d.get("current_location", {}).get("speed_mph", 0)
        tel = d.get("telemetry") or {}
        fuel = tel.get("fuel_percent")
        eng = tel.get("engine_state", "Unknown")
        fuel_str = f"{fuel}%" if fuel is not None else "N/A"
        fleet_summary.append(
            f"  • {d['name']} | {d.get('truck', 'N/A')} | {status} | {loc} | {speed} mph | HOS: {h}h {m}min | Fuel: {fuel_str} | Engine: {eng}"
        )
        if mins < 60 and status in ("on_route", "driving"):
            violations.append(f"  ⚠ {d['name']}: {h}h {m}min HOS remaining — needs break soon")

    fleet_block = "\n".join(fleet_summary) if fleet_summary else "  No drivers currently active"
    violation_block = "\n".join(violations) if violations else "  All drivers compliant"

    return f"""You are Trucky, the AI dispatcher co-pilot for fleet management — intelligent, fast, data-driven.

FLEET STATUS ({source_label}):
{fleet_block}

HOS ALERTS:
{violation_block}

YOUR ROLE:
You are the dispatcher's command center. Answer fleet questions instantly, flag issues proactively, and coordinate responses — all via voice.

CAPABILITIES:
- Real-time driver locations, HOS, fuel %, engine state, odometer (from Samsara ELD)
- Proactive HOS violation warnings and fuel low alerts
- Route safety validation for any truck
- FMCSA-compliant trip planning and driver ranking via plan_delivery
- Automated stakeholder notifications (delay, breakdown, ETA updates)
- Full load board management: create loads, assign drivers, update status, list loads
- Fleet-wide command and coordination

LOAD MANAGEMENT (manage_load tool):
- "Create a load from Chicago to Atlanta at $3,200 rate" → action=create
- "Assign load ABC123 to [driver name]" → action=assign
- "Show me all loads / what loads do we have" → action=list
- "Mark load XYZ as delivered" → action=update_status
- "Cancel load ABC" → action=update_status with status=CANCELLED
- You can create AND assign in one step by including driver_name in create action

DRIVER MESSAGING (send_message_to_driver tool):
- "Tell Oscar that his situation will be taken care" → send_message_to_driver(driver_name="Oscar", message="...")
- "Message Eric to check in at the next stop" → send_message_to_driver
- "Notify [driver] that their load is ready" → send_message_to_driver
- Always use this tool when dispatcher wants to communicate TO a driver — never use notify_stakeholders for dispatcher→driver messages

RULES:
1. Always call get_fleet_status or get_driver_details to get FRESH data — never guess
2. FUEL DATA IS LIVE — fuel_percent and engine_state are real Samsara telemetry. Always share them when asked
3. Proactively flag any driver with < 1 hour HOS remaining
4. For breakdown situations, activate emergency protocol immediately
5. Keep responses concise but informative — dispatcher needs fast answers
6. When asked "who can make this delivery" — use plan_delivery tool, distance is auto-calculated
7. For any load operation — use manage_load tool immediately, don't ask for confirmation

PERSONALITY: Sharp, professional AI operations center. Efficient. Proactive. You run the load board.
Open with: "Trucky dispatch ready. {len(drivers)} drivers on live ELD. I can manage loads, plan routes, and monitor the fleet. What do you need?"
"""


# ─── REST endpoints ───────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    samsara_connected = samsara_module.get_client() is not None
    live_source = any(d.get("source") == "samsara_live" for d in ACTIVE_DRIVERS.values())
    return {
        "status": "healthy",
        "model": MODEL,
        "vertex_ai": USE_VERTEX,
        "samsara_connected": samsara_connected,
        "live_eld_data": live_source,
        "active_drivers": len(ACTIVE_DRIVERS),
    }


@app.get("/api/drivers")
async def api_get_drivers():
    return list(ACTIVE_DRIVERS.values())


@app.get("/api/drivers/{driver_id}")
async def api_get_driver(driver_id: str):
    return get_driver(driver_id)


@app.get("/api/alerts")
async def api_get_alerts():
    return MOCK_ALERTS


@app.post("/api/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    for alert in MOCK_ALERTS:
        if alert["id"] == alert_id:
            alert["acknowledged"] = True
            return {"success": True}
    return {"success": False, "error": "Alert not found"}


@app.get("/api/fleet/snapshot")
async def api_fleet_snapshot():
    """Fresh fleet snapshot — used by dispatcher dashboard"""
    client = samsara_module.get_client()
    if client:
        snapshot = await client.get_fleet_snapshot()
        return snapshot
    return {
        "drivers": list(ACTIVE_DRIVERS.values()),
        "source": "demo",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/fleet/insights")
async def api_fleet_insights():
    """AI-generated proactive fleet insights from real Samsara data"""
    drivers = list(ACTIVE_DRIVERS.values())
    insights = generate_fleet_insights(drivers)
    # Fleet summary stats
    on_route   = sum(1 for d in drivers if d.get("status") == "on_route")
    resting    = sum(1 for d in drivers if d.get("status") == "resting")
    violations = sum(1 for d in drivers if d.get("hos", {}).get("violation"))
    low_hos    = sum(1 for d in drivers if 0 < d.get("hos", {}).get("drive_time_remaining_mins", 999) < 120)
    available  = sum(1 for d in drivers if d.get("hos", {}).get("drive_time_remaining_mins", 0) >= 300
                    and d.get("status") != "on_route")
    low_fuel   = sum(1 for d in drivers if (d.get("telemetry") or {}).get("fuel_percent") is not None
                    and (d.get("telemetry") or {}).get("fuel_percent", 100) < 25)
    idling     = sum(1 for d in drivers if (d.get("telemetry") or {}).get("engine_state") == "On"
                    and d.get("status") != "on_route" and d.get("current_location", {}).get("speed_mph", 0) < 2)
    return {
        "insights": insights,
        "stats": {
            "total": len(drivers),
            "on_route": on_route,
            "resting": resting,
            "available": available,
            "violations": violations,
            "low_hos": low_hos,
            "low_fuel": low_fuel,
            "idling": idling,
        },
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/trip/plan")
async def api_trip_plan(body: dict):
    """
    FMCSA-compliant trip planning — find best drivers for a load.
    Body: {destination: str, distance_miles: float, required_by?: str (ISO)}
    """
    destination   = body.get("destination", "")
    distance_miles = float(body.get("distance_miles", 100))
    required_by   = body.get("required_by")

    drivers = list(ACTIVE_DRIVERS.values())
    ranked  = rank_drivers_for_load(drivers, distance_miles, required_by)

    # Attach rank metadata
    result = []
    for r in ranked[:15]:  # top 15
        result.append({
            "rank":          r["rank"],
            "driver_id":     r["driver"]["id"],
            "driver_name":   r["driver"]["name"],
            "truck":         r["driver"]["truck"],
            "status":        r["driver"]["status"],
            "location":      r["driver"]["current_location"]["address"],
            "speed_mph":     r["driver"]["current_location"]["speed_mph"],
            "hos_drive_rem": r["driver"]["hos"]["drive_time_remaining_mins"],
            "hos_shift_rem": r["driver"]["hos"]["on_duty_remaining_mins"],
            "hos_cycle_rem": r["driver"]["hos"]["cycle_remaining_hours"],
            "plan":          r["plan"],
            "meets_deadline": r.get("meets_deadline"),
        })

    return {
        "destination":    destination,
        "distance_miles": distance_miles,
        "required_by":    required_by,
        "total_drivers":  len(drivers),
        "results":        result,
        "timestamp":      datetime.now().isoformat(),
    }


@app.get("/api/drivers/available")
async def api_available_drivers():
    """Drivers available for new loads right now (300+ min HOS, not on route)"""
    drivers = list(ACTIVE_DRIVERS.values())
    available = [
        d for d in drivers
        if d.get("hos", {}).get("drive_time_remaining_mins", 0) >= 300
        and d.get("status") not in ("on_route",)
    ]
    available.sort(key=lambda d: d["hos"]["drive_time_remaining_mins"], reverse=True)
    return {
        "count": len(available),
        "drivers": available,
        "timestamp": datetime.now().isoformat(),
    }


# ─── Loads / Rate Con CRUD ────────────────────────────────────────────────────


@app.get("/api/loads")
async def get_loads_list():
    return LOADS


@app.post("/api/loads")
async def create_load(body: dict):
    load_id = f"TRK-{datetime.now().year}-{str(uuid.uuid4())[:4].upper()}"
    load = {
        "id": load_id,
        "created_at": datetime.now().isoformat(),
        "status": body.get("status", "PENDING"),
        "origin": body.get("origin", ""),
        "destination": body.get("destination", ""),
        "pickup_date": body.get("pickup_date", ""),
        "pickup_time": body.get("pickup_time", "08:00"),
        "pickup_contact": body.get("pickup_contact", ""),
        "pickup_phone": body.get("pickup_phone", ""),
        "delivery_date": body.get("delivery_date", ""),
        "delivery_time": body.get("delivery_time", "17:00"),
        "delivery_contact": body.get("delivery_contact", ""),
        "delivery_phone": body.get("delivery_phone", ""),
        "commodity": body.get("commodity", "General Freight"),
        "weight_lbs": body.get("weight_lbs", 0),
        "distance_miles": body.get("distance_miles", 0),
        "rate": body.get("rate", 0),
        "fuel_surcharge": body.get("fuel_surcharge", 0),
        "driver_id": body.get("driver_id", ""),
        "driver_name": body.get("driver_name", "Unassigned"),
        "truck": body.get("truck", ""),
        "broker_name": body.get("broker_name", ""),
        "broker_mc": body.get("broker_mc", ""),
        "special_instructions": body.get("special_instructions", ""),
        "po_number": body.get("po_number", ""),
        "reference_number": body.get("reference_number", ""),
    }
    LOADS.append(load)
    return load


@app.put("/api/loads/{load_id}")
async def update_load(load_id: str, body: dict):
    for i, load in enumerate(LOADS):
        if load["id"] == load_id:
            LOADS[i] = {**load, **body, "id": load_id}
            return LOADS[i]
    return {"error": "Load not found"}


@app.delete("/api/loads/{load_id}")
async def delete_load(load_id: str):
    LOADS[:] = [l for l in LOADS if l["id"] != load_id]
    return {"success": True}


# ─── Driver ↔ Dispatcher Messaging ────────────────────────────────────────────


@app.get("/api/messages")
async def get_messages(driver_id: str = None):
    if driver_id:
        return [m for m in MESSAGES if m.get("driver_id") == driver_id or m.get("to_driver_id") == driver_id]
    return MESSAGES


@app.post("/api/messages")
async def post_message(body: dict):
    msg = {
        "id": str(uuid.uuid4())[:8].upper(),
        "driver_id": body.get("driver_id", ""),
        "driver_name": body.get("driver_name", ""),
        "to_driver_id": body.get("to_driver_id", ""),
        "direction": body.get("direction", "driver_to_dispatcher"),  # or dispatcher_to_driver
        "text": body.get("text", ""),
        "eta": body.get("eta", ""),
        "new_eta": body.get("new_eta", ""),
        "load_id": body.get("load_id", ""),
        "read": False,
        "timestamp": datetime.now().isoformat(),
    }
    MESSAGES.append(msg)
    await broadcast({"type": "new_message", "message": msg})
    return msg


@app.post("/api/messages/{msg_id}/read")
async def mark_message_read(msg_id: str):
    for m in MESSAGES:
        if m["id"] == msg_id:
            m["read"] = True
            return {"success": True}
    return {"success": False}


# ─── Distance calculation (OSRM + Nominatim — no API key) ─────────────────────


@app.post("/api/distance")
async def api_distance(body: dict):
    origin = body.get("origin", "").strip()
    dest = body.get("destination", "").strip()
    if not dest:
        return {"error": "Destination required"}
    nom_headers = {"User-Agent": "TruckyTMS/2.0 (fleet management; contact@trucky.ai)"}
    try:
        async with httpx.AsyncClient(timeout=12.0) as hc:
            # Geocode destination
            r2 = await hc.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": dest, "format": "json", "limit": 1},
                headers=nom_headers,
            )
            locs2 = r2.json()
            if not locs2:
                return {"error": f"Could not geocode: {dest}"}
            lat2, lng2 = float(locs2[0]["lat"]), float(locs2[0]["lon"])
            dest_display = locs2[0].get("display_name", dest)

            if origin:
                await asyncio.sleep(1.1)  # Nominatim rate limit: 1 req/sec
                r1 = await hc.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": origin, "format": "json", "limit": 1},
                    headers=nom_headers,
                )
                locs1 = r1.json()
                if not locs1:
                    return {"error": f"Could not geocode origin: {origin}"}
                lat1, lng1 = float(locs1[0]["lat"]), float(locs1[0]["lon"])
            else:
                # Use fleet centroid
                active = [d for d in ACTIVE_DRIVERS.values() if d.get("current_location", {}).get("lat")]
                if active:
                    lat1 = sum(d["current_location"]["lat"] for d in active) / len(active)
                    lng1 = sum(d["current_location"]["lng"] for d in active) / len(active)
                else:
                    lat1, lng1 = 40.7128, -74.0060  # NYC default

            # OSRM open routing (no key needed)
            r3 = await hc.get(
                f"http://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}",
                params={"overview": "false"},
            )
            data = r3.json()
            if data.get("code") == "Ok":
                route = data["routes"][0]
                dist_miles = round(route["distance"] * 0.000621371, 1)
                dur_secs = route["duration"]
                dur_h = int(dur_secs // 3600)
                dur_m = int((dur_secs % 3600) // 60)
                return {
                    "origin": origin or "Fleet centroid",
                    "destination": dest_display,
                    "distance_miles": dist_miles,
                    "duration_hours": round(dur_secs / 3600, 2),
                    "duration_display": f"{dur_h}h {dur_m}m",
                    "origin_coords": {"lat": lat1, "lng": lng1},
                    "destination_coords": {"lat": lat2, "lng": lng2},
                }
            return {"error": "Routing service unavailable", "code": data.get("code")}
    except Exception as e:
        logger.error(f"Distance API error: {e}")
        return {"error": str(e)}


# ─── SAFER HTML cell parser ────────────────────────────────────────────────────


class _SAFERParser(_HTMLParser):
    """Extract all TD/TH text cells from SAFER HTML page"""
    def __init__(self):
        super().__init__()
        self._depth = 0
        self._buf = ""
        self.cells: list = []

    def handle_starttag(self, tag, attrs):
        if tag in ("td", "th"):
            if self._depth == 0:
                self._buf = ""
            self._depth += 1

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._depth > 0:
            self._depth -= 1
            if self._depth == 0:
                text = " ".join(self._buf.replace("\xa0", " ").split()).strip()
                if text:
                    self.cells.append(text)
                self._buf = ""

    def handle_data(self, data):
        if self._depth > 0:
            self._buf += data

    def handle_entityref(self, name):
        if self._depth > 0:
            self._buf += {"amp": "&", "lt": "<", "gt": ">", "nbsp": " ", "quot": '"'}.get(name, "")

    def handle_charref(self, name):
        if self._depth > 0:
            try:
                self._buf += chr(int(name[1:], 16) if name.startswith("x") else int(name))
            except Exception:
                pass


def _safer_extract(cells: list, label: str) -> str:
    lo = label.lower().rstrip(":")
    for i, c in enumerate(cells):
        c_lo = c.lower().rstrip(":")
        if c_lo == lo or (lo in c_lo and len(c_lo) < len(lo) + 20 and ":" in c):
            for j in range(i + 1, min(i + 5, len(cells))):
                v = cells[j].strip()
                if v and v.lower() not in ("none", "n/a", "") and not v.endswith(":"):
                    return v
                elif v:
                    return v
    return "N/A"


# ─── FMCSA SAFER carrier lookup ────────────────────────────────────────────────


@app.post("/api/safer")
async def safer_lookup(body: dict):
    dot_number = str(body.get("dot_number", "")).strip()
    if not dot_number:
        return {"error": "DOT number required"}
    safer_url = (
        f"https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY"
        f"&query_type=queryCarrierSnapshot&query_param=USDOT&query_string={dot_number}"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0) as hc:
            r = await hc.get(
                safer_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
                    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
                follow_redirects=True,
            )
            html = r.text

        # Build label→value map using SAFER's querylabelbkg/queryfield CSS classes
        pairs = re.findall(
            r'querylabelbkg[^>]*>(.*?)</[Tt][Hh]>\s*<[Tt][Dd][^>]*class=["\']?queryfield[^>]*>(.*?)</[Tt][Dd]>',
            html, re.DOTALL,
        )
        data: dict = {}
        for raw_label, raw_val in pairs:
            label = re.sub(r"<[^>]+>", "", raw_label).replace("\xa0", "").strip().rstrip(":").lower().strip()
            val   = re.sub(r"<[^>]+>", " ", raw_val).replace("\xa0", "").replace("&nbsp;", "")
            val   = " ".join(val.split()).strip()
            if label and val and val != "--":
                data[label] = val

        def get(key: str) -> str:
            return data.get(key.lower().rstrip(":").strip(), "N/A")

        # Company name is in the page title or a <B> tag near the top
        name_m = re.search(r"Company Snapshot\s+([A-Z][^\n<]{3,60})", html)
        legal_name = name_m.group(1).strip() if name_m else get("company information")
        if legal_name in ("N/A", ""):
            legal_name = get("legal name")

        # Drivers field has format "Drivers:\n  18  \n" — extract number
        drivers_m = re.search(r'Drivers:\s*</[Tt][Hh]>.*?<[Tt][Dd][^>]*>\s*(\d+)', html, re.DOTALL)
        drivers_val = drivers_m.group(1) if drivers_m else get("drivers")

        return {
            "dot_number":        dot_number,
            "legal_name":        legal_name,
            "dba_name":          get("dba name"),
            "physical_address":  get("physical address"),
            "phone":             get("phone"),
            "operating_status":  get("usdot status"),
            "authority_status":  get("operating authority status"),
            "safety_rating":     get("rating"),
            "review_date":       get("review date"),
            "carrier_operation": get("carrier operation"),
            "mcs_150_date":      get("mcs-150 form date"),
            "mcs_150_mileage":   get("mcs-150 mileage (year)"),
            "power_units":       get("power units"),
            "drivers":           drivers_val,
            "mc_number":         get("mc/mx/ff number(s)"),
            "entity_type":       get("entity type"),
            "safer_url":         safer_url,
        }
    except Exception as e:
        logger.error(f"SAFER lookup error: {e}")
        return {"error": str(e), "safer_url": safer_url}


# ─── Fleet vehicles endpoint (truck-centric) ──────────────────────────────────

def _demo_refills():
    """Realistic demo fuel refill events spanning the past 7 days."""
    from datetime import timezone, timedelta
    now = datetime.now(timezone.utc)
    return [
        # Today
        {"vehicle_id": "d01", "truck": "Truck 14 — Peterbilt 389",
         "timestamp": (now - timedelta(hours=3, minutes=22)).isoformat(),
         "prev_pct": 12.4, "new_pct": 91.8, "gallons_added": 158.8, "est_cost": 622.50,
         "location": "Pilot Flying J #372, Gary, IN", "lat": 41.593, "lng": -87.346},
        {"vehicle_id": "d02", "truck": "Truck 07 — Kenworth T680",
         "timestamp": (now - timedelta(hours=9, minutes=5)).isoformat(),
         "prev_pct": 8.1, "new_pct": 88.5, "gallons_added": 160.8, "est_cost": 630.34,
         "location": "Love's Travel Stop #619, Oklahoma City, OK", "lat": 35.467, "lng": -97.516},
        # Yesterday
        {"vehicle_id": "d03", "truck": "Truck 22 — Freightliner Cascadia",
         "timestamp": (now - timedelta(days=1, hours=2, minutes=47)).isoformat(),
         "prev_pct": 19.3, "new_pct": 95.0, "gallons_added": 151.4, "est_cost": 593.49,
         "location": "TA Travel Center, Amarillo, TX", "lat": 35.222, "lng": -101.831},
        {"vehicle_id": "d04", "truck": "Truck 31 — Volvo VNL 860",
         "timestamp": (now - timedelta(days=1, hours=14, minutes=15)).isoformat(),
         "prev_pct": 6.7, "new_pct": 90.2, "gallons_added": 167.0, "est_cost": 654.64,
         "location": "Pilot Flying J #1204, Columbus, OH", "lat": 39.961, "lng": -82.999},
        # 2 days ago
        {"vehicle_id": "d05", "truck": "Truck 09 — International LT",
         "timestamp": (now - timedelta(days=2, hours=6, minutes=33)).isoformat(),
         "prev_pct": 22.1, "new_pct": 89.6, "gallons_added": 135.0, "est_cost": 529.20,
         "location": "Love's Travel Stop #287, Nashville, TN", "lat": 36.174, "lng": -86.767},
        {"vehicle_id": "d01", "truck": "Truck 14 — Peterbilt 389",
         "timestamp": (now - timedelta(days=2, hours=19, minutes=10)).isoformat(),
         "prev_pct": 10.2, "new_pct": 93.1, "gallons_added": 165.8, "est_cost": 649.94,
         "location": "Pilot Flying J #588, Memphis, TN", "lat": 35.149, "lng": -90.048},
        # 3 days ago
        {"vehicle_id": "d06", "truck": "Truck 18 — Mack Anthem",
         "timestamp": (now - timedelta(days=3, hours=4, minutes=55)).isoformat(),
         "prev_pct": 15.0, "new_pct": 90.5, "gallons_added": 151.0, "est_cost": 591.92,
         "location": "TA Travel Center, Dallas, TX", "lat": 32.776, "lng": -96.797},
        {"vehicle_id": "d02", "truck": "Truck 07 — Kenworth T680",
         "timestamp": (now - timedelta(days=3, hours=16, minutes=22)).isoformat(),
         "prev_pct": 9.4, "new_pct": 87.9, "gallons_added": 157.0, "est_cost": 615.44,
         "location": "Pilot Flying J #201, St. Louis, MO", "lat": 38.627, "lng": -90.199},
        # 4 days ago
        {"vehicle_id": "d07", "truck": "Truck 03 — Peterbilt 579",
         "timestamp": (now - timedelta(days=4, hours=8, minutes=40)).isoformat(),
         "prev_pct": 18.5, "new_pct": 94.2, "gallons_added": 151.4, "est_cost": 593.49,
         "location": "Love's Travel Stop #441, Denver, CO", "lat": 39.739, "lng": -104.984},
        {"vehicle_id": "d05", "truck": "Truck 09 — International LT",
         "timestamp": (now - timedelta(days=4, hours=21, minutes=8)).isoformat(),
         "prev_pct": 11.3, "new_pct": 88.0, "gallons_added": 153.4, "est_cost": 601.33,
         "location": "Pilot Flying J #903, Indianapolis, IN", "lat": 39.768, "lng": -86.158},
        # 5 days ago
        {"vehicle_id": "d03", "truck": "Truck 22 — Freightliner Cascadia",
         "timestamp": (now - timedelta(days=5, hours=3, minutes=15)).isoformat(),
         "prev_pct": 7.8, "new_pct": 91.0, "gallons_added": 166.4, "est_cost": 652.29,
         "location": "TA Travel Center, Albuquerque, NM", "lat": 35.085, "lng": -106.651},
        {"vehicle_id": "d06", "truck": "Truck 18 — Mack Anthem",
         "timestamp": (now - timedelta(days=5, hours=17, minutes=30)).isoformat(),
         "prev_pct": 14.2, "new_pct": 89.8, "gallons_added": 151.2, "est_cost": 592.70,
         "location": "Love's Travel Stop #712, Kansas City, MO", "lat": 39.099, "lng": -94.578},
        # 6 days ago
        {"vehicle_id": "d04", "truck": "Truck 31 — Volvo VNL 860",
         "timestamp": (now - timedelta(days=6, hours=10, minutes=5)).isoformat(),
         "prev_pct": 5.9, "new_pct": 92.3, "gallons_added": 172.8, "est_cost": 677.38,
         "location": "Pilot Flying J #756, Atlanta, GA", "lat": 33.749, "lng": -84.388},
        {"vehicle_id": "d07", "truck": "Truck 03 — Peterbilt 579",
         "timestamp": (now - timedelta(days=6, hours=22, minutes=44)).isoformat(),
         "prev_pct": 16.7, "new_pct": 93.5, "gallons_added": 153.6, "est_cost": 602.11,
         "location": "TA Travel Center, Phoenix, AZ", "lat": 33.449, "lng": -112.074},
    ]


@app.get("/api/fleet/vehicles")
async def api_fleet_vehicles():
    """Truck-centric view: vehicles with telemetry + assigned driver"""
    drivers = list(ACTIVE_DRIVERS.values())
    trucks = []
    TANK_GAL = 200  # standard semi capacity
    for d in drivers:
        tel = d.get("telemetry") or {}
        fuel_pct = tel.get("fuel_percent")
        odo = tel.get("odometer_miles")
        trucks.append({
            "truck_name":    d.get("truck", "Unknown"),
            "driver_id":     d.get("id"),
            "driver_name":   d.get("name", "Unassigned"),
            "status":        d.get("status"),
            "location":      d.get("current_location", {}).get("address", ""),
            "lat":           d.get("current_location", {}).get("lat", 0),
            "lng":           d.get("current_location", {}).get("lng", 0),
            "speed_mph":     d.get("current_location", {}).get("speed_mph", 0),
            "fuel_percent":  fuel_pct,
            "fuel_gallons":  round(fuel_pct / 100 * TANK_GAL, 1) if fuel_pct is not None else None,
            "engine_state":  tel.get("engine_state", "Unknown"),
            "odometer_miles": odo,
            "hos_drive_rem": d.get("hos", {}).get("drive_time_remaining_mins", 0),
            "source":        d.get("source"),
            # Maintenance flags based on odometer intervals
            "maintenance": {
                "oil_change_due":    odo is not None and (odo % 25000) > 22000,
                "tire_rotation_due": odo is not None and (odo % 50000) > 47000,
                "inspection_due":    odo is not None and (odo % 100000) > 97000,
            },
        })
    trucks.sort(key=lambda t: t["truck_name"])
    # Summary stats
    client = samsara_module.get_client()
    if client:
        refills = client.get_refill_events()  # real Samsara data only
    else:
        refills = _demo_refills()             # demo mode only
    return {
        "trucks":   trucks,
        "count":    len(trucks),
        "refills":  refills[:100],
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/fuel/events")
async def api_fuel_events():
    client = samsara_module.get_client()
    if client:
        events = client.get_refill_events()
    else:
        events = _demo_refills()
    return {"events": events, "count": len(events)}


# ─── Dispatcher data WebSocket ────────────────────────────────────────────────


@app.websocket("/ws/dispatcher")
async def dispatcher_websocket(websocket: WebSocket):
    await websocket.accept()
    dispatcher_connections.add(websocket)
    try:
        await websocket.send_text(json.dumps({
            "type": "init",
            "drivers": list(ACTIVE_DRIVERS.values()),
            "alerts": MOCK_ALERTS,
        }))
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                data = json.loads(msg)
                if data.get("type") == "refresh":
                    await sync_from_samsara()
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
    except Exception:
        pass
    finally:
        dispatcher_connections.discard(websocket)


# ─── Shared voice session handler ─────────────────────────────────────────────


async def run_voice_session(
    websocket: WebSocket,
    session_id: str,
    system_prompt: str,
    tools_list: list,
    greet_text: str,
    is_dispatcher: bool = False,
):
    """Shared Gemini Live API voice session for drivers and dispatchers"""
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=system_prompt,
        tools=tools_list,
        speech_config=types.SpeechConfig(language_code="en-US"),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    async with client.aio.live.connect(model=MODEL, config=config) as session:
        logger.info(f"Gemini Live session started: {session_id}")

        await session.send_client_content(
            turns=types.Content(
                parts=[types.Part(text=greet_text)],
                role="user",
            ),
            turn_complete=True,
        )

        async def receive_from_browser():
            try:
                async for raw in websocket.iter_text():
                    msg = json.loads(raw)

                    if msg["type"] == "audio":
                        audio_bytes = base64.b64decode(msg["data"])
                        await session.send_realtime_input(
                            media=types.Blob(
                                data=audio_bytes,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                    elif msg["type"] == "text":
                        await session.send_client_content(
                            turns=types.Content(
                                parts=[types.Part(text=msg["text"])],
                                role="user",
                            ),
                            turn_complete=True,
                        )
                    elif msg["type"] == "ping":
                        await websocket.send_text(json.dumps({"type": "pong"}))

            except WebSocketDisconnect:
                logger.info(f"Browser WS closed (receive): {session_id}")
            except Exception as e:
                logger.error(f"receive_from_browser error [{session_id}]: {e}")

        async def send_to_browser():
            input_transcript_buf = ""
            output_transcript_buf = ""
            try:
                while True:
                    async for response in session.receive():
                        try:
                            if response.server_content:
                                sc = response.server_content
                                # User voice transcription — accumulate, send on finished or when substantial
                                if sc.input_transcription and sc.input_transcription.text:
                                    input_transcript_buf += sc.input_transcription.text
                                    if sc.input_transcription.finished is True:
                                        if input_transcript_buf.strip():
                                            await websocket.send_text(json.dumps({
                                                "type": "transcript",
                                                "text": input_transcript_buf.strip(),
                                                "speaker": "user",
                                            }))
                                        input_transcript_buf = ""
                                    elif input_transcript_buf.strip():
                                        # Send partial user transcript for real-time feedback
                                        await websocket.send_text(json.dumps({
                                            "type": "transcript",
                                            "text": input_transcript_buf.strip(),
                                            "speaker": "user",
                                            "partial": True,
                                        }))
                                # Trucky output transcription — send every non-empty chunk immediately
                                if sc.output_transcription and sc.output_transcription.text:
                                    chunk = sc.output_transcription.text.strip()
                                    if chunk:
                                        output_transcript_buf += (" " if output_transcript_buf else "") + chunk
                                        await websocket.send_text(json.dumps({
                                            "type": "transcript",
                                            "text": output_transcript_buf.strip(),
                                            "speaker": "trucky",
                                            "partial": sc.output_transcription.finished is not True,
                                        }))
                                    if sc.output_transcription.finished:
                                        output_transcript_buf = ""
                                if sc.model_turn:
                                    for part in sc.model_turn.parts:
                                        if hasattr(part, "thought") and part.thought:
                                            continue
                                        if part.inline_data and part.inline_data.data:
                                            await websocket.send_text(json.dumps({
                                                "type": "audio",
                                                "data": base64.b64encode(part.inline_data.data).decode(),
                                            }))
                                        # part.text is skipped — output_transcription handles Trucky's transcript
                                        # to avoid duplicate bubbles in native audio mode

                                if sc.turn_complete:
                                    # Flush any unsent transcript buffers on turn end
                                    if input_transcript_buf.strip():
                                        await websocket.send_text(json.dumps({
                                            "type": "transcript",
                                            "text": input_transcript_buf.strip(),
                                            "speaker": "user",
                                        }))
                                        input_transcript_buf = ""
                                    if output_transcript_buf.strip():
                                        await websocket.send_text(json.dumps({
                                            "type": "transcript",
                                            "text": output_transcript_buf.strip(),
                                            "speaker": "trucky",
                                            "partial": False,
                                        }))
                                        output_transcript_buf = ""
                                    await websocket.send_text(json.dumps({"type": "turn_complete"}))

                            elif response.data:
                                await websocket.send_text(json.dumps({
                                    "type": "audio",
                                    "data": base64.b64encode(response.data).decode(),
                                }))

                            if response.tool_call:
                                for fc in response.tool_call.function_calls:
                                    logger.info(f"Tool call [{session_id}]: {fc.name}({dict(fc.args)})")

                                    await websocket.send_text(json.dumps({
                                        "type": "tool_start",
                                        "tool": fc.name,
                                        "args": dict(fc.args),
                                    }))

                                    if is_dispatcher:
                                        result = await handle_dispatcher_tool_call(
                                            fc.name, dict(fc.args), ACTIVE_DRIVERS
                                        )
                                    else:
                                        result = await handle_tool_call(
                                            fc.name, dict(fc.args), session_id
                                        )

                                    await session.send_tool_response(
                                        function_responses=[types.FunctionResponse(
                                            name=fc.name,
                                            id=fc.id,
                                            response=result,
                                        )]
                                    )

                                    await websocket.send_text(json.dumps({
                                        "type": "tool_result",
                                        "tool": fc.name,
                                        "result": result,
                                    }))

                                    await broadcast({
                                        "type": "tool_activity",
                                        "session_id": session_id,
                                        "is_dispatcher": is_dispatcher,
                                        "tool": fc.name,
                                        "result": result,
                                    })

                                    if fc.name == "handle_breakdown":
                                        new_alert = {
                                            "id": f"A{len(MOCK_ALERTS)+1:03d}",
                                            "driver_id": session_id,
                                            "driver_name": ACTIVE_DRIVERS.get(session_id, {}).get("name", "Driver"),
                                            "type": "BREAKDOWN",
                                            "severity": "HIGH",
                                            "message": "Breakdown reported. Trucky activated emergency protocol. Mechanics contacted.",
                                            "timestamp": datetime.now().isoformat(),
                                            "acknowledged": False,
                                            "auto_resolved": False,
                                        }
                                        MOCK_ALERTS.append(new_alert)
                                        await broadcast({"type": "new_alert", "alert": new_alert})

                        except Exception as inner_e:
                            logger.error(f"Inner receive loop error [{session_id}]: {inner_e}", exc_info=True)

            except WebSocketDisconnect:
                logger.info(f"Browser WS closed (send): {session_id}")
            except Exception as e:
                logger.error(f"send_to_browser error [{session_id}]: {e}", exc_info=True)
                try:
                    await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
                    await websocket.send_text(json.dumps({"type": "reconnect_needed"}))
                except Exception:
                    pass

        await asyncio.gather(
            receive_from_browser(),
            send_to_browser(),
            return_exceptions=True,
        )


# ─── Driver voice WebSocket ───────────────────────────────────────────────────


@app.websocket("/ws/voice/{driver_id}")
async def driver_voice_websocket(websocket: WebSocket, driver_id: str):
    await websocket.accept()
    dispatcher_connections.add(websocket)  # receive load_update / new_message broadcasts
    logger.info(f"Driver voice WS connected: {driver_id}")

    driver = get_driver(driver_id)
    driver_name = driver.get("name", "Driver")

    try:
        await run_voice_session(
            websocket=websocket,
            session_id=driver_id,
            system_prompt=get_driver_system_prompt(driver_id),
            tools_list=get_tools(),
            greet_text=f"[Driver {driver_name} just connected. Greet them as Trucky in one short sentence. Mention their HOS time remaining.]",
            is_dispatcher=False,
        )
    except WebSocketDisconnect:
        logger.info(f"Driver WS disconnected: {driver_id}")
    except Exception as e:
        logger.error(f"Driver voice WS error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        dispatcher_connections.discard(websocket)


# ─── Dispatcher voice WebSocket ───────────────────────────────────────────────


@app.websocket("/ws/dispatcher/voice")
async def dispatcher_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    dispatcher_connections.add(websocket)
    logger.info("Dispatcher voice WS connected")

    # Send any unread messages immediately on connect
    if MESSAGES:
        unread = [m for m in MESSAGES if not m.get("read")]
        if unread:
            await websocket.send_text(json.dumps({"type": "messages_snapshot", "messages": unread[-20:]}))

    try:
        await run_voice_session(
            websocket=websocket,
            session_id="dispatcher",
            system_prompt=get_dispatcher_system_prompt(),
            tools_list=get_dispatcher_tools(),
            greet_text=f"[Dispatcher just connected. Greet them as Trucky dispatch in one sentence. Mention fleet count and whether data is live from Samsara.]",
            is_dispatcher=True,
        )
    except WebSocketDisconnect:
        logger.info("Dispatcher voice WS disconnected")
    except Exception as e:
        logger.error(f"Dispatcher voice WS error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        dispatcher_connections.discard(websocket)


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
