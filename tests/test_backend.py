import pytest
import pytest_asyncio
from schemas import GuardrailResult, SupervisorRouting, TripConstraints
from backend import run_travel_agent_async, resume_travel_agent_async, route_from_supervisor, travel_graph


@pytest.mark.asyncio
async def test_guardrail_pydantic_schema():
    res = GuardrailResult(allowed=True, reason="Valid travel query")
    assert res.allowed is True
    assert res.reason == "Valid travel query"


@pytest.mark.asyncio
async def test_supervisor_routing_schema():
    constraints = TripConstraints(destination="Tokyo", duration="7 days", budget="$2000")
    routing = SupervisorRouting(
        selected_agents=["flight_agent", "hotel_agent"],
        trip_constraints=constraints,
        reasoning="User requested Tokyo flight and hotel"
    )
    assert "flight_agent" in routing.selected_agents
    assert routing.trip_constraints.destination == "Tokyo"


def test_route_from_supervisor_blocked():
    state = {
        "guardrail_allowed": False,
        "guardrail_reason": "Blocked harmful query",
        "selected_agents": []
    }
    target = route_from_supervisor(state)
    assert target == "guardrail_blocked"


def test_route_from_supervisor_parallel_fanout():
    state = {
        "guardrail_allowed": True,
        "selected_agents": ["flight_agent", "hotel_agent", "weather_agent"]
    }
    targets = route_from_supervisor(state)
    # Must return list of parallel node names for LangGraph Fan-Out
    assert isinstance(targets, list)
    assert "flight_agent" in targets
    assert "hotel_agent" in targets
    assert "weather_agent" in targets


def test_route_from_supervisor_budget_only():
    state = {
        "guardrail_allowed": True,
        "selected_agents": ["budget_agent"]
    }
    target = route_from_supervisor(state)
    assert target == "budget_agent"


def test_route_from_supervisor_no_specialists():
    state = {
        "guardrail_allowed": True,
        "selected_agents": []
    }
    target = route_from_supervisor(state)
    assert target == "itinerary_agent"


@pytest.mark.asyncio
async def test_end_to_end_graph_interrupt_flow():
    user_query = "Plan a 3-day trip to Paris on a $1000 budget."
    thread_id = "test_thread_001"

    # Step 1: Run graph initial execution
    res = await run_travel_agent_async(user_query, thread_id=thread_id)

    assert res["thread_id"] == thread_id
    if res["guardrail_allowed"]:
        assert res["requires_approval"] is True
        assert len(res["itinerary"]) > 0

        # Step 2: Resume graph execution with approval
        res_approved = await resume_travel_agent_async(thread_id=thread_id, approved=True)
        assert res_approved["requires_approval"] is False
        assert len(res_approved["answer"]) > 0
        assert res_approved["approved"] is True
