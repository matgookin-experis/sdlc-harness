/**
 * app.js – Weather Dashboard (SDLC Harness Demo)
 *
 * This file owns all runtime behaviour:
 *  - Mock weather data generation (deterministic, city-name based)
 *  - Search form submission and validation
 *  - Loading state management
 *  - Weather card rendering
 *  - Light/dark theme toggle with localStorage persistence
 */

/* ------------------------------------------------------------------ */
/* 1. Mock data                                                        */
/*                                                                     */
/* There is no external API.  Instead we derive pseudo-random but      */
/* stable values from the city name using a simple hash function so    */
/* that the same city always returns the same numbers, which makes     */
/* demo walkthroughs repeatable.                                       */
/* ------------------------------------------------------------------ */

/**
 * A small set of weather conditions to choose from.
 * @type {string[]}
 */
const WEATHER_CONDITIONS = [
  'Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain',
  'Thunderstorm', 'Snow Flurries', 'Foggy', 'Windy', 'Clear',
];

/**
 * Compute a simple, non-cryptographic hash of a string.
 * Returns a non-negative integer.  Used to seed mock data from the
 * city name so results are deterministic.
 *
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return hash;
}

/**
 * Generate deterministic mock weather data for the given city.
 *
 * @param {string} city  City name as entered by the user.
 * @returns {{city: string, tempF: number, condition: string, humidity: string, wind: string, updatedAt: string}}
 */
function getMockWeather(city) {
  const seed = hashString(city.toLowerCase().trim());

  // Temperature: 20 °F – 100 °F range
  const tempF = 20 + (seed % 81);

  // Pick a condition from the list
  const condition = WEATHER_CONDITIONS[seed % WEATHER_CONDITIONS.length];

  // Humidity: 20 % – 95 %
  // NOTE: >>> not >>. The seed is an unsigned 32-bit value, but `>>` coerces
  // to signed first, so any seed >= 2^31 went negative and produced
  // impossible readings (e.g. London: -3 % humidity, -22 mph wind).
  const humidity = (20 + ((seed >>> 4) % 76)) + '%';

  // Wind speed: 0 – 40 mph
  const wind = ((seed >>> 8) % 41) + ' mph';

  // Current timestamp
  const now = new Date();
  const updatedAt = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return {
    city: toTitleCase(city.trim()),
    tempF,
    condition,
    humidity,
    wind,
    updatedAt,
  };
}

/**
 * Convert a string to title case (first letter of each word capitalised).
 *
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return str.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/* ------------------------------------------------------------------ */
/* 2. DOM references                                                   */
/* ------------------------------------------------------------------ */
const searchForm        = document.getElementById('search-form');
const cityInput         = document.getElementById('city-input');
const searchBtn         = document.getElementById('search-btn');
const validationMsg     = document.getElementById('validation-message');
const loadingOverlay    = document.getElementById('loading-overlay');
const cardCity          = document.getElementById('card-city');
const cardTemp          = document.getElementById('card-temp');
const cardCondition     = document.getElementById('card-condition');
const cardHumidity      = document.getElementById('card-humidity');
const cardWind          = document.getElementById('card-wind');
const cardUpdated       = document.getElementById('card-updated');
const themeToggleBtn    = document.getElementById('theme-toggle');

/* ------------------------------------------------------------------ */
/* 3. UI state helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Update the weather card with new data.
 *
 * @param {{city: string, tempF: number, condition: string, humidity: string, wind: string, updatedAt: string}} data
 */
function renderWeatherCard(data) {
  cardCity.textContent      = data.city;
  cardTemp.textContent      = data.tempF;
  cardCondition.textContent = data.condition;
  cardHumidity.textContent  = data.humidity;
  cardWind.textContent      = data.wind;
  cardUpdated.textContent   = 'Last updated: ' + data.updatedAt;
}

/**
 * Show or hide the loading overlay that sits above the weather card.
 * The search button is disabled while loading to prevent duplicate requests.
 *
 * @param {boolean} isLoading
 */
