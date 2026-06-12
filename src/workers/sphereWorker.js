import {
  projectNorth,
  projectSouth,
  getGridLines,
  getEclipticPoints,
  getGalacticContourPoints,
  getVisibleSkyOverlay,
} from '../astro/coords';
import {
  getProjectedBoundaryFillPaths,
  getProjectedBoundaryPolygon,
  getVisualBoundaryLabelPoint,
} from '../astro/constellationLabels';
import { resolveLabels } from '../labels/collision';

const pathFromPoints = (points) => (
  points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
);

const getRibbonPath = (pos, neg) => {
  if (pos.length === 0) return '';
  const d = [];
  d.push(`M ${pos[0].x.toFixed(2)} ${pos[0].y.toFixed(2)}`);
  for (let i = 1; i < pos.length; i++) d.push(`L ${pos[i].x.toFixed(2)} ${pos[i].y.toFixed(2)}`);
  for (let i = neg.length - 1; i >= 0; i--) d.push(`L ${neg[i].x.toFixed(2)} ${neg[i].y.toFixed(2)}`);
  d.push('Z');
  return d.join(' ');
};

const getLocalizedText = (labelLanguageMode, zh, en, order = 'zh-first') => {
  if (labelLanguageMode === 'zh') return zh || en || '';
  if (labelLanguageMode === 'en' || labelLanguageMode === 'both') return en || zh || '';
  const primary = order === 'en-first' ? en : zh;
  const secondary = order === 'en-first' ? zh : en;
  return [primary, secondary].filter(Boolean).join(' / ');
};

const isMagnitudeVisible = (star, settings) => {
  const MAG_RANGE_MIN = 0;
  const MAG_RANGE_PLUS = 7;
  const passesMin = settings.minMagLimit <= MAG_RANGE_MIN
    ? true
    : settings.minMagLimit >= MAG_RANGE_PLUS
      ? star.mag >= 6
      : star.mag >= settings.minMagLimit;
  const passesMax = settings.magLimit >= MAG_RANGE_PLUS ? true : star.mag <= settings.magLimit;
  return passesMin && passesMax;
};

