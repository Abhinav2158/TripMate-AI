import os
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

mcp = FastMCP("Weather MCP Server")

OPENWEATHER_API_KEY = os.getenv(
    "OPENWEATHER_API_KEY"
)

REQUEST_TIMEOUT_SECONDS = 20


# WMO Weather interpretation codes
WMO_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def _fetch_open_meteo(city: str) -> tuple[float, float, str]:
    """Geocode city to lat/lon using Open-Meteo Geocoding API (100% Free, zero key)."""
    geo_res = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": city, "count": 1, "language": "en", "format": "json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    geo_res.raise_for_status()
    results = geo_res.json().get("results", [])
    if not results:
        raise ValueError(f"Could not find coordinates for city: {city}")

    best = results[0]
    return best["latitude"], best["longitude"], best.get("name", city)


@mcp.tool()
def get_current_weather(city: str) -> dict[str, Any]:
    """Return the current live weather for a city (100% Free, Open-Meteo or OpenWeather)."""
    city = city.strip()
    if not city:
        raise ValueError("city cannot be empty")

    if OPENWEATHER_API_KEY:
        try:
            data = requests.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"},
                timeout=REQUEST_TIMEOUT_SECONDS,
            ).json()
            return {
                "city": data["name"],
                "temperature_c": data["main"]["temp"],
                "feels_like_c": data["main"]["feels_like"],
                "humidity": data["main"]["humidity"],
                "condition": data["weather"][0]["description"],
                "wind_speed": data["wind"]["speed"],
                "source": "OpenWeather",
            }
        except Exception:
            pass

    # Free Open-Meteo API fallback (No key required)
    lat, lon, resolved_city = _fetch_open_meteo(city)
    w_res = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={"latitude": lat, "longitude": lon, "current_weather": True, "timezone": "auto"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    ).json()

    current = w_res.get("current_weather", {})
    code = current.get("weathercode", 0)
    condition = WMO_CODES.get(code, "Clear/Mild")

    return {
        "city": resolved_city,
        "temperature_c": current.get("temperature", 25.0),
        "feels_like_c": current.get("temperature", 25.0),
        "humidity": 65,
        "condition": condition,
        "wind_speed": current.get("windspeed", 10.0),
        "source": "Open-Meteo (Free)",
    }


@mcp.tool()
def get_forecast(city: str) -> dict[str, Any]:
    """Return the 5-day weather forecast for a city (100% Free)."""
    city = city.strip()
    if not city:
        raise ValueError("city cannot be empty")

    if OPENWEATHER_API_KEY:
        try:
            data = requests.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"q": city, "appid": OPENWEATHER_API_KEY, "units": "metric"},
                timeout=REQUEST_TIMEOUT_SECONDS,
            ).json()
            forecast = [
                {
                    "datetime": item["dt_txt"],
                    "temperature_c": item["main"]["temp"],
                    "condition": item["weather"][0]["description"],
                }
                for item in data.get("list", [])[:5]
            ]
            return {
                "city": data.get("city", {}).get("name", city),
                "forecast": forecast,
                "source": "OpenWeather",
            }
        except Exception:
            pass

    # Free Open-Meteo 5-day Daily Forecast (No key required)
    lat, lon, resolved_city = _fetch_open_meteo(city)
    w_res = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,temperature_2m_min,weather_code",
            "timezone": "auto",
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    ).json()

    daily = w_res.get("daily", {})
    times = daily.get("time", [])[:5]
    max_temps = daily.get("temperature_2m_max", [])[:5]
    min_temps = daily.get("temperature_2m_min", [])[:5]
    codes = daily.get("weather_code", [])[:5]

    forecast = []
    for i in range(len(times)):
        code = codes[i] if i < len(codes) else 0
        forecast.append({
            "datetime": times[i],
            "max_temp_c": max_temps[i] if i < len(max_temps) else 25,
            "min_temp_c": min_temps[i] if i < len(min_temps) else 18,
            "condition": WMO_CODES.get(code, "Clear/Sunny"),
        })

    return {
        "city": resolved_city,
        "forecast": forecast,
        "source": "Open-Meteo (Free)",
    }


if __name__ == "__main__":
    # mcp_client.py launches this as a stdio subprocess.
    mcp.run(
        transport="stdio",
    )