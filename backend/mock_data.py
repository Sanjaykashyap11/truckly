"""Mock data for Truckly demo — simulates live ELD/TMS/dispatch data"""

from datetime import datetime

MOCK_DRIVERS = {
    "D001": {
        "id": "D001",
        "name": "Oscar Martinez",
        "truck": "Kenworth T680",
        "truck_height": "13'6\"",
        "truck_weight": "78,500 lbs",
        "license_plate": "NJ-TRK-4521",
        "status": "on_route",
        "current_location": {
            "lat": 41.3,
            "lng": -72.9,
            "address": "I-95 N near New Haven, CT",
        },
        "destination": {"address": "Boston, MA", "lat": 42.36, "lng": -71.06},
        "origin": {"address": "Newark, NJ"},
        "hos": {
            "drive_time_remaining_mins": 502,  # 8h 22min
            "on_duty_remaining_mins": 720,
            "cycle_remaining_hours": 42.5,
            "last_reset": "2026-03-12T22:00:00",
            "next_mandatory_break": "2026-03-13T14:15:00",
            "break_location": "Milford Service Plaza, CT",
            "status": "driving",
        },
        "route": {
            "id": "R001",
            "highway": "I-95 N",
            "eta": "2026-03-13T16:40:00",
            "eta_miles": 145,
            "restricted_roads_avoided": [
                "Merritt Parkway",
                "Hutchinson River Parkway",
            ],
            "fuel_stops": [
                {
                    "location": "New Haven Pilot Travel Center",
                    "miles_ahead": 12,
                    "price_per_gallon": 3.89,
                }
            ],
            "violations": [],
        },
    },
    "D002": {
        "id": "D002",
        "name": "Maria Gonzalez",
        "truck": "Peterbilt 579",
        "truck_height": "13'2\"",
        "truck_weight": "74,200 lbs",
        "license_plate": "NY-TRK-8834",
        "status": "at_shipper",
        "current_location": {
            "lat": 40.73,
            "lng": -74.2,
            "address": "Elizabeth, NJ — Shipper Dock",
        },
        "destination": {"address": "Providence, RI"},
        "hos": {
            "drive_time_remaining_mins": 660,  # 11h
            "on_duty_remaining_mins": 840,
            "cycle_remaining_hours": 52.0,
            "status": "on_duty_not_driving",
            "next_mandatory_break": "2026-03-13T15:30:00",
            "break_location": "TA Travel Center, Providence",
        },
        "route": {
            "highway": "I-95 N",
            "eta": "2026-03-13T17:00:00",
            "restricted_roads_avoided": ["Merritt Parkway"],
            "violations": [],
        },
    },
    "D003": {
        "id": "D003",
        "name": "Philip Chen",
        "truck": "Freightliner Cascadia",
        "truck_height": "13'8\"",
        "truck_weight": "80,000 lbs",
        "license_plate": "CT-TRK-2291",
        "status": "resting",
        "current_location": {
            "lat": 40.49,
            "lng": -74.46,
            "address": "Flying J — Edison, NJ",
        },
        "destination": {"address": "Jersey City, NJ"},
        "hos": {
            "drive_time_remaining_mins": 0,
            "on_duty_remaining_mins": 0,
            "cycle_remaining_hours": 0,
            "status": "sleeper_berth",
            "restart_at": "2026-03-14T06:00:00",
        },
    },
}

MOCK_ALERTS = [
    {
        "id": "A001",
        "driver_id": "D001",
        "driver_name": "Oscar Martinez",
        "type": "ROUTE_SAFETY",
        "severity": "HIGH",
        "message": "Driver approaching Merritt Parkway on-ramp. Sally rerouted via I-95 N. No action required.",
        "timestamp": "2026-03-13T10:23:00",
        "acknowledged": True,
        "auto_resolved": True,
    },
    {
        "id": "A002",
        "driver_id": "D001",
        "driver_name": "Oscar Martinez",
        "type": "TRAFFIC_DELAY",
        "severity": "LOW",
        "message": "45-min delay on I-95 near Bridgeport. ETA updated to 4:20 PM. Shipper notified automatically.",
        "timestamp": "2026-03-13T11:45:00",
        "acknowledged": False,
        "auto_resolved": True,
    },
    {
        "id": "A003",
        "driver_id": "D002",
        "driver_name": "Maria Gonzalez",
        "type": "HOS_APPROACHING",
        "severity": "MEDIUM",
        "message": "Mandatory 30-min break due in 45 minutes. Break scheduled at TA Travel Center mile 78.",
        "timestamp": "2026-03-13T12:10:00",
        "acknowledged": False,
        "auto_resolved": False,
    },
]
