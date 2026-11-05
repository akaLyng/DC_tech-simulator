import * as THREE from 'three';
import { U, SERVER_WIDTH, NIC_X, STATUS_LED_X, statusLedDy, torPortX, TOR_ROW_DY, TOR_LED_DY, sfpCageX, SFP_LED_DY } from './constants.js';

// Procedural canvas textures for the placeholder art.

let maxAniso = 1;
export function setMaxAnisotropy(v) {
  maxAniso = v;
}

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function canvasTexture(w, h, draw, { srgb = true, repeat = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function speckle(g, w, h, n, seed) {
  const r = makeRng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    g.fillRect(r() * w, r() * h, 2, 2);
  }
}

function tileEdges(g, w, h) {
  g.strokeStyle = '#5c6167';
  g.lineWidth = 6;
  g.strokeRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 2;
  g.strokeRect(6, 6, w - 12, h - 12);
}

export function floorTileTexture(repeatX, repeatY) {
  return canvasTexture(
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#8e9399';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 7000, 7);
      tileEdges(g, w, h);
    },
    { repeat: [repeatX, repeatY] },
  );
}

export function perforatedTileTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#888e94';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, 11);
    const n = 22;
    const m = 42;
    const step = (w - 2 * m) / (n - 1);
    g.fillStyle = '#2a2f34';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.beginPath();
        g.arc(m + i * step, m + j * step, 6.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    tileEdges(g, w, h);
  });
}

// ---- Server / switch fronts -------------------------------------------------

const FRONT_PX_W = 1024;
const PX_PER_U = 102;
const pxPerM = PX_PER_U / U;
const pxX = (x) => (x / SERVER_WIDTH + 0.5) * FRONT_PX_W;
const localX = (px) => (px / FRONT_PX_W - 0.5) * SERVER_WIDTH;

const BAYS = {
  1: { x0: 140, step: 100, w: 96, cols: 4, rows: 1 },
  2: { x0: 140, step: 92, w: 88, cols: 6, rows: 2 },
};

function bayRect(units, col, row) {
  const b = BAYS[units];
  const H = PX_PER_U * units;
  const rowH = (H - 20) / b.rows;
  return { x: b.x0 + col * b.step, y: 10 + row * rowH, w: b.w, h: rowH - 6 };
}

/** Local {x, dy} positions (relative to server centre) of drive-activity LEDs. */
export function serverBayLeds(units) {
  const H = PX_PER_U * units;
  const out = [];
  for (let c = 0; c < BAYS[units].cols; c++) {
    const r = bayRect(units, c, 0);
    out.push({ x: localX(r.x + r.w - 12), dy: (H / 2 - (r.y + 11)) / pxPerM });
  }
  return out;
}

/** Local centre (x, dy from server centre) and size of one drive bay, in metres. */
export function serverBayLocal(units, col, row) {
  const r = bayRect(units, col, row);
  const H = PX_PER_U * units;
  const pxPerMX = FRONT_PX_W / SERVER_WIDTH;
  return { x: localX(r.x + r.w / 2), dy: (H / 2 - (r.y + r.h / 2)) / pxPerM, w: r.w / pxPerMX, h: r.h / pxPerM };
}

export function serverFrontTexture(units) {
  const W = FRONT_PX_W;
  const H = PX_PER_U * units;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#2c3137';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#22262b';
    g.fillRect(0, 0, 44, H);
    g.fillRect(W - 44, 0, 44, H);

    // status LED windows
    const ledY = H / 2 - statusLedDy(units) * pxPerM;
    g.fillStyle = '#0b0d0f';
    for (const x of STATUS_LED_X) g.fillRect(pxX(x) - 9, ledY - 9, 18, 18);

    // drive bays
    const b = BAYS[units];
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const { x, y, w, h } = bayRect(units, c, r);
        g.fillStyle = '#17191c';
        g.fillRect(x, y, w, h);
        g.fillStyle = '#3c424a';
        g.fillRect(x + 8, y + h / 2 - 3, w - 30, 6);
        g.fillStyle = '#0a0b0c';
        g.fillRect(x + w - 18, y + 5, 12, 12);
      }
    }

    // vent grille between bays and NIC
    const vx0 = b.x0 + b.cols * b.step + 16;
    const vx1 = pxX(NIC_X) - 34;
    g.fillStyle = '#121417';
    for (let x = vx0, k = 0; x < vx1; x += 13, k++) {
      for (let y = 14 + (k % 2) * 6; y < H - 12; y += 13) {
        g.beginPath();
        g.arc(x, y, 4.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // NIC port
    const nx = pxX(NIC_X);
    const ny = H / 2;
    g.fillStyle = '#9aa1a9';
    g.fillRect(nx - 19, ny - 15, 38, 30);
    g.fillStyle = '#060708';
    g.fillRect(nx - 15, ny - 11, 30, 22);
    g.fillStyle = '#9aa1a9';
    g.font = 'bold 13px Arial, sans-serif';
    g.fillText('NIC1', nx - 16, ny + (units === 1 ? -20 : 32));

    // asset tag + model text
    g.fillStyle = '#dcdfd8';
    g.fillRect(nx + 42, ny - 14, 120, 28);
    g.fillStyle = '#2a2a2a';
    g.font = 'bold 16px monospace';
    g.fillText('AST-' + (units === 1 ? '1U' : '2U') + '-07', nx + 48, ny + 6);
    g.fillStyle = '#7e8690';
    g.font = `bold ${units === 1 ? 18 : 24}px Arial, sans-serif`;
    g.fillText(units === 1 ? 'DCX 1100' : 'DCX 2200', W - 160, ny + 7);
  });
}

