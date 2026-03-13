"""Truckly agent tool definitions and handlers for Gemini Live API"""

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
}


def get_tools() -> list:
    """Return Gemini tool definitions for the Truckly agent"""
    return [
        types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name="check_hos_status",
                    description=(
                        "Check HOS (Hours of Service) status for the driver. "
                        "Call this when driver asks about hours, breaks, or whether they can complete a delivery."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "query_type": types.Schema(
                                type=types.Type.STRING,
                                description="Type of HOS query",
                                enum=["current_status", "can_complete_trip", "next_break"],
                            ),
                            "destination": types.Schema(
                                type=types.Type.STRING,
                                description="Optional destination address to check trip feasibility",
                            ),
                        },
                        required=["query_type"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="check_route_safety",
                    description=(
                        "Check if a road or parkway is safe and legal for the driver's truck. "
                        "ALWAYS call this when driver mentions taking a specific road, shortcut, or parkway."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "route_name": types.Schema(
                                type=types.Type.STRING,
                                description="Name of the road, highway, or parkway to check",
                            ),
                            "action": types.Schema(
                                type=types.Type.STRING,
                                description="'check' to validate safety, 'reroute' to get alternative",
                                enum=["check", "reroute"],
                            ),
                        },
                        required=["route_name", "action"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="find_fuel_stops",
                    description="Find cheapest diesel fuel stops on the current route. Call when driver asks about fuel.",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "miles_ahead": types.Schema(
                                type=types.Type.NUMBER,
                                description="How far ahead to search for fuel stops in miles (default 50)",
                            ),
                        },
                    ),
                ),
                types.FunctionDeclaration(
                    name="handle_breakdown",
                    description=(
                        "Handle a vehicle breakdown or emergency. "
                        "IMMEDIATELY call this if driver reports any mechanical issue, blowout, or emergency."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "issue_type": types.Schema(
                                type=types.Type.STRING,
                                description="Type of breakdown",
                                enum=["tire", "engine", "accident", "medical", "other"],
                            ),
                            "location_description": types.Schema(
                                type=types.Type.STRING,
                                description="Driver's location (highway, exit number, mile marker)",
                            ),
                        },
                        required=["issue_type", "location_description"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="notify_stakeholders",
                    description=(
                        "Send automatic notifications to dispatcher, shipper, and receiver. "
                        "Call this proactively when there's any update affecting delivery."
                    ),
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "notification_type": types.Schema(
                                type=types.Type.STRING,
                                description="Type of notification",
                                enum=["delay", "route_change", "eta_update", "breakdown", "delivery_complete"],
                            ),
                            "message": types.Schema(
                                type=types.Type.STRING,
                                description="Message content to send to stakeholders",
                            ),
                            "new_eta": types.Schema(
                                type=types.Type.STRING,
                                description="Updated ETA if applicable (e.g. '4:20 PM')",
                            ),
                        },
                        required=["notification_type", "message"],
                    ),
                ),
            ]
        )
    ]


# ─── Tool handlers ─────────────────────────────────────────────────────────────


async def handle_tool_call(
    tool_name: str, args: Dict[str, Any], driver_id: str
) -> Dict[str, Any]:
    """Route tool calls to the appropriate handler"""
    from mock_data import MOCK_DRIVERS

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

    try:
        return await handler(args, driver)
    except Exception as e:
        logger.error(f"Tool error [{tool_name}]: {e}")
        return {"error": str(e)}


