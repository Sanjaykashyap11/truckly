"""Trucky agent tool definitions and handlers for Gemini Live API
Driver tools + Dispatcher fleet tools powered by Samsara ELD data"""

import logging
from datetime import datetime
from typing import Any, Dict

from google.genai import types

logger = logging.getLogger(__name__)

# ─── Restricted parkways database (Northeast US) ─────────────────────────────

RESTRICTED_PARKWAYS = {
    "merritt parkway": {
        "max_clearance": "7'6\"",
        "ban": "trucks over 7'6\"",
        "alternative": "I-95 N",
        "time_diff": "adds 4 minutes",
    },
    "hutchinson river parkway": {
        "max_clearance": "7'6\"",
        "ban": "all commercial trucks",
        "alternative": "I-95 N or I-684",
        "time_diff": "adds 6 minutes",
    },
    "pelham parkway": {
        "max_clearance": "7'6\"",
        "ban": "trucks",
        "alternative": "I-278 E",
        "time_diff": "adds 4 minutes",
    },
    "taconic state parkway": {
        "max_clearance": "8'0\"",
        "ban": "all trucks",
        "alternative": "I-87 N (NYS Thruway)",
        "time_diff": "adds 10 minutes",
    },
    "garden state parkway": {
        "max_clearance": "varies",
        "ban": "vehicles over 45 feet",
        "alternative": "NJ Turnpike (I-95)",
        "time_diff": "adds 5 minutes",
    },
    "palisades interstate parkway": {
        "max_clearance": "8'6\"",
        "ban": "commercial trucks",
        "alternative": "I-287 or US-9W",
        "time_diff": "adds 8 minutes",
    },
    "saw mill river parkway": {
        "max_clearance": "7'6\"",
        "ban": "trucks",
        "alternative": "I-87 N",
        "time_diff": "adds 7 minutes",
    },
    "sprain brook parkway": {
        "max_clearance": "7'6\"",
        "ban": "trucks",
        "alternative": "I-87 N",
        "time_diff": "adds 5 minutes",
    },
    "bronx river parkway": {
        "max_clearance": "7'0\"",
        "ban": "all trucks",
        "alternative": "I-95 or I-87",
        "time_diff": "adds 8 minutes",
    },
}


# ─── Driver tools ─────────────────────────────────────────────────────────────


def get_tools() -> list:
    """Tool definitions for driver-facing Trucky sessions"""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="check_hos_status",
                    description=(
                        "Check real-time HOS (Hours of Service) status from Samsara ELD. "
                        "Call when driver asks about hours, breaks, or trip feasibility."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["current_status", "can_complete_trip", "next_break"],
                            ),
                            "destination": types.Schema(
                                type=types.Type.STRING,
                                description="Destination address for trip feasibility check",
                            ),
                        },
                        required=["query_type"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="check_route_safety",
                    description=(
                        "Validate if a road or parkway is legal and safe for this truck. "
                        "ALWAYS call when driver mentions a specific road, shortcut, or parkway."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "route_name": types.Schema(
                                type=types.Type.STRING,
                                description="Road, highway, or parkway name to check",
                            ),
                            "action": types.Schema(
                                type=types.Type.STRING,
                                enum=["check", "reroute"],
                            ),
                        },
                        required=["route_name", "action"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="find_fuel_stops",
                    description="Find cheapest diesel fuel stops on current route. Call when driver asks about fuel.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "miles_ahead": types.Schema(
                                type=types.Type.NUMBER,
                                description="Search radius in miles ahead (default 50)",
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="handle_breakdown",
                    description=(
                        "Handle vehicle breakdown or emergency. "
                        "IMMEDIATELY call this for any mechanical issue, blowout, accident, or emergency."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "issue_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["tire", "engine", "accident", "medical", "other"],
                            ),
                            "location_description": types.Schema(
                                type=types.Type.STRING,
                                description="Location: highway, exit number, mile marker",
                            ),
                        },
                        required=["issue_type", "location_description"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="notify_stakeholders",
                    description=(
                        "Send automatic notifications to dispatcher, shipper, and receiver. "
                        "Call proactively for any update affecting delivery."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "notification_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["delay", "route_change", "eta_update", "breakdown", "delivery_complete"],
                            ),
                            "message": types.Schema(type=types.Type.STRING),
                            "new_eta": types.Schema(type=types.Type.STRING),
                        },
                        required=["notification_type", "message"],
                    ),
                ),
            ]
        )
    ]


