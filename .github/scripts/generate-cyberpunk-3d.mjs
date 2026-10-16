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

  // Map tooltip counts by component id
  const tooltipRegex = /<tool-tip[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
  const countsById = new Map();
  let match;
  while ((match = tooltipRegex.exec(html)) !== null) {
    const id = match[1];
    const text = match[2].trim();
    const numMatch = text.match(/^(\d+)\s+contribution/);
    countsById.set(id, numMatch ? parseInt(numMatch[1], 10) : 0);
  }

  // Extract all day cells
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

  // Sort chronologically by date for streak & stats calculation
  const sortedByDate = [...cells].sort((a, b) => a.date.localeCompare(b.date));
  let totalContributions = 0;
  let activeDays = 0;
  let maxDayCount = 0;
  let maxStreak = 0;
  let currentStreak = 0;

  for (const c of sortedByDate) {
    totalContributions += c.count;
    if (c.count > 0 || c.level > 0) {
      activeDays++;
      currentStreak++;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      if (c.count > maxDayCount) maxDayCount = c.count;
    } else {
      currentStreak = 0;
    }
  }

  const headerMatch = html.match(/(\d+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  if (headerMatch) {
    const headerTotal = parseInt(headerMatch[1], 10);
    if (headerTotal > totalContributions) totalContributions = headerTotal;
  }

  return {
    cells,
    maxCol,
    totalContributions,
    activeDays,
    maxDayCount,
    maxStreak,
  };
}

function drawVoxel(x, y, ux, uy, vx, vy, height, colors, strokeColor, isHigh) {
  // Base parallelogram vertices:
  // P0 = back, P1 = right (+u), P2 = front (+u+v), P3 = left (+v)
  const p0x = x;
  const p0y = y;
  const p1x = x + ux;
  const p1y = y + uy;
  const p2x = x + ux + vx;
  const p2y = y + uy + vy;
  const p3x = x + vx;
  const p3y = y + vy;

  // Top face vertices (shifted up by height)
  const t0x = p0x;
  const t0y = p0y - height;
  const t1x = p1x;
  const t1y = p1y - height;
  const t2x = p2x;
  const t2y = p2y - height;
  const t3x = p3x;
  const t3y = p3y - height;

  const leftPoints = `${t3x.toFixed(1)},${t3y.toFixed(1)} ${t2x.toFixed(1)},${t2y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)}`;
  const rightPoints = `${t2x.toFixed(1)},${t2y.toFixed(1)} ${t1x.toFixed(1)},${t1y.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`;
  const topPoints = `${t0x.toFixed(1)},${t0y.toFixed(1)} ${t1x.toFixed(1)},${t1y.toFixed(1)} ${t2x.toFixed(1)},${t2y.toFixed(1)} ${t3x.toFixed(1)},${t3y.toFixed(1)}`;

  let svg = `<g>`;
  svg += `<polygon points="${leftPoints}" fill="${colors.left}" stroke="${strokeColor}" stroke-width="0.5" stroke-linejoin="round" />`;
  svg += `<polygon points="${rightPoints}" fill="${colors.right}" stroke="${strokeColor}" stroke-width="0.5" stroke-linejoin="round" />`;
  svg += `<polygon points="${topPoints}" fill="${colors.top}" stroke="${colors.topStroke || strokeColor}" stroke-width="${isHigh ? '0.9' : '0.55'}" stroke-linejoin="round" />`;

  const centerX = (t0x + t2x) / 2;
  const centerY = (t0y + t2y) / 2;

  if (colors.cap) {
    const s = 0.52;
    const c0x = centerX + (t0x - centerX) * s;
    const c0y = centerY + (t0y - centerY) * s;
    const c1x = centerX + (t1x - centerX) * s;
    const c1y = centerY + (t1y - centerY) * s;
    const c2x = centerX + (t2x - centerX) * s;
    const c2y = centerY + (t2y - centerY) * s;
    const c3x = centerX + (t3x - centerX) * s;
    const c3y = centerY + (t3y - centerY) * s;
    svg += `<polygon points="${c0x.toFixed(1)},${c0y.toFixed(1)} ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${c3x.toFixed(1)},${c3y.toFixed(1)}" fill="${colors.cap}" opacity="0.88" />`;
  }

  svg += `</g>`;
  return { svg, topX: centerX, topY: centerY };
}

function generateSVG(data) {
  const { cells, maxCol, totalContributions, activeDays, maxDayCount, maxStreak } = data;

  const width = 1000;
  const height = 460;

  // Wide Isometric Basis Vectors:
  // u = step along week column (0..52) -> right and slightly down
  // v = step along day row (0..6)     -> down and slightly left
  const dxCol = 14.3;
  const dyCol = 2.45;
  const dxRow = -11.2;
  const dyRow = 10.2;

  const originX = 166;
  const originY = 178;

  // Tile size factor (leaves crisp cyber gap between tiles)
  const fillRatio = 0.84;
  const ux = dxCol * fillRatio;
  const uy = dyCol * fillRatio;
  const vx = dxRow * fillRatio;
  const vy = dyRow * fillRatio;

  const palettes = {
    0: {
      top: '#0d1526',
      left: '#090e1a',
      right: '#060a12',
      topStroke: '#1e293b',
      cap: null,
    },
    1: {
      top: '#06b6d4',
      left: '#0891b2',
      right: '#155e75',
      topStroke: '#67e8f9',
      cap: '#a5f3fc',
    },
    2: {
      top: '#3b82f6',
      left: '#2563eb',
      right: '#1d4ed8',
      topStroke: '#93c5fd',
      cap: '#dbeafe',
    },
    3: {
      top: '#a855f7',
      left: '#7e22ce',
      right: '#581c87',
      topStroke: '#e9d5ff',
      cap: '#f3e8ff',
    },
    4: {
      top: '#f43f5e',
      left: '#e11d48',
      right: '#9f1239',
      topStroke: '#fda4af',
      cap: '#ffe4e6',
    },
  };

  // Back-to-front painter's sort: ascending (col + row)
  const projected = cells.map((cell) => {
    const x = originX + cell.col * dxCol + cell.row * dxRow;
    const y = originY + cell.col * dyCol + cell.row * dyRow;
    return { ...cell, x, y };
  });

  projected.sort((a, b) => {
    const da = a.col + a.row;
    const db = b.col + b.row;
    if (da !== db) return da - db;
    return a.row - b.row;
  });

  // Base platform polygon
  const colsCount = maxCol + 1;
  const rowsCount = 7;
  const padC = 0.9;
  const padR = 0.9;

  const platPt = (c, r) => ({
    x: originX + c * dxCol + r * dxRow,
    y: originY + c * dyCol + r * dyRow,
  });

  const pBack = platPt(-padC, -padR);
  const pRight = platPt(colsCount - 1 + fillRatio + padC, -padR);
  const pFront = platPt(colsCount - 1 + fillRatio + padC, rowsCount - 1 + fillRatio + padR);
  const pLeft = platPt(-padC, rowsCount - 1 + fillRatio + padR);
  const platDepth = 14;

  let blocksSvg = '';
  let beaconsSvg = '';

  for (const cell of projected) {
    let boxHeight = 4;
    if (cell.level === 1) boxHeight = 16 + Math.min(cell.count * 1.6, 10);
    else if (cell.level === 2) boxHeight = 30 + Math.min(cell.count * 1.8, 14);
    else if (cell.level === 3) boxHeight = 46 + Math.min(cell.count * 2.0, 18);
    else if (cell.level === 4) boxHeight = 64 + Math.min(cell.count * 2.2, 24);

    const colors = palettes[cell.level] || palettes[0];
    const strokeColor = cell.level === 0 ? '#162032' : '#090d16';

    const { svg, topX, topY } = drawVoxel(
      cell.x,
      cell.y,
      ux,
      uy,
      vx,
      vy,
      boxHeight,
      colors,
      strokeColor,
      cell.level >= 3
    );
    blocksSvg += svg;

    if (cell.level >= 3) {
      const beaconColor = cell.level === 4 ? '#f43f5e' : '#c084fc';
      const dur = (1.5 + ((cell.col * 7 + cell.row) % 9) * 0.16).toFixed(2);
      beaconsSvg += `
        <g>
          <line x1="${topX.toFixed(1)}" y1="${topY.toFixed(1)}" x2="${topX.toFixed(1)}" y2="${(topY - 13).toFixed(1)}" stroke="${beaconColor}" stroke-width="1.1" stroke-dasharray="2 2" opacity="0.8" />
          <circle cx="${topX.toFixed(1)}" cy="${(topY - 15).toFixed(1)}" r="${cell.level === 4 ? '2.8' : '2.1'}" fill="#ffffff" stroke="${beaconColor}" stroke-width="1.5">
            <animate attributeName="cy" values="${(topY - 13).toFixed(1)};${(topY - 19).toFixed(1)};${(topY - 13).toFixed(1)}" dur="${dur}s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.4;1" dur="${dur}s" repeatCount="indefinite" />
          </circle>
        </g>`;
    }
  }

  // Player Level & XP calculation
  const playerLevel = Math.max(1, Math.floor(totalContributions / 15) + 1);
  const xpProgress = Math.min(96, Math.max(22, ((totalContributions % 15) / 15) * 100));
  const rankTitle =
    totalContributions >= 300
      ? 'CYBER ARCHITECT // S-RANK'
      : totalContributions >= 120
      ? 'NETRUNNER // A-RANK'
      : 'CODE MERCENARY // B-RANK';

  // Bottom-Right Legend mini-voxels
  const legendItems = [
    { label: 'IDLE', level: 0, h: 4 },
    { label: 'LVL 1', level: 1, h: 11 },
    { label: 'LVL 2', level: 2, h: 17 },
    { label: 'LVL 3', level: 3, h: 23 },
    { label: 'OVERDRIVE', level: 4, h: 30 },
  ];

  let legendSvg = '';
  legendItems.forEach((item, idx) => {
    const lx = 635 + idx * 72;
    const ly = 420;
    const { svg } = drawVoxel(
      lx - 2,
      ly - 4,
      11.5,
      2.2,
      -8.5,
      7.5,
      item.h,
      palettes[item.level],
      '#090d16',
      item.level >= 3
    );
    legendSvg += svg;
    legendSvg += `<text x="${lx}" y="${ly + 19}" font-family="'JetBrains Mono', 'Fira Code', Consolas, monospace" font-size="9.5" font-weight="700" fill="#94a3b8" text-anchor="middle">${item.label}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <defs>
    <linearGradient id="cyberBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06080f" />
      <stop offset="50%" stop-color="#0b1120" />
      <stop offset="100%" stop-color="#070913" />
    </linearGradient>
    <linearGradient id="xpGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#06b6d4" />
      <stop offset="50%" stop-color="#a855f7" />
      <stop offset="100%" stop-color="#f43f5e" />
    </linearGradient>
    <linearGradient id="platLeft" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e1b4b" />
    </linearGradient>
    <linearGradient id="platRight" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="100%" stop-color="#090d16" />
    </linearGradient>
    <radialGradient id="arenaGlow" cx="50%" cy="62%" r="48%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.16" />
      <stop offset="55%" stop-color="#a855f7" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
    <pattern id="cyberGrid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" stroke-width="0.6" stroke-opacity="0.45" />
    </pattern>
  </defs>

  <!-- Outer Frame -->
  <rect width="${width}" height="${height}" rx="16" fill="url(#cyberBg)" stroke="#1e293b" stroke-width="2" />
  <rect width="${width}" height="${height}" rx="16" fill="url(#cyberGrid)" />
  <ellipse cx="500" cy="285" rx="440" ry="150" fill="url(#arenaGlow)" />

  <!-- Corner HUD Brackets -->
  <path d="M 16 42 L 16 16 L 42 16" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 984 42 L 984 16 L 958 16" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 16 418 L 16 444 L 42 444" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" />
  <path d="M 984 418 L 984 444 L 958 444" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" />

  <!-- Top Left Gamer HUD: Player Status -->
  <g transform="translate(32, 24)">
    <rect width="380" height="76" rx="10" fill="#090d16" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
    <rect x="0" y="0" width="5" height="76" rx="2.5" fill="url(#xpGrad)" />

    <!-- Level Badge -->
    <rect x="16" y="12" width="52" height="52" rx="8" fill="#111827" stroke="#06b6d4" stroke-width="1.5" />
    <text x="42" y="31" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" font-weight="700" fill="#06b6d4" text-anchor="middle">LVL</text>
    <text x="42" y="53" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="21" font-weight="800" fill="#f8fafc" text-anchor="middle">${playerLevel}</text>

    <!-- Player Name & Rank -->
    <text x="82" y="26" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="14.5" font-weight="800" fill="#f8fafc" letter-spacing="0.5">
      PLAYER // ${USERNAME.toUpperCase()}
    </text>
    <text x="82" y="43" font-family="'JetBrains Mono', Consolas, monospace" font-size="11" font-weight="600" fill="#c084fc">
      ${rankTitle}
    </text>

    <!-- XP Progress Bar -->
    <rect x="82" y="52" width="278" height="9" rx="4.5" fill="#1e293b" />
    <rect x="82" y="52" width="${(2.78 * xpProgress).toFixed(1)}" height="9" rx="4.5" fill="url(#xpGrad)">
      <animate attributeName="opacity" values="1;0.75;1" dur="2.2s" repeatCount="indefinite" />
    </rect>
  </g>

  <!-- Top Right Gamer HUD: Telemetry / Scoreboard -->
  <g transform="translate(432, 24)">
    <!-- Card 1: Total XP -->
    <rect x="0" y="0" width="130" height="76" rx="10" fill="#090d16" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
    <text x="16" y="24" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" font-weight="700" fill="#64748b">TOTAL XP</text>
    <text x="16" y="51" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="24" font-weight="800" fill="#38bdf8">${totalContributions}</text>
    <text x="16" y="66" font-family="'JetBrains Mono', Consolas, monospace" font-size="9" fill="#06b6d4">COMMITS (1Y)</text>

    <!-- Card 2: Active Quests -->
    <rect x="142" y="0" width="130" height="76" rx="10" fill="#090d16" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
    <text x="158" y="24" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" font-weight="700" fill="#64748b">ACTIVE DAYS</text>
    <text x="158" y="51" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="24" font-weight="800" fill="#c084fc">${activeDays}</text>
    <text x="158" y="66" font-family="'JetBrains Mono', Consolas, monospace" font-size="9" fill="#a855f7">QUESTS DONE</text>

    <!-- Card 3: Max Streak -->
    <rect x="284" y="0" width="126" height="76" rx="10" fill="#090d16" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
    <text x="300" y="24" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" font-weight="700" fill="#64748b">MAX STREAK</text>
    <text x="300" y="51" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="24" font-weight="800" fill="#34d399">${maxStreak}d</text>
    <text x="300" y="66" font-family="'JetBrains Mono', Consolas, monospace" font-size="9" fill="#10b981">COMBO CHAIN</text>

    <!-- Card 4: Best Day -->
    <rect x="422" y="0" width="114" height="76" rx="10" fill="#090d16" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
    <text x="438" y="24" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" font-weight="700" fill="#64748b">PEAK COMBO</text>
    <text x="438" y="51" font-family="'Space Grotesk', 'Segoe UI', sans-serif" font-size="24" font-weight="800" fill="#f43f5e">${maxDayCount}</text>
    <text x="438" y="66" font-family="'JetBrains Mono', Consolas, monospace" font-size="9" fill="#fb7185">MAX / DAY</text>
  </g>

  <!-- Isometric Base Platform -->
  <g>
    <!-- Top Deck -->
    <polygon points="${pBack.x.toFixed(1)},${pBack.y.toFixed(1)} ${pRight.x.toFixed(1)},${pRight.y.toFixed(1)} ${pFront.x.toFixed(1)},${pFront.y.toFixed(1)} ${pLeft.x.toFixed(1)},${pLeft.y.toFixed(1)}"
      fill="#070b14" stroke="#1e293b" stroke-width="1.6" />
    <!-- Left Front Rim -->
    <polygon points="${pLeft.x.toFixed(1)},${pLeft.y.toFixed(1)} ${pFront.x.toFixed(1)},${pFront.y.toFixed(1)} ${pFront.x.toFixed(1)},${(pFront.y + platDepth).toFixed(1)} ${pLeft.x.toFixed(1)},${(pLeft.y + platDepth).toFixed(1)}"
      fill="url(#platLeft)" stroke="#06b6d4" stroke-width="1" stroke-opacity="0.75" />
    <!-- Right Front Rim -->
    <polygon points="${pFront.x.toFixed(1)},${pFront.y.toFixed(1)} ${pRight.x.toFixed(1)},${pRight.y.toFixed(1)} ${pRight.x.toFixed(1)},${(pRight.y + platDepth).toFixed(1)} ${pFront.x.toFixed(1)},${(pFront.y + platDepth).toFixed(1)}"
      fill="url(#platRight)" stroke="#a855f7" stroke-width="1" stroke-opacity="0.75" />
  </g>

  <!-- 3D Isometric Contribution Voxels -->
  ${blocksSvg}

  <!-- Floating Cyber Beacons on High-Activity Towers -->
  ${beaconsSvg}

  <!-- Bottom Left Terminal Status -->
  <g transform="translate(36, 412)">
    <circle cx="8" cy="10" r="4" fill="#34d399">
      <animate attributeName="opacity" values="1;0.25;1" dur="1.8s" repeatCount="indefinite" />
    </circle>
    <text x="20" y="14" font-family="'JetBrains Mono', Consolas, monospace" font-size="11.5" font-weight="700" fill="#e2e8f0">
      CYBERPUNK ISOMETRIC 3D // 53 WEEKS × 7 DAYS
    </text>
    <text x="20" y="29" font-family="'JetBrains Mono', Consolas, monospace" font-size="10" fill="#64748b">
      LIVE GITHUB TELEMETRY • AUTO-UPDATED VIA GITHUB ACTIONS
    </text>
  </g>

  <!-- Bottom Right 3D Voxel Legend -->
  ${legendSvg}
</svg>`;
}

const data = await fetchContributions();
const svg = generateSVG(data);
const outPath = path.resolve(process.cwd(), 'assets', 'contributions-3d.svg');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, svg, 'utf8');
console.log(`Generated ${outPath} (${data.totalContributions} contributions, ${data.activeDays} active days)`);
