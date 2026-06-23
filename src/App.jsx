import { useState, useEffect, useMemo, useRef, useTransition, useCallback } from 'react';
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import {
  projectNorth,
  projectSouth,
  getGridLines,
  getEclipticPoints,
  getGalacticContourPoints,
} from './astro/coords';
import {
  getProjectedBoundaryFillPaths,
  getProjectedBoundaryPolygon,
  getVisualBoundaryLabelPoint,
} from './astro/constellationLabels';
import { THEMES, DEFAULT_TYPOGRAPHY, getStarColorHSL } from './themes/styles';
import { resolveLabels } from './labels/collision';

const MAG_RANGE_MIN = 0;
const MAG_RANGE_PLUS = 7;
const MAG_RANGE_MAX = MAG_RANGE_PLUS;
const MAG_RANGE_STEP = 1;
const MAG_RANGE_TICKS = [0, 1, 2, 3, 4, 5, 6, MAG_RANGE_PLUS];
const POSTER_LAYOUTS = {
  landscape_dual: {
    id: 'landscape_dual',
    width: 1700,
    height: 1200,
    sphereRadius: 330,
  },
  portrait_single: {
    id: 'portrait_single',
    width: 1200,
    height: 1700,
    sphereRadius: 470,
  },
};
const BOUNDARY_MAX_SEGMENT_DEG = 2.25;
const BOUNDARY_LOOKAHEAD = 8;
const LANGUAGE_MODES = new Set(['zh', 'en', 'both']);
const CONSTELLATION_FILL_PALETTE = [
  '#5ab4ac',
  '#d8b365',
  '#8da0cb',
  '#fc8d62',
  '#66c2a5',
  '#e78ac3',
];
const APP_PAGES = new Set(['poster', 'constellation-3d']);
const WESTERN_LINE_STYLE_OFF = 'off';
const WESTERN_LINE_STYLE_MODERN = 'modern';
const WESTERN_LINE_STYLE_SKY_TELESCOPE = 'sky_telescope';
const WESTERN_LINE_STYLE_OPTIONS = [
  WESTERN_LINE_STYLE_OFF,
  WESTERN_LINE_STYLE_MODERN,
  WESTERN_LINE_STYLE_SKY_TELESCOPE,
];
const DEFAULT_WESTERN_LINE_STYLE = WESTERN_LINE_STYLE_MODERN;
const normalizeWesternLineStyle = (style) => (
  WESTERN_LINE_STYLE_OPTIONS.includes(style) ? style : DEFAULT_WESTERN_LINE_STYLE
);
const DEFAULT_3D_MODEL_SETTINGS = {
  constellationAbbr: 'ORI',
  cardWidthMm: 120,
  baseThicknessMm: 2.4,
  reliefHeightMm: 1.4,
  showMythLines: false,
  showStarConnectionLines: true,
  surfaceLineWidthMm: 1,
  grooveDiameterMm: 4.8,
  grooveDepthMm: 1.2,
  starPositionMode: 'recessed',
  outlinePaddingMm: 11,
};
const SURFACE_LINE_HEIGHT_MM = 1;
const clampModelScale = (scale) => Math.min(2.8, Math.max(0.45, scale));
const degToRad = (degrees) => degrees * Math.PI / 180;
const MIN_CARD_VIEW_ANGLE_DEG = 30;
const MIN_CARD_VIEW_PITCH_DEG = -(90 - MIN_CARD_VIEW_ANGLE_DEG);
const MAX_CARD_VIEW_PITCH_DEG = 0;
const multiplyMatrix4 = (a, b) => {
  const output = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) {
        output[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
      }
    }
  }
  return output;
};

const rotationXMatrix = (degrees) => {
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    1, 0, 0, 0,
    0, cos, -sin, 0,
    0, sin, cos, 0,
    0, 0, 0, 1,
  ];
};

const rotationYMatrix = (degrees) => {
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos, 0, sin, 0,
    0, 1, 0, 0,
    -sin, 0, cos, 0,
    0, 0, 0, 1,
  ];
};

const rotationZMatrix = (degrees) => {
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos, -sin, 0, 0,
    sin, cos, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
};

const getCardViewPitchDegrees = (matrix) => Math.atan2(matrix[9], matrix[10]) * 180 / Math.PI;

const applyLimitedViewPitch = (matrix, pitchDegrees) => {
  const currentPitch = getCardViewPitchDegrees(matrix);
  const nextPitch = Math.min(
    MAX_CARD_VIEW_PITCH_DEG,
    Math.max(MIN_CARD_VIEW_PITCH_DEG, currentPitch + pitchDegrees),
  );
  return rotationXMatrix(nextPitch);
};

const matrixToCssMatrix3d = (matrix) => (
  `matrix3d(${[
    matrix[0], matrix[4], matrix[8], matrix[12],
    matrix[1], matrix[5], matrix[9], matrix[13],
    matrix[2], matrix[6], matrix[10], matrix[14],
    matrix[3], matrix[7], matrix[11], matrix[15],
  ].map((value) => Number(value.toFixed(6))).join(', ')})`
);

const DEFAULT_3D_VIEW = {
  viewMatrix: rotationXMatrix(-38),
  modelMatrix: rotationZMatrix(0),
  scale: 1,
};
const CSS_PX_PER_MM = 96 / 25.4;
const CITY_OBSERVERS = [
  { id: 'beijing', label: 'Beijing', labelZh: '北京', latitude: 39.9, longitude: 116.4 },
  { id: 'hongkong', label: 'Hong Kong', labelZh: '香港', latitude: 22.3, longitude: 114.2 },
  { id: 'newyork', label: 'New York', labelZh: '纽约', latitude: 40.7, longitude: -74.0 },
  { id: 'london', label: 'London', labelZh: '伦敦', latitude: 51.5, longitude: -0.1 },
  { id: 'sydney', label: 'Sydney', labelZh: '悉尼', latitude: -33.9, longitude: 151.2 },
];
const DEFAULT_OBSERVER = CITY_OBSERVERS[0];
const getCurrentDateParts = () => {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
};
const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();
const getObserverTimestampMs = ({ year, month, day, hour }) => (
  new Date(year, month - 1, Math.min(day, getDaysInMonth(year, month)), hour, 0, 0, 0).getTime()
);
const initialDateParts = getCurrentDateParts();
const DEFAULT_RENDER_SETTINGS = {
  labelLanguageMode: 'en',
  fontFamily: 'serif',
  themeId: 'classic_navy',
  posterLayout: 'landscape_dual',
  transparentBackground: false,
  projection: 'polar_equidistant',
  minMagLimit: MAG_RANGE_MIN,
  magLimit: 4,
  overlapDec: 20,
  northRotation: 0,
  southRotation: 0,
  westernLineStyle: DEFAULT_WESTERN_LINE_STYLE,
  showWesternBoundaries: true,
  showWesternBoundaryFills: false,
  showWesternNames: true,
  showChineseLines: false,
  showChineseNames: false,
  showGrid: false,
  showEquator: false,
  showEcliptic: false,
  showMilkyWay: true,
  showVisibleSky: true,
  showVisibleSkyTimeWindow: false,
  observerLatitude: DEFAULT_OBSERVER.latitude,
  observerLongitude: DEFAULT_OBSERVER.longitude,
  observerMonth: initialDateParts.month,
  observerDay: initialDateParts.day,
  observerYear: initialDateParts.year,
  observerHour: 22,
  observerTimestampMs: getObserverTimestampMs({ ...initialDateParts, hour: 22 }),
  showStarNames: true,
};

const getInitialLanguageMode = () => {
  if (typeof window === 'undefined') return 'en';
  const mode = new URLSearchParams(window.location.search).get('hl');
  return LANGUAGE_MODES.has(mode) ? mode : 'en';
};

const getInitialPage = () => {
  if (typeof window === 'undefined') return 'poster';
  const page = new URLSearchParams(window.location.search).get('page');
  return APP_PAGES.has(page) ? page : 'poster';
};

const getDisplayLanguage = (mode) => mode === 'zh' ? 'zh' : 'en';

const getConstellationStarHipsFromEdges = (edges = []) => (
  [...new Set(edges.flat())]
);

const projectWesternConstellationGraph = (constellation, starsMap, contentWidth) => {
  const hips = getConstellationStarHipsFromEdges(constellation?.edges);
  const sourceStars = hips.map((hip) => starsMap.get(hip)).filter(Boolean);
  if (sourceStars.length === 0) return null;

  const sinRa = sourceStars.reduce((sum, star) => sum + Math.sin(star.ra * Math.PI / 180), 0);
  const cosRa = sourceStars.reduce((sum, star) => sum + Math.cos(star.ra * Math.PI / 180), 0);
  const centerRa = (Math.atan2(sinRa, cosRa) * 180 / Math.PI + 360) % 360;
  const centerDec = sourceStars.reduce((sum, star) => sum + star.dec, 0) / sourceStars.length;
  const decScale = Math.cos(centerDec * Math.PI / 180);
  const rawPoints = sourceStars.map((star) => {
    let deltaRa = star.ra - centerRa;
    if (deltaRa > 180) deltaRa -= 360;
    if (deltaRa < -180) deltaRa += 360;
    return {
      hip: star.hip,
      x: deltaRa * decScale,
      y: -(star.dec - centerDec),
      mag: star.mag,
      nameEn: star.nameEn,
      nameZh: star.nameZh,
    };
  });

  const minX = Math.min(...rawPoints.map((point) => point.x));
  const maxX = Math.max(...rawPoints.map((point) => point.x));
  const minY = Math.min(...rawPoints.map((point) => point.y));
  const maxY = Math.max(...rawPoints.map((point) => point.y));
  const rawWidth = Math.max(0.1, maxX - minX);
  const rawHeight = Math.max(0.1, maxY - minY);
  const scale = contentWidth / Math.max(rawWidth, rawHeight);
  const offsetX = -((minX + maxX) / 2) * scale;
  const offsetY = -((minY + maxY) / 2) * scale;
  const points = rawPoints.map((point) => ({
    ...point,
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  }));
  const pointsByHip = new Map(points.map((point) => [point.hip, point]));
  const edges = (constellation.edges || [])
    .map(([fromHip, toHip]) => {
      const from = pointsByHip.get(fromHip);
      const to = pointsByHip.get(toHip);
      return from && to ? { from, to, source: 'western-poster-data' } : null;
    })
    .filter(Boolean);

  return { points, edges };
};

const SILHOUETTE_GROUP_BY_ABBR = {
  ORI: 'hunter',
  HER: 'warrior',
  PER: 'warrior',
  CEP: 'robed_person',
  CAS: 'robed_person',
  AND: 'robed_person',
  VIR: 'robed_person',
  IND: 'robed_person',
  AQR: 'water_bearer',
  GEM: 'twins',
  OPH: 'serpent_bearer',
  BOO: 'herdsman',
  AUR: 'charioteer',
  SGR: 'centaur_archer',
  CEN: 'centaur',
  PEG: 'winged_horse',
  EQU: 'horse',
  LEO: 'lion',
  LMI: 'lion',
  UMA: 'bear',
  UMI: 'bear',
  CMa: 'dog',
  CMA: 'dog',
  CMI: 'dog',
  CVN: 'dog',
  LUP: 'wolf',
  TAU: 'bull',
  ARI: 'ram',
  CAP: 'goat_fish',
  SCO: 'scorpion',
  CNC: 'crab',
  PSC: 'fish',
  PSA: 'fish',
  CET: 'sea_monster',
  HYA: 'serpent',
  HYI: 'serpent',
  SER: 'serpent',
  DRA: 'dragon',
  ERI: 'serpent',
  LAC: 'dragon',
  CYG: 'swan',
  AQL: 'eagle',
  ARA: 'altar',
  COL: 'dove',
  CRV: 'bird',
  CRU: 'cross',
  GRU: 'crane',
  PAV: 'peacock',
  PHE: 'phoenix',
  APS: 'bird',
  TUC: 'bird',
  MUS: 'bird',
  VOL: 'fish',
  DOR: 'fish',
  DEL: 'dolphin',
  PUP: 'ship',
  CAR: 'ship',
  VEL: 'ship',
  PYX: 'instrument',
  SCL: 'instrument',
  CAE: 'instrument',
  CIR: 'instrument',
  FOR: 'instrument',
  HOR: 'instrument',
  ANT: 'instrument',
  MIC: 'instrument',
  OCT: 'instrument',
  PIC: 'instrument',
  RET: 'instrument',
  SEX: 'instrument',
  TEL: 'instrument',
  NOR: 'instrument',
  MEN: 'instrument',
  LYR: 'lyre',
  CRA: 'crown',
  CRB: 'crown',
  COM: 'crown',
  TRI: 'triangle',
  TRA: 'triangle',
  SGE: 'arrow',
  SCT: 'shield',
  CRT: 'cup',
  LIB: 'scales',
  CAM: 'horse',
  MON: 'horse',
  LEP: 'ram',
  LYN: 'lion',
  VUL: 'wolf',
};

const LINE_ART_STAR_OVERRIDES = {
  LIB: [
    { hip: 76333, nameEn: 'Zubenelhakrabi', nameZh: '氐宿三' },
    { hip: 74785, nameEn: 'Zubeneschamali', nameZh: '氐宿四' },
    { hip: 77853, nameEn: 'Theta Librae', nameZh: '西咸三' },
    { hip: 73714, nameEn: 'Brachium', nameZh: '折威七' },
    { hip: 72622, nameEn: 'Zubenelgenubi II', nameZh: '氐宿一' },
    { hip: 72603, nameEn: 'Zubenelgenubi I', nameZh: '氐宿增七' },
  ],
};

const SILHOUETTE_DETAIL_LINES = {
  hunter: [
    [{ x: 0.02, y: -0.31 }, { x: 0.08, y: -0.38 }, { x: 0.17, y: -0.37 }, { x: 0.24, y: -0.30 }, { x: 0.22, y: -0.23 }],
    [{ x: -0.01, y: -0.20 }, { x: 0.10, y: -0.13 }, { x: 0.15, y: 0.02 }, { x: 0.10, y: 0.16 }],
    [{ x: -0.15, y: 0.04 }, { x: 0.10, y: -0.01 }, { x: 0.22, y: -0.09 }],
    [{ x: -0.13, y: 0.09 }, { x: 0.09, y: 0.05 }, { x: 0.23, y: 0.00 }],
    [{ x: -0.05, y: 0.10 }, { x: -0.05, y: 0.32 }, { x: -0.02, y: 0.42 }],
    [{ x: -0.05, y: 0.32 }, { x: 0.10, y: 0.28 }, { x: 0.15, y: 0.43 }],
    [{ x: 0.30, y: -0.29 }, { x: 0.47, y: -0.35 }, { x: 0.62, y: -0.24 }, { x: 0.67, y: -0.06 }],
    [{ x: 0.46, y: -0.12 }, { x: 0.57, y: 0.10 }, { x: 0.51, y: 0.31 }, { x: 0.35, y: 0.43 }],
    [{ x: 0.32, y: -0.02 }, { x: 0.43, y: 0.22 }, { x: 0.28, y: 0.40 }],
  ],
};

