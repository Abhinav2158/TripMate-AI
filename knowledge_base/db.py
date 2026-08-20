import json
from pathlib import Path
from typing import List, Optional, Dict, Any

KB_DIR = Path(__file__).resolve().parent
DESTINATIONS_FILE = KB_DIR / "destinations.json"

_DESTINATIONS_CACHE: Optional[List[Dict[str, Any]]] = None

def load_destinations() -> List[Dict[str, Any]]:
    global _DESTINATIONS_CACHE
    if _DESTINATIONS_CACHE is not None:
        return _DESTINATIONS_CACHE
    
    if not DESTINATIONS_FILE.exists():
        return []
    
    with open(DESTINATIONS_FILE, "r", encoding="utf-8") as f:
        _DESTINATIONS_CACHE = json.load(f)
    return _DESTINATIONS_CACHE

def get_destination_by_id(dest_id: str) -> Optional[Dict[str, Any]]:
    for d in load_destinations():
        if d["id"].lower() == dest_id.lower():
            return d
    return None

def find_destinations_by_name(query: str) -> List[Dict[str, Any]]:
    q = query.lower().strip()
    matches = []
    for d in load_destinations():
        if q in d["name"].lower() or q in d["id"].lower() or q in d.get("country", "").lower():
            matches.append(d)
    return matches

def get_all_destinations() -> List[Dict[str, Any]]:
    return list(load_destinations())
