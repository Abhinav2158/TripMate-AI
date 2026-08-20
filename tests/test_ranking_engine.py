import pytest
from schemas import UserProfile, HardConstraints, SoftPreferences, ScoreWaterfall, RankedCandidate
from knowledge_base.db import get_all_destinations, get_destination_by_id
from ranking_engine import filter_hard_constraints, rank_candidates, generate_recommendation_decision


def test_knowledge_base_loaded():
    destinations = get_all_destinations()
    assert len(destinations) >= 10
    manali = get_destination_by_id("manali_in")
    assert manali is not None
    assert manali["country"] == "India"
    assert "risks" in manali
    assert "who_should_not_visit" in manali["risks"]


def test_hard_constraint_budget_and_days_filtering():
    all_dests = get_all_destinations()
    # User has 3 days and 20,000 INR budget in July (Monsoon season for Himalayas)
    constraints = HardConstraints(
        max_budget_inr=20000,
        max_available_days=3,
        travel_month="July"
    )
    valid, eliminated = filter_hard_constraints(all_dests, constraints)
    
    # Dubai / Japan should be pruned due to budget/days
    eliminated_ids = [e["id"] for e in eliminated]
    assert "dubai_ae" in eliminated_ids or "japan_jp" in eliminated_ids
    
    # Manali / Sikkim should be pruned in July due to severe monsoon / unsuitability (< 0.30)
    assert "manali_in" in eliminated_ids or "sikkim_in" in eliminated_ids


def test_multi_criteria_ranking_and_waterfall():
    all_dests = get_all_destinations()
    # Mountain adventure preference in October with 40k budget
    profile = UserProfile(
        hard_constraints=HardConstraints(
            max_budget_inr=40000,
            max_available_days=5,
            travel_month="October"
        ),
        soft_preferences=SoftPreferences(
            nature_weight=0.9,
            adventure_weight=0.8,
            relaxation_weight=0.6,
            crowd_aversion=0.7
        )
    )
    
    decision = generate_recommendation_decision(profile, all_dests)
    assert decision.best_destination is not None
    best = decision.best_destination
    
    # Overall score should be between 10 and 100
    assert 10.0 <= best.overall_fit_score <= 100.0
    
    # Waterfall must have valid attributes
    assert isinstance(best.score_waterfall, ScoreWaterfall)
    assert best.score_waterfall.budget_fit > 0
    assert best.score_waterfall.season_fit > 0
    assert best.score_waterfall.nature_match > 0
    
    # Critical analysis must be present
    assert len(best.critical_analysis.advantages) > 0
    assert len(best.critical_analysis.disadvantages) > 0
    assert len(best.critical_analysis.who_should_not_visit) > 0
    
    # Alternatives should have rank and why_ranked_lower
    assert len(decision.alternatives) > 0
    for alt in decision.alternatives:
        assert alt.rank > 1
        assert alt.why_ranked_lower is not None


def test_anti_persona_generation():
    manali = get_destination_by_id("manali_in")
    assert "risks" in manali
    assert "who_should_not_visit" in manali["risks"]
    assert len(manali["risks"]["who_should_not_visit"]) > 10