const SILHOUETTE_TEMPLATES = {
  hunter: [
    { x: -0.43, y: -0.61 }, { x: -0.34, y: -0.66 }, { x: -0.24, y: -0.63 }, { x: -0.17, y: -0.56 },
    { x: -0.18, y: -0.47 }, { x: -0.29, y: -0.34 }, { x: -0.40, y: -0.22 }, { x: -0.49, y: -0.12 },
    { x: -0.55, y: -0.13 }, { x: -0.53, y: -0.22 }, { x: -0.42, y: -0.43 }, { x: -0.32, y: -0.54 },
    { x: -0.26, y: -0.38 }, { x: -0.22, y: -0.22 }, { x: -0.16, y: -0.10 }, { x: -0.06, y: -0.04 },
    { x: 0.04, y: -0.09 }, { x: 0.00, y: -0.24 }, { x: 0.04, y: -0.32 }, { x: 0.12, y: -0.36 },
    { x: 0.20, y: -0.34 }, { x: 0.25, y: -0.28 }, { x: 0.36, y: -0.40 }, { x: 0.52, y: -0.38 },
    { x: 0.64, y: -0.29 }, { x: 0.70, y: -0.15 }, { x: 0.67, y: 0.03 }, { x: 0.58, y: 0.20 },
    { x: 0.46, y: 0.34 }, { x: 0.32, y: 0.43 }, { x: 0.22, y: 0.48 }, { x: 0.24, y: 0.61 },
    { x: 0.15, y: 0.65 }, { x: 0.04, y: 0.63 }, { x: 0.00, y: 0.50 }, { x: -0.04, y: 0.29 },
    { x: -0.10, y: 0.52 }, { x: -0.22, y: 0.70 }, { x: -0.34, y: 0.77 }, { x: -0.43, y: 0.74 },
    { x: -0.39, y: 0.62 }, { x: -0.28, y: 0.52 }, { x: -0.23, y: 0.36 }, { x: -0.16, y: 0.16 },
    { x: -0.21, y: 0.02 }, { x: -0.26, y: -0.13 }, { x: -0.36, y: -0.28 }, { x: -0.31, y: -0.42 },
  ],
  warrior: [
    { x: -0.03, y: -0.54 }, { x: 0.10, y: -0.51 }, { x: 0.16, y: -0.41 }, { x: 0.12, y: -0.30 },
    { x: 0.34, y: -0.36 }, { x: 0.50, y: -0.23 }, { x: 0.41, y: -0.07 }, { x: 0.18, y: -0.15 },
    { x: 0.19, y: 0.08 }, { x: 0.38, y: 0.24 }, { x: 0.30, y: 0.41 }, { x: 0.08, y: 0.30 },
    { x: 0.02, y: 0.52 }, { x: -0.14, y: 0.52 }, { x: -0.17, y: 0.25 }, { x: -0.38, y: 0.40 },
    { x: -0.50, y: 0.26 }, { x: -0.24, y: 0.02 }, { x: -0.30, y: -0.19 }, { x: -0.50, y: -0.30 },
    { x: -0.38, y: -0.44 }, { x: -0.15, y: -0.32 },
  ],
  robed_person: [
    { x: -0.06, y: -0.55 }, { x: 0.08, y: -0.55 }, { x: 0.16, y: -0.45 }, { x: 0.14, y: -0.34 },
    { x: 0.36, y: -0.25 }, { x: 0.46, y: -0.08 }, { x: 0.30, y: 0.02 }, { x: 0.22, y: -0.06 },
    { x: 0.34, y: 0.47 }, { x: 0.06, y: 0.56 }, { x: -0.28, y: 0.48 }, { x: -0.16, y: -0.05 },
    { x: -0.36, y: 0.05 }, { x: -0.48, y: -0.10 }, { x: -0.34, y: -0.27 }, { x: -0.12, y: -0.35 },
  ],
  water_bearer: [
    { x: -0.07, y: -0.54 }, { x: 0.07, y: -0.54 }, { x: 0.15, y: -0.43 }, { x: 0.12, y: -0.32 },
    { x: 0.38, y: -0.30 }, { x: 0.55, y: -0.15 }, { x: 0.44, y: 0.00 }, { x: 0.20, y: -0.11 },
    { x: 0.16, y: 0.15 }, { x: 0.24, y: 0.50 }, { x: 0.05, y: 0.54 }, { x: -0.03, y: 0.22 },
    { x: -0.16, y: 0.53 }, { x: -0.34, y: 0.48 }, { x: -0.22, y: 0.08 }, { x: -0.45, y: -0.01 },
    { x: -0.54, y: -0.20 }, { x: -0.34, y: -0.30 }, { x: -0.14, y: -0.33 },
  ],
  twins: [
    { x: -0.28, y: -0.54 }, { x: -0.16, y: -0.54 }, { x: -0.10, y: -0.43 }, { x: -0.16, y: -0.30 },
    { x: -0.03, y: -0.22 }, { x: 0.08, y: -0.32 }, { x: 0.15, y: -0.48 }, { x: 0.28, y: -0.50 },
    { x: 0.36, y: -0.38 }, { x: 0.31, y: -0.26 }, { x: 0.48, y: -0.12 }, { x: 0.38, y: 0.05 },
    { x: 0.24, y: -0.06 }, { x: 0.28, y: 0.48 }, { x: 0.09, y: 0.52 }, { x: 0.02, y: 0.10 },
    { x: -0.08, y: 0.52 }, { x: -0.28, y: 0.50 }, { x: -0.22, y: -0.05 }, { x: -0.40, y: 0.04 },
    { x: -0.50, y: -0.14 }, { x: -0.32, y: -0.28 },
  ],
  centaur_archer: [
    { x: -0.55, y: -0.08 }, { x: -0.30, y: -0.24 }, { x: -0.12, y: -0.42 }, { x: 0.03, y: -0.52 },
    { x: 0.15, y: -0.45 }, { x: 0.07, y: -0.28 }, { x: 0.26, y: -0.20 }, { x: 0.56, y: -0.42 },
    { x: 0.45, y: -0.08 }, { x: 0.24, y: -0.01 }, { x: 0.14, y: 0.18 }, { x: 0.36, y: 0.42 },
    { x: 0.10, y: 0.34 }, { x: -0.12, y: 0.14 }, { x: -0.20, y: 0.46 }, { x: -0.42, y: 0.45 },
    { x: -0.36, y: 0.12 }, { x: -0.55, y: 0.08 },
  ],
  centaur: [
    { x: -0.55, y: -0.06 }, { x: -0.28, y: -0.24 }, { x: -0.08, y: -0.45 }, { x: 0.08, y: -0.50 },
    { x: 0.16, y: -0.36 }, { x: 0.09, y: -0.20 }, { x: 0.36, y: -0.12 }, { x: 0.54, y: 0.02 },
    { x: 0.40, y: 0.18 }, { x: 0.16, y: 0.15 }, { x: 0.18, y: 0.48 }, { x: -0.04, y: 0.48 },
    { x: -0.12, y: 0.18 }, { x: -0.31, y: 0.45 }, { x: -0.50, y: 0.37 }, { x: -0.40, y: 0.10 },
  ],
  winged_horse: [
    { x: -0.56, y: -0.02 }, { x: -0.34, y: -0.22 }, { x: -0.10, y: -0.24 }, { x: 0.04, y: -0.50 },
    { x: 0.20, y: -0.18 }, { x: 0.46, y: -0.26 }, { x: 0.56, y: -0.10 }, { x: 0.40, y: 0.02 },
    { x: 0.30, y: 0.26 }, { x: 0.10, y: 0.22 }, { x: 0.06, y: 0.52 }, { x: -0.14, y: 0.50 },
    { x: -0.20, y: 0.20 }, { x: -0.42, y: 0.36 }, { x: -0.54, y: 0.18 },
  ],
  horse: [
    { x: -0.54, y: 0.06 }, { x: -0.34, y: -0.16 }, { x: -0.05, y: -0.20 }, { x: 0.24, y: -0.12 },
    { x: 0.52, y: -0.24 }, { x: 0.56, y: -0.06 }, { x: 0.36, y: 0.04 }, { x: 0.26, y: 0.30 },
    { x: 0.08, y: 0.30 }, { x: -0.02, y: 0.06 }, { x: -0.25, y: 0.34 }, { x: -0.46, y: 0.26 },
  ],
  lion: [
    { x: -0.54, y: 0.02 }, { x: -0.34, y: -0.18 }, { x: -0.10, y: -0.22 }, { x: 0.02, y: -0.42 },
    { x: 0.22, y: -0.32 }, { x: 0.18, y: -0.16 }, { x: 0.48, y: -0.12 }, { x: 0.56, y: 0.05 },
    { x: 0.38, y: 0.16 }, { x: 0.16, y: 0.12 }, { x: 0.18, y: 0.45 }, { x: -0.02, y: 0.45 },
    { x: -0.10, y: 0.15 }, { x: -0.34, y: 0.36 }, { x: -0.50, y: 0.26 },
  ],
  bear: [
    { x: -0.54, y: -0.06 }, { x: -0.36, y: -0.25 }, { x: -0.10, y: -0.24 }, { x: 0.18, y: -0.16 },
    { x: 0.38, y: -0.26 }, { x: 0.55, y: -0.10 }, { x: 0.42, y: 0.04 }, { x: 0.26, y: 0.02 },
    { x: 0.24, y: 0.36 }, { x: 0.02, y: 0.40 }, { x: -0.05, y: 0.11 }, { x: -0.30, y: 0.37 },
    { x: -0.50, y: 0.28 }, { x: -0.38, y: 0.03 },
  ],
  dog: [
    { x: -0.54, y: 0.00 }, { x: -0.34, y: -0.20 }, { x: -0.08, y: -0.18 }, { x: 0.18, y: -0.10 },
    { x: 0.42, y: -0.24 }, { x: 0.56, y: -0.08 }, { x: 0.42, y: 0.04 }, { x: 0.28, y: 0.00 },
    { x: 0.24, y: 0.40 }, { x: 0.04, y: 0.42 }, { x: -0.04, y: 0.12 }, { x: -0.28, y: 0.38 },
    { x: -0.46, y: 0.30 }, { x: -0.34, y: 0.05 },
  ],
  wolf: [
    { x: -0.55, y: 0.04 }, { x: -0.34, y: -0.20 }, { x: -0.08, y: -0.22 }, { x: 0.22, y: -0.12 },
    { x: 0.48, y: -0.28 }, { x: 0.58, y: -0.08 }, { x: 0.42, y: 0.02 }, { x: 0.24, y: 0.02 },
    { x: 0.22, y: 0.44 }, { x: 0.02, y: 0.44 }, { x: -0.06, y: 0.12 }, { x: -0.35, y: 0.36 },
    { x: -0.52, y: 0.26 },
  ],
  bull: [
    { x: -0.55, y: -0.02 }, { x: -0.38, y: -0.28 }, { x: -0.12, y: -0.20 }, { x: 0.14, y: -0.18 },
    { x: 0.36, y: -0.36 }, { x: 0.52, y: -0.26 }, { x: 0.38, y: -0.08 }, { x: 0.56, y: 0.05 },
    { x: 0.38, y: 0.20 }, { x: 0.10, y: 0.10 }, { x: 0.04, y: 0.48 }, { x: -0.16, y: 0.48 },
    { x: -0.22, y: 0.12 }, { x: -0.46, y: 0.26 },
  ],
  ram: [
    { x: -0.52, y: -0.02 }, { x: -0.34, y: -0.25 }, { x: -0.10, y: -0.18 }, { x: 0.15, y: -0.18 },
    { x: 0.36, y: -0.34 }, { x: 0.53, y: -0.18 }, { x: 0.42, y: 0.02 }, { x: 0.24, y: 0.04 },
    { x: 0.20, y: 0.42 }, { x: 0.02, y: 0.44 }, { x: -0.08, y: 0.10 }, { x: -0.34, y: 0.30 },
    { x: -0.50, y: 0.20 },
  ],
  goat_fish: [
    { x: -0.54, y: -0.12 }, { x: -0.30, y: -0.32 }, { x: -0.08, y: -0.22 }, { x: 0.12, y: -0.34 },
    { x: 0.32, y: -0.20 }, { x: 0.18, y: 0.02 }, { x: 0.52, y: 0.16 }, { x: 0.28, y: 0.28 },
    { x: 0.52, y: 0.43 }, { x: 0.05, y: 0.36 }, { x: -0.18, y: 0.16 }, { x: -0.42, y: 0.14 },
  ],
  scorpion: [
    { x: -0.56, y: -0.18 }, { x: -0.34, y: -0.30 }, { x: -0.14, y: -0.20 }, { x: 0.04, y: -0.26 },
    { x: 0.24, y: -0.14 }, { x: 0.48, y: -0.28 }, { x: 0.56, y: -0.08 }, { x: 0.38, y: 0.02 },
    { x: 0.20, y: 0.00 }, { x: 0.10, y: 0.16 }, { x: 0.22, y: 0.32 }, { x: 0.10, y: 0.50 },
    { x: -0.04, y: 0.32 }, { x: -0.20, y: 0.22 }, { x: -0.42, y: 0.28 }, { x: -0.54, y: 0.08 },
  ],
  crab: [
    { x: -0.50, y: -0.18 }, { x: -0.30, y: -0.36 }, { x: -0.12, y: -0.22 }, { x: 0.12, y: -0.22 },
    { x: 0.32, y: -0.38 }, { x: 0.52, y: -0.18 }, { x: 0.35, y: -0.02 }, { x: 0.50, y: 0.20 },
    { x: 0.22, y: 0.16 }, { x: 0.08, y: 0.34 }, { x: -0.08, y: 0.34 }, { x: -0.22, y: 0.16 },
    { x: -0.50, y: 0.20 }, { x: -0.34, y: -0.02 },
  ],
  fish: [
    { x: -0.56, y: 0.00 }, { x: -0.36, y: -0.24 }, { x: -0.08, y: -0.28 }, { x: 0.24, y: -0.18 },
    { x: 0.54, y: -0.32 }, { x: 0.42, y: 0.00 }, { x: 0.54, y: 0.32 }, { x: 0.24, y: 0.18 },
    { x: -0.08, y: 0.28 }, { x: -0.36, y: 0.24 },
  ],
  sea_monster: [
    { x: -0.56, y: -0.05 }, { x: -0.32, y: -0.28 }, { x: -0.06, y: -0.22 }, { x: 0.20, y: -0.36 },
    { x: 0.52, y: -0.16 }, { x: 0.38, y: 0.03 }, { x: 0.55, y: 0.25 }, { x: 0.20, y: 0.18 },
    { x: -0.02, y: 0.36 }, { x: -0.28, y: 0.20 }, { x: -0.50, y: 0.16 },
  ],
  serpent: [
    { x: -0.56, y: -0.10 }, { x: -0.30, y: -0.26 }, { x: -0.05, y: -0.10 }, { x: 0.18, y: -0.26 },
    { x: 0.52, y: -0.12 }, { x: 0.38, y: 0.08 }, { x: 0.10, y: 0.02 }, { x: -0.08, y: 0.22 },
    { x: -0.38, y: 0.28 }, { x: -0.52, y: 0.10 },
  ],
  dragon: [
    { x: -0.54, y: -0.16 }, { x: -0.30, y: -0.34 }, { x: -0.08, y: -0.12 }, { x: 0.14, y: -0.30 },
    { x: 0.44, y: -0.18 }, { x: 0.56, y: 0.02 }, { x: 0.34, y: 0.12 }, { x: 0.10, y: 0.02 },
    { x: -0.08, y: 0.28 }, { x: -0.34, y: 0.36 }, { x: -0.52, y: 0.16 },
  ],
  swan: [
    { x: -0.56, y: 0.02 }, { x: -0.25, y: -0.20 }, { x: -0.05, y: -0.50 }, { x: 0.10, y: -0.17 },
    { x: 0.42, y: -0.36 }, { x: 0.26, y: -0.02 }, { x: 0.55, y: 0.15 }, { x: 0.12, y: 0.18 },
    { x: -0.06, y: 0.50 }, { x: -0.23, y: 0.18 },
  ],
  eagle: [
    { x: -0.56, y: -0.05 }, { x: -0.12, y: -0.34 }, { x: 0.03, y: -0.16 }, { x: 0.46, y: -0.34 },
    { x: 0.30, y: -0.02 }, { x: 0.56, y: 0.16 }, { x: 0.16, y: 0.12 }, { x: 0.02, y: 0.46 },
    { x: -0.14, y: 0.10 }, { x: -0.54, y: 0.18 },
  ],
  bird: [
    { x: -0.56, y: -0.03 }, { x: -0.15, y: -0.28 }, { x: 0.02, y: -0.10 }, { x: 0.44, y: -0.26 },
    { x: 0.26, y: 0.00 }, { x: 0.54, y: 0.14 }, { x: 0.12, y: 0.12 }, { x: -0.02, y: 0.42 },
    { x: -0.18, y: 0.12 }, { x: -0.54, y: 0.16 },
  ],
  peacock: [
    { x: -0.50, y: 0.20 }, { x: -0.34, y: -0.36 }, { x: -0.08, y: -0.50 }, { x: 0.22, y: -0.38 },
    { x: 0.52, y: -0.04 }, { x: 0.30, y: 0.14 }, { x: 0.46, y: 0.44 }, { x: 0.05, y: 0.26 },
    { x: -0.22, y: 0.44 },
  ],
  phoenix: [
    { x: -0.56, y: 0.10 }, { x: -0.16, y: -0.40 }, { x: 0.02, y: -0.18 }, { x: 0.42, y: -0.46 },
    { x: 0.28, y: -0.08 }, { x: 0.56, y: 0.10 }, { x: 0.18, y: 0.14 }, { x: 0.06, y: 0.52 },
    { x: -0.14, y: 0.16 },
  ],
  dolphin: [
    { x: -0.52, y: 0.08 }, { x: -0.30, y: -0.20 }, { x: 0.08, y: -0.28 }, { x: 0.42, y: -0.10 },
    { x: 0.56, y: -0.28 }, { x: 0.48, y: 0.06 }, { x: 0.20, y: 0.24 }, { x: -0.10, y: 0.20 },
    { x: -0.36, y: 0.32 },
  ],
  ship: [
    { x: -0.56, y: -0.06 }, { x: -0.20, y: -0.22 }, { x: 0.10, y: -0.18 }, { x: 0.44, y: -0.02 },
    { x: 0.54, y: 0.18 }, { x: 0.26, y: 0.36 }, { x: -0.24, y: 0.34 }, { x: -0.48, y: 0.16 },
  ],
  instrument: [
    { x: -0.52, y: -0.12 }, { x: -0.22, y: -0.36 }, { x: 0.26, y: -0.34 }, { x: 0.52, y: -0.06 },
    { x: 0.34, y: 0.28 }, { x: 0.02, y: 0.42 }, { x: -0.34, y: 0.28 },
  ],
  lyre: [
    { x: -0.44, y: -0.38 }, { x: 0.44, y: -0.38 }, { x: 0.34, y: 0.26 }, { x: 0.12, y: 0.48 },
    { x: -0.12, y: 0.48 }, { x: -0.34, y: 0.26 },
  ],
  crown: [
    { x: -0.54, y: 0.18 }, { x: -0.36, y: -0.20 }, { x: -0.14, y: 0.06 }, { x: 0.00, y: -0.34 },
    { x: 0.16, y: 0.06 }, { x: 0.38, y: -0.20 }, { x: 0.54, y: 0.18 }, { x: 0.28, y: 0.36 },
    { x: -0.28, y: 0.36 },
  ],
  triangle: [
    { x: 0.00, y: -0.52 }, { x: 0.52, y: 0.42 }, { x: -0.52, y: 0.42 },
  ],
  arrow: [
    { x: -0.56, y: -0.06 }, { x: 0.18, y: -0.06 }, { x: 0.18, y: -0.22 }, { x: 0.56, y: 0.00 },
    { x: 0.18, y: 0.22 }, { x: 0.18, y: 0.06 }, { x: -0.56, y: 0.06 },
  ],
  shield: [
    { x: -0.44, y: -0.48 }, { x: 0.44, y: -0.48 }, { x: 0.50, y: 0.02 }, { x: 0.20, y: 0.48 },
    { x: 0.00, y: 0.56 }, { x: -0.20, y: 0.48 }, { x: -0.50, y: 0.02 },
  ],
  cup: [
    { x: -0.50, y: -0.42 }, { x: 0.50, y: -0.42 }, { x: 0.30, y: 0.18 }, { x: 0.08, y: 0.24 },
    { x: 0.08, y: 0.44 }, { x: 0.34, y: 0.52 }, { x: -0.34, y: 0.52 }, { x: -0.08, y: 0.44 },
    { x: -0.08, y: 0.24 }, { x: -0.30, y: 0.18 },
  ],
  scales: [
    { x: -0.52, y: -0.22 }, { x: 0.52, y: -0.22 }, { x: 0.36, y: -0.02 }, { x: 0.52, y: 0.28 },
    { x: 0.22, y: 0.28 }, { x: 0.00, y: 0.02 }, { x: -0.22, y: 0.28 }, { x: -0.52, y: 0.28 },
    { x: -0.36, y: -0.02 },
  ],
  altar: [
    { x: -0.40, y: -0.46 }, { x: 0.40, y: -0.46 }, { x: 0.28, y: -0.18 }, { x: 0.36, y: 0.48 },
    { x: -0.36, y: 0.48 }, { x: -0.28, y: -0.18 },
  ],
  cross: [
    { x: -0.13, y: -0.54 }, { x: 0.13, y: -0.54 }, { x: 0.13, y: -0.12 }, { x: 0.52, y: -0.12 },
    { x: 0.52, y: 0.12 }, { x: 0.13, y: 0.12 }, { x: 0.13, y: 0.54 }, { x: -0.13, y: 0.54 },
    { x: -0.13, y: 0.12 }, { x: -0.52, y: 0.12 }, { x: -0.52, y: -0.12 }, { x: -0.13, y: -0.12 },
  ],
};

const DEFAULT_SILHOUETTE = [
  { x: -0.42, y: -0.44 }, { x: 0.08, y: -0.52 }, { x: 0.46, y: -0.24 }, { x: 0.52, y: 0.10 },
  { x: 0.24, y: 0.46 }, { x: -0.16, y: 0.52 }, { x: -0.50, y: 0.18 },
];

const getSilhouetteGroup = (constellation) => (
  SILHOUETTE_GROUP_BY_ABBR[constellation?.abbr] || 'default'
);

const getSilhouetteTemplate = (constellation) => (
  SILHOUETTE_TEMPLATES[getSilhouetteGroup(constellation)] || DEFAULT_SILHOUETTE
);

const getSilhouetteDetailLines = (constellation) => (
  SILHOUETTE_DETAIL_LINES[getSilhouetteGroup(constellation)] || []
);

const getPolygonBounds = (points) => ({
  minX: Math.min(...points.map((point) => point.x)),
  maxX: Math.max(...points.map((point) => point.x)),
  minY: Math.min(...points.map((point) => point.y)),
  maxY: Math.max(...points.map((point) => point.y)),
});

const buildMythicSilhouette = (constellation, points, settings) => {
  if (points.length < 2) {
    return { outline: [
      { x: -settings.cardWidthMm / 2, y: -settings.cardWidthMm / 5 },
      { x: settings.cardWidthMm / 2, y: -settings.cardWidthMm / 5 },
      { x: settings.cardWidthMm / 2, y: settings.cardWidthMm / 5 },
      { x: -settings.cardWidthMm / 2, y: settings.cardWidthMm / 5 },
    ], detailLines: [] };
  }

  const template = getSilhouetteTemplate(constellation);
  const templateDetailLines = getSilhouetteDetailLines(constellation);
  const templateBounds = getPolygonBounds(template);
  const pointBounds = getPolygonBounds(points);
  const pointWidth = Math.max(1, pointBounds.maxX - pointBounds.minX);
  const pointHeight = Math.max(1, pointBounds.maxY - pointBounds.minY);
  const targetWidth = pointWidth + settings.outlinePaddingMm * 2.6;
  const targetHeight = pointHeight + settings.outlinePaddingMm * 2.6;
  const templateWidth = Math.max(0.1, templateBounds.maxX - templateBounds.minX);
  const templateHeight = Math.max(0.1, templateBounds.maxY - templateBounds.minY);
  const cx = (pointBounds.minX + pointBounds.maxX) / 2;
  const cy = (pointBounds.minY + pointBounds.maxY) / 2;
  let scale = Math.max(targetWidth / templateWidth, targetHeight / templateHeight);

  const createOutline = () => template.map((point) => ({
    x: cx + point.x * scale,
    y: cy + point.y * scale,
  }));
  const transformPoint = (point) => ({
    x: cx + point.x * scale,
    y: cy + point.y * scale,
  });

  let outline = createOutline();
  for (let attempt = 0; attempt < 8; attempt++) {
    if (points.every((point) => pointInPolygon(point, outline))) break;
    scale *= 1.12;
    outline = createOutline();
  }

  const detailLines = templateDetailLines.map((line) => line.map(transformPoint));
  return { outline, detailLines };
};

const expandPolygonFromCenter = (polygon, padding) => polygon.map((point) => {
  const length = Math.hypot(point.x, point.y) || 1;
  return {
    x: point.x + (point.x / length) * padding,
    y: point.y + (point.y / length) * padding,
  };
});

const getLineArtStarLabels = (constellation, starsMap, circleCount) => {
  const override = LINE_ART_STAR_OVERRIDES[constellation.abbr] || [];
  if (override.length > 0) return override;

  return getConstellationStarHipsFromEdges(constellation.edges)
    .map((hip) => starsMap.get(hip))
    .filter(Boolean)
    .sort((a, b) => a.mag - b.mag)
    .slice(0, circleCount)
    .map((star) => ({
      hip: star.hip,
      nameEn: star.nameEn || `HIP ${star.hip}`,
      nameZh: star.nameZh || star.nameEn || `HIP ${star.hip}`,
    }));
};

const buildLineArtConstellationModel = (constellation, lineArt, settings, starsMap = new Map()) => {
  if (!constellation || !lineArt?.bounds) {
    return null;
  }

  const rawWidth = Math.max(1, lineArt.bounds.maxX - lineArt.bounds.minX);
  const rawHeight = Math.max(1, lineArt.bounds.maxY - lineArt.bounds.minY);
  const contentWidth = Math.max(20, settings.cardWidthMm - settings.outlinePaddingMm * 2);
  const scale = contentWidth / Math.max(rawWidth, rawHeight);
  const rawCenterX = (lineArt.bounds.minX + lineArt.bounds.maxX) / 2;
  const rawCenterY = (lineArt.bounds.minY + lineArt.bounds.maxY) / 2;
  const offsetX = -rawCenterX * scale;
  const offsetY = -rawCenterY * scale;
  const transformPoint = (point) => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  });

  const hull = Array.isArray(lineArt.hull) ? lineArt.hull : [];
  if (hull.length < 3) return null;

  const outline = expandPolygonFromCenter(hull.map(transformPoint), settings.outlinePaddingMm);
  const starLabels = getLineArtStarLabels(constellation, starsMap, lineArt.circles.length);
  const points = lineArt.circles.map((circle, index) => ({
    hip: starLabels[index]?.hip || `${constellation.abbr}-lineart-${index}`,
    x: circle.x * scale + offsetX,
    y: circle.y * scale + offsetY,
    mag: Math.max(0, 5 - circle.r),
    sourceRadius: circle.r * scale,
    nameEn: starLabels[index]?.nameEn || `Star ${index + 1}`,
    nameZh: starLabels[index]?.nameZh || `星 ${index + 1}`,
  }));
  const edges = [];
  let edgeSource = 'none';

  for (const polyline of lineArt.polylines || []) {
    for (let index = 0; index < polyline.length - 1; index++) {
      edges.push({
        from: transformPoint(polyline[index]),
        to: transformPoint(polyline[index + 1]),
        source: 'noirlab-polyline',
      });
    }
  }

  for (const line of lineArt.lines || []) {
    edges.push({
      from: transformPoint({ x: line.x1, y: line.y1 }),
      to: transformPoint({ x: line.x2, y: line.y2 }),
      source: 'noirlab-line',
    });
  }

  for (const polygon of lineArt.polygons || []) {
    for (let index = 0; index < polygon.length; index++) {
      edges.push({
        from: transformPoint(polygon[index]),
        to: transformPoint(polygon[(index + 1) % polygon.length]),
        source: 'noirlab-polygon',
      });
    }
  }

  if (edges.length > 0) edgeSource = 'noirlab-svg';

  return {
    points,
    edges,
    edgeSource,
    outline,
    detailLines: [],
    lineArt: {
      ...lineArt,
      offsetX,
      offsetY,
      scale,
      transform: `translate(${offsetX.toFixed(4)} ${offsetY.toFixed(4)}) scale(${scale.toFixed(6)})`,
    },
    silhouetteGroup: 'noirlab',
  };
};

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

const projectConstellationModel = (constellation, starsMap, settings, lineArtMap = {}) => {
  if (!constellation) return null;
  const lineArtModel = buildLineArtConstellationModel(constellation, lineArtMap[constellation.abbr], settings, starsMap);
  if (lineArtModel) return lineArtModel;

  const contentWidth = Math.max(20, settings.cardWidthMm - settings.outlinePaddingMm * 2);
  const westernGraph = projectWesternConstellationGraph(constellation, starsMap, contentWidth);
  if (!westernGraph) return null;
  const { points, edges } = westernGraph;
  const { outline, detailLines } = buildMythicSilhouette(constellation, points, settings);

  return { points, edges, edgeSource: 'western-poster-data', outline, detailLines, silhouetteGroup: getSilhouetteGroup(constellation) };
};

const POSTER_COPY_PRESETS = {
  en: {
    title: 'DUAL HEMISPHERE ALL-SKY COLOR STAR MAP',
    customNote: 'EPHEMERIS J2000.0 • INTEGRATED CARTOGRAPHY SYSTEM',
  },
  zh: {
    title: '南北双圈全天彩色星图',
    customNote: '历元 J2000.0 • 综合星图制图系统',
  },
};

