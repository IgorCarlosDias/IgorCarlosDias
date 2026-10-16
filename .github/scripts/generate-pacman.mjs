import fs from 'node:fs';
import path from 'node:path';

const USERNAME = process.env.GITHUB_USERNAME || 'IgorCarlosDias';
const URL = `https://github.com/users/${USERNAME}/contributions`;

async function fetchContributions() {
  const res = await fetch(URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch contributions: ${res.status}`);
  }
  const html = await res.text();

  const tooltipRegex = /<tool-tip[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
  const countsById = new Map();
  let match;
  while ((match = tooltipRegex.exec(html)) !== null) {
    const id = match[1];
    const text = match[2].trim();
    const numMatch = text.match(/^(\d+)\s+contribution/);
    countsById.set(id, numMatch ? parseInt(numMatch[1], 10) : 0);
  }

  const dayRegex = /<td[^>]*data-date="([^"]+)"[^>]*id="contribution-day-component-(\d+)-(\d+)"[^>]*data-level="(\d+)"[^>]*>/g;
  const cells = [];
  let maxCol = 0;

  while ((match = dayRegex.exec(html)) !== null) {
    const date = match[1];
    const row = parseInt(match[2], 10);
    const col = parseInt(match[3], 10);
    const level = parseInt(match[4], 10);
    const id = `contribution-day-component-${row}-${col}`;
    const count = countsById.get(id) ?? (level > 0 ? level * 2 : 0);
    if (col > maxCol) maxCol = col;
    cells.push({ date, row, col, level, count });
  }

  let totalContributions = cells.reduce((acc, c) => acc + c.count, 0);
  const headerMatch = html.match(/(\d+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  if (headerMatch) {
    const headerTotal = parseInt(headerMatch[1], 10);
    if (headerTotal > totalContributions) totalContributions = headerTotal;
  }

  return { cells, maxCol, totalContributions };
}

function buildManhattanPath(activeCells) {
  const byCol = new Map();
  for (const c of activeCells) {
    if (!byCol.has(c.col)) byCol.set(c.col, []);
    byCol.get(c.col).push(c);
  }

  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const targets = [];
  let goingDown = true;
  for (const col of cols) {
    const colCells = byCol.get(col).sort((a, b) => (goingDown ? a.row - b.row : b.row - a.row));
    targets.push(...colCells);
    goingDown = !goingDown;
  }

  if (targets.length === 0) {
    targets.push({ col: 0, row: 3 }, { col: 52, row: 3 });
  }

  let curCol = Math.max(0, targets[0].col - 2);
  let curRow = targets[0].row;

  const steps = [{ col: curCol, row: curRow }];
  const firstEatStep = new Map();

  for (const t of targets) {
    while (curCol !== t.col) {
      curCol += curCol < t.col ? 1 : -1;
      steps.push({ col: curCol, row: curRow });
      const key = `${curCol},${curRow}`;
      if (!firstEatStep.has(key)) firstEatStep.set(key, steps.length - 1);
    }
    while (curRow !== t.row) {
      curRow += curRow < t.row ? 1 : -1;
      steps.push({ col: curCol, row: curRow });
      const key = `${curCol},${curRow}`;
      if (!firstEatStep.has(key)) firstEatStep.set(key, steps.length - 1);
    }
    const key = `${curCol},${curRow}`;
    if (!firstEatStep.has(key)) firstEatStep.set(key, steps.length - 1);
  }

  return { steps, firstEatStep };
}

function renderGhost(color, pathD, dur, lagFraction, animFraction) {
  const endFraction = Math.min(0.995, animFraction + lagFraction).toFixed(4);
  const startFraction = lagFraction.toFixed(4);
  return `
    <g>
      <animateMotion dur="${dur}s" repeatCount="indefinite" calcMode="linear" keyPoints="0;0;1;1" keyTimes="0;${startFraction};${endFraction};1" path="${pathD}" />
      <g transform="translate(-7.5, -7.5)">
        <!-- Ghost Body -->
        <path d="M 1 7.5 A 6.5 6.5 0 0 1 14 7.5 L 14 14 L 11.8 11.8 L 9.6 14 L 7.5 11.8 L 5.4 14 L 3.2 11.8 L 1 14 Z" fill="${color}" stroke="#090d16" stroke-width="0.7">
          <animate attributeName="fill" values="${color};${color};#2563eb;${color};#2563eb;${color}" keyTimes="0;0.30;0.38;0.52;0.72;1" dur="${dur}s" repeatCount="indefinite" />
        </path>
        <!-- Eyes -->
        <circle cx="5.2" cy="6.6" r="2.0" fill="#ffffff" />
        <circle cx="10.2" cy="6.6" r="2.0" fill="#ffffff" />
        <circle cx="6.0" cy="6.6" r="1.05" fill="#1d4ed8" />
        <circle cx="11.0" cy="6.6" r="1.05" fill="#1d4ed8" />
      </g>
    </g>`;
}

function generatePacManSVG(data) {
  const { cells, totalContributions } = data;

  const width = 900;
  const height = 245;

  const cellSize = 11.5;
  const cellGap = 3.5;
  const step = cellSize + cellGap; // 15px

  const gridLeft = 52;
  const gridTop = 76;

  const cellCenter = (col, row) => ({
    x: gridLeft + col * step + cellSize / 2,
    y: gridTop + row * step + cellSize / 2,
  });

  const activeCells = cells.filter((c) => c.level > 0);
  const { steps, firstEatStep } = buildManhattanPath(activeCells);

  const totalSteps = Math.max(1, steps.length - 1);
  const animFraction = 0.90;
  const dur = 24;

  // Build uniform-step SVG path string
  const pts = steps.map((s) => cellCenter(s.col, s.row));
  let pathD = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    pathD += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }

  const levelColors = {
    0: '#111827',
    1: '#0e4429',
    2: '#006d32',
    3: '#26a641',
    4: '#39d353',
  };

  let gridSvg = '';
  for (const cell of cells) {
    const x = gridLeft + cell.col * step;
    const y = gridTop + cell.row * step;
    const cx = x + cellSize / 2;
    const cy = y + cellSize / 2;
    const key = `${cell.col},${cell.row}`;

    // Base dark cell slot
    gridSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellSize}" height="${cellSize}" rx="2.5" fill="#111827" stroke="#1e293b" stroke-width="0.6" />`;

    if (cell.level === 0) {
      gridSvg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="1.2" fill="#1e293b" />`;
    } else {
      const eatIdx = firstEatStep.get(key);
      const eatTime = eatIdx !== undefined ? ((eatIdx / totalSteps) * animFraction).toFixed(4) : '0.8900';
      const afterEatTime = Math.min(0.95, parseFloat(eatTime) + 0.003).toFixed(4);
      const color = levelColors[cell.level] || levelColors[1];

      gridSvg += `<g>`;
      gridSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellSize}" height="${cellSize}" rx="2.5" fill="${color}" stroke="#052e16" stroke-width="0.5">`;
      gridSvg += `<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;${eatTime};${afterEatTime};0.97;1" dur="${dur}s" repeatCount="indefinite" />`;
      gridSvg += `</rect>`;

      if (cell.level >= 3) {
        const dotR = cell.level === 4 ? '3.3' : '2.1';
        const dotColor = cell.level === 4 ? '#fde047' : '#fef08a';
        gridSvg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR}" fill="${dotColor}">`;
        gridSvg += `<animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;${eatTime};${afterEatTime};0.97;1" dur="${dur}s" repeatCount="indefinite" />`;
        gridSvg += `</circle>`;
      }
      gridSvg += `</g>`;
    }
  }

  const months = ['OUT', 'NOV', 'DEZ', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET'];
  let monthsSvg = '';
  months.forEach((m, i) => {
    const mx = gridLeft + i * 4.4 * step + 10;
    monthsSvg += `<text x="${mx.toFixed(1)}" y="${gridTop - 10}" font-family="'JetBrains Mono', Consolas, monospace" font-size="9.5" font-weight="700" fill="#64748b">${m}</text>`;
  });

  const days = [
    { label: 'SEG', row: 1 },
    { label: 'QUA', row: 3 },
    { label: 'SEX', row: 5 },
  ];
  let daysSvg = '';
  for (const d of days) {
    const dy = gridTop + d.row * step + 9;
    daysSvg += `<text x="${gridLeft - 8}" y="${dy.toFixed(1)}" font-family="'JetBrains Mono', Consolas, monospace" font-size="9" font-weight="700" fill="#64748b" text-anchor="end">${d.label}</text>`;
  }

  const scoreStr = String(totalContributions * 100).padStart(6, '0');
  const highScoreStr = String(Math.max(totalContributions * 150, 25000)).padStart(6, '0');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <defs>
    <linearGradient id="arcadeBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#05070e" />
      <stop offset="50%" stop-color="#090d16" />
      <stop offset="100%" stop-color="#05070e" />
    </linearGradient>
  </defs>

  <!-- Outer Arcade Cabinet Frame -->
  <rect width="${width}" height="${height}" rx="14" fill="url(#arcadeBg)" stroke="#1d4ed8" stroke-width="2.5" />
  <rect x="5" y="5" width="${width - 10}" height="${height - 10}" rx="10" fill="none" stroke="#3b82f6" stroke-width="1" stroke-opacity="0.55" />

  <!-- Top Arcade Scoreboard HUD -->
  <g transform="translate(52, 24)">
    <text x="0" y="12" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="12" font-weight="800" fill="#ef4444" letter-spacing="1">1UP</text>
    <text x="38" y="12" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="13" font-weight="800" fill="#f8fafc" letter-spacing="1.5">${scoreStr}</text>

    <text x="165" y="12" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="12" font-weight="800" fill="#facc15" letter-spacing="1">HIGH SCORE</text>
    <text x="260" y="12" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="13" font-weight="800" fill="#f8fafc" letter-spacing="1.5">${highScoreStr}</text>

    <text x="455" y="12" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="12" font-weight="800" fill="#38bdf8" letter-spacing="1.2">
      PAC-MAN // ${totalContributions} COMMITS
    </text>

    <g transform="translate(715, 0)">
      <text x="-8" y="12" font-family="'JetBrains Mono', Consolas, monospace" font-size="10.5" font-weight="700" fill="#94a3b8" text-anchor="end">LIVES</text>
      <path d="M 10 7 L 16 3 A 6.5 6.5 0 1 0 16 11 Z" fill="#facc15" />
      <path d="M 28 7 L 34 3 A 6.5 6.5 0 1 0 34 11 Z" fill="#facc15" />
      <path d="M 46 7 L 52 3 A 6.5 6.5 0 1 0 52 11 Z" fill="#facc15" />
    </g>
  </g>

  <!-- Month & Day Labels -->
  ${monthsSvg}
  ${daysSvg}

  <!-- Contribution Grid Maze -->
  ${gridSvg}

  <!-- 4 Classic Ghosts Chasing Behind Pac-Man -->
  ${renderGhost('#ef4444', pathD, dur, 0.025, animFraction)}
  ${renderGhost('#f472b6', pathD, dur, 0.050, animFraction)}
  ${renderGhost('#38bdf8', pathD, dur, 0.075, animFraction)}
  ${renderGhost('#fb923c', pathD, dur, 0.100, animFraction)}

  <!-- Animated Pac-Man Character -->
  <g>
    <animateMotion dur="${dur}s" repeatCount="indefinite" rotate="auto" calcMode="linear" keyPoints="0;1;1" keyTimes="0;${animFraction.toFixed(4)};1" path="${pathD}" />
    <!-- Upper Jaw -->
    <path d="M 0 0 L 8.5 -5.5 A 9.5 9.5 0 1 0 -9.5 0.1 Z" fill="#facc15" stroke="#090d16" stroke-width="0.6">
      <animateTransform attributeName="transform" type="rotate" values="0 0 0; -26 0 0; 0 0 0" dur="0.22s" repeatCount="indefinite" />
    </path>
    <!-- Lower Jaw -->
    <path d="M 0 0 L 8.5 5.5 A 9.5 9.5 0 1 1 -9.5 -0.1 Z" fill="#facc15" stroke="#090d16" stroke-width="0.6">
      <animateTransform attributeName="transform" type="rotate" values="0 0 0; 26 0 0; 0 0 0" dur="0.22s" repeatCount="indefinite" />
    </path>
    <circle cx="-1" cy="-4.5" r="1.2" fill="#090d16" />
  </g>

  <!-- Bottom Bar: Legend & Arcade Status -->
  <g transform="translate(52, 204)">
    <circle cx="6" cy="8" r="3.5" fill="#facc15">
      <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
    </circle>
    <text x="16" y="12" font-family="'JetBrains Mono', Consolas, monospace" font-size="10.5" font-weight="700" fill="#94a3b8">
      PAC-MAN ARCADE // AUTO-UPDATED VIA GITHUB ACTIONS
    </text>

    <g transform="translate(615, 0)">
      <text x="0" y="11" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" fill="#64748b">Menos</text>
      <rect x="40" y="1" width="11" height="11" rx="2.5" fill="#111827" stroke="#1e293b" stroke-width="0.6" />
      <rect x="55" y="1" width="11" height="11" rx="2.5" fill="#0e4429" />
      <rect x="70" y="1" width="11" height="11" rx="2.5" fill="#006d32" />
      <rect x="85" y="1" width="11" height="11" rx="2.5" fill="#26a641" />
      <rect x="100" y="1" width="11" height="11" rx="2.5" fill="#39d353" />
      <circle cx="105.5" cy="6.5" r="2.8" fill="#fde047" />
      <text x="118" y="11" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" fill="#64748b">Mais</text>
    </g>
  </g>
</svg>`;
}

const data = await fetchContributions();
const svg = generatePacManSVG(data);
const outPath = path.resolve(process.cwd(), 'assets', 'pacman-contributions.svg');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, svg, 'utf8');
console.log(`Generated ${outPath} (${data.totalContributions} contributions)`);
