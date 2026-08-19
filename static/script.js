let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;

const AGENT_LABELS = {
  flight_agent: "✈️ Flight Agent",
  hotel_agent: "🏨 Hotel Agent",
  weather_agent: "🌦️ Weather Agent",
  budget_agent: "💰 Budget Agent",
  itinerary_agent: "🗓️ Itinerary Agent"
};

function setPrompt(text) {
  document.getElementById("userInput").value = text;
}

function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");
  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  sendBtn.disabled = isLoading;
  approveBtn.disabled = isLoading;
  reviseBtn.disabled = isLoading;

  if (isLoading && mode === "draft") {
    btnText.classList.add("hidden");
    btnLoader.classList.remove("hidden");
  } else {
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
  }
}

function showError(message) {
  const errorBox = document.getElementById("errorBox");
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function renderMarkdown(element, markdown) {
  if (typeof marked !== "undefined") {
    element.innerHTML = marked.parse(markdown || "");
  } else {
    element.innerText = markdown || "";
  }
}

function showWorkflow(data) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  reasoning.textContent = data.supervisor_reasoning || "Supervisor routing completed.";
  chips.innerHTML = "";

  (data.selected_agents || []).forEach((agent) => {
    const chip = document.createElement("span");
    chip.className = "agent-chip";
    chip.textContent = AGENT_LABELS[agent] || agent;
    chips.appendChild(chip);
  });

  if (data.guardrail_allowed === false) {
    guardrailBadge.textContent = "Guardrail blocked";
    guardrailBadge.classList.add("blocked");
  } else {
    guardrailBadge.textContent = "Guardrail passed";
    guardrailBadge.classList.remove("blocked");
  }

  section.classList.remove("hidden");
}

let travelMapInstance = null;
let currentCurrency = "USD";
let isSpeaking = false;
let speechUtterance = null;
let latestTripData = null;

let currentGroupSize = 1;

const CURRENCY_RATES = {
  USD: { symbol: "$", rate: 1 },
  INR: { symbol: "₹", rate: 86.5 },
  EUR: { symbol: "€", rate: 0.92 },
  AED: { symbol: "د.إ", rate: 3.67 },
  GBP: { symbol: "£", rate: 0.78 }
};

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  renderMarkdown(resultBox, latestAnswerMarkdown);
  threadInfo.textContent = `Thread ID: ${threadId}`;
  resultTitle.textContent = isDraft ? "Draft Travel Plan" : "Your Final AI Travel Plan";
  resultSection.classList.remove("hidden");

  // Render Interactive Map, Packing Checklist & Budget Visualizer
  renderInteractiveWidgets(latestTripData || {});

  // Render Interactive Day-by-Day Timeline
  renderDayTimeline(latestAnswerMarkdown);

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");
  approvalRequest.textContent = data.approval_request ||
    "Approve the draft or provide feedback before the final plan is generated.";
  section.classList.remove("hidden");
}

function hideApproval() {
  waitingForApproval = false;
  document.getElementById("approvalSection").classList.add("hidden");
  document.getElementById("approvalFeedback").value = "";
}

async function sendMessage() {
  hideError();

  // If user was in the middle of an approval, reset it so they can submit a fresh request anytime
  if (waitingForApproval) {
    waitingForApproval = false;
    hideApproval();
    currentThreadId = null;
    localStorage.removeItem("travel_thread_id");
  }

  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (!message) {
    showError("Please enter your travel request first.");
    return;
  }

  // Clear thread ID if starting a new plan from the input area
  currentThreadId = null;
  localStorage.removeItem("travel_thread_id");

  setLoading(true, "draft");

  try {
    const response = await fetch("/api/travel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        thread_id: currentThreadId
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Something went wrong.");
    }

    latestTripData = data;
    currentThreadId = data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);

    showWorkflow(data);

    if (data.requires_approval) {
      showResult(data.itinerary || data.answer, data.thread_id, true);
      showApproval(data);
    } else {
      hideApproval();
      showResult(data.answer, data.thread_id, false);
      currentThreadId = null;
      localStorage.removeItem("travel_thread_id");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "draft");
  }
}

async function submitApproval(approved) {
  hideError();

  if (!currentThreadId || !waitingForApproval) {
    showError("There is no draft waiting for approval.");
    return;
  }

  const feedbackInput = document.getElementById("approvalFeedback");
  const feedback = feedbackInput.value.trim();

  if (!approved && !feedback) {
    showError("Please enter revision feedback before requesting changes.");
    feedbackInput.focus();
    return;
  }

  setLoading(true, "approval");

  try {
    const response = await fetch("/api/travel/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Could not resume the travel workflow.");
    }

    latestTripData = data;
    showWorkflow(data);
    hideApproval();
    showResult(data.answer, data.thread_id, false);
    currentThreadId = null;
    localStorage.removeItem("travel_thread_id");
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false, "approval");
  }
}

