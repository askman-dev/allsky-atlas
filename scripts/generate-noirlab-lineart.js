#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const constellationPath = path.join(repoRoot, 'public/data/constellations.western.json');
const rawDir = path.join(repoRoot, 'docs/assets/references/noirlab-lineart/svg');
const outputPath = path.join(repoRoot, 'public/data/noirlab-lineart.json');
const baseSvgUrl = 'https://noirlab.edu/public/media/archives/lineart/svg';
const baseProductUrl = 'https://noirlab.edu/public/products/line-art';

const slugOverrides = {
  BOO: 'bootes',
  CMA: 'canismajor',
  CMI: 'canisminor',
  COM: 'comaberenices',
  CRA: 'coronaaustralis',
  CRB: 'coronaborealis',
  CVN: 'canesvenatici',
  LMI: 'leominor',
};

const command = process.argv[2] || 'all';
const shouldDownload = command === 'all' || command === 'download';
const shouldConvert = command === 'all' || command === 'convert';

const normalizeName = (name) => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const getSlug = (constellation) => slugOverrides[constellation.abbr] || normalizeName(constellation.nameEn);

const getAttr = (attrs, name) => {
  const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : '';
};

const toNumber = (value) => Number.parseFloat(value);

const parsePoints = (value) => {
  const nums = value.trim().split(/[\s,]+/).map(toNumber).filter(Number.isFinite);
  const points = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
};

const parseCssClasses = (svg) => {
  const classes = {};
  for (const styleMatch of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = styleMatch[1];
    for (const ruleMatch of css.matchAll(/\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g)) {
      classes[ruleMatch[1]] = ruleMatch[2];
    }
  }
  return classes;
};

const normalizeStyle = (value) => value.toLowerCase().replace(/\s+/g, '');

const elementStyle = (attrs, cssClasses) => {
  const className = getAttr(attrs, 'class');
  const classStyle = className
    .split(/\s+/)
    .map((item) => cssClasses[item] || '')
    .join(';');
  return normalizeStyle(`${classStyle};${getAttr(attrs, 'style')}`);
};

const hasWhiteFill = (style) => /fill:(#fff|#ffffff|white)(;|$)/.test(style);

const hasVisibleStroke = (style) => (
  /stroke:/.test(style) && !/stroke:none(;|$)/.test(style)
);

const sampleEllipse = (ellipse) => {
  const points = [];
  for (let step = 0; step < 24; step++) {
    const angle = (Math.PI * 2 * step) / 24;
    points.push({
      x: ellipse.cx + Math.cos(angle) * ellipse.rx,
      y: ellipse.cy + Math.sin(angle) * ellipse.ry,
    });
  }
  return points;
};

const tokenizePath = (d) => d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];

const isCommand = (token) => /^[a-zA-Z]$/.test(token);

const cubicAt = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
};

const quadAt = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return {
    x: mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p2.x,
    y: mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p2.y,
  };
};

