import * as PIXI from './vendor/pixi.min.js';
import {createFlowRoute} from './benchmark-flow.mjs';
import {vertex as lightVertex,fragment as lightFragment} from './light-mesh.js';
import {CANVAS,CELL,resolveDevices,packScene,makeTimeline,frameAt,randomGenerator,distribution,summarizeFrames} from './benchmark-core.mjs';

const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let version=params.get('version');
let requestedSize=64;
const bytes=n=>n>=1073741824?`${(n/1073741824).toFixed(2)} GiB`:`${(n/1048576).toFixed(1)} MiB`;
const number=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const absolute=(file,base=location.href)=>new URL(file,base).href;
const docs=new Map();
async function json(url) {
  url=absolute(url);
  if(!docs.has(url))docs.set(url,fetch(url,{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error(`${r.status}: ${url}`);return {url:new URL(url),value:await r.json()};}));
  return docs.get(url);
}
function status(text){$('status').textContent=text;}
function phase(text,running=false){$('phase').textContent=text;$('phase').classList.toggle('running',running);}
function details(id,entries){$(id).replaceChildren(...entries.flatMap(([k,v])=>{const a=document.createElement('dt'),b=document.createElement('dd');a.textContent=k;b.textContent=v;return [a,b];}));}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

class ResidentStore {
  constructor(renderer){this.renderer=renderer;this.entries=new Map();this.sources=new Set();this.bitmaps=[];this.rgbaBytes=0;this.diskBytes=0;this.uploads=0;this.unloads=0;this.completed=0;}
  async page(page,{raw=false,nearest=false}={}) {
    if(page.profile!=='offline-grid-v1'||![.5,1].includes(page.resolution))throw Error('需要完成离线素材加工');
    const url=absolute(page.url),key=`${raw}/${nearest}/${page.sha256||url}`;
    if(this.entries.has(key))return this.entries.get(key);
    const promise=(async()=>{
      const response=await fetch(url);if(!response.ok)throw Error(`${response.status}: ${url}`);
      const blob=await response.blob();
      const bitmap=await createImageBitmap(blob,{premultiplyAlpha:raw?'none':'premultiply',colorSpaceConversion:'none'});
      if(bitmap.width!==page.width||bitmap.height!==page.height)throw Error(`纹理尺寸校验失败：${url}`);
      this.bitmaps.push(bitmap);
      const source=new PIXI.ImageSource({resource:bitmap,alphaMode:raw?'no-premultiply-alpha':'premultiplied-alpha',
        autoGenerateMipmaps:false,autoGarbageCollect:false,resolution:page.resolution,scaleMode:nearest?'nearest':'linear'});
      const texture=new PIXI.Texture({source});
      this.pin(texture);this.diskBytes+=blob.size;this.completed++;
      status(`正在解码并上传图集：${this.completed} 张 · ${bytes(this.rgbaBytes)} 已分配\n${decodeURI(new URL(url).pathname)}`);
      return texture;
    })();
    this.entries.set(key,promise);return promise;
  }
  pin(texture){
    const source=texture.source;if(this.sources.has(source))return texture;
    source.autoGarbageCollect=false;source.autoGenerateMipmaps=false;
    this.renderer.texture.initSource(source);
    const gl=this.renderer.gl,error=gl.getError();
    if(error||gl.isContextLost())throw Error(`纹理上传失败，WebGL=${error}；本轮不能标为全部常驻`);
    this.sources.add(source);this.rgbaBytes+=source.pixelWidth*source.pixelHeight*4;this.uploads++;
    source.on('unload',()=>this.unloads++);
    return texture;
  }
  snapshot(){return {uniqueTextures:this.sources.size,rgba8AllocatedBytes:this.rgbaBytes,compressedFileBytes:this.diskBytes,
    sourceUploads:this.uploads,sourceUnloads:this.unloads,automaticGC:this.renderer.gc.enabled,
    physicalVRAMResidency:'not observable from WebGL; driver may page to shared memory'};}
}

