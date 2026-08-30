# Weather Dashboard — SDLC Harness Demo

A minimal, self-contained web application built to demonstrate an end-to-end SDLC
workflow using the **SDLC Harness** project.  The app itself is intentionally simple
so that every team member can understand the full codebase in minutes, then use it
to practise branching, committing, reviewing, and tracing changes back to work items.

---

## Purpose

This application serves as the **demo artefact** for the SDLC Harness IBM Hackathon
project.  It is not a production weather service; it uses deterministic mock data so
that the same city name always produces the same result, making demo walkthroughs
repeatable without an API key or network connection.

---

## Files

| File | Description |
|---|---|
| `index.html` | Application shell — semantic HTML, accessible landmarks and form |
| `styles.css` | All styling — CSS custom properties, card layout, dark mode, responsive breakpoints |
| `app.js` | Main runtime behaviour — mock weather data, search, validation, loading state, theme toggle |
| `uv-index.js` | Deterministic UV Index generation and risk/guidance classification |
| `uv-index.test.js` | Dependency-free automated checks for UV generation and category boundaries |
| `WEATHER-DASHBOARD.md` | This file |
| `tests.md` | Manual test checklist |

---

## Running Locally

1. Clone or download this repository.
2. Open **`index.html`** directly in any modern browser (Chrome, Firefox, Edge, Safari).
   No server, build step, or package manager is required.

```
# macOS / Linux (optional)
open index.html

# Windows (optional)
start index.html
```

---

## Features

- **City search** — Enter any city name and press Enter or click Search to see mock
  weather data generated deterministically from the city name.
- **Default result** — "New York" is displayed on first load so the page is never blank.
- **Validation** — An error message is shown when the city field is empty.
- **Loading state** — A brief spinner simulates an async data fetch (300 ms).
- **UV Index and sunburn risk** — Every city receives a deterministic UV Index from
  0–12, a named risk category, and concise sun-protection guidance.
- **Light / Dark theme** — Toggle button in the header; selection is persisted in
  `localStorage` across page reloads.
- **Accessible** — Semantic HTML, ARIA labels, keyboard navigation, and visible focus
  indicators throughout.
- **Responsive** — Single-column layout on mobile (≤ 600 px), side-by-side header on
  wider screens.

---

## Suggested SDLC Demo Changes

Use these as concrete tasks to walk through branching, committing, reviewing, and
linking changes back to work items in SDLC Harness:

1. **Add a 5-day forecast section** — extend `getMockWeather()` in `app.js` to return
   an array of daily forecasts and add a new card row in `index.html`.

2. **Change temperature units** — add a °C / °F toggle; store the preference in
   `localStorage` alongside the theme.

3. **Stricter city-name validation** — reject inputs that contain numbers or special
   characters; add the regex rule to `handleSearch()` and expand the test checklist.

4. **Write automated unit tests** — create `tests.js` using plain `console.assert`
   calls (no test framework needed) and open it in the browser console to verify
   `getMockWeather()` and `hashString()` behave correctly.

5. **Real API integration** — replace `getMockWeather()` with a `fetch()` call to the
   [Open-Meteo API](https://open-meteo.com/) (free, no key required) and handle the
   async response; update `tests.md` to cover network-error states.

6. **Internationalisation** — add a language selector that switches UI strings between
   English and another language using a simple JavaScript object map.