// Pre-defined coordinates for fast offline/immediate rendering
const CITY_COORDS = {
  "delhi": [28.6139, 77.2090],
  "new delhi": [28.6139, 77.2090],
  "kanpur": [26.4499, 80.3319],
  "jaipur": [26.9124, 75.7873],
  "dharamshala": [32.2190, 76.3234],
  "dharamsala": [32.2190, 76.3234],
  "mcleodganj": [32.2426, 76.3213],
  "manali": [32.2432, 77.1892],
  "shimla": [31.1048, 77.1734],
  "rishikesh": [30.0869, 78.2676],
  "haridwar": [29.9457, 78.1642],
  "agra": [27.1767, 78.0081],
  "amritsar": [31.6340, 74.8723],
  "udaipur": [24.5854, 73.7125],
  "jodhpur": [26.2389, 73.0243],
  "varanasi": [25.3176, 82.9739],
  "banaras": [25.3176, 82.9739],
  "kashi": [25.3176, 82.9739],
  "mumbai": [19.0760, 72.8777],
  "bengaluru": [12.9716, 77.5946],
  "bangalore": [12.9716, 77.5946],
  "kolkata": [22.5726, 88.3639],
  "chennai": [13.0827, 80.2707],
  "hyderabad": [17.3850, 78.4867],
  "goa": [15.2993, 74.1240],
  "dubai": [25.2048, 55.2708],
  "dhaka": [23.8103, 90.4125],
  "tokyo": [35.6762, 139.6503],
  "paris": [48.8566, 2.3522],
  "london": [51.5074, -0.1278],
  "singapore": [1.3521, 103.8198],
  "japan": [35.6762, 139.6503],
  "bangladesh": [23.8103, 90.4125],
  "thailand": [13.7563, 100.5018],
  "vietnam": [21.0285, 105.8542],
  "indonesia": [-6.2088, 106.8456],
  "bali": [-8.3405, 115.0920],
  "france": [48.8566, 2.3522],
  "italy": [41.9028, 12.4964],
  "switzerland": [46.9480, 7.4474],
  "germany": [52.5200, 13.4050],
  "uk": [51.5074, -0.1278],
  "usa": [40.7128, -74.0060]
};

