import { CATALOG, CATEGORIES, BY_ID, CELL, entityDimensions } from './catalog.js';
import { PRESETS } from './environment.js';
import { icon } from './icons.js';
import { SCENES, SCENE_WEATHER } from './baseline.js';
import { RIVERFRONT_STUDY_ID, riverfrontEvidence } from './riverfront-study.js';
import { BRIDGE_STYLES } from './bridge-styles.js';
const ib=(action,glyph,label,extra='')=>`<button class="icon-button ${extra}" data-action="${action}" data-tip="${label}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
const button=(action,glyph,label,primary=false)=>`<button class="button ${primary?'primary':''}" data-action="${action}">${icon(glyph,16)}${label}</button>`;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class UI {
  constructor(app){
    this.app=app;this.category='home';this.thumbnails=new Map();this.root=document.querySelector('#app');
    this.root.innerHTML=`
      <header class="topbar"><div class="brand glass"><div class="brand-logo">栖</div><div><h1>栖 城</h1><small>R I V E R L I G H T</small></div></div><div class="top-actions"><div class="city-label"><b id="city-name">河光之城</b><span id="save-state">你的城市，随心生长</span></div>${ib('save','save','保存城市 Ctrl+S')}${ib('cities','folder','我的城市')}${ib('audio','mute','声音与音乐')}${ib('screenshot','camera','拍张照片')}${ib('environment','settings','环境与氛围','active')}</div></header>
      <nav class="toolbar glass" aria-label="建造工具">${ib('select','select','选择 / V')}${ib('draw-parcel','expand','划定地块')}${ib('road','road','铺设道路 / B')}${ib('draw-road','curve','绘制曲线与坡道')}${ib('trees','tree','种植树木 / T')}${ib('erase','erase','拆除 / X')}<div class="sep"></div>${ib('undo','undo','撤销 Ctrl+Z')}${ib('redo','redo','重做 Ctrl+Y')}<div class="sep"></div>${ib('help','info','操作指南')}</nav>
      <div class="intro"><div class="eyebrow">A LITTLE CITY. YOUR OWN RHYTHM.</div><h2>在这里，慢慢生活。</h2><p>沿着河流，建造你喜欢的每一天。</p></div>
      <aside class="environment glass" aria-label="环境与氛围"><div class="panel-heading"><div><h2>此刻的风景</h2><small>MAKE A LITTLE ATMOSPHERE</small></div>${icon('leaf',19)}</div>
      <div class="field-label"><strong id="clock-label">16:30</strong><div class="time-controls"><select id="time-speed" aria-label="时间流速"><option value="1">1×</option><option value="4">4×</option><option value="8">8×</option></select><button data-action="play" aria-label="暂停或继续时间">${icon('play',13)}</button></div></div>
      <input class="range" id="time" aria-label="一天中的时间" type="range" min="0" max="23.99" step=".05" value="16.5"><div class="time-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <div class="section-label">四时流转 <span id="season-note">万物葱茏</span></div><div class="segmented">${[['spring','春'],['summer','夏'],['autumn','秋'],['winter','冬']].map(([id,name])=>`<button data-season="${id}">${name}</button>`).join('')}</div>
      <div class="section-label">天气</div><div class="weather-options">${[['clear','sun','晴朗'],['cloudy','cloud','多云'],['rain','rain','下雨'],['snow','snow','飘雪'],['fog','fog','薄雾']].map(([id,glyph,name])=>`<button data-weather="${id}" aria-label="${name}">${icon(glyph,19)}<span>${name}</span></button>`).join('')}</div>
      <div class="section-label">风的轻重 <span id="wind-label">微风</span></div><input class="range" id="wind" aria-label="风力" type="range" min="0" max="1" step=".05" value=".4">
      <div class="section-label">一键好时光 ${icon('sun',14)}</div><div class="presets">${PRESETS.map(p=>`<button class="preset" data-preset="${p.id}"><span>${p.name}</span><small>${p.caption}</small></button>`).join('')}</div>
      <div class="env-footer"><span>让风景多停留一会儿</span><select id="quality" aria-label="画质"><option value="high">精致画质</option><option value="balanced">流畅优先</option></select></div></aside>
      <section class="selection-panel glass" hidden><h3 id="selected-name"></h3><p id="selected-meta"></p><div class="selection-actions">${[['edit-lot','expand','移动整块'],['edit-building','move','调整建筑'],['edit-road','road','调整线形'],['extend-road-start','plus','延伸起点'],['extend-road-end','plus','延伸终点'],['inspect-junction','curve','转向预览'],['move','move','移动'],['rotate','rotate','旋转'],['copy','copy','复制'],['color','palette','配色'],['focus','eye','靠近'],['delete','erase','拆除'],['apply-group','check','应用'],['cancel-group','close','取消']].map(([action,glyph,label])=>`<button data-action="${action}" class="${action==='delete'?'danger':''}">${icon(glyph,17)}${label}</button>`).join('')}</div></section>
      <form class="parcel-editor glass" aria-label="地块与建筑编辑" hidden></form>
      <form class="parcel-editor road-editor glass" aria-label="道路编辑" hidden></form>
      ${app.baseline?.id===RIVERFRONT_STUDY_ID?'<form class="parcel-editor riverfront-editor glass" aria-label="滨水平台编辑" hidden></form>':''}
      <div class="world-controls"><div class="zoom glass">${ib('zoom-in','plus','放大')}${ib('zoom-out','minus','缩小')}${ib('home','compass','回到全景 Home')}</div><button class="pill glass" data-action="expand">${icon('expand',16)}<span>扩展地图</span></button></div>
      <div class="view-controls"><button class="pill glass" data-action="toggle-simulation" aria-label="暂停城市活动" title="暂停城市活动">${icon('pause',16)}<span>暂停城市活动</span></button><button class="pill glass" data-action="camera">${icon('camera',16)}<span id="camera-label">自由观察</span><kbd class="key">C</kbd></button><button class="pill glass" data-action="quiet">${icon('eye',16)}<span>静静欣赏</span></button></div>
      <div class="mode-hint" id="mode-hint" hidden></div>
      <section class="catalog glass" aria-label="建筑目录"><div class="catalog-head"><nav class="categories">${CATEGORIES.map(c=>`<button class="category" data-category="${c.id}">${icon(c.icon,16)}${c.label}</button>`).join('')}</nav><span class="catalog-label">${icon('leaf',12)} 米制地块 · 自由建造</span></div><div class="cards" id="cards"></div><div class="catalog-foot"><span id="world-stats"></span><span><kbd class="key">R</kbd>旋转 &nbsp; <kbd class="key">Esc</kbd>取消 &nbsp; 拖入或点击建筑开始</span></div></section>
      <div class="toast" role="status" aria-live="polite"></div><div class="quiet-hint">按 H 或 Esc 返回建造 · 此刻，只需欣赏</div><div class="modal-backdrop" hidden><section class="modal" role="dialog" aria-modal="true"></section></div><input type="file" id="import-file" accept=".json,application/json" hidden>`;
    this.root.addEventListener('click',event=>{
      const el=event.target.closest('button');if(!el)return;
      if(el.dataset.action)this.app.action(el.dataset.action,el).catch(err=>{console.error(err);this.toast(err.message,true);});
      if(el.dataset.category)this.showCategory(el.dataset.category);
      if(el.dataset.asset)this.app.startBuild(el.dataset.asset);
      if(el.dataset.season)this.app.setEnvironment({season:el.dataset.season});
      if(el.dataset.weather)this.app.setEnvironment({weather:el.dataset.weather});
      if(el.dataset.preset){const p=PRESETS.find(p=>p.id===el.dataset.preset);this.app.setEnvironment({hour:p.hour,season:p.season,weather:p.weather,wind:p.wind,playing:false});this.toast(`${p.name}，慢慢感受。`);}
    });
    this.root.addEventListener('dragstart',event=>{const card=event.target.closest('[data-asset]');if(!card)return;event.dataTransfer.setData('text/plain',card.dataset.asset);event.dataTransfer.effectAllowed='copy';this.app.startBuild(card.dataset.asset);});
    for(const [id,prop] of [['time','hour'],['wind','wind'],['time-speed','speed']])document.getElementById(id).addEventListener('input',event=>this.app.setEnvironment({[prop]:Number(event.target.value)}));
    document.getElementById('quality').addEventListener('change',event=>this.app.setEnvironment({quality:event.target.value}));
    document.getElementById('import-file').addEventListener('change',async event=>{const file=event.target.files[0];if(file)await this.app.importFile(file);event.target.value='';});
    this.root.querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))this.closeModal();});
    const explore=document.createElement('button');explore.className='pill glass scene-entry';explore.dataset.action='scenes';explore.textContent='探索场景';this.root.querySelector('.top-actions').prepend(explore);
    if(app.baseline?.cameras){
      this.root.querySelector('.intro').hidden=true;
      this.root.querySelector('.environment').hidden=true;
      this.root.querySelector('[data-action=environment]').classList.remove('active');
      const panel=document.createElement('aside');panel.className='scene-panel glass';panel.setAttribute('aria-label','场景实验室');
      panel.innerHTML=`<div class="scene-kicker">RIVERLIGHT / ${app.baseline.id}</div><h2>${escape(app.baseline.name)}</h2><p>${escape(app.baseline.caption)}</p>
        <div class="scene-buttons">${[['near','近景'],['medium','街区'],['far','全景'],['scale','尺度'],['corners','四向转角'],['alignment','线形'],['ramp','坡道'],['walk','步行连接'],['river','河岸与航域']].filter(([id])=>app.baseline.cameras[id]).map(([id,name])=>`<button data-action="scene-camera" data-view="${id}">${name}</button>`).join('')}</div>
        ${app.baseline.id==='T06'?`<div class="scene-buttons" role="group" aria-label="样板近景">${[['cottage','住宅'],['bakery','面包房'],['library','图书馆'],['office','办公楼'],['park','公园'],['pier','码头']].map(([id,name])=>`<button data-action="scene-camera" data-view="${id}">${name}</button>`).join('')}</div>`:''}
        ${app.baseline.junctionViews?`<div class="scene-buttons">${[['tee','T 字路口'],['terminal','断头路'],['junction','十字路口']].filter(([id])=>app.baseline.junctionViews[id]).map(([id,name])=>`<button data-action="scene-camera" data-view="${id}">${name}</button>`).join('')}</div>
          <div class="scene-buttons" id="junction-controls" hidden><button data-action="junction-vehicle" data-vehicle="car">小车</button><button data-action="junction-vehicle" data-vehicle="bus">公交</button><button data-action="hide-junction">关闭轨迹</button></div><p id="junction-summary" hidden></p>`:''}
        ${app.baseline.id===RIVERFRONT_STUDY_ID?`
          <div class="scene-buttons" role="group" aria-label="西岸建造">
            <button data-action="study-frontage" data-type="bakery">面包房</button>
            <button data-action="study-frontage" data-type="market">市集</button>
            <button data-action="study-paving">铺设前场</button>
          </div>
          <div class="scene-buttons">
            <button data-action="study-platform">滨水平台</button>
            <button data-action="study-remove-platform">拆除平台</button>
            <button data-action="study-walk" aria-pressed="false">显示步行图</button>
          </div>
          <p id="study-status" aria-live="polite"></p>
          <div class="scene-buttons" role="group" aria-label="西岸空间轮廓">${[['buildings','建筑占地'],['forecourt','前场位置'],['alley','通巷预留'],['platform','平台轮廓']].map(([id,name])=>`<button data-action="study-guide" data-layer="${id}" aria-pressed="false">${name}</button>`).join('')}</div>`:''}
        <div class="scene-buttons weather-compare">${SCENE_WEATHER.map(p=>`<button data-action="scene-weather" data-weather-id="${p.id}">${p.name}</button>`).join('')}</div>
        ${app.baseline.id==='T07'?`<div class="scene-buttons">${[['sparse','小街'],['standard','城区'],['dense','密集城区']].map(([id,name])=>`<button data-action="scene-density" data-density="${id}" aria-pressed="${app.baseline.density===id}">${name}</button>`).join('')}</div>`:''}
        <details><summary>观察与记录</summary><p>${escape(app.baseline.purpose)}</p><p>待实现：${escape(app.baseline.limitations.join('；'))}</p><p>v${app.baseline.sceneVersion} · 固定布局 ${app.baseline.seed} · 高画质起步。车辆与天气动画仍为原型随机状态。</p><button class="button" data-action="scene-evidence">导出资源快照</button></details>
        <div class="scene-footer"><button data-action="reset-baseline">重置场景</button><button data-action="resume-scene">保存并重载</button><button data-action="return-city">返回我的城市</button></div>`;
      this.root.append(panel);
      if(app.baseline.cameras.river){
        this.sailingStatus=document.createElement('p');this.sailingStatus.hidden=true;this.sailingStatus.setAttribute('aria-live','polite');
        panel.querySelector('.scene-buttons').after(this.sailingStatus);
      }
    }
    this.showCategory('home');this.refresh();
  }
  showCategory(id){this.category=id;this.root.querySelectorAll('[data-category]').forEach(el=>el.classList.toggle('active',el.dataset.category===id));
    const assets=CATALOG.filter(a=>a.category===id).map(a=>`<button class="asset-card" data-asset="${a.id}" draggable="true" aria-label="建造${a.name}"><span class="asset-size">${a.w*CELL}×${a.d*CELL} m</span><img src="${this.app.thumbnail(a.id)}" alt="${a.name}" draggable="false"><b>${a.name}</b><small>${a.kind==='bridge'?'连接河流两岸':a.kind==='road'?'按住拖动铺设':'点击或拖入城市'}</small></button>`).join('');
    const alignments=id==='road'?[
      ['draw-ramp','ramp','坡道','拖动铺设与调高'],
      ['draw-elevated','elevated','高架道路','接续升降与跨水'],
    ].map(([action,glyph,name,hint])=>`<button class="asset-card" data-action="${action}" aria-label="建造${name}"><span class="ramp-card-icon">${icon(glyph,38)}</span><b>${name}</b><small>${hint}</small></button>`).join(''):'';
    this.root.querySelector('#cards').innerHTML=assets+alignments;this.refreshActive();
  }
  refreshActive(){this.root.querySelectorAll('[data-asset]').forEach(el=>el.classList.toggle('active',(this.app.buildType??this.app.editor?.type)===el.dataset.asset));for(const [action,mode] of [['draw-ramp','ramp'],['draw-elevated','elevated']])this.root.querySelector(`[data-action="${action}"]`)?.classList.toggle('active',!!(this.app.roadEditor?.active&&this.app.roadEditor[mode]));this.root.querySelectorAll('.toolbar [data-action]').forEach(el=>el.classList.toggle('active',({select:'select',erase:'erase',road:'road',trees:'tree','draw-parcel':'parcel','draw-road':'alignment'}[el.dataset.action])===(this.app.buildType||this.app.mode)));}
  refresh(){
    const city=this.app.city,env=city.environment;
    this.root.querySelector('#city-name').textContent=city.name;
    const buildings=[...city.entities.values()].filter(e=>BY_ID[e.type].floors).length;
    this.root.querySelector('#world-stats').innerHTML=`<b>${buildings}</b> 座建筑 &nbsp; · &nbsp; <b>${city.entities.size}</b> 个物件 &nbsp; · &nbsp; <b>${city.radius*2} × ${city.radius*2}</b> 可扩展世界`;
    this.root.querySelector('[data-action=undo]').disabled=!city.undoStack.length;this.root.querySelector('[data-action=redo]').disabled=!city.redoStack.length;
    for(const kind of ['season','weather'])this.root.querySelectorAll(`[data-${kind}]`).forEach(el=>el.classList.toggle('active',el.dataset[kind]===env[kind]));
    this.root.querySelectorAll('[data-weather-id]').forEach(el=>{const preset=SCENE_WEATHER.find(p=>p.id===el.dataset.weatherId);el.setAttribute('aria-pressed',String(preset.weather===env.weather&&preset.season===env.season&&Math.abs(preset.hour-env.hour)<.05));});
    this.root.querySelector('#season-note').textContent={spring:'草木初醒',summer:'万物葱茏',autumn:'叶落知秋',winter:'岁月静好'}[env.season];
    this.root.querySelector('#wind-label').textContent=env.wind<.2?'轻拂':env.wind<.65?'微风':'起风了';
    this.root.querySelector('#wind').value=env.wind;this.root.querySelector('#quality').value=env.quality;this.root.querySelector('#time-speed').value=env.speed;
    this.clock();this.refreshActive();
    this.refreshSelection();
    this.refreshJunction();
    this.refreshStudy();
  }
  refreshStudy(){
    const status=this.root.querySelector('#study-status');if(!status)return;
    const {city,world,studyLayer}=this.app;
    const proof=riverfrontEvidence(city,world.traffic.people.network);
    const count=proof.entries.filter(entry=>entry.built).length;
    const toQuay=proof.entries.filter(entry=>entry.route).length;
    const platform=proof.platform?.quayRoute.length?'平台可步行至岸道':proof.platform?'平台暂未接到岸道':'可先建平台或沿街铺面';
    const crossing=!proof.crossing?'缺少桥头过街':count?`${toQuay} 处入口经桥头接岸`:'桥头过街已就绪';
    status.textContent=`${crossing} · ${platform}`;
    this.root.querySelector('[data-action=study-remove-platform]').disabled=!proof.platform;
    const walk=this.root.querySelector('[data-action=study-walk]');
    walk.setAttribute('aria-pressed',String(world.walkOverlay.visible));walk.textContent=world.walkOverlay.visible?'隐藏步行图':'显示步行图';
    for(const button of this.root.querySelectorAll('[data-action=study-guide]'))button.setAttribute('aria-pressed',String(button.dataset.layer===studyLayer));
  }
  refreshJunction(){
    const summary=this.root.querySelector('#junction-summary');if(!summary)return;
    const info=this.app.world.junctionPreview.active,controls=this.root.querySelector('#junction-controls');
    summary.hidden=controls.hidden=!info;
    if(!info)return;
    for(const button of controls.querySelectorAll('[data-vehicle]'))button.setAttribute('aria-pressed',String(button.dataset.vehicle===info.vehicle));
    summary.textContent=`${info.count} 条可用路径 · 蓝色左转 · 杏色右转 · 绿色直行 · 红色停车`;
  }
  refreshSelection(){
    const selected=this.app.city.entities.get(this.app.selected),parcel=this.app.city.parcels.get(this.app.selectedParcel);
    const panel=this.root.querySelector('.selection-panel');panel.hidden=(!selected&&!parcel)||!!this.app.editor?.active||!!this.app.roadEditor?.active||!!this.app.platformEditor?.active;
    if(panel.hidden)return;
    const count=this.app.selectionIds.size, draft=this.app.groupTransform;
    if(count>1){
      panel.querySelector('#selected-name').textContent=`已选中 ${count} 个物件`;
      panel.querySelector('#selected-meta').textContent=draft
        ?(draft.mode==='move'?'移动鼠标预览，点击画布放置':'点击旋转或按 R，再应用')
        :'Ctrl + 点击可增减选中物件';
      const shown=draft?['rotate','apply-group','cancel-group']:['move','rotate','delete'];
      for(const button of panel.querySelectorAll('[data-action]'))button.hidden=!shown.includes(button.dataset.action);
      return;
    }
    const item=BY_ID[selected?.type],size=selected?entityDimensions(selected).map(n=>n*CELL).join(' × '):'';
    const metres=n=>Number(n.toFixed(2));
    const bridge=this.app.world.bridgeStyles?.get(selected?.id);
    panel.querySelector('#selected-name').textContent=bridge?BRIDGE_STYLES[bridge.key].name:item?.name??'空地块';
    panel.querySelector('#selected-meta').textContent=selected?.alignment?`${selected.alignment.elevated?'高架道路':'连续道路'} · 可调整线形与高度`:parcel?`${metres(parcel.width)} × ${metres(parcel.depth)} 米地块 · ${metres(parcel.angle)}°${item?` · 建筑 ${size} 米`:' · 从目录选择建筑'}`:`${size} 米 · 格网物件`;
    const legacy=!!selected&&!parcel&&!selected.alignment;
    const ports=selected?.alignment&&this.app.city.roadNetwork.segments.get(selected.id).ports;
    const shown={'edit-lot':!!parcel,'edit-building':!!selected?.pose,'edit-road':!!selected?.alignment,
      'extend-road-start':!!ports&&!ports.some(port=>port.end===0),'extend-road-end':!!ports&&!ports.some(port=>port.end===1),
      'inspect-junction':selected?.type==='road'&&!!this.app.city.roadNetwork.segments.get(selected.id)?.junction,
      move:legacy,rotate:legacy,copy:!!selected&&!selected.alignment,color:!!item?.floors,focus:true,delete:true};
    for(const button of panel.querySelectorAll('[data-action]'))button.hidden=!shown[button.dataset.action];
  }
  clock(){const e=this.app.city.environment,h=Math.floor(e.hour),m=Math.floor((e.hour%1)*60);this.root.querySelector('#clock-label').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;if(document.activeElement.id!=='time')this.root.querySelector('#time').value=e.hour;this.root.querySelector('[data-action=play]').innerHTML=icon(e.playing?'pause':'play',13);}
  hint(text){const el=this.root.querySelector('#mode-hint');el.textContent=text;el.hidden=!text;}
  simulation(paused){
    const button=this.root.querySelector('[data-action="toggle-simulation"]');
    const label=paused?'恢复城市活动':'暂停城市活动';
    button.innerHTML=`${icon(paused?'play':'pause',16)}<span>${label}</span>`;
    button.setAttribute('aria-label',label);
    button.title=label;
    button.classList.toggle('active',paused);
  }
  sailing(boat){
    const el=this.sailingStatus;
    if(!el)return;
    el.hidden=!boat;
    if(!boat)return;
    const text=boat.state==='waiting'?(boat.blocked?'航道受阻 · 船只正在等待':'航段终点 · 船只正在等待'):
      boat.state==='turning'?'船只正在掉头':boat.blocked?'船只驶向候航点':'船只航行中';
    if(el.textContent!==text)el.textContent=text;
  }
  toast(text,error=false){const el=this.root.querySelector('.toast');el.textContent=text;el.className=`toast visible ${error?'error':''}`;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.classList.remove('visible'),3000);}
  saved(text){this.root.querySelector('#save-state').textContent=text;}
  modal(title,content){this.app.keys.clear();this.app.cancel();const el=this.root.querySelector('.modal');el.innerHTML=`<div class="modal-heading"><h2>${title}</h2>${ib('close-modal','close','关闭窗口')}</div>${content}`;this.root.querySelector('.modal-backdrop').hidden=false;setTimeout(()=>el.querySelector('input,button')?.focus(),0);}
  closeModal(){this.root.querySelector('.modal-backdrop').hidden=true;}
  get modalOpen(){return !this.root.querySelector('.modal-backdrop').hidden;}
  scenes(){
    this.modal('沿河，发现新的风景',`<p>选择一处可编辑的小世界。进入前先保存当前城市；场景使用独立存档，可随时返回。</p><div class="scene-grid">${SCENES.map((s,i)=>`<button class="scene-card" data-action="load-scene" data-scene="${s.id}"><span class="scene-number">0${i+1}</span><b>${s.name}</b><small>${s.caption}</small></button>`).join('')}</div>`);
  }
  async cities(){
    let list=[],readError=false;try{list=await this.app.listSaves();}catch{readError=true;}
    const protectedOriginal=this.app.saveSession.protected;
    const labels={backup:'切换备份','legacy-backup':'历史备份',original:'旧城原件',recovery:'恢复存档'};
    this.modal('收藏每一座城市',`<p>你的每一个小世界，都值得好好保存。城市保存在这台设备的浏览器中，也可导出随身携带。</p>
      ${protectedOriginal?`<p>原存档读取失败，原记录已保护。当前城市另存到恢复存档。</p>${button('export-original','download','导出原存档记录')}`:''}
      ${readError?'<p>暂时无法读取本地存档。请先导出当前城市，保留浏览器数据后重试。</p>':''}
      ${this.app.baseline?`<p>${escape(this.app.baseline.id)} / v${this.app.baseline.sceneVersion} · 独立测试城市，不使用正常城市存档。</p>${button('reset-baseline','undo','重新载入基线')}`:''}
      <label for="rename-city">城市名称</label><input id="rename-city" type="text" maxlength="40" value="${escape(this.app.city.name)}"><div class="modal-actions">${button('save-copy','save','保存为新存档',true)}${button('export','download','导出城市')}${button('import','upload','导入')}</div>
      <div class="save-list">${list.sort((a,b)=>b.date-a.date).map(s=>`<div class="save-row"><div><b>${escape(s.name)} ${s.id==='autosave'?'· 自动保存':labels[s.kind]?`· ${labels[s.kind]}`:''}</b><span>${new Date(s.date).toLocaleString('zh-CN')} · ${s.entityCount===null?'物件数量无法读取':`${s.entityCount} 个物件`}</span></div><div><button class="button" data-action="load-city" data-save-id="${escape(s.id)}">打开</button><button class="button" data-action="export-save" data-save-id="${escape(s.id)}">导出原记录</button></div></div>`).join('')||'<p>这里将收藏你的城市。</p>'}</div>
      <div class="modal-actions">${button('new-city','plus','新建空白城市')}${button('new-strait-city','plus','新建海峡城市')}${button('demo-city','home','打开示范城市')}</div><p>成功打开其他城市时会保留当前城市备份；保留最近 20 份新的切换备份。历史备份、手动收藏和旧城原件不会自动清理。</p>`);
  }
  help(){this.modal('慢慢来，城市由你决定',`<p>从目录挑一座建筑就能快速放置。也可先用「划定地块」点两个对角，确认后再从目录添加建筑。选中已放置的建筑，可以移动整块或只调整建筑在地块内的位置。</p><p>城市道路可以按住左键连续铺设。选择道路目录中的「坡道」，拖出路段，再拖动端点的高度手柄。过河使用「跨河桥梁」。</p><div class="help-grid">${[['左键','选择 / 放置'],['Ctrl + 点击','增减选中物件'],['右键拖动','旋转视角'],['中键 / 方向键','平移城市'],['滚轮','拉近 / 拉远'],['R','地块编辑时旋转 15°'],['Esc','取消当前操作'],['C','切换自由视角'],['H','隐藏 / 显示界面'],['Ctrl + Z / Y','撤销 / 重做'],['Home','回到城市全景']].map(([k,v])=>`<div><kbd class="key">${k}</kbd> ${v}</div>`).join('')}</div><div class="modal-divider"></div><p>自由观察时可以降到街道附近。收藏镜头，或跟随一辆小车看风景。</p><div class="modal-actions">${button('orbit','compass','环绕城市')}${button('follow','road','跟随车辆')}${button('bookmark','camera','收藏当前镜头')}${button('recall','eye','返回收藏镜头')}</div>`);}
  audio(){this.modal('听见城市的呼吸',`<p>柔和的原创合成音景，陪你造一会儿城。声音仅在你开启后播放。</p>${button('toggle-audio',this.app.sound.enabled?'mute':'sound',this.app.sound.enabled?'关闭声音':'开启声音',true)}<div class="audio-controls"><div><label>轻音乐</label><input class="range" id="music-volume" type="range" min="0" max="1" step=".05" value="${this.app.sound.musicVolume}" aria-label="音乐音量"></div><div><label>风与雨</label><input class="range" id="ambience-volume" type="range" min="0" max="1" step=".05" value="${this.app.sound.ambienceVolume}" aria-label="环境音量"></div></div>`);document.querySelector('#music-volume').oninput=e=>this.app.sound.musicVolume=+e.target.value;document.querySelector('#ambience-volume').oninput=e=>this.app.sound.ambienceVolume=+e.target.value;}
}
