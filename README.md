# Allsky Atlas

Allsky Atlas is a browser-based all-sky star map poster generator built for print-ready exports. It renders a dual-hemisphere celestial atlas that can be customized in the browser, then exported as a lossless SVG or a high-resolution PNG suitable for large-format printing.

Open the deployed site here: [https://askman-dev.github.io/allsky-atlas/?hl=en](https://askman-dev.github.io/allsky-atlas/?hl=en)

<p align="center">
  <img
    src="docs/assets/dual-hemisphere-all-sky-color-star-map-poster.svg"
    alt="Dual hemisphere all-sky color star map poster preview"
    width="720"
  />
</p>

The app is designed less like a data viewer and more like a poster production tool: adjust the map style, labels, projection, language, and astronomy layers, then export a clean file for print or further layout work.

## Highlights

- Print-focused poster canvas with a dual northern/southern hemisphere layout.
- High-resolution PNG export at 3.5x render scale, producing a 5950 x 4200 px image from the 1700 x 1200 poster canvas.
- Lossless SVG export for vector workflows, archival use, or print-shop refinement.
- English, Chinese, or bilingual poster labeling.
- Western constellations, Chinese asterisms, star labels, IAU boundaries, RA/Dec grid, celestial equator, ecliptic path, and Milky Way layer controls.
- Multiple visual themes and typography presets for different poster styles.
- Browser preview with pan and zoom for inspecting dense map details before export.

## Exporting Print Artwork

Use **Export Print PNG** when you want a high-resolution raster image that can be sent directly to a printer or placed into print design software. The export is rendered from the SVG poster into a large PNG canvas, preserving sharp lines, labels, stars, and poster framing.

Use **Export Vector SVG** when you need an editable vector source. SVG is the best option for later typography adjustments, color edits, or professional prepress workflows.

Large PNG export depends on browser canvas limits. If export fails, try closing other heavy tabs, using a desktop browser, or exporting SVG instead.

## Development

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Data

The app reads compiled astronomy JSON files from `public/data/`. The repository already includes compiled data for the poster experience.

If the source catalog files are available locally, regenerate the compiled files with:

```bash
node src/ingest/parse.js
```

The ingestion script expects the Starling source catalogs at `/Users/admin/Code/starling/tool/sources` and writes compiled output under `data/compiled/`.

## Tech Stack

- React
- Vite
- SVG-based poster rendering
- Canvas-based high-resolution PNG export
