// Themes configuration for Allsky Star Map Poster Generator

export const THEMES = {
  classic_navy: {
    id: "classic_navy",
    name: "Classic Navy (经典深蓝)",
    background: "#071124",
    posterBg: "#0a192f",
    border: "#d4af37", // Gold
    borderOuter: "#050d1a",
    stars: {
      useSpectralColors: true,
      glow: true,
      defaultColor: "#ffffff",
    },
    constellations: {
      line: "#d4af37", // Gold
      lineOpacity: 0.4,
      boundary: "rgba(212, 175, 55, 0.25)",
      boundaryDash: "4 4",
      label: "#e5c158",
    },
    chinese: {
      line: "#319795", // Teal
      lineOpacity: 0.6,
      label: "#4fd1c5",
    },
    grid: {
      color: "rgba(255, 255, 255, 0.08)",
      text: "rgba(255, 255, 255, 0.4)",
    },
    ecliptic: {
      color: "#e53e3e", // Red
      dash: "5 5",
      opacity: 0.7,
    },
    equator: {
      color: "#3182ce", // Blue
      dash: "6 4",
      opacity: 0.7,
    },
    galactic: {
      fill: "rgba(100, 180, 255, 0.06)",
      stroke: "rgba(100, 180, 255, 0.12)",
    },
    text: {
      title: "#d4af37",
      subtitle: "#a0aec0",
      body: "#cbd5e0",
      legend: "#e2e8f0",
    },
  },
  deep_space: {
    id: "deep_space",
    name: "Deep Space (深空霓虹)",
    background: "#020205",
    posterBg: "#030308",
    border: "#00adb5", // Cyan
    borderOuter: "#010103",
    stars: {
      useSpectralColors: true,
      glow: true,
      defaultColor: "#00f5ff",
    },
    constellations: {
      line: "#00f5ff", // Neon Cyan
      lineOpacity: 0.5,
      boundary: "rgba(255, 46, 147, 0.2)", // Neon pink
      boundaryDash: "3 3",
      label: "#00f5ff",
    },
    chinese: {
      line: "#ff7a00", // Orange
      lineOpacity: 0.6,
      label: "#ff9f43",
    },
    grid: {
      color: "rgba(0, 173, 181, 0.06)",
      text: "rgba(0, 173, 181, 0.3)",
    },
    ecliptic: {
      color: "#ff2e63", // Neon Magenta
      dash: "3 3",
      opacity: 0.8,
    },
    equator: {
      color: "#08d9d6", // Turquoise
      dash: "5 3",
      opacity: 0.7,
    },
    galactic: {
      fill: "rgba(147, 51, 234, 0.08)", // Purple
      stroke: "rgba(147, 51, 234, 0.15)",
    },
    text: {
      title: "#00adb5",
      subtitle: "#90e0ef",
      body: "#e0f2fe",
      legend: "#ffffff",
    },
  },
  elegant_white: {
    id: "elegant_white",
    name: "Elegant White (极简黑白)",
    background: "#fcfcf9",
    posterBg: "#ffffff",
    border: "#1a1a1a", // Ink black
    borderOuter: "#eaeaea",
    stars: {
      useSpectralColors: false,
      glow: false,
      defaultColor: "#1a1a1a",
    },
    constellations: {
      line: "#4a4a4a", // Charcoal
      lineOpacity: 0.3,
      boundary: "rgba(0, 0, 0, 0.12)",
      boundaryDash: "3 3",
      label: "#333333",
    },
    chinese: {
      line: "#7a3e3e", // Reddish brown
      lineOpacity: 0.5,
      label: "#6b2d2d",
    },
    grid: {
      color: "rgba(0, 0, 0, 0.05)",
      text: "rgba(0, 0, 0, 0.4)",
    },
    ecliptic: {
      color: "#a63a50", // Soft dark red
      dash: "4 4",
      opacity: 0.6,
    },
    equator: {
      color: "#52796f", // Slate green
      dash: "5 4",
      opacity: 0.6,
    },
    galactic: {
      fill: "rgba(0, 0, 0, 0.03)",
      stroke: "rgba(0, 0, 0, 0.06)",
    },
    text: {
      title: "#1a1a1a",
      subtitle: "#4a4a4a",
      body: "#2d3748",
      legend: "#1a1a1a",
    },
  },
  qirui_retro: {
    id: "qirui_retro",
    name: "Retro Parchment (齐锐版古风)",
    background: "#f4eedb",
    posterBg: "#eedfae",
    border: "#8c531d", // Brown ink
    borderOuter: "#ebdcb9",
    stars: {
      useSpectralColors: false,
      glow: false,
      defaultColor: "#2a2825",
      retroRings: true, // Special retro effect: draw colored ring around black dot
    },
    constellations: {
      line: "#a63a2b", // Cinnabar Red
      lineOpacity: 0.5,
      boundary: "rgba(85, 107, 47, 0.3)", // Moss green
      boundaryDash: "4 3",
      label: "#a63a2b",
    },
    chinese: {
      line: "#1f4e79", // Prussian Blue
      lineOpacity: 0.6,
      label: "#1f4e79",
    },
    grid: {
      color: "rgba(139, 69, 19, 0.07)",
      text: "rgba(139, 69, 19, 0.5)",
    },
    ecliptic: {
      color: "#b8860b", // Goldenrod
      dash: "5 5",
      opacity: 0.7,
    },
    equator: {
      color: "#2c3e50", // Dark Slate
      dash: "6 3",
      opacity: 0.6,
    },
    galactic: {
      fill: "rgba(139, 90, 43, 0.06)",
      stroke: "rgba(139, 90, 43, 0.12)",
    },
    text: {
      title: "#5c3317", // Sepia/Brown
      subtitle: "#6e4720",
      body: "#2c2c2c",
      legend: "#5c3317",
    },
  },
  a4_print_color: {
    id: "a4_print_color",
    name: "A4 Print Color (A4 彩印清晰)",
    background: "none",
    posterBg: "none",
    border: "#1f2937",
    borderOuter: "#d1d5db",
    paperTransparent: true,
    stars: {
      useSpectralColors: true,
      glow: false,
      defaultColor: "#111827",
      stroke: "#111827",
      strokeWidth: 0.35,
    },
    constellations: {
      line: "#3b3b8f",
      lineOpacity: 0.72,
      boundary: "rgba(75, 85, 99, 0.42)",
      boundaryDash: "3 3",
      label: "#25256f",
    },
    chinese: {
      line: "#006b5b",
      lineOpacity: 0.78,
      label: "#005a4d",
    },
    grid: {
      color: "rgba(31, 41, 55, 0.14)",
      text: "rgba(31, 41, 55, 0.72)",
    },
    ecliptic: {
      color: "#b4232f",
      dash: "5 4",
      opacity: 0.86,
    },
    equator: {
      color: "#1d4e89",
      dash: "6 4",
      opacity: 0.82,
    },
    galactic: {
      fill: "rgba(59, 130, 246, 0.055)",
      stroke: "rgba(30, 64, 175, 0.22)",
    },
    text: {
      title: "#111827",
      subtitle: "#374151",
      body: "#111827",
      legend: "#111827",
    },
    typography: {
      constellationLabel: 14,
      chineseAsterismLabel: 12.5,
      starLabel: 10.25,
      tickLabel: 10,
      legendSmall: 9.75,
      legendBody: 10,
      tableHeader: 9.5,
      tableBody: 9.75,
      sectionTitle: 13.5,
      hemisphereTitle: 17,
      titleLandscape: 36,
      titlePortrait: 32,
      noteLandscape: 10,
      notePortrait: 9,
    },
  },
};

