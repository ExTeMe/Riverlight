import { City } from './core.js';
import { getTemplate } from './models.js';
import { boxOutline } from './outline.js';
import { footprintOutline, normalAngle } from './parcel.js';
import { hasTraffic } from './road-network.js';
import { DEFAULT_PLATFORM, platformGeometry } from './riverfront-platform.js';

export const RIVERFRONT_STUDY_ID = 'T04-WEST';

const lots = [
  { id: 'west-bakery', type: 'bakery', x: -62, z: -10.5, width: 7.5, depth: 9, angle: 0 },
  { id: 'west-market', type: 'market', x: -48.5, z: -10.5, width: 13, depth: 9, angle: 0 },
  { id: 'west-house', type: 'cottage', x: -68, z: 8, width: 8, depth: 10, angle: 180 },
  { id: 'west-sage', type: 'sage-house', x: -77, z: 8, width: 8, depth: 8, angle: 180 },
];
export const STUDY_FRONTAGES = lots.slice(0, 2);

const frontcourt = { minX: -51.5, maxX: -30, minZ: -6, maxZ: -2 };
const forecourtRecess = { minX: -42, maxX: -38, minZ: -10, maxZ: -6 };
const alley = { minX: -58.25, maxX: -55, minZ: -15, maxZ: -6 };
const platform = { minX: -30.5, maxX: -21.5, minZ: 13, maxZ: 20 };
const ramp = { minX: -29.1, maxX: -26.9, minZ: 6, maxZ: 13, lowY: .19, highY: .61 };

export function createRiverfrontStudy(base) {
  const city = new City(base.city);
  const place = (type, x, z) => {
    if (!city.place(type, x, z)) throw new Error(`西岸试验场景无法放置 ${type} (${x}, ${z})`);
  };
  place('road', -8, 1);
  for (const x of [-17, -18, -19]) place('road', x, 0);
  for (const [x, z] of [[-7, 1], [-6, 1], [-5, 1], [-5, 2], [-4, 2], [-4, 3], [-3, 3]]) place('path', x, z);
  place('tree', -4.5, 4);
  place('cherry', -4, 5.5);
  place('tree', -2.5, 6.5);
  place('bench', -6, 5.5);

  for (const { type, ...parcel } of lots.slice(2)) {
    const result = city.editParcel(parcel, { type, color: 0, offsetX: 0, offsetZ: 0, angle: 0 });
    if (!result.changed) throw new Error(`西岸试验场景地块无效：${parcel.id} ${result.error ?? ''}`);
  }

  city.name = '西岸街坡 · 衔接试验';
  city.environment = { ...city.environment, hour: 13 };
  const camera = { position: [-25, 34, 53], target: [-42, 0, 4] };
  return {
    id: RIVERFRONT_STUDY_ID,
    sceneVersion: 2,
    seed: base.seed,
    density: base.density,
    name: '西岸街坡',
    caption: '窄铺面经桥头前场接到滨水步道',
    purpose: '在空段试建沿街铺面和陆侧平台，先做哪边都可以。白线标出占地或建议铺装，青线来自实际步行图。',
    limitations: ['目录模型用于尺度对照', '直坡下端贴合现有地面步道', '过街验证几何和步行连接'],
    camera,
    cameras: {
      medium: camera,
      near: { position: [-26, 17, 30], target: [-42, 0, 0] },
      walk: { position: [-24, 44, 48], target: [-38, 0, 4] },
      river: { position: [7, 30, 46], target: [-13, 0, 5] },
    },
    city: city.snapshot(),
  };
}

export function frontageSuggestion(city, parcel, roadId) {
  let best = 16 ** 2, result = null;
  const { x, z } = parcel;
  const bounds = { minX: x - 16, maxX: x + 16, minZ: z - 16, maxZ: z + 16 };
  for (const entity of city.queryFootprints(bounds)) {
    if (!hasTraffic(entity.type) || roadId != null && roadId !== entity.id) continue;
    const segment = city.roadNetwork.segments.get(entity.id);
    for (const { points, kind } of segment?.walkways ?? []) {
      if (kind === 'crossing') continue;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay, az] = points[i - 1], [bx, by, bz] = points[i];
        const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
        if (length < .001) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
        const px = ax + t * dx, pz = az + t * dz;
        const distance = (px - x) ** 2 + (pz - z) ** 2;
        if (distance >= best) continue;
        best = distance;
        const sign = dz * (px - x) - dx * (pz - z) < 0 ? -1 : 1;
        const angle = normalAngle(Math.atan2(sign * dz, -sign * dx) * 180 / Math.PI);
        result = { angle, point: [px, ay + t * (by - ay), pz] };
      }
    }
  }
  return result;
}

