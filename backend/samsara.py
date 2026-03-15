"""Samsara ELD API Integration for Trucky
Real-time driver HOS, vehicle locations, engine state, fuel, and odometer data."""

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
        """Real-time HOS clocks — driver + vehicle + all time remaining"""
        if self._fresh("clocks"):
            return self._cache.get("clocks", [])
        data = await self._get("/fleet/hos/clocks")
        result = data.get("data", []) if data else []
        self._set("clocks", result)
        logger.info(f"Samsara: {len(result)} driver HOS clocks loaded")
        return result

    async def get_vehicle_locations(self) -> List[Dict]:
        """Real-time GPS for all vehicles"""
        if self._fresh("gps"):
            return self._cache.get("gps", [])
        data = await self._get("/fleet/vehicles/stats", params={"types": "gps"})
        result = data.get("data", []) if data else []
        self._set("gps", result)
        return result

    async def get_vehicle_telemetry(self) -> List[Dict]:
        """Vehicle telemetry: engine state, fuel %, odometer"""
        if self._fresh("telemetry"):
            return self._cache.get("telemetry", [])
        data = await self._get(
            "/fleet/vehicles/stats",
            params={"types": "engineStates,fuelPercents,obdOdometerMeters"},
        )
        result = data.get("data", []) if data else []
        self._set("telemetry", result)
        return result

    async def get_fleet_snapshot(self) -> Dict:
        """Fetch complete fleet state concurrently — HOS + GPS + Telemetry"""
        try:
            clocks, locations, telemetry = await asyncio.gather(
                self.get_hos_clocks(),
                self.get_vehicle_locations(),
                self.get_vehicle_telemetry(),
                return_exceptions=True,
            )
            clocks    = clocks    if isinstance(clocks, list)    else []
            locations = locations if isinstance(locations, list) else []
            telemetry = telemetry if isinstance(telemetry, list) else []

            gps_by_vid  = {v["id"]: v.get("gps", {}) for v in locations}
            tel_by_vid  = {v["id"]: _extract_telemetry(v) for v in telemetry}

            normalized = []
            for clock in clocks:
                vehicle_id = clock.get("currentVehicle", {}).get("id", "")
                gps = gps_by_vid.get(vehicle_id, {})
                tel = tel_by_vid.get(vehicle_id)
                normalized.append(normalize_clock(clock, gps, tel))

            logger.info(f"Samsara fleet snapshot: {len(normalized)} drivers")
            return {
                "drivers": normalized,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "samsara_live",
            }
        except Exception as e:
            logger.error(f"Fleet snapshot error: {e}")
            return {
                "drivers": [],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "error",
            }


def _extract_telemetry(vehicle: Dict) -> Dict:
    """Extract engine/fuel/odometer from vehicle stats response"""
    fuel_obj  = vehicle.get("fuelPercent")
    eng_obj   = vehicle.get("engineState")
    odo_obj   = vehicle.get("obdOdometerMeters")
    return {
        "fuel_percent":    fuel_obj["value"] if fuel_obj else None,
        "engine_state":    eng_obj["value"] if eng_obj else "Unknown",
        "odometer_miles":  round(odo_obj["value"] / 1609.34) if odo_obj else None,
        "fuel_time":       fuel_obj.get("time") if fuel_obj else None,
        "engine_time":     eng_obj.get("time") if eng_obj else None,
    }


def normalize_clock(clock: Dict, gps: Dict, tel: Optional[Dict]) -> Dict:
    """Convert Samsara HOS clock + GPS + telemetry → Trucky internal format"""
    driver_info  = clock.get("driver", {})
    vehicle_info = clock.get("currentVehicle", {})
    duty_status  = clock.get("currentDutyStatus", {})
    clocks       = clock.get("clocks", {})
    violations   = clock.get("violations", {})

    samsara_status = duty_status.get("hosStatusType", "offDuty")

    drive_rem_ms  = clocks.get("drive",  {}).get("driveRemainingDurationMs",  0)
    shift_rem_ms  = clocks.get("shift",  {}).get("shiftRemainingDurationMs",  0)
    cycle_rem_ms  = clocks.get("cycle",  {}).get("cycleRemainingDurationMs",  0)
    break_due_ms  = clocks.get("break",  {}).get("timeUntilBreakDurationMs",  0)

    drive_rem_mins = max(0, drive_rem_ms  // 60000)
    shift_rem_mins = max(0, shift_rem_ms  // 60000)
    cycle_rem_hrs  = round(cycle_rem_ms  / 3600000, 1)
    break_due_mins = max(0, break_due_ms  // 60000)

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
        "id":            driver_info.get("id", ""),
        "samsara_id":    driver_info.get("id", ""),
        "name":          driver_info.get("name", "Unknown Driver"),
        "truck":         truck_name,
        "truck_height":  "13'6\"",
        "truck_weight":  "80,000 lbs",
        "license_plate": "",
        "status":        status_map.get(samsara_status, "resting"),
        "current_location": {
            "lat":      gps.get("latitude",  0.0),
            "lng":      gps.get("longitude", 0.0),
            "address":  gps.get("reverseGeo", {}).get("formattedLocation", "Location unavailable"),
            "speed_mph": round(gps.get("speedMilesPerHour", 0), 1),
            "heading":   gps.get("headingDegrees", 0),
            "gps_time":  gps.get("time", ""),
        },
        "hos": {
            "drive_time_remaining_mins": drive_rem_mins,
            "on_duty_remaining_mins":    shift_rem_mins,
            "cycle_remaining_hours":     cycle_rem_hrs,
            "status":                    samsara_status,
            "break_due_in_mins":         break_due_mins,
            "violation":                 has_violation,
        },
        "telemetry": tel,
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