# ─── Dispatcher tools ─────────────────────────────────────────────────────────


def get_dispatcher_tools() -> list:
    """Tool definitions for dispatcher-facing Trucky sessions"""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="get_fleet_status",
                    description=(
                        "Get real-time status of the entire fleet from Samsara ELD. "
                        "Call this to answer any fleet-wide question — locations, HOS, violations."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "filter": types.Schema(
                                type=types.Type.STRING,
                                description="Optional filter: 'all', 'on_route', 'violations', 'low_hos'",
                                enum=["all", "on_route", "violations", "low_hos"],
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="get_driver_details",
                    description="Get detailed ELD data for a specific driver by name or ID.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "driver_name": types.Schema(
                                type=types.Type.STRING,
                                description="Driver's name (partial match supported)",
                            ),
                        },
                        required=["driver_name"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="check_hos_status",
                    description="Check HOS status for any driver in the fleet.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["current_status", "can_complete_trip", "next_break"],
                            ),
                            "driver_name": types.Schema(
                                type=types.Type.STRING,
                                description="Driver name to check (leave blank for all drivers)",
                            ),
                            "destination": types.Schema(type=types.Type.STRING),
                        },
                        required=["query_type"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="notify_stakeholders",
                    description="Send fleet-wide or driver-specific notifications.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "notification_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["delay", "route_change", "eta_update", "breakdown", "delivery_complete"],
                            ),
                            "message": types.Schema(type=types.Type.STRING),
                            "new_eta": types.Schema(type=types.Type.STRING),
                            "driver_name": types.Schema(type=types.Type.STRING),
                        },
                        required=["notification_type", "message"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="handle_breakdown",
                    description="Activate breakdown emergency protocol for a driver.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "issue_type": types.Schema(
                                type=types.Type.STRING,
                                enum=["tire", "engine", "accident", "medical", "other"],
                            ),
                            "location_description": types.Schema(type=types.Type.STRING),
                            "driver_name": types.Schema(type=types.Type.STRING),
                        },
                        required=["issue_type", "location_description"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="check_route_safety",
                    description="Validate route safety for any truck in the fleet.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "route_name": types.Schema(type=types.Type.STRING),
                            "action": types.Schema(
                                type=types.Type.STRING,
                                enum=["check", "reroute"],
                            ),
                        },
                        required=["route_name", "action"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="plan_delivery",
                    description=(
                        "Find the best driver and calculate FMCSA-compliant earliest delivery time for a load. "
                        "Call this when dispatcher asks who can make a delivery, when can a load be delivered, "
                        "or which driver to assign. Uses real Samsara HOS data."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "destination": types.Schema(
                                type=types.Type.STRING,
                                description="Destination city or address",
                            ),
                            "distance_miles": types.Schema(
                                type=types.Type.NUMBER,
                                description="Estimated driving distance in miles",
                            ),
                            "required_by": types.Schema(
                                type=types.Type.STRING,
                                description="Optional deadline in ISO format (e.g. 2026-03-15T17:00:00)",
                            ),
                        },
                        required=["destination", "distance_miles"],
                    ),
                ),
            ]
        )
    ]


# ─── Driver tool handlers ──────────────────────────────────────────────────────


async def handle_tool_call(tool_name: str, args: Dict[str, Any], driver_id: str) -> Dict[str, Any]:
    """Route driver tool calls to handlers"""
    from mock_data import MOCK_DRIVERS
    try:
        # Try ACTIVE_DRIVERS first (Samsara), fall back to mock
        try:
            from main import ACTIVE_DRIVERS
            driver = ACTIVE_DRIVERS.get(driver_id) or list(ACTIVE_DRIVERS.values())[0]
        except Exception:
            driver = MOCK_DRIVERS.get(driver_id, list(MOCK_DRIVERS.values())[0])

        handlers = {
            "check_hos_status": check_hos_status,
            "check_route_safety": check_route_safety,
            "find_fuel_stops": find_fuel_stops,
            "handle_breakdown": handle_breakdown,
            "notify_stakeholders": notify_stakeholders,
        }
        handler = handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown tool: {tool_name}"}
        return await handler(args, driver)
    except Exception as e:
        logger.error(f"Tool error [{tool_name}]: {e}")
        return {"error": str(e)}


