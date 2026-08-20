from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class GuardrailResult(BaseModel):
    allowed: bool = Field(
        description="True if the user request is related to travel planning or travel information. False if blocked."
    )
    reason: str = Field(
        default="",
        description="Reason for blocking or allowing the request."
    )


class TripConstraints(BaseModel):
    destination: str = Field(default="")
    origin: str = Field(default="")
    duration: str = Field(default="")
    budget: str = Field(default="")
    travel_style: str = Field(default="")
    special_preferences: List[str] = Field(default_factory=list)


class SupervisorRouting(BaseModel):
    selected_agents: List[str] = Field(
        description=(
            "List of specialist agent names required for the query. "
            "Available choices: flight_agent, hotel_agent, weather_agent, budget_agent, itinerary_agent"
        )
    )
    trip_constraints: TripConstraints = Field(default_factory=TripConstraints)
    reasoning: str = Field(
        default="",
        description="Brief explanation of why these agents were selected."
    )


class BudgetAnalysisResult(BaseModel):
    cost_categories: Dict[str, str] = Field(
        default_factory=dict,
        description="Estimated break-down of costs (flight, hotel, daily activities, food)."
    )
    budget_risk_areas: List[str] = Field(
        default_factory=list,
        description="Potential risk areas where costs could exceed user limit."
    )
    money_saving_suggestions: List[str] = Field(
        default_factory=list,
        description="Actionable tips to reduce trip expenses."
    )
    overall_feasibility: str = Field(
        description="Assessment of whether the trip is feasible within budget constraints."
    )


# ==========================================
# New Decision & Ranking System Schemas
# ==========================================

class HardConstraints(BaseModel):
    max_budget_inr: float = Field(default=100000.0, description="Upper budget limit in INR. Default 100k if unspecified.")
    max_available_days: int = Field(default=7, description="Total days available for travel.")
    travel_month: str = Field(default="October", description="Month of travel (e.g. October, January, June).")
    origin_city: str = Field(default="", description="City of origin/departure.")
    requires_low_altitude: bool = Field(default=False, description="True if traveler cannot tolerate high altitude / AMS.")
    requires_mobility_friendly: bool = Field(default=False, description="True if traveler requires wheelchair or step-free access.")
    explicit_destination: Optional[str] = Field(default=None, description="If user explicitly requested a specific place.")


class SoftPreferences(BaseModel):
    nature_weight: float = Field(default=0.5, ge=0.0, le=1.0, description="Preference for nature/mountains/landscapes (0.0 to 1.0)")
    adventure_weight: float = Field(default=0.5, ge=0.0, le=1.0, description="Preference for outdoor adventure sports/trekking (0.0 to 1.0)")
    culture_weight: float = Field(default=0.5, ge=0.0, le=1.0, description="Preference for temples, history, architecture, cuisine (0.0 to 1.0)")
    nightlife_weight: float = Field(default=0.3, ge=0.0, le=1.0, description="Preference for clubs, bars, evening entertainment (0.0 to 1.0)")
    relaxation_weight: float = Field(default=0.6, ge=0.0, le=1.0, description="Preference for serene, slow-paced unwinding, spas, beaches (0.0 to 1.0)")
    crowd_aversion: float = Field(default=0.5, ge=0.0, le=1.0, description="High value means strong penalty for overcrowded places (0.0 to 1.0)")
    risk_tolerance: float = Field(default=0.5, ge=0.0, le=1.0, description="Tolerance for rugged transit or weather uncertainties (0.0 to 1.0)")


class UserProfile(BaseModel):
    hard_constraints: HardConstraints = Field(default_factory=HardConstraints)
    soft_preferences: SoftPreferences = Field(default_factory=SoftPreferences)
    travel_party: str = Field(default="solo", description="solo, couple, family, friends")
    extracted_summary: str = Field(default="", description="Summary of parsed preferences")


class ScoreWaterfall(BaseModel):
    budget_fit: float = Field(default=0.0, description="+/- points contributed by budget alignment")
    duration_fit: float = Field(default=0.0, description="+/- points contributed by trip duration alignment")
    season_fit: float = Field(default=0.0, description="+/- points contributed by weather & seasonality")
    nature_match: float = Field(default=0.0, description="+/- points contributed by nature match")
    adventure_match: float = Field(default=0.0, description="+/- points contributed by adventure match")
    culture_match: float = Field(default=0.0, description="+/- points contributed by culture match")
    nightlife_match: float = Field(default=0.0, description="+/- points contributed by nightlife match")
    relaxation_match: float = Field(default=0.0, description="+/- points contributed by relaxation match")
    travel_friction_penalty: float = Field(default=0.0, description="Negative deduction for transit difficulty")
    crowd_penalty: float = Field(default=0.0, description="Negative deduction for seasonal crowding")


class CriticalAnalysisReport(BaseModel):
    advantages: List[str] = Field(default_factory=list)
    disadvantages: List[str] = Field(default_factory=list)
    weather_risks: List[str] = Field(default_factory=list)
    cost_risks: List[str] = Field(default_factory=list)
    tourist_traps: List[str] = Field(default_factory=list)
    who_should_not_visit: str = Field(default="")
    transport_difficulty_level: str = Field(default="Moderate")


class RankedCandidate(BaseModel):
    id: str
    name: str
    country: str
    region: str
    overall_fit_score: float = Field(ge=0.0, le=100.0)
    confidence_score: float = Field(ge=0.0, le=1.0)
    estimated_cost_min_inr: float
    estimated_cost_max_inr: float
    score_waterfall: ScoreWaterfall
    critical_analysis: CriticalAnalysisReport
    rank: int = 1
    why_matched: List[str] = Field(default_factory=list)
    why_ranked_lower: Optional[str] = None


class RecommendationDecision(BaseModel):
    best_destination: RankedCandidate
    alternatives: List[RankedCandidate] = Field(default_factory=list)
    eliminated_candidates: List[Dict[str, Any]] = Field(default_factory=list)
    decision_summary: str = Field(default="")


class DynamicDestinationDossier(BaseModel):
    id: str = Field(description="Slug identifier, e.g. 'dharamshala' or 'dubai' or 'rome'")
    name: str = Field(description="Display destination name, e.g. 'Dharamshala, Himachal Pradesh'")
    country: str = Field(default="India", description="Country name")
    region: str = Field(default="", description="State/Province/Region")
    min_days: int = Field(default=2, description="Recommended minimum days")
    base_cost_per_day_inr: float = Field(default=3000.0, description="Realistic average daily cost per person in INR")
    cost_uncertainty_range_pct: float = Field(default=0.20, description="Cost variance")
    category_tags: List[str] = Field(default_factory=list, description="Tags like ['nature', 'culture', 'budget']")
    advantages: List[str] = Field(default_factory=list, description="Top 2-3 genuine highlights")
    disadvantages: List[str] = Field(default_factory=list, description="Top 1-2 genuine drawbacks")
    who_should_not_visit: str = Field(default="", description="Direct warning for who should avoid this place")


class DynamicDiscoveryResult(BaseModel):
    target_destination: Optional[DynamicDestinationDossier] = None
    candidate_destinations: List[DynamicDestinationDossier] = Field(
        default_factory=list,
        description="2 to 3 destination dossiers to evaluate"
    )
