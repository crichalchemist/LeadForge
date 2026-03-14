import structlog
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from leadforge.api.deps import get_current_user
from leadforge.api.routes import (
    auth,
    businesses,
    grants,
    health,
    leads,
    outreach,
    pipeline,
    reports,
)
from leadforge.config import settings
from leadforge.voice.webhook_handler import router as webhook_router

logger = structlog.get_logger()

app = FastAPI(
    title="LeadForge API",
    description="Lead generation pipeline for hyper-local small businesses",
    version="0.5.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes (webhooks, health, auth)
app.include_router(health.router)
app.include_router(webhook_router)
app.include_router(auth.router)

# Protected routes (require valid JWT)
protected = [
    businesses.router,
    grants.router,
    leads.router,
    outreach.router,
    pipeline.router,
    reports.router,
]
for r in protected:
    app.include_router(r, dependencies=[Depends(get_current_user)])
