"""Shared mutable state — imported by both main.py and tools.py to avoid __main__ vs main split."""

import json

LOADS: list = []
MESSAGES: list = []
dispatcher_connections: set = set()


async def broadcast(message: dict):
    dead = set()
    for ws in dispatcher_connections:
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            dead.add(ws)
    dispatcher_connections.difference_update(dead)
