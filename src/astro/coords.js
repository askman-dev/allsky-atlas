// Coordinate transformations and projections for Allsky Star Map Poster Generator

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPSILON = 23.4392911 * D2R; // Earth obliquity for J2000

/**
 * Converts Galactic coordinates (l, b) to J2000 Equatorial coordinates (ra, dec) in degrees.
 * Uses Gaia DR1 / Hipparcos standard rotation matrix.
 */
export function galacticToEquatorial(lDeg, bDeg) {
  const l = lDeg * D2R;
  const b = bDeg * D2R;

  // Cartesian coordinates in Galactic frame
  const xG = Math.cos(b) * Math.cos(l);
  const yG = Math.cos(b) * Math.sin(l);
  const zG = Math.sin(b);

  // Transpose matrix multiplication (Galactic -> Equatorial)
  const xE = -0.05487556 * xG + 0.49410943 * yG - 0.86766615 * zG;
  const yE = -0.87343710 * xG - 0.44482963 * yG - 0.19807637 * zG;
  const zE = -0.48383499 * xG + 0.74698224 * yG + 0.45598379 * zG;

  const dec = Math.asin(zE);
  let ra = Math.atan2(yE, xE);
  if (ra < 0) ra += 2 * Math.PI;

  return {
    ra: ra * R2D,
    dec: dec * R2D
  };
}

/**
 * Converts Ecliptic coordinates (lambda, beta) to J2000 Equatorial coordinates (ra, dec) in degrees.
 * lambda = ecliptic longitude, beta = ecliptic latitude (usually 0 for the ecliptic line).
 */
export function eclipticToEquatorial(lambdaDeg, betaDeg = 0) {
  const lambda = lambdaDeg * D2R;
  const beta = betaDeg * D2R;

  const sinDec = Math.sin(beta) * Math.cos(EPSILON) + Math.cos(beta) * Math.sin(EPSILON) * Math.sin(lambda);
  const dec = Math.asin(sinDec);

  const yE = -Math.sin(beta) * Math.sin(EPSILON) + Math.cos(beta) * Math.cos(EPSILON) * Math.sin(lambda);
  const xE = Math.cos(beta) * Math.cos(lambda);

  let ra = Math.atan2(yE, xE);
  if (ra < 0) ra += 2 * Math.PI;

  return {
    ra: ra * R2D,
    dec: dec * R2D
  };
}

/**
 * Projects equatorial J2000 coordinates (ra, dec) in degrees onto the 2D Northern circular map.
 * Center is Dec = +90 (North Pole).
 * 
 * @param {number} ra Right Ascension in degrees (0-360)
 * @param {number} dec Declination in degrees (-90 to +90)
 * @param {number} maxRadius Radius of the circular canvas in pixels
 * @param {string} projectionType 'polar_equidistant' or 'polar_stereographic'
 * @param {number} overlapDec Minimum declination to render (e.g. -55)
 * @param {number} rotationAngle Map rotation in degrees (e.g. 0)
 */
export function projectNorth(ra, dec, maxRadius, projectionType, overlapDec = -55, rotationAngle = 0) {
  const decMin = overlapDec;
  const maxDecDiff = 90 - decMin; // e.g., 90 - (-55) = 145 degrees
  const d = 90 - dec; // distance from North Pole in degrees

  // Angle theta: J2000 RA increases counter-clockwise, RA=0 starts at bottom/horizontal
  // Subtracting rotation to allow rotation of map
  const theta = - (ra + rotationAngle) * D2R - Math.PI / 2;

  let r = 0;
  if (projectionType === 'polar_equidistant') {
    r = maxRadius * (d / maxDecDiff);
  } else {
    // Polar stereographic: r = R * tan(d/2) / tan(maxDecDiff/2)
    r = maxRadius * Math.tan(d / 2 * D2R) / Math.tan(maxDecDiff / 2 * D2R);
  }

  return {
    x: r * Math.cos(theta),
    y: r * Math.sin(theta),
    r
  };
}

/**
 * Projects equatorial J2000 coordinates (ra, dec) in degrees onto the 2D Southern circular map.
 * Center is Dec = -90 (South Pole).
 * 
 * @param {number} ra Right Ascension in degrees (0-360)
 * @param {number} dec Declination in degrees (-90 to +90)
 * @param {number} maxRadius Radius of the circular canvas in pixels
 * @param {string} projectionType 'polar_equidistant' or 'polar_stereographic'
 * @param {number} overlapDec Maximum declination to render (e.g. +55)
 * @param {number} rotationAngle Map rotation in degrees (e.g. 0)
 */
export function projectSouth(ra, dec, maxRadius, projectionType, overlapDec = 55, rotationAngle = 0) {
  const decMax = overlapDec;
  const maxDecDiff = decMax - (-90); // e.g., 55 + 90 = 145 degrees
  const d = dec - (-90); // distance from South Pole in degrees

  // Angle theta: looking at South Pole, RA rotation is reversed
  const theta = (ra + rotationAngle) * D2R - Math.PI / 2;

  let r = 0;
  if (projectionType === 'polar_equidistant') {
    r = maxRadius * (d / maxDecDiff);
  } else {
    r = maxRadius * Math.tan(d / 2 * D2R) / Math.tan(maxDecDiff / 2 * D2R);
  }

  return {
    x: r * Math.cos(theta),
    y: r * Math.sin(theta),
    r
  };
}

/**
 * Generates continuous path data for a declination circle.
 */
export function getDecCirclePoints(dec, projectFn, steps = 120) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const ra = (i * 360) / steps;
    const pt = projectFn(ra, dec);
    points.push(pt);
  }
  return points;
}

/**
 * Generates coordinate lines (RA radials and Dec circles).
 */
export function getGridLines(projectFn, overlapDec, isNorth) {
  const lines = {
    decCircles: [],
    raRadials: [],
  };

  // Declination circles (every 15 degrees)
  const decs = isNorth
    ? [80, 60, 40, 20, 0, -20, -40, -50]
    : [-80, -60, -40, -20, 0, 20, 40, 50];

  for (const dec of decs) {
    lines.decCircles.push({
      dec,
      points: getDecCirclePoints(dec, projectFn)
    });
  }

  // Right Ascension radial lines (every 1 hour = 15 degrees)
  for (let hour = 0; hour < 24; hour++) {
    const ra = hour * 15;
    const points = [];
    // Draw from pole to the overlap limit
    const startDec = isNorth ? 90 : -90;
    const endDec = overlapDec;
    const step = (endDec - startDec) / 10;
    for (let i = 0; i <= 10; i++) {
      const dec = startDec + i * step;
      points.push(projectFn(ra, dec));
    }
    lines.raRadials.push({
      ra,
      hour,
      points
    });
  }

  return lines;
}

/**
 * Generates coordinate points for the Ecliptic path.
 */
export function getEclipticPoints(projectFn, steps = 180) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const lambda = (i * 360) / steps;
    const eq = eclipticToEquatorial(lambda, 0);
    points.push(projectFn(eq.ra, eq.dec));
  }
  return points;
}

/**
 * Generates coordinate points for a Galactic latitude contour line.
 * e.g., b = 0 for galactic equator, or b = +/- 15 for Milky Way band contours.
 */
export function getGalacticContourPoints(bVal, projectFn, steps = 180) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const l = (i * 360) / steps;
    const eq = galacticToEquatorial(l, bVal);
    points.push(projectFn(eq.ra, eq.dec));
  }
  return points;
}