async def handle_dispatcher_tool_call(
    tool_name: str, args: Dict[str, Any], active_drivers: dict
) -> Dict[str, Any]:
    """Route dispatcher tool calls to handlers"""
    try:
        handlers = {
            "get_fleet_status":  lambda a, _: get_fleet_status(a, active_drivers),
            "get_driver_details": lambda a, _: get_driver_details(a, active_drivers),
            "check_hos_status":  lambda a, _: check_hos_status_fleet(a, active_drivers),
            "plan_delivery":     lambda a, _: plan_delivery_tool(a, active_drivers),
            "notify_stakeholders": notify_stakeholders,
            "handle_breakdown":  handle_breakdown,
            "check_route_safety": check_route_safety,
        }
        handler = handlers.get(tool_name)
        if not handler:
            return {"error": f"Unknown dispatcher tool: {tool_name}"}

        # For tools that don't need active_drivers, pass a dummy driver
        if tool_name in ("notify_stakeholders", "handle_breakdown", "check_route_safety"):
            drivers = list(active_drivers.values())
            driver = drivers[0] if drivers else {}
            return await handler(args, driver)
        else:
            return await handler(args, None)
    except Exception as e:
        logger.error(f"Dispatcher tool error [{tool_name}]: {e}")
        return {"error": str(e)}


# ─── Driver tool handlers (implementations) ───────────────────────────────────


async def check_hos_status(args: Dict, driver: Dict) -> Dict:
    hos = driver.get("hos", {})
    drive_mins = hos.get("drive_time_remaining_mins", 0)
    dh, dm = drive_mins // 60, drive_mins % 60
    source = driver.get("source", "demo")
    source_label = "Samsara ELD (live)" if source == "samsara_live" else "demo data"

    query_type = args.get("query_type", "current_status")

    if query_type == "current_status":
        on_duty = hos.get("on_duty_remaining_mins", 0)
        return {
            "data_source": source_label,
            "driver": driver.get("name", "Unknown"),
            "drive_time_remaining": f"{dh}h {dm}min",
            "on_duty_remaining": f"{on_duty // 60}h {on_duty % 60}min",
            "status": hos.get("status", "unknown"),
            "time_driving_today": f"{hos.get('time_driving_today_mins', 0) // 60}h {hos.get('time_driving_today_mins', 0) % 60}min",
            "time_since_last_break": f"{hos.get('time_since_break_mins', 0)} min ago",
            "cycle_remaining_hours": hos.get("cycle_remaining_hours", "N/A"),
            "next_mandatory_break": hos.get("next_mandatory_break", "N/A"),
            "break_location": hos.get("break_location", "TBD"),
            "compliance": "COMPLIANT" if drive_mins > 0 else "VIOLATION — STOP IMMEDIATELY",
        }

    elif query_type == "can_complete_trip":
        destination = args.get("destination", driver.get("destination", {}).get("address", "destination") if driver.get("destination") else "destination")
        trip_mins = 210  # estimated 3.5 hours
        can_complete = drive_mins >= trip_mins
        if can_complete:
            return {
                "data_source": source_label,
                "can_complete": True,
                "drive_time_remaining": f"{dh}h {dm}min",
                "trip_estimated": "3h 30min",
                "hours_remaining_on_arrival": f"{(drive_mins - trip_mins) // 60}h {(drive_mins - trip_mins) % 60}min",
                "compliance": "COMPLIANT",
                "recommendation": f"Legal for {destination}. Mandatory 30-min break scheduled en route.",
            }
        else:
            overage = trip_mins - drive_mins
            return {
                "data_source": source_label,
                "can_complete": False,
                "drive_time_remaining": f"{dh}h {dm}min",
                "trip_estimated": "3h 30min",
                "overage": f"{overage // 60}h {overage % 60}min over limit",
                "max_fine": "$16,000",
                "compliance": "VIOLATION — CANNOT COMPLETE TRIP",
                "recommendation": "Must complete 10-hour rest break first. Notifying receiver now.",
            }

    elif query_type == "next_break":
        return {
            "data_source": source_label,
            "next_mandatory_break": hos.get("next_mandatory_break", "TBD"),
            "break_location": hos.get("break_location", "Next truck stop"),
            "break_duration": "30 minutes minimum",
            "facilities": "Parking, food, showers available",
            "safety_rating": "4.8/5 — well-lit, security cameras",
        }

    return {"error": "Unknown query type"}


