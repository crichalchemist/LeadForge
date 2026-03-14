from pydantic import BaseModel


class FunnelStage(BaseModel):
    stage: str
    count: int


class FunnelResponse(BaseModel):
    stages: list[FunnelStage]
    total: int


class ScoreBucket(BaseModel):
    range_min: float
    range_max: float
    count: int


class ScoreDistributionResponse(BaseModel):
    buckets: list[ScoreBucket]
    total: int
    mean: float | None = None
    median: float | None = None


class ZipPerformanceItem(BaseModel):
    zip_code: str
    total_leads: int
    avg_composite_score: float | None = None
    contacted_count: int = 0
    engaged_count: int = 0
    won_count: int = 0
    conversion_rate: float | None = None


class ZipPerformanceResponse(BaseModel):
    items: list[ZipPerformanceItem]