function createPinIcon(emoji, bgColor = "#3b82f6") {
  return L.divIcon({
    className: "map-div-icon",
    html: `<div style="background:${bgColor}; width:38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 14px rgba(0,0,0,0.45); border:2.5px solid #ffffff; font-size:19px; cursor:pointer;">${emoji}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -22]
  });
}

function extractCityName(data) {
  // 1. Highest Priority: Trip constraints destination from supervisor backend
  if (data.trip_constraints && data.trip_constraints.destination && data.trip_constraints.destination.trim()) {
    const dest = data.trip_constraints.destination.trim();
    if (dest.length > 2 && !/^(destination|somewhere|india)$/i.test(dest)) {
      return dest;
    }
  }

  // 2. Extract strictly from current user query (NOT full itinerary text)
  const currentInput = (document.getElementById("userInput")?.value || "").trim();
  const query = (data.user_query || currentInput).trim();

  if (query) {
    // Check "<Place> trip" e.g. "Japan trip"
    const tripMatch = query.match(/\b([A-Za-z]{3,})\s+trip\b/i);
    if (tripMatch && tripMatch[1] && !/^(budget|luxury|solo|family|days?)$/i.test(tripMatch[1])) {
      return tripMatch[1].trim();
    }

    // Check "to <Destination>" or "visit <Destination>"
    const toMatch = query.match(/\b(?:to|visit|explore|trip to|trip for)\s+([A-Za-z\s]+?)(?:\s+(?:from|for|with|under|in|by|including|\d+)|$|[.,!?])/i);
    if (toMatch && toMatch[1]) {
      const cand = toMatch[1].trim();
      if (cand.length > 2 && !/^(the|a|an|complete|budget|days?)$/i.test(cand)) {
        return cand;
      }
    }

    // Direct known place match in user query
    const knownCities = [
      "Japan", "Tokyo", "Bangladesh", "Dhaka", "Thailand", "Bangkok", "Vietnam", "Bali",
      "Dharamshala", "Dharamsala", "McLeodganj", "Manali", "Shimla", "Rishikesh", "Haridwar",
      "Varanasi", "Kashi", "Banaras", "Jaipur", "Agra", "Amritsar", "Udaipur", "Jodhpur",
      "Goa", "Delhi", "New Delhi", "Kanpur", "Mumbai", "Bengaluru", "Bangalore", "Kolkata",
      "Chennai", "Hyderabad", "Dubai", "Paris", "London", "Singapore", "Rome", "Switzerland"
    ];
    for (const c of knownCities) {
      const reg = new RegExp(`\\b${c}\\b`, "i");
      if (reg.test(query)) {
        const fromMatch = query.match(new RegExp(`from\\s+${c}`, "i"));
        if (!fromMatch) {
          return c;
        }
      }
    }
  }

  return "Destination";
}

function extractOriginName(data) {
  if (data.trip_constraints && data.trip_constraints.origin && data.trip_constraints.origin.trim()) {
    const orig = data.trip_constraints.origin.trim();
    if (orig.length > 2) return orig;
  }
  const currentInput = (document.getElementById("userInput")?.value || "").trim();
  const query = (data.user_query || currentInput).trim();
  const match = query.match(/\bfrom\s+([A-Za-z\s]+?)(?:\s+(?:to|for|with|under|in|by|including|\d+)|$|[.,!?])/i);
  return (match && match[1] && match[1].trim().length > 2) ? match[1].trim() : "";
}

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

async function renderInteractiveWidgets(data) {
  const widgetsSection = document.getElementById("interactiveWidgetsSection");
  if (!widgetsSection) return;
  widgetsSection.classList.remove("hidden");

  const city = extractCityName(data);
  const mapBadge = document.getElementById("mapCityBadge");
  if (mapBadge) mapBadge.textContent = city;

  // 1. Render Leaflet Map
  await initLeafletMap(city, data);

  // 2. Render Packing Checklist
  renderPackingChecklist(city, data.weather_results || "");

  // 3. Render Budget Pie Chart & Bars (with Group Splitter)
  renderBudgetAllocation(data.budget_results || "", currentCurrency);

  // 4. Render Local Tourist Helper & Emergency Contacts
  renderTouristHelper(city);
}

async function initLeafletMap(city, data) {
  const mapElement = document.getElementById("travelMap");
  const distanceBar = document.getElementById("routeDistanceBar");
  const distanceText = document.getElementById("routeDistanceText");
  if (!mapElement || typeof L === "undefined") return;

  try {
    const cityKey = city.toLowerCase().trim().replace(/,/g, "").split(" ")[0];
    const originCity = extractOriginName(data);
    const originKey = originCity.toLowerCase().trim().replace(/,/g, "").split(" ")[0];

    // Destination Coordinates
    let destLat = 25.3176, destLon = 82.9739;
    if (CITY_COORDS[cityKey]) {
      [destLat, destLon] = CITY_COORDS[cityKey];
    } else {
      try {
        const destGeoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.split(",")[0].trim())}&count=1&format=json`);
        const destGeo = await destGeoRes.json();
        if (destGeo.results && destGeo.results.length > 0) {
          destLat = destGeo.results[0].latitude;
          destLon = destGeo.results[0].longitude;
        }
      } catch (e) {
        console.warn("Geocoding destination failed:", e);
      }
    }

    // Origin Coordinates
    let origLat = null, origLon = null;
    if (originCity) {
      if (CITY_COORDS[originKey]) {
        [origLat, origLon] = CITY_COORDS[originKey];
      } else {
        try {
          const origGeoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(originCity.split(",")[0].trim())}&count=1&format=json`);
          const origGeo = await origGeoRes.json();
          if (origGeo.results && origGeo.results.length > 0) {
            origLat = origGeo.results[0].latitude;
            origLon = origGeo.results[0].longitude;
          }
        } catch (e) {
          console.warn("Geocoding origin failed:", e);
        }
      }
    }

    // Clean previous map instance
    if (travelMapInstance) {
      try {
        travelMapInstance.off();
        travelMapInstance.remove();
      } catch (e) {
        console.warn("Map teardown notice:", e);
      }
      travelMapInstance = null;
    }

    // 1. Street Map Layer
    const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    // 2. Satellite Aerial Layer (Esri)
    const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 18,
      attribution: '&copy; Esri World Imagery'
    });

    // 3. Topographic Layer
    const topoLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: '&copy; OpenTopoMap'
    });

    travelMapInstance = L.map("travelMap", {
      center: [destLat, destLon],
      zoom: (origLat && origLon) ? 6 : 12,
      layers: [streetLayer]
    });

    // Layer Switcher
    const baseMaps = {
      "🏙️ Street Map": streetLayer,
      "🛰️ Satellite View": satelliteLayer,
      "⛰️ Topographic": topoLayer
    };
    L.control.layers(baseMaps).addTo(travelMapInstance);

    const waypoints = [];

    // Draw Starting Point, Route Polyline & Distance Banner
    if (origLat && origLon) {
      const distanceKm = calculateHaversineKm(origLat, origLon, destLat, destLon);
      const distanceMiles = Math.round(distanceKm * 0.621371);
      const estBusHours = Math.max(1, Math.round(distanceKm / 55));
      const estFlightHours = distanceKm > 300 ? "1h 15m - 2h" : "N/A (Short)";
      const estTrainHours = Math.max(1, Math.round(distanceKm / 75));

      if (distanceBar && distanceText) {
        distanceText.innerHTML = `
          <span>🚀 <b>${originCity}</b> ➔ 🏁 <b>${city}</b>: <span style="color:#60a5fa; font-weight:800; font-size:1.05rem;">${distanceKm} km</span> (${distanceMiles} miles)</span>
          <span style="color:#cbd5e1; font-size:0.88rem; background:rgba(2,6,23,0.6); padding:4px 10px; border-radius:8px;">🚌 Bus: ~${estBusHours}h &bull; 🚆 Train: ~${estTrainHours}h &bull; ✈️ Flight: ${estFlightHours}</span>
        `;
        distanceBar.classList.remove("hidden");
      }

      // Draw Animated Dashed Route Corridor
      const routePoints = [[origLat, origLon], [destLat, destLon]];
      L.polyline(routePoints, {
        color: "#2563eb",
        weight: 5,
        opacity: 0.9,
        dashArray: "12, 10"
      }).addTo(travelMapInstance);

      // Start Marker with DivIcon
      L.marker([origLat, origLon], { icon: createPinIcon("🚀", "#10b981") }).addTo(travelMapInstance)
        .bindPopup(`
          <div style="font-family: inherit; font-size: 0.95rem;">
            <b>🟢 Starting Point: ${originCity}</b><br>
            <span style="color:#64748b;">Departure Station / Airport</span>
          </div>
        `);

      waypoints.push([origLat, origLon]);
    } else {
      if (distanceBar) distanceBar.classList.add("hidden");
    }

    // Destination Marker with DivIcon and 360 Street View link
    const streetViewLink = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${destLat},${destLon}`;
    L.marker([destLat, destLon], { icon: createPinIcon("🏁", "#ef4444") }).addTo(travelMapInstance)
      .bindPopup(`
        <div style="font-family: inherit; font-size: 0.95rem;">
          <b>🔴 Destination: ${city}</b><br>
          <span style="color:#64748b;">Arrival Hub & City Center</span><br>
          <a href="${streetViewLink}" target="_blank" style="display:inline-block; margin-top:8px; color:#2563eb; font-weight:800; text-decoration:underline;">🌐 Open 360° Street View</a>
        </div>
      `)
      .openPopup();

    waypoints.push([destLat, destLon]);

    // Query popular landmarks & hostels
    try {
      const placesRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city.split(",")[0].trim() + " attractions hostels")}&format=json&limit=6`);
      const places = await placesRes.json();
      (places || []).forEach((place) => {
        if (place.lat && place.lon) {
          const pLat = parseFloat(place.lat);
          const pLon = parseFloat(place.lon);
          const placeName = place.display_name.split(",")[0];
          const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${pLat},${pLon}`;
          const isHostel = /hostel|zostel|dorm|stay|inn/i.test(place.display_name);

          L.marker([pLat, pLon], { icon: createPinIcon(isHostel ? "🏨" : "⭐", isHostel ? "#8b5cf6" : "#f59e0b") })
            .addTo(travelMapInstance)
            .bindPopup(`
              <div style="font-family: inherit; font-size: 0.9rem;">
                <b>${isHostel ? "🏨 Hostel" : "⭐ Landmark"}: ${placeName}</b><br>
                <small style="color:#475569;">${place.display_name.slice(0, 75)}...</small><br>
                <a href="${svUrl}" target="_blank" style="display:inline-block; margin-top:5px; color:#2563eb; font-weight:700; text-decoration:underline;">🌐 360° Street View</a>
              </div>
            `);

          waypoints.push([pLat, pLon]);
        }
      });
    } catch (e) {
      console.warn("Could not load landmark pins:", e);
    }

    // Auto-fit bounds
    if (waypoints.length > 1) {
      travelMapInstance.fitBounds(waypoints, { padding: [40, 40] });
    }

    // Recalculate tile container dimensions
    setTimeout(() => {
      if (travelMapInstance) {
        travelMapInstance.invalidateSize();
      }
    }, 250);

  } catch (err) {
    console.error("Leaflet Map setup error:", err);
  }
}

