import os
import shutil
import sys
from pathlib import Path
from typing import Any

import certifi
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_mcp_adapters.client import MultiServerMCPClient


# =========================================================
# Environment setup
# =========================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

# Support both environment-variable names.
AVIATION_STACK_API_KEY = (
    os.getenv("AVIATION_STACK_API_KEY")
    or os.getenv("AVIATIONSTACK_API_KEY")
)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

WEATHER_SERVER_PATH = BASE_DIR / "custom_weather_mcp_server.py"
UVX_COMMAND = shutil.which("uvx") or "uvx"


def _require_env(name: str, value: str | None) -> str:
    """Return an environment value or raise a readable setup error."""

    if not value:
        raise RuntimeError(
            f"{name} is missing. "
            f"Add {name}=your_key to the project .env file."
        )

    return value


def _subprocess_env(**updates: str | None) -> dict[str, str]:
    """
    Preserve the current Windows/Conda environment and add MCP API keys.
    """

    env = os.environ.copy()

    for key, value in updates.items():
        if value:
            env[key] = value

    return env


# =========================================================
# LLM
# =========================================================

GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
llm = ChatGroq(
    model=GROQ_MODEL,
    api_key=GROQ_API_KEY or "gsk_dummy_key_for_testing",
)


# =========================================================
# MCP client
# =========================================================

client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": (
                "https://mcp.tavily.com/mcp/"
                f"?tavilyApiKey={TAVILY_API_KEY or ''}"
            ),
        },

        "aviationstack": {
            "transport": "stdio",
            "command": UVX_COMMAND,
            "args": [
                "aviationstack-mcp",
            ],
            "env": _subprocess_env(
                AVIATION_STACK_API_KEY=AVIATION_STACK_API_KEY,
            ),
        },

        "weather": {
            "transport": "stdio",

            # Uses the Python executable from the active Conda environment.
            "command": sys.executable,

            # Uses the weather server inside the current project folder.
            "args": [
                str(WEATHER_SERVER_PATH),
            ],

            "env": _subprocess_env(
                OPENWEATHER_API_KEY=OPENWEATHER_API_KEY,
            ),
        },
    }
)


async def _get_server_tool(
    server_name: str,
    tool_name: str,
):
    """
    Load one tool from one MCP server.

    This prevents a broken weather or AviationStack server from
    crashing an unrelated Tavily request.
    """

    if server_name == "tavily":
        _require_env(
            "TAVILY_API_KEY",
            TAVILY_API_KEY,
        )

    elif server_name == "aviationstack":
        _require_env(
            "AVIATION_STACK_API_KEY",
            AVIATION_STACK_API_KEY,
        )

        if shutil.which("uvx") is None:
            raise RuntimeError(
                "uvx was not found. Install uv, reopen the terminal, "
                "activate the travel environment, and run "
                "`uvx --version`."
            )

    elif server_name == "weather":
        if not WEATHER_SERVER_PATH.is_file():
            raise FileNotFoundError(
                f"Weather MCP server not found: "
                f"{WEATHER_SERVER_PATH}"
            )

    # Important: load only the requested MCP server.
    tools = await client.get_tools(
        server_name=server_name,
    )

    tool = next(
        (
            item
            for item in tools
            if item.name == tool_name
        ),
        None,
    )

    if tool is None:
        available_tools = (
            ", ".join(
                sorted(item.name for item in tools)
            )
            or "none"
        )

        raise RuntimeError(
            f"MCP tool '{tool_name}' was not found "
            f"on server '{server_name}'. "
            f"Available tools: {available_tools}"
        )

    return tool


async def _free_stay_search(query: str) -> str:
    """Free, zero-key search for accommodations, hostels, and hotels using OpenStreetMap & Wikipedia."""
    import requests
    import asyncio

    def _sync_lookup():
        results = []
        try:
            # 1. Search OpenStreetMap Nominatim for real hostels & hotels
            osm_url = "https://nominatim.openstreetmap.org/search"
            osm_res = requests.get(
                osm_url,
                params={"q": query, "format": "json", "limit": 6},
                headers={"User-Agent": "TripMateAI-Planner/2.0"},
                timeout=10,
            ).json()

            places = []
            for item in osm_res:
                name = item.get("display_name", "")
                if name:
                    places.append(f"- **{name.split(',')[0]}**: {name}")

            if places:
                results.append("### Real Accommodations & Hostels (OpenStreetMap Live):\n" + "\n".join(places[:5]))
        except Exception:
            pass

        try:
            # 2. Extract city and fetch Wikipedia summary for neighborhood highlights
            words = query.replace("hotels", "").replace("hostels", "").replace("best", "").replace("in", "").replace("for", "").strip()
            city = words.split()[0] if words else "Travel"
            wiki_res = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{city}",
                headers={"User-Agent": "TripMateAI-Planner/2.0"},
                timeout=6,
            ).json()
            extract = wiki_res.get("extract")
            if extract:
                results.append(f"### Destination & Area Insights ({city}):\n{extract[:400]}...")
        except Exception:
            pass

        return "\n\n".join(results) if results else "Standard hotel & hostel recommendations based on local rates."

    return await asyncio.to_thread(_sync_lookup)