function computeSphere({
  isNorth,
  sphereRadius,
  settings,
  stars,
  westernConstellations,
  chineseConstellations,
  boundaries,
  boundarySegments,
  boundaryColorMap,
  westernCenters,
  chineseCenters,
  constellationStarHips,
  typography,
}) {
  const starsMap = new Map(stars.map((star) => [star.hip, star]));
  const constellationStarHipSet = new Set(constellationStarHips);
  const projectFn = isNorth
    ? (ra, dec) => projectNorth(ra, dec, sphereRadius, settings.projection, -settings.overlapDec, settings.northRotation)
    : (ra, dec) => projectSouth(ra, dec, sphereRadius, settings.projection, settings.overlapDec, settings.southRotation);
  const limitDec = isNorth ? -settings.overlapDec : settings.overlapDec;

  const visibleStars = stars.filter((star) => {
    if (!(constellationStarHipSet.has(star.hip) || isMagnitudeVisible(star, settings))) return false;
    return isNorth ? star.dec >= limitDec : star.dec <= limitDec;
  });

  const starPoints = visibleStars.map((star) => {
    const pt = projectFn(star.ra, star.dec);
    return {
      hip: star.hip,
      mag: star.mag,
      nameZh: star.nameZh,
      nameEn: star.nameEn,
      colorIdx: star.colorIdx,
      x: pt.x,
      y: pt.y,
      r: Math.max(0.5, 4.5 - 0.6 * star.mag),
    };
  });

  const grid = getGridLines(projectFn, limitDec, isNorth);
  const equatorPoints = grid.decCircles.find((circle) => circle.dec === 0)?.points || [];
  const eclipticPath = pathFromPoints(getEclipticPoints(projectFn));
  const equatorPath = pathFromPoints(equatorPoints);

  const mwOuterPath = getRibbonPath(
    getGalacticContourPoints(17, projectFn),
    getGalacticContourPoints(-17, projectFn)
  );
  const mwInnerPath = getRibbonPath(
    getGalacticContourPoints(9, projectFn),
    getGalacticContourPoints(-9, projectFn)
  );

  const visibleSkyOverlay = settings.showVisibleSky
    ? getVisibleSkyOverlay({
      projectFn,
      isNorth,
      limitDec,
      latitudeDeg: settings.observerLatitude,
      longitudeDeg: settings.observerLongitude,
      timestampMs: settings.observerTimestampMs,
      timeWindowHours: settings.showVisibleSkyTimeWindow ? 6 : 0,
    })
    : null;

  const boundaryPath = boundarySegments
    .filter(([a, b]) => {
      const aVisible = isNorth ? a.dec >= limitDec : a.dec <= limitDec;
      const bVisible = isNorth ? b.dec >= limitDec : b.dec <= limitDec;
      return aVisible || bVisible;
    })
    .map(([a, b]) => {
      const p1 = projectFn(a.ra, a.dec);
      const p2 = projectFn(b.ra, b.dec);
      return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    })
    .join(' ');

  const boundaryFillRegions = settings.showWesternBoundaries && settings.showWesternBoundaryFills
    ? Object.entries(boundaries)
      .map(([abbr, points]) => ({
        abbr,
        paths: getProjectedBoundaryFillPaths(points, projectFn, limitDec, isNorth),
        colorIndex: boundaryColorMap[abbr] ?? 0,
      }))
      .filter((region) => region.paths.length > 0)
    : [];

  const labelCandidates = [];

  if (settings.showWesternNames) {
    for (const con of westernConstellations) {
      const center = westernCenters[con.abbr];
      if (!center) continue;
      const inPrimaryHemisphere = isNorth ? center.dec >= 0 : center.dec < 0;
      if (!inPrimaryHemisphere) continue;

      const boundaryPolygon = getProjectedBoundaryPolygon(boundaries[con.abbr] || [], projectFn, limitDec, isNorth);
      const skeletonSegments = con.edges
        .map(([hip1, hip2]) => {
          const star1 = starsMap.get(hip1);
          const star2 = starsMap.get(hip2);
          if (!star1 || !star2) return null;

          const star1Visible = isNorth ? star1.dec >= limitDec : star1.dec <= limitDec;
          const star2Visible = isNorth ? star2.dec >= limitDec : star2.dec <= limitDec;
          if (!star1Visible && !star2Visible) return null;

          return [
            projectFn(star1.ra, star1.dec),
            projectFn(star2.ra, star2.dec),
          ];
        })
        .filter(Boolean);
      const boundaryLabelPoint = getVisualBoundaryLabelPoint(boundaryPolygon, skeletonSegments);
      const centerInSphere = center && (isNorth ? center.dec >= limitDec : center.dec <= limitDec);
      const pt = boundaryLabelPoint || (centerInSphere ? projectFn(center.ra, center.dec) : null);
      if (!pt) continue;

      const distFromCenter = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
      if (distFromCenter < sphereRadius - 15) {
        labelCandidates.push({
          id: `con-${con.abbr}`,
          text: getLocalizedText(settings.labelLanguageMode, con.nameZh, con.nameEn),
          x: pt.x,
          y: pt.y,
          priority: 1,
          type: 'constellation',
          dotRadius: 0,
          constrainPolygon: boundaryPolygon,
        });
      }
    }
  }

  if (settings.showChineseNames) {
    for (const ast of chineseConstellations) {
      const center = chineseCenters[ast.id];
      if (!center) continue;
      const inSphere = isNorth ? center.dec >= limitDec : center.dec <= limitDec;
      if (!inSphere) continue;

      const pt = projectFn(center.ra, center.dec);
      const distFromCenter = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
      if (distFromCenter < sphereRadius - 15) {
        labelCandidates.push({
          id: `zh-con-${ast.id}`,
          text: ast.nameZh,
          x: pt.x,
          y: pt.y,
          priority: 2,
          type: 'chinese_asterism',
          dotRadius: 0,
        });
      }
    }
  }

  if (settings.showStarNames) {
    for (const star of starPoints) {
      const isPrimaryStar = star.mag <= 3.5 || constellationStarHipSet.has(star.hip);
      if (!isPrimaryStar) continue;

      const name = getLocalizedText(settings.labelLanguageMode, star.nameZh, star.nameEn);
      if (name) {
        labelCandidates.push({
          id: `star-${star.hip}`,
          text: name,
          x: star.x,
          y: star.y,
          priority: star.mag <= 2.2 ? 2 : 3,
          type: 'star',
          mag: star.mag,
          dotRadius: star.r,
        });
      }
    }
  }

  const resolvedLabels = resolveLabels(
    labelCandidates,
    sphereRadius,
    starPoints.filter((star) => star.mag <= 2.5),
    typography
  ).map((label) => ({
    id: label.id,
    text: label.text,
    type: label.type,
    renderX: label.renderX,
    renderY: label.renderY,
    anchor: label.anchor,
    fontSize: label.fontSize,
  }));

  const ticks = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const ptStart = projectFn(deg, limitDec);
    const len = Math.sqrt(ptStart.x * ptStart.x + ptStart.y * ptStart.y);
    if (len === 0) continue;

    const dx = ptStart.x / len;
    const dy = ptStart.y / len;
    const drawText = deg % 15 === 0;
    const tickLen = drawText ? 9 : 6;
    const hour = Math.round(deg / 15) % 24;

    ticks.push({
      id: `tick-${deg}`,
      x1: ptStart.x,
      y1: ptStart.y,
      x2: ptStart.x + dx * tickLen,
      y2: ptStart.y + dy * tickLen,
      drawText,
      text: `${hour}h`,
      textX: ptStart.x + dx * 20,
      textY: ptStart.y + dy * 20 + 3.5,
    });
  }

  const chineseLines = settings.showChineseLines
    ? chineseConstellations.flatMap((ast, astIndex) => (
      ast.edges.map(([hip1, hip2], edgeIndex) => {
        const s1 = starsMap.get(hip1);
        const s2 = starsMap.get(hip2);
        if (!s1 || !s2) return null;
        const pt1 = projectFn(s1.ra, s1.dec);
        const pt2 = projectFn(s2.ra, s2.dec);
        return { id: `zh-edge-${astIndex}-${edgeIndex}`, x1: pt1.x, y1: pt1.y, x2: pt2.x, y2: pt2.y };
      })
    )).filter(Boolean)
    : [];

  const westernLines = settings.showWesternLines
    ? westernConstellations.flatMap((con, conIndex) => (
      con.edges.map(([hip1, hip2], edgeIndex) => {
        const s1 = starsMap.get(hip1);
        const s2 = starsMap.get(hip2);
        if (!s1 || !s2) return null;
        const pt1 = projectFn(s1.ra, s1.dec);
        const pt2 = projectFn(s2.ra, s2.dec);
        return { id: `west-edge-${conIndex}-${edgeIndex}`, x1: pt1.x, y1: pt1.y, x2: pt2.x, y2: pt2.y };
      })
    )).filter(Boolean)
    : [];

  return {
    isNorth,
    sphereRadius,
    starPoints,
    grid,
    eclipticPath,
    equatorPath,
    mwOuterPath,
    mwInnerPath,
    visibleSkyOverlay,
    boundaryPath,
    boundaryFillRegions,
    labels: resolvedLabels,
    ticks,
    chineseLines,
    westernLines,
  };
}

self.onmessage = (event) => {
  const payload = event.data;
  if (payload.type !== 'compute-spheres') return;

  try {
    const spheres = {};
    for (const sphere of payload.spheres) {
      spheres[sphere.key] = computeSphere({
        ...payload,
        isNorth: sphere.isNorth,
        sphereRadius: sphere.sphereRadius,
      });
    }
    self.postMessage({
      type: 'spheres-computed',
      requestId: payload.requestId,
      spheres,
    });
  } catch (error) {
    self.postMessage({
      type: 'spheres-error',
      requestId: payload.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
