let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;
let latestTripData = null;
let currentCurrency = "INR";
let currentGroupSize = 1;
let travelMapInstance = null;
let isSpeaking = false;
let speechUtterance = null;
let activeTab = "itinerary";

const AGENT_LABELS = {
  flight_agent: "✈️ Transit & Trains (RailRadar)",
  hotel_agent: "🏨 Hotels & Hostels",
  weather_agent: "🌦️ Weather Agent",
  budget_agent: "💰 Budget Agent",
  itinerary_agent: "🗓️ Itinerary Synthesizer"
};

const CURRENCY_RATES = {
  INR: { symbol: "₹", rate: 1 },
  USD: { symbol: "$", rate: 0.012 },
  EUR: { symbol: "€", rate: 0.011 },
  AED: { symbol: "د.إ", rate: 0.044 },
  GBP: { symbol: "£", rate: 0.0095 }
};

function setPrompt(text) {
  const input = document.getElementById("userInput");
  if (input) {
    input.value = text;
    input.focus();
  }
}

function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");
  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  if (sendBtn) sendBtn.disabled = isLoading;
  if (approveBtn) approveBtn.disabled = isLoading;
  if (reviseBtn) reviseBtn.disabled = isLoading;

  if (isLoading && mode === "draft") {
    if (btnText) btnText.classList.add("hidden");
    if (btnLoader) btnLoader.classList.remove("hidden");
  } else {
    if (btnText) btnText.classList.remove("hidden");
    if (btnLoader) btnLoader.classList.add("hidden");
  }
}

function showError(message) {
  const errorBox = document.getElementById("errorBox");
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  if (errorBox) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
  }
}

