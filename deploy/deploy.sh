#!/bin/bash
# Truckly — Cloud Run deployment script
# Proof of GCP deployment for hackathon judges

set -e

# ─── Config (override via env vars) ──────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-your-gcp-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="truckly-backend"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Truckly — Deploying to Google Cloud Run"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Ensure required vars
if [ -z "${GEMINI_API_KEY}" ] && [ "${USE_VERTEX_AI}" != "true" ]; then
  echo "ERROR: Set GEMINI_API_KEY or USE_VERTEX_AI=true"
  exit 1
fi

# 1. Authenticate (assumes gcloud is already authenticated)
echo ""
echo "[1/4] Configuring gcloud project..."
gcloud config set project "${PROJECT_ID}"

# 2. Enable required APIs
echo ""
echo "[2/4] Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  containerregistry.googleapis.com \
  aiplatform.googleapis.com \
  --quiet

# 3. Build and push Docker image
echo ""
echo "[3/4] Building and pushing Docker image..."
cd "$(dirname "$0")/../backend"

gcloud builds submit \
  --tag "${IMAGE}" \
  --quiet

# 4. Deploy to Cloud Run
echo ""
echo "[4/4] Deploying to Cloud Run..."

DEPLOY_ARGS=(
  "${SERVICE_NAME}"
  "--image=${IMAGE}"
  "--platform=managed"
  "--region=${REGION}"
  "--allow-unauthenticated"
  "--port=8080"
  "--memory=1Gi"
  "--cpu=1"
  "--min-instances=0"
  "--max-instances=10"
  "--timeout=3600"          # Long timeout for WebSocket connections
  "--concurrency=100"
)

# Set environment variables
if [ "${USE_VERTEX_AI}" = "true" ]; then
  DEPLOY_ARGS+=("--set-env-vars=USE_VERTEX_AI=true,GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION}")
else
  DEPLOY_ARGS+=("--set-env-vars=GEMINI_API_KEY=${GEMINI_API_KEY}")
fi

gcloud run deploy "${DEPLOY_ARGS[@]}" --quiet

# Get service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --platform=managed \
  --region="${REGION}" \
  --format="value(status.url)")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment complete!"
echo ""
echo "  Backend URL: ${SERVICE_URL}"
echo "  Health check: ${SERVICE_URL}/health"
echo ""
echo "  Set in frontend .env.local:"
echo "  NEXT_PUBLIC_API_URL=${SERVICE_URL}"
echo "  NEXT_PUBLIC_WS_URL=${SERVICE_URL/https/wss}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
