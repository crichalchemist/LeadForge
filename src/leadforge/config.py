from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://leadforge:leadforge@localhost:5432/leadforge"
    REDIS_URL: str = "redis://localhost:6379/0"
    SOCRATA_APP_TOKEN: str = ""
    GOOGLE_PLACES_API_KEY: str = ""

    # Rate limiting
    SOCRATA_PAGE_SIZE: int = 1000
    GOOGLE_PLACES_MAX_CONCURRENT: int = 5

    # API
    API_KEY: str = ""
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # Recalibration
    RECALIBRATION_SCORE_CHANGE_THRESHOLD: float = 0.10


settings = Settings()
