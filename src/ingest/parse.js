import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Paths
const STARLING_SOURCES_DIR = '/Users/admin/Code/starling/tool/sources';
const DATA_DIR = path.resolve('./data');
const RAW_DIR = path.join(DATA_DIR, 'raw');
const COMPILED_DIR = path.join(DATA_DIR, 'compiled');

// Create directories if they don't exist
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
if (!fs.existsSync(COMPILED_DIR)) fs.mkdirSync(COMPILED_DIR, { recursive: true });

// Input files (falling back to Starling's source folder)
const paths = {
  hipparcos: path.join(STARLING_SOURCES_DIR, 'hipparcos/hip_main.csv'),
  constellationLines: path.join(STARLING_SOURCES_DIR, 'iau/constellation_lines.csv'),
  constellationBoundaries: path.join(STARLING_SOURCES_DIR, 'iau/constellation_boundaries.csv'),
  westernStarNames: path.join(STARLING_SOURCES_DIR, 'iau/star_names.fab'),
  chineseConstellations: path.join(STARLING_SOURCES_DIR, 'stellarium/chinese/constellationship.fab'),
  chineseStarNames: path.join(STARLING_SOURCES_DIR, 'stellarium/chinese/star_names.fab'),
  chineseIndex: path.join(STARLING_SOURCES_DIR, 'stellarium/chinese/index.json'),
};

