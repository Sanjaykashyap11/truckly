"""Samsara ELD API Integration for Trucky
Real-time driver HOS, vehicle locations, engine state, fuel, and odometer data."""

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

SAMSARA_BASE_URL = "https://api.samsara.com"
CACHE_TTL_SECONDS = 30


class SamsaraClient:
    """Async Samsara ELD API client with caching and graceful degradation"""

    TANK_CAPACITY_GAL = 200  # standard semi (2x 100-gal tanks)
    REFILL_THRESHOLD_PCT = 5  # minimum % rise to count as refill
    DIESEL_PRICE_GAL = 3.92  # estimated national average

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }
        self._cache: Dict[str, Any] = {}
        self._cache_ts: Dict[str, float] = {}
        self._prev_fuel: Dict[str, float] = {}   # vehicle_id -> last known fuel %
        self._refill_log: List[Dict] = []        # detected refill events (real-time)
        self._history_loaded: bool = False        # whether 7-day history has been fetched

    def _detect_refill(self, vehicle_id: str, truck_name: str, new_pct: float, gps: Dict):
        prev = self._prev_fuel.get(vehicle_id)
        if prev is not None and new_pct > prev + self.REFILL_THRESHOLD_PCT:
            gallons = round((new_pct - prev) / 100 * self.TANK_CAPACITY_GAL, 1)
            cost = round(gallons * self.DIESEL_PRICE_GAL, 2)
            event = {
                "vehicle_id":    vehicle_id,
                "truck":         truck_name,
                "timestamp":     datetime.now(timezone.utc).isoformat(),
                "prev_pct":      round(prev, 1),
                "new_pct":       round(new_pct, 1),
                "gallons_added": gallons,
                "est_cost":      cost,
                "location":      gps.get("reverseGeo", {}).get("formattedLocation", "Unknown"),
                "lat":           gps.get("latitude", 0),
                "lng":           gps.get("longitude", 0),
            }
            self._refill_log.append(event)
            logger.info(f"Fuel refill: {truck_name} +{gallons} gal (${cost}) at {event['location']}")
        self._prev_fuel[vehicle_id] = new_pct

    def get_refill_events(self) -> List[Dict]:
        return list(reversed(self._refill_log))

    async def load_fuel_history(self, days: int = 7) -> None:
        """Backfill refill events from the past N days using Samsara stats history.
        Called once at startup so the dashboard shows historical refills immediately.
        """
        if self._history_loaded:
            return
        self._history_loaded = True  # set early so concurrent calls don't double-fetch

        end_time   = datetime.now(timezone.utc)
        start_time = end_time - timedelta(days=days)

        # First get vehicle list so we know names
        vehicles_data = await self._get("/fleet/vehicles", params={"limit": 512})
        vehicles: List[Dict] = (vehicles_data or {}).get("data", [])
        name_by_id: Dict[str, str] = {v["id"]: v.get("name", "Unknown") for v in vehicles}
        logger.info(f"Fuel history: {len(vehicles)} vehicles found")

        # Fetch full fuel percent history (paginated)
        params: Dict = {
            "types":     "fuelPercents",
            "startTime": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime":   end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit":     512,
        }
        all_vehicle_series: Dict[str, List[Dict]] = {}  # vehicle_id -> sorted readings
        page_count = 0

        while True:
            page = await self._get("/fleet/vehicles/stats/history", params=params, timeout=30.0)
            if not page:
                logger.warning("Fuel history: stats/history returned no data")
                break
            page_count += 1
            for v in page.get("data", []):
                vid = v.get("id", "")
                readings = v.get("fuelPercents", [])
                if vid not in all_vehicle_series:
                    all_vehicle_series[vid] = []
                all_vehicle_series[vid].extend(readings)
            cursor = page.get("pagination", {}).get("endCursor")
            has_next = page.get("pagination", {}).get("hasNextPage", False)
            logger.info(f"Fuel history page {page_count}: {len(page.get('data', []))} vehicles, hasNext={has_next}")
            if not has_next or not cursor:
                break
            params["after"] = cursor

        logger.info(f"Fuel history: {len(all_vehicle_series)} vehicles with fuel readings")

        # Walk each vehicle's time-series and group consecutive rising readings
        # within a 2-hour window into a single fill event (avoids sensor-noise duplicates).
        # Only emit an event when total gallons added >= MIN_FILL_GALLONS.
        MIN_FILL_GALLONS = 30   # ignore sensor jitter / tiny top-offs
        FILL_GAP_SECS    = 7200  # 2-hour gap = new separate fill session

        new_events: List[Dict] = []
        for vid, readings in all_vehicle_series.items():
            readings.sort(key=lambda r: r.get("time", ""))
            truck_name = name_by_id.get(vid, vid)

            # State for current fill session
            session_start_pct: Optional[float] = None
            session_start_time: Optional[str]  = None
            session_end_pct: Optional[float]   = None
            prev_pct: Optional[float] = None
            prev_time: Optional[str]  = None

            def _flush_session():
                if session_start_pct is None or session_end_pct is None:
                    return
                gallons = round((session_end_pct - session_start_pct) / 100 * self.TANK_CAPACITY_GAL, 1)
                if gallons >= MIN_FILL_GALLONS:
                    cost = round(gallons * self.DIESEL_PRICE_GAL, 2)
                    new_events.append({
                        "vehicle_id":    vid,
                        "truck":         truck_name,
                        "timestamp":     session_start_time or end_time.isoformat(),
                        "prev_pct":      round(session_start_pct, 1),
                        "new_pct":       round(session_end_pct, 1),
                        "gallons_added": gallons,
                        "est_cost":      cost,
                        "location":      "See GPS history",
                        "lat":           0,
                        "lng":           0,
                    })
                    logger.info(f"[History] Refill: {truck_name} +{gallons} gal on {(session_start_time or '')[:10]}")

            for reading in readings:
                pct_val = reading.get("value")
                ts      = reading.get("time", "")
                if pct_val is None:
                    continue
                new_pct = float(pct_val)

                # Check if this is a rising reading (fuel going up)
                if prev_pct is not None and new_pct > prev_pct + self.REFILL_THRESHOLD_PCT:
                    # Calculate gap from previous reading
                    gap_secs = 0
                    if prev_time and ts:
                        try:
                            from datetime import datetime as _dt
                            t1 = _dt.fromisoformat(prev_time.replace("Z", "+00:00"))
                            t2 = _dt.fromisoformat(ts.replace("Z", "+00:00"))
                            gap_secs = (t2 - t1).total_seconds()
                        except Exception:
                            gap_secs = 0

                    if session_start_pct is None:
                        # Start a new fill session
                        session_start_pct  = prev_pct
                        session_start_time = prev_time or ts
                        session_end_pct    = new_pct
                    elif gap_secs > FILL_GAP_SECS:
                        # Gap too large — flush current session, start a new one
                        _flush_session()
                        session_start_pct  = prev_pct
                        session_start_time = prev_time or ts
                        session_end_pct    = new_pct
                    else:
                        # Continue extending the current fill session
                        session_end_pct = new_pct
                else:
                    # Fuel dropped or stayed same — flush any open session
                    if session_start_pct is not None:
                        _flush_session()
                        session_start_pct  = None
                        session_start_time = None
                        session_end_pct    = None

                prev_pct  = new_pct
                prev_time = ts

            # Flush any session still open at end of series
            if session_start_pct is not None:
                _flush_session()

        # Merge with any real-time events already in the log, deduplicate by timestamp+vehicle
        existing_keys = {(e["vehicle_id"], e["timestamp"]) for e in self._refill_log}
        for ev in new_events:
            if (ev["vehicle_id"], ev["timestamp"]) not in existing_keys:
                self._refill_log.append(ev)

        self._refill_log.sort(key=lambda e: e["timestamp"], reverse=True)
        logger.info(f"Fuel history loaded: {len(new_events)} refill events across {days} days")

    def _fresh(self, key: str) -> bool:
        return (time.time() - self._cache_ts.get(key, 0)) < CACHE_TTL_SECONDS

    def _set(self, key: str, value: Any):
        self._cache[key] = value
        self._cache_ts[key] = time.time()

    async def _get(self, endpoint: str, params: Optional[Dict] = None, timeout: float = 10.0) -> Optional[Dict]:
        url = f"{SAMSARA_BASE_URL}{endpoint}"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers=self.headers, params=params or {})
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"Samsara {e.response.status_code} at {endpoint}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Samsara request error ({endpoint}): {type(e).__name__}: {e}")
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
                # Track fuel refill events
                if tel and tel.get("fuel_percent") is not None:
                    truck_name = clock.get("currentVehicle", {}).get("name", "Unknown")
                    self._detect_refill(vehicle_id, truck_name, tel["fuel_percent"], gps)
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
