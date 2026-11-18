export const CELL = 4;
export const SNAP = .5; // Two metres per editable subdivision; road graph cells stay four metres.
export const CHUNK = 16;
export const CATEGORIES = [
  { id: 'home', label: '住宅', icon: 'home' }, { id: 'city', label: '商业', icon: 'building' },
  { id: 'civic', label: '公共', icon: 'landmark' }, { id: 'park', label: '公园', icon: 'tree' },
  { id: 'road', label: '道路', icon: 'road' }, { id: 'detail', label: '装饰', icon: 'flower' },
];
const item = (id, name, category, kind, w, d, color, extra = {}) => ({ id, name, category, kind, w, d, color, ...extra });
export const CATALOG = [
  item('bridge-court', '双庭石居', 'home', 'house', 4, 4, '#ad9f88', { floors: 2, roof: '#576a6d' }),
  item('cottage', '河畔小屋', 'home', 'house', 2, 2, '#ece1c7', { floors: 1, roof: '#b35d43' }),
  item('sage-house', '鼠尾草小屋', 'home', 'house', 2, 2, '#a7b9a5', { floors: 1, roof: '#586c6b' }),
  item('rose-house', '蔷薇小屋', 'home', 'house', 2, 2, '#dab0a2', { floors: 1, roof: '#9a5445' }),
  item('villa', '花园别墅', 'home', 'house', 3, 2, '#e9e3d2', { floors: 2, roof: '#9c6550' }),
  item('townhouse', '沿街联排', 'home', 'apartment', 2, 2, '#b8755b', { floors: 3 }),
  item('apartment', '阳光公寓', 'home', 'apartment', 2, 2, '#e2d1af', { floors: 5 }),
  item('mint-apartment', '薄荷公寓', 'home', 'apartment', 2, 2, '#a4b9b2', { floors: 4 }),
  item('residence', '空中花园', 'home', 'tower', 3, 3, '#d9d8c8', { floors: 10 }),
  item('cafe', '转角咖啡', 'city', 'shop', 2, 2, '#e6dac4', { floors: 2, awning: '#627b62' }),
  item('bakery', '晨光面包房', 'city', 'shop', 2, 2, '#dab49a', { floors: 2, awning: '#b65f45' }),
  item('bookshop', '河岸书店', 'city', 'shop', 2, 2, '#c1cdcb', { floors: 2, awning: '#4d777a' }),
  item('market', '街区集市', 'city', 'shop', 3, 2, '#e7c58e', { floors: 1, awning: '#d49e4f' }),
  item('mall', '河光购物中心', 'city', 'mall', 5, 4, '#d9c9ad', {floors:2}),
  item('office', '白榆办公楼', 'city', 'office', 3, 3, '#e4e4d9', { floors: 9 }),
  item('glass-tower', '滨江中心', 'city', 'tower', 3, 3, '#789b9e', { floors: 15 }),
  item('terrace-tower', '云阶大厦', 'city', 'tower', 3, 3, '#d9d3c3', { floors: 12, stepped: true }),
  item('hotel', '日落酒店', 'city', 'office', 3, 2, '#d2b09b', { floors: 7 }),
  item('library', '城市图书馆', 'civic', 'civic', 3, 3, '#e2dac8', { floors: 2 }),
  item('museum', '河畔美术馆', 'civic', 'civic', 3, 2, '#e8e6d9', { floors: 2 }),
  item('school', '梧桐小学', 'civic', 'apartment', 3, 2, '#dfbb95', { floors: 3 }),
  item('clinic', '社区诊所', 'civic', 'civic', 2, 2, '#dfebe1', { floors: 2 }),
  item('clocktower', '时光钟楼', 'civic', 'clock', 2, 2, '#cfac87', { floors: 5 }),
  item('park', '口袋公园', 'park', 'park', 2, 2, '#81a077'),
  item('plaza', '喷泉广场', 'park', 'fountain', 3, 3, '#c9c6af'),
  item('grove', '城市小森林', 'park', 'grove', 3, 3, '#719774'),
  item('garden', '花间庭院', 'park', 'garden', 2, 2, '#a9ac76'),
  item('amusement', '河畔游乐园', 'park', 'amusement', 6, 5, '#c58c63'),
  item('road', '城市道路', 'road', 'road', 1, 1, '#747b7d'),
  item('bridge', '跨河桥梁', 'road', 'bridge', 1, 1, '#b4b8ae'),
  item('path', '步行小径', 'road', 'path', 1, 1, '#d5c8ac'),
  item('tree', '阔叶树', 'detail', 'tree', 1, 1, '#6d9568'),
  item('pine', '常青松', 'detail', 'pine', 1, 1, '#4c786a'),
  item('cherry', '樱花树', 'detail', 'cherry', 1, 1, '#d9aaae'),
  item('flowers', '四季花坛', 'detail', 'flowers', 1, 1, '#b8806b'),
  item('bench', '公园长椅', 'detail', 'bench', 1, 1, '#a67d52'),
  item('lamp', '街角路灯', 'detail', 'lamp', 1, 1, '#e3cb91'),
  item('pier', '水岸小码头', 'detail', 'pier', 2, 2, '#ae9065'),
];
export const LEGACY_LOTS = Object.fromEntries(CATALOG.map(item => [item.id,[item.w,item.d]]));
// Narrow frontages, deeper gardens and rectangular civic plots break up uniform square lots.
for(const [id,w,d] of [['cottage',1.5,2],['sage-house',1.5,1.5],['rose-house',2,1.5],['townhouse',2,1.5],['mint-apartment',1.5,2],['cafe',2,1.5],['bakery',1.5,2],['bookshop',1.5,2],['office',2.5,3],['library',3,2.5],['clinic',2,1.5],['clocktower',1.5,1.5],['garden',2,1.5]]){
  const item=CATALOG.find(item=>item.id===id);item.w=w;item.d=d;
}
export const BY_ID = Object.fromEntries(CATALOG.map(item => [item.id, item]));
export function dimensions(item, rotation = 0) { return rotation % 2 ? [item.d, item.w] : [item.w, item.d]; }
export function entityDimensions(e){const item=BY_ID[e.type];return dimensions(e.lot?{w:e.lot[0],d:e.lot[1]}:item,e.rotation);}
export const snapStep=type=>['road','bridge','path','tree'].includes(type)?1:SNAP;
