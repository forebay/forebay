// Single source of truth for the Forebay logo. Change the mark here (geometry) or
// the --forebay-* CSS tokens (color) and it updates everywhere it is used:
// sidebar, titlebar, favicon, and any raster assets generated from it.
//
// Mark: two stacked isometric stones (the forebay) with a single orbit ring and a
// waypoint node on the orbit.

export interface ForebayColors {
  c1: string; // stone top face
  c2: string; // stone left face
  c3: string; // stone right face
  ring: string; // orbit ring
  node: string; // waypoint node
}

// Theme-aware default: resolves to the --forebay-* CSS tokens (see app.css), so the
// in-app mark follows the light/dark theme automatically.
export const FOREBAY_THEME_COLORS: ForebayColors = {
  c1: "var(--forebay-c1)",
  c2: "var(--forebay-c2)",
  c3: "var(--forebay-c3)",
  ring: "var(--forebay-ring)",
  node: "var(--forebay-node)",
};

// Baked palettes for contexts that cannot read CSS variables (favicon, tray,
// packaged icons) or need a fixed appearance (an accent-filled app tile).
export const FOREBAY_SLATE_LIGHT: ForebayColors = { c1: "#9a9ea6", c2: "#7d818a", c3: "#62666e", ring: "#2a2c31", node: "#2a2c31" };
export const FOREBAY_SLATE_DARK: ForebayColors = { c1: "#b0b4bc", c2: "#8d919a", c3: "#6d717a", ring: "#eef0f2", node: "#eef0f2" };
export const FOREBAY_ON_ACCENT: ForebayColors = { c1: "#ffffff", c2: "#d7ddf7", c3: "#c2caf0", ring: "#ffffff", node: "#ffffff" };

const CENTER = 24;
const RING_RX = 16.5;
const RING_RY = 6;
const RING_ROTATION = -18;
const RING_WIDTH = 2;
const NODE_ANGLE = 200;
const NODE_RADIUS = 2.9;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const round = (value: number): number => Math.round(value * 100) / 100;

function quad(points: Array<[number, number]>, fill: string): string {
  const pts = points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
  return `<polygon points="${pts}" fill="${fill}"/>`;
}

function stone(cx: number, cy: number, halfWidth: number, depth: number, height: number, faces: [string, string, string]): string {
  const top = quad([[cx, cy - depth], [cx + halfWidth, cy], [cx, cy + depth], [cx - halfWidth, cy]], faces[0]);
  const left = quad([[cx - halfWidth, cy], [cx, cy + depth], [cx, cy + depth + height], [cx - halfWidth, cy + height]], faces[1]);
  const right = quad([[cx + halfWidth, cy], [cx, cy + depth], [cx, cy + depth + height], [cx + halfWidth, cy + height]], faces[2]);
  return top + left + right;
}

function orbitPoint(angleDeg: number): [number, number] {
  const a = toRadians(angleDeg);
  const x = RING_RX * Math.cos(a);
  const y = RING_RY * Math.sin(a);
  const cr = Math.cos(toRadians(RING_ROTATION));
  const sr = Math.sin(toRadians(RING_ROTATION));
  return [CENTER + x * cr - y * sr, CENTER + x * sr + y * cr];
}

function ringBack(color: string): string {
  return `<ellipse cx="${CENTER}" cy="${CENTER}" rx="${RING_RX}" ry="${RING_RY}" fill="none" stroke="${color}" stroke-width="${RING_WIDTH}" transform="rotate(${RING_ROTATION} ${CENTER} ${CENTER})"/>`;
}

// Near (front) half of the tilted orbit, drawn over the core so the forebay sits inside the ring.
function ringFront(color: string): string {
  const [x0, y0] = orbitPoint(0);
  const [x1, y1] = orbitPoint(180);
  return `<path d="M ${round(x1)},${round(y1)} A ${RING_RX} ${RING_RY} ${RING_ROTATION} 0 0 ${round(x0)},${round(y0)}" fill="none" stroke="${color}" stroke-width="${RING_WIDTH}" stroke-linecap="round"/>`;
}

function waypointNode(color: string): string {
  const [x, y] = orbitPoint(NODE_ANGLE);
  return `<circle cx="${round(x)}" cy="${round(y)}" r="${NODE_RADIUS}" fill="${color}"/>`;
}

export function renderForebayMark(size = 24, colors: ForebayColors = FOREBAY_THEME_COLORS): string {
  const faces: [string, string, string] = [colors.c1, colors.c2, colors.c3];
  const core = stone(CENTER, 25.5, 8.5, 4.6, 5, faces) + stone(CENTER, 17.5, 8.5, 4.6, 5, faces);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" role="img" aria-label="Forebay">` +
    ringBack(colors.ring) +
    core +
    ringFront(colors.ring) +
    waypointNode(colors.node) +
    `</svg>`
  );
}

export function forebayMarkDataUri(colors: ForebayColors = FOREBAY_SLATE_LIGHT): string {
  return `data:image/svg+xml,${encodeURIComponent(renderForebayMark(48, colors))}`;
}