const UI_TEXT = {
  en: {
    appSubtitle: 'All-sky constellation poster generator',
    posterPageLink: 'Star Map Poster',
    constellation3dPageLink: '3D Printed Constellations',
    loading: 'Loading all-sky stars and constellation data...',
    loadingSubtext: 'First load may take a few seconds',
    loadError: 'Unable to load star map data. Please confirm the ingestion script has run.',
    errorHint: 'Run node src/ingest/parse.js in the terminal to regenerate the data.',
    themeTypography: 'Design Theme & Typography',
    starMapTemplate: 'Star Map Style Template',
    posterLayout: 'Poster Layout',
    layoutLandscapeDual: 'Landscape Dual Circles',
    layoutPortraitSingle: 'Portrait Single Circle',
    transparentBackground: 'Transparent Background',
    themeClassicNavy: 'Classic Navy',
    themeDeepSpace: 'Deep Space',
    themeElegantWhite: 'Elegant White',
    themeRetroParchment: 'Retro Parchment',
    themeA4PrintColor: 'A4 Print Color',
    fontFamily: 'Font Family',
    fontSerif: 'Lora / Serif Classic',
    fontSans: 'Outfit / Sans Modern',
    canvasLanguage: 'Canvas Language',
    posterText: 'Poster Text',
    mainTitle: 'Main Title',
    footnote: 'Footnote',
    astronomyProjection: 'Astronomy & Projection',
    projectionMode: 'Projection Mode',
    projectionEquidistant: 'Polar Equidistant',
    projectionStereographic: 'Polar Stereographic',
    overlapDeclination: 'Hemisphere Overlap Declination',
    northRotation: 'North Map Rotation',
    southRotation: 'South Map Rotation',
    layerDisplay: 'Star Map Layers',
    modernConstellations: 'Modern Constellations',
    constellationLineSet: 'Constellation Line Set',
    constellationLineStyleOff: 'Off',
    constellationLineStyleModern: 'Modern',
    constellationLineStyleSkyTelescope: 'S&T',
    constellationNames: 'Constellation Names',
    iauBoundaries: 'IAU Constellation Boundaries',
    constellationRegionColors: 'Constellation Region Colors',
    chineseAsterisms: 'Chinese Asterisms',
    asterismLines: 'Asterism Lines',
    asterismNames: 'Asterism Names',
    starLabels: 'Star Labels',
    primaryStarNames: 'Primary Star Names',
    starDots: 'Star Dots',
    magnitudeRange: 'Magnitude Range',
    rangeJoin: 'to',
    brightestEnd: 'Bright End',
    faintestEnd: 'Faint End',
    brightMagnitudeAria: 'Bright-end magnitude',
    faintMagnitudeAria: 'Faint-end magnitude',
    referenceBackground: 'Reference Lines & Background',
    raDecGrid: 'RA/Dec Grid',
    celestialEquator: 'Celestial Equator',
    eclipticPath: 'Ecliptic Path',
    milkyWayBand: 'Milky Way Band',
    visibleSky: 'Naked-eye Visible Sky',
    visibleSkyTimeWindow: 'Extend ±3 Hours',
    observerLatitude: 'Observer Latitude',
    observerHour: 'Local Hour',
    observerMonth: 'Month',
    observerCityHint: 'City dots set latitude and longitude',
    observerHourHint: 'Default uses the selected hour only. Turn on ±3 hours to show a 6-hour visible-sky window.',
    exportSvg: 'Export Vector SVG',
    exportPng: 'Export Print PNG',
    exportTiledPdf: 'Export A4 Tiled PDF',
    actualSize: 'Actual Size',
    fitView: 'Fit',
    updatingPoster: 'Updating star map...',
    languageBoth: 'Chinese + English',
    languageZh: 'Chinese only',
    languageEn: 'English only',
    exportedSvg: 'Exported vector SVG poster.',
    exportSvgFailed: 'SVG export failed. Check the console log.',
    renderingPng: 'Rendering high-resolution image...',
    exportedPng: 'Exported print PNG.',
    exportPngFailed: 'PNG export failed. The browser may not support large canvas rendering.',
    renderingPdf: 'Rendering tiled A4 PDF...',
    exportedPdf: 'Exported tiled A4 PDF.',
    exportPdfFailed: 'PDF export failed. Check the console log.',
    print3dTitle: '3D Printed Constellations',
    print3dSubtitle: 'Export constellation-shaped relief cards for glow-powder star wells.',
    print3dConstellation: 'Constellation',
    print3dCardWidth: 'Card Width',
    print3dBaseThickness: 'Base Thickness',
    print3dBaseGroup: 'Base',
    print3dLayerGroup: 'Layers',
    print3dStarGroup: 'Stars & Grooves',
    print3dMythLines: 'Myth Story Lines',
    print3dStarConnectionLines: 'Star Connection Grooves',
    print3dReliefHeight: 'Raised Relief',
    print3dSurfaceLineWidth: 'Story Line Width',
    print3dGrooveDiameter: 'Star Groove Diameter',
    print3dGrooveDepth: 'Star Groove Depth',
    print3dOutlinePadding: 'Shape Padding',
    print3dExportStl: 'Export STL',
    print3dDesignNotes: 'Print Notes',
    print3dNoteShape: 'The card outline follows the constellation footprint instead of a fixed rectangle.',
    print3dNoteGroove: 'Star dots are recessed wells for glow powder and deer-glue binder.',
    print3dNoteMount: 'Print the model flat, fill the wells after curing, then mount it on the ceiling.',
    toggleOn: 'On',
    toggleOff: 'Off',
    exportedStl: 'Exported constellation STL model.',
    exportStlFailed: 'STL export failed. Check the current constellation data.',
  },
  zh: {
    appSubtitle: '全天星座星图印刷海报生成器',
    posterPageLink: '星图海报',
    constellation3dPageLink: '3D 打印的星座',
    loading: '正在加载全天恒星与星座数据源...',
    loadingSubtext: '首次加载可能需要几秒钟',
    loadError: '无法加载星图数据，请确认是否已运行 Ingestion 脚本。',
    errorHint: '请在终端执行 node src/ingest/parse.js 重新生成数据。',
    themeTypography: '设计主题与排版',
    starMapTemplate: '星图风格模板',
    posterLayout: '海报布局',
    layoutLandscapeDual: '横版双圈',
    layoutPortraitSingle: '竖版单圈',
    transparentBackground: '背景透明',
    themeClassicNavy: 'Classic Navy (经典深蓝)',
    themeDeepSpace: 'Deep Space (深空霓虹)',
    themeElegantWhite: 'Elegant White (极简黑白)',
    themeRetroParchment: 'Retro Parchment (齐锐版古风)',
    themeA4PrintColor: 'A4 Print Color (A4 彩印清晰)',
    fontFamily: '字体族配置',
    fontSerif: 'Lora / 宋体 (衬线古典)',
    fontSans: 'Outfit / 黑体 (无衬线现代)',
    canvasLanguage: '画布语言标注',
    posterText: '海报文字定制',
    mainTitle: '主标题',
    footnote: '脚注备注',
    astronomyProjection: '天文学与投影参数',
    projectionMode: '天球投影模式',
    projectionEquidistant: 'Polar Equidistant (极射等距)',
    projectionStereographic: 'Polar Stereographic (极射赤面投影)',
    overlapDeclination: '南北半球重叠赤纬角',
    northRotation: '北天图旋转角度',
    southRotation: '南天图旋转角度',
    layerDisplay: '星空图层显示',
    modernConstellations: '现代星座',
    constellationLineSet: '星座连线方案',
    constellationLineStyleOff: '关闭',
    constellationLineStyleModern: '现代',
    constellationLineStyleSkyTelescope: 'S&T',
    constellationNames: '星座名称',
    iauBoundaries: 'IAU 星座边界',
    constellationRegionColors: '星座区域着色',
    chineseAsterisms: '中国星官',
    asterismLines: '星官连线',
    asterismNames: '星官名称',
    starLabels: '恒星标注',
    primaryStarNames: '主要恒星名称',
    starDots: '星点显示',
    magnitudeRange: '星等范围',
    rangeJoin: '到',
    brightestEnd: '最亮端',
    faintestEnd: '最暗端',
    brightMagnitudeAria: '最亮端星等',
    faintMagnitudeAria: '最暗端星等',
    referenceBackground: '参考线与背景',
    raDecGrid: '赤经赤纬网格',
    celestialEquator: '天球赤道',
    eclipticPath: '黄道轨迹',
    milkyWayBand: '银河带',
    visibleSky: '肉眼可见天空',
    visibleSkyTimeWindow: '前后延长 3 小时',
    observerLatitude: '观察纬度',
    observerHour: '本地小时',
    observerMonth: '月份',
    observerCityHint: '点击城市点会同时设置纬度和经度',
    observerHourHint: '默认只绘制所选小时；开启“前后延长 3 小时”后绘制 6 小时范围。',
    exportSvg: '导出无损矢量 SVG',
    exportPng: '导出印刷级高清 PNG',
    exportTiledPdf: '导出 A4 拼接 PDF',
    actualSize: '真实尺寸',
    fitView: '适应窗口',
    updatingPoster: '正在重绘星图...',
    languageBoth: '中文 + English',
    languageZh: '仅中文',
    languageEn: 'English only',
    exportedSvg: '成功导出巨幅矢量 SVG 海报。',
    exportSvgFailed: '导出 SVG 失败，请查看控制台日志。',
    renderingPng: '正在渲染巨幅高清图片，请稍候...',
    exportedPng: '成功导出 300DPI 巨幅印刷 PNG。',
    exportPngFailed: '导出 PNG 失败，浏览器可能不支持巨幅 canvas 渲染。',
    renderingPdf: '正在生成 A4 拼接 PDF...',
    exportedPdf: '成功导出 A4 拼接 PDF。',
    exportPdfFailed: '导出 PDF 失败，请查看控制台日志。',
    print3dTitle: '3D 打印的星座',
    print3dSubtitle: '导出星座形状的浮雕卡片，星点为可填荧光粉与鹿胶合剂的凹槽。',
    print3dConstellation: '星座',
    print3dCardWidth: '卡片宽度',
    print3dBaseThickness: '底板厚度',
    print3dBaseGroup: '底板',
    print3dLayerGroup: '图层',
    print3dStarGroup: '星点与凹槽',
    print3dMythLines: '神话线条',
    print3dStarConnectionLines: '星星连线凹槽',
    print3dReliefHeight: '浮雕高度',
    print3dSurfaceLineWidth: '神话线条宽度',
    print3dGrooveDiameter: '星点凹槽直径',
    print3dGrooveDepth: '星点凹槽深度',
    print3dOutlinePadding: '轮廓留边',
    print3dExportStl: '导出 STL 模型',
    print3dDesignNotes: '打印说明',
    print3dNoteShape: '卡片轮廓跟随星座恒星与连线的形态，不使用固定矩形。',
    print3dNoteGroove: '星点是带厚度的凹槽，可在内部填入荧光粉与鹿胶合剂。',
    print3dNoteMount: '模型平放打印，固化后填充星点，再贴到室内天花板。',
    toggleOn: '有',
    toggleOff: '无',
    exportedStl: '已导出星座 STL 模型。',
    exportStlFailed: '导出 STL 失败，请检查当前星座数据。',
  },
};

const ToggleRow = ({ checked, onChange, children, indented = false, muted = false }) => (
  <label className="toggle-row" style={indented ? { paddingLeft: '14px' } : undefined}>
    <span style={muted ? { opacity: 0.8 } : undefined}>{children}</span>
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="slider-switch"></span>
    </span>
  </label>
);

const sphericalSegmentDistance = (a, b) => {
  const deltaRa = Math.min(Math.abs(a.ra - b.ra), 360 - Math.abs(a.ra - b.ra));
  const midDec = ((a.dec + b.dec) / 2) * Math.PI / 180;
  const projectedRa = deltaRa * Math.cos(midDec);
  return Math.hypot(projectedRa, a.dec - b.dec);
};

const boundaryPointKey = (pt) => `${pt.ra.toFixed(3)},${pt.dec.toFixed(3)}`;

const buildBoundaryAdjacency = (boundaries) => {
  const ownersByPoint = new Map();

  for (const [abbr, points] of Object.entries(boundaries)) {
    for (const point of points) {
      const key = boundaryPointKey(point);
      if (!ownersByPoint.has(key)) ownersByPoint.set(key, new Set());
      ownersByPoint.get(key).add(abbr);
    }
  }

  const adjacency = {};
  for (const abbr of Object.keys(boundaries)) {
    adjacency[abbr] = new Set();
  }

  for (const owners of ownersByPoint.values()) {
    const abbrs = [...owners];
    for (let i = 0; i < abbrs.length; i++) {
      for (let j = i + 1; j < abbrs.length; j++) {
        adjacency[abbrs[i]].add(abbrs[j]);
        adjacency[abbrs[j]].add(abbrs[i]);
      }
    }
  }

  return adjacency;
};

const colorBoundaryGraph = (boundaries, paletteSize = 4) => {
  const adjacency = buildBoundaryAdjacency(boundaries);
  const nodes = Object.keys(adjacency).sort((a, b) => adjacency[b].size - adjacency[a].size);
  const uncolored = new Set(nodes);
  const colorByAbbr = {};
  let searchSteps = 0;
  const maxSearchSteps = 100000;

  const chooseNextAbbr = () => {
    let nextAbbr = null;
    let bestSaturation = -1;
    let bestDegree = -1;

    for (const abbr of uncolored) {
      const neighborColors = new Set(
        [...adjacency[abbr]]
          .map((neighbor) => colorByAbbr[neighbor])
          .filter((color) => color !== undefined)
      );
      const degree = adjacency[abbr].size;
      if (
        neighborColors.size > bestSaturation ||
        (neighborColors.size === bestSaturation && degree > bestDegree)
      ) {
        nextAbbr = abbr;
        bestSaturation = neighborColors.size;
        bestDegree = degree;
      }
    }

    return nextAbbr;
  };

  const getAllowedColors = (abbr) => {
    const usedColors = new Set(
      [...adjacency[abbr]]
        .map((neighbor) => colorByAbbr[neighbor])
        .filter((color) => color !== undefined)
    );

    const allowedColors = [];
    for (let colorIndex = 0; colorIndex < paletteSize; colorIndex++) {
      if (!usedColors.has(colorIndex)) allowedColors.push(colorIndex);
    }
    return allowedColors;
  };

  const solve = () => {
    searchSteps++;
    if (searchSteps > maxSearchSteps) return false;
    if (uncolored.size === 0) return true;

    const nextAbbr = chooseNextAbbr();
    const allowedColors = getAllowedColors(nextAbbr);
    if (allowedColors.length === 0) return false;

    uncolored.delete(nextAbbr);
    for (const colorIndex of allowedColors) {
      colorByAbbr[nextAbbr] = colorIndex;
      if (solve()) return true;
      delete colorByAbbr[nextAbbr];
    }
    uncolored.add(nextAbbr);

    return false;
  };

  if (solve()) return colorByAbbr;

  for (const abbr of nodes) {
    if (colorByAbbr[abbr] !== undefined) continue;
    const allowedColors = getAllowedColors(abbr);
    colorByAbbr[abbr] = allowedColors[0] ?? 0;
  }

  return colorByAbbr;
};

const buildBoundarySegments = (boundaries) => {
  const seen = new Set();
  const segments = [];

  for (const points of Object.values(boundaries)) {
    const sorted = [...points].sort((a, b) => a.ra - b.ra || a.dec - b.dec);

    for (let i = 0; i < sorted.length; i++) {
      let bestCandidate = null;
      const searchEnd = Math.min(sorted.length, i + 1 + BOUNDARY_LOOKAHEAD);

      for (let j = i + 1; j < searchEnd; j++) {
        const distance = sphericalSegmentDistance(sorted[i], sorted[j]);
        if (
          distance > 0.001 &&
          distance <= BOUNDARY_MAX_SEGMENT_DEG &&
          (!bestCandidate || distance < bestCandidate.distance)
        ) {
          bestCandidate = { point: sorted[j], distance };
        }
      }

      if (!bestCandidate) continue;

      const aKey = boundaryPointKey(sorted[i]);
      const bKey = boundaryPointKey(bestCandidate.point);
      const segmentKey = [aKey, bKey].sort().join('|');
      if (seen.has(segmentKey)) continue;

      seen.add(segmentKey);
      segments.push([sorted[i], bestCandidate.point]);
    }
  }

  return segments;
};

const disposeThreeObject = (object) => {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
};

const toThreeMatrix = (matrix, scale = 1) => {
  const threeMatrix = new THREE.Matrix4().set(
    matrix[0], matrix[1], matrix[2], matrix[3],
    matrix[4], matrix[5], matrix[6], matrix[7],
    matrix[8], matrix[9], matrix[10], matrix[11],
    matrix[12], matrix[13], matrix[14], matrix[15],
  );
  return threeMatrix.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
};

const createShapeFromOutline = (outline, holes = []) => {
  const shape = new THREE.Shape();
  if (outline.length === 0) return shape;
  shape.moveTo(outline[0].x, -outline[0].y);
  for (let index = 1; index < outline.length; index++) {
    shape.lineTo(outline[index].x, -outline[index].y);
  }
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    if (Array.isArray(hole.points) && hole.points.length > 2) {
      path.moveTo(hole.points[0].x, -hole.points[0].y);
      for (let index = 1; index < hole.points.length; index++) {
        path.lineTo(hole.points[index].x, -hole.points[index].y);
      }
      path.closePath();
      shape.holes.push(path);
      continue;
    }
    const segments = 40;
    for (let index = segments; index >= 0; index--) {
      const angle = (Math.PI * 2 * index) / segments;
      const x = hole.x + Math.cos(angle) * hole.radius;
      const y = -hole.y + Math.sin(angle) * hole.radius;
      if (index === segments) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    shape.holes.push(path);
  }
  return shape;
};

const lineArtPointToModel = (point, lineArt) => ({
  x: point.x * lineArt.scale + lineArt.offsetX,
  y: point.y * lineArt.scale + lineArt.offsetY,
});

const toVector3 = (point, z) => new THREE.Vector3(point.x, -point.y, z);

const createTubeMesh = (points, z, radius, material, closed = false) => {
  if (points.length < 2) return null;
  const vectors = points.map((point) => toVector3(point, z));
  const curve = vectors.length === 2
    ? new THREE.LineCurve3(vectors[0], vectors[1])
    : new THREE.CatmullRomCurve3(vectors, closed, 'centripetal');
  const geometry = new THREE.TubeGeometry(curve, Math.max(6, points.length * 2), radius, 8, closed);
  return new THREE.Mesh(geometry, material);
};

const createFlatLineMesh = (points, z, material, closed = false) => {
  if (points.length < 2) return null;
  const vectors = points.map((point) => toVector3(point, z));
  if (closed) vectors.push(vectors[0].clone());
  const geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  return new THREE.Line(geometry, material);
};

const createFlatStripMesh = (points, z, width, material, closed = false) => {
  if (points.length < 2) return null;
  const vertices = [];
  const indices = [];
  const sourcePoints = closed ? [...points, points[0]] : points;

  for (let index = 0; index < sourcePoints.length - 1; index++) {
    const a = sourcePoints[index];
    const b = sourcePoints[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * width / 2;
    const ny = (dx / length) * width / 2;
    const base = vertices.length / 3;
    vertices.push(
      a.x + nx, -a.y - ny, z,
      a.x - nx, -a.y + ny, z,
      b.x + nx, -b.y - ny, z,
      b.x - nx, -b.y + ny, z,
    );
    indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
};

const createStarLabelSprite = (text) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fontSize = 34;
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = context.measureText(text);
  const width = Math.ceil(metrics.width + 24);
  const height = 54;
  canvas.width = Math.min(512, Math.max(128, Math.ceil(width / 2) * 2));
  canvas.height = 64;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(255, 252, 242, 0.84)';
  context.fillRect(0, 4, Math.min(width, canvas.width), height);
  context.strokeStyle = 'rgba(23, 23, 23, 0.22)';
  context.lineWidth = 2;
  context.strokeRect(1, 5, Math.min(width, canvas.width) - 2, height - 2);
  context.fillStyle = '#171717';
  context.fillText(text, 12, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const labelWidth = Math.max(14, Math.min(42, canvas.width / 10));
  sprite.scale.set(labelWidth, labelWidth * (canvas.height / canvas.width), 1);
  return sprite;
};

const applySvgTransformToPoint = (point, transform) => {
  if (!transform) return point;
  const rotate = transform.match(/rotate\(([-\d.]+)(?:[\s,]+([-\d.]+)[\s,]+([-\d.]+))?\)/);
  if (!rotate) return point;
  const degrees = Number(rotate[1]);
  const cx = Number(rotate[2] ?? 0);
  const cy = Number(rotate[3] ?? 0);
  if (!Number.isFinite(degrees) || !Number.isFinite(cx) || !Number.isFinite(cy)) return point;
  const rad = degToRad(degrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
};

const sampleEllipsePoints = (ellipse, lineArt) => {
  const points = [];
  for (let step = 0; step < 48; step++) {
    const angle = (Math.PI * 2 * step) / 48;
    const raw = applySvgTransformToPoint({
      x: ellipse.cx + Math.cos(angle) * ellipse.rx,
      y: ellipse.cy + Math.sin(angle) * ellipse.ry,
    }, ellipse.transform);
    points.push(lineArtPointToModel(raw, lineArt));
  }
  return points;
};

const getSvgPathPointSets = (paths, lineArt) => {
  const loader = new SVGLoader();
  const pointSets = [];
  const escapeAttr = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  for (const d of paths || []) {
    const parsed = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${escapeAttr(d)}"/></svg>`);
    for (const path of parsed.paths) {
      for (const subPath of path.subPaths || []) {
        const points = subPath.getPoints(24).map((point) => lineArtPointToModel(point, lineArt));
        if (points.length > 1) pointSets.push(points);
      }
    }
  }
  return pointSets;
};

const createSegmentHole = (from, to, width, insetStart = 0, insetEnd = 0) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return null;
  const start = Math.min(length / 2 - 0.001, Math.max(0, insetStart));
  const end = Math.min(length / 2 - 0.001, Math.max(0, insetEnd));
  const ax = from.x + (dx / length) * start;
  const ay = from.y + (dy / length) * start;
  const bx = to.x - (dx / length) * end;
  const by = to.y - (dy / length) * end;
  const nx = (-dy / length) * width / 2;
  const ny = (dx / length) * width / 2;
  return {
    points: [
      { x: ax + nx, y: ay + ny },
      { x: bx + nx, y: by + ny },
      { x: bx - nx, y: by - ny },
      { x: ax - nx, y: ay - ny },
    ],
  };
};

const addExtrudedShapeMesh = (group, shape, depth, z, material) => {
  if (depth <= 0.001) return null;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 16,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  group.add(mesh);
  return mesh;
};

const addSurfaceArtworkMeshes = (group, model, z, width, material) => {
  const addSurfaceLine = (pointSet, closed = false) => {
    const mesh = createFlatStripMesh(pointSet, z, width, material, closed);
    if (mesh) group.add(mesh);
  };

  if (model.lineArt) {
    for (const pointSet of getSvgPathPointSets(model.lineArt.paths, model.lineArt)) addSurfaceLine(pointSet);
    for (const polygon of model.lineArt.polygons || []) {
      addSurfaceLine(polygon.map((point) => lineArtPointToModel(point, model.lineArt)), true);
    }
    for (const ellipse of model.lineArt.ellipses || []) {
      addSurfaceLine(sampleEllipsePoints(ellipse, model.lineArt), true);
    }
  } else {
    for (const line of model.detailLines || []) addSurfaceLine(line);
  }
};

const addSolidArtworkMeshes = (group, model, z, width, depth, material) => {
  const addSurfaceLine = (pointSet, closed = false) => {
    const sourcePoints = closed ? [...pointSet, pointSet[0]] : pointSet;
    for (let index = 0; index < sourcePoints.length - 1; index++) {
      const strip = createSegmentHole(sourcePoints[index], sourcePoints[index + 1], width);
      if (!strip) continue;
      addExtrudedShapeMesh(group, createShapeFromOutline(strip.points), depth, z, material);
    }
  };

  if (model.lineArt) {
    for (const pointSet of getSvgPathPointSets(model.lineArt.paths, model.lineArt)) addSurfaceLine(pointSet);
    for (const polygon of model.lineArt.polygons || []) {
      addSurfaceLine(polygon.map((point) => lineArtPointToModel(point, model.lineArt)), true);
    }
    for (const ellipse of model.lineArt.ellipses || []) {
      addSurfaceLine(sampleEllipsePoints(ellipse, model.lineArt), true);
    }
  } else {
    for (const line of model.detailLines || []) addSurfaceLine(line);
  }
};

const createConstellationExportObject = (model, settings) => {
  const group = new THREE.Group();
  const baseMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const artworkMaterial = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });
  const topZ = settings.baseThicknessMm;
  const grooveDepth = Math.min(Math.max(0.08, topZ - 0.08), Math.max(1, topZ / 2));
  const grooveFloorZ = Math.max(0.08, topZ - grooveDepth);
  const starRadius = settings.grooveDiameterMm / 2;
  const grooveWidth = Math.max(1.25, settings.grooveDiameterMm * 0.36);
  const starIsRecessed = settings.starPositionMode !== 'raised';
  const grooveInset = starIsRecessed ? starRadius + grooveWidth * 0.3 : grooveWidth * 0.5;
  const grooveHoles = [
    ...(settings.showStarConnectionLines === false ? [] : model.edges.map((edge) => createSegmentHole(edge.from, edge.to, grooveWidth, grooveInset, grooveInset)).filter(Boolean)),
    ...(starIsRecessed ? (model.points || []).map((point) => ({
      x: point.x,
      y: point.y,
      radius: starRadius,
    })) : []),
  ];

  addExtrudedShapeMesh(group, createShapeFromOutline(model.outline), grooveFloorZ, 0, baseMaterial);
  addExtrudedShapeMesh(
    group,
    createShapeFromOutline(model.outline, grooveHoles),
    topZ - grooveFloorZ,
    grooveFloorZ,
    baseMaterial,
  );

  if (!starIsRecessed) {
    const raisedHeight = Math.max(1, settings.baseThicknessMm / 2);
    for (const point of model.points || []) {
      const capGeometry = new THREE.CylinderGeometry(starRadius, starRadius, raisedHeight, 48);
      const cap = new THREE.Mesh(capGeometry, baseMaterial);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(point.x, -point.y, topZ + raisedHeight / 2);
      group.add(cap);
    }
  }

  if (settings.showMythLines !== false) {
    addSolidArtworkMeshes(
      group,
      model,
      topZ,
      Math.max(0.1, settings.surfaceLineWidthMm || 1),
      SURFACE_LINE_HEIGHT_MM,
      artworkMaterial,
    );
  }

  group.updateMatrixWorld(true);
  return group;
};

const createConstellationStl = (model, settings) => {
  const exportObject = createConstellationExportObject(model, settings);
  const exporter = new STLExporter();
  const stl = exporter.parse(exportObject, { binary: false });
  disposeThreeObject(exportObject);
  return stl;
};

