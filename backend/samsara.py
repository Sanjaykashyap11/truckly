"""Samsara ELD API Integration for Trucky
Real-time driver HOS, vehicle locations, and fleet data."""

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

SAMSARA_BASE_URL = "https://api.samsara.com"
CACHE_TTL_SECONDS = 30


class SamsaraClient:
    """Async Samsara ELD API client with caching and graceful degradation"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }
        self._cache: Dict[str, Any] = {}
        self._cache_ts: Dict[str, float] = {}

    def _fresh(self, key: str) -> bool:
        return (time.time() - self._cache_ts.get(key, 0)) < CACHE_TTL_SECONDS

    def _set(self, key: str, value: Any):
        self._cache[key] = value
        self._cache_ts[key] = time.time()

    async def _get(self, endpoint: str, params: Optional[Dict] = None) -> Optional[Dict]:
        url = f"{SAMSARA_BASE_URL}{endpoint}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=self.headers, params=params or {})
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"Samsara {e.response.status_code} at {endpoint}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Samsara request error ({endpoint}): {e}")
            return None

    async def get_hos_clocks(self) -> List[Dict]:
        """Real-time HOS clocks for all drivers — includes vehicle assignment"""
        if self._fresh("clocks"):
            return self._cache.get("clocks", [])
        data = await self._get("/fleet/hos/clocks")
        result = data.get("data", []) if data else []
        self._set("clocks", result)
        logger.info(f"Samsara: fetched {len(result)} driver HOS clocks")
        return result

    async def get_vehicle_locations(self) -> List[Dict]:
        """Real-time GPS for all vehicles"""
        if self._fresh("locations"):
            return self._cache.get("locations", [])
        data = await self._get("/fleet/vehicles/stats", params={"types": "gps"})
        result = data.get("data", []) if data else []
        self._set("locations", result)
        return result

    async def get_fleet_snapshot(self) -> Dict:
        """Fetch full fleet state concurrently using HOS clocks + GPS"""
        try:
            clocks, locations = await asyncio.gather(
                self.get_hos_clocks(),
                self.get_vehicle_locations(),
                return_exceptions=True,
            )
            clocks    = clocks    if isinstance(clocks, list)    else []
            locations = locations if isinstance(locations, list) else []

            gps_by_vehicle_id = {loc["id"]: loc.get("gps", {}) for loc in locations}

            normalized = []
            for clock in clocks:
                gps = gps_by_vehicle_id.get(
                    clock.get("currentVehicle", {}).get("id", ""), {}
                )
                normalized.append(normalize_clock(clock, gps))

            return {
                "drivers": normalized,
                "violations": [],  # derived from clock.violations below
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "samsara_live",
            }
        except Exception as e:
            logger.error(f"Fleet snapshot error: {e}")
            return {
                "drivers": [],
                "violations": [],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "error",
            }


def normalize_clock(clock: Dict, gps: Dict) -> Dict:
    """Convert Samsara HOS clock + GPS → Trucky internal driver format"""
    driver_info  = clock.get("driver", {})
    vehicle_info = clock.get("currentVehicle", {})
    duty_status  = clock.get("currentDutyStatus", {})
    clocks       = clock.get("clocks", {})
    violations   = clock.get("violations", {})

    samsara_status = duty_status.get("hosStatusType", "offDuty")

    drive_remaining_ms  = clocks.get("drive", {}).get("driveRemainingDurationMs", 0)
    shift_remaining_ms  = clocks.get("shift", {}).get("shiftRemainingDurationMs", 0)
    cycle_remaining_ms  = clocks.get("cycle", {}).get("cycleRemainingDurationMs", 0)
    break_until_ms      = clocks.get("break", {}).get("timeUntilBreakDurationMs", 0)

    drive_remaining_mins  = max(0, drive_remaining_ms  // 60000)
    shift_remaining_mins  = max(0, shift_remaining_ms  // 60000)
    cycle_remaining_hrs   = round(cycle_remaining_ms   / 3600000, 1)
    break_due_mins        = max(0, break_until_ms // 60000)

    has_violation = (
        violations.get("shiftDrivingViolationDurationMs", 0) > 0
        or violations.get("cycleViolationDurationMs", 0) > 0
    )

    status_map = {
        "driving":            "on_route",
        "onDuty":             "loading",
        "offDuty":            "resting",
        "sleeperBed":         "resting",
        "yardMove":           "loading",
        "personalConveyance": "on_route",
    }

    truck_name = vehicle_info.get("name", "Unassigned")

    return {
        "id": driver_info.get("id", ""),
        "samsara_id": driver_info.get("id", ""),
        "name": driver_info.get("name", "Unknown Driver"),
        "truck": truck_name,
        "truck_height": "13'6\"",
        "truck_weight": "80,000 lbs",
        "license_plate": "",
        "status": status_map.get(samsara_status, "resting"),
        "current_location": {
            "lat": gps.get("latitude", 0.0),
            "lng": gps.get("longitude", 0.0),
            "address": gps.get("reverseGeo", {}).get("formattedLocation", "Location unavailable"),
            "speed_mph": round(gps.get("speedMilesPerHour", 0), 1),
            "heading": gps.get("headingDegrees", 0),
            "gps_time": gps.get("time", ""),
        },
        "hos": {
            "drive_time_remaining_mins": drive_remaining_mins,
            "on_duty_remaining_mins": shift_remaining_mins,
            "cycle_remaining_hours": cycle_remaining_hrs,
            "status": samsara_status,
            "break_due_in_mins": break_due_mins,
            "violation": has_violation,
        },
        "source": "samsara_live",
    }


# ─── Singleton ────────────────────────────────────────────────────────────────

_client: Optional[SamsaraClient] = None


def get_client() -> Optional[SamsaraClient]:
    global _client
    if _client is None:
        api_key = os.getenv("SAMSARA_API_KEY", "")
        if api_key:
            _client = SamsaraClient(api_key)
            logger.info("Samsara ELD client initialized")
        else:
            logger.warning("SAMSARA_API_KEY not set — running in demo mode")
    return _client