async def check_route_safety(args: Dict, driver: Dict) -> Dict:
    route_name = args.get("route_name", "").lower()
    action = args.get("action", "check")
    truck_height = driver.get("truck_height", "13'6\"")

    restriction = None
    matched_name = None
    for parkway, info in RESTRICTED_PARKWAYS.items():
        if parkway in route_name or any(word in route_name for word in parkway.split() if len(word) > 4):
            restriction = info
            matched_name = parkway.title()
            break

    if restriction:
        result = {
            "safe_for_truck": False,
            "route_checked": matched_name or route_name,
            "reason": f"TRUCK PROHIBITED — max clearance {restriction['max_clearance']}, your rig is {truck_height}",
            "restriction": restriction["ban"],
            "risk": "BRIDGE STRIKE — potentially fatal, criminal charges",
            "fine": "Up to $10,000 + potential criminal liability if bridge struck",
        }
        if action == "reroute":
            result["alternative_route"] = restriction["alternative"]
            result["time_difference"] = restriction["time_diff"]
            result["notifications_sent"] = "Dispatcher and receiver auto-notified of route adjustment"
            result["rerouted"] = True
        return result

    return {
        "safe_for_truck": True,
        "route_checked": route_name,
        "truck_height": truck_height,
        "clearance": "No height or weight restrictions detected",
        "status": "APPROVED — safe to proceed",
    }


async def find_fuel_stops(args: Dict, driver: Dict) -> Dict:
    search_radius = args.get("miles_ahead", 50)
    location = driver.get("current_location", {}).get("address", "current location")
    return {
        "searched_near": location,
        "search_radius_miles": search_radius,
        "fuel_stops": [
            {
                "name": "New Haven Pilot Travel Center",
                "miles_ahead": 12,
                "price_per_gallon": 3.89,
                "fuel_cards_accepted": ["EFS", "Comdata", "WEX"],
                "facilities": "Showers, restaurant, 50 parking spaces",
                "detour_minutes": 0,
                "recommended": True,
                "savings_vs_average": "$0.14/gallon below corridor average",
            },
            {
                "name": "TA Travel Center — Milford",
                "miles_ahead": 28,
                "price_per_gallon": 3.92,
                "fuel_cards_accepted": ["EFS", "Comdata", "WEX", "Loves"],
                "facilities": "Showers, restaurant, CAT Scale, 120 spaces",
                "detour_minutes": 2,
                "recommended": False,
            },
        ],
        "recommendation": "Fill up at New Haven Pilot — best price, zero detour",
        "estimated_savings": "$8.40 vs next cheapest stop",
        "note": "Fuel stop aligned with your scheduled HOS break — no extra time lost",
    }


async def handle_breakdown(args: Dict, driver: Dict) -> Dict:
    issue_type = args.get("issue_type", "other")
    location = args.get("location_description", "unknown location")
    driver_name = driver.get("name", args.get("driver_name", "Driver"))

    mechanic_db = {
        "tire": [
            {"name": "Manny's Truck Repair", "eta_minutes": 18, "cost": 240, "phone": "908-555-0142", "rating": 4.8},
            {"name": "Garden State Fleet Services", "eta_minutes": 31, "cost": 195, "phone": "908-555-0189", "rating": 4.6},
            {"name": "I-95 Mobile Truck Repair", "eta_minutes": 45, "cost": 185, "phone": "908-555-0201", "rating": 4.5},
        ],
        "engine": [
            {"name": "East Coast Diesel Repair", "eta_minutes": 25, "cost": 350, "phone": "908-555-0155", "rating": 4.7},
            {"name": "NJ Commercial Truck Service", "eta_minutes": 40, "cost": 280, "phone": "908-555-0176", "rating": 4.5},
        ],
        "accident": [
            {"name": "Emergency Dispatch (911)", "eta_minutes": 8, "cost": 0, "phone": "911", "rating": 5.0},
            {"name": "East Coast Diesel Repair", "eta_minutes": 25, "cost": 350, "phone": "908-555-0155", "rating": 4.7},
        ],
    }

    options = mechanic_db.get(issue_type, mechanic_db["engine"])

    return {
        "emergency_activated": True,
        "driver": driver_name,
        "driver_safety_instructions": [
            "Stay in truck with hazard lights ON",
            "Do NOT stand behind the vehicle — danger zone",
            "Call 911 immediately if injury or hazmat involved",
            "Set up reflective triangles if safe to do so",
        ],
        "location_confirmed": location,
        "mechanics_contacted": options[:2],
        "fastest_option": options[0],
        "best_value": min(options, key=lambda x: x["cost"]),
        "stakeholders_notified": {
            "dispatcher": "Notified — monitoring situation in real-time",
            "shipper": "Notified — delivery delayed, new ETA pending",
            "receiver": "Notified — will confirm new ETA within 30 min",
            "broker": "Notified — claim filed if needed",
        },
        "tow_on_standby": True,
        "driver_action_required": "Choose preferred mechanic — reply by voice",
    }


