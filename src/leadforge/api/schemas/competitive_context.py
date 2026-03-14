from typing import Optional

from pydantic import BaseModel, ConfigDict


class CompetitiveContextResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    zip_code: str
    niche: str
    competitor_count: int = 0
    avg_digital_score: Optional[float] = None
    competitor_ads_active_count: int = 0
    avg_rating: Optional[float] = None
    median_household_income: Optional[float] = None
    population_density: Optional[float] = None
