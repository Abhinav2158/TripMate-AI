from pathlib import Path
import traceback

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from backend import run_travel_agent_async, resume_travel_agent_async

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="TripMate AI",
    description=(
        "LangGraph Multi-Agent Travel Planner with Supervisor, Guardrails, "
        "Human-in-the-Loop, and FastAPI Frontend"
    ),
    version="2.1.0",
)

app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class TravelRequest(BaseModel):
    message: str
    thread_id: str | None = None


class ApprovalRequest(BaseModel):
    thread_id: str = Field(min_length=1)
    approved: bool
    feedback: str = ""


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )


@app.post("/api/travel")
async def travel_planner(request_data: TravelRequest):
    try:
        user_message = request_data.message.strip()

        if not user_message:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Message cannot be empty.",
                },
            )

        result = await run_travel_agent_async(
            user_input=user_message,
            thread_id=request_data.thread_id,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print("ERROR:", exc)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc),
            },
        )


@app.post("/api/travel/approve")
async def approve_travel_plan(request_data: ApprovalRequest):
    try:
        if not request_data.approved and not request_data.feedback.strip():
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Please provide revision feedback when rejecting the draft.",
                },
            )

        result = await resume_travel_agent_async(
            thread_id=request_data.thread_id,
            approved=request_data.approved,
            feedback=request_data.feedback,
        )

        return JSONResponse(
            content={
                "success": True,
                **result,
            }
        )

    except Exception as exc:
        print("APPROVAL ERROR:", exc)
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(exc),
            },
        )


@app.get("/api/geocode")
async def geocode_location(q: str):
    query = (q or "").strip()
    if not query:
        return JSONResponse(status_code=400, content={"error": "Query required"})

    key = query.lower()
    
    # 1. Try Nominatim OpenStreetMap (supports all campuses, landmarks, universities, cities)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=4.5) as client:
            headers = {"User-Agent": "TripMateAI-App/2.1 (travel-planner)"}
            res = await client.get(
                f"https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1&addressdetails=1",
                headers=headers
            )
            if res.status_code == 200:
                data = res.json()
                if data and len(data) > 0:
                    item = data[0]
                    return JSONResponse(content={
                        "lat": float(item["lat"]),
                        "lon": float(item["lon"]),
                        "display_name": item.get("display_name", query),
                        "name": item.get("name") or query,
                        "type": item.get("type", "landmark"),
                        "source": "nominatim"
                    })
    except Exception as exc:
        print(f"Nominatim geocoding notice: {exc}")

    # 2. Try Photon Komoot API (global OpenStreetMap index)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=4.5) as client:
            headers = {"User-Agent": "Mozilla/5.0"}
            res = await client.get(
                f"https://photon.komoot.io/api/?q={query}&limit=1",
                headers=headers
            )
            if res.status_code == 200:
                data = res.json()
                features = data.get("features", [])
                if features:
                    feat = features[0]
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    props = feat.get("properties", {})
                    if len(coords) >= 2:
                        return JSONResponse(content={
                            "lat": float(coords[1]),
                            "lon": float(coords[0]),
                            "display_name": f"{props.get('name', query)}, {props.get('city', '')} {props.get('state', '')} {props.get('country', '')}".strip(" ,"),
                            "name": props.get("name") or query,
                            "type": props.get("type", "location"),
                            "source": "photon"
                        })
    except Exception as exc:
        print(f"Photon geocoding notice: {exc}")

    # 3. Try Open-Meteo Geocoding
    try:
        import httpx
        clean_name = query.split(",")[0].replace("campus", "").replace("university", "").strip()
        async with httpx.AsyncClient(timeout=4.5) as client:
            res = await client.get(
                f"https://geocoding-api.open-meteo.com/v1/search?name={clean_name}&count=1&format=json"
            )
            if res.status_code == 200:
                data = res.json()
                results = data.get("results", [])
                if results:
                    item = results[0]
                    return JSONResponse(content={
                        "lat": float(item["latitude"]),
                        "lon": float(item["longitude"]),
                        "display_name": f"{item.get('name', query)}, {item.get('admin1', '')} {item.get('country', '')}".strip(" ,"),
                        "name": item.get("name") or query,
                        "type": "city",
                        "source": "open-meteo"
                    })
    except Exception as exc:
        print(f"Open-Meteo geocoding notice: {exc}")

    return JSONResponse(status_code=404, content={"error": f"Coordinates not found for {query}"})


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "TripMate AI API is running natively async",
        "features": [
            "supervisor_agent",
            "input_guardrail",
            "human_in_the_loop",
            "parallel_fanout_execution",
            "pydantic_structured_outputs",
            "enhanced_geocoding_api",
        ],
    }


@app.get("/favicon.ico")
async def favicon():
    return JSONResponse(content={})


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
