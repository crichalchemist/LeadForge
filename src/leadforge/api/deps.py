from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.config import settings
from leadforge.db.session import async_session

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def get_db() -> AsyncSession:
    """FastAPI dependency that provides a database session."""
    async with async_session() as session:
        yield session


async def verify_api_key(api_key: str | None = Security(api_key_header)) -> str:
    """Verify API key from X-API-Key header. Skips if no key configured."""
    if not settings.API_KEY:
        return "no-auth"
    if api_key != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return api_key