// A route in the evidence must use the designated crossing, even when the graph has another way across.
function walkLeg(graph, start, goal) {
  if (!start) return [];
  const previous = new Map([[start.id, null]]);
  const queue = [start];
  for (const node of queue) {
    if (goal(node)) {
      const points = [];
      for (let id = node.id; id; id = previous.get(id)) {
        const { x, y, z } = graph.nodes.get(id);
        points.push([x, y, z]);
      }
      return points.reverse();
    }
    for (const [id, kind] of node.edges) {
      if (kind === 'crossing' || previous.has(id)) continue;
      previous.set(id, node.id);
      queue.push(graph.nodes.get(id));
    }
  }
  return [];
}

export function riverfrontEvidence(city, graph) {
  const segment = city.roadNetwork.segments.get(city.at(-8, 0)?.id);
  const crossing = segment?.walkways.find(({ kind, points: [a, b] }) =>
    kind === 'crossing' && a[0] === b[0] && a[0] > segment.center[0]);
  const ends = crossing?.points.toSorted((a, b) => a[2] - b[2]) ?? [];
  const [north, south] = ends.map(point => graph.nodes.get(point.map(value => value.toFixed(3)).join(',')));
  const hasCrossing = north?.edges.get(south?.id) === 'crossing';
  const toQuay = hasCrossing ? walkLeg(graph, south, node => node.kind === 'quay' && node.x < 0 && node.z >= 8 && node.z <= 20) : [];
  const platformPlan = city.platform;
  const platformNode = [...graph.nodes.values()].find(node => node.kind === 'platform');
  const entries = STUDY_FRONTAGES.map(({ id }) => {
    const parcel = city.parcels.get(id);
    const entity = parcel && city.parcelOwner(parcel);
    const node = entity && graph.destinations.find(destination => destination.entityId === entity.id);
    const toCrossing = hasCrossing ? walkLeg(graph, node, current => current.id === north.id) : [];
    const toPlatform = hasCrossing && platformNode ? walkLeg(graph, south, current => current === platformNode) : [];
    return {
      parcel: id,
      built: !!entity,
      source: entity ? (getTemplate(entity.type, entity.color).userData.anchors?.entrance ? 'authored' : 'fallback') : null,
      point: node ? [node.x, node.y, node.z] : null,
      route: toCrossing.length && toQuay.length ? [...toCrossing, ...toQuay] : null,
      platformRoute: toCrossing.length && toPlatform.length ? [...toCrossing, ...toPlatform] : null,
    };
  });
  const builtPlatform = platformPlan && {
    ...platformPlan.record, centerline: platformPlan.geometry.centerline,
    quayRoute: walkLeg(graph, platformNode, node => node.kind === 'quay' && node.x < 0 && node.z >= 8 && node.z <= 20),
  };
  return { crossing: hasCrossing ? ends : null, quay: toQuay.at(-1) ?? null, entries, platform: builtPlatform ?? null,
    reserved: { frontcourt, forecourtRecess, alley, platform, ramp } };
}

export function riverfrontGuideLines(city, layer) {
  const atHeight = (outline, height) => outline.map(([x, z]) => [x, height, z]);
  let outlines = [];
  if (layer === 'buildings') outlines = [...city.entities.values()].filter(entity =>
    lots.some(lot => entity.pose?.parcel.id === lot.id)).map(entity => atHeight(footprintOutline(entity), .25));
  if (layer === 'forecourt') outlines = [{ ...frontcourt, minX: -74 }, forecourtRecess].map(bounds => atHeight(boxOutline(bounds), .25));
  if (layer === 'alley') outlines = [atHeight(boxOutline(alley), .1)];
  if (layer === 'platform') outlines = (city.platform?.geometry ?? platformGeometry(DEFAULT_PLATFORM))
    .surfaces.map(({ points }) => points.map(([x, y, z]) => [x, y + .035, z]));
  return outlines.flatMap(outline => outline.flatMap((point, i) => [...point, ...outline[(i + 1) % outline.length]]));
}
