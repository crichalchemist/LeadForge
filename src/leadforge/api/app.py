from fastapi import FastAPI
from leadforge.voice.webhook_handler import router as webhook_router

app = FastAPI(
    title="LeadForge API",
    description="Lead generation pipeline API",
    version="0.3.0",
)

app.include_router(webhook_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