async def notify_stakeholders(args: Dict, driver: Dict) -> Dict:
    driver_name = driver.get("name", args.get("driver_name", "Fleet")) if driver else args.get("driver_name", "Fleet")
    return {
        "notifications_sent": True,
        "driver": driver_name,
        "recipients": ["dispatcher", "shipper", "receiver", "broker"],
        "notification_type": args.get("notification_type"),
        "message_sent": args.get("message"),
        "new_eta": args.get("new_eta", ""),
        "delivery_method": "SMS + dashboard notification + email",
        "timestamp": datetime.now().isoformat(),
        "driver_action_required": False,
        "confirmation": "All parties notified. No calls needed.",
    }


# ─── Dispatcher tool handlers ──────────────────────────────────────────────────


async def get_fleet_status(args: Dict, active_drivers: dict) -> Dict:
    """Real-time fleet overview for dispatcher"""
    filter_type = args.get("filter", "all")
    drivers = list(active_drivers.values())
    source_label = "Samsara ELD (live)" if any(d.get("source") == "samsara_live" for d in drivers) else "demo data"

    summaries = []
    violations = []
    on_route_count = 0

    for d in drivers:
        hos = d.get("hos", {})
        mins = hos.get("drive_time_remaining_mins", 0)
        h, m = mins // 60, mins % 60
        status = d.get("status", "unknown")
        loc = d.get("current_location", {}).get("address", "Unknown")
        speed = d.get("current_location", {}).get("speed_mph", 0)
        eld_status = hos.get("status", "unknown")

        tel = d.get("telemetry") or {}
        summary = {
            "name": d.get("name"),
            "truck": d.get("truck"),
            "status": status,
            "eld_status": eld_status,
            "location": loc,
            "speed_mph": speed,
            "hos_remaining": f"{h}h {m}min",
            "hos_remaining_mins": mins,
            "compliance": "COMPLIANT" if mins > 30 else ("WARNING" if mins > 0 else "VIOLATION"),
            "fuel_percent": tel.get("fuel_percent"),
            "engine_state": tel.get("engine_state", "Unknown"),
            "odometer_miles": tel.get("odometer_miles"),
        }
        summaries.append(summary)

        if status == "on_route":
            on_route_count += 1
        if mins < 60 and status in ("on_route", "driving"):
            violations.append({"driver": d.get("name"), "hos_remaining": f"{h}h {m}min"})

    if filter_type == "on_route":
        summaries = [s for s in summaries if s["status"] == "on_route"]
    elif filter_type == "violations":
        summaries = [s for s in summaries if s["compliance"] == "VIOLATION"]
    elif filter_type == "low_hos":
        summaries = [s for s in summaries if s["hos_remaining_mins"] < 120]

    return {
        "data_source": source_label,
        "fleet_size": len(drivers),
        "on_route": on_route_count,
        "drivers": summaries,
        "hos_violations": violations,
        "alerts_requiring_action": len(violations),
        "timestamp": datetime.now().isoformat(),
    }


