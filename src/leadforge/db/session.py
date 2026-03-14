from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from leadforge.db.engine import engine

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncSession:
    async with async_session() as session:
        yield session
