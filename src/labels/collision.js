// Label collision avoidance for Allsky Star Map Poster Generator

/**
 * Checks if two bounding boxes overlap.
 * Box format: { x1, y1, x2, y2 }
 */
export function boxesOverlap(boxA, boxB, margin = 2) {
  return !(
    boxA.x2 + margin < boxB.x1 ||
    boxA.x1 - margin > boxB.x2 ||
    boxA.y2 + margin < boxB.y1 ||
    boxA.y1 - margin > boxB.y2
  );
}

/**
 * Checks if a box lies completely inside a circle of radius R.
 */
export function boxInsideCircle(box, cx, cy, R) {
  // Check all 4 corners
  const corners = [
    { x: box.x1 - cx, y: box.y1 - cy },
    { x: box.x2 - cx, y: box.y1 - cy },
    { x: box.x1 - cx, y: box.y2 - cy },
    { x: box.x2 - cx, y: box.y2 - cy },
  ];

  for (const corner of corners) {
    const distSq = corner.x * corner.x + corner.y * corner.y;
    if (distSq > R * R) return false;
  }
  return true;
}

function pointInPolygon(point, polygon) {
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

export function getBoxSamplePoints(box) {
  const midX = (box.x1 + box.x2) / 2;
  const midY = (box.y1 + box.y2) / 2;

  return [
    { x: box.x1, y: box.y1 },
    { x: midX, y: box.y1 },
    { x: box.x2, y: box.y1 },
    { x: box.x1, y: midY },
    { x: midX, y: midY },
    { x: box.x2, y: midY },
    { x: box.x1, y: box.y2 },
    { x: midX, y: box.y2 },
    { x: box.x2, y: box.y2 },
  ];
}

export function getPolygonContainmentRatio(box, polygon) {
  const samplePoints = getBoxSamplePoints(box);
  const insideCount = samplePoints.filter((point) => pointInPolygon(point, polygon)).length;
  return insideCount / samplePoints.length;
}

function getPolygonBounds(polygon) {
  return polygon.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function getCenteredCandidate(point, width, height) {
  return {
    x: point.x,
    y: point.y + height / 2 - 2,
    anchor: 'middle',
    box: {
      x1: point.x - width / 2,
      y1: point.y - height / 2,
      x2: point.x + width / 2,
      y2: point.y + height / 2,
    }
  };
}

function getPolygonLabelCandidates(label, width, height) {
  const polygon = label.constrainPolygon;
  if (label.type !== 'constellation' || !polygon || polygon.length < 3) return [];

  const bounds = getPolygonBounds(polygon);
  const candidates = [];
  const samplesPerAxis = 28;
  const stepX = (bounds.maxX - bounds.minX) / samplesPerAxis;
  const stepY = (bounds.maxY - bounds.minY) / samplesPerAxis;

  for (let yIndex = 0; yIndex <= samplesPerAxis; yIndex++) {
    for (let xIndex = 0; xIndex <= samplesPerAxis; xIndex++) {
      const point = {
        x: bounds.minX + xIndex * stepX,
        y: bounds.minY + yIndex * stepY,
      };

      const candidate = getCenteredCandidate(point, width, height);
      const containmentRatio = getPolygonContainmentRatio(candidate.box, polygon);
      const anchorDistance = Math.hypot(point.x - label.x, point.y - label.y);
      candidates.push({ ...candidate, containmentRatio, anchorDistance });
    }
  }

  return candidates.sort((a, b) => (
    b.containmentRatio - a.containmentRatio ||
    a.anchorDistance - b.anchorDistance
  ));
}

/**
 * Runs the collision avoidance algorithm on a set of labels.
 * 
 * @param {Array} labels Array of label candidates: { id, text, x, y, priority, type }
 * @param {number} mapRadius Radius of the circular sky map
 * @param {Array} starPoints List of coordinates {x, y, r} of stars, which labels should avoid covering.
 * @returns {Array} List of labels that should be rendered, with their resolved {x, y, textAnchor} position.
 */
export function resolveLabels(labels, mapRadius, starPoints = []) {
  const placedBoxes = [];
  const result = [];

  // Sort labels: lower priority value first (1 before 2), then brighter/bigger (for stars)
  const sortedLabels = [...labels].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // If same priority, constellation names first, then stars by magnitude (if available)
    if (a.type !== b.type) {
      return a.type === 'constellation' ? -1 : 1;
    }
    if (a.mag !== undefined && b.mag !== undefined) {
      return a.mag - b.mag; // lower magnitude = brighter = higher priority
    }
    return b.text.length - a.text.length;
  });

  // Define estimation of sizes based on label type & character length
  for (const label of sortedLabels) {
    if (isNaN(label.x) || isNaN(label.y)) continue;

    const charCount = label.text.length;
    let width;
    let height;
    let fontSize;

    if (label.type === 'constellation') {
      fontSize = 11;
      width = charCount * 7.5 + 8;
      height = 13;
    } else if (label.type === 'chinese_asterism') {
      fontSize = 10;
      width = charCount * 10 + 6;
      height = 12;
    } else {
      // Star proper name
      fontSize = 4.25;
      width = charCount * 2.75 + 2;
      height = 5;
    }

    if (label.type === 'constellation' && label.constrainPolygon?.length >= 3) {
      for (let candidateFontSize = 11; candidateFontSize >= 4; candidateFontSize--) {
        const scale = candidateFontSize / 11;
        const candidateWidth = charCount * 7.5 * scale + 8 * scale;
        const candidateHeight = 13 * scale;
        const candidatesForSize = [
          getCenteredCandidate(label, candidateWidth, candidateHeight),
          ...getPolygonLabelCandidates(label, candidateWidth, candidateHeight),
        ];
        const maxContainmentRatio = candidatesForSize.reduce((best, candidate) => (
          Math.max(best, getPolygonContainmentRatio(candidate.box, label.constrainPolygon))
        ), 0);

        if (maxContainmentRatio >= 5 / 9 || candidateFontSize === 4) {
          fontSize = candidateFontSize;
          width = candidateWidth;
          height = candidateHeight;
          break;
        }
      }
    }

    // Try candidate placements relative to the anchor point (label.x, label.y)
    // Star dot radius to avoid overlapping it
    const dotRadius = label.dotRadius ?? 3;
    const candidates = [];

    if (label.type === 'constellation') {
      candidates.push(getCenteredCandidate(label, width, height));
      candidates.push(...getPolygonLabelCandidates(label, width, height));
    }

    candidates.push(
      // Right side
      {
        x: label.x + dotRadius + 4,
        y: label.y + height / 2 - 2,
        anchor: 'start',
        box: {
          x1: label.x + dotRadius + 2,
          y1: label.y - height / 2,
          x2: label.x + dotRadius + 2 + width,
          y2: label.y + height / 2,
        }
      },
      // Left side
      {
        x: label.x - dotRadius - 4,
        y: label.y + height / 2 - 2,
        anchor: 'end',
        box: {
          x1: label.x - dotRadius - 2 - width,
          y1: label.y - height / 2,
          x2: label.x - dotRadius - 2,
          y2: label.y + height / 2,
        }
      },
      // Above
      {
        x: label.x,
        y: label.y - dotRadius - 6,
        anchor: 'middle',
        box: {
          x1: label.x - width / 2,
          y1: label.y - dotRadius - 6 - height,
          x2: label.x + width / 2,
          y2: label.y - dotRadius - 6,
        }
      },
      // Below
      {
        x: label.x,
        y: label.y + dotRadius + height + 2,
        anchor: 'middle',
        box: {
          x1: label.x - width / 2,
          y1: label.y + dotRadius + 2,
          x2: label.x + width / 2,
          y2: label.y + dotRadius + 2 + height,
        }
      }
    );

    let chosenCandidate = null;

    for (const cand of candidates) {
      // Check if it fits inside the map circle (giving a 6px margin)
      if (!boxInsideCircle(cand.box, 0, 0, mapRadius - 8)) {
        continue;
      }

      if (label.constrainPolygon?.length >= 3) {
        if (getPolygonContainmentRatio(cand.box, label.constrainPolygon) < 5 / 9) {
          continue;
        }
      }

      // Check collision with already placed labels
      let collides = false;
      for (const placedBox of placedBoxes) {
        if (boxesOverlap(cand.box, placedBox, 3)) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      // Check collision with other bright star centers in the vicinity
      // to avoid drawing labels directly on top of star points
      let overlapsStar = false;
      for (const star of starPoints) {
        // Simple bounding box check around star point
        const starBox = {
          x1: star.x - star.r,
          y1: star.y - star.r,
          x2: star.x + star.r,
          y2: star.y + star.r,
        };
        if (boxesOverlap(cand.box, starBox, 1)) {
          overlapsStar = true;
          break;
        }
      }
      if (overlapsStar) continue;

      // If we got here, this candidate is perfect!
      chosenCandidate = cand;
      break;
    }

    if (chosenCandidate) {
      placedBoxes.push(chosenCandidate.box);
      result.push({
        ...label,
        renderX: chosenCandidate.x,
        renderY: chosenCandidate.y,
        anchor: chosenCandidate.anchor,
        box: chosenCandidate.box,
        fontSize,
      });
    } else {
      // Fallback: If it's a critical label (Priority 1: Constellation name),
      // we place it at its preferred location anyway to avoid empty constellations,
      // but shift it slightly to prevent centering right on the star.
      if (label.priority === 1) {
        const viableFallbacks = candidates.filter((candidate) => (
          boxInsideCircle(candidate.box, 0, 0, mapRadius - 8)
        ));
        const fallback = label.constrainPolygon?.length >= 3
          ? viableFallbacks.sort((a, b) => (
            getPolygonContainmentRatio(b.box, label.constrainPolygon) -
            getPolygonContainmentRatio(a.box, label.constrainPolygon)
          ))[0]
          : viableFallbacks[0];
        if (!fallback) continue;

        placedBoxes.push(fallback.box);
        result.push({
          ...label,
          renderX: fallback.x,
          renderY: fallback.y,
          anchor: fallback.anchor,
          box: fallback.box,
          fontSize,
          isCollision: true, // flag for styling if needed
        });
      }
    }
  }

  return result;
}