// Check if raw files exist
for (const [key, filePath] of Object.entries(paths)) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Required source file for ${key} not found at ${filePath}`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// 1. Parse Western proper names (star_names.fab)
// -----------------------------------------------------------------------------
function parseWesternStarNames() {
  const nameMap = new Map(); // hip -> nameEn
  const content = fs.readFileSync(paths.westernStarNames, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx <= 0) continue;

    const hip = parseInt(trimmed.substring(0, pipeIdx).trim(), 10);
    if (isNaN(hip)) continue;

    const rest = trimmed.substring(pipeIdx + 1);
    const nameStart = rest.indexOf('_("');
    const nameEnd = rest.indexOf('")', nameStart + 3);
    if (nameStart < 0 || nameEnd < 0) continue;

    const name = rest.substring(nameStart + 3, nameEnd).trim();
    if (name && !nameMap.has(hip)) {
      nameMap.set(hip, name);
    }
  }
  console.log(`Parsed ${nameMap.size} Western star names.`);
  return nameMap;
}

// -----------------------------------------------------------------------------
// 2. Parse Chinese proper names (chinese/star_names.fab & index.json)
// -----------------------------------------------------------------------------
function parseChineseStarNames() {
  const starNameMap = new Map(); // hip -> { nameZh, nameEn }

  // First read index.json common_names
  if (fs.existsSync(paths.chineseIndex)) {
    try {
      const indexObj = JSON.parse(fs.readFileSync(paths.chineseIndex, 'utf-8'));
      const commonNames = indexObj.common_names || {};
      for (const [key, names] of Object.entries(commonNames)) {
        if (!key.startsWith('HIP ')) continue;
        const hip = parseInt(key.substring(4), 10);
        if (isNaN(hip)) continue;
        if (Array.isArray(names) && names.length > 0) {
          const first = names[0];
          const nameZh = first.native || '';
          const nameEn = first.english || '';
          if (nameZh) {
            starNameMap.set(hip, { nameZh, nameEn });
          }
        }
      }
    } catch (err) {
      console.warn('Warning: Could not parse Chinese index.json common_names', err.message);
    }
  }

  // Then read star_names.fab
  const content = fs.readFileSync(paths.chineseStarNames, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;

    const hip = parseInt(parts[0], 10);
    if (isNaN(hip)) continue;

    const nameZh = parts[1];
    const nameEn = parts.slice(2).join(' ');

    if (!starNameMap.has(hip)) {
      starNameMap.set(hip, { nameZh, nameEn });
    } else {
      const existing = starNameMap.get(hip);
      if (!existing.nameZh && nameZh) existing.nameZh = nameZh;
      if (!existing.nameEn && nameEn) existing.nameEn = nameEn;
    }
  }

  console.log(`Parsed ${starNameMap.size} Chinese star names.`);
  return starNameMap;
}

// -----------------------------------------------------------------------------
// 3. Parse Hipparcos Stars (hip_main.csv)
// -----------------------------------------------------------------------------
async function parseStars(maxMagnitude, westernNames, chineseNames) {
  const stars = [];
  const fileStream = fs.createReadStream(paths.hipparcos);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const fields = line.split('|');
    if (fields.length < 38) continue;

    const hip = parseInt(fields[1].trim(), 10);
    const mag = parseFloat(fields[5].trim());
    const ra = parseFloat(fields[8].trim());
    const dec = parseFloat(fields[9].trim());
    const colorIdx = parseFloat(fields[37].trim());

    if (isNaN(hip) || isNaN(mag) || isNaN(ra) || isNaN(dec)) continue;
    if (mag > maxMagnitude) continue;

    const nameEn = westernNames.get(hip) || null;
    const zhMeta = chineseNames.get(hip);
    const nameZh = zhMeta ? zhMeta.nameZh : null;

    stars.push({
      hip,
      ra: parseFloat(ra.toFixed(6)),
      dec: parseFloat(dec.toFixed(6)),
      mag: parseFloat(mag.toFixed(2)),
      colorIdx: isNaN(colorIdx) ? 0.0 : parseFloat(colorIdx.toFixed(3)),
      nameEn,
      nameZh,
    });
  }

  console.log(`Parsed ${stars.length} stars (mag <= ${maxMagnitude}).`);
  return stars;
}

// -----------------------------------------------------------------------------
// 4. Parse IAU Constellation Lines (constellation_lines.csv)
// -----------------------------------------------------------------------------
const IAU_NAMES_EN = {
  'AND': 'Andromeda', 'ANT': 'Antlia', 'APS': 'Apus', 'AQL': 'Aquila', 'AQR': 'Aquarius',
  'ARA': 'Ara', 'ARI': 'Aries', 'AUR': 'Auriga', 'BOO': 'Boötes', 'CAE': 'Caelum',
  'CAM': 'Camelopardalis', 'CAP': 'Capricornus', 'CAR': 'Carina', 'CAS': 'Cassiopeia',
  'CEN': 'Centaurus', 'CEP': 'Cepheus', 'CET': 'Cetus', 'CHA': 'Chamaeleon', 'CIR': 'Circinus',
  'CMA': 'Canis Major', 'CMI': 'Canis Minor', 'CNC': 'Cancer', 'COL': 'Columba', 'COM': 'Coma Berenices',
  'CRA': 'Corona Australis', 'CRB': 'Corona Borealis', 'CRT': 'Crater', 'CRU': 'Crux', 'CRV': 'Corvus',
  'CVN': 'Canes Venatici', 'CYG': 'Cygnus', 'DEL': 'Delphinus', 'DOR': 'Dorado', 'DRA': 'Draco',
  'EQU': 'Equuleus', 'ERI': 'Eridanus', 'FOR': 'Fornax', 'GEM': 'Gemini', 'GRU': 'Grus',
  'HER': 'Hercules', 'HOR': 'Horologium', 'HYA': 'Hydra', 'HYI': 'Hydrus', 'IND': 'Indus',
  'LAC': 'Lacerta', 'LEO': 'Leo', 'LEP': 'Lepus', 'LIB': 'Libra', 'LMI': 'Leo Minor',
  'LUP': 'Lupus', 'LYN': 'Lynx', 'LYR': 'Lyra', 'MEN': 'Mensa', 'MIC': 'Microscopium',
  'MON': 'Monoceros', 'MUS': 'Musca', 'NOR': 'Norma', 'OCT': 'Octans', 'OPH': 'Ophiuchus',
  'ORI': 'Orion', 'PAV': 'Pavo', 'PEG': 'Pegasus', 'PER': 'Perseus', 'PHE': 'Phoenix',
  'PIC': 'Pictor', 'PSA': 'Piscis Austrinus', 'PSC': 'Pisces', 'PUP': 'Puppis', 'PYX': 'Pyxis',
  'RET': 'Reticulum', 'SCL': 'Sculptor', 'SCO': 'Scorpius', 'SCT': 'Scutum', 'SER': 'Serpens',
  'SEX': 'Sextans', 'SGE': 'Sagitta', 'SGR': 'Sagittarius', 'TAU': 'Taurus', 'TEL': 'Telescopium',
  'TRA': 'Triangulum Australe', 'TRI': 'Triangulum', 'TUC': 'Tucana', 'UMA': 'Ursa Major',
  'UMI': 'Ursa Minor', 'VEL': 'Vela', 'VIR': 'Virgo', 'VOL': 'Volans', 'VUL': 'Vulpecula'
};

const IAU_NAMES_ZH = {
  'AND': '仙女座', 'ANT': '唧筒座', 'APS': '天燕座', 'AQL': '天鹰座', 'AQR': '宝瓶座',
  'ARA': '天坛座', 'ARI': '白羊座', 'AUR': '御夫座', 'BOO': '牧夫座', 'CAE': '雕具座',
  'CAM': '鹿豹座', 'CAP': '摩羯座', 'CAR': '船底座', 'CAS': '仙后座', 'CEN': '半人马座',
  'CEP': '仙王座', 'CET': '鲸鱼座', 'CHA': '蝘蜓座', 'CIR': '圆规座', 'CMA': '大犬座',
  'CMI': '小犬座', 'CNC': '巨蟹座', 'COL': '天鸽座', 'COM': '后发座', 'CRA': '南冕座',
  'CRB': '北冕座', 'CRT': '巨爵座', 'CRU': '南十字座', 'CRV': '乌鸦座', 'CVN': '猎犬座',
  'CYG': '天鹅座', 'DEL': '海豚座', 'DOR': '剑鱼座', 'DRA': '天龙座', 'EQU': '小马座',
  'ERI': '波江座', 'FOR': '天炉座', 'GEM': '双子座', 'GRU': '天鹤座', 'HER': '武仙座',
  'HOR': '时钟座', 'HYA': '长蛇座', 'HYI': '水蛇座', 'IND': '印第安座', 'LAC': '蝎虎座',
  'LEO': '狮子座', 'LEP': '天兔座', 'LIB': '天秤座', 'LMI': '小狮座', 'LUP': '豺狼座',
  'LYN': '天猫座', 'LYR': '天琴座', 'MEN': '山案座', 'MIC': '显微镜座', 'MON': '麒麟座',
  'MUS': '苍蝇座', 'NOR': '矩尺座', 'OCT': '南极座', 'OPH': '蛇夫座', 'ORI': '猎户座',
  'PAV': '孔雀座', 'PEG': '飞马座', 'PER': '英仙座', 'PHE': '凤凰座', 'PIC': '绘架座',
  'PSA': '南鱼座', 'PSC': '双鱼座', 'PUP': '船尾座', 'PYX': '罗盘座', 'RET': '网罟座',
  'SCL': '玉夫座', 'SCO': '天蝎座', 'SCT': '盾牌座', 'SER': '巨蛇座', 'SEX': '六分仪座',
  'SGE': '天箭座', 'SGR': '人马座', 'TAU': '金牛座', 'TEL': '望远镜座', 'TRA': '南三角座',
  'TRI': '三角座', 'TUC': '杜鹃座', 'UMA': '大熊座', 'UMI': '小熊座', 'VEL': '船帆座',
  'VIR': '室女座', 'VOL': '飞鱼座', 'VUL': '狐狸座'
};

function parseWesternConstellations(starHips) {
  const constellations = [];
  const content = fs.readFileSync(paths.constellationLines, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const row = trimmed.split(',');
    if (row.length < 2) continue;

    const abbr = row[0].trim().toUpperCase();
    if (!abbr) continue;

    const numPairs = parseInt(row[1].trim(), 10);
    if (isNaN(numPairs)) continue;

    const edges = [];
    for (let i = 0; i < numPairs; i++) {
      const fromIdx = 2 + i * 2;
      const toIdx = 3 + i * 2;
      if (toIdx >= row.length) break;

      const fromHip = parseInt(row[fromIdx].trim(), 10);
      const toHip = parseInt(row[toIdx].trim(), 10);
      if (isNaN(fromHip) || isNaN(toHip)) continue;

      // Filter edges to ensure both stars are in our dataset
      if (starHips.has(fromHip) && starHips.has(toHip)) {
        edges.push([fromHip, toHip]);
      }
    }

    const nameEn = IAU_NAMES_EN[abbr] || abbr;
    const nameZh = IAU_NAMES_ZH[abbr] || abbr;

    constellations.push({
      abbr,
      nameEn,
      nameZh,
      edges,
    });
  }

  console.log(`Parsed ${constellations.length} Western constellations.`);
  return constellations;
}

// -----------------------------------------------------------------------------
// 5. Parse IAU Constellation Boundaries (constellation_boundaries.csv)
// -----------------------------------------------------------------------------
function parseBoundaries() {
  const boundaries = {}; // abbr -> Array of {ra, dec}
  const content = fs.readFileSync(paths.constellationBoundaries, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const row = trimmed.split(',');
    if (row.length < 3) continue;

    const raHours = parseFloat(row[0].trim());
    const decDeg = parseFloat(row[1].trim());
    const abbr = row[2].trim().toUpperCase();

    if (isNaN(raHours) || isNaN(decDeg) || !abbr) continue;

    const raDeg = raHours * 15.0; // convert hours to degrees

    if (!boundaries[abbr]) {
      boundaries[abbr] = [];
    }

    boundaries[abbr].push({
      ra: parseFloat(raDeg.toFixed(6)),
      dec: parseFloat(decDeg.toFixed(6)),
    });
  }

  console.log(`Parsed boundaries for ${Object.keys(boundaries).length} constellations.`);
  return boundaries;
}

// -----------------------------------------------------------------------------
// 6. Parse Chinese Asterisms (stellarium/chinese)
// -----------------------------------------------------------------------------
const THREE_ENCLOSURES = ['ZY', 'TW', 'TS'];
const MANSION_PREFIXES = {
  // East Azure Dragon (东方青龙)
  'JI': { quadrant: '东方青龙', mansion: '角宿' },
  'KE': { quadrant: '东方青龙', mansion: '亢宿' },
  'DI': { quadrant: '东方青龙', mansion: '氐宿' },
  'FN': { quadrant: '东方青龙', mansion: '房宿' },
  'XN': { quadrant: '东方青龙', mansion: '心宿' },
  'WE': { quadrant: '东方青龙', mansion: '尾宿' },
  'JX': { quadrant: '东方青龙', mansion: '箕宿' },
  // North Black Turtle (北方玄武)
  'DO': { quadrant: '北方玄武', mansion: '斗宿' },
  'NI': { quadrant: '北方玄武', mansion: '牛宿' },
  'NU': { quadrant: '北方玄武', mansion: '女宿' },
  'XU': { quadrant: '北方玄武', mansion: '虚宿' },
  'WA': { quadrant: '北方玄武', mansion: '危宿' },
  'SH': { quadrant: '北方玄武', mansion: '室宿' },
  'BI': { quadrant: '北方玄武', mansion: '壁宿' },
  // West White Tiger (西方白虎)
  'KU': { quadrant: '西方白虎', mansion: '奎宿' },
  'LO': { quadrant: '西方白虎', mansion: '娄宿' },
  'WE2': { quadrant: '西方白虎', mansion: '胃宿' },
  'MA': { quadrant: '西方白虎', mansion: '昴宿' },
  'BX': { quadrant: '西方白虎', mansion: '毕宿' },
  'ZU': { quadrant: '西方白虎', mansion: '觜宿' },
  'SN': { quadrant: '西方白虎', mansion: '参宿' },
  // South Scarlet Bird (南方朱雀)
  'JN': { quadrant: '南方朱雀', mansion: '井宿' },
  'GU': { quadrant: '南方朱雀', mansion: '鬼宿' },
  'LI': { quadrant: '南方朱雀', mansion: '柳宿' },
  'QX': { quadrant: '南方朱雀', mansion: '星宿' },
  'ZH': { quadrant: '南方朱雀', mansion: '张宿' },
  'YI': { quadrant: '南方朱雀', mansion: '翼宿' },
  'ZN': { quadrant: '南方朱雀', mansion: '轸宿' },
};

function classifyAsterism(id) {
  const upper = id.toUpperCase();
  if (THREE_ENCLOSURES.some(prefix => upper.startsWith(prefix))) {
    let enclosure = '三垣';
    if (upper.startsWith('ZY')) enclosure = '紫微垣';
    if (upper.startsWith('TW')) enclosure = '太微垣';
    if (upper.startsWith('TS')) enclosure = '天市垣';
    return { quadrant: '中天三垣', mansion: enclosure };
  }

  for (const [prefix, value] of Object.entries(MANSION_PREFIXES)) {
    if (upper.startsWith(prefix)) {
      return value;
    }
  }

  return { quadrant: '近南极星区', mansion: '近南极星官' };
}

function parseChineseConstellations(starHips) {
  const nameMeta = {}; // id -> { zh, en }

  // Parse index.json first
  if (fs.existsSync(paths.chineseIndex)) {
    try {
      const indexObj = JSON.parse(fs.readFileSync(paths.chineseIndex, 'utf-8'));
      const constellations = indexObj.constellations || [];
      for (const item of constellations) {
        let id = item.id || '';
        if (id.startsWith('CON chinese ')) {
          id = id.substring('CON chinese '.length);
        }
        if (!id) continue;
        const nameZh = item.common_name?.native || item.name || id;
        const nameEn = item.common_name?.english || item.common_name?.transliteration || item.name || id;
        nameMeta[id] = { zh: nameZh, en: nameEn };
      }
    } catch (err) {
      console.warn('Warning: Could not parse Chinese index.json constellations', err.message);
    }
  }

  // Parse constellationship.fab
  const asterisms = [];
  const content = fs.readFileSync(paths.chineseConstellations, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const id = parts[0];
    const numPairs = parseInt(parts[1], 10);
    if (isNaN(numPairs)) continue;

    const edges = [];
    for (let i = 0; i < numPairs; i++) {
      const fromIdx = 2 + i * 2;
      const toIdx = 3 + i * 2;
      if (toIdx >= parts.length) break;

      const fromHip = parseInt(parts[fromIdx], 10);
      const toHip = parseInt(parts[toIdx], 10);
      if (isNaN(fromHip) || isNaN(toHip)) continue;

      if (starHips.has(fromHip) && starHips.has(toHip)) {
        edges.push([fromHip, toHip]);
      }
    }

    const meta = nameMeta[id];
    const nameZh = meta ? meta.zh : id;
    const nameEn = meta ? meta.en : id;
    const { quadrant, mansion } = classifyAsterism(id);

    asterisms.push({
      id,
      nameZh,
      nameEn,
      quadrant,
      mansion,
      edges,
    });
  }

  console.log(`Parsed ${asterisms.length} Chinese asterisms.`);
  return asterisms;
}

// -----------------------------------------------------------------------------
// Main execution flow
// -----------------------------------------------------------------------------
async function run() {
  const maxMag = 6.5;

  console.log('--- Astronomy Data Ingestion Script ---');
  const westernNames = parseWesternStarNames();
  const chineseNames = parseChineseStarNames();

  const stars = await parseStars(maxMag, westernNames, chineseNames);
  const starHips = new Set(stars.map(s => s.hip));

  const westernConstellations = parseWesternConstellations(starHips);
  const boundaries = parseBoundaries();
  const chineseConstellations = parseChineseConstellations(starHips);

  // Write compiled JSON files
  fs.writeFileSync(path.join(COMPILED_DIR, 'stars.normalized.json'), JSON.stringify(stars));
  fs.writeFileSync(path.join(COMPILED_DIR, 'constellations.western.json'), JSON.stringify(westernConstellations));
  fs.writeFileSync(path.join(COMPILED_DIR, 'constellations.chinese.json'), JSON.stringify(chineseConstellations));
  fs.writeFileSync(path.join(COMPILED_DIR, 'boundaries.json'), JSON.stringify(boundaries));

  // Write default poster layout configuration
  const defaultLayout = {
    title: "All-Sky Constellation Atlas",
    subtitle: "全天星座图海报",
    magLimit: 6.5,
    projection: "polar_equidistant", // "polar_equidistant" or "polar_stereographic"
    showWestern: true,
    showChinese: false,
    showGrid: true,
    showEcliptic: true,
    showEquator: true,
    showGalactic: true,
    showBoundaries: true,
    overlapDec: 55, // overlap up to Dec +/- 55 deg
    theme: "classic_navy", // classic_navy, deep_space, elegant_white, qirui_retro
  };
  fs.writeFileSync(path.join(COMPILED_DIR, 'poster.layout.json'), JSON.stringify(defaultLayout, null, 2));

  console.log('\n🎉 Astronomy data ingestion and compilation complete!');
  console.log(`Compiled data files written to: ${COMPILED_DIR}`);
}

run().catch(err => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