class Benchmark {
  constructor(){this.state='initializing';this.result=null;this.assets=new Map();this.tracks=new Map();this.effectTracks=new Map();this.lightAssets=new Map();this.bindings=new Map();this.animations=[];this.logAnimations=[];this.drawCalls=0;this.totalFrame=0;this.pending=[];this.gpuSamples=[];this.disjointQueries=0;this.frameRows=[];this.liveIntervals=[];this.sceneStarted=0;this.lastUI=0;this.raf=0;this.busy=false;}
  async init(){
    if(!version)version=(await json('../release.json')).value.sourceVersion;
    const config=await initialConfig();requestedSize=config.assetSize;
    this.catalog=(await json(`catalog-${requestedSize}.json?version=${encodeURIComponent(version)}`)).value;
    if(this.catalog.textureProfile?.id!=='offline-grid-v1'||this.catalog.textureProfile.pixelsPerCell!==requestedSize)throw Error('素材尺寸与目录不匹配');
    this.app=new PIXI.Application();
    await this.app.init({width:CANVAS,height:CANVAS,resolution:1,autoDensity:false,autoStart:false,
      preference:'webgl',preferWebGLVersion:2,powerPreference:'high-performance',antialias:false,
      background:0x17232d,gcActive:false});
    this.app.stop();this.app.renderer.gc.enabled=false;
    $('canvas-host').append(this.app.canvas);
    this.gl=this.app.renderer.gl;this.store=new ResidentStore(this.app.renderer);
    this.timer=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const info=this.gl.getExtension('WEBGL_debug_renderer_info');
    this.environment={pixiVersion:PIXI.VERSION,userAgent:navigator.userAgent,
      renderer:info?this.gl.getParameter(info.UNMASKED_RENDERER_WEBGL):this.gl.getParameter(this.gl.RENDERER),
      vendor:info?this.gl.getParameter(info.UNMASKED_VENDOR_WEBGL):this.gl.getParameter(this.gl.VENDOR),
      webglVersion:this.gl.getParameter(this.gl.VERSION),gpuTimerAvailable:Boolean(this.timer),
      canvasPixels:[CANVAS,CANVAS],canvasCssPixels:[CANVAS,CANVAS],rendererResolution:1,devicePixelRatio,
      hardwareConcurrency:navigator.hardwareConcurrency,deviceMemoryGiB:navigator.deviceMemory??null,
      contextAttributes:this.gl.getContextAttributes(),hardwarePresentation:'not measured; browser RAF scheduling only'};
    $('gpu-info').textContent=`${this.environment.renderer}\nPixiJS ${PIXI.VERSION} · WebGL 2 · GPU 计时${this.timer?'可用':'不可用'}`;
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
      const original=this.gl[key].bind(this.gl);this.gl[key]=(...args)=>{this.drawCalls++;return original(...args);};
    }
    this.app.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.fail('WebGL 上下文丢失；本轮作废，请刷新页面');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&['warming','measuring'].includes(this.state))this.stop('页面进入后台，本轮作废');});
    this.logisticsDoc=await json(this.catalog.logistics);
    this.flowModule={createFlowRoute};
    await this.detectHardware();this.bindUI(config);this.environmentInfo();
    await this.apply(config);
    if(params.get('autorun')==='1')this.start();
  }
  async track(clip){
    if(this.tracks.has(clip.url))return this.tracks.get(clip.url);
    const promise=(async()=>{
      const pages=[];for(const page of clip.pages)pages.push(await this.store.page(page));
      const textures=clip.frames.map(f=>new PIXI.Texture({source:pages[f.page].source,frame:new PIXI.Rectangle(f.x,f.y,f.width,f.height)}));
      if(!textures.length)throw Error(`空动画：${clip.url}`);
      return {textures,...makeTimeline(clip.frames),clip:clip.name};
    })();this.tracks.set(clip.url,promise);return promise;
  }
  async prepareDevice(row){
    const key=`${row.device.id}/${row.variant.key}/${this.config.portEffects}`;
    if(this.bindings.has(key))return this.bindings.get(key);
    const result={effects:[]},prepared=row.variant.prepared;
    if(!prepared)throw Error(`缺少预先加工的设备资源：${row.device.id}`);
    if(prepared.height)result.height=await this.store.page(prepared.height,{raw:true,nearest:true});
    if(this.config.portEffects)for(const fx of prepared.effects){
      const track=await this.track(fx.resource.track);
      const mask=fx.mask?await this.store.page(fx.mask):null;
      result.effects.push({doc:{value:{projection:fx.resource.projection}},track,transform:fx.transform,mask});
    }
    this.bindings.set(key,result);return result;
  }
  async prepareLight(row){
    if(this.config.lights!=='strip'||!row.device.lightExperiment||row.device.lightVariant!==row.variant.key)return null;
    if(this.lightAssets.has(row.device.lightExperiment))return this.lightAssets.get(row.device.lightExperiment);
    const doc=await json(row.device.lightExperiment),m=doc.value;
    const data=(await json(absolute(m.geometry,doc.url))).value;
    const hd=await json(absolute(m.heightMetadata,doc.url)),field=hd.value.fields.find(f=>f.name===hd.value.staticPose)??hd.value.fields[0];
    const atlas=await this.store.page(m.atlasPage,{raw:true});
    const height=await this.store.page(field.page,{raw:true,nearest:true});
    const spatial=row.variant.spatial,p=spatial.pivotPixels,s=spatial.pixelsPerCell;
    const attr=(values,format)=>({buffer:new Float32Array(values),format});
    const geometry=new PIXI.Geometry({attributes:{
      aPosition:attr(data.positions.flatMap(v=>[p.x+v[0]*s.x,p.y+v[2]*s.y]),'float32x2'),
      aUV:attr(data.uvs.flat(),'float32x2'),aHeight:attr(data.positions.map(v=>v[1]),'float32'),
      aBarycentric:attr(new Float32Array(data.positions.length*3),'float32x3')},indexBuffer:new Uint16Array(data.indices)});
    const shader=PIXI.Shader.from({gl:{vertex:lightVertex,fragment:lightFragment},resources:{uLightAtlas:atlas.source,uSceneHeight:height.source,lightOptions:{
      uSceneSize:{value:new Float32Array([spatial.framePixels.width,spatial.framePixels.height]),type:'vec2<f32>'},
      uHeightRange:{value:new Float32Array([field.heightMin,field.heightMax]),type:'vec2<f32>'},
      uAtlasRect:{value:new Float32Array(m.states[0].uvRect),type:'vec4<f32>'},
      uOcclusion:{value:1,type:'f32'},uHeightOffset:{value:0,type:'f32'},uEpsilon:{value:m.epsilon,type:'f32'},uWire:{value:0,type:'f32'}}}});
    const result={geometry,shader,vertices:data.positions.length,triangles:data.indices.length/3};this.lightAssets.set(row.device.lightExperiment,result);return result;
  }
  async prepareLogistics(){
    if(this.logTextures)return;
    const m=this.logisticsDoc.value;this.logTextures=new Map();this.logSources=new Map();
    for(const [id,page] of Object.entries(m.pages)){
      const tex=await this.store.page({...page,url:absolute(page.file,this.logisticsDoc.url)},{raw:page.premultiply===false});
      this.logSources.set(id,tex.source);
    }
    for(const [key,f] of Object.entries(m.frames))this.logTextures.set(key,new PIXI.Texture({source:this.logSources.get(f.page),
      frame:new PIXI.Rectangle(...f.rect),orig:new PIXI.Rectangle(0,0,...f.sourceSize),trim:new PIXI.Rectangle(...f.spriteSourceSize)}));
  }
  async apply(config){
    if(this.busy||['warming','measuring','finishing'].includes(this.state))throw Error('请先停止正在进行的测试');
    this.busy=true;this.state='loading';this.result=null;cancelAnimationFrame(this.raf);
    for(const id of ['apply','run','stop','json','csv'])$(id).disabled=true;phase('加载与上传');
    try{
      this.config=validateConfig(config);
      if(this.config.assetSize!==this.catalog.textureProfile.pixelsPerCell){const url=new URL(location.href);url.search='';url.searchParams.set('version',version);url.searchParams.set('size',this.config.assetSize);url.searchParams.set('scene',JSON.stringify(this.config));location.assign(url.href);return;}
      this.rows=resolveDevices(this.catalog,this.config);this.layout=packScene(this.rows,this.config.gridCells);
      const preload=this.config.residency==='scene'?this.rows:resolveDevices(this.catalog,{devices:'all'});
      const clips=[];
      for(const row of preload){
        if(this.config.residency==='all-clips')for(const v of row.device.variants)clips.push(...v.clips);
        else clips.push(row.clip);
      }
      clips.push(...this.rows.map(r=>r.clip));
      const unique=[...new Map(clips.map(c=>[c.url,c])).values()];
      const estimate=unique.reduce((s,c)=>s+c.rgbaBytes,0);
      $('memory-note').textContent=`本配置建筑图集约 ${bytes(estimate)}，另加端口、灯带、物流和渲染缓冲。此处统计分配量；物理显存驻留由驱动决定。`;
      if(this.config.residency==='all-clips')for(const page of this.catalog.imageInventory){
        await this.store.page(page,{raw:!['color','mask'].includes(page.kind),nearest:page.kind==='packed'});
      }
      for(const clip of unique)await this.track(clip);
      for(const row of preload){await this.prepareDevice(row);await this.prepareLight(row);}
      await this.prepareLogistics();
      const rowAssets=new Map();
      for(const row of this.rows)rowAssets.set(row,{track:await this.track(row.clip),binding:await this.prepareDevice(row),light:await this.prepareLight(row)});
      this.app.stage.removeChildren().forEach(c=>c.destroy({children:true}));
      this.world=new PIXI.Container();this.world.scale.set(CANVAS/(this.layout.gridCells*CELL));this.app.stage.addChild(this.world);
      const grid=new PIXI.Graphics(),edge=this.layout.gridCells*CELL;
      for(let i=0;i<=this.layout.gridCells;i++){grid.moveTo(i*CELL,0).lineTo(i*CELL,edge);grid.moveTo(0,i*CELL).lineTo(edge,i*CELL);}
      grid.stroke({color:0x31404c,width:1/this.world.scale.x,alpha:.55});this.world.addChild(grid);
      this.animations=[];this.logAnimations=[];this.lightCount=0;this.portCount=0;
      const random=randomGenerator(this.config.seed);
      for(const place of this.layout.placements){
        const asset=rowAssets.get(place.row),sp=place.row.variant.spatial,f=sp.footprintRectCells;
        const holder=new PIXI.Container();holder.position.set((place.x-f.left)*CELL,(place.y-f.top)*CELL);
        holder.scale.set(CELL/sp.pixelsPerCell.x,CELL/sp.pixelsPerCell.y);holder.eventMode='none';this.world.addChild(holder);
        const sprite=new PIXI.Sprite(asset.track.textures[0]);holder.addChild(sprite);
        this.animate(sprite,asset.track,random()*asset.track.duration);
        if(asset.light){holder.addChild(new PIXI.Mesh({geometry:asset.light.geometry,shader:asset.light.shader}));this.lightCount++;}
        for(const fx of asset.binding.effects){
          const pos=fx.transform.position,pivot=fx.doc.value.projection?.pivotPixels??fx.doc.value.projection?.worldToPixel?.pivotPixels??[0,0];
          const node=new PIXI.Sprite(fx.track.textures[0]);node.position.set(sp.pivotPixels.x+pos[0]*sp.pixelsPerCell.x,sp.pivotPixels.y+pos[2]*sp.pixelsPerCell.y);
          node.pivot.set(...pivot);node.rotation=-fx.transform.yawDegrees*Math.PI/180;holder.addChild(node);
          if(fx.mask){const mask=new PIXI.Sprite(fx.mask);mask.position.copyFrom(node.position);mask.pivot.copyFrom(node.pivot);mask.rotation=node.rotation;holder.addChild(mask);node.mask=mask;}
          this.animate(node,fx.track,random()*fx.track.duration);this.portCount++;
        }
      }
      this.buildLogistics();this.sceneStarted=performance.now();this.lastTimestamp=null;this.state='ready';
      this.update(0);this.app.renderer.render({container:this.app.stage});
      // Upload/compile all selected scene paths before warming or measuring.
      const error=this.gl.getError();if(error)throw Error(`场景预绘制失败：WebGL=${error}`);
      this.renderInventory();this.resourceInfo();phase('就绪');
      status(`场景就绪：${this.layout.placements.length} 台设备，10 格传送带与 10 格息壤气管道。\n图集已全部上传；自动 GC 已关闭。正式采样会先预热 ${this.config.warmupSeconds} 秒。`);
      this.syncUI(this.config);this.raf=requestAnimationFrame(now=>this.frame(now));
      $('run').disabled=false;
    }finally{this.busy=false;$('apply').disabled=false;}
  }
  animate(sprite,track,offset){this.animations.push({sprite,track,offset,index:-1});}
  logSprite(key,parent,x,y,rotation=-Math.PI/2){
    const texture=this.logTextures.get(key);if(!texture)throw Error(`缺少物流烘焙帧：${key}`);
    const sprite=new PIXI.Sprite(texture);sprite.anchor.set(.5);sprite.position.set(x,y);sprite.rotation=rotation;parent.addChild(sprite);return sprite;
  }
  buildLogistics(){
    const m=this.logisticsDoc.value,[belt,pipe]=this.layout.routes;
    const beltLayer=new PIXI.Container();this.world.addChild(beltLayer);
    for(let i=0;i<10;i++){
      const x=(belt.x+i+.5)*CELL,y=(belt.y+.5)*CELL;
      this.logSprite('static/conveyor.straight.base',beltLayer,x,y);
      const highlight=this.logSprite(m.clips['conveyor/straight/highlight'].frames[0],beltLayer,x,y);
      const arrow=this.logSprite(m.clips['conveyor/straight/arrow'].frames[0],beltLayer,x,y);
      this.logAnimations.push({kind:'conveyor',i,highlight,arrow});
    }
    const parent=new PIXI.Container();this.world.addChild(parent);
    for(let i=0;i<10;i++)this.logSprite('static/pipe.straight.support-back',parent,(pipe.x+i+.5)*CELL,(pipe.y+.5)*CELL);
    const flowParent=new PIXI.Container();parent.addChild(flowParent);flowParent.scale.set(2);flowParent.position.set(-24,-24);
    const segments=Array.from({length:10},(_,i)=>({x:pipe.x+i,y:pipe.y,rotation:-Math.PI/2,start:i,shape:'straight'}));
    this.flow=this.flowModule.createFlowRoute(PIXI,m,this.logSources,segments,flowParent,m.fluidProfiles.item_gas_xiranite);
    const uniforms=this.flow.shader.resources.flow.uniforms;uniforms.uThickness=1;uniforms.uBounds.set([4,16,.012,0]);
    for(let i=0;i<10;i++){
      const x=(pipe.x+i+.5)*CELL,y=(pipe.y+.5)*CELL;
      this.logSprite('static/pipe.straight.support-middle',parent,x,y);
      this.logSprite('static/pipe.straight.shell',parent,x,y);
      const pattern=this.logSprite(m.clips['pipe/straight/pattern'].frames[0],parent,x,y);
      const chevron=this.logSprite(m.clips['pipe/straight/chevron'].frames[0],parent,x,y);
      this.logSprite('static/pipe.straight.support-front',parent,x,y);
      this.logAnimations.push({kind:'pipe',i,pattern,chevron});
    }
    // Canonical endpoint assets face the route entrance. Rotate the exit by pi.
    for(const [i,rotation] of [[0,-Math.PI/2],[9,Math.PI/2]]){
      const x=(pipe.x+i+.5)*CELL,y=(pipe.y+.5)*CELL;
      this.logSprite('static/pipe.endpoint.whitening-standard',parent,x,y,rotation);
      this.logSprite('static/pipe.endpoint.connector',parent,x,y,rotation);
    }
  }
  update(elapsed){
    for(const a of this.animations){const index=frameAt(a.track,elapsed+a.offset);if(index!==a.index){a.sprite.texture=a.track.textures[index];a.index=index;}}
    const t=elapsed/1000,m=this.logisticsDoc.value;
    const assign=(node,key,p)=>{const c=m.clips[key],n=c.phaseSamples??c.frames.length,i=Math.round(((p%1)+1)%1*n)%n;node.texture=this.logTextures.get(c.frames[i]);};
    for(const node of this.logAnimations){
      const start=node.i+5;
      if(node.kind==='conveyor'){
        const p=m.parametersByResourceId[m.entries['conveyor.straight'].id];
        assign(node.highlight,'conveyor/straight/highlight',(start-t*p.flowSpeed+p.timeOffset)*p.flowSpace);
        assign(node.arrow,'conveyor/straight/arrow',start-t*p.arrowSpeed);
      }else{
        const p=m.parametersByResourceId[m.entries['pipe.straight'].id],q=start*(2*p.waterDirection-1)-p.flowOffset;
        assign(node.pattern,'pipe/straight/pattern',q*p.staticDensity);assign(node.chevron,'pipe/straight/chevron',(q+p.flowSpeed*t)*p.flowDensity);
      }
    }
    this.flow.shader.resources.flow.uniforms.uTime=t;
  }
  start(){
    if(this.state!=='ready'&&this.state!=='complete')return;
    if(document.hidden)throw Error('请保持页面在前台后开始测试');
    this.config.warmupSeconds=Number($('warmup').value);this.config.durationSeconds=Number($('duration').value);validateConfig(this.config);
    this.syncUI(this.config);
    this.state='warming';this.benchmarkStarted=performance.now();this.result=null;this.frameRows=[];this.gpuSamples=[];this.disjointQueries=0;this.querySkips=0;this.invalidReason=null;
    this.environmentInfo();this.startMemory=this.store.snapshot();this.measureLast=null;this.recordStarted=null;this.environment.visibilityAtStart=document.visibilityState;
    $('run').disabled=true;$('apply').disabled=true;$('stop').disabled=false;$('json').disabled=true;$('csv').disabled=true;
    phase('预热中',true);status(`预热 ${this.config.warmupSeconds} 秒后采样 ${this.config.durationSeconds} 秒；加载时间不计入结果。`);
  }
  collectQueries(){
    if(!this.timer)return;
    if(this.gl.getParameter(this.timer.GPU_DISJOINT_EXT)){
      this.disjointQueries+=this.pending.length;for(const p of this.pending)this.gl.deleteQuery(p.query);this.pending=[];return;
    }
    while(this.pending.length&&this.gl.getQueryParameter(this.pending[0].query,this.gl.QUERY_RESULT_AVAILABLE)){
      const p=this.pending.shift(),ms=this.gl.getQueryParameter(p.query,this.gl.QUERY_RESULT)/1e6;
      if(Number.isFinite(ms)&&ms>=0){this.gpuSamples.push(ms);if(this.frameRows[p.index])this.frameRows[p.index].gpuMs=ms;}
      this.gl.deleteQuery(p.query);
    }
  }
  frame(now){
    if(this.state==='error')return;
    try{
      this.collectQueries();
      if(this.state==='warming'&&now-this.benchmarkStarted>=this.config.warmupSeconds*1000){
        this.state='measuring';this.recordStarted=now;this.measureLast=now;this.startMemory=this.store.snapshot();phase('采样中',true);
      }
      const measuring=this.state==='measuring',dt=measuring&&this.measureLast!==null?now-this.measureLast:0;
      const sample=measuring&&dt>0;
      const cpuStart=performance.now();this.update(now-this.sceneStarted);const updateMs=performance.now()-cpuStart;
      this.drawCalls=0;
      let query=null;
      if(sample&&this.timer&&this.frameRows.length%4===0){
        if(this.pending.length<16){query=this.gl.createQuery();this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT,query);}else this.querySkips++;
      }
      const renderStart=performance.now();this.app.renderer.render({container:this.app.stage});const submitMs=performance.now()-renderStart;
      if(query){this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);this.pending.push({query,index:this.frameRows.length});}
      if(sample)this.frameRows.push({elapsedMs:now-this.recordStarted,frameMs:dt,cpuUpdateMs:updateMs,cpuSubmitMs:submitMs,cpuTotalMs:performance.now()-cpuStart,drawCalls:this.drawCalls,gpuMs:null});
      if(measuring)this.measureLast=now;
      if(sample&&now-this.recordStarted>=this.config.durationSeconds*1000){this.state='finishing';this.finishStarted=now;phase('整理结果');}
      if(this.state==='finishing'&&(!this.pending.length||now-this.finishStarted>2000))this.finish();
      this.totalFrame++;
      if(this.lastTimestamp!==null){this.liveIntervals.push(now-this.lastTimestamp);if(this.liveIntervals.length>60)this.liveIntervals.shift();}
      if(now-this.lastUI>500){
        const recent=this.liveIntervals,fps=recent.length?1000/(recent.reduce((s,f)=>s+f,0)/recent.length):0;
        $('live-fps').textContent=`${number(fps,1)} FPS`;
        if(measuring)status(`正在采样：${number((now-this.recordStarted)/1000,1)} / ${this.config.durationSeconds} 秒 · ${this.frameRows.length} 帧`);
        this.lastUI=now;
      }
      this.lastTimestamp=now;this.raf=requestAnimationFrame(t=>this.frame(t));
    }catch(e){this.fail(e.message);}
  }
  stop(reason='用户提前停止；保留部分结果'){
    if(!['warming','measuring','finishing'].includes(this.state))return;
    this.invalidReason=reason;this.finish();
  }
  finish(){
    const endMemory=this.store.snapshot();
    const residualQueries=this.pending.length;
    for(const p of this.pending)this.gl.deleteQuery(p.query);this.pending=[];
    const residentUnchanged=endMemory.sourceUploads===this.startMemory.sourceUploads&&endMemory.sourceUnloads===this.startMemory.sourceUnloads;
    this.result={schemaVersion:1,createdAt:new Date().toISOString(),valid:!this.invalidReason&&residentUnchanged&&!this.gl.isContextLost(),
      invalidReason:this.invalidReason??(!residentUnchanged?'采样期间发生纹理上传或卸载':null),version,config:structuredClone(this.config),
      scene:{gridCells:this.layout.gridCells,gapCells:1,deviceCount:this.layout.placements.length,inventory:this.inventory(),
        conveyorCells:10,pipeCells:10,fluid:'item_gas_xiranite',fluidFill:1,lightMeshes:this.lightCount,portEffects:this.portCount,
        animationClocks:'independent seeded phase offsets and source frame durations; all selected clips forced to loop',
        cameraScale:this.world.scale.x,canvasSize:[CANVAS,CANVAS],
        logisticsPipeline:'existing baked spritesheets and baked gas spatial field; one shared route sampler, no procedural fog generation'},
      environment:structuredClone(this.environment),textureProfile:this.catalog.textureProfile,
      textures:{before:this.startMemory,after:endMemory,unchangedDuringMeasurement:residentUnchanged},
      frameStats:summarizeFrames(this.frameRows.map(f=>f.frameMs)),
      cpuUpdateMs:distribution(this.frameRows.map(f=>f.cpuUpdateMs)),cpuSubmitMs:distribution(this.frameRows.map(f=>f.cpuSubmitMs)),
      cpuTotalMs:distribution(this.frameRows.map(f=>f.cpuTotalMs)),drawCalls:distribution(this.frameRows.map(f=>f.drawCalls)),
      gpuMs:distribution(this.gpuSamples),gpuTiming:{sampleEveryFrames:4,disjointDiscarded:this.disjointQueries,skipped:this.querySkips,timedOut:residualQueries},
      definitions:{averageFps:'1000 / mean(frameMs); frameMs is successive requestAnimationFrame timestamp delta',
        lowFps:'1000 / arithmetic mean of slowest ceil(N * fraction) frame times',percentiles:'linear interpolation at (N-1)*p',
        minMaxFps:'reciprocal of longest/shortest single RAF interval; not one-second rolling FPS',
        cpu:'JS animation update and synchronous renderer submission; GPU executes asynchronously',
        gpu:'EXT_disjoint_timer_query_webgl2 around renderer.render; excludes browser composition/presentation',
        thresholds:'16.67/33.33 ms counters include 0.5 ms tolerance; 50/100 ms counters exact',
        memory:'RGBA8 dimensions only, no mipmaps; excludes browser/driver buffers and cannot certify physical residency'},
      frames:this.frameRows};
    this.state='complete';phase(this.result.valid?'测试完成':'部分 / 无效结果');
    $('apply').disabled=false;$('run').disabled=false;$('stop').disabled=true;$('json').disabled=false;$('csv').disabled=false;
    this.showResult();this.resourceInfo();status(this.result.valid?'测试完成。结果 JSON 包含配置、环境、统计口径及原始逐帧数据。':this.result.invalidReason);
  }
  fail(message){
    if(['warming','measuring','finishing'].includes(this.state)){this.invalidReason=message;this.finish();}
    this.state='error';cancelAnimationFrame(this.raf);phase('错误');status(message);$('status').classList.add('error');
    $('run').disabled=true;$('stop').disabled=true;console.error(message);
  }
  inventory(){
    const counts=new Map();for(const p of this.layout.placements)counts.set(p.row,(counts.get(p.row)||0)+1);
    return this.rows.map(r=>({id:r.device.id,name:r.device.name,variant:r.variant.key,clip:r.clip.name,count:counts.get(r)||0,
      footprint:[r.width,r.height],frameCount:r.clip.frameCount,durationMs:makeTimeline(r.clip.frames).duration}));
  }
  renderInventory(){
    $('scene-info').textContent=`${this.layout.gridCells} × ${this.layout.gridCells} 格 · ${this.layout.placements.length} 台设备 · 相机缩放 ${number(this.world.scale.x,4)}`;
    $('inventory').replaceChildren(...this.inventory().map(item=>{const tr=document.createElement('tr');
      for(const text of [`${item.name} (${item.id})`,`${item.variant} / ${item.clip}`,item.footprint.join(' × '),item.count,`${item.frameCount} / ${number(item.durationMs/1000,2)} s`]){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;}));
  }
  async detectHardware(){
    this.environment.cpuModel=null;this.environment.vramBytes=null;
    this.environment.memorySource='navigator.deviceMemory: approximate, privacy-rounded and capped';
    this.environment.unavailable=['CPU model','dedicated VRAM capacity','physical VRAM residency'];
    if(document.querySelector('meta[name="local-hardware"]') && ['localhost','127.0.0.1','[::1]'].includes(location.hostname)){
      try{const r=await fetch('hardware.json');if(r.ok)this.environment.localServiceHardware=await r.json();}catch{}
    }
  }
  environmentInfo(){
    const manual={cpuModel:$('cpu-model').value.trim()||null,gpuModel:$('gpu-model').value.trim()||null,
      ramGiB:Number($('ram-gib').value)||null,vramGiB:Number($('vram-gib').value)||null,source:'user-provided'};
    this.environment.manualHardware=manual;
    const local=this.environment.localServiceHardware;
    this.environment.jsHeap=performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize,limitBytes:performance.memory.jsHeapSizeLimit}:null;
    details('environment',[
      ['CPU 型号',manual.cpuModel??local?.cpuModel??'浏览器未提供（可手动补充）'],
      ['浏览器可用逻辑核心',navigator.hardwareConcurrency??'未提供'],
      ['系统内存',manual.ramGiB?`${manual.ramGiB} GiB（手动）`:local?.totalMemoryBytes?`${bytes(local.totalMemoryBytes)}（本地服务）`:navigator.deviceMemory?`${navigator.deviceMemory} GiB（近似档位）`:'浏览器未提供'],
      ['显卡型号',manual.gpuModel??this.environment.renderer],
      ['显存容量',manual.vramGiB?`${manual.vramGiB} GiB（手动）`:local?.gpus?.filter(g=>g.memoryBytes).map(g=>`${g.name}: ${bytes(g.memoryBytes)}`).join(' / ')||'浏览器未提供（可手动补充）'],
      ['JS 堆内存',this.environment.jsHeap?bytes(this.environment.jsHeap.usedBytes):'浏览器未提供'],
      ['硬件来源',local?'本地服务主机 / 浏览器；GPU 列表不等于当前渲染适配器':'当前浏览器 / 手动提供'],
      ['运行环境',`${navigator.platform} · DPR ${devicePixelRatio}`]
    ]);
  }
  resourceInfo(){const m=this.store.snapshot();details('resources',[
    ['素材尺寸',`${this.catalog.textureProfile.pixelsPerCell}px / 格 · 离线素材与遮挡蒙版`],
    ['目录设备种类',this.catalog.deviceCount],['场景设备数量',this.layout.placements.length],['常驻纹理',m.uniqueTextures],
    ['纹理分配估算',bytes(m.rgba8AllocatedBytes)],['压缩文件总量',bytes(m.compressedFileBytes)],['自动卸载',m.automaticGC?'开启':'关闭'],
    ['灯带网格 / 端口',`${this.lightCount} / ${this.portCount}`],['画布 / DPR','1080 × 1080 / 1']]);}
  showResult(){
    const r=this.result,s=r.frameStats;if(!s)return;
    $('headline-metrics').replaceChildren(...[['平均 FPS',s.averageFps],['1% Low',s.onePercentLowFps],['0.1% Low',s.pointOnePercentLowFps]].map(([label,value])=>{
      const d=document.createElement('div');d.className='metric';const b=document.createElement('strong'),span=document.createElement('span');b.textContent=number(value,1);span.textContent=label;d.append(b,span);return d;}));
    details('result-details',[
      ['最低 / 最高瞬时 FPS',`${number(s.minInstantFps,1)} / ${number(s.maxInstantFps,1)}`],
      ['采样帧数 / 秒',`${s.frames} / ${number(s.durationMs/1000,1)}`],['帧耗时 P50 / P95',`${number(s.frameTimeMs.p50)} / ${number(s.frameTimeMs.p95)} ms`],
      ['帧耗时 P99 / P99.9',`${number(s.frameTimeMs.p99)} / ${number(s.frameTimeMs.p999)} ms`],
      ['CPU 更新 / 提交均值',`${number(r.cpuUpdateMs?.mean)} / ${number(r.cpuSubmitMs?.mean)} ms`],['GPU 均值 / P95',`${number(r.gpuMs?.mean)} / ${number(r.gpuMs?.p95)} ms`],
      ['绘制调用均值',number(r.drawCalls?.mean,0)],['> 50 / 100 ms 帧数',`${s.over50ms} / ${s.over100ms}`]]);
    $('validity').textContent=`${r.valid?'采样有效':'无效：'+r.invalidReason} · 1% 尾部 ${s.onePercentLowSamples} 帧，0.1% 尾部 ${s.pointOnePercentLowSamples} 帧。${s.pointOnePercentLowSamples<10?'0.1% 尾部样本少，宜延长或重复测试。':''}`;
    const ctx=$('chart').getContext('2d');ctx.clearRect(0,0,1080,180);const max=Math.max(33.33,s.frameTimeMs.p999*1.1),w=1040,h=140;
    ctx.font='11px sans-serif';ctx.strokeStyle='#4e6070';ctx.fillStyle='#a5b8c9';
    for(const y of [16.67,33.33]){const py=160-y/max*h;ctx.beginPath();ctx.moveTo(32,py);ctx.lineTo(1072,py);ctx.stroke();ctx.fillText(`${y} ms`,34,py-3);}
    ctx.strokeStyle='#66d9b9';ctx.beginPath();r.frames.forEach((f,i)=>{const x=32+f.elapsedMs/s.durationMs*w,y=160-Math.min(max,f.frameMs)/max*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
  syncUI(c){$('asset-size').value=c.assetSize;$('config').value=JSON.stringify(c,null,2);$('grid').value=c.gridCells;$('warmup').value=c.warmupSeconds;$('duration').value=c.durationSeconds;$('lights').value=c.lights;$('ports').checked=c.portEffects;$('residency').value=c.residency;}
  bindUI(config){
    this.syncUI(config);
    $('device').replaceChildren(...this.catalog.devices.map(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=`${d.name} (${d.id})`;return o;}));
    $('preset').value=config.devices==='all'?'all':config.devices.length===1?'single':'custom';
    if(Array.isArray(config.devices)&&config.devices.length===1){$('device').value=config.devices[0].id;$('device-count').value=config.devices[0].count??1;}
    const single=()=>{$('single-controls').hidden=$('preset').value!=='single';};single();
    const updateDevice=()=>{try{const c=JSON.parse($('config').value);c.devices=[{id:$('device').value,count:$('device-count').value==='fill'?'fill':Number($('device-count').value)}];if(c.devices[0].count==='fill'&&c.gridCells==='auto')c.gridCells=128;this.syncUI(c);}catch(e){status(e.message);}};
    $('device').onchange=updateDevice;$('device-count').onchange=updateDevice;
    $('preset').onchange=()=>{const preset=$('preset').value;single();if(preset==='single'){updateDevice();return;}if(preset!=='custom'){const current=JSON.parse($('config').value);this.syncUI({...current,devices:defaultConfig(preset).devices,gridCells:defaultConfig(preset).gridCells});}};
    $('asset-size').onchange=()=>{try{const c=JSON.parse($('config').value);c.assetSize=Number($('asset-size').value);c.textureScale=c.assetSize/128;this.syncUI(c);status('尺寸已选定，点击应用场景加载对应素材。');}catch(e){status(e.message);}};
    for(const id of ['cpu-model','ram-gib','gpu-model','vram-gib'])$(id).onchange=()=>this.environmentInfo();
    $('config').oninput=()=>{$('preset').value='custom';};
    for(const [id,key] of [['grid','gridCells'],['warmup','warmupSeconds'],['duration','durationSeconds'],['lights','lights'],['ports','portEffects'],['residency','residency']]){
      $(id).onchange=()=>{try{const c=JSON.parse($('config').value);
        c[key]=id==='ports'?$(id).checked:['warmup','duration'].includes(id)?Number($(id).value):id==='grid'&&$(id).value!=='auto'?Number($(id).value):$(id).value;
        $('config').value=JSON.stringify(c,null,2);
      }catch(e){status(`先修正 JSON：${e.message}`);}};
    }
    $('apply').onclick=()=>{try{
      let c=JSON.parse($('config').value);
      if($('preset').value!=='custom')c={...c,gridCells:$('grid').value==='auto'?'auto':Number($('grid').value),warmupSeconds:Number($('warmup').value),durationSeconds:Number($('duration').value),lights:$('lights').value,portEffects:$('ports').checked,residency:$('residency').value};
      this.apply(c).catch(e=>this.fail(e.message));
    }catch(e){status(e.message);}};
    $('run').onclick=()=>{try{this.start();}catch(e){status(e.message);}};$('stop').onclick=()=>this.stop();
    $('download-config').onclick=()=>download('factory-benchmark-config.json',$('config').value,'application/json');
    $('copy-url').onclick=async()=>{const url=new URL(location.href);url.search='';url.searchParams.set('version',version);url.searchParams.set('size',$('asset-size').value);url.searchParams.set('scene',JSON.stringify(JSON.parse($('config').value)));try{await navigator.clipboard.writeText(url.href);status('场景链接已复制。');}catch{status(url.href);}};
    $('config-file').onchange=async()=>{const f=$('config-file').files[0];if(f){const c=JSON.parse(await f.text());this.syncUI(validateConfig(c));$('preset').value='custom';}};
    $('json').onclick=()=>download('factory-benchmark-result.json',JSON.stringify(this.result,null,2),'application/json');
    $('csv').onclick=()=>{const keys=['elapsedMs','frameMs','cpuUpdateMs','cpuSubmitMs','cpuTotalMs','drawCalls','gpuMs'];download('factory-benchmark-frames.csv',keys.join(',')+'\n'+this.result.frames.map(f=>keys.map(k=>f[k]??'').join(',')).join('\n'),'text/csv');};
  }
}

function defaultConfig(preset='all'){
  return {gridCells:preset==='pumps'?128:'auto',devices:preset==='pumps'?[{id:'pump_1',count:'fill'}]:'all',
    residency:'scene',warmupSeconds:10,durationSeconds:60,seed:20260915,lights:'strip',portEffects:true,assetSize:requestedSize,textureScale:requestedSize/128};
}
function validateConfig(input){
  const c={...defaultConfig(),...input};
  c.assetSize=64;
  c.textureScale=c.assetSize/128;
  if(!['scene','catalog','all-clips'].includes(c.residency))throw Error('residency 必须为 scene、catalog 或 all-clips');
  if(!['strip','original'].includes(c.lights))throw Error('lights 必须为 strip 或 original');
  for(const [key,min,max] of [['durationSeconds',1,600],['warmupSeconds',0,120]])if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(`${key} 必须为 ${min}–${max}`);
  return c;
}
async function initialConfig(){
  let c=defaultConfig(params.get('preset'));
  if(params.has('config'))c={...c,...(await json(params.get('config'))).value};
  if(params.has('scene'))c={...c,...JSON.parse(params.get('scene'))};
  for(const [param,key] of [['grid','gridCells'],['duration','durationSeconds'],['warmup','warmupSeconds'],['seed','seed']])if(params.has(param))c[key]=params.get(param)==='auto'?'auto':Number(params.get(param));
  if(params.has('resident'))c.residency=params.get('resident');if(params.has('lights'))c.lights=params.get('lights');if(params.has('ports'))c.portEffects=params.get('ports')!=='0';
  if(params.has('device'))c.devices=[{id:params.get('device'),count:params.get('count')==='fill'?'fill':Number(params.get('count')??1)}];
  if(params.has('size'))c.assetSize=Number(params.get('size'));
  return validateConfig(c);
}
const benchmark=window.factoryBenchmark=new Benchmark();
benchmark.init().catch(e=>benchmark.fail(e.stack??e.message));
