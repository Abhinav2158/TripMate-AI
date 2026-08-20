# Multi-Agent-System-using-LangGraph-MCP-Supervisor-Guardrails-HITL

A demo multi-agent system that uses LangGraph and MCP to implement a travel-planning assistant with a Supervisor, input Guardrails, and Human-In-The-Loop (HITL) approval flows. The project includes a FastAPI frontend, example MCP server, and client helpers to demonstrate how agents, supervisors, and guardrails can be composed into a safe, reviewable planning pipeline.

## Architecture

```text
                          USER
                           │
                           ▼
                 ┌───────────────────┐
                 │    FastAPI / UI   │
                 └─────────┬─────────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │  INPUT GUARDRAIL  │
                 │ validation/safety │
                 └─────────┬─────────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │    SUPERVISOR     │
                 │    LangGraph      │
                 └─────────┬─────────┘
                           │
           ┌───────────────┼────────────────┐
           │               │                │
           ▼               ▼                ▼
    Preference Agent   Destination      Constraint
                       Agent            Agent
           │               │                │
           └───────────────┼────────────────┘
                           ▼
                 ┌───────────────────┐
                 │  Research / Data  │
                 │  Agents via MCP   │
                 └─────────┬─────────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
        Weather         Transport         Cost
         MCP               MCP             MCP
           │               │                │
           └───────────────┼────────────────┘
                           ▼
                 ┌───────────────────┐
                 │  Recommendation   │
                 │  / Ranking Agent  │
                 └─────────┬─────────┘
                           ▼
                 ┌───────────────────┐
                 │ Critical Analysis │
                 │       Agent       │
                 └─────────┬─────────┘
                           ▼
                 ┌───────────────────┐
                 │  Itinerary Agent  │
                 └─────────┬─────────┘
                           ▼
                 ┌───────────────────┐
                 │   Verification    │
                 │   / Guardrail     │
                 └─────────┬─────────┘
                           ▼
                 ┌───────────────────┐
                 │       HITL        │
                 │  User Approval    │
                 └─────────┬─────────┘
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
              APPROVED           REVISE
                  │                 │
                  ▼                 └──────► Supervisor
              FINAL PLAN   
```

### Architecture Pipeline & Core Components

1. **Input Guardrail**: Validates user intent, blocks off-topic queries, malicious prompt injections, and invalid safety requests before execution.
2. **LangGraph Supervisor**: Orchestrates specialist agents, dynamic routing, shared state, and task synchronization.
3. **Preference, Destination & Constraint Agents**: Extracts structured preferences (budget, days, interests, travel style), validates hard constraints vs. soft preferences, and generates candidate pools.
4. **Research / Data Agents via Model Context Protocol (MCP)**:
   - **Weather MCP**: Real-time forecasts, season suitability, and climate alerts.
   - **Transport MCP**: Flight schedules, route friction, and transit difficulty.
   - **Cost MCP**: Budget estimation, daily spend breakdown, and surge risk prediction.
5. **Recommendation & Multi-Criteria Ranking Agent**: Deterministic scoring engine evaluating candidates across multi-dimensional criteria (Budget Fit, Season Fit, Interest Alignment, Friction Penalty) with score waterfall explainability.
6. **Critical Analysis Engine**: Evaluates trade-offs, advantages, disadvantages, tourist traps, and the crucial *"Who should NOT visit"* anti-persona assessment.
7. **Itinerary Agent & Output Guardrails**: Synthesizes verified data into actionable day-by-day itineraries and sanity-checks feasibility.
8. **Human-In-The-Loop (HITL) Checkpoint**: Pauses execution via LangGraph memory checkpointer for user approval, feedback, or iterative refinement before final plan delivery.

---

## Contents
- `app.py`: FastAPI web frontend and API endpoints
- `backend.py`: core agent orchestration / travel-planner logic
- `mcp_client.py`: client helpers to interact with the MCP server
- `custom_weather_mcp_server.py`: example MCP server for weather checks
- `templates/`, `static/`: frontend UI assets (HTML, JS, CSS)

Features
- Interactive web UI for sending travel planning prompts
- Endpoint for drafting travel plans and separate approval endpoint
- Example MCP server demonstrating domain adapters (weather, checkpoints)

Prerequisites
- Python 3.10+ (recommended)
- Git (to clone the repo)
- A virtual environment tool (venv) or similar

Quick start (Windows)

1. Create and activate a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1    # PowerShell
```

2. Install dependencies

```powershell
pip install -r requirements.txt
```

3. Run the FastAPI app (development)

```powershell
# option A (run module)
python app.py

# option B (uvicorn)
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

4. Open the web UI

Visit http://127.0.0.1:8000 in your browser to use the TripMate frontend.

Running the MCP server (example)
- The repository includes `custom_weather_mcp_server.py` as an example MCP server. Run it in a separate terminal if you want to experiment with custom adapters used by the demo.

```powershell
# start example MCP server (if needed)
python custom_weather_mcp_server.py
```

API Endpoints
- `POST /api/travel` — create or resume a travel planning thread. JSON: `{ "message": "<user prompt>", "thread_id": "optional-thread-id" }`
- `POST /api/travel/approve` — approve or request revisions for a draft. JSON: `{ "thread_id": "<id>", "approved": true|false, "feedback": "optional" }`
- `GET /health` — basic health check and features list

Configuration & environment
- Secrets and API keys are not included in the repo. Use environment variables or a `.env` file for any required keys consumed by `langgraph`, `langchain`, or other adapters.

Development notes
- The project keeps synchronous convenience wrappers in `backend.py` while running an async FastAPI server — `nest_asyncio` is applied in `app.py` to allow the sync helpers to call async MCP helpers.
- Tests are not included; to experiment, interact with the web UI or call the API endpoints directly.

Contributing
- Contributions are welcome. Please open issues or pull requests for bug fixes, documentation improvements, or new adapter examples.

License
- This repository follows the license in the `LICENSE` file.

Acknowledgements
- Built as a demonstration of LangGraph + MCP patterns with supervisor and guardrail concepts.

Contact
- For questions or suggestions, open an issue or contact the repository owner.
