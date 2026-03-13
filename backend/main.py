"""Truckly Backend — FastAPI + Gemini Live API voice agent"""

import asyncio
import base64
import json
import logging
import os

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

from mock_data import MOCK_ALERTS, MOCK_DRIVERS
from tools import get_tools, handle_tool_call

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="Truckly API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Gemini client ────────────────────────────────────────────────────────────

USE_VERTEX = os.environ.get("USE_VERTEX_AI", "false").lower() == "true"

if USE_VERTEX:
    client = genai.Client(
        vertexai=True,
        project=os.environ.get("GCP_PROJECT_ID"),
        location=os.environ.get("GCP_REGION", "us-central1"),
    )
else:
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-live-001")


# ─── System prompt ────────────────────────────────────────────────────────────


def get_system_prompt(driver_id: str) -> str:
    driver = MOCK_DRIVERS.get(driver_id, list(MOCK_DRIVERS.values())[0])
    hos = driver["hos"]
    dh = hos["drive_time_remaining_mins"] // 60
    dm = hos["drive_time_remaining_mins"] % 60
    route = driver.get("route", {})
    dest = driver.get("destination", {}).get("address", "your destination")

    return f"""You are Sally, the AI voice co-pilot for Truckly — a hands-free fleet safety platform.
You are speaking with {driver["name"]}.

DRIVER STATUS (live from ELD):
• Driver: {driver["name"]}
• Truck: {driver["truck"]} | Height: {driver["truck_height"]} | Weight: {driver["truck_weight"]}
• Current location: {driver["current_location"]["address"]}
• Destination: {dest}
• HOS drive time remaining: {dh}h {dm}min
• HOS status: {hos["status"]}
• Next mandatory break: {hos.get("next_mandatory_break", "N/A")} at {hos.get("break_location", "TBD")}
• Route: {route.get("highway", "N/A")} — ETA {route.get("eta", "N/A")}
• Restricted roads avoided: {", ".join(route.get("restricted_roads_avoided", []))}

YOUR ROLE:
You replace GPS apps, ELD screens, dispatch calls, fuel finders, and weather apps — all in one hands-free voice conversation.

RULES:
1. ALWAYS call check_hos_status before answering hours-related questions
2. ALWAYS call check_route_safety when driver mentions a specific road or shortcut
3. IMMEDIATELY call handle_breakdown if driver reports any mechanical issue or emergency
4. Warn driver proactively when HOS < 45 minutes remaining
5. ALWAYS call notify_stakeholders after any delay, route change, or ETA update
6. Keep responses SHORT — driver is operating an 80,000 lb vehicle
7. Be calm, professional, safety-focused
8. Handle interruptions gracefully — driver may cut you off mid-sentence
9. Never suggest anything that could cause an HOS violation

PERSONALITY: You are a calm, trustworthy co-pilot. Confident. Safety-first. Never flustered.
Open with: "Hey {driver["name"].split()[0]}, Sally here. How can I help?"
"""


# ─── REST endpoints ───────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "healthy", "model": MODEL, "vertex_ai": USE_VERTEX}


@app.get("/api/drivers")
async def get_drivers():
    return list(MOCK_DRIVERS.values())


@app.get("/api/drivers/{driver_id}")
async def get_driver(driver_id: str):
    return MOCK_DRIVERS.get(driver_id, {})


@app.get("/api/alerts")
async def get_alerts():
    return MOCK_ALERTS