function renderMarkdown(element, markdown) {
  if (!element) return;
  if (typeof marked !== "undefined") {
    marked.setOptions({
      breaks: true,
      gfm: true
    });
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

  if (!section) return;

  if (reasoning) reasoning.textContent = data.supervisor_reasoning || "Supervisor routing and parallel agent dispatch complete.";
  if (chips) {
    chips.innerHTML = "";
    (data.selected_agents || []).forEach((agent) => {
      const chip = document.createElement("span");
      chip.className = "agent-chip";
      chip.textContent = AGENT_LABELS[agent] || agent;
      chips.appendChild(chip);
    });
  }

  if (guardrailBadge) {
    if (data.guardrail_allowed === false) {
      guardrailBadge.textContent = "Guardrail blocked";
      guardrailBadge.classList.add("blocked");
    } else {
      guardrailBadge.textContent = "Guardrail passed";
      guardrailBadge.classList.remove("blocked");
    }
  }

  section.classList.remove("hidden");
}

/* =========================================================
   3-Section Tab Navigation System
   ========================================================= */
function switchSectionTab(tabName) {
  activeTab = tabName;

  const tabItinerary = document.getElementById("tabContentItinerary");
  const tabRecs = document.getElementById("tabContentRecs");
  const tabTools = document.getElementById("tabContentTools");

  const btnItinerary = document.getElementById("tabBtnItinerary");
  const btnRecs = document.getElementById("tabBtnRecs");
  const btnTools = document.getElementById("tabBtnTools");
  const btnAll = document.getElementById("tabBtnAll");

  [btnItinerary, btnRecs, btnTools, btnAll].forEach((btn) => {
    if (btn) btn.classList.remove("active");
  });

  if (tabName === "itinerary") {
    if (tabItinerary) tabItinerary.classList.remove("hidden");
    if (tabRecs) tabRecs.classList.add("hidden");
    if (tabTools) tabTools.classList.add("hidden");
    if (btnItinerary) btnItinerary.classList.add("active");
  } else if (tabName === "recommendations") {
    if (tabItinerary) tabItinerary.classList.add("hidden");
    if (tabRecs) tabRecs.classList.remove("hidden");
    if (tabTools) tabTools.classList.add("hidden");
    if (btnRecs) btnRecs.classList.add("active");
  } else if (tabName === "tools") {
    if (tabItinerary) tabItinerary.classList.add("hidden");
    if (tabRecs) tabRecs.classList.add("hidden");
    if (tabTools) tabTools.classList.remove("hidden");
    if (btnTools) btnTools.classList.add("active");
    setTimeout(() => {
      if (travelMapInstance) travelMapInstance.invalidateSize();
    }, 200);
  } else if (tabName === "all") {
    if (tabItinerary) tabItinerary.classList.remove("hidden");
    if (tabRecs) tabRecs.classList.remove("hidden");
    if (tabTools) tabTools.classList.remove("hidden");
    if (btnAll) btnAll.classList.add("active");
    setTimeout(() => {
      if (travelMapInstance) travelMapInstance.invalidateSize();
    }, 200);
  }
}

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const navTabs = document.getElementById("sectionNavTabs");
  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  if (navTabs) navTabs.classList.remove("hidden");

  if (resultBox) renderMarkdown(resultBox, latestAnswerMarkdown);
  if (threadInfo) threadInfo.textContent = `Thread ID: ${threadId}`;
  if (resultTitle) resultTitle.textContent = isDraft ? "Draft Travel Plan (Review Below)" : "Your Final AI Travel Plan";
  if (resultSection) resultSection.classList.remove("hidden");

  // Render Section 2: AI Recommendations & Alternatives
  renderDecisionCard(latestTripData || {});

  // Render Section 3: Interactive Maps & Tools
  renderInteractiveWidgets(latestTripData || {});

  // Default to Itinerary tab
  switchSectionTab(activeTab === "all" ? "all" : "itinerary");

  if (resultSection) {
    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function showApproval(data) {
  waitingForApproval = true;
  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");
  if (approvalRequest) {
    approvalRequest.textContent = data.approval_request ||
      "Approve the draft itinerary below or enter your feedback for instant revision.";
  }
  if (section) {
    section.classList.remove("hidden");
    setTimeout(() => {
      section.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }
}

function hideApproval() {
  waitingForApproval = false;
  const section = document.getElementById("approvalSection");
  const feedbackInput = document.getElementById("approvalFeedback");
  if (section) section.classList.add("hidden");
  if (feedbackInput) feedbackInput.value = "";
}

async function sendMessage() {
  hideError();

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
      throw new Error(data.error || "Could not generate travel plan.");
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
  const feedback = feedbackInput ? feedbackInput.value.trim() : "";

  if (!approved && !feedback) {
    showError("Please enter revision feedback before requesting changes.");
    if (feedbackInput) feedbackInput.focus();
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

/* =========================================================
   Section 2: Decision Card & AI Recommendations
   ========================================================= */
function renderDecisionCard(data) {
  const decisionSection = document.getElementById("decisionSection");
  if (!decisionSection) return;

  const decision = data.recommendation_decision || {};
  const best = decision.best_destination || {};

  const nameEl = document.getElementById("destName");
  const costEl = document.getElementById("destCost");
  const prosList = document.getElementById("destProsList");
  const consList = document.getElementById("destConsList");
  const antiBox = document.getElementById("antiPersonaBox");
  const antiText = document.getElementById("antiPersonaText");
  const altGrid = document.getElementById("alternativesGrid");

  const destName = best.name || extractCityName(data) || "Destination";
  if (nameEl) nameEl.textContent = destName;

  const minCost = best.estimated_cost_min_inr ? `₹${Math.round(best.estimated_cost_min_inr).toLocaleString()}` : "₹6,000";
  const maxCost = best.estimated_cost_max_inr ? `₹${Math.round(best.estimated_cost_max_inr).toLocaleString()}` : "₹9,500";
  if (costEl) costEl.textContent = `Est: ${minCost} - ${maxCost}`;

  const critical = best.critical_analysis || {};

  // Highlights & Pros
  if (prosList) {
    let highlights = [];
    if (best.why_matched && Array.isArray(best.why_matched) && best.why_matched.length > 0) {
      highlights = best.why_matched;
    } else if (critical.advantages && Array.isArray(critical.advantages) && critical.advantages.length > 0) {
      highlights = critical.advantages;
    } else if (best.key_advantages && Array.isArray(best.key_advantages)) {
      highlights = best.key_advantages;
    } else {
      highlights = [`Direct match for requested destination: ${destName}`, `Comfortably within requested budget`, `Perfect trip pacing` ];
    }
    prosList.innerHTML = highlights.map((h) => `<li>${h}</li>`).join("");
  }

  // Critic & Trade-offs
  if (consList) {
    let tradeOffs = [];
    if (critical.disadvantages && Array.isArray(critical.disadvantages) && critical.disadvantages.length > 0) {
      tradeOffs = critical.disadvantages;
    } else if (critical.cost_risks && Array.isArray(critical.cost_risks) && critical.cost_risks.length > 0) {
      tradeOffs = critical.cost_risks;
    } else if (best.trade_offs && Array.isArray(best.trade_offs)) {
      tradeOffs = best.trade_offs;
    } else {
      tradeOffs = ["Book transit early during holiday peaks for best rates."];
    }
    consList.innerHTML = tradeOffs.map((t) => `<li>${t}</li>`).join("");
  }

  // Persona Notice
  if (antiBox && antiText) {
    const warningText = best.not_recommended_for || critical.who_should_not_visit;
    if (warningText) {
      antiText.textContent = warningText;
      antiBox.classList.remove("hidden");
    } else {
      antiBox.classList.add("hidden");
    }
  }

  // Evaluated Alternatives
  if (altGrid) {
    const alts = (decision.alternatives && decision.alternatives.length > 0) ? decision.alternatives : (decision.alternatives_evaluated || []);
    if (alts.length > 0) {
      altGrid.innerHTML = alts.map((alt) => {
        const altName = alt.name || "Alternative Destination";
        const altMin = alt.estimated_cost_min_inr ? `₹${Math.round(alt.estimated_cost_min_inr).toLocaleString()}` : "₹4,500";
        const altMax = alt.estimated_cost_max_inr ? `₹${Math.round(alt.estimated_cost_max_inr).toLocaleString()}` : "₹8,000";
        const altCrit = alt.critical_analysis || {};
        const altHighlight = (alt.why_matched && alt.why_matched.length > 0) ? alt.why_matched[0] : (altCrit.advantages && altCrit.advantages.length > 0 ? altCrit.advantages[0] : "Web-scraped alternative spot with unique attractions.");
        
        return `
          <div class="alternative-card">
            <div class="alt-card-header">
              <span class="alt-name">📍 ${altName}</span>
              <span class="alt-cost">Est: ${altMin} - ${altMax}</span>
            </div>
            <p class="alt-reason">${altHighlight}</p>
            <button class="switch-dest-btn" onclick="switchToDestination('${altName}')">
              Switch to ${altName}
            </button>
          </div>
        `;
      }).join("");
    } else {
      altGrid.innerHTML = `<p style="color:var(--text-muted); font-size:0.88rem;">No additional alternative candidates evaluated for this query.</p>`;
    }
  }

  decisionSection.classList.remove("hidden");
}

function switchToDestination(destinationName) {
  const input = document.getElementById("userInput");
  if (input) {
    input.value = `Plan a 3 days budget trip to ${destinationName} with trains, hostels and sightseeing.`;
    sendMessage();
  }
}

/* =========================================================
   Section 3: Maps, Packing & Travel Tools
   ========================================================= */
const CITY_COORDS = {
  delhi: [28.6139, 77.2090],
  "new delhi": [28.6139, 77.2090],
  kanpur: [26.4499, 80.3319],
  jaipur: [26.9124, 75.7873],
  dharamshala: [32.2190, 76.3234],
  mcleodganj: [32.2426, 76.3213],
  manali: [32.2432, 77.1892],
  shimla: [31.1048, 77.1734],
  rishikesh: [30.0869, 78.2676],
  haridwar: [29.9457, 78.1642],
  agra: [27.1767, 78.0081],
  amritsar: [31.6340, 74.8723],
  udaipur: [24.5854, 73.7125],
  jodhpur: [26.2389, 73.0243],
  varanasi: [25.3176, 82.9739],
  mumbai: [19.0760, 72.8777],
  bengaluru: [12.9716, 77.5946],
  kolkata: [22.5726, 88.3639],
  goa: [15.2993, 74.1240],
  dubai: [25.2048, 55.2708],
  tokyo: [35.6762, 139.6503],
  paris: [48.8566, 2.3522],
  singapore: [1.3521, 103.8198]
};

function extractCityName(data) {
  if (!data) return "Varanasi";
  if (data.trip_constraints && data.trip_constraints.destination) {
    return data.trip_constraints.destination.split(",")[0].trim();
  }
  if (data.recommendation_decision && data.recommendation_decision.best_destination && data.recommendation_decision.best_destination.name) {
    return data.recommendation_decision.best_destination.name.split(",")[0].trim();
  }
  if (data.user_profile && data.user_profile.hard_constraints && data.user_profile.hard_constraints.explicit_destination) {
    return data.user_profile.hard_constraints.explicit_destination.split(",")[0].trim();
  }
  const answer = data.answer || data.itinerary || "";
  const match = answer.match(/\*\*([A-Za-z\s]+)(?:,\s*[A-Za-z\s]+)?\*\*/);
  if (match && match[1]) {
    const cand = match[1].toLowerCase().trim();
    if (!["trip", "overview", "day", "days", "budget", "transit", "plan", "your", "final"].includes(cand)) {
      return match[1].trim();
    }
  }
  return "Varanasi";
}

function extractOriginName(data) {
  if (data && data.trip_constraints && data.trip_constraints.origin) {
    const orig = data.trip_constraints.origin.split(",")[0].trim();
    if (orig && !["unknown", "none", "n/a", ""].includes(orig.toLowerCase())) {
      return orig;
    }
  }
  if (data && data.user_profile && data.user_profile.hard_constraints && data.user_profile.hard_constraints.origin_city) {
    const orig = data.user_profile.hard_constraints.origin_city.split(",")[0].trim();
    if (orig && !["unknown", "none", "n/a", ""].includes(orig.toLowerCase())) {
      return orig;
    }
  }
  return null;
}

function calculateHaversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function renderInteractiveWidgets(data) {
  const city = extractCityName(data);
  const mapBadge = document.getElementById("mapCityBadge");
  if (mapBadge) mapBadge.textContent = city;

  // 1. Initialize Map
  await initLeafletMap(city, data);

  // 2. Live Destination Weather & 5-Day Forecast
  renderWeatherWidget(city, data);

  // 3. Dynamic & Contextual Packing Checklist
  renderPackingChecklist(city, data);

  // 4. Exact Budget Breakdown Matching Draft Overview
  renderBudgetAllocation(data, currentCurrency);

  // 5. Tourist Safety Helper
  renderTouristHelper(city);
}

function renderWeatherWidget(city, data) {
  const badge = document.getElementById("weatherLocationBadge");
  const iconEl = document.getElementById("weatherMainIcon");
  const tempEl = document.getElementById("weatherMainTemp");
  const condEl = document.getElementById("weatherMainCondition");
  const highLowEl = document.getElementById("weatherHighLow");
  const humEl = document.getElementById("weatherHumidity");
  const comfortEl = document.getElementById("weatherComfort");
  const forecastStrip = document.getElementById("weatherForecastStrip");

  if (!tempEl || !forecastStrip) return;

  const weatherText = (data && data.weather_results) || "";
  const cityLower = city.toLowerCase();

  // Robust temperature extraction (strictly filter for valid Earth temperatures -40°C to 55°C)
  let currentTemp = null;
  const tempMatches = [...weatherText.matchAll(/(?:temperature_c|temp|temperature|feels_like_c|celsius)\D*(-?\d+(?:\.\d+)?)/gi)];
  for (const m of tempMatches) {
    const val = parseFloat(m[1]);
    if (!isNaN(val) && val >= -40 && val <= 55) {
      currentTemp = Math.round(val);
      break;
    }
  }

  // Second pass regex if key name is omitted: match degree C explicitly
  if (currentTemp === null) {
    const degMatches = [...weatherText.matchAll(/(-?\d+(?:\.\d+)?)\s*°\s*C/gi)];
    for (const m of degMatches) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val >= -40 && val <= 55) {
        currentTemp = Math.round(val);
        break;
      }
    }
  }

  const isRain = /rain|shower|storm|wet|drizzle/i.test(weatherText);
  const isCold = /snow|freez|chill|cold|winter/i.test(weatherText) || /manali|shimla|leh|ladakh|dharamshala|sikkim/i.test(cityLower);

  if (currentTemp === null) {
    currentTemp = isCold ? 14 : (cityLower.includes("jaipur") || cityLower.includes("dubai") ? 32 : 27);
  }

  window.currentWeatherTemp = currentTemp;

  if (badge) badge.textContent = `${city} Weather`;
  if (tempEl) tempEl.textContent = `${currentTemp}°C`;

  let icon = "🌤️";
  let condition = "Pleasant & Clear";
  let comfort = "Ideal for Outdoor Sightseeing";

  if (isRain) {
    icon = "🌧️";
    condition = "Light Rain / Showers";
    comfort = "Carry Umbrella & Raincover";
  } else if (currentTemp >= 32) {
    icon = "☀️";
    condition = "Sunny & Warm";
    comfort = "Stay Hydrated & Apply Sunscreen";
  } else if (currentTemp <= 16 || isCold) {
    icon = "❄️";
    condition = "Cool / Alpine Climate";
    comfort = "Layered Jackets Recommended";
  }

  if (iconEl) iconEl.textContent = icon;
  if (condEl) condEl.textContent = condition;
  if (highLowEl) highLowEl.textContent = `${currentTemp + 3}°C / ${Math.max(6, currentTemp - 5)}°C`;
  if (humEl) humEl.textContent = isRain ? "High Humidity (82%)" : "Moderate Humidity (48%)";
  if (comfortEl) comfortEl.textContent = comfort;

  // Extract real daily max/min temperatures from forecast JSON if available
  const parsedForecast = [];
  const maxMatches = [...weatherText.matchAll(/max_temp_c['"]?\s*:\s*(-?\d+(?:\.\d+)?)/gi)];
  const minMatches = [...weatherText.matchAll(/min_temp_c['"]?\s*:\s*(-?\d+(?:\.\d+)?)/gi)];
  
  for (let i = 0; i < Math.min(5, maxMatches.length, minMatches.length); i++) {
    const maxV = parseFloat(maxMatches[i][1]);
    const minV = parseFloat(minMatches[i][1]);
    if (maxV >= -40 && maxV <= 55 && minV >= -40 && minV <= 55) {
      parsedForecast.push({ max: Math.round(maxV), min: Math.round(minV) });
    }
  }

  // 5-Day Daily Outlook Strip
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  const dailyCards = [];

  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = i === 0 ? "Today" : daysOfWeek[d.getDay()];

    let dayMax = currentTemp + (i % 2 === 0 ? 2 : 1);
    let dayMin = Math.max(6, currentTemp - 5 + (i % 2));

    if (parsedForecast[i]) {
      dayMax = parsedForecast[i].max;
      dayMin = parsedForecast[i].min;
    }

    const dayIcon = isRain && i < 2 ? "🌧️" : (dayMax >= 30 ? "☀️" : (isCold || dayMax <= 16 ? "❄️" : "🌤️"));

    dailyCards.push(`
      <div class="forecast-day-card ${i === 0 ? 'today' : ''}">
        <span class="forecast-day-name">${dayName}</span>
        <span class="forecast-day-icon">${dayIcon}</span>
        <div class="forecast-temps">
          <strong class="temp-max">${dayMax}°C</strong>
          <span class="temp-min">${dayMin}°C</span>
        </div>
      </div>
    `);
  }

  forecastStrip.innerHTML = dailyCards.join("");
}

function createPinIcon(emoji, bgColor = "#2563eb") {
  return L.divIcon({
    className: "custom-map-pin",
    html: `<div style="background:${bgColor}; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 4px 12px rgba(0,0,0,0.5); border:2px solid #ffffff;">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -30]
  });
}

function sanitizeCityName(rawName) {
  if (!rawName) return "Rishikesh";
  let clean = rawName.replace(/view stays|stays|trip|overview|package|tour|hotel|dossier/gi, "").trim();
  clean = clean.replace(/^(plan|a|for)\s+/gi, "").trim();
  return clean || rawName;
}

async function initLeafletMap(city, data) {
  const mapElement = document.getElementById("travelMap");
  const distanceBar = document.getElementById("routeDistanceBar");
  const distanceText = document.getElementById("routeDistanceText");
  if (!mapElement || typeof L === "undefined") return;

  try {
    const cleanCity = sanitizeCityName(city);
    const getCoords = async (name) => {
      const cityKey = name.toLowerCase().trim().replace(/,/g, "").split(" ")[0];
      if (typeof CITY_COORDS !== 'undefined' && CITY_COORDS[cityKey]) return CITY_COORDS[cityKey];
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`);
        const results = await res.json();
        if (results && results.length > 0) return [parseFloat(results[0].lat), parseFloat(results[0].lon)];
      } catch (e) {}
      return null;
    };

    const destCoords = await getCoords(cleanCity) || [30.0869, 78.2676];
    const originCity = extractOriginName(data);
    let origCoords = null;
    if (originCity) origCoords = await getCoords(originCity);

    if (window.travelMapInstance) {
      window.travelMapInstance.remove();
    }

    window.travelMapInstance = L.map("travelMap").setView(destCoords, 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(window.travelMapInstance);

    const streetViewLink = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${destCoords[0]},${destCoords[1]}`;
    const waypoints = [destCoords];
    L.marker(destCoords, { icon: createPinIcon("🏁", "#ef4444") }).addTo(window.travelMapInstance)
      .bindPopup(`<b>🔴 Destination: ${cleanCity}</b><br><a href="${streetViewLink}" target="_blank" style="color:#2563eb;font-weight:800;">🌐 Open Street View</a>`)
      .openPopup();

    if (origCoords) {
      waypoints.push(origCoords);
      L.marker(origCoords, { icon: createPinIcon("🚀", "#10b981") }).addTo(window.travelMapInstance)
        .bindPopup(`<b>🟢 Starting Point: ${originCity}</b>`);

      L.polyline([origCoords, destCoords], { color: "#2563eb", weight: 5, opacity: 0.9, dashArray: "10, 10" }).addTo(window.travelMapInstance);

      const dist = calculateHaversineKm(origCoords[0], origCoords[1], destCoords[0], destCoords[1]);
      const miles = Math.round(dist * 0.621371);
      const busH = Math.max(1, Math.round(dist / 55));
      const trainH = Math.max(1, Math.round(dist / 75));
      if (distanceBar && distanceText) {
        distanceText.innerHTML = `
          <span>🚀 <b>${originCity}</b> ➔ 🏁 <b>${cleanCity}</b>: <span style="color:#60a5fa;font-weight:800;font-size:1.05rem;">${dist} km</span> (${miles} miles)</span>
          <span style="color:#cbd5e1;font-size:0.88rem;background:rgba(2,6,23,0.6);padding:4px 10px;border-radius:8px;">🚌 Bus: ~${busH}h &bull; 🚆 Train: ~${trainH}h</span>
        `;
        distanceBar.classList.remove("hidden");
      }
    } else {
      if (distanceBar) distanceBar.classList.add("hidden");
    }

    window.travelMapInstance.fitBounds(L.latLngBounds(waypoints), { padding: [50, 50], maxZoom: 12 });
    travelMapInstance = window.travelMapInstance;
    setTimeout(() => { if (travelMapInstance) travelMapInstance.invalidateSize(); }, 300);

  } catch (err) {
    console.error("Leaflet Map setup error:", err);
  }
}

function renderPackingChecklist(city, data) {
  const packingList = document.getElementById("packingList");
  const weatherBadge = document.getElementById("weatherSummaryBadge");
  if (!packingList) return;

  const weatherText = typeof data === "string" ? data : (data.weather_results || "");
  const fullPlanText = (data.itinerary || data.answer || "") + " " + (data.user_query || "");
  const planLower = fullPlanText.toLowerCase();
  const cityLower = city.toLowerCase();

  const isRain = /rain|shower|storm|wet|drizzle|monsoon/i.test(weatherText) || /rain/i.test(planLower);
  const isCold = /snow|freez|chill|cold|winter|ice/i.test(weatherText) || /manali|shimla|leh|ladakh|dharamshala|sikkim/i.test(cityLower);
  
  let temp = (typeof window.currentWeatherTemp === "number" && !isNaN(window.currentWeatherTemp))
    ? window.currentWeatherTemp
    : (isCold ? 14 : (cityLower.includes("jaipur") || cityLower.includes("dubai") ? 32 : 25));

  if (isRain) {
    weatherBadge.textContent = `🌧️ ${city}: ${temp}°C (Rainy Forecast)`;
  } else if (temp >= 28) {
    weatherBadge.textContent = `☀️ ${city}: ${temp}°C (Warm / Sunny)`;
  } else if (temp <= 18 || isCold) {
    weatherBadge.textContent = `❄️ ${city}: ${temp}°C (Cool / Alpine)`;
  } else {
    weatherBadge.textContent = `🌤️ ${city}: ${temp}°C (Pleasant Climate)`;
  }

  // 1. Mandatory Core Travel Documents & Tech
  const items = [
    { text: "Govt ID / Passport & Offline Train/Flight Tickets", icon: "🛂", checked: false },
    { text: "High-Capacity Power Bank (20,000mAh) & Fast Charging Cable", icon: "🔋", checked: false },
    { text: `Emergency Cash & UPI Mobile Apps (${currentCurrency})`, icon: "💳", checked: false },
    { text: "First Aid Kit, Motion Sickness & ORS Hydration Tablets", icon: "💊", checked: false },
  ];

  // 2. Destination-Specific Context Items
  if (/varanasi|kashi|haridwar|rishikesh|amritsar|tirupati|mathura|ayodhya/i.test(cityLower) || /temple|ghat|aarti|spiritual/i.test(planLower)) {
    items.push({ text: "Modest Cotton Outfits & Scarf/Shawl for Temple & Ghat Entry", icon: "🧕", checked: false });
    items.push({ text: "Slip-on Footwear (Easy removal at temples and ghat steps)", icon: "👡", checked: false });
    items.push({ text: "Hand Sanitizer & Pocket Wet Wipes for Street Food & Bazaars", icon: "🧴", checked: false });
  } else if (/goa|bali|phuket|pondicherry|varkala|gokarna|beach/i.test(cityLower) || /beach|swim|surf|coastal/i.test(planLower)) {
    items.push({ text: "Quick-Dry Swimwear & Microfiber Beach Towel", icon: "🩳", checked: false });
    items.push({ text: "Waterproof Phone Pouch & Dry Bag (10L)", icon: "📱", checked: false });
    items.push({ text: "Reef-Safe Sunscreen SPF 50+ & Polarized Sunglasses", icon: "🕶️", checked: false });
  } else if (/manali|dharamshala|shimla|ladakh|leh|sikkim|kasol|rishikesh/i.test(cityLower) || /trek|rafting|hiking|mountain/i.test(planLower)) {
    items.push({ text: "Ankle-Support Trekking Shoes with Deep Lug Grip", icon: "🥾", checked: false });
    items.push({ text: "Windcheater / Thermal Base Layers & Fleece Jacket", icon: "🧥", checked: false });
    items.push({ text: "Lip Balm with SPF & Cold Cream for Mountain Air", icon: "💄", checked: false });
  } else if (/dubai|tokyo|paris|singapore|london|bangkok/i.test(cityLower) || /international|flight/i.test(planLower)) {
    items.push({ text: "Universal Power Travel Adapter & Forex Travel Card", icon: "🔌", checked: false });
    items.push({ text: "Transit Metro Card / Nol Card & E-Visa Printouts", icon: "🎫", checked: false });
    items.push({ text: "Smart Casual Dinner Attire & Comfortable Walking Loafers", icon: "👟", checked: false });
  } else {
    items.push({ text: "Comfortable All-Day Walking Shoes for Local Sightseeing", icon: "👟", checked: false });
    items.push({ text: "Breathable Cotton Outfits & Daypack Backpack", icon: "🎒", checked: false });
  }

  // 3. Activity-Specific Items
  if (/rafting|water sports|cliff jump|kayak/i.test(planLower)) {
    items.push({ text: "Quick-Dry Activewear & Waterproof Action Bag", icon: "🚣", checked: false });
  }
  if (/boat|cruise|safari/i.test(planLower)) {
    items.push({ text: "Light Morning Windbreaker & Anti-Glare Eyewear", icon: "🌅", checked: false });
  }

  // 4. Weather-Specific Items
  if (isRain) {
    items.push({ text: "Compact Windproof Umbrella & Raincover for Backpack", icon: "☔", checked: false });
  } else if (temp >= 28) {
    items.push({ text: "UV Protection Sunglasses, Hat & Insulated Water Flask", icon: "🧢", checked: false });
  } else if (temp <= 18 || isCold) {
    items.push({ text: "Woolen Beanie & Thermal Gloves", icon: "🧤", checked: false });
  }

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

function renderBudgetAllocation(data, currency) {
  const container = document.getElementById("budgetBars");
  const pieSvg = document.getElementById("budgetPieSvg");
  const totalAmountEl = document.getElementById("pieTotalValue");
  const perPersonEl = document.getElementById("piePerPersonValue");
  if (!container) return;

  const { symbol, rate } = CURRENCY_RATES[currency] || CURRENCY_RATES.INR;

  // Extract exact budget from draft overview / constraints / decision engine
  let exactCostINR = 7500;
  if (data && typeof data === "object") {
    const decision = data.recommendation_decision || {};
    const best = decision.best_destination || {};
    const tripConstraints = data.trip_constraints || {};

    if (tripConstraints.budget) {
      const nums = tripConstraints.budget.replace(/,/g, "").match(/\d+/g);
      if (nums && nums.length >= 2) {
        exactCostINR = Math.round((parseInt(nums[0], 10) + parseInt(nums[1], 10)) / 2);
      } else if (nums && nums.length === 1) {
        exactCostINR = parseInt(nums[0], 10);
      }
    } else if (best.estimated_cost_max_inr && best.estimated_cost_min_inr) {
      exactCostINR = Math.round((best.estimated_cost_min_inr + best.estimated_cost_max_inr) / 2);
    } else if (data.budget_analysis && data.budget_analysis.total_estimated_cost_inr) {
      exactCostINR = Math.round(data.budget_analysis.total_estimated_cost_inr);
    }
  } else if (typeof data === "string") {
    const nums = data.replace(/,/g, "").match(/\d+/g);
    if (nums && nums.length > 0) {
      const val = parseInt(nums[0], 10);
      if (val > 500 && val < 500000) exactCostINR = val;
    }
  }

  const grandTotal = Math.round(exactCostINR * rate);

  if (totalAmountEl) {
    totalAmountEl.textContent = `${symbol}${grandTotal.toLocaleString()}`;
  }

  // Calibrated percentages with realistic, generous Food & Dining budget (28%)
  const categories = [
    { name: "Transit & RailRadar Trains", pct: 28, color: "#3b82f6", fillClass: "fill-flight" },
    { name: "Hostels & Stays", pct: 28, color: "#8b5cf6", fillClass: "fill-hotel" },
    { name: "Food, Cafes & Local Dining", pct: 28, color: "#10b981", fillClass: "fill-food" },
    { name: "Sightseeing & Activities", pct: 11, color: "#f59e0b", fillClass: "fill-sightseeing" },
    { name: "Emergency Buffer", pct: 5, color: "#64748b", fillClass: "fill-contingency" }
  ];

  if (pieSvg) {
    const radius = 70;
    const strokeWidth = 26;
    const cx = 100, cy = 100;
    const circumference = 2 * Math.PI * radius;
    let cumulativePercent = 0;

    pieSvg.innerHTML = "";
    categories.forEach((cat) => {
      const strokeDasharray = `${(cat.pct / 100) * circumference} ${circumference}`;
      const strokeDashoffset = -((cumulativePercent / 100) * circumference);

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "transparent");
      circle.setAttribute("stroke", cat.color);
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-dasharray", strokeDasharray);
      circle.setAttribute("stroke-dashoffset", strokeDashoffset);
      circle.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
      circle.style.transition = "stroke-dashoffset 0.6s ease, stroke-dasharray 0.6s ease";
      pieSvg.appendChild(circle);

      cumulativePercent += cat.pct;
    });
  }

  container.innerHTML = "";
  categories.forEach((cat) => {
    const categoryAmount = Math.round((grandTotal * cat.pct) / 100);
    const row = document.createElement("div");
    row.className = "budget-bar-row";
    row.innerHTML = `
      <div class="budget-bar-label">
        <span>${cat.name}</span>
        <strong>${symbol}${categoryAmount.toLocaleString()} (${cat.pct}%)</strong>
      </div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${cat.fillClass}" style="width: ${cat.pct}%"></div>
      </div>
    `;
    container.appendChild(row);
  });
}

function updateCurrency(newCurrency) {
  currentCurrency = newCurrency;
  if (latestTripData) {
    renderBudgetAllocation(latestTripData, currentCurrency);
    renderPackingChecklist(extractCityName(latestTripData), latestTripData);
  }
}

function updateGroupSize(newSize) {
  currentGroupSize = parseInt(newSize, 10) || 1;
  if (latestTripData) {
    renderBudgetAllocation(latestTripData, currentCurrency);
  }
}

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
      { native: "بकम هذا؟ (Bikam haza?)", meaning: "How much is this?" },
      { native: "شكراً (Shukran)", meaning: "Thank you" },
      { native: "ساعدني (Saa'idni)", meaning: "Help me" }
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

/* =========================================================
   Voice Narration & Export Handlers
   ========================================================= */
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
    if (voiceBtn) voiceBtn.classList.remove("speaking");
    if (voiceIcon) voiceIcon.textContent = "🔊";
    if (voiceText) voiceText.textContent = "Listen";
    return;
  }

  const resultBox = document.getElementById("resultBox");
  const rawText = resultBox ? resultBox.innerText.replace(/[#*`_\[\]]/g, "") : "";

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
    if (voiceBtn) voiceBtn.classList.add("speaking");
    if (voiceIcon) voiceIcon.textContent = "⏹️";
    if (voiceText) voiceText.textContent = "Stop";
  };

  speechUtterance.onend = () => {
    isSpeaking = false;
    if (voiceBtn) voiceBtn.classList.remove("speaking");
    if (voiceIcon) voiceIcon.textContent = "🔊";
    if (voiceText) voiceText.textContent = "Listen";
  };

  speechUtterance.onerror = () => {
    isSpeaking = false;
    if (voiceBtn) voiceBtn.classList.remove("speaking");
    if (voiceIcon) voiceIcon.textContent = "🔊";
    if (voiceText) voiceText.textContent = "Listen";
  };

  window.speechSynthesis.speak(speechUtterance);
}

function copyResult() {
  const resultBox = document.getElementById("resultBox");
  const text = resultBox ? resultBox.innerText : "";

  if (!text) return;

  navigator.clipboard.writeText(text)
    .then(() => {
      const copyBtn = document.querySelector(".copy-btn");
      if (copyBtn) {
        const oldText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = oldText;
        }, 1400);
      }
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
  const oldText = downloadBtn ? downloadBtn.textContent : "Download PDF";
  if (downloadBtn) {
    downloadBtn.textContent = "Preparing PDF...";
    downloadBtn.disabled = true;
  }

  const options = {
    margin: 0.5,
    filename: "ai-travel-plan.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
    jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["avoid-all", "css", "legacy"] }
  };

  html2pdf()
    .set(options)
    .from(pdfContent)
    .save()
    .then(() => {
      if (downloadBtn) {
        downloadBtn.textContent = oldText;
        downloadBtn.disabled = false;
      }
    })
    .catch(() => {
      if (downloadBtn) {
        downloadBtn.textContent = oldText;
        downloadBtn.disabled = false;
      }
      showError("Could not download PDF.");
    });
}

document.addEventListener("keydown", function(event) {
  if (event.ctrlKey && event.key === "Enter") {
    sendMessage();
  }
});