function ConstellationModel3DPreview({ model, settings, modelView, displayLanguage }) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const rootRef = useRef(null);
  const latestModelRef = useRef(model);
  const resizeRef = useRef(null);
  const renderSceneRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-100, 100, 75, -75, 0.1, 1200);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 1.45);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-70, -90, 180);
    const rim = new THREE.DirectionalLight(0xffffff, 0.75);
    rim.position.set(140, 120, 120);
    scene.add(ambient, key, rim);

    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    scene.add(root);
    rootRef.current = root;

    const resize = () => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      renderer.setSize(width, height, false);
      const latestModel = latestModelRef.current;
      const bounds = latestModel?.outline?.length ? getPolygonBounds(latestModel.outline) : { minX: -70, maxX: 70, minY: -70, maxY: 70 };
      const modelWidth = Math.max(40, bounds.maxX - bounds.minX);
      const modelHeight = Math.max(40, bounds.maxY - bounds.minY);
      const frustumHeight = Math.max(modelHeight, modelWidth / (width / height || 1)) * 1.55;
      const frustumWidth = frustumHeight * (width / height || 1);
      camera.left = -frustumWidth / 2;
      camera.right = frustumWidth / 2;
      camera.top = frustumHeight / 2;
      camera.bottom = -frustumHeight / 2;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    resizeRef.current = resize;

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    renderSceneRef.current = () => {
      renderer.render(scene, camera);
    };
    renderSceneRef.current();

    return () => {
      observer.disconnect();
      disposeThreeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      resizeRef.current = null;
      renderSceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestModelRef.current = model;
    const root = rootRef.current;
    if (!root || !model?.outline?.length) return undefined;
    resizeRef.current?.();

    while (root.children.length > 0) {
      const child = root.children.pop();
      disposeThreeObject(child);
    }

    const baseTopMaterial = new THREE.MeshStandardMaterial({ color: 0xeee7d6, roughness: 0.82, metalness: 0.02 });
    const baseSideMaterial = new THREE.MeshStandardMaterial({ color: 0xb8b2a5, roughness: 0.92, metalness: 0.01 });
    const surfaceLineMaterial = new THREE.MeshBasicMaterial({ color: 0x171717, side: THREE.DoubleSide });
    const starIsRecessed = settings.starPositionMode !== 'raised';

    const starHoleRadius = settings.grooveDiameterMm / 2;
    const grooveWidth = Math.max(1.25, settings.grooveDiameterMm * 0.36);
    const grooveInset = starIsRecessed ? starHoleRadius + grooveWidth * 0.3 : grooveWidth * 0.5;
    const lineGrooveHoles = settings.showStarConnectionLines === false
      ? []
      : (model.edges || []).map((edge) => createSegmentHole(edge.from, edge.to, grooveWidth, grooveInset, grooveInset)).filter(Boolean);
    const shape = createShapeFromOutline(
      model.outline,
      [
        ...lineGrooveHoles,
        ...(starIsRecessed ? (model.points || []).map((point) => ({
          x: point.x,
          y: point.y,
          radius: starHoleRadius,
        })) : []),
      ],
    );
    const baseGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: settings.baseThicknessMm,
      bevelEnabled: false,
      curveSegments: 8,
    });
    const baseMesh = new THREE.Mesh(baseGeometry, [baseTopMaterial, baseSideMaterial]);
    baseMesh.position.z = -settings.baseThicknessMm;
    root.add(baseMesh);

    const grooveDepth = Math.max(1, settings.baseThicknessMm / 2);
    const clampedGrooveDepth = Math.min(settings.baseThicknessMm - 0.08, grooveDepth);
    const grooveFloorZ = -clampedGrooveDepth;
    const surfaceLineWidth = Math.max(0.1, settings.surfaceLineWidthMm || 1);
    const addGrooveLine = (pointSet, closed = false) => {
      const floor = createFlatStripMesh(pointSet, grooveFloorZ, grooveWidth, baseSideMaterial, closed);
      if (floor) root.add(floor);
    };
    if (settings.showMythLines !== false) {
      addSolidArtworkMeshes(root, model, 0, surfaceLineWidth, SURFACE_LINE_HEIGHT_MM, surfaceLineMaterial);
    }
    if (settings.showStarConnectionLines !== false) {
      for (const edge of model.edges || []) addGrooveLine([edge.from, edge.to]);
    }

    for (const point of model.points || []) {
      const radius = settings.grooveDiameterMm / 2;
      if (starIsRecessed) {
        const wallGeometry = new THREE.CylinderGeometry(radius, radius, clampedGrooveDepth, 40, 1, true);
        const wall = new THREE.Mesh(wallGeometry, baseSideMaterial);
        wall.rotation.x = Math.PI / 2;
        wall.position.set(point.x, -point.y, -clampedGrooveDepth / 2);
        root.add(wall);

        const bottomGeometry = new THREE.CircleGeometry(radius, 40);
        const bottom = new THREE.Mesh(bottomGeometry, baseSideMaterial);
        bottom.position.set(point.x, -point.y, -clampedGrooveDepth);
        root.add(bottom);
      } else {
        const raisedHeight = Math.max(1, settings.baseThicknessMm / 2);
        const capGeometry = new THREE.CylinderGeometry(radius, radius, raisedHeight, 40);
        const cap = new THREE.Mesh(capGeometry, baseTopMaterial);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(point.x, -point.y, raisedHeight / 2);
        root.add(cap);
      }
    }

    for (const point of model.points || []) {
      const label = displayLanguage === 'zh'
        ? (point.nameZh || point.nameEn)
        : (point.nameEn || point.nameZh);
      if (!label) continue;
      const sprite = createStarLabelSprite(label);
      const labelZ = starIsRecessed ? 0.55 : Math.max(1, settings.baseThicknessMm / 2) + 0.65;
      sprite.position.set(
        point.x + settings.grooveDiameterMm * 0.85 + 1.6,
        -point.y + settings.grooveDiameterMm * 0.55 + 1.2,
        labelZ,
      );
      root.add(sprite);
    }

    if (mountRef.current) {
      mountRef.current.dataset.renderMode = 'three-mesh';
      mountRef.current.dataset.baseThicknessMm = String(settings.baseThicknessMm);
      mountRef.current.dataset.reliefHeightMm = String(settings.reliefHeightMm);
      mountRef.current.dataset.surfaceLineWidthMm = String(surfaceLineWidth);
      mountRef.current.dataset.surfaceLineHeightMm = String(SURFACE_LINE_HEIGHT_MM);
      mountRef.current.dataset.showMythLines = String(settings.showMythLines !== false);
      mountRef.current.dataset.showStarConnectionLines = String(settings.showStarConnectionLines !== false);
      mountRef.current.dataset.lineGrooveHoleCount = String(lineGrooveHoles.length);
      mountRef.current.dataset.lineGrooveEdgeSource = model.edgeSource || 'projected';
      mountRef.current.dataset.lineGrooveFloorNormals = 'up';
      mountRef.current.dataset.grooveDiameterMm = String(settings.grooveDiameterMm);
      mountRef.current.dataset.grooveDepthMm = String(clampedGrooveDepth);
      mountRef.current.dataset.starPositionMode = settings.starPositionMode;
      mountRef.current.dataset.outlinePoints = String(model.outline.length);
      mountRef.current.dataset.starCount = String(model.points?.length || 0);
      mountRef.current.dataset.starLabelCount = String((model.points || []).filter((point) => point.nameEn || point.nameZh).length);
      mountRef.current.dataset.meshCount = String(root.children.length);
      mountRef.current.dataset.groovePreview = starIsRecessed ? 'subtracted-material-holes' : 'raised-material-stars';
    }
    renderSceneRef.current?.();

    return () => {
      while (root.children.length > 0) {
        const child = root.children.pop();
        disposeThreeObject(child);
      }
    };
  }, [model, settings, displayLanguage]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const matrix = toThreeMatrix(multiplyMatrix4(modelView.viewMatrix, modelView.modelMatrix), modelView.scale);
    root.matrix.copy(matrix);
    if (mountRef.current) {
      mountRef.current.dataset.viewPitchDeg = getCardViewPitchDegrees(modelView.viewMatrix).toFixed(2);
    }
    renderSceneRef.current?.();
  }, [modelView]);

  return <div ref={mountRef} className="constellation-3d-canvas" data-testid="constellation-3d-canvas" data-render-mode="three-mesh" />;
}

