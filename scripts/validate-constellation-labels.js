/* global process */

import stars from '../public/data/stars.normalized.json' with { type: 'json' };
import westernConstellations from '../public/data/constellations.western.json' with { type: 'json' };
import boundaries from '../public/data/boundaries.json' with { type: 'json' };
import { projectNorth, projectSouth } from '../src/astro/coords.js';
import {
  getProjectedBoundaryPolygon,
  getVisualBoundaryLabelPoint,
} from '../src/astro/constellationLabels.js';
import {
  getPolygonContainmentRatio,
  resolveLabels,
} from '../src/labels/collision.js';

const R = 330;
const OVERLAP_DEC = 20;
const PROJECTION = 'polar_equidistant';
const starsByHip = new Map(stars.map((star) => [star.hip, star]));

function getConstellationCentroid(edges) {
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;
  const visitedHips = new Set();

  for (const [hip1, hip2] of edges) {
    for (const hip of [hip1, hip2]) {
      if (visitedHips.has(hip)) continue;
      visitedHips.add(hip);
      const star = starsByHip.get(hip);
      if (!star) continue;

      const decRad = star.dec * Math.PI / 180;
      const raRad = star.ra * Math.PI / 180;
      sumX += Math.cos(decRad) * Math.cos(raRad);
      sumY += Math.cos(decRad) * Math.sin(raRad);
      sumZ += Math.sin(decRad);
      count++;
    }
  }

  if (count === 0) return null;

  let ra = Math.atan2(sumY / count, sumX / count) * 180 / Math.PI;
  if (ra < 0) ra += 360;

  return {
    ra,
    dec: Math.asin(sumZ / count) * 180 / Math.PI,
  };
}

function getProjectedLabelPoint(con, polygon, projectFn, mode) {
  if (mode === 'boundary') {
    const point = getVisualBoundaryLabelPoint(polygon);
    if (point) return point;
  }

  const center = getConstellationCentroid(con.edges);
  return center ? projectFn(center.ra, center.dec) : null;
}

function getLabelText(con, language) {
  return language === 'zh' ? con.nameZh : con.nameEn;
}

function getLegacyResolvedLabels(labels) {
  return labels.map((label) => {
    const charCount = label.text.length;
    const fontSize = 11;
    const width = charCount * 7.5 + 8;
    const height = 13;
    const dotRadius = label.dotRadius || 3;

    return {
      ...label,
      renderX: label.x + dotRadius + 4,
      renderY: label.y + height / 2 - 2,
      anchor: 'start',
      fontSize,
      box: {
        x1: label.x + dotRadius + 2,
        y1: label.y - height / 2,
        x2: label.x + dotRadius + 2 + width,
        y2: label.y + height / 2,
      },
    };
  });
}

function validateHemisphere(isNorth, mode, language) {
  const projectFn = isNorth
    ? (ra, dec) => projectNorth(ra, dec, R, PROJECTION, -OVERLAP_DEC, 0)
    : (ra, dec) => projectSouth(ra, dec, R, PROJECTION, OVERLAP_DEC, 0);
  const limitDec = isNorth ? -OVERLAP_DEC : OVERLAP_DEC;
  const labels = [];
  const polygonsById = new Map();
  const constellationsById = new Map();

  for (const con of westernConstellations) {
    const center = getConstellationCentroid(con.edges);
    if (!center) continue;
    const inPrimaryHemisphere = isNorth ? center.dec >= 0 : center.dec < 0;
    if (!inPrimaryHemisphere) continue;

    const polygon = getProjectedBoundaryPolygon(boundaries[con.abbr] || [], projectFn, limitDec, isNorth);
    if (polygon.length < 3) continue;

    const point = getProjectedLabelPoint(con, polygon, projectFn, mode);
    if (!point || Math.hypot(point.x, point.y) >= R - 15) continue;

    const id = `con-${con.abbr}`;
    labels.push({
      id,
      text: getLabelText(con, language),
      x: point.x,
      y: point.y,
      priority: 1,
      type: 'constellation',
      dotRadius: 0,
      constrainPolygon: polygon,
    });
    polygonsById.set(id, polygon);
    constellationsById.set(id, con);
  }

  const resolvedLabels = mode === 'centroid'
    ? getLegacyResolvedLabels(labels)
    : resolveLabels(labels, R, []);
  const failures = [];

  for (const label of resolvedLabels) {
    const polygon = polygonsById.get(label.id);
    const con = constellationsById.get(label.id);
    const containmentRatio = getPolygonContainmentRatio(label.box, polygon);

    if (containmentRatio < 5 / 9) {
      failures.push({
        abbr: con.abbr,
        name: con.nameEn,
        hemisphere: isNorth ? 'north' : 'south',
        containmentRatio: Number(containmentRatio.toFixed(2)),
      });
    }
  }

  return failures;
}

const mode = process.argv.includes('--current-centroids') ? 'centroid' : 'boundary';
const language = process.argv.includes('--en') ? 'en' : 'zh';
const failures = [
  ...validateHemisphere(true, mode, language),
  ...validateHemisphere(false, mode, language),
];

if (failures.length > 0) {
  console.error(`Constellation labels outside their rendered boundary regions: ${failures.length}`);
  for (const failure of failures) {
    console.error(`${failure.hemisphere} ${failure.abbr} ${failure.name} containment=${failure.containmentRatio}`);
  }
  process.exit(1);
}

console.log(`Constellation label validation passed in ${mode} mode for ${language} labels.`);
