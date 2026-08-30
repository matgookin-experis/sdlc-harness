# Manual Test Checklist — Weather Dashboard

Use this checklist to verify the application before merging any branch.
Open `index.html` directly in a browser; no server is required.

Mark each item **✅ Pass**, **❌ Fail**, or **⚠ N/A** when testing.

---

## 1. Default Weather Display

| # | Step | Expected Result | Result |
|---|---|---|---|
| 1.1 | Open `index.html` in a browser | Page loads without errors (check browser console) | |
| 1.2 | Observe the weather card without interacting | Card shows "New York" with temperature, condition, humidity, wind speed, UV Index, sunburn-risk guidance, and a "Last updated" time | |
| 1.3 | No city is entered in the input field | Input field is empty; no validation message is shown | |

---

## 2. Valid City Search

| # | Step | Expected Result | Result |
|---|---|---|---|
| 2.1 | Type `London` into the city input and click **Search** | Weather card updates to show "London" with deterministic mock data | |
| 2.2 | Search for `London` a second time | Identical temperature, condition, humidity, and wind speed as the first search (deterministic) | |
| 2.2a | Search `London`, `Berlin`, `Sydney`, `Mumbai` and `Toronto` in turn | Every reading is physically possible: humidity between 20% and 95%, wind speed between 0 and 40 mph, temperature between 20°F and 100°F. No negative values. | |
| 2.3 | Search for a different city, e.g. `Tokyo` | Card updates to show "Tokyo" with different values from "London" | |
| 2.4 | Search for a multi-word city, e.g. `Los Angeles` | Card displays "Los Angeles" in title case | |
| 2.5 | Search for a city name with mixed case, e.g. `pARIS` | Card displays "Paris" (title-cased) | |

---

## 3. Empty City Validation

| # | Step | Expected Result | Result |
|---|---|---|---|
| 3.1 | Leave the input empty and click **Search** | A red validation message appears: "Please enter a city name before searching." | |
| 3.2 | Observe the input field border after submitting empty | Input border turns red / error style is applied | |
| 3.3 | Start typing in the input after a validation error | Error message disappears and input returns to its normal style | |
| 3.4 | Clear the input after a successful search and click **Search** | Validation error appears again | |

---

## 4. Enter-Key Search

| # | Step | Expected Result | Result |
|---|---|---|---|
| 4.1 | Type `Berlin` into the input and press **Enter** | Weather card updates with "Berlin" data (same as clicking Search) | |
| 4.2 | Focus the input field using the **Tab** key, type a city, and press **Enter** | Search executes correctly without using the mouse | |

---

## 5. Loading State

| # | Step | Expected Result | Result |
|---|---|---|---|
| 5.1 | Type any city and click **Search** | A spinner and "Fetching weather data…" message briefly appears over the card | |
| 5.2 | Observe the Search button during loading | Button is disabled (cannot be clicked again) while the spinner is visible | |
| 5.3 | Wait for the result | Spinner disappears, card updates with new data, button becomes active again | |

---

## 6. Theme Toggle and Persistence

| # | Step | Expected Result | Result |
|---|---|---|---|
| 6.1 | Click the **Dark** toggle in the header | Background, card, and text switch to dark colours; toggle label changes to "Light" | |
| 6.2 | Click the **Light** toggle | Page reverts to light colours; label changes back to "Dark" | |
| 6.3 | Switch to dark mode, then reload the page | Dark mode is still active after reload (persisted in `localStorage`) | |
| 6.4 | Switch back to light mode, then reload the page | Light mode is still active after reload | |
| 6.5 | Navigate to the toggle using **Tab** and activate with **Space** or **Enter** | Theme changes correctly via keyboard | |

---

## 7. Mobile Responsiveness

| # | Step | Expected Result | Result |
|---|---|---|---|
| 7.1 | Open browser DevTools and set viewport to 375 × 812 (iPhone SE) | Page renders without horizontal overflow; all content is visible | |
| 7.2 | Observe the search area at narrow width | Input and Search button stack vertically (Search button is full width) | |
| 7.3 | Observe the weather card details at narrow width | Humidity and Wind Speed stack in a single column | |
| 7.4 | Observe the header at narrow width | App title and theme toggle remain readable; no overlap | |
| 7.5 | Perform a search on the narrow viewport | Search, validation, and card update all work correctly | |

---

## 8. Accessibility Spot Checks

| # | Step | Expected Result | Result |
|---|---|---|---|
| 8.1 | Tab through the entire page without a mouse | Focus order: skip link → theme toggle → city input → search button | |
| 8.2 | Observe focus indicators on each interactive element | Visible blue outline is shown on each focused element | |
| 8.3 | Trigger the validation error | Screen-reader `role="alert"` region announces the error message | |
| 8.4 | Check the theme toggle `aria-label` in dark mode | `aria-label` reads "Switch to light mode" | |

---

## 9. UV Index and Sunburn Risk

| # | Step | Expected Result | Result |
|---|---|---|---|
| 9.1 | Search for the same city twice | The UV Index, risk category, and guidance are identical both times | |
| 9.2 | Search several different cities | Each UV Index is an integer from 0 to 12 and shows Low, Moderate, High, Very High, or Extreme risk | |
| 9.3 | Observe the UV risk display | The numeric value and text category are both visible, so risk is not communicated by colour alone | |
| 9.4 | Switch between light and dark themes | The UV badge and guidance remain readable in both themes | |
| 9.5 | Set the viewport to 375 × 812 | The UV value, badge, and guidance fit without horizontal scrolling | |

### Automated UV checks

Run `node uv-index.test.js` from this directory. It verifies deterministic generation,
the 0–12 range, and every risk-category boundary.
