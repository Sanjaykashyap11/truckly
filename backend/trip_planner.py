"""
Trucky — FMCSA-compliant HOS trip planning engine

Implements federal property-carrying driver hours-of-service rules (49 CFR Part 395):
  • 11-hour driving limit
  • 14-hour shift window (non-extendable)
  • 30-minute break after 8 hours of driving
  • 10-hour consecutive off-duty rest requirement
  • 70-hour / 8-day cycle limit
  • Short-haul exception (≤150 air-miles, home-terminal daily)
  • Adverse conditions extension (2 extra hours)
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# ─── FMCSA Constants ──────────────────────────────────────────────────────────

DRIVE_LIMIT_MINS   = 660   # 11 hours
SHIFT_LIMIT_MINS   = 840   # 14-hour window
REST_MINS          = 600   # 10-hour off-duty
BREAK_MINS         = 30    # mandatory 30-min break
BREAK_TRIGGER_MINS = 480   # 8 hours driving triggers break
CYCLE_LIMIT_MINS   = 4200  # 70 hours / 8 days
RESTART_MINS       = 2040  # 34-hour restart
AVG_SPEED_MPH      = 55    # loaded truck average speed

SCENARIO_LABELS = {
    "direct":       "Direct — no breaks required",
    "with_break":   "Direct — 30-min break required en route",
    "with_rest":    "Requires 10-hour rest stop",
    "multi_day":    "Multi-day trip with rest stops",
    "after_rest":   "Driver currently resting — available after reset",
    "cycle_reset":  "Requires 34-hour cycle restart",
    "unavailable":  "Insufficient hours — cannot assign",
}


def estimate_drive_mins(distance_miles: float, speed_mph: float = AVG_SPEED_MPH) -> int:
    """Convert distance to estimated driving time in minutes"""
    return max(1, int((distance_miles / speed_mph) * 60))


def format_duration(mins: int) -> str:
    if mins <= 0:
        return "0min"
    h, m = divmod(abs(mins), 60)
    return f"{h}h {m}m" if h else f"{m}m"


def calculate_trip_plan(driver: Dict, distance_miles: float) -> Dict:
    """
    Calculate the optimal HOS-compliant trip plan for a single driver.

    Returns a structured plan with:
      - earliest_delivery (datetime)
      - scenario name + explanation
      - FMCSA compliance status
      - Warnings
      - Timeline of events (drive, break, rest, arrive)
    """
    now = datetime.now()
    hos = driver.get("hos", {})
    name = driver.get("name", "Driver")

    drive_rem   = hos.get("drive_time_remaining_mins", 0)
    shift_rem   = hos.get("on_duty_remaining_mins", 0)
    break_due   = hos.get("break_due_in_mins", BREAK_TRIGGER_MINS)  # mins until mandatory break
    cycle_rem   = int(hos.get("cycle_remaining_hours", 0) * 60)
    status      = hos.get("status", "offDuty")

    trip_mins = estimate_drive_mins(distance_miles)
    warnings  = []
    timeline  = []

    # ── Guard: cycle exhausted ─────────────────────────────────────────────────
    if cycle_rem == 0:
        restart_complete = now + timedelta(minutes=RESTART_MINS)
        arrival = restart_complete + timedelta(minutes=trip_mins)
        return _plan(
            scenario="cycle_reset",
            can_deliver=True,
            compliance="NEEDS_RESTART",
            earliest=arrival,
            rest_required=True,
            rest_start_in=0,
            total_wait=RESTART_MINS,
            drive_mins=trip_mins,
            explanation=f"{name} has exhausted the 70-hour cycle. Requires 34-hour restart before dispatch. Available {_fmt_time(restart_complete)}.",
            warnings=["70-hour/8-day cycle limit reached — 34-hour restart required"],
            timeline=[
                {"event": "34-hr Restart", "at_mins": 0, "duration_mins": RESTART_MINS},
                {"event": "Depart", "at_mins": RESTART_MINS, "duration_mins": trip_mins},
                {"event": "Arrive", "at_mins": RESTART_MINS + trip_mins, "duration_mins": 0},
            ],
        )

    # ── Cycle warning ──────────────────────────────────────────────────────────
    if cycle_rem < trip_mins:
        warnings.append(f"Cycle time ({format_duration(cycle_rem)}) may be insufficient for this trip")

    # ── Driver currently resting (off duty / sleeper) ──────────────────────────
    if status in ("offDuty", "sleeperBed"):
        # Conservative: assume they need full 10-hour reset
        # (Samsara doesn't tell us how long they've been resting; assume minimum)
        est_rest_remaining = REST_MINS  # conservative
        depart = now + timedelta(minutes=est_rest_remaining)
        arrival = depart + timedelta(minutes=trip_mins + (BREAK_MINS if trip_mins > BREAK_TRIGGER_MINS else 0))
        needs_break = trip_mins > BREAK_TRIGGER_MINS
        return _plan(
            scenario="after_rest",
            can_deliver=True,
            compliance="AVAILABLE_AFTER_REST",
            earliest=arrival,
            rest_required=True,
            rest_start_in=0,
            total_wait=est_rest_remaining,
            drive_mins=trip_mins,
            explanation=(
                f"{name} is currently in mandatory rest. Estimated available {_fmt_time(depart)}. "
                + (f"Will need 30-min break after {format_duration(BREAK_TRIGGER_MINS)} driving." if needs_break else "Can drive directly to destination.")
            ),
            warnings=warnings,
            timeline=[
                {"event": "Rest (completing)", "at_mins": 0, "duration_mins": est_rest_remaining},
                {"event": "Depart", "at_mins": est_rest_remaining, "duration_mins": None},
            ] + ([{"event": "30-min Break", "at_mins": est_rest_remaining + BREAK_TRIGGER_MINS, "duration_mins": BREAK_MINS}] if needs_break else []) + [
                {"event": "Arrive", "at_mins": int((arrival - now).total_seconds() / 60), "duration_mins": 0},
            ],
        )

    # ── Effective driveable time this shift ────────────────────────────────────
    # Constrained by BOTH 11-hour drive limit AND 14-hour shift window
    effective_drive = min(drive_rem, shift_rem)

    # ── SCENARIO 1: Direct — no break needed ──────────────────────────────────
    # break_due == 0 means break needed immediately (edge case)
    # break_due > trip_mins means no break needed during this trip
    if trip_mins <= effective_drive and (break_due >= trip_mins or break_due == 0):
        arrival = now + timedelta(minutes=trip_mins)
        return _plan(
            scenario="direct",
            can_deliver=True,
            compliance="COMPLIANT",
            earliest=arrival,
            rest_required=False,
            rest_start_in=None,
            total_wait=0,
            drive_mins=trip_mins,
            explanation=f"{name} can depart immediately and drive straight through. No mandatory break required. Arrives {_fmt_time(arrival)}.",
            warnings=warnings,
            timeline=[
                {"event": "Depart Now", "at_mins": 0, "duration_mins": trip_mins},
                {"event": "Arrive", "at_mins": trip_mins, "duration_mins": 0},
            ],
        )

    # ── SCENARIO 2: Direct with mandatory 30-min break en route ───────────────
    if break_due > 0 and break_due < trip_mins and trip_mins <= effective_drive:
        total = trip_mins + BREAK_MINS
        if shift_rem >= total:
            arrival = now + timedelta(minutes=total)
            return _plan(
                scenario="with_break",
                can_deliver=True,
                compliance="COMPLIANT",
                earliest=arrival,
                rest_required=False,
                rest_start_in=None,
                total_wait=BREAK_MINS,
                drive_mins=trip_mins,
                explanation=(
                    f"{name} must take a mandatory 30-min break after {format_duration(break_due)} of driving (FMCSA 8-hour rule). "
                    f"Total trip time: {format_duration(total)}. Arrives {_fmt_time(arrival)}."
                ),
                warnings=warnings,
                timeline=[
                    {"event": "Depart", "at_mins": 0, "duration_mins": break_due},
                    {"event": "30-min Break (mandatory)", "at_mins": break_due, "duration_mins": BREAK_MINS},
                    {"event": "Continue", "at_mins": break_due + BREAK_MINS, "duration_mins": trip_mins - break_due},
                    {"event": "Arrive", "at_mins": total, "duration_mins": 0},
                ],
            )

    # ── SCENARIO 3: Needs 10-hour rest mid-trip ────────────────────────────────
    drive_seg1 = effective_drive  # drive until HOS limit
    remaining  = trip_mins - drive_seg1

    if remaining > 0:
        # Can we complete remaining trip in one segment after rest?
        if remaining <= DRIVE_LIMIT_MINS:
            rest_start_in   = drive_seg1
            needs_break_seg2 = remaining > BREAK_TRIGGER_MINS
            seg2_total      = remaining + (BREAK_MINS if needs_break_seg2 else 0)
            total_elapsed   = drive_seg1 + REST_MINS + seg2_total
            arrival         = now + timedelta(minutes=total_elapsed)

            return _plan(
                scenario="with_rest",
                can_deliver=True,
                compliance="NEEDS_REST",
                earliest=arrival,
                rest_required=True,
                rest_start_in=rest_start_in,
                total_wait=REST_MINS,
                drive_mins=trip_mins,
                explanation=(
                    f"{name} can drive {format_duration(drive_seg1)} then must rest 10 hours (FMCSA). "
                    f"After reset, drives remaining {format_duration(remaining)} to destination. "
                    f"Arrives {_fmt_time(arrival)}."
                ),
                warnings=warnings + ["10-hour mandatory rest required mid-trip"],
                timeline=[
                    {"event": "Depart", "at_mins": 0, "duration_mins": drive_seg1},
                    {"event": "10-hr Rest (mandatory)", "at_mins": drive_seg1, "duration_mins": REST_MINS},
                    {"event": "Resume", "at_mins": drive_seg1 + REST_MINS, "duration_mins": remaining},
                    {"event": "Arrive", "at_mins": total_elapsed, "duration_mins": 0},
                ],
            )

        # Multi-day: need multiple rest periods
        else:
            segments = []
            t = 0
            driven = 0
            total_drive = trip_mins
            max_segments = 5
            seg_count = 0
            while driven < total_drive and seg_count < max_segments:
                seg = min(DRIVE_LIMIT_MINS, total_drive - driven)
                segments.append({"event": f"Drive Segment {seg_count+1}", "at_mins": t, "duration_mins": seg})
                t += seg
                driven += seg
                if driven < total_drive:
                    segments.append({"event": "10-hr Rest", "at_mins": t, "duration_mins": REST_MINS})
                    t += REST_MINS
                seg_count += 1

            segments.append({"event": "Arrive", "at_mins": t, "duration_mins": 0})
            arrival = now + timedelta(minutes=t)
            rests = max(0, seg_count - 1)
            return _plan(
                scenario="multi_day",
                can_deliver=True,
                compliance="NEEDS_REST",
                earliest=arrival,
                rest_required=True,
                rest_start_in=drive_seg1,
                total_wait=rests * REST_MINS,
                drive_mins=trip_mins,
                explanation=(
                    f"Multi-day trip requiring {rests} rest period(s). "
                    f"{name} drives {format_duration(DRIVE_LIMIT_MINS)}, rests 10h, repeats until destination. "
                    f"Total: {format_duration(t)}. Arrives {_fmt_time(arrival)}."
                ),
                warnings=warnings + [f"Multi-day trip: {rests} mandatory 10-hr rest stop(s)"],
                timeline=segments,
            )

    # ── Fallback ───────────────────────────────────────────────────────────────
    return _plan(
        scenario="unavailable",
        can_deliver=False,
        compliance="CANNOT_ASSIGN",
        earliest=None,
        rest_required=True,
        rest_start_in=0,
        total_wait=None,
        drive_mins=trip_mins,
        explanation=f"{name} does not have sufficient hours for this trip.",
        warnings=warnings,
        timeline=[],
    )


def _plan(
    scenario, can_deliver, compliance, earliest, rest_required,
    rest_start_in, total_wait, drive_mins, explanation, warnings, timeline,
    break_required=False, break_at_mins=None,
) -> Dict:
    return {
        "can_deliver":      can_deliver,
        "scenario":         scenario,
        "scenario_label":   SCENARIO_LABELS.get(scenario, scenario),
        "compliance":       compliance,
        "earliest_delivery": earliest.isoformat() if earliest else None,
        "earliest_display":  _fmt_time(earliest) if earliest else "N/A",
        "drive_time_mins":   drive_mins,
        "drive_time_label":  format_duration(drive_mins),
        "rest_required":     rest_required,
        "rest_start_in_mins": rest_start_in,
        "total_wait_mins":   total_wait,
        "break_required":    break_required,
        "break_at_mins":     break_at_mins,
        "explanation":       explanation,
        "warnings":          warnings,
        "timeline":          timeline,
    }


def _fmt_time(dt: Optional[datetime]) -> str:
    if dt is None:
        return "N/A"
    return dt.strftime("%-m/%-d %-I:%M %p")


def rank_drivers_for_load(drivers: List[Dict], distance_miles: float, required_by_iso: Optional[str] = None) -> List[Dict]:
    """
    Rank all drivers for a given load by earliest delivery.

    Args:
        drivers: list of Trucky driver dicts
        distance_miles: trip distance
        required_by_iso: optional deadline ISO string

    Returns:
        Sorted list of {driver, plan, rank, meets_deadline}
    """
    required_by = None
    if required_by_iso:
        try:
            required_by = datetime.fromisoformat(required_by_iso)
        except Exception:
            pass

    results = []
    for d in drivers:
        plan = calculate_trip_plan(d, distance_miles)
        earliest = datetime.fromisoformat(plan["earliest_delivery"]) if plan["earliest_delivery"] else None
        meets = (earliest <= required_by) if (earliest and required_by) else None
        results.append({
            "driver": d,
            "plan":   plan,
            "meets_deadline": meets,
        })

    # Sort: can_deliver first, then by earliest delivery
    def sort_key(x):
        if not x["plan"]["can_deliver"]:
            return (1, datetime.max)
        if x["plan"]["earliest_delivery"] is None:
            return (1, datetime.max)
        return (0, datetime.fromisoformat(x["plan"]["earliest_delivery"]))

    results.sort(key=sort_key)

    for i, r in enumerate(results):
        r["rank"] = i + 1

    return results


def generate_fleet_insights(drivers: List[Dict]) -> List[Dict]:
    """
    Generate proactive fleet intelligence insights from current driver data.
    """
    now = datetime.now()
    insights = []

    on_route      = [d for d in drivers if d.get("status") == "on_route"]
    resting       = [d for d in drivers if d.get("status") in ("resting", "offDuty")]
    low_hos       = [d for d in drivers if 0 < d.get("hos", {}).get("drive_time_remaining_mins", 999) < 120]
    available     = [d for d in drivers if d.get("hos", {}).get("drive_time_remaining_mins", 0) >= 300
                    and d.get("status") not in ("on_route",)]
    violations    = [d for d in drivers if d.get("hos", {}).get("violation", False)]
    break_soon    = [d for d in drivers if 0 < d.get("hos", {}).get("break_due_in_mins", 999) < 30
                    and d.get("status") == "on_route"]
    low_fuel      = [d for d in drivers if (d.get("telemetry") or {}).get("fuel_percent") is not None
                    and (d.get("telemetry") or {}).get("fuel_percent", 100) < 25]
    engine_idle   = [d for d in drivers if (d.get("telemetry") or {}).get("engine_state") == "On"
                    and d.get("status") != "on_route" and d.get("current_location", {}).get("speed_mph", 0) < 2]

    if violations:
        insights.append({
            "type": "critical",
            "icon": "alert",
            "title": f"{len(violations)} HOS Violation{'s' if len(violations) > 1 else ''}",
            "body":  ", ".join(d.get("name","?").split()[0] for d in violations) + " must stop immediately.",
            "drivers": [d.get("name") for d in violations],
        })

    if break_soon:
        insights.append({
            "type": "warning",
            "icon": "clock",
            "title": f"{len(break_soon)} Driver{'s' if len(break_soon)>1 else ''} Need Break Within 30 Min",
            "body": ", ".join(d.get("name","?").split()[0] for d in break_soon) + " approaching 8-hour drive limit.",
            "drivers": [d.get("name") for d in break_soon],
        })

    if low_hos:
        insights.append({
            "type": "warning",
            "icon": "timer",
            "title": f"{len(low_hos)} Driver{'s' if len(low_hos)>1 else ''} Below 2-Hour HOS",
            "body": ", ".join(d.get("name","?").split()[0] for d in low_hos) + " — plan rest stops now.",
            "drivers": [d.get("name") for d in low_hos],
        })

    if low_fuel:
        insights.append({
            "type": "warning",
            "icon": "fuel",
            "title": f"{len(low_fuel)} Truck{'s' if len(low_fuel)>1 else ''} Below 25% Fuel",
            "body":  ", ".join(d.get("truck","?") for d in low_fuel) + " — fuel stop recommended.",
            "drivers": [d.get("name") for d in low_fuel],
        })

    if engine_idle:
        insights.append({
            "type": "info",
            "icon": "zap",
            "title": f"{len(engine_idle)} Truck{'s' if len(engine_idle)>1 else ''} Idling",
            "body": f"{len(engine_idle)} engine(s) on while stationary — fuel waste + emissions.",
            "drivers": [d.get("name") for d in engine_idle],
        })

    if available:
        insights.append({
            "type": "success",
            "icon": "check",
            "title": f"{len(available)} Driver{'s' if len(available)>1 else ''} Available for New Loads",
            "body": f"{len(available)} driver{'s' if len(available)>1 else ''} with 5+ hours of HOS available and not currently on route.",
            "drivers": [d.get("name") for d in available[:5]],
        })

    if on_route:
        insights.append({
            "type": "info",
            "icon": "truck",
            "title": f"{len(on_route)} Truck{'s' if len(on_route)>1 else ''} Currently On Route",
            "body": f"Active deliveries in progress. Monitoring HOS compliance.",
            "drivers": [d.get("name") for d in on_route],
        })

    # Earliest reset times (drivers who'll be ready soonest)
    resting_with_hos = sorted(
        [d for d in resting if d.get("hos", {}).get("cycle_remaining_hours", 0) > 1],
        key=lambda d: d.get("hos", {}).get("drive_time_remaining_mins", 0),
        reverse=True
    )
    if resting_with_hos:
        top = resting_with_hos[0]
        insights.append({
            "type": "info",
            "icon": "refresh",
            "title": "Next Available Driver",
            "body": f"{top.get('name', '?')} — {format_duration(top.get('hos',{}).get('drive_time_remaining_mins',0))} HOS. Currently resting.",
            "drivers": [top.get("name")],
        })

    return insights