async def check_hos_status(args: Dict, driver: Dict) -> Dict:
    hos = driver["hos"]
    drive_mins = hos["drive_time_remaining_mins"]
    dh = drive_mins // 60
    dm = drive_mins % 60

    query_type = args.get("query_type", "current_status")

    if query_type == "current_status":
        return {
            "drive_time_remaining": f"{dh}h {dm}min",
            "on_duty_remaining": f"{hos['on_duty_remaining_mins'] // 60}h {hos['on_duty_remaining_mins'] % 60}min",
            "status": hos["status"],
            "next_mandatory_break": hos.get("next_mandatory_break", "N/A"),
            "break_location": hos.get("break_location", "TBD"),
            "cycle_remaining_hours": hos.get("cycle_remaining_hours", "N/A"),
            "compliance": "COMPLIANT" if drive_mins > 0 else "VIOLATION — STOP IMMEDIATELY",
        }

    elif query_type == "can_complete_trip":
        destination = args.get("destination", driver.get("destination", {}).get("address", "destination"))
        # Approx Boston trip from mid-CT = 3.5 hours
        trip_mins = 210
        can_complete = drive_mins >= trip_mins

        if can_complete:
            remaining_on_arrival = drive_mins - trip_mins
            return {
                "can_complete": True,
                "drive_time_remaining": f"{dh}h {dm}min",
                "trip_estimated": "3h 30min",
                "hours_remaining_on_arrival": f"{remaining_on_arrival // 60}h {remaining_on_arrival % 60}min",
                "compliance": "COMPLIANT",
                "recommendation": f"You're legal for {destination}. Mandatory 30-min break scheduled en route.",
            }
        else:
            overage = trip_mins - drive_mins
            return {
                "can_complete": False,
                "drive_time_remaining": f"{dh}h {dm}min",
                "trip_estimated": "3h 30min",
                "overage": f"{overage // 60}h {overage % 60}min over legal limit",
                "max_fine": "$16,000",
                "compliance": "VIOLATION — CANNOT COMPLETE TRIP",
                "recommendation": "Must complete 10-hour rest break first. I'll hold the delivery and notify the receiver.",
            }

    elif query_type == "next_break":
        return {
            "next_mandatory_break": hos.get("next_mandatory_break", "2:15 PM today"),
            "break_location": hos.get("break_location", "Milford Service Plaza, CT"),
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
    for parkway, info in RESTRICTED_PARKWAYS.items():
        if parkway in route_name:
            restriction = info
            break

    if restriction:
        result = {
            "safe_for_truck": False,
            "route_checked": route_name,
            "reason": f"TRUCK PROHIBITED — max clearance {restriction['max_clearance']}, your rig is {truck_height}",
            "restriction": restriction["ban"],
            "risk": "BRIDGE STRIKE — potentially fatal and criminal charges",
            "fine": "Up to $10,000 + potential criminal liability if bridge struck",
        }
        if action == "reroute":
            result["alternative_route"] = restriction["alternative"]
            result["time_difference"] = restriction["time_diff"]
            result["notifications_sent"] = "Dispatcher and receiver automatically notified of route adjustment"
            result["rerouted"] = True
        return result

    return {
        "safe_for_truck": True,
        "route_checked": route_name,
        "truck_height": truck_height,
        "clearance": "No height or weight restrictions detected on this road",
        "status": "APPROVED — safe to proceed",
    }


async def find_fuel_stops(args: Dict, driver: Dict) -> Dict:
    miles_ahead = args.get("miles_ahead", 50)
    return {
        "fuel_stops": [
            {
                "name": "New Haven Pilot Travel Center",
                "miles_ahead": 12,
                "price_per_gallon": 3.89,
                "fuel_cards_accepted": ["EFS", "Comdata", "WEX"],
                "facilities": "Showers, restaurant, parking (50 spaces)",
                "detour_minutes": 0,
                "recommended": True,
                "savings_vs_average": "$0.14/gallon below corridor average",
            },
            {
                "name": "Providence Flying J",
                "miles_ahead": 78,
                "price_per_gallon": 3.95,
                "fuel_cards_accepted": ["EFS", "Comdata", "WEX", "Loves"],
                "facilities": "Showers, restaurant, CAT Scale, parking (120 spaces)",
                "detour_minutes": 3,
                "recommended": False,
            },
        ],
        "recommendation": "Fill up at New Haven Pilot — best price on route, zero detour",
        "estimated_savings": "$8.40 vs next cheapest stop",
        "driver_action_required": False,
        "note": "Fuel stop aligned with your scheduled HOS break — no extra time lost",
    }


async def handle_breakdown(args: Dict, driver: Dict) -> Dict:
    issue_type = args.get("issue_type", "other")
    location = args.get("location_description", "unknown location")

    mechanic_db = {
        "tire": [
            {"name": "Manny's Truck Repair", "eta_minutes": 18, "cost": 240, "phone": "908-555-0142", "rating": 4.8},
            {"name": "Garden State Fleet Services", "eta_minutes": 31, "cost": 195, "phone": "908-555-0189", "rating": 4.6},
            {"name": "I-78 Mobile Truck Repair", "eta_minutes": 45, "cost": 185, "phone": "908-555-0201", "rating": 4.5},
        ],
        "engine": [
            {"name": "East Coast Diesel Repair", "eta_minutes": 25, "cost": 350, "phone": "908-555-0155", "rating": 4.7},
            {"name": "NJ Commercial Truck Service", "eta_minutes": 40, "cost": 280, "phone": "908-555-0176", "rating": 4.5},
        ],
    }

    options = mechanic_db.get(issue_type, mechanic_db["engine"])

    return {
        "emergency_activated": True,
        "driver_safety_instructions": "Stay in truck with hazard lights on. Do NOT stand behind the vehicle.",
        "location_confirmed": location,
        "mechanics_contacted": options[:2],
        "fastest_option": options[0],
        "best_value": min(options, key=lambda x: x["cost"]),
        "stakeholders_notified": {
            "dispatcher": "Notified — monitoring situation",
            "shipper": "Notified — delivery delayed, new ETA pending",
            "receiver": "Notified — will confirm new ETA within 30 min",
            "broker": "Notified",
        },
        "emergency_services": "Call 911 if any injury or hazardous material involved",
        "driver_action_required": "Choose preferred mechanic — reply by voice",
        "tow_on_standby": True,
    }


async def notify_stakeholders(args: Dict, driver: Dict) -> Dict:
    return {
        "notifications_sent": True,
        "recipients": ["dispatcher", "shipper", "receiver", "broker"],
        "notification_type": args.get("notification_type"),
        "message_sent": args.get("message"),
        "new_eta": args.get("new_eta", ""),
        "delivery_method": "SMS + dashboard notification",
        "timestamp": datetime.now().isoformat(),
        "driver_action_required": False,
        "confirmation": "All parties notified. No calls needed from driver.",
    }