const samplePath = (d) => {
  const tokens = tokenizePath(d);
  const points = [];
  let i = 0;
  let cmd = '';
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastCubicControl = null;
  let lastQuadControl = null;

  const read = () => toNumber(tokens[i++]);
  const hasNumbers = () => i < tokens.length && !isCommand(tokens[i]);
  const addPoint = (point) => {
    current = point;
    points.push(point);
  };

  while (i < tokens.length) {
    if (isCommand(tokens[i])) cmd = tokens[i++];
    const relative = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();

    if (op === 'M') {
      const x = read();
      const y = read();
      current = { x: relative ? current.x + x : x, y: relative ? current.y + y : y };
      start = current;
      points.push(current);
      cmd = relative ? 'l' : 'L';
      lastCubicControl = null;
      lastQuadControl = null;
      continue;
    }

    if (op === 'Z') {
      addPoint(start);
      lastCubicControl = null;
      lastQuadControl = null;
      continue;
    }

    while (hasNumbers()) {
      if (op === 'L') {
        const x = read();
        const y = read();
        addPoint({ x: relative ? current.x + x : x, y: relative ? current.y + y : y });
        lastCubicControl = null;
        lastQuadControl = null;
      } else if (op === 'H') {
        const x = read();
        addPoint({ x: relative ? current.x + x : x, y: current.y });
        lastCubicControl = null;
        lastQuadControl = null;
      } else if (op === 'V') {
        const y = read();
        addPoint({ x: current.x, y: relative ? current.y + y : y });
        lastCubicControl = null;
        lastQuadControl = null;
      } else if (op === 'C') {
        const c1 = { x: read(), y: read() };
        const c2 = { x: read(), y: read() };
        const end = { x: read(), y: read() };
        const p1 = relative ? { x: current.x + c1.x, y: current.y + c1.y } : c1;
        const p2 = relative ? { x: current.x + c2.x, y: current.y + c2.y } : c2;
        const p3 = relative ? { x: current.x + end.x, y: current.y + end.y } : end;
        const p0 = current;
        for (let step = 1; step <= 10; step++) points.push(cubicAt(p0, p1, p2, p3, step / 10));
        current = p3;
        lastCubicControl = p2;
        lastQuadControl = null;
      } else if (op === 'S') {
        const c2 = { x: read(), y: read() };
        const end = { x: read(), y: read() };
        const p1 = lastCubicControl
          ? { x: current.x * 2 - lastCubicControl.x, y: current.y * 2 - lastCubicControl.y }
          : current;
        const p2 = relative ? { x: current.x + c2.x, y: current.y + c2.y } : c2;
        const p3 = relative ? { x: current.x + end.x, y: current.y + end.y } : end;
        const p0 = current;
        for (let step = 1; step <= 10; step++) points.push(cubicAt(p0, p1, p2, p3, step / 10));
        current = p3;
        lastCubicControl = p2;
        lastQuadControl = null;
      } else if (op === 'Q') {
        const c1 = { x: read(), y: read() };
        const end = { x: read(), y: read() };
        const p1 = relative ? { x: current.x + c1.x, y: current.y + c1.y } : c1;
        const p2 = relative ? { x: current.x + end.x, y: current.y + end.y } : end;
        const p0 = current;
        for (let step = 1; step <= 8; step++) points.push(quadAt(p0, p1, p2, step / 8));
        current = p2;
        lastQuadControl = p1;
        lastCubicControl = null;
      } else if (op === 'T') {
        const end = { x: read(), y: read() };
        const p1 = lastQuadControl
          ? { x: current.x * 2 - lastQuadControl.x, y: current.y * 2 - lastQuadControl.y }
          : current;
        const p2 = relative ? { x: current.x + end.x, y: current.y + end.y } : end;
        const p0 = current;
        for (let step = 1; step <= 8; step++) points.push(quadAt(p0, p1, p2, step / 8));
        current = p2;
        lastQuadControl = p1;
        lastCubicControl = null;
      } else {
        break;
      }
    }
  }

  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
};

const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
};

const segmentsIntersect = (a, b, c, d) => {
  const direction = (p, q, r) => Math.sign(cross(p, q, r));
  const d1 = direction(a, b, c);
  const d2 = direction(a, b, d);
  const d3 = direction(c, d, a);
  const d4 = direction(c, d, b);
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
};

const isSimplePolygon = (polygon) => {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === polygon.length - 1)) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
};

