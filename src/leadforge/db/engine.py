from sqlalchemy.ext.asyncio import create_async_engine
from leadforge.config import settings

_engine_kwargs = {
    "echo": False,
}

# pool_size/max_overflow are not supported by SQLite
if not settings.DATABASE_URL.startswith("sqlite"):
    _engine_kwargs["pool_size"] = 5
    _engine_kwargs["max_overflow"] = 10

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)