function setLoading(isLoading) {
  loadingOverlay.hidden = !isLoading;
  searchBtn.disabled    = isLoading;
}

/**
 * Show a validation error on the input.
 * Clears automatically on the next successful search.
 *
 * @param {string} message  Human-readable error text.
 */
function showValidationError(message) {
  validationMsg.textContent = message;
  cityInput.classList.add('is-invalid');
  cityInput.setAttribute('aria-invalid', 'true');
}

/** Remove any active validation error state. */
function clearValidationError() {
  validationMsg.textContent = '';
  cityInput.classList.remove('is-invalid');
  cityInput.removeAttribute('aria-invalid');
}

/* ------------------------------------------------------------------ */
/* 4. Search handler                                                   */
/*                                                                     */
/* Simulates an async data fetch with a short setTimeout so the       */
/* loading state is visible during a demo walkthrough.                 */
/* ------------------------------------------------------------------ */

/**
 * Validate input, show loading, then render mock weather data.
 */
function handleSearch() {
  const city = cityInput.value.trim();

  // Validate: city must not be empty
  if (!city) {
    showValidationError('Please enter a city name before searching.');
    cityInput.focus();
    return;
  }

  clearValidationError();
  setLoading(true);

  // Simulate a short network delay (300 ms) to exercise the loading state
  setTimeout(function () {
    const data = getMockWeather(city);
    renderWeatherCard(data);
    setLoading(false);
    // Clear the input after a successful search for a clean UX
    cityInput.value = '';
  }, 300);
}

/* ------------------------------------------------------------------ */
/* 5. Event listeners                                                  */
/* ------------------------------------------------------------------ */

// Form submission (button click or Enter key inside the input)
searchForm.addEventListener('submit', function (event) {
  event.preventDefault();
  handleSearch();
});

// Clear validation error as soon as the user starts typing again
cityInput.addEventListener('input', function () {
  if (cityInput.classList.contains('is-invalid')) {
    clearValidationError();
  }
});

/* ------------------------------------------------------------------ */
/* 6. Theme toggle                                                     */
/*                                                                     */
/* The theme is stored in localStorage under the key 'sdlc-theme'.   */
/* On load we apply any saved preference before painting the page.    */
/* ------------------------------------------------------------------ */

const THEME_STORAGE_KEY = 'sdlc-theme';
const DARK_THEME        = 'dark';
const LIGHT_THEME       = 'light';

/**
 * Apply a theme to <body> and update the toggle button's accessible
 * label and visible text.
 *
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  const isDark = theme === DARK_THEME;
  document.body.setAttribute('data-theme', theme);

  // Update ARIA state and visible label so the button always describes
  // what will happen next (i.e. "Switch to dark mode" when in light mode)
  themeToggleBtn.setAttribute('aria-pressed', String(isDark));
  themeToggleBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggleBtn.querySelector('.toggle-icon').textContent  = isDark ? '☀️' : '🌙';
  themeToggleBtn.querySelector('.toggle-label').textContent = isDark ? 'Light' : 'Dark';
}

/** Toggle between light and dark and persist the choice. */
function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || LIGHT_THEME;
  const next    = current === DARK_THEME ? LIGHT_THEME : DARK_THEME;
  applyTheme(next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
}

themeToggleBtn.addEventListener('click', toggleTheme);

/* ------------------------------------------------------------------ */
/* 7. Initialisation                                                   */
/*                                                                     */
/* Runs once when the script is first parsed (deferred by placement   */
/* at the bottom of <body>).  Restores saved theme and shows a        */
/* default weather card so the page is never empty on first load.     */
/* ------------------------------------------------------------------ */

(function init() {
  // Restore saved theme preference (falls back to light)
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || LIGHT_THEME;
  applyTheme(savedTheme);

  // Show a default weather card for "New York" on first load
  renderWeatherCard(getMockWeather('New York'));
}());
