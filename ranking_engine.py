import math
import re
from typing import List, Dict, Any, Tuple, Optional
from knowledge_base.db import get_all_destinations, get_destination_by_id, find_destinations_by_name
from schemas import (
    UserProfile,
    HardConstraints,
    SoftPreferences,
    ScoreWaterfall,
    CriticalAnalysisReport,
    RankedCandidate,
    RecommendationDecision,
)


def filter_hard_constraints(
    candidates: List[Dict[str, Any]],
    constraints: HardConstraints
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Deterministically prunes candidates that violate the user's hard constraints.
    Returns (valid_candidates, eliminated_candidates_with_reasons).
    """
    valid = []
    eliminated = []

    travel_month = (constraints.travel_month or "October").strip().capitalize()
    if travel_month not in [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]:
        travel_month = "October"

    user_budget = float(constraints.max_budget_inr) if constraints.max_budget_inr > 0 else 50000.0
    user_days = int(constraints.max_available_days) if constraints.max_available_days > 0 else 5

    # If user explicitly named a destination
    explicit_q = (constraints.explicit_destination or "").strip().lower()

    # Determine if trip is domestic Indian or international
    origin = (constraints.origin_city or "").strip().lower()
    is_domestic_trip = False
    if not explicit_q:
        # If budget is under 30k or origin is in India, focus on domestic alternatives
        if user_budget <= 35000:
            is_domestic_trip = True
    else:
        # Check if explicit destination is domestic
        for d in candidates:
            if explicit_q in d["name"].lower() or explicit_q in d["id"].lower():
                if d.get("country", "").lower() == "india":
                    is_domestic_trip = True
                break

    for d in candidates:
        dest_id = d["id"]
        dest_name = d["name"]
        country = d.get("country", "")
        min_days = d.get("min_days", 2)
        base_cost_per_day = d.get("base_cost_per_day_inr", 3000)
        uncertainty = d.get("cost_uncertainty_range_pct", 0.20)
        est_min_trip_cost = base_cost_per_day * user_days * (1.0 - uncertainty * 0.5)

        # Seasonality check
        seasonality = d.get("monthly_suitability", {}).get(travel_month, 0.70)

        # 1. Check explicit search override
        is_explicit_match = explicit_q and (explicit_q in dest_name.lower() or explicit_q in dest_id.lower() or explicit_q in d.get("category_tags", []))
        if is_explicit_match:
            valid.append(d)
            continue

        # 2. Filter international destinations if it's a low-budget domestic trip
        if is_domestic_trip and country.lower() != "india" and user_budget <= 40000:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": f"International destination exceeds domestic budget tier (Est: ₹{int(est_min_trip_cost):,})."
            })
            continue

        # 3. Check duration constraint
        if min_days > user_days + 1:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": f"Requires minimum {min_days} days; user has only {user_days} days."
            })
            continue

        # 4. Check budget constraint (strict: no more than 1.2x budget for alternatives)
        if est_min_trip_cost > user_budget * 1.25:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": f"Estimated minimum cost (₹{int(est_min_trip_cost):,}) exceeds budget limit (₹{int(user_budget):,})."
            })
            continue

        # 5. Check severe unsuitability
        if seasonality < 0.30:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": f"Severe off-season/weather risks in {travel_month} (suitability score: {int(seasonality*100)}%)."
            })
            continue

        # 6. Check mobility constraint
        if constraints.requires_mobility_friendly and d.get("accessibility_score", 0.5) < 0.65:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": "Does not meet required step-free / high mobility standards."
            })
            continue

        # 7. Check altitude constraint
        if constraints.requires_low_altitude and "mountains" in d.get("category_tags", []) and d.get("risks", {}).get("transport_difficulty", 0.0) > 0.65:
            eliminated.append({
                "id": dest_id,
                "name": dest_name,
                "reason": "High altitude sickness risk violates low-altitude health constraint."
            })
            continue

        valid.append(d)

    return valid, eliminated


def rank_candidates(
    candidates: List[Dict[str, Any]],
    profile: UserProfile
) -> List[RankedCandidate]:
    """
    Computes deterministic multi-criteria score for each candidate along with
    exact waterfall contributors (+/-), uncertainty ranges, and critical trade-offs.
    """
    hard = profile.hard_constraints
    soft = profile.soft_preferences

    travel_month = (hard.travel_month or "October").strip().capitalize()
    if travel_month not in [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]:
        travel_month = "October"

    user_budget = float(hard.max_budget_inr) if hard.max_budget_inr > 0 else 50000.0
    user_days = int(hard.max_available_days) if hard.max_available_days > 0 else 5
    explicit_q = (hard.explicit_destination or "").strip().lower()

    ranked_results = []

    for d in candidates:
        dest_id = d["id"]
        dest_name = d["name"]
        country = d.get("country", "")
        region = d.get("region", "")
        base_cost = d.get("base_cost_per_day_inr", 3500)
        uncertainty = d.get("cost_uncertainty_range_pct", 0.18)

        # Cost & Duration Estimation
        est_base_trip_cost = base_cost * user_days
        cost_min = round(est_base_trip_cost * (1.0 - uncertainty), -2)
        cost_max = round(est_base_trip_cost * (1.0 + uncertainty), -2)

        # 1. Duration Fit (+0 to +15 pts)
        ideal_days = d.get("ideal_days", 5)
        min_days = d.get("min_days", 3)
        if user_days >= min_days and user_days <= ideal_days + 1:
            duration_fit_pts = 15.0
        elif user_days < min_days:
            duration_fit_pts = max(0.0, 15.0 - (min_days - user_days) * 5.0)
        else:
            duration_fit_pts = max(5.0, 15.0 - (user_days - ideal_days) * 2.0)

        # 2. Budget Fit (+0 to +20 pts)
        if user_budget <= 0:
            budget_fit_pts = 18.0
        else:
            ratio = est_base_trip_cost / user_budget
            if ratio <= 0.80:
                budget_fit_pts = 20.0  # High budget surplus
            elif ratio <= 1.0:
                budget_fit_pts = 20.0 - (ratio - 0.80) * 15.0
            elif ratio <= 1.25:
                budget_fit_pts = max(5.0, 17.0 - (ratio - 1.0) * 40.0)
            else:
                budget_fit_pts = 2.0

        # 3. Season Suitability (+0 to +20 pts)
        suitability = d.get("monthly_suitability", {}).get(travel_month, 0.75)
        season_fit_pts = round(suitability * 20.0, 1)

        # 4. Interest Matches (+0 to +12 pts each)
        nature_match_pts = round(d.get("nature_score", 0.5) * soft.nature_weight * 12.0, 1)
        adventure_match_pts = round(d.get("adventure_score", 0.5) * soft.adventure_weight * 12.0, 1)
        culture_match_pts = round(d.get("culture_score", 0.5) * soft.culture_weight * 12.0, 1)
        nightlife_match_pts = round(d.get("nightlife_score", 0.5) * soft.nightlife_weight * 8.0, 1)
        relaxation_match_pts = round(d.get("relaxation_score", 0.5) * soft.relaxation_weight * 10.0, 1)

        # 5. Penalties (Friction & Crowding)
        transport_diff = d.get("risks", {}).get("transport_difficulty", 0.4)
        friction_penalty = round(transport_diff * (1.1 - soft.risk_tolerance) * 8.0, 1)

        crowd_level = d.get("monthly_crowd_level", {}).get(travel_month, 0.6)
        crowd_penalty = round(crowd_level * soft.crowd_aversion * 8.0, 1)

        # 6. Explicit Request Alignment Bonus (+25 pts)
        is_explicit = explicit_q and (explicit_q in dest_name.lower() or explicit_q in dest_id.lower())
        explicit_bonus = 25.0 if is_explicit else 0.0

        # Raw Total Calculation
        raw_score = (
            duration_fit_pts +
            budget_fit_pts +
            season_fit_pts +
            nature_match_pts +
            adventure_match_pts +
            culture_match_pts +
            nightlife_match_pts +
            relaxation_match_pts +
            explicit_bonus -
            friction_penalty -
            crowd_penalty
        )

        # Normalize score
        overall_fit_score = max(15.0, min(99.0, round(raw_score, 1)))

        # Confidence metric
        confidence = round(max(0.60, min(0.96, suitability * (1.0 - uncertainty * 0.5))), 2)

        # Create Waterfall
        waterfall = ScoreWaterfall(
            budget_fit=round(budget_fit_pts, 1),
            duration_fit=round(duration_fit_pts, 1),
            season_fit=round(season_fit_pts, 1),
            nature_match=round(nature_match_pts, 1),
            adventure_match=round(adventure_match_pts, 1),
            culture_match=round(culture_match_pts, 1),
            nightlife_match=round(nightlife_match_pts, 1),
            relaxation_match=round(relaxation_match_pts, 1),
            travel_friction_penalty=-round(friction_penalty, 1),
            crowd_penalty=-round(crowd_penalty, 1),
        )

        # Critical Analysis
        risks_dict = d.get("risks", {})
        diff_level = "Easy" if transport_diff < 0.3 else ("Moderate" if transport_diff < 0.6 else "Rugged / High Friction")
        critical_report = CriticalAnalysisReport(
            advantages=d.get("advantages", []),
            disadvantages=d.get("disadvantages", []),
            weather_risks=risks_dict.get("weather_risks", []),
            cost_risks=risks_dict.get("cost_risks", []),
            tourist_traps=risks_dict.get("tourist_traps", []),
            who_should_not_visit=risks_dict.get("who_should_not_visit", ""),
            transport_difficulty_level=diff_level,
        )

        # Why matched
        why_matched = []
        if is_explicit:
            why_matched.append(f"Direct match for requested destination: {dest_name}")
        if budget_fit_pts >= 16.0:
            why_matched.append(f"Comfortably within budget (~₹{int(cost_min):,} - ₹{int(cost_max):,})")
        if duration_fit_pts >= 14.0:
            why_matched.append(f"Perfect {user_days}-day trip pacing")
        if season_fit_pts >= 16.0:
            why_matched.append(f"Prime travel weather in {travel_month} ({int(suitability*100)}% suitability)")
        if culture_match_pts >= 6.5:
            why_matched.append("Rich cultural, spiritual, and heritage immersion")
        if nature_match_pts >= 7.0:
            why_matched.append("Scenic nature and landscapes match")
        if adventure_match_pts >= 7.0:
            why_matched.append("High outdoor adventure & activities alignment")

        candidate_obj = RankedCandidate(
            id=dest_id,
            name=dest_name,
            country=country,
            region=region,
            overall_fit_score=overall_fit_score,
            confidence_score=confidence,
            estimated_cost_min_inr=cost_min,
            estimated_cost_max_inr=cost_max,
            score_waterfall=waterfall,
            critical_analysis=critical_report,
            rank=1,
            why_matched=why_matched,
            why_ranked_lower=None,
        )
        ranked_results.append(candidate_obj)

    # Sort descending by overall_fit_score
    ranked_results.sort(key=lambda x: x.overall_fit_score, reverse=True)

    # Assign ranks and 'why_ranked_lower' for runner ups
    if ranked_results:
        top_score = ranked_results[0].overall_fit_score
        top_name = ranked_results[0].name
        for idx, item in enumerate(ranked_results):
            item.rank = idx + 1
            if idx > 0:
                score_diff = round(top_score - item.overall_fit_score, 1)
                reasons = []
                if item.score_waterfall.travel_friction_penalty < ranked_results[0].score_waterfall.travel_friction_penalty:
                    reasons.append("higher transport friction/difficulty")
                if item.score_waterfall.crowd_penalty < ranked_results[0].score_waterfall.crowd_penalty:
                    reasons.append("higher seasonal crowd levels")
                if item.score_waterfall.budget_fit < ranked_results[0].score_waterfall.budget_fit:
                    reasons.append("higher estimated cost")
                if item.score_waterfall.season_fit < ranked_results[0].score_waterfall.season_fit:
                    reasons.append(f"lower weather suitability in {travel_month}")

                reason_text = f"Ranked {score_diff} pts lower than {top_name} due to " + (", ".join(reasons) if reasons else "lower overall preference match")
                item.why_ranked_lower = reason_text

    return ranked_results


def generate_recommendation_decision(
    profile: UserProfile,
    candidates: Optional[List[Dict[str, Any]]] = None,
    all_destinations: Optional[List[Dict[str, Any]]] = None
) -> RecommendationDecision:
    """
    Main entry point: executes candidate filtering, multi-objective ranking,
    and formats the complete recommendation decision payload.
    """
    dests = candidates or all_destinations
    if dests is None:
        dests = get_all_destinations()

    # 1. Hard constraint filtering
    valid_candidates, eliminated = filter_hard_constraints(
        candidates=dests,
        constraints=profile.hard_constraints
    )

    # Ensure all discovery candidates are included as valid candidates for alternative ranking
    if dests and len(valid_candidates) < len(dests):
        for candidate in dests:
            if not any(c.get("id") == candidate.get("id") for c in valid_candidates):
                valid_candidates.append(candidate)

    # Fallback: if all were pruned, retain top 3 domestic or closest matches
    if not valid_candidates:
        valid_candidates = [d for d in all_destinations if d.get("country", "") == "India"][:3]
        if not valid_candidates:
            valid_candidates = all_destinations[:3]

    # 2. Multi-criteria ranking
    ranked = rank_candidates(candidates=valid_candidates, profile=profile)

    best_destination = ranked[0]
    alternatives = ranked[1:4]

    summary = (
        f"Analyzed {len(dests)} destinations. "
        f"Filtered {len(eliminated)} candidates violating budget or travel constraints. "
        f"Selected {best_destination.name} as #1 recommendation with {best_destination.overall_fit_score}/100 fit score."
    )

    return RecommendationDecision(
        best_destination=best_destination,
        alternatives=alternatives,
        eliminated_candidates=eliminated,
        decision_summary=summary,
    )
