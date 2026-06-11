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

function boundaryPointVisible(point, limitDec, isNorth) {
  return isNorth ? point.dec >= limitDec : point.dec <= limitDec;
}

function sphericalDistance(a, b) {
  const deltaRa = Math.min(Math.abs(a.ra - b.ra), 360 - Math.abs(a.ra - b.ra));
  const midDec = ((a.dec + b.dec) / 2) * Math.PI / 180;
  return Math.hypot(deltaRa * Math.cos(midDec), a.dec - b.dec);
}

function getClosedPath(points) {
  return `${points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')} Z`;
}

export function getProjectedBoundaryFillPaths(points, projectFn, limitDec, isNorth) {
  const paths = [];
  let chain = [];

  const flushChain = () => {
    if (chain.length < 2) {
      chain = [];
      return;
    }

    const sideA = chain.map((pair) => projectFn(pair[0].ra, pair[0].dec));
    const sideB = chain
      .map((pair) => projectFn(pair[1].ra, pair[1].dec))
      .reverse();
    paths.push(getClosedPath([...sideA, ...sideB]));
    chain = [];
  };

  const appendPair = (pair) => {
    if (chain.length === 0) {
      chain.push(pair);
      return;
    }

    const previous = chain[chain.length - 1];
    const sameOrderBridge = Math.max(
      sphericalDistance(previous[0], pair[0]),
      sphericalDistance(previous[1], pair[1])
    );
    const crossedOrderBridge = Math.max(
      sphericalDistance(previous[0], pair[1]),
      sphericalDistance(previous[1], pair[0])
    );

    if (Math.min(sameOrderBridge, crossedOrderBridge) > 25) {
      flushChain();
      chain.push(pair);
      return;
    }

    chain.push(sameOrderBridge <= crossedOrderBridge ? pair : [pair[1], pair[0]]);
  };

  for (let i = 0; i + 1 < points.length; i += 2) {
    const pair = [points[i], points[i + 1]];
    if (!pair.every((point) => boundaryPointVisible(point, limitDec, isNorth))) {
      flushChain();
      continue;
    }

    if (sphericalDistance(pair[0], pair[1]) <= 0.2) {
      flushChain();
      continue;
    }

    appendPair(pair);
  }
  flushChain();

  return paths;
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

export function getVisualBoundaryLabelPoint(polygon) {
  if (polygon.length < 3) return null;

  const bounds = polygon.reduce((acc, point) => ({
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

  return bestPoint;
}
