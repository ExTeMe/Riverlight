import { City, waterAt, gridLine, createDemo } from './core.js';

export const BASELINE = Object.freeze({
  id: 'BASE-02',
  sceneVersion: 1,
  seed: 20261013,
  camera: { position: [120, 115, 150], target: [0, 0, 0] },
  limitations: ['任意角度、信号通行、目的地行为、雨伞和桥船净空尚未实现'],
});

// Explicit placements keep the layout independent of render-frame randomness.
export function createBaseline() {
  const city = new City();
  city.name = '基线 · 河畔编辑院';
  city.environment = { ...city.environment, hour: 16.5, playing: false, wind: .4, quality: 'high' };
  const add = (type, x, z, rotation = 0, color = 0) => {
    if (!city.place(type, x, z, rotation, color)) throw new Error(`无效基线物件：${type} (${x}, ${z})`);
  };
  for (let x = -28; x <= 28; x++) add(waterAt(x, 0) ? 'bridge' : 'road', x, 0);
  for (let x = -36; x <= -32; x++) add('road', x, -14);
  for (let z = 1; z <= 8; z++) add('path', -18, z);
  for (const entry of [
    ['cottage', -26.5, -5.5, 0, 1], ['villa', -24, 5.5, 1, 2],
    ['bakery', -20, -4, 0, 0], ['cafe', 18, -4, 0, 2], ['park', 20, 5, 0, 0],
    ['tree', -29, 3, 0, 0], ['bench', -18.5, 10, 0, 0],
  ]) add(...entry);
  city.undoStack = []; city.redoStack = [];
  return { ...structuredClone(BASELINE), city: city.snapshot(2) };
}

export function createLegacyBaseline() {
  const city = new City();
  city.terrain = 'legacy'; city.name = '基线 · 旧城原件';
  const data = city.snapshot(2);
  data.version = 1; delete data.terrain;
  data.entities = [
    { id: 1, type: 'cottage', x: -30, z: -10, rotation: 1, color: 2 },
    { id: 2, type: 'road', x: -30, z: -5, rotation: 0, color: 0 },
  ];
  data.nextId = 3;
  return { id: 'BASE-02-v1', sceneVersion: 1, seed: BASELINE.seed,
    city: data, camera: structuredClone(BASELINE.camera) };
}

export const SCENES = [
  {id:'T01',sceneVersion:3,name:'河畔编辑院',caption:'小屋、庭院与不同尺度的沿街建筑',purpose:'试用划定地块、移动整块和调整建筑。比较相接的小屋与图书馆地块，再看办公楼和商场的尺度。',limitations:['旧格网建筑沿用原有编辑；地块自由编辑的整条验收由 R2 下一项覆盖'],target:[-76,0,-16],position:[-30,62,70],spatialProbe:[
    {minX:-72,minZ:-24,maxX:-64,maxZ:-6},{minX:-64,minZ:-24,maxX:-24,maxZ:-6},
    {minX:-75,minZ:-58,maxX:-64,maxZ:-40},{minX:-64,minZ:-58,maxX:-50,maxZ:-40}
  ]},
  {id:'T02',name:'转角街道',caption:'沿着街角，走过不同的路',purpose:'观察直线、左右转角、折线 S 形、T 字与断头路；在 x=-16 的分区边界拆建道路。',limitations:['S 形为正交折线；连续曲线与可编辑坡道尚未实现'],target:[-94,0,-8],position:[-40,90,95]},
  {id:'T03',name:'十字路口',caption:'四条来路，一处相逢',purpose:'观察四个入口的车辆；删除路口中心 (-24,0)，检查道路重建。',limitations:['信号相位、跟车队列与冲突权限尚未实现，灯色不作为通过证据'],target:[-96,0,0],position:[-45,65,70]},
  {id:'T04',name:'桥与河湾',caption:'从桥头到水面，换个角度看',purpose:'沿河观察船体与桥孔，再切换桥头镜头；记录桥底、桥墩及引道穿模。',limitations:['桥船净空尚未解决；当前只有原型船，不代表最大船型验收'],target:[0,0,0],position:[55,35,60]},
  {id:'T05',name:'街坊的一天',caption:'从家门口，到商店与公园',purpose:'沿住宅—商店—公园观察自动行人，切换降雨并检查露天和屋檐位置。',limitations:['目的地、信号过街、可达屋檐与雨伞尚未实现'],target:[-75,0,4],position:[-35,42,65]},
  {id:'T06',sceneVersion:3,name:'河光小街',caption:'店铺的暖光，河畔的四季',purpose:'保持同一镜头切换白天、黄昏、雨夜、秋景与雪景；比较近中远景。',limitations:['六类样板同场展示，待整组画面确认；码头停靠和桥船净空另由水系任务验收'],target:[-65,0,0],position:[-10,55,85]},
  {id:'T07',name:'城市的尺度',caption:'从一条小街，到整座城市',purpose:'选择疏密布局，扩区后移向边缘再返回；保存、重载并采集实际资源快照。',limitations:['帧时间、GPU 内存和长期增长需专项采样，单帧快照不是性能验收'],target:[0,0,0],position:[183,180,230]},
];

