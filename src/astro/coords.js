// Coordinate transformations and projections for Allsky Star Map Poster Generator

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPSILON = 23.4392911 * D2R; // Earth obliquity for J2000

const normalizeDegrees = (deg) => {
  const normalized = deg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const pathFromProjectedPoints = (points) => (
  points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
);

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
 * Computes Greenwich mean sidereal time in degrees for a UTC timestamp.
 */
export function getGreenwichSiderealDegrees(timestampMs) {
  const jd = timestampMs / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  return normalizeDegrees(
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000
  );
}

export function getLocalSiderealDegrees(timestampMs, longitudeDeg) {
  return normalizeDegrees(getGreenwichSiderealDegrees(timestampMs) + longitudeDeg);
}

export function getEquatorialAltitudeDegrees(raDeg, decDeg, latitudeDeg, localSiderealDeg) {
  const lat = latitudeDeg * D2R;
  const dec = decDeg * D2R;
  const hourAngle = normalizeDegrees(localSiderealDeg - raDeg) * D2R;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * R2D;
}

export function horizontalToEquatorial(azimuthDeg, altitudeDeg, latitudeDeg, localSiderealDeg) {
  const az = azimuthDeg * D2R;
  const alt = altitudeDeg * D2R;
  const lat = latitudeDeg * D2R;

  const sinDec = Math.sin(lat) * Math.sin(alt) + Math.cos(lat) * Math.cos(alt) * Math.cos(az);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const hourAngle = Math.atan2(
    -Math.sin(az) * Math.cos(alt),
    Math.cos(lat) * Math.sin(alt) - Math.sin(lat) * Math.cos(alt) * Math.cos(az)
  );

  return {
    ra: normalizeDegrees(localSiderealDeg - hourAngle * R2D),
    dec: dec * R2D,
  };
}

export function getVisibleSkyOverlay({
  projectFn,
  isNorth,
  limitDec,
  latitudeDeg,
  longitudeDeg,
  timestampMs,
  timeWindowHours = 0,
  sampleStepMinutes = 30,
  cellSizeDeg = 4,
}) {
  const localSiderealDeg = getLocalSiderealDegrees(timestampMs, longitudeDeg);
  const visibleCellPaths = [];
  const outlinePaths = [];
  const decMin = isNorth ? limitDec : -90;
  const decMax = isNorth ? 90 : limitDec;

  if (timeWindowHours <= 0) {
    for (let dec = decMin; dec < decMax; dec += cellSizeDeg) {
      const nextDec = Math.min(dec + cellSizeDeg, decMax);
      const centerDec = (dec + nextDec) / 2;

      for (let ra = 0; ra < 360; ra += cellSizeDeg) {
        const nextRa = ra + cellSizeDeg;
        const centerRa = normalizeDegrees(ra + cellSizeDeg / 2);

        if (getEquatorialAltitudeDegrees(centerRa, centerDec, latitudeDeg, localSiderealDeg) < 0) {
          continue;
        }

        const corners = [
          projectFn(ra, dec),
          projectFn(nextRa, dec),
          projectFn(nextRa, nextDec),
          projectFn(ra, nextDec),
        ];
        visibleCellPaths.push(`${pathFromProjectedPoints(corners)} Z`);
      }
    }

    let currentSegment = [];
    for (let i = 0; i <= 240; i++) {
      const eq = horizontalToEquatorial((i * 360) / 240, 0, latitudeDeg, localSiderealDeg);
      const inProjectedHemisphere = isNorth ? eq.dec >= limitDec : eq.dec <= limitDec;
      if (inProjectedHemisphere) {
        currentSegment.push(projectFn(eq.ra, eq.dec));
      } else if (currentSegment.length > 1) {
        outlinePaths.push(pathFromProjectedPoints(currentSegment));
        currentSegment = [];
      } else {
        currentSegment = [];
      }
    }
    if (currentSegment.length > 1) {
      outlinePaths.push(pathFromProjectedPoints(currentSegment));
    }

    return {
      visibleAreaPath: visibleCellPaths.join(' '),
      horizonPaths: outlinePaths,
    };
  }

  const halfWindowMs = (timeWindowHours * 60 * 60 * 1000) / 2;
  const sampleStepMs = sampleStepMinutes * 60 * 1000;
  const sampleSiderealDegrees = [];

  for (
    let sampleTimestampMs = timestampMs - halfWindowMs;
    sampleTimestampMs <= timestampMs + halfWindowMs + 1;
    sampleTimestampMs += sampleStepMs
  ) {
    sampleSiderealDegrees.push(getLocalSiderealDegrees(sampleTimestampMs, longitudeDeg));
  }

  const decBands = [];
  for (let dec = decMin; dec < decMax; dec += cellSizeDeg) {
    decBands.push({
      dec,
      nextDec: Math.min(dec + cellSizeDeg, decMax),
    });
  }

  const raBands = [];
  for (let ra = 0; ra < 360; ra += cellSizeDeg) {
    raBands.push({
      ra,
      nextRa: Math.min(ra + cellSizeDeg, 360),
    });
  }

  const visibleGrid = decBands.map(() => raBands.map(() => false));

  for (let row = 0; row < decBands.length; row++) {
    const { dec, nextDec } = decBands[row];
    const centerDec = (dec + nextDec) / 2;

    for (let col = 0; col < raBands.length; col++) {
      const { ra, nextRa } = raBands[col];
      const centerRa = normalizeDegrees((ra + nextRa) / 2);

      const visibleInWindow = sampleSiderealDegrees.some((localSiderealDeg) => (
        getEquatorialAltitudeDegrees(centerRa, centerDec, latitudeDeg, localSiderealDeg) >= 0
      ));

      if (!visibleInWindow) {
        continue;
      }

      visibleGrid[row][col] = true;
      const corners = [
        projectFn(ra, dec),
        projectFn(nextRa, dec),
        projectFn(nextRa, nextDec),
        projectFn(ra, nextDec),
      ];
      visibleCellPaths.push(`${pathFromProjectedPoints(corners)} Z`);
    }
  }

  const addOutlineSegment = (a, b) => {
    outlinePaths.push(pathFromProjectedPoints([a, b]));
  };

  const rowCount = decBands.length;
  const colCount = raBands.length;

  for (let row = 0; row < rowCount; row++) {
    const { dec, nextDec } = decBands[row];
    for (let col = 0; col < colCount; col++) {
      if (!visibleGrid[row][col]) continue;

      const { ra, nextRa } = raBands[col];
      const prevCol = (col - 1 + colCount) % colCount;
      const nextCol = (col + 1) % colCount;
      const lowerRowVisible = row > 0 && visibleGrid[row - 1][col];
      const upperRowVisible = row < rowCount - 1 && visibleGrid[row + 1][col];
      const leftColVisible = visibleGrid[row][prevCol];
      const rightColVisible = visibleGrid[row][nextCol];

      if (!lowerRowVisible) {
        addOutlineSegment(projectFn(ra, dec), projectFn(nextRa, dec));
      }
      if (!upperRowVisible) {
        addOutlineSegment(projectFn(ra, nextDec), projectFn(nextRa, nextDec));
      }
      if (!leftColVisible) {
        addOutlineSegment(projectFn(ra, dec), projectFn(ra, nextDec));
      }
      if (!rightColVisible) {
        addOutlineSegment(projectFn(nextRa, dec), projectFn(nextRa, nextDec));
      }
    }
  }

  return {
    visibleAreaPath: visibleCellPaths.join(' '),
    horizonPaths: outlinePaths,
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