async def get_driver_details(args: Dict, active_drivers: dict) -> Dict:
    """Get detailed ELD data for a specific driver"""
    driver_name = args.get("driver_name", "").lower()
    for d in active_drivers.values():
        if driver_name in d.get("name", "").lower():
            hos = d.get("hos", {})
            mins = hos.get("drive_time_remaining_mins", 0)
            return {
                "found": True,
                "driver": d.get("name"),
                "truck": d.get("truck"),
                "license_plate": d.get("license_plate"),
                "status": d.get("status"),
                "location": d.get("current_location", {}).get("address"),
                "speed_mph": d.get("current_location", {}).get("speed_mph", 0),
                "heading": d.get("current_location", {}).get("heading", 0),
                "hos": {
                    "drive_remaining": f"{mins // 60}h {mins % 60}min",
                    "on_duty_remaining": f"{hos.get('on_duty_remaining_mins', 0) // 60}h {hos.get('on_duty_remaining_mins', 0) % 60}min",
                    "cycle_remaining": f"{hos.get('cycle_remaining_hours', 0)}h",
                    "status": hos.get("status"),
                    "time_driving_today": f"{hos.get('time_driving_today_mins', 0) // 60}h {hos.get('time_driving_today_mins', 0) % 60}min",
                },
                "phone": d.get("phone"),
                "data_source": "Samsara ELD (live)" if d.get("source") == "samsara_live" else "demo",
                "telemetry": {
                    "fuel_percent": (d.get("telemetry") or {}).get("fuel_percent"),
                    "engine_state": (d.get("telemetry") or {}).get("engine_state", "Unknown"),
                    "odometer_miles": (d.get("telemetry") or {}).get("odometer_miles"),
                    "fuel_note": "Live from Samsara ELD" if d.get("source") == "samsara_live" else "demo",
                },
            }

    return {"found": False, "error": f"No driver matching '{args.get('driver_name')}' found in fleet"}


async def check_hos_status_fleet(args: Dict, active_drivers: dict) -> Dict:
    """Check HOS for any driver — dispatcher version"""
    driver_name = args.get("driver_name", "").lower()

    if driver_name:
        for d in active_drivers.values():
            if driver_name in d.get("name", "").lower():
                return await check_hos_status(args, d)
        return {"error": f"Driver '{args.get('driver_name')}' not found"}

    # No driver specified — return all
    results = []
    for d in active_drivers.values():
        hos = d.get("hos", {})
        mins = hos.get("drive_time_remaining_mins", 0)
        results.append({
            "driver": d.get("name"),
            "drive_remaining": f"{mins // 60}h {mins % 60}min",
            "status": hos.get("status"),
            "compliance": "COMPLIANT" if mins > 30 else "VIOLATION" if mins == 0 else "WARNING",
        })
    return {"fleet_hos": results, "data_source": "Samsara ELD"}


async def plan_delivery_tool(args: Dict, active_drivers: dict) -> Dict:
    """FMCSA-compliant trip planning for dispatcher — find best driver + earliest delivery"""
    from trip_planner import rank_drivers_for_load
    destination    = args.get("destination", "destination")
    distance_miles = float(args.get("distance_miles", 100))
    required_by    = args.get("required_by")

    drivers = list(active_drivers.values())
    ranked  = rank_drivers_for_load(drivers, distance_miles, required_by)
    top3    = ranked[:3]

    results = []
    for r in top3:
        d    = r["driver"]
        plan = r["plan"]
        results.append({
            "rank": r["rank"],
            "driver": d.get("name"),
            "truck": d.get("truck"),
            "current_location": d.get("current_location", {}).get("address"),
            "hos_drive_remaining": f"{d['hos']['drive_time_remaining_mins'] // 60}h {d['hos']['drive_time_remaining_mins'] % 60}m",
            "scenario": plan["scenario_label"],
            "compliance": plan["compliance"],
            "earliest_delivery": plan["earliest_display"],
            "explanation": plan["explanation"],
            "meets_deadline": r.get("meets_deadline"),
            "warnings": plan["warnings"],
        })

    return {
        "destination": destination,
        "distance_miles": distance_miles,
        "drive_time_estimate": f"{int(distance_miles / 55)} h {int((distance_miles % 55) / 55 * 60)} m at 55 mph",
        "top_drivers": results,
        "total_evaluated": len(drivers),
        "data_source": "Samsara ELD (live HOS clocks)",
        "recommendation": results[0] if results else "No drivers available",
    }
