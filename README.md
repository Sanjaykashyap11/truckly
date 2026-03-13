# Truckly — AI Voice Co-Pilot for Commercial Truck Drivers

> **Gemini Live Agent Hackathon Submission** — Category: **Live Agents**

Truckly is a real-time voice AI co-pilot ("Sally") for commercial truck drivers that replaces 5+ fragmented apps with one hands-free conversation. Sally handles HOS compliance, truck-safe routing, fuel stop optimization, and breakdown emergencies — all while the driver keeps both hands on the wheel and eyes on the road.

---

## The Problem

Every day, commercial truck drivers operate 80,000 lb vehicles while juggling:
- GPS apps that don't know about bridge clearances or parkway bans (80% of bridge strikes caused by consumer GPS)
- ELD screens showing HOS status they have to manually interpret (~40% of drivers exceed HOS limits)
- Phone calls to dispatchers, shippers, and receivers mid-drive
- Manual fuel price searches while moving

**Sally fixes all of this. Hands-free. In real time.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (Driver)                    │
│  Web Audio API → PCM16 16kHz → WebSocket → Backend      │
│  Backend → PCM16 24kHz → Web Audio API → Plays audio    │
└───────────────────┬─────────────────────────────────────┘
                    │ WebSocket (bidirectional audio)
┌───────────────────▼─────────────────────────────────────┐
│              FastAPI Backend (Cloud Run)                  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Gemini Live API Bridge                 │    │
│  │  • Streams audio to/from Gemini 2.0 Flash Live  │    │
│  │  • Handles function calling (tools)              │    │
│  │  • System prompt with live driver context        │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │              Tool Handlers                       │    │
│  │  check_hos_status     → Live ELD data (mocked)  │    │
│  │  check_route_safety   → Parkway/bridge DB        │    │
│  │  find_fuel_stops      → Fuel card pricing        │    │
│  │  handle_breakdown     → Mechanic dispatch        │    │
│  │  notify_stakeholders  → Auto SMS/dashboard       │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                    │ REST API
┌───────────────────▼─────────────────────────────────────┐
│            Next.js Frontend (Vercel/Static)               │
│  • Dispatcher Dashboard — fleet overview, live alerts    │
│  • Driver Voice Interface — talk to Sally                │
└─────────────────────────────────────────────────────────┘
```

### Google Cloud Services Used
- **Cloud Run** — Serverless backend hosting (auto-scales, handles WebSocket long connections)
- **Cloud Build** — Automated CI/CD pipeline (`deploy/cloudbuild.yaml`)
- **Container Registry** — Docker image storage
- **Vertex AI / Gemini Live API** — Real-time voice AI (gemini-2.0-flash-live-001)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice AI | Gemini 2.0 Flash Live API (Live Agents) |
| AI SDK | Google GenAI SDK (`google-genai`) |
| Backend | Python 3.12, FastAPI, WebSocket |
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| Deployment | Google Cloud Run |
| CI/CD | Cloud Build (`cloudbuild.yaml`) |

---

## Quick Start (Local)

### Prerequisites
- Python 3.12+
- Node.js 18+
- A Gemini API key ([get one here](https://aistudio.google.com/app/apikey))

### 1. Clone the repo
```bash
git clone https://github.com/Sanjaykashyap11/truckly.git
cd truckly
```

### 2. Backend setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env file
cp ../.env.example .env
# Edit .env and add your GEMINI_API_KEY

# Start backend
python main.py
# Backend runs on http://localhost:8080
```

### 3. Frontend setup
```bash
cd frontend
npm install

# Create .env.local
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" > .env.local
echo "NEXT_PUBLIC_WS_URL=ws://localhost:8080" >> .env.local

# Start frontend
npm run dev
# Frontend runs on http://localhost:3000
```

### 4. Open the app
- **Dispatcher Dashboard**: http://localhost:3000
- **Driver Voice Interface**: http://localhost:3000/driver

---

## Demo Scenarios

Once connected, try these voice commands (or click the demo buttons in the UI):

