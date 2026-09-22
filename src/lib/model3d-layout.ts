/** Web layout uses glTF coordinates: east +X, up +Y, south +Z. */
export type ModelPoint = [number, number, number];
/** glTF = BOM * 0.01, rounded to 6 BOM decimals (what the committed layout files carry). */
export const bomToGltf = (n: number) => Math.round(n * 1e6) / 1e8;
export type ModelBounds = { min: ModelPoint; max: ModelPoint };
export type ModelRoom = {
  id: string;
  stage: "beginner" | "middle" | "final";
  floor: number;
  center: ModelPoint;
  width: number;
  height: number;
  shape: "square" | "circle";
  floating: boolean;
};
export type ModelLandmark = {
  label: { zh: string; ja: string };
  center: ModelPoint;
  radius: number;
  bottom: number;
  top: number;
};
export type ModelLayout = {
  version: 2;
  revision: string;
  resetBounds: ModelBounds;
  overviewBounds: ModelBounds;
  rooms: ModelRoom[];
  landmarks: ModelLandmark[];
};

export const stageLabels = {
  zh: { beginner: "初級", middle: "中級", final: "頂級" },
  ja: { beginner: "序位", middle: "中位", final: "極位" },
} as const;

export function roomLabel(room: ModelRoom, lang: "zh" | "ja") {
  return `${stageLabels[lang][room.stage]} ${room.floor}F`;
}

/** Fit all eight corners; include their depth so tall towers cannot be clipped.
 * fieldOfView is the actual vertical FOV, after model-viewer's aspect adjustment.
 */
export function fitModelBounds(bounds: ModelBounds, aspect: number, fieldOfView: number,
  thetaDegrees = 0, phiDegrees = 0) {
  const target = bounds.min.map((n, i) => (n + bounds.max[i]) / 2) as ModelPoint;
  const theta = thetaDegrees * Math.PI / 180;
  const phi = phiDegrees * Math.PI / 180;
  const right = [Math.cos(theta), 0, -Math.sin(theta)];
  const up = [-Math.cos(phi) * Math.sin(theta), Math.sin(phi), -Math.cos(phi) * Math.cos(theta)];
  const forward = [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
  const tanV = Math.tan(fieldOfView * Math.PI / 360);
  const tanH = tanV * Math.max(aspect, 0.1);
  const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  let distance = 0;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = [x - target[0], y - target[1], z - target[2]];
        distance = Math.max(distance, dot(point, forward) + 1.12 * Math.max(
          Math.abs(dot(point, right)) / tanH, Math.abs(dot(point, up)) / tanV));
      }
    }
  }
  return {
    orbit: `${thetaDegrees}deg ${phiDegrees}deg ${Math.max(2, distance)}m`,
    target: target.map(n => `${n}m`).join(" "),
  };
}

export function roomBounds(room: Pick<ModelRoom, "center" | "width" | "height" | "shape" | "floating">): ModelBounds {
  // Include the water around rest rooms and the suspended room undersides.
  const radius = Math.max(room.width * (room.shape === "circle" ? 1.8 : 0.8), 0.65);
  const [x, y, z] = room.center;
  return {
    min: [x - radius, y - (room.floating ? 0.25 : 0.08), z - radius],
    max: [x + radius, y + room.height, z + radius],
  };
}

export function pickModelLabel(layout: ModelLayout, point: ModelPoint, lang: "zh" | "ja") {
  const [x, y, z] = point;
  const room = layout.rooms.find(r => {
    const dx = x - r.center[0], dz = z - r.center[2];
    const half = r.width / 2 + 0.06;
    const inFootprint = r.shape === "circle" ? dx * dx + dz * dz <= half * half
      : Math.abs(dx) <= half && Math.abs(dz) <= half;
    return inFootprint && y >= r.center[1] - (r.floating ? 0.25 : 0.08)
      && y <= r.center[1] + r.height + 0.15;
  });
  if (room) return roomLabel(room, lang);
  return layout.landmarks.find(l => (x - l.center[0]) ** 2 + (z - l.center[2]) ** 2 <= l.radius ** 2
    && y >= l.bottom && y <= l.top)?.label[lang] ?? null;
}

/** Frame a typed or picked point like a single 100-size room. */
export const pointBounds = (center: ModelPoint) =>
  roomBounds({ center, width: 1, height: 1, shape: "square", floating: false });

/** Parse "x, y, z" or "x, z" typed in BOM units (comma, space or tab separated, as pasted from
 * the sheet; full-width minus accepted) into glTF units. y omitted or blank comes back null. */
export function parseBomInput(text: string): { x: number; y: number | null; z: number } | null {
  const fields = text.replace(/[−–]/g, "-").replace(/[()（）]/g, " ").split(/[,，\t]/);
  const parts = fields.length === 1 ? fields[0].trim().split(/\s+/) : fields.map(f => f.trim());
  if (parts.length !== 3 && parts.length !== 2) return null;
  const numbers = parts.map(p => p === "" ? null : Number(p));
  if (numbers.some(n => n !== null && !Number.isFinite(n))) return null;
  const [x, y, z] = parts.length === 2 ? [numbers[0], null, numbers[1]] : numbers;
  if (x === null || z === null) return null;
  return { x: bomToGltf(x), y: y === null ? null : bomToGltf(y), z: bomToGltf(z) };
}

export function formatBom(point: ModelPoint) {
  return `BOM (${point.map(n => Math.round(n * 100) || 0).join(", ")})`;
}