export const SCENE_WEATHER = [
  {id:'day',name:'白天',hour:13,season:'summer',weather:'clear'},
  {id:'dusk',name:'黄昏',hour:17.5,season:'summer',weather:'clear'},
  {id:'rain',name:'雨夜',hour:20,season:'summer',weather:'rain'},
  {id:'autumn',name:'秋景',hour:15,season:'autumn',weather:'clear'},
  {id:'snow',name:'雪景',hour:10,season:'winter',weather:'snow'},
];

// Fixed placements, not random decoration: invalid geometry fails visibly.
export function createScene(id, density='standard') {
  const spec=SCENES.find(scene=>scene.id===id);
  if(!spec)throw new Error(`未知场景：${id}；请选择 T01～T07`);
  if(!['sparse','standard','dense'].includes(density))throw new Error('未知场景密度');
  let city=id==='T01'?new City(createBaseline().city):id==='T07'&&density!=='sparse'?createDemo():new City();
  const add=(type,x,z,rotation=0,color=0)=>{
    if(!city.place(type,x,z,rotation,color))throw new Error(`${id} 场景位置无效：${type} (${x}, ${z})`);
  };
  const road=(points)=>{
    for(let i=1;i<points.length;i++)for(const [x,z] of gridLine(points[i-1],points[i])){
      if(city.at(x,z))continue;
      const e={type:'road',x,z,rotation:0,color:0};
      add(city.canPlace(e)?'bridge':'road',x,z);
    }
  };
  const street=()=>{
    road([[-29,0],[-9,0]]);road([[-24,-9],[-24,10]]);
    for(const entry of [['cottage',-28,3],['villa',-27,-5],['townhouse',-22,-4],['bakery',-19,-3],['cafe',-16,-3],['bookshop',-13,-3],['park',-21,3],['garden',-17,3],['library',-13,4]])add(...entry);
    for(let x=-28;x<=-10;x+=3){add('tree',x,2);add('lamp',x,-1);}
    for(let x=-22;x<=-10;x++)add('path',x,7);
    add('bench',-18,6);add('flowers',-16,6);
  };
  if(id==='T01'){
    add('library',-17,-3.5);add('office',-14,-4);add('mall',-11.5,-5);
    const data=city.snapshot(),angle=32,radians=angle*Math.PI/180;
    const houseLot={id:'t01-cottage',x:-75,z:-39,width:14,depth:12,angle};
    const libraryLot={id:'t01-library',x:houseLot.x+16*Math.cos(radians),z:houseLot.z-16*Math.sin(radians),width:18,depth:17,angle};
    data.parcels.push(houseLot,libraryLot);
    data.entities.push(
      {id:data.nextId++,type:'cottage',color:2,parcelId:houseLot.id,offsetX:.75,offsetZ:-1.25,angle:17},
      {id:data.nextId++,type:'library',color:1,parcelId:libraryLot.id,offsetX:.5,offsetZ:.75,angle:349},
    );
    city=new City(data);
  }
  if(id==='T02'){
    road([[-34,-14],[-25,-14],[-25,-6],[-15,-6],[-15,4],[-9,4]]);
    road([[-34,7],[-24,7],[-24,-6]]);road([[-24,7],[-24,13]]);
    add('cafe',-28,-11);add('townhouse',-21,4);add('tree',-28,-7);
  }
  if(id==='T03'){
    road([[-38,0],[-10,0]]);road([[-24,-14],[-24,14]]);
    for(const entry of [['cafe',-28,-4],['bakery',-21,-4],['apartment',-28,3],['park',-21,3]])add(...entry);
  }
  if(id==='T04'){
    road([[-16,0],[16,0]]);
    for(let z=-12;z<=12;z++)if(z!==0)add('path',-10,z);
    add('cafe',-14,3);add('park',10,4);add('lamp',-9,-2);
  }
  if(id==='T05'||id==='T06'||id==='T07'&&density==='sparse')street();
  if(id==='T06'){
    road([[-24,0],[15,0]]);
    for(const entry of [['museum',-21,-8],['office',-17,-8],['clocktower',-12,-7],['plaza',-20,9],['rose-house',-26,5],['mint-apartment',-29,-9]])add(...entry);
    for(let z=-9;z<=11;z++)if(z!==0)add('path',-9,z);
    for(const z of [-10,-4,4,8])add('tree',-10,z);
    add('path',-20,5);add('path',-20,6);
    add('pier',-1.5,4,3);
  }
  if(id==='T07'&&density==='dense'){
    city.expand();
    for(const side of [-1,1]){
      const x=side<0?-53:44;road([[x,-30],[x,30]]);
      for(let z=-28;z<=28;z+=4){add('apartment',x+2,z);add('townhouse',x-3,z);add('tree',x+1,z+2);}
    }
  }
  city.name=`${id} · ${spec.name}`;city.environment={...city.environment,hour:17.5,playing:false,wind:.4,quality:'high'};
  city.undoStack=[];city.redoStack=[];
  const target=[...spec.target],position=[...spec.position];
  const cameras={medium:{position,target},near:{target:[...target],position:target.map((v,i)=>v+(position[i]-v)*.48)},far:{target:[...target],position:target.map((v,i)=>v+(position[i]-v)*1.75)}};
  return {...structuredClone(spec),sceneVersion:spec.sceneVersion??1,seed:20261103,density,city:city.snapshot(),camera:cameras.medium,cameras};
}