const convexHull = (points) => {
  const unique = [...new Map(points.map((point) => [`${point.x.toFixed(3)},${point.y.toFixed(3)}`, point])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

const radialOutline = (points, binCount = 96) => {
  if (points.length < 3) return points;
  const bounds = boundsOf(points);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const bins = Array.from({ length: binCount }, () => null);

  for (const point of points) {
    const angle = (Math.atan2(point.y - center.y, point.x - center.x) + Math.PI * 2) % (Math.PI * 2);
    const bin = Math.floor((angle / (Math.PI * 2)) * binCount) % binCount;
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (!bins[bin] || distance > bins[bin].distance) {
      bins[bin] = { point, distance };
    }
  }

  const outline = [];
  for (let index = 0; index < binCount; index++) {
    if (!bins[index]) continue;
    const current = bins[index].point;
    const previous = outline[outline.length - 1];
    if (!previous || Math.hypot(previous.x - current.x, previous.y - current.y) > 1.5) {
      outline.push(current);
    }
  }

  if (outline.length < 8 || !isSimplePolygon(outline)) return convexHull(points);
  const covered = points.every((point) => pointInPolygon(point, outline));
  return covered ? outline : convexHull(points);
};

const boundsOf = (points) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const parseSvg = (svg, constellation, slug) => {
  const viewBox = (svg.match(/viewBox=["']([^"']+)["']/i)?.[1] || '0 0 360 360')
    .trim()
    .split(/[\s,]+/)
    .map(toNumber);
  const paths = [];
  const polylines = [];
  const polygons = [];
  const lines = [];
  const ellipses = [];
  const circles = [];
  const samplePoints = [];
  const cssClasses = parseCssClasses(svg);

  for (const match of svg.matchAll(/<(path|polyline|polygon|line|ellipse|circle)\b([^>]*)\/?>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const style = elementStyle(attrs, cssClasses);

    if (tag === 'path' && hasVisibleStroke(style)) {
      const d = getAttr(attrs, 'd');
      if (d) {
        paths.push(d);
        samplePoints.push(...samplePath(d));
      }
    } else if (tag === 'polyline' && hasVisibleStroke(style)) {
      const points = parsePoints(getAttr(attrs, 'points'));
      if (points.length > 1) {
        polylines.push(points);
        samplePoints.push(...points);
      }
    } else if (tag === 'polygon' && hasVisibleStroke(style)) {
      const points = parsePoints(getAttr(attrs, 'points'));
      if (points.length > 2) {
        polygons.push(points);
        samplePoints.push(...points);
      }
    } else if (tag === 'line' && hasVisibleStroke(style)) {
      const line = {
        x1: toNumber(getAttr(attrs, 'x1')),
        y1: toNumber(getAttr(attrs, 'y1')),
        x2: toNumber(getAttr(attrs, 'x2')),
        y2: toNumber(getAttr(attrs, 'y2')),
      };
      if (Object.values(line).every(Number.isFinite)) {
        lines.push(line);
        samplePoints.push({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
      }
    } else if (tag === 'ellipse' && hasVisibleStroke(style)) {
      const ellipse = {
        cx: toNumber(getAttr(attrs, 'cx')),
        cy: toNumber(getAttr(attrs, 'cy')),
        rx: toNumber(getAttr(attrs, 'rx')),
        ry: toNumber(getAttr(attrs, 'ry')),
        transform: getAttr(attrs, 'transform'),
      };
      if (Object.values(ellipse).slice(0, 4).every(Number.isFinite)) {
        ellipses.push(ellipse);
        samplePoints.push(...sampleEllipse(ellipse));
      }
    } else if (tag === 'circle' && hasWhiteFill(style)) {
      const circle = {
        x: toNumber(getAttr(attrs, 'cx')),
        y: toNumber(getAttr(attrs, 'cy')),
        r: toNumber(getAttr(attrs, 'r')) || 1,
      };
      if (Number.isFinite(circle.x) && Number.isFinite(circle.y)) {
        circles.push(circle);
        samplePoints.push(circle);
      }
    }
  }

  const usablePoints = samplePoints.length > 0
    ? samplePoints
    : [{ x: viewBox[0], y: viewBox[1] }, { x: viewBox[0] + viewBox[2], y: viewBox[1] + viewBox[3] }];
  const bounds = boundsOf(usablePoints);
  const hull = radialOutline(usablePoints);

  return {
    abbr: constellation.abbr,
    nameEn: constellation.nameEn,
    nameZh: constellation.nameZh,
    slug,
    sourcePage: `${baseProductUrl}/${slug}-outline/`,
    sourceSvg: `${baseSvgUrl}/${slug}-outline.svg`,
    viewBox,
    bounds,
    hull,
    paths,
    polylines,
    polygons,
    lines,
    ellipses,
    circles,
  };
};

const constellations = JSON.parse(readFileSync(constellationPath, 'utf8'));
mkdirSync(rawDir, { recursive: true });
mkdirSync(path.dirname(outputPath), { recursive: true });

const failures = [];

if (shouldDownload) {
  for (const constellation of constellations) {
    const slug = getSlug(constellation);
    const url = `${baseSvgUrl}/${slug}-outline.svg`;
    const target = path.join(rawDir, `${slug}-outline.svg`);
    if (existsSync(target)) continue;

    try {
      execFileSync('curl', ['-fL', url, '-o', target], { stdio: 'pipe' });
      console.log(`downloaded ${constellation.abbr} ${url}`);
    } catch (error) {
      failures.push(`${constellation.abbr} ${constellation.nameEn} (${url})`);
      console.warn(`missing ${constellation.abbr} ${url}`);
    }
  }
}

if (shouldConvert) {
  const lineArt = {};
  for (const constellation of constellations) {
    const slug = getSlug(constellation);
    const target = path.join(rawDir, `${slug}-outline.svg`);
    if (!existsSync(target)) {
      failures.push(`${constellation.abbr} ${constellation.nameEn}`);
      continue;
    }
    const parsed = parseSvg(readFileSync(target, 'utf8'), constellation, slug);
    const detailCount = parsed.paths.length + parsed.polylines.length + parsed.polygons.length + parsed.lines.length + parsed.ellipses.length;
    if (detailCount === 0 || parsed.circles.length === 0) {
      failures.push(`${constellation.abbr} ${constellation.nameEn} parsed details=${detailCount} circles=${parsed.circles.length}`);
      continue;
    }
    lineArt[constellation.abbr] = parsed;
  }

  const payload = {
    source: 'NOIRLab constellation line art SVG collection',
    generatedAt: new Date().toISOString(),
    count: Object.keys(lineArt).length,
    constellations: lineArt,
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${outputPath} (${payload.count} constellations)`);
}

if (failures.length > 0) {
  console.warn(`\n${failures.length} failures:`);
  for (const failure of failures) console.warn(`- ${failure}`);
  process.exitCode = 1;
}