export const DEFAULT_TYPOGRAPHY = {
  constellationLabel: 11,
  chineseAsterismLabel: 10,
  starLabel: 8,
  tickLabel: 8,
  legendSmall: 7.5,
  legendBody: 8.5,
  tableHeader: 8,
  tableBody: 8.5,
  sectionTitle: 12,
  hemisphereTitle: 15,
  titleLandscape: 36,
  titlePortrait: 32,
  noteLandscape: 9.5,
  notePortrait: 8.5,
};

/**
 * Returns B-V color index representation in HSL.
 * BV range is roughly -0.4 (extremely blue) to +2.0 (extremely red).
 */
export function getStarColorHSL(bv, themeId) {
  if (themeId === "elegant_white") return "#1a1a1a";
  if (themeId === "a4_print_color") {
    if (bv < -0.2) return "#2563eb";
    if (bv < 0.0) return "#1d70b8";
    if (bv < 0.2) return "#0f766e";
    if (bv < 0.4) return "#4b5563";
    if (bv < 0.6) return "#9a6700";
    if (bv < 1.0) return "#b45309";
    if (bv < 1.4) return "#c2410c";
    return "#b91c1c";
  }
  if (themeId === "qirui_retro") {
    // Retro mode draws rings. Return the ring color.
    if (bv < 0.0) return "#8bb6ff"; // Blue ring
    if (bv < 0.4) return "#fbfbfb"; // White/yellow ring
    if (bv < 0.8) return "#fde188"; // Yellow ring
    if (bv < 1.4) return "#ffb772"; // Orange ring
    return "#ff8b72"; // Red ring
  }

  // HSL colors mapping:
  // Blue/cyan for negative values, white/yellow for middle, orange/red for high.
  if (bv < -0.2) return "hsl(220, 100%, 80%)";
  if (bv < 0.0) return "hsl(205, 100%, 85%)";
  if (bv < 0.2) return "hsl(190, 70%, 92%)";
  if (bv < 0.4) return "hsl(60, 50%, 95%)";
  if (bv < 0.6) return "hsl(55, 100%, 90%)";
  if (bv < 1.0) return "hsl(40, 100%, 80%)";
  if (bv < 1.4) return "hsl(20, 100%, 75%)";
  return "hsl(5, 100%, 75%)";
}
