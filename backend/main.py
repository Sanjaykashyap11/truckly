"""Trucky Backend — FastAPI + Gemini Live API voice agent
Integrates with Samsara ELD for real fleet data."""

import asyncio
import base64
import json
import logging
import os
from datetime import datetime

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

from mock_data import MOCK_ALERTS, MOCK_DRIVERS
from tools import get_tools, get_dispatcher_tools, handle_tool_call, handle_dispatcher_tool_call
import samsara as samsara_module

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
    logger.info("Trucky backend started — Samsara sync active")


def get_driver(driver_id: str) -> dict:
    """Look up driver from ACTIVE_DRIVERS; fall back to first available"""
    return ACTIVE_DRIVERS.get(driver_id) or (
        list(ACTIVE_DRIVERS.values())[0] if ACTIVE_DRIVERS else {}
    )


# ─── Dispatcher broadcast ─────────────────────────────────────────────────────

dispatcher_connections: set[WebSocket] = set()


async def broadcast(message: dict):
    dead = set()
    for ws in dispatcher_connections:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.add(ws)
    dispatcher_connections.difference_update(dead)


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
        fleet_summary.append(
            f"  • {d['name']} | {d.get('truck', 'N/A')} | {status} | {loc} | {speed} mph | HOS: {h}h {m}min"
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
- Real-time driver locations and HOS status (from Samsara ELD)
- Proactive HOS violation warnings
- Route safety validation for any truck
- Automated stakeholder notifications (delay, breakdown, ETA updates)
- Fleet-wide command and coordination

RULES:
1. Always call get_fleet_status to get the freshest data before answering fleet questions
2. Proactively flag any driver with < 1 hour HOS remaining
3. For breakdown situations, activate emergency protocol immediately
4. Keep responses concise but informative — dispatcher needs fast answers
5. Always mention data source (Samsara live vs demo)

PERSONALITY: Sharp, professional operations center. Efficient. Proactive. Never guess — always use tools.
Open with: "Trucky dispatch ready. I have {len(drivers)} drivers on live Samsara ELD. What do you need?"
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
        "violations": [],
        "source": "demo",
        "timestamp": datetime.now().isoformat(),
    }


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
            try:
                while True:
                    async for response in session.receive():
                        try:
                            if response.server_content:
                                sc = response.server_content
                                if sc.model_turn:
                                    for part in sc.model_turn.parts:
                                        if hasattr(part, "thought") and part.thought:
                                            continue
                                        if part.inline_data and part.inline_data.data:
                                            await websocket.send_text(json.dumps({
                                                "type": "audio",
                                                "data": base64.b64encode(part.inline_data.data).decode(),
                                            }))
                                        elif part.text:
                                            await websocket.send_text(json.dumps({
                                                "type": "transcript",
                                                "text": part.text,
                                                "speaker": "trucky",
                                            }))

                                if sc.turn_complete:
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


# ─── Dispatcher voice WebSocket ───────────────────────────────────────────────


@app.websocket("/ws/dispatcher/voice")
async def dispatcher_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info("Dispatcher voice WS connected")

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


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
