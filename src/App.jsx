import { useState, useEffect, useMemo, useRef, useTransition } from 'react';
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
const CSS_PX_PER_MM = 96 / 25.4;

const getInitialLanguageMode = () => {
  if (typeof window === 'undefined') return 'en';
  const mode = new URLSearchParams(window.location.search).get('hl');
  return LANGUAGE_MODES.has(mode) ? mode : 'en';
};

const getDisplayLanguage = (mode) => mode === 'zh' ? 'zh' : 'en';

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
    constellationLines: 'Constellation Lines',
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
    exportSvg: 'Export Vector SVG',
    exportPng: 'Export Print PNG',
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
  },
  zh: {
    appSubtitle: '全天星座星图印刷海报生成器',
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
    constellationLines: '星座连线',
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
    exportSvg: '导出无损矢量 SVG',
    exportPng: '导出印刷级高清 PNG',
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

function App() {
  // --- State Variables ---
  const [stars, setStars] = useState([]);
  const [westernConstellations, setWesternConstellations] = useState([]);
  const [chineseConstellations, setChineseConstellations] = useState([]);
  const [boundaries, setBoundaries] = useState({});
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

  // --- Poster & Layout Settings ---
  const [labelLanguageMode, setLabelLanguageMode] = useState(getInitialLanguageMode);
  const displayLanguage = getDisplayLanguage(labelLanguageMode);
  const uiText = UI_TEXT[displayLanguage];
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
  const [showWesternLines, setShowWesternLines] = useState(true);
  const [showWesternBoundaries, setShowWesternBoundaries] = useState(true);
  const [showWesternBoundaryFills, setShowWesternBoundaryFills] = useState(false);
  const [showWesternNames, setShowWesternNames] = useState(true);

  const [showChineseLines, setShowChineseLines] = useState(false);
  const [showChineseNames, setShowChineseNames] = useState(false);

  const [showGrid, setShowGrid] = useState(false);
  const [showEquator, setShowEquator] = useState(false);
  const [showEcliptic, setShowEcliptic] = useState(false);
  const [showMilkyWay, setShowMilkyWay] = useState(true);
  const [showStarNames, setShowStarNames] = useState(true);

  const hidePosterRenderNoticeSoon = () => {
    if (renderNoticeTimerRef.current !== null) {
      clearTimeout(renderNoticeTimerRef.current);
    }

    renderNoticeTimerRef.current = window.setTimeout(() => {
      renderNoticeTimerRef.current = null;
      setIsPosterRendering(false);
    }, 240);
  };

  const schedulePosterUpdate = (update) => {
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
          update();
        });
        requestAnimationFrame(hidePosterRenderNoticeSoon);
      });
    });
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('hl', labelLanguageMode);
    window.history.replaceState(null, '', url);
  }, [labelLanguageMode]);

  useEffect(() => () => {
    if (renderNoticeTimerRef.current !== null) {
      clearTimeout(renderNoticeTimerRef.current);
    }
    if (renderNoticeFrameRef.current !== null) {
      cancelAnimationFrame(renderNoticeFrameRef.current);
    }
  }, []);

  // --- Fetch Data ---
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Fetch JSON files compiled by ingest script
        const basePath = import.meta.env.BASE_URL || '/';
        const [starsRes, westernRes, chineseRes, boundariesRes] = await Promise.all([
          fetch(`${basePath}data/stars.normalized.json`).then(r => r.json()),
          fetch(`${basePath}data/constellations.western.json`).then(r => r.json()),
          fetch(`${basePath}data/constellations.chinese.json`).then(r => r.json()),
          fetch(`${basePath}data/boundaries.json`).then(r => r.json()),
        ]);

        setStars(starsRes);
        setWesternConstellations(westernRes);
        setChineseConstellations(chineseRes);
        setBoundaries(boundariesRes);
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
  const activeTheme = useMemo(() => THEMES[themeId] || THEMES.classic_navy, [themeId]);
  const activeTypography = useMemo(() => ({
    ...DEFAULT_TYPOGRAPHY,
    ...(activeTheme.typography || {}),
  }), [activeTheme]);
  const hasTransparentPaper = transparentBackground || activeTheme.paperTransparent;
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

  // --- Centroid Calculation for Constellations (Spherical Average) ---
  const getConstellationCentroid = (edges) => {
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
  };

  // --- Centroid Lookup for Constellations ---
  const westernCenters = useMemo(() => {
    const centers = {};
    for (const con of westernConstellations) {
      const center = getConstellationCentroid(con.edges);
      if (center) centers[con.abbr] = center;
    }
    return centers;
  }, [westernConstellations, starsMap]);

  const chineseCenters = useMemo(() => {
    const centers = {};
    for (const asterism of chineseConstellations) {
      const center = getConstellationCentroid(asterism.edges);
      if (center) centers[asterism.id] = center;
    }
    return centers;
  }, [chineseConstellations, starsMap]);

  const boundarySegments = useMemo(() => buildBoundarySegments(boundaries), [boundaries]);
  const boundaryColorMap = useMemo(() => (
    colorBoundaryGraph(boundaries, Math.min(4, CONSTELLATION_FILL_PALETTE.length))
  ), [boundaries]);

  const constellationStarHips = useMemo(() => {
    const hips = new Set();
    if (showWesternLines) {
      for (const con of westernConstellations) {
        for (const [hip1, hip2] of con.edges) {
          hips.add(hip1);
          hips.add(hip2);
        }
      }
    }
    if (showChineseLines) {
      for (const asterism of chineseConstellations) {
        for (const [hip1, hip2] of asterism.edges) {
          hips.add(hip1);
          hips.add(hip2);
        }
      }
    }
    return hips;
  }, [westernConstellations, chineseConstellations, showWesternLines, showChineseLines]);

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

  const getLocalizedText = (zh, en, order = 'zh-first') => {
    if (labelLanguageMode === "zh") return zh || en || "";
    if (labelLanguageMode === "en" || labelLanguageMode === "both") return en || zh || "";
    const primary = order === 'en-first' ? en : zh;
    const secondary = order === 'en-first' ? zh : en;
    return [primary, secondary].filter(Boolean).join(' / ');
  };

  // --- Poster dimensions and radius of the main circular spheres ---
  const landscapeLayout = POSTER_LAYOUTS.landscape_dual;
  const portraitLayout = POSTER_LAYOUTS.portrait_single;
  const LANDSCAPE_R = landscapeLayout.sphereRadius;
  const PORTRAIT_R = portraitLayout.sphereRadius;
  const formatMagFilterValue = (value) => {
    if (value <= MAG_RANGE_MIN) return '0-';
    if (value >= MAG_RANGE_PLUS) return '6+';
    return `${Math.round(value)}`;
  };
  const isMagnitudeVisible = (star) => {
    const passesMin = minMagLimit <= MAG_RANGE_MIN
      ? true
      : minMagLimit >= MAG_RANGE_PLUS
        ? star.mag >= 6
        : star.mag >= minMagLimit;
    const passesMax = magLimit >= MAG_RANGE_PLUS ? true : star.mag <= magLimit;
    return passesMin && passesMax;
  };
  const isStarVisible = (star) => constellationStarHips.has(star.hip) || isMagnitudeVisible(star);

  const updateMinMagLimit = (value) => {
    schedulePosterUpdate(() => {
      setMinMagLimit(Math.min(value, magLimit));
    });
  };

  const updateMagLimit = (value) => {
    schedulePosterUpdate(() => {
      setMagLimit(value);
      setMinMagLimit((current) => Math.min(current, value));
    });
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

    const layout = posterLayout === 'landscape_dual'
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
    const projectFn = isNorth
      ? (ra, dec) => projectNorth(ra, dec, sphereRadius, projection, -overlapDec, northRotation)
      : (ra, dec) => projectSouth(ra, dec, sphereRadius, projection, overlapDec, southRotation);
    const limitDec = isNorth ? -overlapDec : overlapDec;
    const clipId = `${clipPrefix}${isNorth ? "north-clip" : "south-clip"}`;

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

    const boundaryFillRegions = showWesternBoundaries && showWesternBoundaryFills
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
    if (showWesternNames) {
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
    if (showChineseNames) {
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
    if (showStarNames) {
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
          {showMilkyWay && (
            <g opacity="0.8">
              {mwOuterPath && <path d={mwOuterPath} fill={activeTheme.galactic.fill} />}
              {mwInnerPath && <path d={mwInnerPath} fill={activeTheme.galactic.fill} opacity="0.7" />}
              {mwOuterPath && <path d={mwOuterPath} fill="none" stroke={activeTheme.galactic.stroke} strokeWidth="0.8" strokeDasharray="3 6" />}
            </g>
          )}

          {/* Coordinate Grids - Declination Circles */}
          {showGrid && grid.decCircles.map((circle, idx) => {
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
          {showGrid && grid.raRadials.map((radial, idx) => {
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
          {showEquator && equatorPath && (
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
          {showEcliptic && eclipticPath && (
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
          {showWesternBoundaries && boundaryPath && (
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
          {showChineseLines && chineseConstellations.map((ast, idx) => {
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
          {showWesternLines && westernConstellations.map((con, idx) => {
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
            const color = getStarColorHSL(s.colorIdx, themeId);
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

            const isChinese = lbl.type === 'chinese_asterism' || (lbl.type === 'star' && showChineseLines);
            const fontF = isChinese 
              ? (fontFamily === "serif" ? "'Noto Serif SC', serif" : "'Noto Sans SC', sans-serif")
              : (fontFamily === "serif" ? varFontPosterSerif : varFontPosterSans);

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
  const activePosterFont = fontFamily === "serif" ? varFontPosterSerif : varFontPosterSans;
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
      {/* Toast Notice */}
      {toast && <div className="toast">{toast}</div>}

      {/* Glassmorphic Sidebar Controls */}
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1><span>ALLSKY</span> ATLAS</h1>
          <p>{uiText.appSubtitle}</p>
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
                onChange={(e) => schedulePosterUpdate(() => setThemeId(e.target.value))}
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
                  onClick={() => schedulePosterUpdate(() => setPosterLayout('landscape_dual'))}
                >
                  {uiText.layoutLandscapeDual}
                </button>
                <button
                  type="button"
                  className={`segment-button ${posterLayout === 'portrait_single' ? 'active' : ''}`}
                  onClick={() => schedulePosterUpdate(() => setPosterLayout('portrait_single'))}
                >
                  {uiText.layoutPortraitSingle}
                </button>
              </div>
            </div>
            <ToggleRow
              checked={hasTransparentPaper}
              onChange={(checked) => schedulePosterUpdate(() => setTransparentBackground(checked))}
              muted={activeTheme.paperTransparent}
            >
              {uiText.transparentBackground}
            </ToggleRow>
            <div className="form-field">
              <label>{uiText.fontFamily}</label>
              <select
                className="select-input"
                value={fontFamily}
                onChange={(e) => schedulePosterUpdate(() => setFontFamily(e.target.value))}
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
                onChange={(e) => schedulePosterUpdate(() => setLabelLanguageMode(e.target.value))}
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
                onChange={(e) => schedulePosterUpdate(() => setProjection(e.target.value))}
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
                onChange={(e) => schedulePosterUpdate(() => setOverlapDec(parseInt(e.target.value)))}
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
                onChange={(e) => schedulePosterUpdate(() => setNorthRotation(parseInt(e.target.value)))}
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
                onChange={(e) => schedulePosterUpdate(() => setSouthRotation(parseInt(e.target.value)))}
              />
            </div>
          </div>

          {/* Group 4: Layout Layers */}
          <div className="control-group">
            <h3 className="control-group-title">{uiText.layerDisplay}</h3>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.modernConstellations}</h4>
              <ToggleRow checked={showWesternLines} onChange={(checked) => schedulePosterUpdate(() => setShowWesternLines(checked))}>
                {uiText.constellationLines}
              </ToggleRow>
              <ToggleRow checked={showWesternNames} onChange={(checked) => schedulePosterUpdate(() => setShowWesternNames(checked))}>
                {uiText.constellationNames}
              </ToggleRow>
              <ToggleRow checked={showWesternBoundaries} onChange={(checked) => schedulePosterUpdate(() => setShowWesternBoundaries(checked))}>
                {uiText.iauBoundaries}
              </ToggleRow>
              <ToggleRow
                checked={showWesternBoundaryFills}
                onChange={(checked) => schedulePosterUpdate(() => setShowWesternBoundaryFills(checked))}
                indented
                muted={!showWesternBoundaries}
              >
                {uiText.constellationRegionColors}
              </ToggleRow>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.chineseAsterisms}</h4>
              <ToggleRow checked={showChineseLines} onChange={(checked) => schedulePosterUpdate(() => setShowChineseLines(checked))}>
                {uiText.asterismLines}
              </ToggleRow>
              <ToggleRow checked={showChineseNames} onChange={(checked) => schedulePosterUpdate(() => setShowChineseNames(checked))}>
                {uiText.asterismNames}
              </ToggleRow>
            </div>

            <div className="control-subgroup">
              <h4 className="control-subgroup-title">{uiText.starLabels}</h4>
              <ToggleRow checked={showStarNames} onChange={(checked) => schedulePosterUpdate(() => setShowStarNames(checked))}>
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
              <ToggleRow checked={showGrid} onChange={(checked) => schedulePosterUpdate(() => setShowGrid(checked))}>
                {uiText.raDecGrid}
              </ToggleRow>
              <ToggleRow checked={showEquator} onChange={(checked) => schedulePosterUpdate(() => setShowEquator(checked))}>
                {uiText.celestialEquator}
              </ToggleRow>
              <ToggleRow checked={showEcliptic} onChange={(checked) => schedulePosterUpdate(() => setShowEcliptic(checked))}>
                {uiText.eclipticPath}
              </ToggleRow>
              <ToggleRow checked={showMilkyWay} onChange={(checked) => schedulePosterUpdate(() => setShowMilkyWay(checked))}>
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
        {isPosterRendering && (
          <div className="preview-render-toast" role="status" aria-live="polite">
            <span className="preview-render-spinner" aria-hidden="true"></span>
            <span className="preview-render-text">{posterRenderMessage}</span>
            <span className="preview-render-progress" aria-hidden="true"></span>
          </div>
        )}
        <div
          ref={posterMockupRef}
          className={`poster-preview-stage ${posterLayout === 'portrait_single' ? 'portrait-stage' : ''}`}
        >
        <div
          className={`poster-mockup ${posterLayout !== 'landscape_dual' ? 'is-hidden' : ''}`}
          style={hasTransparentPaper ? { backgroundColor: '#ffffff' } : undefined}
        >
          <div className="poster-svg-wrapper">
            {/* The absolute master SVG */}
            <svg
              id="poster-svg-landscape"
              data-export-svg={posterLayout === 'landscape_dual' ? 'true' : undefined}
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
                  <text x="0" y="5" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing="1.5">{getLocalizedText('星图图例', 'MAP LEGEND', 'en-first')}</text>
                  
                  {/* Star magnitude legend scales */}
                  <g transform="translate(0, 26)">
                    {[1.0, 2.0, 3.0, 4.0, 5.0, 6.0].map((mag, i) => {
                      const r = Math.max(0.5, 4.5 - 0.6 * mag);
                      const xOffset = i * 45;
                      const isRetro = activeTheme.stars.retroRings;

                      return (
                        <g key={`leg-star-${i}`} transform={`translate(${xOffset}, 0)`}>
                          {isRetro ? (
                            <g>
                              <circle cx="0" cy="0" r={Math.max(0.5, 2.0 - 0.25 * mag)} fill="#201e1a" />
                              <circle cx="0" cy="0" r={Math.max(1.2, 5.0 - 0.65 * mag)} fill="none" stroke="#d4af37" strokeWidth="0.8" />
                            </g>
                          ) : (
                            <circle cx="0" cy="0" r={r} fill={getStarColorHSL(0.2, themeId)} stroke={activeTheme.stars.stroke || 'none'} strokeWidth={activeTheme.stars.strokeWidth || 0} />
                          )}
                          <text x="0" y="16" textAnchor="middle" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>{mag.toFixed(0)}m</text>
                        </g>
                      );
                    })}
                  </g>

                  {/* References lines legend */}
                  <g transform="translate(290, 10)" fontSize={activeTypography.legendBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
                    <g transform="translate(0, 0)">
                      <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.equator.color} strokeWidth="1.2" strokeDasharray={activeTheme.equator.dash} />
                      <text x="35" y="3.5">{getLocalizedText('天球赤道', 'Celestial Equator', 'en-first')}</text>
                    </g>
                    <g transform="translate(0, 15)">
                      <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.ecliptic.color} strokeWidth="1.2" strokeDasharray={activeTheme.ecliptic.dash} />
                      <text x="35" y="3.5">{getLocalizedText('黄道轨道', 'Ecliptic Path', 'en-first')}</text>
                    </g>
                    <g transform="translate(0, 30)">
                      <rect x="0" y="-4" width="25" height="8" fill={activeTheme.galactic.fill} stroke={activeTheme.galactic.stroke} strokeWidth="0.8" strokeDasharray="2 3" />
                      <text x="35" y="3.5">{getLocalizedText('银道带', 'Milky Way Plane', 'en-first')}</text>
                    </g>
                  </g>
                  
                  <g transform="translate(485, 10)" fontSize={activeTypography.legendBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
                    <g transform="translate(0, 0)">
                      <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.constellations.line} strokeWidth="1" opacity={activeTheme.constellations.lineOpacity} />
                      <text x="35" y="3.5">{getLocalizedText('星座连线', 'Constellation Line', 'en-first')}</text>
                    </g>
                    <g transform="translate(0, 15)">
                      <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.constellations.boundary} strokeWidth="0.8" strokeDasharray={activeTheme.constellations.boundaryDash} />
                      <text x="35" y="3.5">{getLocalizedText('星座边界', 'IAU Boundary', 'en-first')}</text>
                    </g>
                    <g transform="translate(0, 30)">
                      <line x1="0" y1="0" x2="25" y2="0" stroke={activeTheme.chinese.line} strokeWidth="1" opacity={activeTheme.chinese.lineOpacity} />
                      <text x="35" y="3.5">{getLocalizedText('星官连线', 'Chinese Asterism', 'en-first')}</text>
                    </g>
                  </g>
                </g>

                {/* Source Code */}
                <g transform="translate(15, 82)">
                  <text x="0" y="0" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.legendBody} fontWeight="bold" letterSpacing="1.2">
                    {getLocalizedText('源代码', 'SOURCE CODE', 'en-first')}
                  </text>
                  <a href="https://github.com/askman-dev/allsky-atlas" target="_blank" rel="noreferrer">
                    <text x="0" y="15" fill={activeTheme.text.subtitle} fontFamily={varFontPosterSans} fontSize={activeTypography.legendBody} fontWeight="600">
                      github.com/askman-dev/allsky-atlas
                    </text>
                  </a>
                </g>

                {/* Map Terms */}
                <g transform="translate(290, 82)">
                  <text x="0" y="0" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.legendBody} fontWeight="bold" letterSpacing="1.2">
                    {getLocalizedText('名词解释', 'MAP TERMS', 'en-first')}
                  </text>
                  <text x="0" y="15" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
                    {getLocalizedText('赤经小时: 赤经以小时标示，24h 环绕天球一周。', 'RA Hours: right ascension is measured in hours; 24h completes 360 degrees.', 'en-first')}
                  </text>
                  <text x="0" y="28" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
                    {getLocalizedText('北天: 以北天极为中心，北极星靠近图心。', 'Northern Sky: centered on the north celestial pole, near Polaris.', 'en-first')}
                  </text>
                  <text x="0" y="41" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
                    {getLocalizedText('南天: 以南天极为中心展开。', 'Southern Sky: centered on the south celestial pole.', 'en-first')}
                  </text>
                </g>

                {/* Right side: Stars Catalog Table */}
                <g transform="translate(1040, 10)">
                  <text x="0" y="5" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing="1.5">{getLocalizedText('亮恒星星表', 'BRIGHT CELESTIAL BODIES', 'en-first')}</text>
                  
                  {/* Table Header */}
                  <g transform="translate(0, 20)" fontSize={activeTypography.tableHeader} fontFamily={varFontPosterSans} fontWeight="600" fill={activeTheme.text.subtitle}>
                    <text x="0" y="0">{getLocalizedText('恒星名称', 'STAR NAME', 'en-first')}</text>
                    <text x="140" y="0">MAG</text>
                    <text x="180" y="0">R.A.</text>
                    <text x="240" y="0">DEC.</text>
                    <text x="290" y="0">SP.</text>
                  </g>

                  {/* Table Rows (Dynamic from dataset!) */}
                  {brightestStars.map((star, i) => {
                    const y = 33 + i * 11;
                    const spectralClass = star.colorIdx < -0.1 ? 'O/B' :
                                          star.colorIdx < 0.3 ? 'A' :
                                          star.colorIdx < 0.5 ? 'F' :
                                          star.colorIdx < 0.8 ? 'G' :
                                          star.colorIdx < 1.3 ? 'K' : 'M';
                    return (
                      <g key={`table-row-${i}`} transform={`translate(0, ${y})`} fontSize={activeTypography.tableBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
                        <text x="0" y="0" fontWeight="500">{getLocalizedText(star.nameZh, star.nameEn)}</text>
                        <text x="140" y="0">{star.mag.toFixed(2)}</text>
                        <text x="180" y="0">{formatRA(star.ra)}</text>
                        <text x="240" y="0">{formatDec(star.dec)}</text>
                        <text x="290" y="0">{spectralClass}</text>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>
          </div>
        </div>
        <div className={`poster-export-set portrait-set ${posterLayout !== 'portrait_single' ? 'is-hidden' : ''}`}>
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
                    data-export-svg={posterLayout === 'portrait_single' ? 'true' : undefined}
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

                    <g transform="translate(80, 1305)">
                      <line x1="0" y1="-12" x2="1040" y2="-12" stroke={activeTheme.border} strokeWidth="1" opacity="0.5" />

                      <g transform="translate(0, 12)">
                        <text x="0" y="0" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing="1.4">
                          {getLocalizedText('星图图例', 'MAP LEGEND', 'en-first')}
                        </text>
                        <g transform="translate(0, 28)">
                          {[1.0, 2.0, 3.0, 4.0, 5.0, 6.0].map((mag, i) => {
                            const r = Math.max(0.5, 4.5 - 0.6 * mag);
                            const xOffset = i * 42;
                            const isRetro = activeTheme.stars.retroRings;

                            return (
                              <g key={`portrait-leg-star-${suffix}-${i}`} transform={`translate(${xOffset}, 0)`}>
                                {isRetro ? (
                                  <g>
                                    <circle cx="0" cy="0" r={Math.max(0.5, 2.0 - 0.25 * mag)} fill="#201e1a" />
                                    <circle cx="0" cy="0" r={Math.max(1.2, 5.0 - 0.65 * mag)} fill="none" stroke="#d4af37" strokeWidth="0.8" />
                                  </g>
                                ) : (
                                  <circle cx="0" cy="0" r={r} fill={getStarColorHSL(0.2, themeId)} stroke={activeTheme.stars.stroke || 'none'} strokeWidth={activeTheme.stars.strokeWidth || 0} />
                                )}
                                <text x="0" y="16" textAnchor="middle" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>{mag.toFixed(0)}m</text>
                              </g>
                            );
                          })}
                        </g>
                        <g transform="translate(0, 78)" fontSize={activeTypography.legendBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
                          <g transform="translate(0, 0)">
                            <line x1="0" y1="0" x2="24" y2="0" stroke={activeTheme.equator.color} strokeWidth="1.2" strokeDasharray={activeTheme.equator.dash} />
                            <text x="34" y="3.5">{getLocalizedText('天球赤道', 'Celestial Equator', 'en-first')}</text>
                          </g>
                          <g transform="translate(0, 18)">
                            <line x1="0" y1="0" x2="24" y2="0" stroke={activeTheme.ecliptic.color} strokeWidth="1.2" strokeDasharray={activeTheme.ecliptic.dash} />
                            <text x="34" y="3.5">{getLocalizedText('黄道轨道', 'Ecliptic Path', 'en-first')}</text>
                          </g>
                          <g transform="translate(0, 36)">
                            <line x1="0" y1="0" x2="24" y2="0" stroke={activeTheme.constellations.line} strokeWidth="1" opacity={activeTheme.constellations.lineOpacity} />
                            <text x="34" y="3.5">{getLocalizedText('星座连线', 'Constellation Line', 'en-first')}</text>
                          </g>
                        </g>
                      </g>

                      <g transform="translate(0, 170)">
                        <text x="0" y="0" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.legendBody} fontWeight="bold" letterSpacing="1.2">
                          {getLocalizedText('名词解释', 'MAP TERMS', 'en-first')}
                        </text>
                        <text x="0" y="18" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
                          {isNorth
                            ? getLocalizedText('北天: 以北天极为中心，北极星靠近图心。', 'Northern Sky: centered on the north celestial pole, near Polaris.', 'en-first')
                            : getLocalizedText('南天: 以南天极为中心展开。', 'Southern Sky: centered on the south celestial pole.', 'en-first')}
                        </text>
                        <text x="0" y="34" fill={activeTheme.text.body} fontFamily={varFontPosterSans} fontSize={activeTypography.legendSmall}>
                          {getLocalizedText('赤经小时: 赤经以小时标示，24h 环绕天球一周。', 'RA Hours: right ascension is measured in hours; 24h completes 360 degrees.', 'en-first')}
                        </text>
                        <a href="https://github.com/askman-dev/allsky-atlas" target="_blank" rel="noreferrer">
                          <text x="0" y="58" fill={activeTheme.text.subtitle} fontFamily={varFontPosterSans} fontSize={activeTypography.legendBody} fontWeight="600">
                            github.com/askman-dev/allsky-atlas
                          </text>
                        </a>
                      </g>

                      <g transform="translate(610, 12)">
                        <text x="0" y="0" fill={activeTheme.text.title} fontFamily={activePosterFont} fontSize={activeTypography.sectionTitle} fontWeight="bold" letterSpacing="1.4">
                          {getLocalizedText('亮恒星星表', 'BRIGHT CELESTIAL BODIES', 'en-first')}
                        </text>
                        <g transform="translate(0, 24)" fontSize={activeTypography.tableHeader} fontFamily={varFontPosterSans} fontWeight="600" fill={activeTheme.text.subtitle}>
                          <text x="0" y="0">{getLocalizedText('恒星名称', 'STAR NAME', 'en-first')}</text>
                          <text x="132" y="0">MAG</text>
                          <text x="172" y="0">R.A.</text>
                          <text x="232" y="0">DEC.</text>
                          <text x="282" y="0">SP.</text>
                        </g>

                        {brightestStars.map((star, i) => {
                          const y = 39 + i * 16;
                          const spectralClass = star.colorIdx < -0.1 ? 'O/B' :
                                                star.colorIdx < 0.3 ? 'A' :
                                                star.colorIdx < 0.5 ? 'F' :
                                                star.colorIdx < 0.8 ? 'G' :
                                                star.colorIdx < 1.3 ? 'K' : 'M';
                          return (
                            <g key={`portrait-table-row-${suffix}-${i}`} transform={`translate(0, ${y})`} fontSize={activeTypography.tableBody} fontFamily={varFontPosterSans} fill={activeTheme.text.body}>
                              <text x="0" y="0" fontWeight="500">{getLocalizedText(star.nameZh, star.nameEn)}</text>
                              <text x="132" y="0">{star.mag.toFixed(2)}</text>
                              <text x="172" y="0">{formatRA(star.ra)}</text>
                              <text x="232" y="0">{formatDec(star.dec)}</text>
                              <text x="282" y="0">{spectralClass}</text>
                            </g>
                          );
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
    </div>
  );
}

export default App;
