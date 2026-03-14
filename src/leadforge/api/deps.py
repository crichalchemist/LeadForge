from sqlalchemy.ext.asyncio import AsyncSession
from leadforge.db.session import async_session


async def get_db() -> AsyncSession:
    """FastAPI dependency that provides a database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