function renderPackingChecklist(city, weatherText) {
  const packingList = document.getElementById("packingList");
  const weatherBadge = document.getElementById("weatherSummaryBadge");
  if (!packingList) return;

  const isRain = /rain|shower|storm|wet|drizzle/i.test(weatherText);
  const isCold = /snow|freez|chill|cold/i.test(weatherText);
  const tempMatch = weatherText.match(/(\d+(?:\.\d+)?)\s*°?C/i);
  const temp = tempMatch ? parseFloat(tempMatch[1]) : (city.toLowerCase().includes("jaipur") ? 31.0 : 26.0);

  if (isRain) {
    weatherBadge.textContent = `🌧️ ${city}: ${temp}°C (Rainy Forecast)`;
  } else if (temp >= 28) {
    weatherBadge.textContent = `☀️ ${city}: ${temp}°C (Warm / Sunny)`;
  } else if (temp <= 18 || isCold) {
    weatherBadge.textContent = `❄️ ${city}: ${temp}°C (Cool / Cold)`;
  } else {
    weatherBadge.textContent = `🌤️ ${city}: ${temp}°C (Pleasant Climate)`;
  }

  // Dynamic climate-specific and transit items
  const items = [
    { text: "Passport, ID, Bus/Train/Flight Tickets", icon: "🛂", checked: false },
    { text: "High-Capacity Power Bank & Fast Charger", icon: "🔋", checked: false },
    { text: "Comfortable Walking Shoes (for Forts & Bazaars)", icon: "👟", checked: false },
    { text: "Inflatable Neck Pillow & Earplugs (for Sleeper Bus)", icon: "🚌", checked: false },
    { text: "First Aid Kit & Motion Sickness Tablets", icon: "💊", checked: false },
    temp >= 28
      ? { text: "Sunscreen SPF 50+, UV Sunglasses & Cotton Hat", icon: "🕶️", checked: false }
      : { text: "Light Windbreaker or Jacket", icon: "🧥", checked: false },
    temp >= 28
      ? { text: "Breathable Linen/Cotton Outfits & Hydration Bottle", icon: "👕", checked: false }
      : { text: "Warm Fleece Layers", icon: "🧣", checked: false },
    isRain
      ? { text: "Compact Umbrella & Waterproof Bag Cover", icon: "☔", checked: false }
      : { text: "Modest Scarf / Shawl for Temple/Monument Entry", icon: "🧕", checked: false },
    { text: `Emergency Cash & UPI Apps (${currentCurrency})`, icon: "💳", checked: false },
  ];

  packingList.innerHTML = "";
  items.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = `packing-item ${item.checked ? "checked" : ""}`;
    div.innerHTML = `
      <input type="checkbox" id="pack_${index}" ${item.checked ? "checked" : ""}>
      <label for="pack_${index}">${item.icon} ${item.text}</label>
    `;
    div.querySelector("input").addEventListener("change", (e) => {
      div.classList.toggle("checked", e.target.checked);
    });
    packingList.appendChild(div);
  });
}