function App() {
  // --- State Variables ---
  const [stars, setStars] = useState([]);
  const [westernConstellations, setWesternConstellations] = useState([]);
  const [westernStConstellations, setWesternStConstellations] = useState([]);
  const [chineseConstellations, setChineseConstellations] = useState([]);
  const [boundaries, setBoundaries] = useState({});
  const [constellationLineArt, setConstellationLineArt] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [isPosterRendering, setIsPosterRendering] = useState(false);
  const [posterRenderMessage, setPosterRenderMessage] = useState('');
  const [, startPosterTransition] = useTransition();
  const previewAreaRef = useRef(null);
  const posterMockupRef = useRef(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const dragStateRef = useRef(null);
  const modelDragStateRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const pinchStateRef = useRef(null);
  const gestureStateRef = useRef(null);
  const lastInputPointRef = useRef(null);
  const transformFrameRef = useRef(null);
  const interactionEndTimerRef = useRef(null);
  const renderNoticeTimerRef = useRef(null);
  const renderNoticeFrameRef = useRef(null);
  const isPreviewInteractingRef = useRef(false);
  const inputDebugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugInput') === '1';
  const [inputProbe, setInputProbe] = useState(null);
  const [sphereRenderData, setSphereRenderData] = useState({});
  const sphereWorkerRef = useRef(null);
  const sphereRequestIdRef = useRef(0);

  // --- Poster & Layout Settings ---
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [labelLanguageMode, setLabelLanguageMode] = useState(getInitialLanguageMode);
  const displayLanguage = getDisplayLanguage(labelLanguageMode);
  const uiText = UI_TEXT[displayLanguage];
  const [modelSettings, setModelSettings] = useState(DEFAULT_3D_MODEL_SETTINGS);
  const [modelView, setModelView] = useState(DEFAULT_3D_VIEW);
  const [titleOverrides, setTitleOverrides] = useState({});
  const [customNoteOverrides, setCustomNoteOverrides] = useState({});
  const title = titleOverrides[displayLanguage] ?? POSTER_COPY_PRESETS[displayLanguage].title;
  const customNote = customNoteOverrides[displayLanguage] ?? POSTER_COPY_PRESETS[displayLanguage].customNote;
  const [fontFamily, setFontFamily] = useState("serif"); // "serif" or "sans"
  const [themeId, setThemeId] = useState("classic_navy");
  const [posterLayout, setPosterLayout] = useState("landscape_dual");
  const [transparentBackground, setTransparentBackground] = useState(false);

  // --- Astronomical Settings ---
  const [projection, setProjection] = useState("polar_equidistant"); // "polar_equidistant" or "polar_stereographic"
  const [minMagLimit, setMinMagLimit] = useState(MAG_RANGE_MIN);
  const [magLimit, setMagLimit] = useState(4);
  const [overlapDec, setOverlapDec] = useState(20); // shared equatorial overlap between hemisphere maps
  const [northRotation, setNorthRotation] = useState(0); // rotation in degrees
  const [southRotation, setSouthRotation] = useState(0); // rotation in degrees

  // --- Layer Toggles ---
  const [westernLineStyle, setWesternLineStyle] = useState(DEFAULT_WESTERN_LINE_STYLE);
  const [showWesternBoundaries, setShowWesternBoundaries] = useState(true);
  const [showWesternBoundaryFills, setShowWesternBoundaryFills] = useState(false);
  const [showWesternNames, setShowWesternNames] = useState(true);

  const [showChineseLines, setShowChineseLines] = useState(false);
  const [showChineseNames, setShowChineseNames] = useState(false);

  const [showGrid, setShowGrid] = useState(false);
  const [showEquator, setShowEquator] = useState(false);
  const [showEcliptic, setShowEcliptic] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(true);
  const [showVisibleSky, setShowVisibleSky] = useState(true);
  const [showVisibleSkyTimeWindow, setShowVisibleSkyTimeWindow] = useState(false);
  const [observerLatitude, setObserverLatitude] = useState(DEFAULT_OBSERVER.latitude);
  const [observerLongitude, setObserverLongitude] = useState(DEFAULT_OBSERVER.longitude);
  const [observerMonth, setObserverMonth] = useState(initialDateParts.month);
  const [observerHour, setObserverHour] = useState(22);
  const [showStarNames, setShowStarNames] = useState(true);
  const [renderSettings, setRenderSettings] = useState(() => ({
    ...DEFAULT_RENDER_SETTINGS,
    labelLanguageMode: getInitialLanguageMode(),
  }));
  const renderLabelLanguageMode = renderSettings.labelLanguageMode;
  const renderFontFamily = renderSettings.fontFamily;
  const renderThemeId = renderSettings.themeId;
  const renderPosterLayout = renderSettings.posterLayout;
  const renderTransparentBackground = renderSettings.transparentBackground;
  const renderProjection = renderSettings.projection;
  const renderMinMagLimit = renderSettings.minMagLimit;
  const renderMagLimit = renderSettings.magLimit;
  const renderOverlapDec = renderSettings.overlapDec;
  const renderNorthRotation = renderSettings.northRotation;
  const renderSouthRotation = renderSettings.southRotation;
  const legacyWesternLineStyle = renderSettings.showWesternLines === false
    ? WESTERN_LINE_STYLE_OFF
    : DEFAULT_WESTERN_LINE_STYLE;
  const renderWesternLineStyle = normalizeWesternLineStyle(renderSettings.westernLineStyle ?? legacyWesternLineStyle);
  const renderShowWesternLines = renderWesternLineStyle !== WESTERN_LINE_STYLE_OFF;
  const renderShowWesternBoundaries = renderSettings.showWesternBoundaries;
  const renderShowWesternBoundaryFills = renderSettings.showWesternBoundaryFills;
  const renderShowWesternNames = renderSettings.showWesternNames;
  const renderShowChineseLines = renderSettings.showChineseLines;
  const renderShowChineseNames = renderSettings.showChineseNames;
  const renderShowGrid = renderSettings.showGrid;
  const renderShowEquator = renderSettings.showEquator;
  const renderShowEcliptic = renderSettings.showEcliptic;
  const renderShowMilkyWay = renderSettings.showMilkyWay;
  const renderShowVisibleSky = renderSettings.showVisibleSky;
  const renderShowVisibleSkyTimeWindow = renderSettings.showVisibleSkyTimeWindow;
  const renderShowStarNames = renderSettings.showStarNames;

  const hidePosterRenderNoticeSoon = () => {
    if (renderNoticeTimerRef.current !== null) {
      clearTimeout(renderNoticeTimerRef.current);
    }

    renderNoticeTimerRef.current = window.setTimeout(() => {
      renderNoticeTimerRef.current = null;
      setIsPosterRendering(false);
    }, 240);
  };

  const schedulePosterUpdate = (updateControls, updateRenderSettings) => {
    updateControls();

    if (renderNoticeTimerRef.current !== null) {
      clearTimeout(renderNoticeTimerRef.current);
      renderNoticeTimerRef.current = null;
    }
    if (renderNoticeFrameRef.current !== null) {
      cancelAnimationFrame(renderNoticeFrameRef.current);
    }

    setPosterRenderMessage(uiText.updatingPoster);
    setIsPosterRendering(true);

    renderNoticeFrameRef.current = requestAnimationFrame(() => {
      renderNoticeFrameRef.current = requestAnimationFrame(() => {
        renderNoticeFrameRef.current = null;
        startPosterTransition(() => {
          setRenderSettings((current) => (
            typeof updateRenderSettings === 'function'
              ? updateRenderSettings(current)
              : { ...current, ...updateRenderSettings }
          ));
        });
      });
    });
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('hl', labelLanguageMode);
    window.history.replaceState(null, '', url);
  }, [labelLanguageMode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentPage === 'poster') {
      url.searchParams.delete('page');
    } else {
      url.searchParams.set('page', currentPage);
    }
    window.history.replaceState(null, '', url);
  }, [currentPage]);

  useEffect(() => () => {
    if (renderNoticeTimerRef.current !== null) {
      clearTimeout(renderNoticeTimerRef.current);
    }
    if (renderNoticeFrameRef.current !== null) {
      cancelAnimationFrame(renderNoticeFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('./workers/sphereWorker.js', import.meta.url), { type: 'module' });
    sphereWorkerRef.current = worker;

    worker.onmessage = (event) => {
      const payload = event.data;
      if (payload.requestId !== sphereRequestIdRef.current) return;

      if (payload.type === 'spheres-computed') {
        setSphereRenderData(payload.spheres);
        hidePosterRenderNoticeSoon();
      } else if (payload.type === 'spheres-error') {
        console.error('Sphere worker failed:', payload.message);
        hidePosterRenderNoticeSoon();
      }
    };

    return () => {
      worker.terminate();
      sphereWorkerRef.current = null;
    };
  }, []);

  // --- Fetch Data ---
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Fetch JSON files compiled by ingest script
        const basePath = import.meta.env.BASE_URL || '/';
        const [starsRes, westernRes, westernStRes, chineseRes, boundariesRes, lineArtRes] = await Promise.all([
          fetch(`${basePath}data/stars.normalized.json`).then(r => r.json()),
          fetch(`${basePath}data/constellations.western.json`).then(r => r.json()),
          fetch(`${basePath}data/constellations.western_st.json`).then(r => r.json()),
          fetch(`${basePath}data/constellations.chinese.json`).then(r => r.json()),
          fetch(`${basePath}data/boundaries.json`).then(r => r.json()),
          fetch(`${basePath}data/noirlab-lineart.json`)
            .then(r => r.ok ? r.json() : { constellations: {} })
            .catch(() => ({ constellations: {} })),
        ]);

        setStars(starsRes);
        setWesternConstellations(westernRes);
        setWesternStConstellations(westernStRes);
        setChineseConstellations(chineseRes);
        setBoundaries(boundariesRes);
        setConstellationLineArt(lineArtRes.constellations || {});
        setLoading(false);
      } catch (err) {
        console.error("Failed to load astronomical data:", err);
        setError('load_failed');
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // --- Helper: Toast Notification ---
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  // --- Active Theme ---
  const controlTheme = useMemo(() => THEMES[themeId] || THEMES.classic_navy, [themeId]);
  const controlHasTransparentPaper = transparentBackground || controlTheme.paperTransparent;
  const activeTheme = useMemo(() => THEMES[renderThemeId] || THEMES.classic_navy, [renderThemeId]);
  const activeTypography = useMemo(() => ({
    ...DEFAULT_TYPOGRAPHY,
    ...(activeTheme.typography || {}),
  }), [activeTheme]);
  const hasTransparentPaper = renderTransparentBackground || activeTheme.paperTransparent;
  const posterBackgroundColor = hasTransparentPaper ? 'none' : activeTheme.posterBg;
  const sphereBackgroundColor = hasTransparentPaper ? 'none' : activeTheme.background;

  // --- Fast Lookup Dictionary for Stars ---
  const starsMap = useMemo(() => {
    const map = new Map();
    for (const star of stars) {
      map.set(star.hip, star);
    }
    return map;
  }, [stars]);

  const selected3dConstellation = useMemo(() => (
    westernConstellations.find((constellation) => constellation.abbr === modelSettings.constellationAbbr) ||
    westernConstellations.find((constellation) => constellation.abbr === DEFAULT_3D_MODEL_SETTINGS.constellationAbbr) ||
    westernConstellations[0]
  ), [westernConstellations, modelSettings.constellationAbbr]);

  useEffect(() => {
    if (!selected3dConstellation) return;
    modelDragStateRef.current = null;
    setModelView((current) => ({
      ...current,
      modelMatrix: DEFAULT_3D_VIEW.modelMatrix,
    }));
  }, [selected3dConstellation?.abbr]);

  const constellation3dModel = useMemo(() => (
    projectConstellationModel(selected3dConstellation, starsMap, modelSettings, constellationLineArt)
  ), [selected3dConstellation, starsMap, modelSettings, constellationLineArt]);

  // --- Centroid Calculation for Constellations (Spherical Average) ---
  const getConstellationCentroid = useCallback((edges) => {
    if (!edges || edges.length === 0) return null;
    let sumX = 0, sumY = 0, sumZ = 0;
    let count = 0;
    const visitedHips = new Set();

    for (const [hip1, hip2] of edges) {
      for (const hip of [hip1, hip2]) {
        if (visitedHips.has(hip)) continue;
        visitedHips.add(hip);
        const star = starsMap.get(hip);
        if (star) {
          const decRad = star.dec * Math.PI / 180;
          const raRad = star.ra * Math.PI / 180;
          sumX += Math.cos(decRad) * Math.cos(raRad);
          sumY += Math.cos(decRad) * Math.sin(raRad);
          sumZ += Math.sin(decRad);
          count++;
        }
      }
    }

    if (count === 0) return null;
    const avgX = sumX / count;
    const avgY = sumY / count;
    const avgZ = sumZ / count;

    const dec = Math.asin(avgZ) * 180 / Math.PI;
    let ra = Math.atan2(avgY, avgX) * 180 / Math.PI;
    if (ra < 0) ra += 360;

    return { ra, dec };
  }, [starsMap]);

  const renderWesternConstellations = useMemo(() => (
    renderWesternLineStyle === WESTERN_LINE_STYLE_SKY_TELESCOPE
      ? westernStConstellations
      : westernConstellations
  ), [renderWesternLineStyle, westernConstellations, westernStConstellations]);

  // --- Centroid Lookup for Constellations ---
  const westernCenters = useMemo(() => {
    const centers = {};
    for (const con of renderWesternConstellations) {
      const center = getConstellationCentroid(con.edges);
      if (center) centers[con.abbr] = center;
    }
    return centers;
  }, [renderWesternConstellations, getConstellationCentroid]);

  const chineseCenters = useMemo(() => {
    const centers = {};
    for (const asterism of chineseConstellations) {
      const center = getConstellationCentroid(asterism.edges);
      if (center) centers[asterism.id] = center;
    }
    return centers;
  }, [chineseConstellations, getConstellationCentroid]);

  const boundarySegments = useMemo(() => buildBoundarySegments(boundaries), [boundaries]);
  const boundaryColorMap = useMemo(() => (
    colorBoundaryGraph(boundaries, Math.min(4, CONSTELLATION_FILL_PALETTE.length))
  ), [boundaries]);

  const constellationStarHips = useMemo(() => {
    const hips = new Set();
    if (renderShowWesternLines) {
      for (const con of renderWesternConstellations) {
        for (const [hip1, hip2] of con.edges) {
          hips.add(hip1);
          hips.add(hip2);
        }
      }
    }
    if (renderShowChineseLines) {
      for (const asterism of chineseConstellations) {
        for (const [hip1, hip2] of asterism.edges) {
          hips.add(hip1);
          hips.add(hip2);
        }
      }
    }
    return hips;
  }, [renderWesternConstellations, chineseConstellations, renderShowWesternLines, renderShowChineseLines]);

  // --- Top Brightest Stars list for Poster Table ---
  const brightestStars = useMemo(() => {
    if (stars.length === 0) return [];
    // Sort all stars by magnitude ascending (brightest first)
    // Filter to only include stars that have names
    return [...stars]
      .filter(s => s.nameEn || s.nameZh)
      .sort((a, b) => a.mag - b.mag)
      .slice(0, 8);
  }, [stars]);

  // --- Formatting Helpers for Catalog Table ---
  const formatRA = (ra) => {
    const hoursFloat = ra / 15;
    const hours = Math.floor(hoursFloat);
    const minutes = Math.floor((hoursFloat - hours) * 60);
    return `${hours.toString().padStart(2, '0')}h${minutes.toString().padStart(2, '0')}m`;
  };

  const formatDec = (dec) => {
    const sign = dec >= 0 ? '+' : '-';
    const absDec = Math.abs(dec);
    const degrees = Math.floor(absDec);
    const minutes = Math.floor((absDec - degrees) * 60);
    return `${sign}${degrees.toString().padStart(2, '0')}°${minutes.toString().padStart(2, '0')}'`;
  };

  const formatSignedDegree = (value, positiveSuffix, negativeSuffix) => (
    `${Math.abs(value).toFixed(1)}°${value >= 0 ? positiveSuffix : negativeSuffix}`
  );

  const getVisibleSkyParameterText = () => {
    const lat = formatSignedDegree(renderSettings.observerLatitude, 'N', 'S');
    const lon = formatSignedDegree(renderSettings.observerLongitude, 'E', 'W');
    const timeText = renderShowVisibleSkyTimeWindow
      ? getVisibleSkyTimeRangeText()
      : getVisibleSkyHourText();
    return getLocalizedText(
      `肉眼可见天空: 纬度 ${lat}, 经度 ${lon}, 本地时间 ${timeText} 在地平线以上的星空区域。`,
      `Visible sky: sky above the horizon at Lat ${lat}, Lon ${lon}, Local time ${timeText}.`,
      'en-first'
    );
  };

  const getLocalizedText = (zh, en, order = 'zh-first') => {
    if (renderLabelLanguageMode === "zh") return zh || en || "";
    if (renderLabelLanguageMode === "en" || renderLabelLanguageMode === "both") return en || zh || "";
    const primary = order === 'en-first' ? en : zh;
    const secondary = order === 'en-first' ? zh : en;
    return [primary, secondary].filter(Boolean).join(' / ');
  };

  const getSpectralClass = (star) => (
    star.colorIdx < -0.1 ? 'O/B' :
    star.colorIdx < 0.3 ? 'A' :
    star.colorIdx < 0.5 ? 'F' :
    star.colorIdx < 0.8 ? 'G' :
    star.colorIdx < 1.3 ? 'K' : 'M'
  );

  const formatDateHour = (date) => (
    `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:00`
  );

  const getVisibleSkyHourText = () => (
    formatDateHour(new Date(renderSettings.observerTimestampMs))
  );

  const getVisibleSkyTimeRangeText = () => {
    const center = new Date(renderSettings.observerTimestampMs);
    const start = new Date(center.getTime() - 3 * 60 * 60 * 1000);
    const end = new Date(center.getTime() + 3 * 60 * 60 * 1000);
    return `${formatDateHour(start)}-${formatDateHour(end)}`;
  };

  const estimateSvgTextWidth = (text, fontSize) => {
    let width = 0;
    for (const char of text) {
      if (/[\u4e00-\u9fff]/.test(char)) width += fontSize;
      else if (/[A-Z0-9]/.test(char)) width += fontSize * 0.62;
      else if (/[a-z]/.test(char)) width += fontSize * 0.55;
      else if (/\s/.test(char)) width += fontSize * 0.35;
      else width += fontSize * 0.5;
    }
    return width;
  };

  const wrapSvgText = (text, maxWidth, fontSize) => {
    if (!maxWidth) return [text];
    const hasWhitespace = /\s/.test(text);
    const tokens = hasWhitespace ? text.split(/(\s+)/).filter(Boolean) : [...text];
    const lines = [];
    let currentLine = '';

    for (const token of tokens) {
      const nextLine = currentLine ? `${currentLine}${token}` : token;
      if (currentLine && estimateSvgTextWidth(nextLine, fontSize) > maxWidth) {
        lines.push(currentLine.trimEnd());
        currentLine = token.trimStart();
      } else {
        currentLine = nextLine;
      }
    }

    if (currentLine) lines.push(currentLine.trimEnd());
    return lines;
  };

  const renderMapLegend = ({ keyPrefix, starSpacing = 45, lineColumnX = 195, lineRowGap = 15, titleLetterSpacing = 1.5 }) => {
    const lineLegendItems = [
      {
        key: 'equator',
        label: getLocalizedText('天球赤道', 'Celestial Equator', 'en-first'),
        sample: <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.equator.color} strokeWidth="1.2" strokeDasharray={activeTheme.equator.dash} />,
        column: 0,
        row: 0,
      },
      {
        key: 'ecliptic',
        label: getLocalizedText('黄道轨道', 'Ecliptic Path', 'en-first'),
        sample: <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.ecliptic.color} strokeWidth="1.2" strokeDasharray={activeTheme.ecliptic.dash} />,
        column: 0,
        row: 1,
      },
      {
        key: 'milky-way',
        label: getLocalizedText('银道带', 'Milky Way Plane', 'en-first'),
        sample: <rect x="0" y="-4" width="25" height="8" fill={activeTheme.galactic.fill} stroke={activeTheme.galactic.stroke} strokeWidth="0.8" strokeDasharray="2 3" />,
        column: 0,
        row: 2,
      },
      {
        key: 'constellation-line',
        label: getLocalizedText('星座连线', 'Constellation Line', 'en-first'),
        sample: <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.constellations.line} strokeWidth="1" opacity={activeTheme.constellations.lineOpacity} />,
        column: 1,
        row: 0,
      },
      {
        key: 'boundary',
        label: getLocalizedText('星座边界', 'IAU Boundary', 'en-first'),
        sample: <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.constellations.boundary} strokeWidth="0.8" strokeDasharray={activeTheme.constellations.boundaryDash} />,
        column: 1,
        row: 1,
      },
      {
        key: 'chinese-asterism',
        label: getLocalizedText('星官连线', 'Chinese Asterism', 'en-first'),
        sample: <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.chinese.line} strokeWidth="1" opacity={activeTheme.chinese.lineOpacity} />,
        column: 1,
        row: 2,
      },
    ];

    return (
      <g>
        <text x="0" y="5" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing={titleLetterSpacing}>
          {getLocalizedText('星图图例', 'MAP LEGEND', 'en-first')}
        </text>
        <g transform="translate(0, 26)">
          {[1.0, 2.0, 3.0, 4.0, 5.0, 6.0].map((mag, i) => {
            const r = Math.max(0.5, 4.5 - 0.6 * mag);
            const xOffset = i * starSpacing;
            const isRetro = activeTheme.stars.retroRings;

            return (
              <g key={`${keyPrefix}-leg-star-${i}`} transform={`translate(${xOffset}, 0)`}>
                {isRetro ? (
                  <g>
                    <circle cx="0" cy="0" r={Math.max(0.5, 2.0 - 0.25 * mag)} fill="#201e1a" />
                    <circle cx="0" cy="0" r={Math.max(1.2, 5.0 - 0.65 * mag)} fill="none" stroke="#d4af37" strokeWidth="0.8" />
                  </g>
                ) : (
                  <circle cx="0" cy="0" r={r} fill={getStarColorHSL(0.2, renderThemeId)} stroke={activeTheme.stars.stroke || 'none'} strokeWidth={activeTheme.stars.strokeWidth || 0} />
                )}
                <text x="0" y="16" textAnchor="middle" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>{mag.toFixed(0)}m</text>
              </g>
            );
          })}
        </g>
        <g transform="translate(0, 62)" fontSize={activeTypography.legendBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
          {lineLegendItems.map((item) => (
            <g key={`${keyPrefix}-line-${item.key}`} transform={`translate(${item.column * lineColumnX}, ${item.row * lineRowGap})`}>
              {item.sample}
              <text x="35" y="3.5">{item.label}</text>
            </g>
          ))}
        </g>
      </g>
    );
  };

  const renderUsageGuide = ({ titleLetterSpacing = 1.5, maxTextWidth = null }) => {
    const bodyFontSize = activeTypography.legendSmall;
    const visibleSkyLines = renderShowVisibleSky
      ? wrapSvgText(getVisibleSkyParameterText(), maxTextWidth, bodyFontSize)
      : [];
    const sourceY = renderShowVisibleSky ? 71 + visibleSkyLines.length * 13 : 71;

    return (
      <g>
        <text x="0" y="5" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing={titleLetterSpacing}>
          {getLocalizedText('使用指南', 'USAGE GUIDE', 'en-first')}
        </text>
        <text x="0" y="28" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
          {getLocalizedText('赤经小时: 赤经以小时标示，24h 环绕天球一周。', 'RA Hours: right ascension is measured in hours; 24h completes 360 degrees.', 'en-first')}
        </text>
        <text x="0" y="41" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
          {getLocalizedText('北天: 以北天极为中心，北极星靠近图心。', 'Northern Sky: centered on the north celestial pole, near Polaris.', 'en-first')}
        </text>
        <text x="0" y="54" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
          {getLocalizedText('南天: 以南天极为中心展开。', 'Southern Sky: centered on the south celestial pole.', 'en-first')}
        </text>
        {visibleSkyLines.map((line, index) => (
          <text key={`usage-visible-sky-${index}`} x="0" y={67 + index * 13} fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
            {line}
          </text>
        ))}
        <a href="https://github.com/askman-dev/allsky-atlas" target="_blank" rel="noreferrer">
          <text x="0" y={sourceY} fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
            {getLocalizedText('开源项目：', 'Open source: ', 'en-first')}github.com/askman-dev/allsky-atlas
          </text>
        </a>
      </g>
    );
  };

  const renderBrightStarsTable = ({ keyPrefix, titleLetterSpacing = 1.5, headerY = 20, rowStartY = 33, rowGap = 11, columns = { mag: 140, ra: 180, dec: 240, sp: 290 } }) => (
    <g>
      <text x="0" y="5" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing={titleLetterSpacing}>
        {getLocalizedText('亮恒星星表', 'BRIGHT CELESTIAL BODIES', 'en-first')}
      </text>
      <g transform={`translate(0, ${headerY})`} fontSize={activeTypography.tableHeader} fontFamily={varFontPosterSans} fontWeight="600" fill={activeTheme.text.subtitle}>
        <text x="0" y="0">{getLocalizedText('恒星名称', 'STAR NAME', 'en-first')}</text>
        <text x={columns.mag} y="0">MAG</text>
        <text x={columns.ra} y="0">R.A.</text>
        <text x={columns.dec} y="0">DEC.</text>
        <text x={columns.sp} y="0">SP.</text>
      </g>
      {brightestStars.map((star, i) => {
        const y = rowStartY + i * rowGap;
        return (
          <g key={`${keyPrefix}-table-row-${i}`} transform={`translate(0, ${y})`} fontSize={activeTypography.tableBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
            <text x="0" y="0" fontWeight="500">{getLocalizedText(star.nameZh, star.nameEn)}</text>
            <text x={columns.mag} y="0">{star.mag.toFixed(2)}</text>
            <text x={columns.ra} y="0">{formatRA(star.ra)}</text>
            <text x={columns.dec} y="0">{formatDec(star.dec)}</text>
            <text x={columns.sp} y="0">{getSpectralClass(star)}</text>
          </g>
        );
      })}
    </g>
  );

  // --- Poster dimensions and radius of the main circular spheres ---
  const landscapeLayout = POSTER_LAYOUTS.landscape_dual;
  const portraitLayout = POSTER_LAYOUTS.portrait_single;
  const LANDSCAPE_R = landscapeLayout.sphereRadius;
  const PORTRAIT_R = portraitLayout.sphereRadius;

  useEffect(() => {
    const worker = sphereWorkerRef.current;
    if (!worker || stars.length === 0) return;

    const requestId = sphereRequestIdRef.current + 1;
    sphereRequestIdRef.current = requestId;
    setPosterRenderMessage(uiText.updatingPoster);
    setIsPosterRendering(true);

    const sphereRadius = renderPosterLayout === 'landscape_dual' ? LANDSCAPE_R : PORTRAIT_R;
    worker.postMessage({
      type: 'compute-spheres',
      requestId,
      settings: renderSettings,
      typography: activeTypography,
      stars,
      westernConstellations: renderWesternConstellations,
      chineseConstellations,
      boundaries,
      boundarySegments,
      boundaryColorMap,
      westernCenters,
      chineseCenters,
      constellationStarHips: [...constellationStarHips],
      spheres: [
        { key: `${renderPosterLayout}-north`, isNorth: true, sphereRadius },
        { key: `${renderPosterLayout}-south`, isNorth: false, sphereRadius },
      ],
    });
  }, [
    uiText.updatingPoster,
    renderSettings,
    activeTypography,
    stars,
    renderWesternConstellations,
    chineseConstellations,
    boundaries,
    boundarySegments,
    boundaryColorMap,
    westernCenters,
    chineseCenters,
    constellationStarHips,
    renderPosterLayout,
    LANDSCAPE_R,
    PORTRAIT_R,
  ]);

  const formatMagFilterValue = (value) => {
    if (value <= MAG_RANGE_MIN) return '0-';
    if (value >= MAG_RANGE_PLUS) return '6+';
    return `${Math.round(value)}`;
  };
  const getObserverRenderPatch = ({ latitude = observerLatitude, longitude = observerLongitude, month = observerMonth, hour = observerHour }) => {
    const dateParts = getCurrentDateParts();
    const clampedDay = Math.min(dateParts.day, getDaysInMonth(dateParts.year, month));
    return {
      observerLatitude: latitude,
      observerLongitude: longitude,
      observerMonth: month,
      observerDay: clampedDay,
      observerYear: dateParts.year,
      observerHour: hour,
      observerTimestampMs: getObserverTimestampMs({
        year: dateParts.year,
        month,
        day: clampedDay,
        hour,
      }),
    };
  };
  const getCityName = (city) => displayLanguage === 'zh' ? city.labelZh : city.label;
  const latitudePercent = (lat) => ((lat + 60) / 120) * 100;

  const updateObserverLatitude = (nextLatitude) => {
    schedulePosterUpdate(
      () => setObserverLatitude(nextLatitude),
      getObserverRenderPatch({ latitude: nextLatitude })
    );
  };

  const updateObserverCity = (city) => {
    schedulePosterUpdate(
      () => {
        setObserverLatitude(city.latitude);
        setObserverLongitude(city.longitude);
      },
      getObserverRenderPatch({ latitude: city.latitude, longitude: city.longitude })
    );
  };

  const updateObserverMonth = (nextMonth) => {
    schedulePosterUpdate(
      () => setObserverMonth(nextMonth),
      getObserverRenderPatch({ month: nextMonth })
    );
  };

  const updateObserverHour = (nextHour) => {
    schedulePosterUpdate(
      () => setObserverHour(nextHour),
      getObserverRenderPatch({ hour: nextHour })
    );
  };
  const isMagnitudeVisible = (star) => {
    const passesMin = renderMinMagLimit <= MAG_RANGE_MIN
      ? true
      : renderMinMagLimit >= MAG_RANGE_PLUS
        ? star.mag >= 6
        : star.mag >= renderMinMagLimit;
    const passesMax = renderMagLimit >= MAG_RANGE_PLUS ? true : star.mag <= renderMagLimit;
    return passesMin && passesMax;
  };
  const isStarVisible = (star) => constellationStarHips.has(star.hip) || isMagnitudeVisible(star);

  const updateMinMagLimit = (value) => {
    const nextMinMagLimit = Math.min(value, magLimit);
    schedulePosterUpdate(
      () => setMinMagLimit(nextMinMagLimit),
      { minMagLimit: nextMinMagLimit }
    );
  };

  const updateMagLimit = (value) => {
    const nextMagLimit = value;
    const nextMinMagLimit = Math.min(minMagLimit, nextMagLimit);
    schedulePosterUpdate(
      () => {
        setMagLimit(nextMagLimit);
        setMinMagLimit(nextMinMagLimit);
      },
      {
        magLimit: nextMagLimit,
        minMagLimit: nextMinMagLimit,
      }
    );
  };

  const magRangeStart = ((minMagLimit - MAG_RANGE_MIN) / (MAG_RANGE_MAX - MAG_RANGE_MIN)) * 100;
  const magRangeEnd = ((magLimit - MAG_RANGE_MIN) / (MAG_RANGE_MAX - MAG_RANGE_MIN)) * 100;

  const clampZoom = (value) => Math.max(0.45, Math.min(6, value));

  const applyPreviewTransform = () => {
    transformFrameRef.current = null;
    if (!posterMockupRef.current) return;
    const { x, y, scale } = transformRef.current;
    const translate = isPreviewInteractingRef.current
      ? `translate3d(${x}px, ${y}px, 0)`
      : `translate(${x}px, ${y}px)`;
    posterMockupRef.current.style.transform = `${translate} scale(${scale})`;
  };

  const schedulePreviewTransform = () => {
    if (transformFrameRef.current !== null) return;
    transformFrameRef.current = requestAnimationFrame(applyPreviewTransform);
  };

  const beginPreviewInteraction = () => {
    if (interactionEndTimerRef.current !== null) {
      clearTimeout(interactionEndTimerRef.current);
      interactionEndTimerRef.current = null;
    }

    if (isPreviewInteractingRef.current) return;
    isPreviewInteractingRef.current = true;
    if (posterMockupRef.current) {
      posterMockupRef.current.style.willChange = 'transform';
    }
    schedulePreviewTransform();
  };

  const endPreviewInteractionSoon = () => {
    if (interactionEndTimerRef.current !== null) {
      clearTimeout(interactionEndTimerRef.current);
    }

    interactionEndTimerRef.current = window.setTimeout(() => {
      interactionEndTimerRef.current = null;
      isPreviewInteractingRef.current = false;
      if (posterMockupRef.current) {
        posterMockupRef.current.style.willChange = '';
      }
      schedulePreviewTransform();
    }, 120);
  };

  const zoomPreviewAt = (clientX, clientY, nextScale) => {
    const previewRect = previewAreaRef.current?.getBoundingClientRect();
    if (!previewRect) return;

    const current = transformRef.current;
    const clampedScale = clampZoom(nextScale);
    const scaleRatio = clampedScale / current.scale;
    const centerX = previewRect.left + previewRect.width / 2;
    const centerY = previewRect.top + previewRect.height / 2;

    transformRef.current = {
      scale: clampedScale,
      x: clientX - centerX - (clientX - centerX - current.x) * scaleRatio,
      y: clientY - centerY - (clientY - centerY - current.y) * scaleRatio,
    };
    schedulePreviewTransform();
  };

  const getPinchMetrics = (pointers) => {
    const [a, b] = pointers;
    const centerX = (a.clientX + b.clientX) / 2;
    const centerY = (a.clientY + b.clientY) / 2;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    return { centerX, centerY, distance };
  };

  useEffect(() => {
    const previewArea = previewAreaRef.current;
    if (!previewArea) return undefined;
    const handledGestureEvents = new WeakSet();

    const writeLastInputPoint = (clientX, clientY) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      if (lastInputPointRef.current) {
        lastInputPointRef.current.clientX = clientX;
        lastInputPointRef.current.clientY = clientY;
        return;
      }

      lastInputPointRef.current = { clientX, clientY };
    };

    const updateLastInputPoint = (event) => {
      writeLastInputPoint(event.clientX, event.clientY);
    };

    const getLatestPointerPoint = (event) => {
      const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
      const latest = events?.length ? events[events.length - 1] : event;
      return {
        clientX: latest.clientX,
        clientY: latest.clientY,
      };
    };

    const getFirstTwoPointers = () => {
      const iterator = activePointersRef.current.entries();
      const first = iterator.next();
      if (first.done) return null;
      const second = iterator.next();
      if (second.done) return null;
      return [
        { pointerId: first.value[0], ...first.value[1] },
        { pointerId: second.value[0], ...second.value[1] },
      ];
    };

    const resetDragFromRemainingPointer = () => {
      const next = activePointersRef.current.entries().next();
      if (next.done) {
        dragStateRef.current = null;
        return;
      }

      const [pointerId, point] = next.value;
      dragStateRef.current = {
        pointerId,
        startX: point.clientX,
        startY: point.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
    };

    const startPinchFromActivePointers = () => {
      const pointers = getFirstTwoPointers();
      if (!pointers) return;

      const pinch = getPinchMetrics(pointers);
      pinchStateRef.current = {
        ...pinch,
        originScale: transformRef.current.scale,
      };
      dragStateRef.current = null;
    };

    const handleNativePointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target?.closest?.('.preview-toolbar, button, input, select, textarea, label, a')) {
        return;
      }

      beginPreviewInteraction();
      const point = getLatestPointerPoint(event);
      writeLastInputPoint(point.clientX, point.clientY);
      activePointersRef.current.set(event.pointerId, point);

      if (typeof previewArea.setPointerCapture === 'function') {
        try {
          previewArea.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture may fail if the pointer was already released by the browser.
        }
      }

      if (activePointersRef.current.size >= 2) {
        startPinchFromActivePointers();
        return;
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: point.clientX,
        startY: point.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
      pinchStateRef.current = null;
    };

    const handleNativePointerMove = (event) => {
      const activePoint = activePointersRef.current.get(event.pointerId);
      if (!activePoint) {
        updateLastInputPoint(event);
        return;
      }

      const point = getLatestPointerPoint(event);
      activePoint.clientX = point.clientX;
      activePoint.clientY = point.clientY;
      writeLastInputPoint(point.clientX, point.clientY);

      if (activePointersRef.current.size >= 2) {
        if (!pinchStateRef.current) startPinchFromActivePointers();
        const pointers = getFirstTwoPointers();
        if (!pointers || !pinchStateRef.current) return;

        const pinch = getPinchMetrics(pointers);
        if (pinch.distance > 0) {
          const nextScale = pinchStateRef.current.originScale * (pinch.distance / pinchStateRef.current.distance);
          zoomPreviewAt(pinch.centerX, pinch.centerY, nextScale);
        }
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      transformRef.current.x = dragState.originX + point.clientX - dragState.startX;
      transformRef.current.y = dragState.originY + point.clientY - dragState.startY;
      schedulePreviewTransform();
    };

    const handleNativePointerUp = (event) => {
      activePointersRef.current.delete(event.pointerId);

      if (typeof previewArea.releasePointerCapture === 'function') {
        try {
          if (previewArea.hasPointerCapture?.(event.pointerId)) {
            previewArea.releasePointerCapture(event.pointerId);
          }
        } catch {
          // The browser may already have cleared capture on cancel/up.
        }
      }

      pinchStateRef.current = null;
      if (activePointersRef.current.size === 1) {
        resetDragFromRemainingPointer();
        return;
      }

      dragStateRef.current = null;
      endPreviewInteractionSoon();
    };

    const clearNativePointers = () => {
      activePointersRef.current.clear();
      dragStateRef.current = null;
      pinchStateRef.current = null;
      endPreviewInteractionSoon();
    };

    const getEventPoint = (event) => {
      const hasEventPoint =
        Number.isFinite(event.clientX) &&
        Number.isFinite(event.clientY) &&
        (event.clientX !== 0 || event.clientY !== 0);

      if (hasEventPoint) {
        return {
          clientX: event.clientX,
          clientY: event.clientY,
          source: 'event',
        };
      }

      if (lastInputPointRef.current) {
        return {
          ...lastInputPointRef.current,
          source: 'last-pointer',
        };
      }

      const previewRect = previewArea.getBoundingClientRect();
      return {
        clientX: previewRect.left + previewRect.width / 2,
        clientY: previewRect.top + previewRect.height / 2,
        source: 'preview-center',
      };
    };

    const isPointInPreview = ({ clientX, clientY }) => {
      const previewRect = previewArea.getBoundingClientRect();
      return (
        clientX >= previewRect.left &&
        clientX <= previewRect.right &&
        clientY >= previewRect.top &&
        clientY <= previewRect.bottom
      );
    };

    const recordInputProbe = (event, phase, point, inPreview) => {
      if (!inputDebugEnabled) return;

      setInputProbe({
        phase,
        type: event.type,
        ctrlKey: Boolean(event.ctrlKey),
        cancelable: Boolean(event.cancelable),
        defaultPrevented: Boolean(event.defaultPrevented),
        inPreview: Boolean(inPreview),
        pointSource: point?.source || 'none',
        clientX: Math.round(point?.clientX ?? 0),
        clientY: Math.round(point?.clientY ?? 0),
        deltaX: Math.round(event.deltaX ?? 0),
        deltaY: Math.round(event.deltaY ?? 0),
        scale: Number.isFinite(event.scale) ? event.scale.toFixed(3) : '',
        visualScale: window.visualViewport?.scale?.toFixed(3) || '1.000',
        target: [
          event.target?.tagName?.toLowerCase(),
          event.target?.className && typeof event.target.className === 'string' ? `.${event.target.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : '',
        ].filter(Boolean).join(''),
        time: new Date().toLocaleTimeString(),
      });
    };

    const handleGlobalGestureStart = (event) => {
      if (handledGestureEvents.has(event)) return;
      handledGestureEvents.add(event);

      const point = getEventPoint(event);
      const isInPreview = isPointInPreview(point);
      if (event.cancelable) event.preventDefault();
      recordInputProbe(event, 'gesture-start', point, isInPreview);

      if (!isInPreview) {
        gestureStateRef.current = null;
        return;
      }

      beginPreviewInteraction();
      gestureStateRef.current = {
        originScale: transformRef.current.scale,
      };
    };

    const handleGlobalGestureChange = (event) => {
      if (handledGestureEvents.has(event)) return;
      handledGestureEvents.add(event);

      const point = getEventPoint(event);
      const isInPreview = isPointInPreview(point);
      if (event.cancelable) event.preventDefault();
      recordInputProbe(event, 'gesture-change', point, isInPreview);

      if (!isInPreview) {
        gestureStateRef.current = null;
        return;
      }

      const originScale = gestureStateRef.current?.originScale || transformRef.current.scale;
      zoomPreviewAt(point.clientX, point.clientY, originScale * event.scale);
    };

    const handleGlobalGestureEnd = (event) => {
      if (handledGestureEvents.has(event)) return;
      handledGestureEvents.add(event);

      if (event.cancelable) event.preventDefault();
      gestureStateRef.current = null;
      const point = getEventPoint(event);
      recordInputProbe(event, 'gesture-end', point, isPointInPreview(point));
      endPreviewInteractionSoon();
    };

    previewArea.addEventListener('pointerdown', handleNativePointerDown, { capture: true, passive: true });
    window.addEventListener('pointermove', handleNativePointerMove, { capture: true, passive: true });
    window.addEventListener('pointerrawupdate', handleNativePointerMove, { capture: true, passive: true });
    window.addEventListener('pointerup', handleNativePointerUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', handleNativePointerUp, { capture: true, passive: true });
    window.addEventListener('blur', clearNativePointers);
    window.addEventListener('mousemove', updateLastInputPoint, { capture: true, passive: true });

    const nativeZoomTargets = [
      window,
      document,
      document.documentElement,
      document.body,
    ].filter(Boolean);

    for (const target of nativeZoomTargets) {
      target.addEventListener('gesturestart', handleGlobalGestureStart, { capture: true, passive: false });
      target.addEventListener('gesturechange', handleGlobalGestureChange, { capture: true, passive: false });
      target.addEventListener('gestureend', handleGlobalGestureEnd, { capture: true, passive: false });
    }

    return () => {
      previewArea.removeEventListener('pointerdown', handleNativePointerDown, { capture: true });
      window.removeEventListener('pointermove', handleNativePointerMove, { capture: true });
      window.removeEventListener('pointerrawupdate', handleNativePointerMove, { capture: true });
      window.removeEventListener('pointerup', handleNativePointerUp, { capture: true });
      window.removeEventListener('pointercancel', handleNativePointerUp, { capture: true });
      window.removeEventListener('blur', clearNativePointers);
      window.removeEventListener('mousemove', updateLastInputPoint, { capture: true });

      for (const target of nativeZoomTargets) {
        target.removeEventListener('gesturestart', handleGlobalGestureStart, { capture: true });
        target.removeEventListener('gesturechange', handleGlobalGestureChange, { capture: true });
        target.removeEventListener('gestureend', handleGlobalGestureEnd, { capture: true });
      }
      if (transformFrameRef.current !== null) {
        cancelAnimationFrame(transformFrameRef.current);
      }
      if (interactionEndTimerRef.current !== null) {
        clearTimeout(interactionEndTimerRef.current);
        interactionEndTimerRef.current = null;
      }
    };
  }, [inputDebugEnabled, loading, error]);

  const handlePreviewWheelCapture = (event) => {
    const nativeEvent = event.nativeEvent || event;
    const previewArea = previewAreaRef.current;
    if (!previewArea) return;

    if (Number.isFinite(nativeEvent.clientX) && Number.isFinite(nativeEvent.clientY)) {
      lastInputPointRef.current = {
        clientX: nativeEvent.clientX,
        clientY: nativeEvent.clientY,
      };
    }

    const previewRect = previewArea.getBoundingClientRect();
    const point =
      Number.isFinite(nativeEvent.clientX) &&
      Number.isFinite(nativeEvent.clientY) &&
      (nativeEvent.clientX !== 0 || nativeEvent.clientY !== 0)
        ? { clientX: nativeEvent.clientX, clientY: nativeEvent.clientY, source: 'event' }
        : lastInputPointRef.current
          ? { ...lastInputPointRef.current, source: 'last-pointer' }
          : {
              clientX: previewRect.left + previewRect.width / 2,
              clientY: previewRect.top + previewRect.height / 2,
              source: 'preview-center',
            };

    const isInPreview =
      point.clientX >= previewRect.left &&
      point.clientX <= previewRect.right &&
      point.clientY >= previewRect.top &&
      point.clientY <= previewRect.bottom;
    if (!isInPreview) return;

    const isHorizontalSwipe = Math.abs(nativeEvent.deltaX) > Math.abs(nativeEvent.deltaY);
    if (!nativeEvent.ctrlKey && isHorizontalSwipe) return;

    beginPreviewInteraction();
    if (inputDebugEnabled) {
      setInputProbe({
        phase: 'preview-wheel-react',
        type: nativeEvent.type,
        ctrlKey: Boolean(nativeEvent.ctrlKey),
        cancelable: Boolean(nativeEvent.cancelable),
        defaultPrevented: Boolean(nativeEvent.defaultPrevented),
        inPreview: true,
        pointSource: point.source,
        clientX: Math.round(point.clientX),
        clientY: Math.round(point.clientY),
        deltaX: Math.round(nativeEvent.deltaX ?? 0),
        deltaY: Math.round(nativeEvent.deltaY ?? 0),
        scale: '',
        visualScale: window.visualViewport?.scale?.toFixed(3) || '1.000',
        target: [
          nativeEvent.target?.tagName?.toLowerCase(),
          nativeEvent.target?.className && typeof nativeEvent.target.className === 'string'
            ? `.${nativeEvent.target.className.split(' ').filter(Boolean).slice(0, 2).join('.')}`
            : '',
        ].filter(Boolean).join(''),
        time: new Date().toLocaleTimeString(),
      });
    }

    const zoomDelta = Math.exp(-nativeEvent.deltaY * 0.0012);
    zoomPreviewAt(point.clientX, point.clientY, transformRef.current.scale * zoomDelta);
    endPreviewInteractionSoon();
  };

  const setPreviewTransform = (nextTransform) => {
    transformRef.current = {
      scale: clampZoom(nextTransform.scale),
      x: nextTransform.x,
      y: nextTransform.y,
    };
    schedulePreviewTransform();
  };

  const fitPreviewToWindow = () => {
    setPreviewTransform({ scale: 1, x: 0, y: 0 });
  };

  const zoomPreviewToActualSize = () => {
    const stage = posterMockupRef.current;
    if (!stage) return;

    const visibleMockup = stage.querySelector('.poster-mockup:not(.is-hidden)');
    if (!visibleMockup) return;

    const layout = renderPosterLayout === 'landscape_dual'
      ? { widthMm: 297 }
      : { widthMm: 210 };
    const targetCssWidth = layout.widthMm * CSS_PX_PER_MM;
    const layoutWidth = visibleMockup.offsetWidth || visibleMockup.getBoundingClientRect().width;
    if (!layoutWidth) return;

    setPreviewTransform({
      scale: targetCssWidth / layoutWidth,
      x: 0,
      y: 0,
    });
  };

  // --- Render Components inside SVG for a single Sphere ---
  const renderSphere = (isNorth, sphereRadius = POSTER_LAYOUTS.landscape_dual.sphereRadius, clipPrefix = '') => {
    const clipId = `${clipPrefix}${isNorth ? "north-clip" : "south-clip"}`;
    const sphereKey = `${renderPosterLayout}-${isNorth ? 'north' : 'south'}`;
    const sphereData = sphereRenderData[sphereKey];

    if (!sphereData || sphereData.sphereRadius !== sphereRadius) {
      return (
        <g>
          <defs>
            <clipPath id={clipId}>
              <circle cx="0" cy="0" r={sphereRadius} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <circle cx="0" cy="0" r={sphereRadius} fill={sphereBackgroundColor} />
          </g>
          <circle cx="0" cy="0" r={sphereRadius} fill="none" stroke={activeTheme.border} strokeWidth="1.5" />
          <circle cx="0" cy="0" r={sphereRadius + 8} fill="none" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.6" />
        </g>
      );
    }

    const renderedWorkerSphere = (
      <g>
        <defs>
          <clipPath id={clipId}>
            <circle cx="0" cy="0" r={sphereRadius} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <circle cx="0" cy="0" r={sphereRadius} fill={sphereBackgroundColor} />

          {renderShowVisibleSky && sphereData.visibleSkyOverlay?.visibleAreaPath && (
            <path
              d={sphereData.visibleSkyOverlay.visibleAreaPath}
              fill={activeTheme.ecliptic.color}
              opacity="0.14"
              fillRule="nonzero"
            />
          )}

          {renderShowVisibleSky && sphereData.visibleSkyOverlay?.horizonPaths?.length > 0 && (
            <g>
              {sphereData.visibleSkyOverlay.horizonPaths.map((path, index) => (
                <path
                  key={`visible-horizon-${index}`}
                  d={path}
                  fill="none"
                  stroke={activeTheme.ecliptic.color}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.9"
                />
              ))}
            </g>
          )}

          {renderShowMilkyWay && (
            <g opacity="0.8">
              {sphereData.mwOuterPath && <path d={sphereData.mwOuterPath} fill={activeTheme.galactic.fill} />}
              {sphereData.mwInnerPath && <path d={sphereData.mwInnerPath} fill={activeTheme.galactic.fill} opacity="0.7" />}
              {sphereData.mwOuterPath && <path d={sphereData.mwOuterPath} fill="none" stroke={activeTheme.galactic.stroke} strokeWidth="0.8" strokeDasharray="3 6" />}
            </g>
          )}

          {renderShowGrid && sphereData.grid.decCircles.map((circle, idx) => (
            <path
              key={`dec-c-${idx}`}
              d={circle.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')}
              fill="none"
              stroke={activeTheme.grid.color}
              strokeWidth="0.5"
              strokeDasharray="2 4"
            />
          ))}

          {renderShowGrid && sphereData.grid.raRadials.map((radial, idx) => (
            <path
              key={`ra-r-${idx}`}
              d={radial.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')}
              fill="none"
              stroke={activeTheme.grid.color}
              strokeWidth="0.5"
              strokeDasharray="2 4"
            />
          ))}

          {renderShowEquator && sphereData.equatorPath && (
            <path
              d={sphereData.equatorPath}
              fill="none"
              stroke={activeTheme.equator.color}
              strokeWidth="1"
              strokeDasharray={activeTheme.equator.dash}
              opacity={activeTheme.equator.opacity}
            />
          )}

          {renderShowEcliptic && sphereData.eclipticPath && (
            <path
              d={sphereData.eclipticPath}
              fill="none"
              stroke={activeTheme.ecliptic.color}
              strokeWidth="1.2"
              strokeDasharray={activeTheme.ecliptic.dash}
              opacity={activeTheme.ecliptic.opacity}
            />
          )}

          {sphereData.boundaryFillRegions.length > 0 && (
            <g opacity="0.18">
              {sphereData.boundaryFillRegions.map((region) => (
                <g
                  key={`boundary-fill-${isNorth ? 'n' : 's'}-${region.abbr}`}
                  fill={CONSTELLATION_FILL_PALETTE[region.colorIndex % CONSTELLATION_FILL_PALETTE.length]}
                >
                  {region.paths.map((path, index) => (
                    <path key={`boundary-fill-strip-${region.abbr}-${index}`} d={path} />
                  ))}
                </g>
              ))}
            </g>
          )}

          {renderShowWesternBoundaries && sphereData.boundaryPath && (
            <path
              d={sphereData.boundaryPath}
              fill="none"
              stroke={activeTheme.constellations.boundary}
              strokeWidth="0.55"
              strokeDasharray={activeTheme.constellations.boundaryDash}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.7"
            />
          )}

          {renderShowChineseLines && sphereData.chineseLines.map((line) => (
            <line
              key={line.id}
              x1={line.x1.toFixed(2)}
              y1={line.y1.toFixed(2)}
              x2={line.x2.toFixed(2)}
              y2={line.y2.toFixed(2)}
              stroke={activeTheme.chinese.line}
              strokeWidth="0.8"
              opacity={activeTheme.chinese.lineOpacity}
            />
          ))}

          {renderShowWesternLines && sphereData.westernLines.map((line) => (
            <line
              key={line.id}
              x1={line.x1.toFixed(2)}
              y1={line.y1.toFixed(2)}
              x2={line.x2.toFixed(2)}
              y2={line.y2.toFixed(2)}
              stroke={activeTheme.constellations.line}
              strokeWidth="0.8"
              opacity={activeTheme.constellations.lineOpacity}
            />
          ))}

          {sphereData.starPoints.map((s, idx) => {
            const color = getStarColorHSL(s.colorIdx, renderThemeId);
            const isRetro = activeTheme.stars.retroRings;
            if (isRetro) {
              const innerRadius = Math.max(0.5, 2.0 - 0.25 * s.mag);
              const outerRadius = Math.max(1.2, 5.0 - 0.65 * s.mag);
              return (
                <g key={`star-dots-${idx}`} opacity={s.mag > 5 ? 0.6 : 1.0}>
                  <circle cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={innerRadius.toFixed(2)} fill="#201e1a" />
                  <circle cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={outerRadius.toFixed(2)} fill="none" stroke={color} strokeWidth="0.9" />
                </g>
              );
            }

            const showGlow = activeTheme.stars.glow && s.mag <= 2.5;
            const opacity = Math.max(0.3, Math.min(1.0, 1.1 - 0.12 * (s.mag - 1)));
            return (
              <g key={`star-dots-${idx}`}>
                {showGlow && (
                  <circle
                    cx={s.x.toFixed(2)}
                    cy={s.y.toFixed(2)}
                    r={(s.r * 2.2).toFixed(2)}
                    fill={color}
                    opacity="0.18"
                    filter="blur(1px)"
                  />
                )}
                <circle
                  cx={s.x.toFixed(2)}
                  cy={s.y.toFixed(2)}
                  r={s.r.toFixed(2)}
                  fill={color}
                  opacity={opacity}
                  stroke={activeTheme.stars.stroke || 'none'}
                  strokeWidth={activeTheme.stars.strokeWidth || 0}
                />
              </g>
            );
          })}

          {sphereData.labels.map((lbl, idx) => {
            const fontColor = lbl.type === 'constellation'
              ? activeTheme.constellations.label
              : lbl.type === 'chinese_asterism'
                ? activeTheme.chinese.label
                : activeTheme.text.body;

            const isChinese = lbl.type === 'chinese_asterism' || (lbl.type === 'star' && renderShowChineseLines);
            const fontF = isChinese
              ? (renderFontFamily === "serif" ? "'Noto Serif SC', serif" : "'Noto Sans SC', sans-serif")
              : (renderFontFamily === "serif" ? varFontPosterSerif : varFontPosterSans);
            const weight = lbl.type === 'constellation' || lbl.type === 'chinese_asterism' ? 'bold' : 'normal';

            return (
              <text
                key={`lbl-${idx}`}
                x={lbl.renderX.toFixed(2)}
                y={lbl.renderY.toFixed(2)}
                textAnchor={lbl.anchor}
                fill={fontColor}
                fontSize={lbl.fontSize}
                fontFamily={fontF}
                fontWeight={weight}
                opacity={lbl.type === 'star' ? 0.85 : 0.9}
              >
                {lbl.text}
              </text>
            );
          })}
        </g>

        <circle cx="0" cy="0" r={sphereRadius} fill="none" stroke={activeTheme.border} strokeWidth="1.5" />
        <circle cx="0" cy="0" r={sphereRadius + 8} fill="none" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.6" />

        {sphereData.ticks.map((t) => (
          <g key={t.id}>
            <line
              x1={t.x1.toFixed(2)}
              y1={t.y1.toFixed(2)}
              x2={t.x2.toFixed(2)}
              y2={t.y2.toFixed(2)}
              stroke={activeTheme.border}
              strokeWidth="0.8"
            />
            {t.drawText && (
              <text
                x={t.textX.toFixed(2)}
                y={t.textY.toFixed(2)}
                textAnchor="middle"
                fontSize={activeTypography.tickLabel}
                fontFamily={varFontPosterSans}
                fill={activeTheme.grid.text}
                fontWeight="500"
              >
                {t.text}
              </text>
            )}
          </g>
        ))}
      </g>
    );
    if (sphereData) return renderedWorkerSphere;

    const projectFn = isNorth
      ? (ra, dec) => projectNorth(ra, dec, sphereRadius, renderProjection, -renderOverlapDec, renderNorthRotation)
      : (ra, dec) => projectSouth(ra, dec, sphereRadius, renderProjection, renderOverlapDec, renderSouthRotation);
    const limitDec = isNorth ? -renderOverlapDec : renderOverlapDec;
    // 1. Filter visible stars
    const visibleStars = stars.filter(s => {
      if (!isStarVisible(s)) return false;
      return isNorth ? s.dec >= limitDec : s.dec <= limitDec;
    });

    // 2. Map coordinates to 2D
    const starPoints = visibleStars.map(s => {
      const pt = projectFn(s.ra, s.dec);
      // Mapped radius based on magnitude
      const r = Math.max(0.5, 4.5 - 0.6 * s.mag);
      return { ...s, x: pt.x, y: pt.y, r };
    });

    // 3. Grid Lines
    const grid = getGridLines(projectFn, limitDec, isNorth);

    // 4. Ecliptic
    const eclipticPoints = getEclipticPoints(projectFn);
    const eclipticPath = eclipticPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    // 5. Celestial Equator
    const equatorPoints = getGridLines(projectFn, limitDec, isNorth).decCircles.find(c => c.dec === 0)?.points || [];
    const equatorPath = equatorPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    // 6. Milky Way Band contours
    // Draw two layers: Inner band (b = ±10 deg) and Outer band (b = ±18 deg)
    const mwOuterPos = getGalacticContourPoints(17, projectFn);
    const mwOuterNeg = getGalacticContourPoints(-17, projectFn);
    const mwInnerPos = getGalacticContourPoints(9, projectFn);
    const mwInnerNeg = getGalacticContourPoints(-9, projectFn);

    const getRibbonPath = (pos, neg) => {
      if (pos.length === 0) return '';
      const d = [];
      d.push(`M ${pos[0].x.toFixed(2)} ${pos[0].y.toFixed(2)}`);
      for (let i = 1; i < pos.length; i++) d.push(`L ${pos[i].x.toFixed(2)} ${pos[i].y.toFixed(2)}`);
      for (let i = neg.length - 1; i >= 0; i--) d.push(`L ${neg[i].x.toFixed(2)} ${neg[i].y.toFixed(2)}`);
      d.push('Z');
      return d.join(' ');
    };

    const mwOuterPath = getRibbonPath(mwOuterPos, mwOuterNeg);
    const mwInnerPath = getRibbonPath(mwInnerPos, mwInnerNeg);

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

    const boundaryFillRegions = renderShowWesternBoundaries && renderShowWesternBoundaryFills
      ? Object.entries(boundaries)
        .map(([abbr, points]) => ({
          abbr,
          paths: getProjectedBoundaryFillPaths(points, projectFn, limitDec, isNorth),
          colorIndex: boundaryColorMap[abbr] ?? 0,
        }))
        .filter((region) => region.paths.length > 0)
      : [];

    // 7. Labels Processing with Collision Avoidance
    const labelCandidates = [];

    // Constellation labels
    if (renderShowWesternNames) {
      for (const con of renderWesternConstellations) {
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

        if (pt) {
          // Distance from pole
          const distFromCenter = Math.sqrt(pt.x * pt.x + pt.y * pt.y);
          if (distFromCenter < sphereRadius - 15) {
            const text = getLocalizedText(con.nameZh, con.nameEn);

            labelCandidates.push({
              id: `con-${con.abbr}`,
              text,
              x: pt.x,
              y: pt.y,
              priority: 1, // Highest
              type: 'constellation',
              dotRadius: 0,
              constrainPolygon: boundaryPolygon,
            });
          }
        }
      }
    }

    // Chinese asterism labels
    if (renderShowChineseNames) {
      for (const ast of chineseConstellations) {
        const center = chineseCenters[ast.id];
        if (center) {
          const inSphere = isNorth ? center.dec >= limitDec : center.dec <= limitDec;
          if (inSphere) {
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
                dotRadius: 0
              });
            }
          }
        }
      }
    }

    // Star names labels
    if (renderShowStarNames) {
      for (const star of starPoints) {
        const isPrimaryStar = star.mag <= 3.5 || constellationStarHips.has(star.hip);
        if (isPrimaryStar) {
          const name = getLocalizedText(star.nameZh, star.nameEn);
          if (name) {
            labelCandidates.push({
              id: `star-${star.hip}`,
              text: name,
              x: star.x,
              y: star.y,
              priority: star.mag <= 2.2 ? 2 : 3, // brighter stars have higher priority
              type: 'star',
              mag: star.mag,
              dotRadius: star.r
            });
          }
        }
      }
    }

    // Resolve labels
    const resolvedLabels = resolveLabels(
      labelCandidates,
      sphereRadius,
      starPoints.filter(s => s.mag <= 2.5),
      activeTypography
    );

    // 8. Ticks around the circle rim
    const ticks = [];
    const step = 5; // every 5 degrees
    for (let deg = 0; deg < 360; deg += step) {
      const ra = deg;
      // Project at the bounding declination edge
      const ptStart = projectFn(ra, limitDec);
      // Let's compute direction vector
      const len = Math.sqrt(ptStart.x * ptStart.x + ptStart.y * ptStart.y);
      if (len === 0) continue;
      const dx = ptStart.x / len;
      const dy = ptStart.y / len;

      let tickLen = 4;
      let drawText = false;
      if (deg % 15 === 0) {
        tickLen = 9;
        drawText = true;
      } else if (deg % 5 === 0) {
        tickLen = 6;
      }

      const x1 = ptStart.x;
      const y1 = ptStart.y;
      const x2 = ptStart.x + dx * tickLen;
      const y2 = ptStart.y + dy * tickLen;

      // Text hours
      const hour = Math.round((deg / 15)) % 24;
      const textX = ptStart.x + dx * 20;
      const textY = ptStart.y + dy * 20 + 3.5;

      ticks.push({
        id: `tick-${deg}`,
        x1, y1, x2, y2,
        drawText,
        text: `${hour}h`,
        textX, textY
      });
    }

    return (
      <g>
        {/* Clip definition unique for this sphere */}
        <defs>
          <clipPath id={clipId}>
            <circle cx="0" cy="0" r={sphereRadius} />
          </clipPath>
        </defs>

        {/* Clipped Sphere Group */}
        <g clipPath={`url(#${clipId})`}>
          {/* Background fill */}
          <circle cx="0" cy="0" r={sphereRadius} fill={sphereBackgroundColor} />

          {/* Milky Way ribbons */}
          {renderShowMilkyWay && (
            <g opacity="0.8">
              {mwOuterPath && <path d={mwOuterPath} fill={activeTheme.galactic.fill} />}
              {mwInnerPath && <path d={mwInnerPath} fill={activeTheme.galactic.fill} opacity="0.7" />}
              {mwOuterPath && <path d={mwOuterPath} fill="none" stroke={activeTheme.galactic.stroke} strokeWidth="0.8" strokeDasharray="3 6" />}
            </g>
          )}

          {/* Coordinate Grids - Declination Circles */}
          {renderShowGrid && grid.decCircles.map((circle, idx) => {
            const d = circle.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
              .join(' ');
            return (
              <path
                key={`dec-c-${idx}`}
                d={d}
                fill="none"
                stroke={activeTheme.grid.color}
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
            );
          })}

          {/* Coordinate Grids - RA Radial Lines */}
          {renderShowGrid && grid.raRadials.map((radial, idx) => {
            const d = radial.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
              .join(' ');
            return (
              <path
                key={`ra-r-${idx}`}
                d={d}
                fill="none"
                stroke={activeTheme.grid.color}
                strokeWidth="0.5"
                strokeDasharray="2 4"
              />
            );
          })}

          {/* Celestial Equator */}
          {renderShowEquator && equatorPath && (
            <path
              d={equatorPath}
              fill="none"
              stroke={activeTheme.equator.color}
              strokeWidth="1"
              strokeDasharray={activeTheme.equator.dash}
              opacity={activeTheme.equator.opacity}
            />
          )}

          {/* Ecliptic */}
          {renderShowEcliptic && eclipticPath && (
            <path
              d={eclipticPath}
              fill="none"
              stroke={activeTheme.ecliptic.color}
              strokeWidth="1.2"
              strokeDasharray={activeTheme.ecliptic.dash}
              opacity={activeTheme.ecliptic.opacity}
            />
          )}

          {boundaryFillRegions.length > 0 && (
            <g opacity="0.18">
              {boundaryFillRegions.map((region) => (
                <g
                  key={`boundary-fill-${isNorth ? 'n' : 's'}-${region.abbr}`}
                  fill={CONSTELLATION_FILL_PALETTE[region.colorIndex % CONSTELLATION_FILL_PALETTE.length]}
                >
                  {region.paths.map((path, index) => (
                    <path
                      key={`boundary-fill-strip-${region.abbr}-${index}`}
                      d={path}
                    />
                  ))}
                </g>
              ))}
            </g>
          )}

          {/* IAU constellation boundaries: render reconstructed short boundary segments, not closed polygons. */}
          {renderShowWesternBoundaries && boundaryPath && (
            <path
              d={boundaryPath}
              fill="none"
              stroke={activeTheme.constellations.boundary}
              strokeWidth="0.55"
              strokeDasharray={activeTheme.constellations.boundaryDash}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.7"
            />
          )}

          {/* Chinese Asterisms Lines */}
          {renderShowChineseLines && chineseConstellations.map((ast, idx) => {
            return ast.edges.map(([hip1, hip2], eIdx) => {
              const s1 = starsMap.get(hip1);
              const s2 = starsMap.get(hip2);
              if (!s1 || !s2) return null;
              const pt1 = projectFn(s1.ra, s1.dec);
              const pt2 = projectFn(s2.ra, s2.dec);
              return (
                <line
                  key={`zh-edge-${idx}-${eIdx}`}
                  x1={pt1.x.toFixed(2)}
                  y1={pt1.y.toFixed(2)}
                  x2={pt2.x.toFixed(2)}
                  y2={pt2.y.toFixed(2)}
                  stroke={activeTheme.chinese.line}
                  strokeWidth="0.8"
                  opacity={activeTheme.chinese.lineOpacity}
                />
              );
            });
          })}

          {/* Western Constellation Lines */}
          {renderShowWesternLines && renderWesternConstellations.map((con, idx) => {
            return con.edges.map(([hip1, hip2], eIdx) => {
              const s1 = starsMap.get(hip1);
              const s2 = starsMap.get(hip2);
              if (!s1 || !s2) return null;
              const pt1 = projectFn(s1.ra, s1.dec);
              const pt2 = projectFn(s2.ra, s2.dec);
              return (
                <line
                  key={`west-edge-${idx}-${eIdx}`}
                  x1={pt1.x.toFixed(2)}
                  y1={pt1.y.toFixed(2)}
                  x2={pt2.x.toFixed(2)}
                  y2={pt2.y.toFixed(2)}
                  stroke={activeTheme.constellations.line}
                  strokeWidth="0.8"
                  opacity={activeTheme.constellations.lineOpacity}
                />
              );
            });
          })}

          {/* Star Dots */}
          {starPoints.map((s, idx) => {
            const color = getStarColorHSL(s.colorIdx, renderThemeId);
            const isRetro = activeTheme.stars.retroRings;
            if (isRetro) {
              const innerRadius = Math.max(0.5, 2.0 - 0.25 * s.mag);
              const outerRadius = Math.max(1.2, 5.0 - 0.65 * s.mag);
              return (
                <g key={`star-dots-${idx}`} opacity={s.mag > 5 ? 0.6 : 1.0}>
                  {/* Central black ink dot */}
                  <circle cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={innerRadius.toFixed(2)} fill="#201e1a" />
                  {/* Colored circular ring around it */}
                  <circle cx={s.x.toFixed(2)} cy={s.y.toFixed(2)} r={outerRadius.toFixed(2)} fill="none" stroke={color} strokeWidth="0.9" />
                </g>
              );
            }

            // Normal theme stars (glowing circular dots)
            const showGlow = activeTheme.stars.glow && s.mag <= 2.5;
            const opacity = Math.max(0.3, Math.min(1.0, 1.1 - 0.12 * (s.mag - 1)));
            return (
              <g key={`star-dots-${idx}`}>
                {showGlow && (
                  <circle
                    cx={s.x.toFixed(2)}
                    cy={s.y.toFixed(2)}
                    r={(s.r * 2.2).toFixed(2)}
                    fill={color}
                    opacity="0.18"
                    filter="blur(1px)"
                  />
                )}
                <circle
                  cx={s.x.toFixed(2)}
                  cy={s.y.toFixed(2)}
                  r={s.r.toFixed(2)}
                  fill={color}
                  opacity={opacity}
                  stroke={activeTheme.stars.stroke || 'none'}
                  strokeWidth={activeTheme.stars.strokeWidth || 0}
                />
              </g>
            );
          })}

          {/* Labels Rendering */}
          {resolvedLabels.map((lbl, idx) => {
            const fontColor = lbl.type === 'constellation'
              ? activeTheme.constellations.label
              : lbl.type === 'chinese_asterism'
                ? activeTheme.chinese.label
                : activeTheme.text.body;

            const isChinese = lbl.type === 'chinese_asterism' || (lbl.type === 'star' && renderShowChineseLines);
            const fontF = isChinese 
              ? (renderFontFamily === "serif" ? "'Noto Serif SC', serif" : "'Noto Sans SC', sans-serif")
              : (renderFontFamily === "serif" ? varFontPosterSerif : varFontPosterSans);

            const weight = lbl.type === 'constellation' || lbl.type === 'chinese_asterism' ? 'bold' : 'normal';

            return (
              <text
                key={`lbl-${idx}`}
                x={lbl.renderX.toFixed(2)}
                y={lbl.renderY.toFixed(2)}
                textAnchor={lbl.anchor}
                fill={fontColor}
                fontSize={lbl.fontSize}
                fontFamily={fontF}
                fontWeight={weight}
                opacity={lbl.type === 'star' ? 0.85 : 0.9}
              >
                {lbl.text}
              </text>
            );
          })}
        </g>

        {/* Ticks and grid degree markings outside the sphere */}
        <circle cx="0" cy="0" r={sphereRadius} fill="none" stroke={activeTheme.border} strokeWidth="1.5" />
        <circle cx="0" cy="0" r={sphereRadius + 8} fill="none" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.6" />

        {ticks.map((t) => (
          <g key={t.id}>
            <line
              x1={t.x1.toFixed(2)}
              y1={t.y1.toFixed(2)}
              x2={t.x2.toFixed(2)}
              y2={t.y2.toFixed(2)}
              stroke={activeTheme.border}
              strokeWidth="0.8"
            />
            {t.drawText && (
              <text
                x={t.textX.toFixed(2)}
                y={t.textY.toFixed(2)}
                textAnchor="middle"
                fontSize={activeTypography.tickLabel}
                fontFamily={varFontPosterSans}
                fill={activeTheme.grid.text}
                fontWeight="500"
              >
                {t.text}
              </text>
            )}
          </g>
        ))}
      </g>
    );
  };

  // Font family string resolution for poster text rendering
  const varFontPosterSerif = "'Lora', 'Noto Serif SC', serif";
  const varFontPosterSans = "'Outfit', 'Noto Sans SC', sans-serif";
  const activePosterFont = renderFontFamily === "serif" ? varFontPosterSerif : varFontPosterSans;
  const getDownloadBaseName = (suffix) => (
    `${title.toLowerCase().replace(/\s+/g, '_')}_${suffix}`
  );

  const getVisiblePosterSvgs = () => (
    [...document.querySelectorAll('svg[data-export-svg="true"]')]
  );

  const getSvgDimensions = (svgEl) => {
    const viewBox = svgEl.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
      return { width: viewBox[2], height: viewBox[3] };
    }
    return {
      width: Number(svgEl.getAttribute('width')) || POSTER_LAYOUTS.landscape_dual.width,
      height: Number(svgEl.getAttribute('height')) || POSTER_LAYOUTS.landscape_dual.height,
    };
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportConstellationStl = () => {
    if (!constellation3dModel || !selected3dConstellation) {
      showToast(uiText.exportStlFailed);
      return;
    }
    try {
      const modelName = `${selected3dConstellation.abbr.toLowerCase()}_glow_constellation_card`;
      const stl = createConstellationStl(constellation3dModel, modelSettings, modelName);
      const previewNode = document.querySelector('[data-testid="constellation-3d-canvas"]');
      if (previewNode) {
        previewNode.dataset.lastStlExporter = 'three-vector';
        previewNode.dataset.lastStlBytes = String(stl.length);
        previewNode.dataset.lastStlFacets = String((stl.match(/facet normal/g) || []).length);
        previewNode.dataset.lastStlSurfaceLineHeightMm = String(SURFACE_LINE_HEIGHT_MM);
        previewNode.dataset.lastStlMythLines = String(modelSettings.showMythLines !== false);
        previewNode.dataset.lastStlStarConnectionLines = String(modelSettings.showStarConnectionLines !== false);
      }
      downloadBlob(new Blob([stl], { type: 'model/stl' }), `${modelName}.stl`);
      showToast(uiText.exportedStl);
    } catch (e) {
      console.error(e);
      showToast(uiText.exportStlFailed);
    }
  };

  const canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.92) => (
    new Promise((resolve) => canvas.toBlob(resolve, type, quality))
  );

  const asciiBytes = (value) => new TextEncoder().encode(value);

  const concatBytes = (chunks) => {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  };

  const createTiledPdfBlob = (jpegPages) => {
    const pageWidthPt = 595.28;
    const pageHeightPt = 841.89;
    const chunks = [];
    const offsets = [0];
    let byteOffset = 0;

    const append = (chunk) => {
      chunks.push(chunk);
      byteOffset += chunk.length;
    };
    const appendText = (text) => append(asciiBytes(text));
    const appendObject = (objectId, bodyChunks) => {
      offsets[objectId] = byteOffset;
      appendText(`${objectId} 0 obj\n`);
      for (const chunk of bodyChunks) {
        append(typeof chunk === 'string' ? asciiBytes(chunk) : chunk);
      }
      appendText('\nendobj\n');
    };

    appendText('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const pageObjectIds = [];
    let nextObjectId = 3;

    for (let i = 0; i < jpegPages.length; i++) {
      const imageObjectId = nextObjectId++;
      const contentObjectId = nextObjectId++;
      const pageObjectId = nextObjectId++;
      const imageName = `Im${i + 1}`;
      const page = jpegPages[i];
      const content = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/${imageName} Do\nQ\n`;

      appendObject(imageObjectId, [
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
        page.bytes,
        '\nendstream',
      ]);
      appendObject(contentObjectId, [
        `<< /Length ${asciiBytes(content).length} >>\nstream\n${content}endstream`,
      ]);
      appendObject(pageObjectId, [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /XObject << /${imageName} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      ]);
      pageObjectIds.push(pageObjectId);
    }

    appendObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    appendObject(2, [`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`]);

    const xrefOffset = byteOffset;
    appendText(`xref\n0 ${nextObjectId}\n`);
    appendText('0000000000 65535 f \n');
    for (let objectId = 1; objectId < nextObjectId; objectId++) {
      appendText(`${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`);
    }
    appendText(`trailer\n<< /Size ${nextObjectId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
  };

  const renderSvgToImage = async (svgEl) => {
    const svgString = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const createTiledPdfPagesForSvg = async (svgEl) => {
    const pageWidthPx = 1240;
    const pageHeightPx = 1754;
    const combinedWidthPx = pageWidthPx * 2;
    const combinedHeightPx = pageHeightPx;
    const { width: svgWidth, height: svgHeight } = getSvgDimensions(svgEl);
    const shouldRotate = svgHeight > svgWidth;
    const img = await renderSvgToImage(svgEl);

    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = combinedWidthPx;
    combinedCanvas.height = combinedHeightPx;
    const combinedCtx = combinedCanvas.getContext('2d');
    combinedCtx.fillStyle = '#ffffff';
    combinedCtx.fillRect(0, 0, combinedWidthPx, combinedHeightPx);

    if (shouldRotate) {
      combinedCtx.save();
      combinedCtx.translate(combinedWidthPx, 0);
      combinedCtx.rotate(Math.PI / 2);
      combinedCtx.drawImage(img, 0, 0, combinedHeightPx, combinedWidthPx);
      combinedCtx.restore();
    } else {
      combinedCtx.drawImage(img, 0, 0, combinedWidthPx, combinedHeightPx);
    }

    const pages = [];
    for (let tile = 0; tile < 2; tile++) {
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = pageWidthPx;
      pageCanvas.height = pageHeightPx;
      const pageCtx = pageCanvas.getContext('2d');
      pageCtx.fillStyle = '#ffffff';
      pageCtx.fillRect(0, 0, pageWidthPx, pageHeightPx);
      pageCtx.drawImage(
        combinedCanvas,
        tile * pageWidthPx,
        0,
        pageWidthPx,
        pageHeightPx,
        0,
        0,
        pageWidthPx,
        pageHeightPx
      );
      const jpegBlob = await canvasToBlob(pageCanvas);
      if (!jpegBlob) throw new Error('PDF tile rendering returned an empty image.');
      pages.push({
        width: pageWidthPx,
        height: pageHeightPx,
        bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
      });
    }

    return pages;
  };

  // --- Export SVG File ---
  const exportSVG = () => {
    const svgEls = getVisiblePosterSvgs();
    if (svgEls.length === 0) return;
    try {
      for (const svgEl of svgEls) {
        const svgString = new XMLSerializer().serializeToString(svgEl);
        const suffix = svgEl.dataset.exportSuffix || 'poster';
        const blob = new Blob([`<?xml version="1.0" encoding="utf-8"?>\n`, svgString], { type: 'image/svg+xml;charset=utf-8' });
        downloadBlob(blob, `${getDownloadBaseName(suffix)}.svg`);
      }
      showToast(uiText.exportedSvg);
    } catch (e) {
      console.error(e);
      showToast(uiText.exportSvgFailed);
    }
  };

  // --- Export PNG File at High-Res (3x scale) ---
  const exportPNG = () => {
    const svgEls = getVisiblePosterSvgs();
    if (svgEls.length === 0) return;
    showToast(uiText.renderingPng);

    setTimeout(async () => {
      try {
        const scale = 3.5; // 3.5x scale for print-quality landscape export.
        for (const svgEl of svgEls) {
          const { width: baseWidth, height: baseHeight } = getSvgDimensions(svgEl);
          const width = baseWidth * scale;
          const height = baseHeight * scale;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const svgString = new XMLSerializer().serializeToString(svgEl);
          const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });

          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          const suffix = svgEl.dataset.exportSuffix || 'poster';
          const pngBlob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/png');
          });
          if (!pngBlob) throw new Error('PNG rendering returned an empty blob.');
          downloadBlob(pngBlob, `${getDownloadBaseName(suffix)}.png`);
        }
        showToast(uiText.exportedPng);
      } catch (e) {
        console.error(e);
        showToast(uiText.exportPngFailed);
      }
    }, 100);
  };

  const exportTiledPdf = () => {
    const svgEls = getVisiblePosterSvgs();
    if (svgEls.length === 0) return;
    showToast(uiText.renderingPdf);

    setTimeout(async () => {
      try {
        const pdfPages = [];
        for (const svgEl of svgEls) {
          pdfPages.push(...await createTiledPdfPagesForSvg(svgEl));
        }
        const pdfBlob = createTiledPdfBlob(pdfPages);
        downloadBlob(pdfBlob, `${getDownloadBaseName('a4-tiled-print')}.pdf`);
        showToast(uiText.exportedPdf);
      } catch (e) {
        console.error(e);
        showToast(uiText.exportPdfFailed);
      }
    }, 100);
  };

  const updateModelSetting = (key, value) => {
    setModelSettings((current) => ({ ...current, [key]: value }));
  };

  const handleModelPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    modelDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewMatrix: modelView.viewMatrix,
      modelMatrix: modelView.modelMatrix,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleModelPointerMove = (event) => {
    const dragState = modelDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const localSpinAroundNormal = rotationZMatrix(deltaX * 0.35);
    const spunAroundModelNormal = multiplyMatrix4(dragState.modelMatrix, localSpinAroundNormal);
    const limitedViewMatrix = applyLimitedViewPitch(dragState.viewMatrix, deltaY * 0.35);
    setModelView((current) => ({
      ...current,
      viewMatrix: limitedViewMatrix,
      modelMatrix: spunAroundModelNormal,
    }));
  };

  const stopModelPointerDrag = (event) => {
    if (modelDragStateRef.current?.pointerId !== event.pointerId) return;
    modelDragStateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleModelWheel = (event) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const zoomFactor = Math.exp(-delta * 0.0015);
    setModelView((current) => ({
      ...current,
      scale: clampModelScale(current.scale * zoomFactor),
    }));
  };

  const renderModelRange = (key, label, min, max, step, unit = 'mm') => (
    <div className="form-field">
      <label>
        {label} <span className="value">{modelSettings[key].toFixed(step < 1 ? 1 : 0)} {unit}</span>
      </label>
      <input
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={modelSettings[key]}
        onInput={(e) => updateModelSetting(key, Number(e.currentTarget.value))}
        onChange={(e) => updateModelSetting(key, Number(e.target.value))}
      />
    </div>
  );

  const renderModelSegmentToggle = (key, label, options = {}) => {
    const checked = modelSettings[key] !== false;
    const compactInline = options.compactInline === true;
    return (
      <div className={`form-field ${compactInline ? 'inline-toggle-field' : ''}`}>
        <label>{label}</label>
        <div className={`segmented-control ${compactInline ? 'segmented-control-compact' : ''}`} role="group" aria-label={label}>
          <button
            type="button"
            className={`segment-button ${checked ? 'active' : ''}`}
            onClick={() => updateModelSetting(key, true)}
          >
            {uiText.toggleOn}
          </button>
          <button
            type="button"
            className={`segment-button ${!checked ? 'active' : ''}`}
            onClick={() => updateModelSetting(key, false)}
          >
            {uiText.toggleOff}
          </button>
        </div>
      </div>
    );
  };

  const renderModelValueSegmentToggle = (key, label, options) => {
    const compactInline = options.compactInline === true;
    return (
      <div className={`form-field ${compactInline ? 'inline-toggle-field' : ''}`}>
        <label>{label}</label>
        <div className={`segmented-control ${compactInline ? 'segmented-control-compact' : ''}`} role="group" aria-label={label}>
          {options.items.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`segment-button ${modelSettings[key] === item.value ? 'active' : ''}`}
              onClick={() => updateModelSetting(key, item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderConstellation3dPage = () => {
    const points = constellation3dModel?.points ?? [];
    const edges = constellation3dModel?.edges ?? [];
    const computedGrooveDepthMm = Math.min(
      Math.max(0.08, modelSettings.baseThicknessMm - 0.08),
      Math.max(1, modelSettings.baseThicknessMm / 2),
    );

    return (
      <>
        <aside className="sidebar">
          <header className="sidebar-header">
            <h1><span>ALLSKY</span> ATLAS</h1>
            <p>{uiText.appSubtitle}</p>
            <nav className="sidebar-page-links" aria-label="Feature navigation">
              <button type="button" onClick={() => setCurrentPage('poster')}>{uiText.posterPageLink}</button>
              <button type="button" className="active" onClick={() => setCurrentPage('constellation-3d')}>{uiText.constellation3dPageLink}</button>
            </nav>
          </header>

          <div className="sidebar-content">
            <div className="control-group">
              <h3 className="control-group-title">{uiText.print3dTitle}</h3>
              <div className="form-field">
                <label>{uiText.print3dConstellation}</label>
                <select
                  className="select-input"
                  value={selected3dConstellation?.abbr ?? modelSettings.constellationAbbr}
                  onChange={(e) => updateModelSetting('constellationAbbr', e.target.value)}
                >
                  {[...westernConstellations]
                    .sort((a, b) => a.nameEn.localeCompare(b.nameEn))
                    .map((constellation) => (
                      <option key={constellation.abbr} value={constellation.abbr}>
                        {displayLanguage === 'zh'
                          ? `${constellation.nameZh} (${constellation.nameEn})`
                          : `${constellation.nameEn} (${constellation.abbr})`}
                      </option>
                  ))}
                </select>
              </div>
              <div className="control-subgroup">
                <h4 className="control-subgroup-title">{uiText.print3dBaseGroup}</h4>
                {renderModelRange('cardWidthMm', uiText.print3dCardWidth, 70, 180, 1)}
                {renderModelRange('baseThicknessMm', uiText.print3dBaseThickness, 1.2, 6, 0.1)}
                {renderModelRange('outlinePaddingMm', uiText.print3dOutlinePadding, 4, 24, 0.5)}
              </div>
              <div className="control-subgroup">
                <h4 className="control-subgroup-title">{uiText.print3dLayerGroup}</h4>
                {renderModelSegmentToggle('showMythLines', uiText.print3dMythLines, { compactInline: true })}
                {modelSettings.showMythLines !== false && renderModelRange('surfaceLineWidthMm', uiText.print3dSurfaceLineWidth, 0.2, 4, 0.1)}
                {renderModelSegmentToggle('showStarConnectionLines', uiText.print3dStarConnectionLines, { compactInline: true })}
              </div>
              <div className="control-subgroup">
                <h4 className="control-subgroup-title">{uiText.print3dStarGroup}</h4>
                {renderModelValueSegmentToggle('starPositionMode', displayLanguage === 'zh' ? '星点形态' : 'Star position style', {
                  compactInline: true,
                  items: [
                    { value: 'recessed', label: displayLanguage === 'zh' ? '凹陷' : 'In' },
                    { value: 'raised', label: displayLanguage === 'zh' ? '凸起' : 'Out' },
                  ],
                })}
                {renderModelRange('grooveDiameterMm', uiText.print3dGrooveDiameter, 2.4, 10, 0.1)}
                <div className="form-field">
                  <label>
                    {uiText.print3dGrooveDepth} <span className="value">{computedGrooveDepthMm.toFixed(1)} mm</span>
                  </label>
                  <p className="control-tip compact">{displayLanguage === 'zh' ? '自动使用底板厚度的 1/2，且至少 1 mm。' : 'Automatically uses half of the base thickness, with a 1 mm minimum.'}</p>
                </div>
              </div>
            </div>

            <div className="control-group">
              <button className="btn-primary" onClick={exportConstellationStl}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                {uiText.print3dExportStl}
              </button>
            </div>

            <div className="control-group">
              <h3 className="control-group-title">{uiText.print3dDesignNotes}</h3>
              <p className="control-tip">{uiText.print3dNoteShape}</p>
              <p className="control-tip">{uiText.print3dNoteGroove}</p>
              <p className="control-tip">{uiText.print3dNoteMount}</p>
            </div>
          </div>

          <footer className="sidebar-footer">
            <p>© 2026 Astronomy Poster Builder</p>
          </footer>
        </aside>

        <main className="constellation-3d-area">
          {(toast || isPosterRendering) && (
            <div className="preview-toast-stack" aria-live="polite">
              {toast && <div className="toast" role="status">{toast}</div>}
            </div>
          )}
          <section className="constellation-3d-workbench">
            <div className="constellation-3d-heading">
              <div>
                <p>{uiText.print3dTitle}</p>
                <h2>{displayLanguage === 'zh' ? selected3dConstellation?.nameZh : selected3dConstellation?.nameEn}</h2>
              </div>
              <span>{selected3dConstellation?.abbr}</span>
            </div>
            <div
              className="constellation-3d-preview"
              onPointerDown={handleModelPointerDown}
              onPointerMove={handleModelPointerMove}
              onPointerUp={stopModelPointerDrag}
              onPointerCancel={stopModelPointerDrag}
              onWheel={handleModelWheel}
            >
              <ConstellationModel3DPreview
                model={constellation3dModel}
                settings={modelSettings}
                modelView={modelView}
                displayLanguage={displayLanguage}
              />
            </div>
            <div className="constellation-3d-specs">
              <span>{modelSettings.cardWidthMm.toFixed(0)} mm</span>
              <span>{points.length} stars</span>
              <span>{edges.length} lines</span>
              <span>{Math.round(modelView.scale * 100)}% view</span>
            </div>
            <div className="constellation-3d-material-legend" aria-label="Print materials">
              <span><i className="material-color-plane"></i>{displayLanguage === 'zh' ? '底板材料' : 'Plane material'}</span>
              <span><i className="material-color-outline"></i>{displayLanguage === 'zh' ? '轮廓材料' : 'Outline material'}</span>
            </div>
          </section>
        </main>
      </>
    );
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner"></div>
        <p className="loading-text">{uiText.loading}</p>
        <p className="loading-subtext">{uiText.loadingSubtext}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-overlay">
        <p className="loading-text" style={{ color: '#ef4444' }}>{error === 'load_failed' ? uiText.loadError : error}</p>
        <p className="loading-subtext">{uiText.errorHint}</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {currentPage === 'constellation-3d' ? renderConstellation3dPage() : (
      <>
      {/* Glassmorphic Sidebar Controls */}
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1><span>ALLSKY</span> ATLAS</h1>
          <p>{uiText.appSubtitle}</p>
          <nav className="sidebar-page-links" aria-label="Feature navigation">
            <button type="button" className="active" onClick={() => setCurrentPage('poster')}>{uiText.posterPageLink}</button>
            <button type="button" onClick={() => setCurrentPage('constellation-3d')}>{uiText.constellation3dPageLink}</button>
          </nav>
        </header>

        <div className="sidebar-content">
          {/* Group 1: Theme & Typography */}
          <div className="control-group">
            <h3 className="control-group-title">{uiText.themeTypography}</h3>
            <div className="form-field">
              <label>{uiText.starMapTemplate}</label>
              <select
                className="select-input"
                value={themeId}
                onChange={(e) => {
                  const nextThemeId = e.target.value;
                  schedulePosterUpdate(
                    () => setThemeId(nextThemeId),
                    { themeId: nextThemeId }
                  );
                }}
              >
                <option value="classic_navy">{uiText.themeClassicNavy}</option>
                <option value="deep_space">{uiText.themeDeepSpace}</option>
                <option value="elegant_white">{uiText.themeElegantWhite}</option>
                <option value="qirui_retro">{uiText.themeRetroParchment}</option>
                <option value="a4_print_color">{uiText.themeA4PrintColor}</option>
              </select>
            </div>
            <div className="form-field">
              <label>{uiText.posterLayout}</label>
              <div className="segmented-control" role="group" aria-label={uiText.posterLayout}>
                <button
                  type="button"
                  className={`segment-button ${posterLayout === 'landscape_dual' ? 'active' : ''}`}
                  onClick={() => schedulePosterUpdate(
                    () => setPosterLayout('landscape_dual'),
                    { posterLayout: 'landscape_dual' }
                  )}
                >
                  {uiText.layoutLandscapeDual}
                </button>
                <button
                  type="button"
                  className={`segment-button ${posterLayout === 'portrait_single' ? 'active' : ''}`}
                  onClick={() => schedulePosterUpdate(
                    () => setPosterLayout('portrait_single'),
                    { posterLayout: 'portrait_single' }
                  )}
                >
                  {uiText.layoutPortraitSingle}
                </button>
              </div>
            </div>
            <ToggleRow
              checked={controlHasTransparentPaper}
              onChange={(checked) => schedulePosterUpdate(
                () => setTransparentBackground(checked),
                { transparentBackground: checked }
              )}
              muted={controlTheme.paperTransparent}
            >
              {uiText.transparentBackground}
            </ToggleRow>
            <div className="form-field">
              <label>{uiText.fontFamily}</label>
              <select
                className="select-input"
                value={fontFamily}
                onChange={(e) => {
                  const nextFontFamily = e.target.value;
                  schedulePosterUpdate(
                    () => setFontFamily(nextFontFamily),
                    { fontFamily: nextFontFamily }
                  );
                }}
              >
                <option value="serif">{uiText.fontSerif}</option>
                <option value="sans">{uiText.fontSans}</option>
              </select>
            </div>
            <div className="form-field">
              <label>{uiText.canvasLanguage}</label>
              <select
                className="select-input"
                value={labelLanguageMode}
                onChange={(e) => {
                  const nextLabelLanguageMode = e.target.value;
                  schedulePosterUpdate(
                    () => setLabelLanguageMode(nextLabelLanguageMode),
                    { labelLanguageMode: nextLabelLanguageMode }
                  );
                }}
              >
                <option value="en">{uiText.languageEn}</option>
                <option value="zh">{uiText.languageZh}</option>
                <option value="both">{uiText.languageBoth}</option>
              </select>
            </div>
          </div>

          {/* Group 2: Poster Text */}
          <div className="control-group">
            <h3 className="control-group-title">{uiText.posterText}</h3>
            <div className="form-field">
              <label>{uiText.mainTitle}</label>
              <input
                type="text"
                className="text-input"
                value={title}
                onChange={(e) => setTitleOverrides((current) => ({
                  ...current,
                  [displayLanguage]: e.target.value,
                }))}
              />
            </div>
            <div className="form-field">
              <label>{uiText.footnote}</label>
              <input
                type="text"
                className="text-input"
                value={customNote}
                onChange={(e) => setCustomNoteOverrides((current) => ({
                  ...current,
                  [displayLanguage]: e.target.value,
                }))}
              />
            </div>
          </div>

          {/* Group 3: Astronomy Settings */}
          <div className="control-group">
            <h3 className="control-group-title">{uiText.astronomyProjection}</h3>
            <div className="form-field">
              <label>{uiText.projectionMode}</label>
              <select
                className="select-input"
                value={projection}
                onChange={(e) => {
                  const nextProjection = e.target.value;
                  schedulePosterUpdate(
                    () => setProjection(nextProjection),
                    { projection: nextProjection }
                  );
                }}
              >
                <option value="polar_equidistant">{uiText.projectionEquidistant}</option>
                <option value="polar_stereographic">{uiText.projectionStereographic}</option>
              </select>
            </div>
            <div className="form-field">
              <label>
                {uiText.overlapDeclination} <span className="value">Dec ±{overlapDec}°</span>
              </label>
              <input
                type="range"
                className="slider-input"
                min="10"
                max="40"
                step="1"
                value={overlapDec}
                onChange={(e) => {
                  const nextOverlapDec = parseInt(e.target.value);
                  schedulePosterUpdate(
                    () => setOverlapDec(nextOverlapDec),
                    { overlapDec: nextOverlapDec }
                  );
                }}
              />
            </div>
            <div className="form-field">
              <label>
                {uiText.northRotation} <span className="value">{northRotation}°</span>
              </label>
              <input
                type="range"
                className="slider-input"
                min="0"
                max="360"
                step="5"
                value={northRotation}
                onChange={(e) => {
                  const nextNorthRotation = parseInt(e.target.value);
                  schedulePosterUpdate(
                    () => setNorthRotation(nextNorthRotation),
                    { northRotation: nextNorthRotation }
                  );
                }}
              />
            </div>
            <div className="form-field">
              <label>
                {uiText.southRotation} <span className="value">{southRotation}°</span>
              </label>
              <input
                type="range"
                className="slider-input"
                min="0"
                max="360"
                step="5"
                value={southRotation}
                onChange={(e) => {
                  const nextSouthRotation = parseInt(e.target.value);
                  schedulePosterUpdate(
                    () => setSouthRotation(nextSouthRotation),
                    { southRotation: nextSouthRotation }
                  );
                }}
              />
            </div>
            <ToggleRow checked={showVisibleSky} onChange={(checked) => schedulePosterUpdate(
              () => setShowVisibleSky(checked),
              { showVisibleSky: checked }
            )}>
              {uiText.visibleSky}
            </ToggleRow>
            <div className="form-field">
              <label>
                {uiText.observerLatitude} <span className="value">{observerLatitude.toFixed(1)}°</span>
              </label>
              <div className="marked-range">
                <input
                  type="range"
                  className="slider-input"
                  min="-60"
                  max="60"
                  step="0.1"
                  value={observerLatitude}
                  onChange={(e) => updateObserverLatitude(Number(e.target.value))}
                />
                <div className="range-markers" aria-hidden="true">
                  {CITY_OBSERVERS.map((city) => (
                    <button
                      key={city.id}
                      type="button"
                      className="range-marker"
                      style={{ left: `${latitudePercent(city.latitude)}%` }}
                      title={`${getCityName(city)} ${city.latitude.toFixed(1)}°`}
                      onClick={() => updateObserverCity(city)}
                    />
                  ))}
                </div>
              </div>
              <div className="range-scale city-scale">
                {CITY_OBSERVERS.map((city) => (
                  <button
                    key={city.id}
                    type="button"
                    style={{ left: `${latitudePercent(city.latitude)}%` }}
                    onClick={() => updateObserverCity(city)}
                  >
                    {getCityName(city)}
                  </button>
                ))}
              </div>
              <p className="field-hint">{uiText.observerCityHint}</p>
            </div>
            <div className="form-field">
              <label>
                {uiText.observerHour} <span className="value">{observerHour}:00</span>
              </label>
              <input
                type="range"
                className="slider-input"
                min="0"
                max="23"
                step="1"
                value={observerHour}
                onChange={(e) => updateObserverHour(Number(e.target.value))}
              />
              <p className="field-hint">{uiText.observerHourHint}</p>
            </div>
            <ToggleRow
              checked={showVisibleSkyTimeWindow}
              onChange={(checked) => schedulePosterUpdate(
                () => setShowVisibleSkyTimeWindow(checked),
                { showVisibleSkyTimeWindow: checked }
              )}
              indented
              muted={!showVisibleSky}
            >
              {uiText.visibleSkyTimeWindow}
            </ToggleRow>
            <div className="form-field">
              <label>
                {uiText.observerMonth} <span className="value">{observerMonth}</span>
              </label>
              <input
                type="range"
                className="slider-input"
                min="1"
                max="12"
                step="1"
                value={observerMonth}
                onChange={(e) => updateObserverMonth(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Group 4: Layout Layers */}
          <div className="control-group">
            <h3 className="control-group-title">{uiText.layerDisplay}</h3>

            <div className="control-subgroup">
              <div className="control-subgroup-heading">
                <h4 className="control-subgroup-title">{uiText.modernConstellations}</h4>
                <div
                  className="segmented-control segmented-control-three constellation-line-style-toggle"
                  role="group"
                  aria-label={uiText.constellationLineSet}
                >
                  {WESTERN_LINE_STYLE_OPTIONS.map((style) => {
                    const label = style === WESTERN_LINE_STYLE_OFF
                      ? uiText.constellationLineStyleOff
                      : style === WESTERN_LINE_STYLE_SKY_TELESCOPE
                        ? uiText.constellationLineStyleSkyTelescope
                        : uiText.constellationLineStyleModern;
                    return (
                      <button
                        key={style}
                        type="button"
                        className={`segment-button ${westernLineStyle === style ? 'active' : ''}`}
                        onClick={() => schedulePosterUpdate(
                          () => setWesternLineStyle(style),
                          { westernLineStyle: style }
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <ToggleRow checked={showWesternNames} onChange={(checked) => schedulePosterUpdate(
                () => setShowWesternNames(checked),
                { showWesternNames: checked }
              )}>
                {uiText.constellationNames}
              </ToggleRow>
              <ToggleRow checked={showWesternBoundaries} onChange={(checked) => schedulePosterUpdate(
                () => setShowWesternBoundaries(checked),
                { showWesternBoundaries: checked }
              )}>
                {uiText.iauBoundaries}
              </ToggleRow>
              <ToggleRow
                checked={showWesternBoundaryFills}
                onChange={(checked) => schedulePosterUpdate(
                  () => setShowWesternBoundaryFills(checked),
                  { showWesternBoundaryFills: checked }
                )}
                indented
                muted={!showWesternBoundaries}
              >
                {uiText.constellationRegionColors}
              </ToggleRow>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.chineseAsterisms}</h4>
              <ToggleRow checked={showChineseLines} onChange={(checked) => schedulePosterUpdate(
                () => setShowChineseLines(checked),
                { showChineseLines: checked }
              )}>
                {uiText.asterismLines}
              </ToggleRow>
              <ToggleRow checked={showChineseNames} onChange={(checked) => schedulePosterUpdate(
                () => setShowChineseNames(checked),
                { showChineseNames: checked }
              )}>
                {uiText.asterismNames}
              </ToggleRow>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.starLabels}</h4>
              <ToggleRow checked={showStarNames} onChange={(checked) => schedulePosterUpdate(
                () => setShowStarNames(checked),
                { showStarNames: checked }
              )}>
                {uiText.primaryStarNames}
              </ToggleRow>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.starDots}</h4>
              <div className="form-field">
                <label>
                  {uiText.magnitudeRange} <span className="value">{formatMagFilterValue(minMagLimit)} {uiText.rangeJoin} {formatMagFilterValue(magLimit)}</span>
                </label>
                <div className="range-caption">
                  <span>{uiText.brightestEnd}</span>
                  <span>{uiText.faintestEnd}</span>
                </div>
                <div
                  className="dual-range"
                  style={{
                    '--range-start': `${magRangeStart}%`,
                    '--range-end': `${magRangeEnd}%`,
                  }}
                >
                  <input
                    type="range"
                    className="dual-range-input"
                    min={MAG_RANGE_MIN}
                    max={MAG_RANGE_MAX}
                    step={MAG_RANGE_STEP}
                    value={minMagLimit}
                    aria-label={uiText.brightMagnitudeAria}
                    onChange={(e) => updateMinMagLimit(Number(e.target.value))}
                  />
                  <input
                    type="range"
                    className="dual-range-input"
                    min={MAG_RANGE_MIN}
                    max={MAG_RANGE_MAX}
                    step={MAG_RANGE_STEP}
                    value={magLimit}
                    aria-label={uiText.faintMagnitudeAria}
                    onChange={(e) => updateMagLimit(Number(e.target.value))}
                  />
                </div>
                <div className="range-scale">
                  {MAG_RANGE_TICKS.map((tick) => (
                    <span key={tick}>{formatMagFilterValue(tick)}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.referenceBackground}</h4>
              <ToggleRow checked={showGrid} onChange={(checked) => schedulePosterUpdate(
                () => setShowGrid(checked),
                { showGrid: checked }
              )}>
                {uiText.raDecGrid}
              </ToggleRow>
              <ToggleRow checked={showEquator} onChange={(checked) => schedulePosterUpdate(
                () => setShowEquator(checked),
                { showEquator: checked }
              )}>
                {uiText.celestialEquator}
              </ToggleRow>
              <ToggleRow checked={showEcliptic} onChange={(checked) => schedulePosterUpdate(
                () => setShowEcliptic(checked),
                { showEcliptic: checked }
              )}>
                {uiText.eclipticPath}
              </ToggleRow>
              <ToggleRow checked={showMilkyWay} onChange={(checked) => schedulePosterUpdate(
                () => setShowMilkyWay(checked),
                { showMilkyWay: checked }
              )}>
                {uiText.milkyWayBand}
              </ToggleRow>
            </div>
          </div>

          {/* Export Actions */}
          <div className="control-group">
            <button className="btn-primary" onClick={exportSVG}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              {uiText.exportSvg}
            </button>
            <button className="btn-secondary" onClick={exportPNG}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              {uiText.exportPng}
            </button>
            <button className="btn-secondary" onClick={exportTiledPdf}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
              {uiText.exportTiledPdf}
            </button>
          </div>
        </div>

        <footer className="sidebar-footer">
          <p>© 2026 Astronomy Poster Builder</p>
          <p style={{ marginTop: '2px', opacity: 0.7 }}>Designed with Antigravity</p>
        </footer>
      </aside>

      {/* Main Preview Area */}
      <main
        ref={previewAreaRef}
        className="preview-area"
        onWheelCapture={handlePreviewWheelCapture}
      >
        <div className="preview-toolbar" aria-label="Preview scale controls">
          <button type="button" className="preview-tool-button" onClick={zoomPreviewToActualSize}>
            {uiText.actualSize}
          </button>
          <button type="button" className="preview-tool-button" onClick={fitPreviewToWindow}>
            {uiText.fitView}
          </button>
        </div>
        {(toast || isPosterRendering) && (
          <div className="preview-toast-stack" aria-live="polite">
            {isPosterRendering && (
              <div className="preview-render-toast" role="status">
                <span className="preview-render-spinner" aria-hidden="true"></span>
                <span className="preview-render-text">{posterRenderMessage}</span>
                <span className="preview-render-progress" aria-hidden="true"></span>
              </div>
            )}
            {toast && <div className="toast" role="status">{toast}</div>}
          </div>
        )}
        <div
          ref={posterMockupRef}
          className={`poster-preview-stage ${renderPosterLayout === 'portrait_single' ? 'portrait-stage' : ''}`}
        >
        <div
          className={`poster-mockup ${renderPosterLayout !== 'landscape_dual' ? 'is-hidden' : ''}`}
          style={hasTransparentPaper ? { backgroundColor: '#ffffff' } : undefined}
        >
          <div className="poster-svg-wrapper">
            {/* The absolute master SVG */}
            <svg
              id="poster-svg-landscape"
              data-export-svg={renderPosterLayout === 'landscape_dual' ? 'true' : undefined}
              data-export-suffix="landscape-dual"
              viewBox={`0 0 ${landscapeLayout.width} ${landscapeLayout.height}`}
              width={landscapeLayout.width}
              height={landscapeLayout.height}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Poster Board Fill */}
              <rect width={landscapeLayout.width} height={landscapeLayout.height} fill={posterBackgroundColor} />

              {/* Decorative Poster Borders */}
              {/* Outer frame border */}
              <rect x="25" y="25" width={landscapeLayout.width - 50} height={landscapeLayout.height - 50} fill="none" stroke={activeTheme.border} strokeWidth="3" />
              {/* Inner thin border */}
              <rect x="33" y="33" width={landscapeLayout.width - 66} height={landscapeLayout.height - 66} fill="none" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.6" />

              {/* Poster Title Block */}
              <g transform={`translate(${landscapeLayout.width / 2}, 95)`}>
                <text
                  x="0"
                  y="0"
                  textAnchor="middle"
                  fill={activeTheme.text.title}
                  fontFamily={activePosterFont}
                  fontSize={activeTypography.titleLandscape}
                  fontWeight="bold"
                  letterSpacing="4"
                >
                  {title}
                </text>
                <line x1="-250" y1="42" x2="250" y2="42" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.7" />
                <text
                  x="0"
                  y="62"
                  textAnchor="middle"
                  fill={activeTheme.text.body}
                  fontFamily={varFontPosterSans}
                  fontSize={activeTypography.noteLandscape}
                  fontWeight="500"
                  letterSpacing="2"
                  opacity="0.7"
                >
                  {customNote.toUpperCase()}
                </text>
              </g>

              {/* 1. NORTHERN CELESTIAL ATMOSPHERE */}
              <g transform="translate(455, 525)">
                {renderSphere(true, LANDSCAPE_R, 'landscape-')}
                <text
                  x="0"
                  y={LANDSCAPE_R + 42}
                  textAnchor="middle"
                  fill={activeTheme.text.title}
                  fontFamily={activePosterFont}
                  fontSize={activeTypography.hemisphereTitle}
                  fontWeight="bold"
                  letterSpacing="2.5"
                >
                  {getLocalizedText('北天恒星图', 'NORTHERN CELESTIAL ATMOSPHERE', 'en-first')}
                </text>
              </g>

              {/* 2. SOUTHERN CELESTIAL ATMOSPHERE */}
              <g transform="translate(1245, 525)">
                {renderSphere(false, LANDSCAPE_R, 'landscape-')}
                <text
                  x="0"
                  y={LANDSCAPE_R + 42}
                  textAnchor="middle"
                  fill={activeTheme.text.title}
                  fontFamily={activePosterFont}
                  fontSize={activeTypography.hemisphereTitle}
                  fontWeight="bold"
                  letterSpacing="2.5"
                >
                  {getLocalizedText('南天恒星图', 'SOUTHERN CELESTIAL ATMOSPHERE', 'en-first')}
                </text>
              </g>

              {/* Poster Bottom Info: Legend & Stars Catalog Table */}
              <g transform="translate(90, 1025)">
                {/* Divider Line */}
                <line x1="0" y1="-10" x2="1520" y2="-10" stroke={activeTheme.border} strokeWidth="1" opacity="0.5" />

                {/* Left side: Legend */}
                <g transform="translate(15, 10)">
                  {renderMapLegend({ keyPrefix: 'landscape', starSpacing: 45, lineColumnX: 195, lineRowGap: 15, titleLetterSpacing: 1.5 })}
                </g>

                {/* Usage Guide */}
                <g transform="translate(520, 10)">
                  {renderUsageGuide({ titleLetterSpacing: 1.5 })}
                </g>

                {/* Right side: Stars Catalog Table */}
                <g transform="translate(1040, 10)">
                  {renderBrightStarsTable({ keyPrefix: 'landscape', titleLetterSpacing: 1.5 })}
                </g>
              </g>
            </svg>
          </div>
        </div>
        <div className={`poster-export-set portrait-set ${renderPosterLayout !== 'portrait_single' ? 'is-hidden' : ''}`}>
          {[true, false].map((isNorth) => {
            const suffix = isNorth ? 'north' : 'south';
            const hemisphereTitle = isNorth
              ? getLocalizedText('北天恒星图', 'NORTHERN CELESTIAL ATMOSPHERE', 'en-first')
              : getLocalizedText('南天恒星图', 'SOUTHERN CELESTIAL ATMOSPHERE', 'en-first');

            return (
              <div
                className="poster-mockup portrait-mockup"
                key={suffix}
                style={hasTransparentPaper ? { backgroundColor: '#ffffff' } : undefined}
              >
                <div className="poster-svg-wrapper">
                  <svg
                    id={`poster-svg-${suffix}`}
                    data-export-svg={renderPosterLayout === 'portrait_single' ? 'true' : undefined}
                    data-export-suffix={`portrait-${suffix}`}
                    viewBox={`0 0 ${portraitLayout.width} ${portraitLayout.height}`}
                    width={portraitLayout.width}
                    height={portraitLayout.height}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect width={portraitLayout.width} height={portraitLayout.height} fill={posterBackgroundColor} />
                    <rect x="25" y="25" width={portraitLayout.width - 50} height={portraitLayout.height - 50} fill="none" stroke={activeTheme.border} strokeWidth="3" />
                    <rect x="33" y="33" width={portraitLayout.width - 66} height={portraitLayout.height - 66} fill="none" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.6" />

                    <g transform={`translate(${portraitLayout.width / 2}, 92)`}>
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fill={activeTheme.text.title}
                        fontFamily={activePosterFont}
                        fontSize={activeTypography.titlePortrait}
                        fontWeight="bold"
                        letterSpacing="3"
                      >
                        {title}
                      </text>
                      <line x1="-210" y1="38" x2="210" y2="38" stroke={activeTheme.border} strokeWidth="0.8" opacity="0.7" />
                      <text
                        x="0"
                        y="58"
                        textAnchor="middle"
                        fill={activeTheme.text.body}
                        fontFamily={varFontPosterSans}
                        fontSize={activeTypography.notePortrait}
                        fontWeight="500"
                        letterSpacing="1.5"
                        opacity="0.7"
                      >
                        {customNote.toUpperCase()}
                      </text>
                    </g>

                    <g transform={`translate(${portraitLayout.width / 2}, 710)`}>
                      {renderSphere(isNorth, PORTRAIT_R, `portrait-${suffix}-`)}
                      <text
                        x="0"
                        y={PORTRAIT_R + 48}
                        textAnchor="middle"
                        fill={activeTheme.text.title}
                        fontFamily={activePosterFont}
                        fontSize={activeTypography.hemisphereTitle}
                        fontWeight="bold"
                        letterSpacing="2.2"
                      >
                        {hemisphereTitle}
                      </text>
                    </g>

                    <g transform="translate(80, 1485)">
                      <line x1="0" y1="-12" x2="1040" y2="-12" stroke={activeTheme.border} strokeWidth="1" opacity="0.5" />

                      <g transform="translate(0, 12)">
                        {renderMapLegend({ keyPrefix: `portrait-${suffix}`, starSpacing: 42, lineColumnX: 188, lineRowGap: 15, titleLetterSpacing: 1.4 })}
                      </g>

                      <g transform="translate(405, 12)">
                        {renderUsageGuide({ titleLetterSpacing: 1.4, maxTextWidth: 275 })}
                      </g>

                      <g transform="translate(725, 12)">
                        {renderBrightStarsTable({
                          keyPrefix: `portrait-${suffix}`,
                          titleLetterSpacing: 1.4,
                          headerY: 24,
                          rowStartY: 39,
                          rowGap: 16,
                          columns: { mag: 120, ra: 158, dec: 214, sp: 260 },
                        })}
                      </g>
                    </g>
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </main>
      {inputDebugEnabled && inputProbe && (
        <div className="input-probe" aria-live="polite">
          <div>phase: {inputProbe.phase}</div>
          <div>event: {inputProbe.type} ctrl={String(inputProbe.ctrlKey)}</div>
          <div>cancelable={String(inputProbe.cancelable)} prevented={String(inputProbe.defaultPrevented)}</div>
          <div>preview={String(inputProbe.inPreview)} point={inputProbe.clientX},{inputProbe.clientY} ({inputProbe.pointSource})</div>
          <div>delta={inputProbe.deltaX},{inputProbe.deltaY} scale={inputProbe.scale || '-'}</div>
          <div>viewport={inputProbe.visualScale} target={inputProbe.target || '-'}</div>
          <div>{inputProbe.time}</div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default App;