export function switchFrontTexture() {
  const W = FRONT_PX_W;
  const H = PX_PER_U;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#1c1f23';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, 44, H);
    g.fillRect(W - 44, 0, 44, H);
    g.fillStyle = '#c8ccd0';
    g.font = 'bold 18px Arial, sans-serif';
    g.fillText('TOR-48', 52, H / 2 + 6);
    for (let i = 0; i < 24; i++) {
      const x = pxX(torPortX(i));
      for (const dy of [TOR_ROW_DY, -TOR_ROW_DY]) {
        const y = H / 2 - dy * pxPerM;
        g.fillStyle = '#8e959d';
        g.fillRect(x - 12, y - 10, 24, 20);
        g.fillStyle = '#050607';
        g.fillRect(x - 9, y - 7, 18, 14);
      }
      g.fillStyle = '#0b0d0f';
      g.fillRect(x - 5, H / 2 - TOR_LED_DY * pxPerM - 5, 10, 10);
    }
    for (let i = 0; i < 4; i++) {
      const x = pxX(sfpCageX(i));
      g.fillStyle = '#7d848c';
      g.fillRect(x - 17, H / 2 - 12, 34, 24);
      g.fillStyle = '#0a0b0c';
      g.fillRect(x - 14, H / 2 - 9, 28, 18);
      g.fillRect(x - 5, H / 2 - SFP_LED_DY * pxPerM - 5, 10, 10);
      g.fillStyle = '#c8ccd0';
      g.font = 'bold 11px Arial, sans-serif';
      g.fillText(String(49 + i), x - 7, H - 6);
    }
  });
}

// ---- Server rear (hot aisle side) --------------------------------------------
// The rear face is seen from behind, so texture x runs along local -x.
const rearLocalX = (px) => -(px / FRONT_PX_W - 0.5) * SERVER_WIDTH;

/** Two hot-swap PSU bays at the right-hand end (as seen from behind). Local {x, dy, w, h}. */
export function serverPsuSlots(units) {
  const H = PX_PER_U * units;
  const w = 96;
  const h = 84;
  const y = H - h - 9; // bottom-aligned
  return [800, 910].map((px) => ({ x: rearLocalX(px + w / 2), dy: (H / 2 - (y + h / 2)) / pxPerM, w: w / (FRONT_PX_W / SERVER_WIDTH), h: h / pxPerM }));
}

export function serverRearTexture(units) {
  const W = FRONT_PX_W;
  const H = PX_PER_U * units;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#2a2e33';
    g.fillRect(0, 0, W, H);
    // fan grilles
    g.fillStyle = '#131518';
    for (let f = 0; f < (units === 1 ? 4 : 3); f++) {
      const cx = 80 + f * (units === 1 ? 90 : 140);
      const r = units === 1 ? 36 : 58;
      for (let a = 0; a < 6; a++) {
        g.beginPath();
        g.arc(cx, H / 2, r - a * (r / 6), 0, Math.PI * 2);
        g.lineWidth = 3;
        g.strokeStyle = a % 2 ? '#1b1e22' : '#0d0f11';
        g.stroke();
      }
    }
    // I/O: NIC ports, USB, VGA
    const io = units === 1 ? 470 : 520;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#9aa1a9';
      g.fillRect(io + i * 44, H / 2 - 14, 36, 28);
      g.fillStyle = '#060708';
      g.fillRect(io + i * 44 + 4, H / 2 - 10, 28, 20);
    }
    g.fillStyle = '#2f5fbf';
    g.fillRect(io + 190, H / 2 - 10, 40, 20);
    // PSU bays (the real PSU modules sit on top of these)
    for (const px of [800, 910]) {
      const h = 84;
      const y = H - h - 9;
      g.fillStyle = '#1a1c20';
      g.fillRect(px, y, 96, h);
      g.fillStyle = '#3b4148';
      for (let k = 0; k < 5; k++) g.fillRect(px + 8, y + 10 + k * 14, 60, 6);
      g.fillStyle = '#0b0c0e';
      g.fillRect(px + 74, y + 18, 16, 28);
    }
  });
}

// ---- Core switch ------------------------------------------------------------

