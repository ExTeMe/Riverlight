import { GROUND_Y, QUAY, quaySection, riverSections } from './river.js';
import { boundsContain, boxOutline, outlineBounds, outlineContains, outlinesOverlap, transformOutline } from './outline.js';
import { footprintOutline, normalAngle, parcelOnLand, parcelOutline } from './parcel.js';
import { alignmentGeometry } from './road-alignment.js';
import { ROAD_PROFILES } from './road-network.js';

export const DEFAULT_PLATFORM = Object.freeze({
  id: 'west-platform', x: -28, z: 6, width: 9, depth: 7, angle: 0, run: 7, rise: .42, rampWidth: 2.2,
});

export function platformGeometry(record) {
  const { x, z, width, depth, angle, run, rise, rampWidth } = record;
  const low = ROAD_PROFILES.path.walkY, high = low + rise;
  const project = (points, heights) => transformOutline(points, x, z, angle * Math.PI / 180)
    .map(([u, v], i) => [u, heights[i], v]);
  const deck = project(boxOutline({ minX: -width / 2, maxX: width / 2, minZ: run, maxZ: run + depth }), Array(4).fill(high));
  const ramp = project(boxOutline({ minX: -rampWidth / 2, maxX: rampWidth / 2, minZ: 0, maxZ: run }), [low, low, high, high]);
  const centerline = project([[0, 0], [0, run], [0, run + depth / 2]], [low, high, high]);
  const surfaces = [deck, ramp].map(points => {
    const outline = points.map(([u, , v]) => [u, v]);
    return { points, outline, bounds: outlineBounds(outline) };
  });
  return { surfaces, centerline, ground: GROUND_Y };
}

export function platformOverlaps(geometry, outlines) {
  return geometry.surfaces.some(({ outline }) => outlines.some(other => outlinesOverlap(outline, other)));
}

export function entityOutlines(entity) {
  return entity.alignment ? (alignmentGeometry(entity.alignment).sections ?? []).map(section => section.outline) : [footprintOutline(entity)];
}

export function platformPlan(city, draft) {
  const { id, x, z, width, depth, angle, run, rise, rampWidth } = draft ?? {};
  const values = [x, z, width, depth, angle, run, rise, rampWidth];
  if (id !== DEFAULT_PLATFORM.id || !values.every(value => Number.isFinite(value) && Math.abs(value) <= 32768))
    return { error: '平台位置或尺寸无效' };
  const record = { id, x, z, width, depth, angle: normalAngle(angle), run, rise, rampWidth };
  if (width < rampWidth || width > 24 || depth < 2 || depth > 18 || run < 2 || run > 18 || rampWidth < 1.5 || rampWidth > 5)
    return { error: '台面或缓坡尺寸超出试验范围（缓坡净宽须为 1.5–5 米）' };
  const geometry = platformGeometry(record);
  const blocked = error => ({ record, geometry, error });
  if (rise <= 0 || rise / run > .08 + 1e-8) return blocked('坡度须大于 0%，并且不超过 8%');
  const { surfaces } = geometry;
  if (surfaces.some(({ bounds }) => !boundsContain(city.worldBounds(), bounds))) return blocked('平台超出可建边界');
  if (surfaces.some(({ outline, bounds }) => !parcelOnLand(outline, bounds, city.terrain))) return blocked('平台或缓坡侵入水域');
  const minZ = Math.max(QUAY.minZ, Math.min(...surfaces.map(({ bounds }) => bounds.minZ)));
  const maxZ = Math.min(QUAY.maxZ, Math.max(...surfaces.map(({ bounds }) => bounds.maxZ)));
  if (minZ < maxZ && riverSections(minZ, maxZ, city.terrain).some(row =>
    platformOverlaps(geometry, [-1, 1].map(side => quaySection(row, side).outline))))
    return blocked('平台或缓坡占用沿岸通路');
  const [bottomLeft, bottomRight] = surfaces[1].points;
  let landing;
  for (const { bounds } of surfaces) {
    if (city.proposedParcels(bounds).some(parcel => platformOverlaps(geometry, [parcelOutline(parcel)])))
      return blocked('平台或缓坡与地块重叠');
    const nearby = { minX: bounds.minX - .01, maxX: bounds.maxX + .01, minZ: bounds.minZ - .01, maxZ: bounds.maxZ + .01 };
    for (const entity of city.queryFootprints(nearby)) {
      const outlines = entityOutlines(entity);
      if (platformOverlaps(geometry, outlines)) return blocked('平台或缓坡与已有道路、步道或物件重叠');
      if (entity.type === 'path' && [bottomLeft, bottomRight].every(([u, , v]) => outlineContains(outlines[0], u, v))) landing = entity;
    }
  }
  if (!landing) return blocked('缓坡下端须全宽贴合一块地面步道的边缘');
  return { record, geometry, landing };
}