| Scenario | What to say | What happens |
|----------|-------------|--------------|
| HOS Check | "Hey Sally, how are my hours looking for Boston?" | Sally calls `check_hos_status` and responds with remaining drive time |
| Parkway Alert | "My GPS shows a faster route through Merritt Parkway" | Sally immediately flags it as TRUCK PROHIBITED, reroutes via I-95 |
| Fatigue Prevention | "The receiver wants me to push through and deliver tonight" | Sally calculates HOS violation risk, refuses, notifies receiver |
| Breakdown | "Sally — tire blowout, I-95 Exit 24 NJ" | Sally activates breakdown protocol, contacts mechanics, notifies all stakeholders |
| Fuel Stop | "I need a fuel stop soon" | Sally finds cheapest diesel on route, aligned with HOS break |

---

## Deploy to Google Cloud Run

### Option A: Manual deploy
```bash
export GCP_PROJECT_ID=your-project-id
export GEMINI_API_KEY=your-api-key

chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

### Option B: Cloud Build (automated CI/CD)
```bash
gcloud builds submit --config deploy/cloudbuild.yaml \
  --substitutions _SERVICE_NAME=truckly-backend,_REGION=us-central1
```

After deployment, update your frontend environment:
```bash
# In frontend/.env.local (or Vercel env vars)
NEXT_PUBLIC_API_URL=https://truckly-backend-xxx-uc.a.run.app
NEXT_PUBLIC_WS_URL=wss://truckly-backend-xxx-uc.a.run.app
```

---

## Key Features

### For Drivers (Voice First)
- **Hands-free HOS monitoring** — "How are my hours?" → instant spoken answer
- **Parkway & bridge strike prevention** — real-time rerouting before the driver reaches a restricted road
- **Fatigue prevention** — refuses to confirm trips that would create HOS violations
- **Breakdown emergency protocol** — contacts mechanics, notifies stakeholders in < 3 min
- **Fuel optimization** — finds cheapest diesel on route, aligned with mandatory breaks

### For Dispatchers (Web Dashboard)
- **Live fleet overview** — all drivers, HOS status, locations
- **Real-time alerts** — auto-generated by Sally, auto-resolved where possible
- **Zero phone calls from drivers** — Sally handles all stakeholder communication

### Technical Highlights
- **Gemini Live API** — bidirectional audio streaming with natural interruption handling
- **Function calling** — Sally invokes real tools (HOS check, route validation) mid-conversation
- **WebSocket bridge** — browser PCM16 audio → Gemini Live API → PCM16 back to browser
- **Context-aware** — Sally knows the driver's HOS status, truck specs, and route at all times

---

## Project Structure

```
truckly/
├── backend/
│   ├── main.py          # FastAPI server + Gemini Live WebSocket bridge
│   ├── tools.py         # Tool definitions + handlers (HOS, routing, fuel, breakdown)
│   ├── mock_data.py     # Mock ELD/TMS data (3 demo drivers)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Dispatcher dashboard
│   │   └── driver/page.tsx  # Driver voice interface
│   ├── package.json
│   └── ...
├── deploy/
│   ├── deploy.sh        # Cloud Run deployment script
│   └── cloudbuild.yaml  # Automated CI/CD
├── .env.example
└── README.md
```

---

## Safety Impact

Truckly directly addresses FMCSA's top commercial vehicle safety priorities:

| Problem | FMCSA Data | Truckly Solution |
|---------|-----------|-----------------|
| Distracted driving | 3,308 deaths/yr (NHTSA 2022) | Replaces 5+ apps with one hands-free voice AI |
| Bridge strikes from wrong GPS | 80% caused by consumer GPS (FMCSA/Schumer) | Full truck-height routing, proactive parkway alerts |
| HOS violations | ~40% of drivers exceed limits (FMCSA Survey 2020) | Proactive planning, 45-min warnings, violation prevention |
| Fatigue crashes | 14% of truck crashes (FMCSA) | Intelligent rest planning, refuses illegal schedules |

---

## Findings & Learnings

- **Gemini Live API barge-in** works naturally for driver interruptions — no special handling needed
- **PCM16 at 16kHz input / 24kHz output** is the key format mismatch to handle in the browser
- **Function calling mid-conversation** with Live API requires sending `LiveClientToolResponse` back immediately before Gemini continues
- **WebSocket timeout** on Cloud Run requires `--timeout=3600` flag for long voice sessions
- **System prompt context** with live driver data (HOS, route, truck specs) dramatically improves response quality and safety

---

*Built for the Gemini Live Agent Hackathon — #GeminiLiveAgentChallenge*