function renderBudgetAllocation(budgetText, currency) {
  const container = document.getElementById("budgetBars");
  const pieSvg = document.getElementById("budgetPieSvg");
  const totalAmountEl = document.getElementById("pieTotalValue");
  const perPersonEl = document.getElementById("piePerPersonValue");
  if (!container) return;

  const { symbol, rate } = CURRENCY_RATES[currency] || CURRENCY_RATES.USD;

  let totalBase = 800;
  const numMatch = (budgetText || "").match(/(?:rs\.?|inr|\$|€|£)?\s*([\d,]+)/i);
  if (numMatch) {
    const parsed = parseInt(numMatch[1].replace(/,/g, ""), 10);
    if (parsed > 100 && parsed < 1000000) {
      totalBase = parsed;
    }
  }

  // Base per-person converted total
  const perPersonTotal = Math.round(totalBase * (currency === "INR" && totalBase < 1500 ? rate : 1));
  // Total scaled by group size (with shared accommodation savings)
  const sharedDiscountFactor = currentGroupSize > 1 ? 0.88 : 1.0;
  const grandTotal = Math.round(perPersonTotal * currentGroupSize * sharedDiscountFactor);
  const effectivePerPerson = Math.round(grandTotal / currentGroupSize);

  if (totalAmountEl) {
    totalAmountEl.textContent = `${symbol}${grandTotal.toLocaleString()}`;
  }
  if (perPersonEl) {
    perPersonEl.textContent = currentGroupSize > 1 
      ? `(${symbol}${effectivePerPerson.toLocaleString()} / person for ${currentGroupSize})`
      : `(${symbol}${effectivePerPerson.toLocaleString()} / person)`;
  }

  const categories = [
    { name: "Flights / Transit", pct: 35, color: "#3b82f6", fillClass: "fill-flight" },
    { name: "Hostels & Stays", pct: 30, color: "#8b5cf6", fillClass: "fill-hotel" },
    { name: "Food & Dining", pct: 18, color: "#10b981", fillClass: "fill-food" },
    { name: "Sightseeing", pct: 12, color: "#f59e0b", fillClass: "fill-sightseeing" },
    { name: "Emergency Buffer", pct: 5, color: "#64748b", fillClass: "fill-contingency" }
  ];

  // Render SVG Donut / Pie Chart
  if (pieSvg) {
    const radius = 70;
    const strokeWidth = 26;
    const cx = 100, cy = 100;
    const circumference = 2 * Math.PI * radius;
    let accumulatedOffset = 0;

    let svgHtml = "";
    categories.forEach((cat) => {
      const strokeLength = (cat.pct / 100) * circumference;
      const strokeDashoffset = -accumulatedOffset;
      accumulatedOffset += strokeLength;

      svgHtml += `
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
          stroke="${cat.color}"
          stroke-width="${strokeWidth}"
          stroke-dasharray="${strokeLength} ${circumference - strokeLength}"
          stroke-dashoffset="${strokeDashoffset}"
          style="transition: stroke-dasharray 0.6s ease; cursor: pointer;">
          <title>${cat.name}: ${cat.pct}% (${symbol}${Math.round(grandTotal * cat.pct / 100).toLocaleString()})</title>
        </circle>
      `;
    });
    pieSvg.innerHTML = svgHtml;
  }

  // Render Budget Progress Legend
  container.innerHTML = categories.map((cat) => {
    const amount = Math.round((grandTotal * cat.pct) / 100);
    return `
      <div class="budget-row">
        <div class="budget-row-label">
          <span><strong style="color:${cat.color}; font-size:1.15rem; line-height:1;">&bull;</strong> ${cat.name} (${cat.pct}%)</span>
          <span>${symbol}${amount.toLocaleString()}</span>
        </div>
        <div class="budget-track">
          <div class="budget-fill ${cat.fillClass}" style="width: ${cat.pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");
}

function updateCurrency(newCurrency) {
  currentCurrency = newCurrency;
  if (latestTripData) {
    renderBudgetAllocation(latestTripData.budget_results || "", currentCurrency);
    renderPackingChecklist(extractCityName(latestTripData), latestTripData.weather_results || "");
  }
}

function updateGroupSize(newSize) {
  currentGroupSize = parseInt(newSize, 10) || 1;
  if (latestTripData) {
    renderBudgetAllocation(latestTripData.budget_results || "", currentCurrency);
  }
}

// Local Tourist Helper & Emergency Contacts
const TOURIST_GUIDES = {
  india: {
    police: "112",
    ambulance: "108",
    tourist: "1363",
    transportTip: "Book prepaid taxis or use Uber / Ola / Rapido apps. For Auto-rickshaws, negotiate or ask for meter fare.",
    phrases: [
      { native: "नमस्ते (Namaste)", meaning: "Hello / Greetings" },
      { native: "कितना हुआ? (Kitna hua?)", meaning: "How much is this?" },
      { native: "शुक्रिया (Shukriya)", meaning: "Thank you" },
      { native: "मदद चाहिए (Madad chahiye)", meaning: "I need help" }
    ]
  },
  japan: {
    police: "110",
    ambulance: "119",
    tourist: "050-3816-2788",
    transportTip: "Use Suica / Pasmo IC cards for trains. Tokyo Metro and Yamanote line run until midnight.",
    phrases: [
      { native: "こんにちは (Konnichiwa)", meaning: "Hello / Greetings" },
      { native: "いくらですか？ (Ikura desu ka?)", meaning: "How much is this?" },
      { native: "ありがとう (Arigatou)", meaning: "Thank you" },
      { native: "助けて (Tasukete)", meaning: "Please help" }
    ]
  },
  uae: {
    police: "999",
    ambulance: "998",
    tourist: "800 4888",
    transportTip: "Use Dubai Metro Nol Cards for easy transit. Careem and Dubai Taxi are meter-regulated.",
    phrases: [
      { native: "مرحباً (Marhaban)", meaning: "Hello / Welcome" },
      { native: "بكم هذا؟ (Bikam haza?)", meaning: "How much is this?" },
      { native: "شكراً (Shukran)", meaning: "Thank you" },
      { native: "ساعدني (Saa'idni)", meaning: "Help me" }
    ]
  },
  thailand: {
    police: "191",
    ambulance: "1669",
    tourist: "1155",
    transportTip: "Use Grab or Bolt for cabs. In Bangkok, BTS Skytrain and MRT avoid heavy street traffic.",
    phrases: [
      { native: "สวัสดี (Sawatdee)", meaning: "Hello / Greetings" },
      { native: "เท่าไหร่ (Tao rai?)", meaning: "How much?" },
      { native: "ขอบคุณ (Khob khun)", meaning: "Thank you" },
      { native: "ช่วยด้วย (Chuay duay)", meaning: "Help please" }
    ]
  },
  global: {
    police: "112 / 911",
    ambulance: "112 / 911",
    tourist: "Local Help Desk",
    transportTip: "Use official airport taxi booths or verified ride-hailing apps. Keep an offline map downloaded.",
    phrases: [
      { native: "Hello / Good Day", meaning: "Friendly greeting" },
      { native: "How much is this?", meaning: "Asking price" },
      { native: "Thank you very much", meaning: "Gratitude" },
      { native: "Where is the station?", meaning: "Directions" }
    ]
  }
};

function renderTouristHelper(city) {
  const policeNum = document.getElementById("policeNum");
  const ambulanceNum = document.getElementById("ambulanceNum");
  const touristNum = document.getElementById("touristNum");
  const transportTip = document.getElementById("localTransportTip");
  const phrasesGrid = document.getElementById("localPhrasesGrid");
  const cityBadge = document.getElementById("helperCityBadge");

  if (!policeNum || !phrasesGrid) return;

  const cityLower = city.toLowerCase();
  let guideKey = "india";
  if (/tokyo|japan|kyoto|osaka/i.test(cityLower)) guideKey = "japan";
  else if (/dubai|abu dhabi|uae|sharjah/i.test(cityLower)) guideKey = "uae";
  else if (/bangkok|thailand|phuket/i.test(cityLower)) guideKey = "thailand";
  else if (/paris|london|rome|switzerland|bali|vietnam|dhaka/i.test(cityLower)) guideKey = "global";

  const guide = TOURIST_GUIDES[guideKey] || TOURIST_GUIDES.india;

  policeNum.textContent = guide.police;
  ambulanceNum.textContent = guide.ambulance;
  touristNum.textContent = guide.tourist;
  transportTip.textContent = guide.transportTip;
  if (cityBadge) cityBadge.textContent = `${city} Desk`;

  phrasesGrid.innerHTML = guide.phrases.map((p) => `
    <div class="phrase-item">
      <span class="phrase-native">${p.native}</span>
      <span class="phrase-meaning">${p.meaning}</span>
    </div>
  `).join("");
}

// Interactive Day-by-Day Visual Timeline
function renderDayTimeline(markdown) {
  const container = document.getElementById("dayTimelineContainer");
  const tabsContainer = document.getElementById("dayTabs");
  const cardsContainer = document.getElementById("dayCards");
  if (!container || !tabsContainer || !cardsContainer) return;

  const dayRegex = /(?:###?\s*|\*\*\s*|^|\n)(Day\s+\d+[^:\n*]*)(?:[:*#\n]|$)/gi;
  const matches = [...markdown.matchAll(dayRegex)];

  if (!matches || matches.length < 2) {
    container.classList.add("hidden");
    return;
  }

  const days = [];
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index;
    const endIdx = (i + 1 < matches.length) ? matches[i + 1].index : markdown.length;
    const title = matches[i][1].replace(/[*#]/g, "").trim();
    const content = markdown.slice(startIdx, endIdx);

    const morningMatch = content.match(/(?:🌅|Morning|Breakfast|AM)[^:\n]*[:\n]([^\n]+(?:\n[^\n#*]+)?)/i);
    const afternoonMatch = content.match(/(?:☀️|Afternoon|Lunch|Noon|PM)[^:\n]*[:\n]([^\n]+(?:\n[^\n#*]+)?)/i);
    const eveningMatch = content.match(/(?:🌙|Evening|Night|Dinner|Sunset)[^:\n]*[:\n]([^\n]+(?:\n[^\n#*]+)?)/i);

    days.push({
      id: `day_${i + 1}`,
      title: title,
      morning: morningMatch ? morningMatch[1].replace(/[*#]/g, "").trim() : "Morning exploration, scenic walks & local breakfast",
      afternoon: afternoonMatch ? afternoonMatch[1].replace(/[*#]/g, "").trim() : "Heritage sightseeing, authentic lunch & cultural highlights",
      evening: eveningMatch ? eveningMatch[1].replace(/[*#]/g, "").trim() : "Evening views, night market & local dinner"
    });
  }

  tabsContainer.innerHTML = days.map((d, i) => `
    <button class="day-tab-btn ${i === 0 ? "active" : ""}" onclick="switchDayTab('${d.id}')">
      ${d.title.split(":")[0]}
    </button>
  `).join("");

  cardsContainer.innerHTML = days.map((d, i) => `
    <div id="${d.id}" class="day-card ${i === 0 ? "active" : ""}">
      <div class="day-card-header">📌 ${d.title}</div>
      <div class="slots-grid">
        <div class="time-slot-card">
          <span class="time-slot-tag">🌅 Morning</span>
          <p class="time-slot-desc">${d.morning}</p>
        </div>
        <div class="time-slot-card">
          <span class="time-slot-tag">☀️ Afternoon</span>
          <p class="time-slot-desc">${d.afternoon}</p>
        </div>
        <div class="time-slot-card">
          <span class="time-slot-tag">🌙 Evening / Night</span>
          <p class="time-slot-desc">${d.evening}</p>
        </div>
      </div>
    </div>
  `).join("");

  container.classList.remove("hidden");
}

function switchDayTab(dayId) {
  document.querySelectorAll(".day-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.textContent.toLowerCase().replace(/\s+/g, "_").includes(dayId));
  });
  document.querySelectorAll(".day-card").forEach((card) => {
    card.classList.toggle("active", card.id === dayId);
  });
}

// Voice Narration (Web Speech API)
function toggleVoice() {
  if (!("speechSynthesis" in window)) {
    showError("Voice narration is not supported in this browser.");
    return;
  }

  const voiceBtn = document.getElementById("voiceBtn");
  const voiceIcon = document.getElementById("voiceIcon");
  const voiceText = document.getElementById("voiceText");

  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    voiceBtn.classList.remove("speaking");
    voiceIcon.textContent = "🔊";
    voiceText.textContent = "Listen";
    return;
  }

  const resultBox = document.getElementById("resultBox");
  const rawText = resultBox.innerText.replace(/[#*`_\[\]]/g, "");

  if (!rawText.trim()) {
    showError("No travel plan available to read.");
    return;
  }

  window.speechSynthesis.cancel();
  speechUtterance = new SpeechSynthesisUtterance(rawText.slice(0, 1500));
  speechUtterance.rate = 1.0;
  speechUtterance.pitch = 1.0;

  speechUtterance.onstart = () => {
    isSpeaking = true;
    voiceBtn.classList.add("speaking");
    voiceIcon.textContent = "⏹️";
    voiceText.textContent = "Stop";
  };

  speechUtterance.onend = () => {
    isSpeaking = false;
    voiceBtn.classList.remove("speaking");
    voiceIcon.textContent = "🔊";
    voiceText.textContent = "Listen";
  };

  speechUtterance.onerror = () => {
    isSpeaking = false;
    voiceBtn.classList.remove("speaking");
    voiceIcon.textContent = "🔊";
    voiceText.textContent = "Listen";
  };

  window.speechSynthesis.speak(speechUtterance);
}

