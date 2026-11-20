import { createScene } from './baseline.js';
import { BY_ID, CATALOG, LEGACY_LOTS } from './catalog.js';
import { City } from './core.js';
import { DEFAULT_PLATFORM } from './riverfront-platform.js';

const buildings = [
  { id: 'west-reading-house', name: '西岸住宅', category: 'home', kind: 'house', w: 2.375, d: 3, color: '#cbbb9f', roof: '#9a5033', floors: 2, obstacleHeight: 6.65 },
  { id: 'west-bridge-market', name: '桥头市集', category: 'city', kind: 'shop', w: 3.625, d: 2.875, color: '#a89777', floors: 1, obstacleHeight: 6.05 },
];
const parcels = [
  { id: 'west-bakery', x: -64.75, z: -12.25, width: 9.5, depth: 12, angle: 0 },
  { id: 'west-market', x: -49.5, z: -16, width: 14.5, depth: 11.5, angle: 0 },
];

export const buildingStudyAssets = {
  'west-reading-house': [
    new URL('../assets/studies/west-reading-house.glb', import.meta.url).href,
    new URL('../assets/studies/west-reading-house_lod.glb', import.meta.url).href,
  ],
  'west-bridge-market': [
    new URL('../assets/studies/west-bridge-market.glb', import.meta.url).href,
    new URL('../assets/studies/west-bridge-market_lod.glb', import.meta.url).href,
  ],
};

export function registerStudyBuildings() {
  for (const item of buildings) {
    if (Object.hasOwn(BY_ID, item.id)) continue;
    CATALOG.push(item);
    BY_ID[item.id] = item;
    LEGACY_LOTS[item.id] = [item.w, item.d];
  }
}

export function createBuildingStudy(id, density) {
  const base = createScene('T04-WEST', density);
  const city = new City(base.city, { allowRiverfront: true });
  const path = Array.from({ length: 11 }, (_, i) => [i - 18, -1]);
  city.paint('path', path.concat([[-12, -2], [-11, -2], [-12, -6], [-11, -6]]));
  city.place('tree', -12, -7);
  city.place('bench', -11, -7);
  for (const [i, parcel] of parcels.entries()) {
    const placed = city.editParcel(parcel, { type: buildings[i].id, color: 0, offsetX: 0, offsetZ: 0, angle: 0 });
    if (!placed.changed) throw new Error(`建筑样板地块无效：${placed.error}`);
  }
  const platform = city.editPlatform({ ...DEFAULT_PLATFORM, x: -12.75, z: 14, width: 5.5, depth: 4, run: 2, rise: .14 });
  if (!platform.changed) throw new Error(`建筑样板滨水平台无效：${platform.error}`);
  city.name = '西岸住宅与桥头市集';
  const camera = { position: [-62, 20, 24], target: [-54, 1, -8] };
  return {
    ...base, id, sceneVersion: 1, name: city.name, camera,
    caption: '住宅门廊与市集前场共用一段西岸小街。',
    purpose: '观察建筑尺度、结构、入口和昼夜使用。可在建造栏选择这两种样板，自由放置与旋转。',
    limitations: ['市集摊贩活动待做', '建筑视觉待确认'],
    cameras: {
      near: camera,
      medium: { position: [-26, 37, 63], target: [-37, 0, 7] },
      home: { position: [-73.7, 4.6, -1.8], target: [-65.35, 2.8, -12.4] },
      market: { position: [-43, 6.5, 3.9], target: [-49.4, 2, -14.4] },
      marketInside: { position: [-49.5, 2.12, -9.18], target: [-49.2, 1.87, -16.25] },
    },
    city: city.snapshot(),
  };
}
