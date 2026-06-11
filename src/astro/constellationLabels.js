export function getProjectedBoundaryPolygon(points, projectFn, limitDec, isNorth) {
  const visible = points
    .filter((point) => isNorth ? point.dec >= limitDec : point.dec <= limitDec)
    .map((point) => projectFn(point.ra, point.dec));

  if (visible.length < 3) return [];

  const center = visible.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  center.x /= visible.length;
  center.y /= visible.length;

  return [...visible].sort((a, b) => (
    Math.atan2(a.y - center.y, a.x - center.x) -
    Math.atan2(b.y - center.y, b.x - center.x)
  ));
}

export function getPolygonPath(polygon) {
  if (polygon.length < 3) return '';
  return `${polygon
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')} Z`;
}

const boundaryPointKey = (point) => `${point.ra.toFixed(4)},${point.dec.toFixed(4)}`;

function normalizeRa(ra, centerRa) {
  let normalized = ra;
  while (normalized - centerRa > 180) normalized -= 360;
  while (normalized - centerRa < -180) normalized += 360;
  return normalized;
}

function getCircularMeanRa(points) {
  const sum = points.reduce((acc, point) => {
    const radians = point.ra * Math.PI / 180;
    acc.x += Math.cos(radians);
    acc.y += Math.sin(radians);
    return acc;
  }, { x: 0, y: 0 });

  const angle = Math.atan2(sum.y, sum.x) * 180 / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

function planarBoundaryDistance(a, b) {
  const deltaRa = a.unwrappedRa - b.unwrappedRa;
  const midDec = ((a.dec + b.dec) / 2) * Math.PI / 180;
  return Math.hypot(deltaRa * Math.cos(midDec), a.dec - b.dec);
}

function getOrderedBoundaryPoints(points) {
  const uniquePoints = [...new Map(points.map((point) => [boundaryPointKey(point), point])).values()];
  if (uniquePoints.length < 3) return [];

  const centerRa = getCircularMeanRa(uniquePoints);
  const unvisited = uniquePoints.map((point) => ({
    ...point,
    unwrappedRa: normalizeRa(point.ra, centerRa),
  }));

  unvisited.sort((a, b) => a.unwrappedRa - b.unwrappedRa || a.dec - b.dec);
  const path = [unvisited.shift()];

  while (unvisited.length > 0) {
    const head = path[0];
    const tail = path[path.length - 1];
    let best = null;

    for (let i = 0; i < unvisited.length; i++) {
      const point = unvisited[i];
      const headDistance = planarBoundaryDistance(head, point);
      const tailDistance = planarBoundaryDistance(tail, point);
      const distance = Math.min(headDistance, tailDistance);

      if (!best || distance < best.distance) {
        best = {
          index: i,
          prepend: headDistance < tailDistance,
          distance,
        };
      }
    }

    const [nextPoint] = unvisited.splice(best.index, 1);
    if (best.prepend) {
      path.unshift(nextPoint);
    } else {
      path.push(nextPoint);
    }
  }

  return path;
}

export function getProjectedBoundaryFillPaths(points, projectFn, limitDec, isNorth) {
  if (!points.some((point) => isNorth ? point.dec >= limitDec : point.dec <= limitDec)) {
    return [];
  }

  const polygon = getOrderedBoundaryPoints(points).map((point) => projectFn(point.ra, point.dec));
  const path = getPolygonPath(polygon);
  return path ? [path] : [];
}

export function isPointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function distanceToSegment(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const segmentLengthSq = vx * vx + vy * vy;
  const t = segmentLengthSq === 0
    ? 0
    : Math.max(0, Math.min(1, (wx * vx + wy * vy) / segmentLengthSq));
  const closest = { x: a.x + t * vx, y: a.y + t * vy };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function distanceToPolygonEdge(point, polygon) {
  let minDistance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    minDistance = Math.min(minDistance, distanceToSegment(point, polygon[j], polygon[i]));
  }
  return minDistance;
}

function getBounds(points) {
  return points.reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    maxX: Math.max(acc.maxX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxY: Math.max(acc.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function distanceToSkeleton(point, skeletonSegments) {
  if (!skeletonSegments?.length) return Infinity;
  return Math.min(...skeletonSegments.map(([a, b]) => distanceToSegment(point, a, b)));
}

function getSkeletonBounds(skeletonSegments) {
  const points = skeletonSegments.flatMap(([a, b]) => [a, b]);
  return points.length > 0 ? getBounds(points) : null;
}

function getSkeletonLabelPoint(polygon, skeletonSegments) {
  if (!skeletonSegments?.length) return null;

  let bestPoint = null;
  let bestScore = -Infinity;
  const samples = [0.2, 0.35, 0.5, 0.65, 0.8];

  for (const [a, b] of skeletonSegments) {
    for (const t of samples) {
      const candidate = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
      if (!isPointInPolygon(candidate, polygon)) continue;

      const edgeDistance = distanceToPolygonEdge(candidate, polygon);
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      const score = edgeDistance + Math.min(segmentLength, 24) * 0.08;
      if (score > bestScore) {
        bestPoint = candidate;
        bestScore = score;
      }
    }
  }

  return bestPoint;
}

export function getVisualBoundaryLabelPoint(polygon, skeletonSegments = []) {
  if (polygon.length < 3) return null;

  const bounds = getBounds(polygon);

  let bestPoint = null;
  let bestDistance = -Infinity;
  const samplesPerAxis = 28;
  const stepX = (bounds.maxX - bounds.minX) / samplesPerAxis;
  const stepY = (bounds.maxY - bounds.minY) / samplesPerAxis;

  for (let yIndex = 0; yIndex <= samplesPerAxis; yIndex++) {
    for (let xIndex = 0; xIndex <= samplesPerAxis; xIndex++) {
      const candidate = {
        x: bounds.minX + xIndex * stepX,
        y: bounds.minY + yIndex * stepY,
      };
      if (!isPointInPolygon(candidate, polygon)) continue;

      const distance = distanceToPolygonEdge(candidate, polygon);
      if (distance > bestDistance) {
        bestPoint = candidate;
        bestDistance = distance;
      }
    }
  }

  const skeletonBounds = getSkeletonBounds(skeletonSegments);
  if (bestPoint && skeletonBounds) {
    const skeletonDiagonal = Math.hypot(
      skeletonBounds.maxX - skeletonBounds.minX,
      skeletonBounds.maxY - skeletonBounds.minY
    );
    const maxSkeletonDistance = Math.max(14, Math.min(30, skeletonDiagonal * 0.18));
    if (distanceToSkeleton(bestPoint, skeletonSegments) > maxSkeletonDistance) {
      return getSkeletonLabelPoint(polygon, skeletonSegments) || bestPoint;
    }
  }

  return bestPoint;
}
