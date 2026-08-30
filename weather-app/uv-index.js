/**
 * Convert the weather seed into a deterministic UV Index from 0 to 12.
 * Values of 11 and 12 represent the standard 11+ Extreme category.
 *
 * @param {number} seed Non-negative weather seed from hashString().
 * @returns {number}
 */
function getUvIndex(seed) {
  return (seed >>> 12) % 13;
}

/**
 * Return the display category and general sun-protection guidance for a UV Index.
 * Thresholds follow the standard Low, Moderate, High, Very High, and Extreme scale.
 *
 * @param {number} uvIndex Integer UV Index value.
 * @returns {{level: string, key: string, guidance: string}}
 */
function getUvRisk(uvIndex) {
  if (!Number.isInteger(uvIndex) || uvIndex < 0) {
    throw new TypeError('UV Index must be a non-negative integer.');
  }

  if (uvIndex <= 2) {
    return {
      level: 'Low',
      key: 'low',
      guidance: 'Minimal protection is generally needed. Sunglasses are recommended on bright days.',
    };
  }
  if (uvIndex <= 5) {
    return {
      level: 'Moderate',
      key: 'moderate',
      guidance: 'Use SPF 30+ sunscreen and seek shade around midday.',
    };
  }
  if (uvIndex <= 7) {
    return {
      level: 'High',
      key: 'high',
      guidance: 'Use SPF 30+ sunscreen, protective clothing, and midday shade.',
    };
  }
  if (uvIndex <= 10) {
    return {
      level: 'Very High',
      key: 'very-high',
      guidance: 'Extra protection is needed. Limit midday sun and reapply SPF 30+ sunscreen.',
    };
  }
  return {
    level: 'Extreme',
    key: 'extreme',
    guidance: 'Avoid midday sun when possible and use clothing, shade, and SPF 30+ sunscreen.',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getUvIndex, getUvRisk };
}