function copyResult() {
  const resultBox = document.getElementById("resultBox");
  const text = resultBox.innerText;

  if (!text) {
    return;
  }

  navigator.clipboard.writeText(text)
    .then(() => {
      const copyBtn = document.querySelector(".copy-btn");
      const oldText = copyBtn.textContent;
      copyBtn.textContent = "Copied!";

      setTimeout(() => {
        copyBtn.textContent = oldText;
      }, 1400);
    })
    .catch(() => {
      showError("Could not copy result.");
    });
}

function downloadPDF() {
  const pdfContent = document.getElementById("pdfContent");

  if (!latestAnswerMarkdown || !pdfContent) {
    showError("No travel plan available to download.");
    return;
  }

  const downloadBtn = document.querySelector(".download-btn");
  const oldText = downloadBtn.textContent;
  downloadBtn.textContent = "Preparing PDF...";
  downloadBtn.disabled = true;

  const options = {
    margin: 0.5,
    filename: "ai-travel-plan.pdf",
    image: {
      type: "jpeg",
      quality: 0.98
    },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff"
    },
    jsPDF: {
      unit: "in",
      format: "a4",
      orientation: "portrait"
    },
    pagebreak: {
      mode: ["avoid-all", "css", "legacy"]
    }
  };

  html2pdf()
    .set(options)
    .from(pdfContent)
    .save()
    .then(() => {
      downloadBtn.textContent = oldText;
      downloadBtn.disabled = false;
    })
    .catch(() => {
      downloadBtn.textContent = oldText;
      downloadBtn.disabled = false;
      showError("Could not download PDF.");
    });
}

document.addEventListener("keydown", function(event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});