@app.post("/api/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    for alert in MOCK_ALERTS:
        if alert["id"] == alert_id:
            alert["acknowledged"] = True
            return {"success": True}
    return {"success": False, "error": "Alert not found"}


# ─── WebSocket voice bridge ───────────────────────────────────────────────────


@app.websocket("/ws/voice/{driver_id}")
async def voice_websocket(websocket: WebSocket, driver_id: str):
    await websocket.accept()
    logger.info(f"Voice WS connected: driver={driver_id}")

    try:
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO", "TEXT"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Aoede"  # warm, professional female voice
                    )
                )
            ),
            system_instruction=types.Content(
                parts=[types.Part(text=get_system_prompt(driver_id))],
                role="user",
            ),
            tools=get_tools(),
        )

        async with client.aio.live.connect(model=MODEL, config=config) as session:
            logger.info(f"Gemini Live session started: driver={driver_id}")

            # Trigger opening greeting
            await session.send(
                input=f"[The driver {MOCK_DRIVERS.get(driver_id, {}).get('name', 'Driver')} has just connected. Greet them as Sally briefly — one sentence.]",
                end_of_turn=True,
            )

            async def receive_from_browser():
                """Forward browser audio/text to Gemini"""
                try:
                    async for raw in websocket.iter_text():
                        msg = json.loads(raw)

                        if msg["type"] == "audio":
                            audio_bytes = base64.b64decode(msg["data"])
                            await session.send(
                                input=types.LiveClientRealtimeInput(
                                    media_chunks=[
                                        types.Blob(
                                            data=audio_bytes,
                                            mime_type="audio/pcm;rate=16000",
                                        )
                                    ]
                                )
                            )

                        elif msg["type"] == "text":
                            await session.send(
                                input=msg["text"],
                                end_of_turn=True,
                            )

                        elif msg["type"] == "ping":
                            await websocket.send_text(json.dumps({"type": "pong"}))

                except WebSocketDisconnect:
                    logger.info(f"Browser WS closed (receive): driver={driver_id}")
                except Exception as e:
                    logger.error(f"receive_from_browser error: {e}")

            async def send_to_browser():
                """Forward Gemini responses to browser"""
                try:
                    async for response in session.receive():

                        # ── Audio ──────────────────────────────────────────
                        if response.data:
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "type": "audio",
                                        "data": base64.b64encode(response.data).decode(),
                                    }
                                )
                            )

                        # ── Server content (text transcript + turn signals) ─
                        if response.server_content:
                            sc = response.server_content

                            if sc.model_turn:
                                for part in sc.model_turn.parts:
                                    if part.inline_data:
                                        await websocket.send_text(
                                            json.dumps(
                                                {
                                                    "type": "audio",
                                                    "data": base64.b64encode(
                                                        part.inline_data.data
                                                    ).decode(),
                                                }
                                            )
                                        )
                                    if part.text:
                                        await websocket.send_text(
                                            json.dumps(
                                                {
                                                    "type": "transcript",
                                                    "text": part.text,
                                                    "speaker": "sally",
                                                }
                                            )
                                        )

                            if sc.turn_complete:
                                await websocket.send_text(
                                    json.dumps({"type": "turn_complete"})
                                )

                        # ── Tool calls ────────────────────────────────────
                        if response.tool_call:
                            for fc in response.tool_call.function_calls:
                                logger.info(f"Tool call: {fc.name}({fc.args})")

                                # Notify browser so UI can show activity
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "type": "tool_start",
                                            "tool": fc.name,
                                            "args": dict(fc.args),
                                        }
                                    )
                                )

                                result = await handle_tool_call(
                                    fc.name, dict(fc.args), driver_id
                                )

                                # Return result to Gemini
                                await session.send(
                                    input=types.LiveClientToolResponse(
                                        function_responses=[
                                            types.FunctionResponse(
                                                name=fc.name,
                                                id=fc.id,
                                                response=result,
                                            )
                                        ]
                                    )
                                )

                                # Notify browser with result
                                await websocket.send_text(
                                    json.dumps(
                                        {
                                            "type": "tool_result",
                                            "tool": fc.name,
                                            "result": result,
                                        }
                                    )
                                )

                except WebSocketDisconnect:
                    logger.info(f"Browser WS closed (send): driver={driver_id}")
                except Exception as e:
                    logger.error(f"send_to_browser error: {e}")
                    try:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": str(e)})
                        )
                    except Exception:
                        pass

            await asyncio.gather(
                receive_from_browser(),
                send_to_browser(),
                return_exceptions=True,
            )

    except WebSocketDisconnect:
        logger.info(f"WS disconnected: driver={driver_id}")
    except Exception as e:
        logger.error(f"Voice WS error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