export const CORE = { width: 1.6, height: 2.2, depth: 1.1 };
const CORE_TEX = { W: 1024, H: 1408, cards: 8, x0: 56, step: 114, cardW: 104, rowY0: 262, rowStep: 64, rows: 12, cols: [16, 56] };

/** Local positions (core space, front face) of per-port link LEDs. */
export function coreLedPositions() {
  const L = CORE_TEX;
  const out = [];
  for (let c = 0; c < L.cards; c++) {
    for (const col of L.cols) {
      for (let r = 0; r < L.rows; r++) {
        const px = L.x0 + c * L.step + col + 36;
        const py = L.rowY0 + r * L.rowStep + 4;
        out.push({ x: (px / L.W - 0.5) * CORE.width, y: (1 - py / L.H) * CORE.height });
      }
    }
  }
  return out;
}

export function coreFrontTexture() {
  const L = CORE_TEX;
  return canvasTexture(L.W, L.H, (g, W, H) => {
    g.fillStyle = '#1f2328';
    g.fillRect(0, 0, W, H);
    // top fan tray
    g.fillStyle = '#15181b';
    g.fillRect(30, 60, W - 60, 140);
    g.fillStyle = '#0c0e10';
    for (let x = 50; x < W - 50; x += 16) for (let y = 76; y < 190; y += 16) g.fillRect(x, y, 10, 10);
    // line cards
    for (let c = 0; c < L.cards; c++) {
      const x = L.x0 + c * L.step;
      g.fillStyle = '#2b3036';
      g.fillRect(x, 220, L.cardW, 840);
      g.fillStyle = '#9aa2ab';
      g.font = 'bold 18px Arial, sans-serif';
      g.fillText('LC' + (c + 1), x + 32, 246);
      for (const col of L.cols) {
        for (let r = 0; r < L.rows; r++) {
          const px = x + col;
          const py = L.rowY0 + r * L.rowStep;
          g.fillStyle = '#868d95';
          g.fillRect(px, py, 30, 26);
          g.fillStyle = '#050607';
          g.fillRect(px + 4, py + 4, 22, 18);
          g.fillStyle = '#0b0d0f';
          g.fillRect(px + 32, py, 9, 9);
        }
      }
      g.fillStyle = '#596069';
      g.fillRect(x + 10, 1030, L.cardW - 20, 10);
    }
    // PSUs
    for (let i = 0; i < 4; i++) {
      const x = 56 + i * 232;
      g.fillStyle = '#2a2f35';
      g.fillRect(x, 1110, 214, 230);
      g.fillStyle = '#121417';
      for (let gx = x + 14; gx < x + 200; gx += 14) for (let gy = 1126; gy < 1290; gy += 14) g.fillRect(gx, gy, 8, 8);
      g.fillStyle = '#6b737c';
      g.fillRect(x + 70, 1300, 74, 18);
    }
  });
}

export function cracTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#d6dadf';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9bfc5';
    for (let y = 150; y < h - 30; y += 14) g.fillRect(30, y, w - 60, 6);
    g.fillStyle = '#1b2026';
    g.fillRect(180, 40, 150, 70);
    g.fillStyle = '#6fe39a';
    g.font = 'bold 30px monospace';
    g.fillText('18.5°C', 196, 86);
    g.fillStyle = '#4b5259';
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('CRAH', 40, 84);
  });
}

// ---- Labels & signs ---------------------------------------------------------

export function labelTexture(text) {
  return canvasTexture(512, 136, (g, w, h) => {
    g.fillStyle = '#f2f2ec';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1e1e1e';
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#111';
    g.font = 'bold 104px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export function signTexture(text, sub) {
  return canvasTexture(1024, 320, (g, w, h) => {
    g.fillStyle = '#0f4c9c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8eef7';
    g.lineWidth = 10;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 150px Arial, Helvetica, sans-serif';
    g.fillText(text, w / 2, sub ? 130 : h / 2);
    if (sub) {
      g.font = 'bold 50px Arial, Helvetica, sans-serif';
      g.fillText(sub, w / 2, 250);
    }
  });
}

/** Shelf bin label: part name plus a short spec line. */
export function binLabelTexture(title, spec) {
  return canvasTexture(512, 160, (g, w, h) => {
    g.fillStyle = '#f4f4ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcf33';
    g.fillRect(0, 0, 18, h);
    g.fillStyle = '#111';
    g.font = 'bold 56px Arial, Helvetica, sans-serif';
    g.fillText(title, 40, 70);
    g.fillStyle = '#444';
    g.font = '36px Arial, Helvetica, sans-serif';
    g.fillText(spec, 40, 128);
  });
}

export function exitSignTexture() {
  return canvasTexture(512, 160, (g, w, h) => {
    g.fillStyle = '#0a8a3a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'bold 96px Arial, Helvetica, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('EXIT', 150, h / 2 + 4);
    g.beginPath();
    g.moveTo(40, h / 2);
    g.lineTo(100, h / 2 - 40);
    g.lineTo(100, h / 2 + 40);
    g.fill();
  });
}