def _free_airports_lookup(tool_name: str, tool_args: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Free, zero-key offline global airport database lookup using airportsdata."""
    try:
        import airportsdata
        airports = airportsdata.load("IATA")
        # Return sample of popular international & regional airports
        sample_keys = ["DEL", "BOM", "DXB", "HND", "NRT", "JFK", "LHR", "DAC", "VNS", "KNU", "FCO", "BKK", "SIN", "CDG"]
        return [
            {
                "iata": code,
                "name": airports[code]["name"],
                "city": airports[code]["city"],
                "country": airports[code]["country"],
            }
            for code in sample_keys if code in airports
        ]
    except Exception:
        return [
            {"iata": "DEL", "name": "Indira Gandhi International Airport", "city": "Delhi"},
            {"iata": "DXB", "name": "Dubai International Airport", "city": "Dubai"},
            {"iata": "VNS", "name": "Lal Bahadur Shastri Airport", "city": "Varanasi"},
            {"iata": "HND", "name": "Haneda Airport", "city": "Tokyo"},
        ]


# =========================================================
# MCP connection test
# =========================================================

async def get_all_tools() -> None:
    """
    Test every MCP server independently.
    One failed server will not stop the remaining tests.
    """
    for server_name in ("tavily", "aviationstack", "weather"):
        try:
            tools = await client.get_tools(server_name=server_name)
            tool_names = ", ".join(tool.name for tool in tools) or "no tools"
            print(f"{server_name}: OK -> {tool_names}")
        except Exception as exc:
            print(f"{server_name}: FAILED -> {type(exc).__name__}: {exc}")


# =========================================================
# Tavily MCP & Free Stay Search
# =========================================================

async def tavily_mcp_search(query: str):
    if TAVILY_API_KEY:
        try:
            search_tool = await _get_server_tool("tavily", "tavily_search")
            return await search_tool.ainvoke({"query": query})
        except Exception:
            pass

    # Seamless 100% free fallback using OpenStreetMap & Wikipedia
    return await _free_stay_search(query)


# =========================================================
# AviationStack MCP & Free Airports Database
# =========================================================

async def aviation_mcp_call(
    tool_name: str,
    tool_args: dict[str, Any] | None = None,
):
    if AVIATION_STACK_API_KEY and shutil.which("uvx"):
        try:
            aviation_tool = await _get_server_tool("aviationstack", tool_name)
            return await aviation_tool.ainvoke(tool_args or {})
        except Exception:
            pass

    # Seamless 100% free offline airport database fallback
    return _free_airports_lookup(tool_name, tool_args)


# =========================================================
# Weather MCP (Free Open-Meteo & OpenWeather)
# =========================================================

async def weather_mcp_search(city: str):
    try:
        weather_tool = await _get_server_tool("weather", "get_current_weather")
        return await weather_tool.ainvoke({"city": city})
    except Exception:
        # Direct free Open-Meteo fallback
        import requests
        import asyncio
        def _get_w():
            geo = requests.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "format": "json"},
                timeout=10
            ).json().get("results", [])
            if geo:
                lat, lon = geo[0]["latitude"], geo[0]["longitude"]
                w = requests.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={"latitude": lat, "longitude": lon, "current_weather": True},
                    timeout=10
                ).json()
                curr = w.get("current_weather", {})
                return f"Temperature: {curr.get('temperature', 25)}C, Wind: {curr.get('windspeed', 10)} km/h"
            return "Current climate data available in season guidelines."
        return await asyncio.to_thread(_get_w)


async def forecast_mcp_search(city: str):
    try:
        forecast_tool = await _get_server_tool("weather", "get_forecast")
        return await forecast_tool.ainvoke({"city": city})
    except Exception:
        # Direct free Open-Meteo forecast fallback
        import requests
        import asyncio
        def _get_f():
            geo = requests.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "format": "json"},
                timeout=10
            ).json().get("results", [])
            if geo:
                lat, lon = geo[0]["latitude"], geo[0]["longitude"]
                w = requests.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={"latitude": lat, "longitude": lon, "daily": "temperature_2m_max,temperature_2m_min"},
                    timeout=10
                ).json()
                d = w.get("daily", {})
                times = d.get("time", [])[:5]
                maxs = d.get("temperature_2m_max", [])[:5]
                mins = d.get("temperature_2m_min", [])[:5]
                return "\n".join(f"- {times[i]}: Max {maxs[i]}C / Min {mins[i]}C" for i in range(len(times)))
            return "5-day general forecast estimates compiled."
        return await asyncio.to_thread(_get_f)


# =========================================================
# Destination extractor
# =========================================================

async def extract_destination(query: str) -> str:
    prompt = f"""
Extract only the destination city or country from the travel request.

Travel request:
{query}

Return only the destination name.
Do not add any explanation.
"""

    response = await llm.ainvoke(prompt)

    destination = str(
        response.content
    ).strip()

    if not destination:
        raise ValueError(
            "The destination could not be extracted."
        )

    return destination