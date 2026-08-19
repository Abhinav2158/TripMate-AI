from typing import Any
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
    special_preferences: list[str] = Field(default_factory=list)


class SupervisorRouting(BaseModel):
    selected_agents: list[str] = Field(
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
    cost_categories: dict[str, str] = Field(
        default_factory=dict,
        description="Estimated break-down of costs (flight, hotel, daily activities, food)."
    )
    budget_risk_areas: list[str] = Field(
        default_factory=list,
        description="Potential risk areas where costs could exceed user limit."
    )
    money_saving_suggestions: list[str] = Field(
        default_factory=list,
        description="Actionable tips to reduce trip expenses."
    )
    overall_feasibility: str = Field(
        description="Assessment of whether the trip is feasible within budget constraints."
    )
