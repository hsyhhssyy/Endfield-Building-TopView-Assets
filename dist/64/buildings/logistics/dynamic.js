// Optional extension: imported only after the user enables animation.
export const vertex=`precision highp float;
in vec2 aPosition;in vec2 aUV;out vec2 vUV;
uniform mat3 uProjectionMatrix;uniform mat3 uWorldTransformMatrix;uniform mat3 uTransformMatrix;
void main(){vUV=aUV;vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.);gl_Position=vec4(p.xy,0.,1.);}`;
export const fragment=`precision highp float;
in vec2 vUV;out vec4 finalColor;
uniform sampler2D uMap;uniform sampler2D uGlyph;uniform sampler2D uFlow;uniform sampler2D uPattern;uniform sampler2D uFluidMap;
uniform float uTime;uniform float uStart;uniform float uKind;uniform float uCorner;uniform float uFilled;uniform float uDirection;uniform float uLayer;
uniform float uAtlasHalfTexel;
uniform sampler2D uBase;
uniform sampler2D uSplash;
uniform float uFluidType;
uniform vec4 uSkin;uniform vec4 uSkin2;uniform vec4 uFoam;
uniform vec4 uParams;uniform vec4 uPipe;uniform vec4 uWidths;uniform vec4 uFillBounds;uniform vec4 uTint;uniform vec4 uColor;
vec4 src(sampler2D tex,vec2 uv){return texture(tex,vec2(fract(uv.x),1.-fract(uv.y)));}
float remap(float q,float density,float width){return (fract(q*density)*width-.5)/(width-1.);}
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
float fog(vec2 p){return .57*noise(p)+.28*noise(p*2.03+7.)+.15*noise(p*4.01+19.);}
// Authored top-view radius, radius variation, spatial frequency and time rate.
// The game's thickness-driven inset is recovered; these viewing values are not.
const vec4 WATER_SURFACE=vec4(.78,.028,.65,.8);
void main(){vec4 map=texture(uMap,vUV);if(map.a<.5){finalColor=vec4(0.);return;}
 float across=map.r;float along=(map.g*255.*256.+map.b*255.)/65535.;float s=uStart+along;
 vec3 rgb=vec3(0.);float alpha=0.;
 if(uKind<.5){
  float phase=fract(s-uTime*uParams.x);float atlasU=clamp(across/8.,uAtlasHalfTexel,1./8.-uAtlasHalfTexel);float arrow=clamp((src(uGlyph,vec2(atlasU,phase*uParams.w)).r-.55)*3.,0.,1.);
  float flow=src(uFlow,vec2(across,fract((s-uTime*uParams.y+uParams.z)*uWidths.w))).r;
  float light=clamp(pow(max(flow,0.),1.15)*.78,0.,1.);float arrowAlpha=arrow*.9;
  alpha=arrowAlpha+light*(1.-arrowAlpha);
  rgb=(vec3(1.,.78,.30)*arrowAlpha+vec3(1.,.59,.12)*light*(1.-arrowAlpha))/max(alpha,.000001);
 }else{
  float q=s*(2.*uDirection-1.)-uPipe.z;float u=min(abs(across-.5),1.);float av=remap(q+uPipe.w*uTime,uPipe.y,uWidths.y);
  float glyph=(av>0.&&av<1.)?src(uGlyph,vec2(u,av)).r:0.;
  // Unwrap the top seam continuously. Folding U and mixing R/G splices
  // oppositely oriented halves of the label. Keep the chevron UV above.
  float patternU=fract(.5+across*(2.*uDirection-1.));
  float pv=remap(q,uPipe.x,uWidths.x);vec4 pattern=src(uPattern,vec2(patternU,clamp(pv,0.,1.)));
 float pat=(uCorner<.5&&pv>0.&&pv<1.)?pattern.r:0.;
 float marks=clamp(max(glyph,pat)*.9,0.,1.);
  if(uLayer<.5){finalColor=vec4(vec3(.72,.91,1.)*marks,marks)*map.a*uColor;return;}
  if(uFilled<=0.){finalColor=vec4(0.);return;}
  vec4 fm=texture(uFluidMap,vUV);float fv=(fm.g*255.*256.+fm.b*255.)/65535.;float fluidS=uStart+fv;
  // Unwrap around the visible top seam before transverse deformation/noise.
  float transverse=(fract(fm.r+.5)-.5)*2.;
  // Original cylindrical UV measures angle, not distance across the tube.
  // Project it before shrinking the fluid so straight and bent pieces share
  // the same inset, with a continuous wave across their common path coordinate.
  float crossSection=sin(transverse*1.570796327);float radial=abs(crossSection);
  float wave=.72*sin(6.283185307*(fluidS*WATER_SURFACE.z-uTime*WATER_SURFACE.w))
             +.28*sin(6.283185307*(fluidS*WATER_SURFACE.z*2.17-uTime*WATER_SURFACE.w*.63)+1.4);
  float thickness=clamp(uFilled,0.,1.);
  float radius=(WATER_SURFACE.x+WATER_SURFACE.y*wave)*thickness;
  // About one source-map pixel of coverage; also works on WebGL1 contexts
  // where the optional derivatives extension is not enabled by Pixi.
  float aa=.025;
  float interior=1.-smoothstep(radius-aa,radius+aa,radial);
  if(uFluidType>.5){radius=(.88+.018*wave)*thickness;interior=1.-smoothstep(radius-.16*thickness,radius+.025,radial);}
  interior*=smoothstep(0.,.07,thickness);
  float surfaceAcross=crossSection/max(radius,.1);float surfaceRadial=abs(surfaceAcross);
  vec2 normal=src(uFlow,vec2(fm.r*2.,fluidS-uTime*uWidths.z)).rg*2.-1.;
  float turbulence=fog(vec2(transverse*2.6,fluidS*1.65-uTime*.85));
  float shape=uFillBounds.w;float edge=max(uFillBounds.z*shape,.0001);
  // The in-game screenshot shows a planar cross-section, with a broad white
  // cap fading BACK into the water. Radius waves affect the sides, not the cut.
  float head=uFillBounds.y;
  float tail=uFillBounds.x;
  if(uFluidType>.5){edge=max(.18*shape,.0001);head=uFillBounds.y-shape*(.25*radial+.26*turbulence);tail=uFillBounds.x+shape*(.18*radial+.20*turbulence);}
  float occupied=0.;
  if(fm.a>.5){occupied=interior*smoothstep(tail-edge,tail+edge,fluidS)*(1.-smoothstep(head-edge,head+edge,fluidS));}
  float splash=src(uSplash,vec2(fm.r*2.,fluidS*2.-uTime*1.7)).r;
  float frontBand=exp(-pow((fluidS-head+.065)/.14,2.))*shape;
  float tailBand=exp(-pow((fluidS-tail-.04)/.1,2.))*shape;
  float shimmer=pow(abs(normal.x*.7+normal.y*.3),2.)*.10*occupied;
  if(uFluidType>.5){
   // Two fog colors and a soft turbulent plume, without a liquid specular rim.
   if(uLayer<1.5){alpha=occupied*smoothstep(.48,.78,turbulence)*.18;rgb=uSkin.rgb;}
   else if(uLayer<2.5){alpha=texture(uBase,vUV).a*occupied*(.20+.72*smoothstep(.18,.78,turbulence));rgb=mix(uTint.rgb*.72,uSkin.rgb,clamp(turbulence*1.2,0.,1.));}
   else{alpha=0.;}
  }
  else if(uLayer<1.5){
   float foamAlpha=shimmer+occupied*(frontBand*(.16+.30*splash)+tailBand*.09);
   // A filled, pale cross-section with a longitudinal gradient, not a rim.
   // It disappears during in-place recovery, which has no new leading front.
   float whiteCap=(1.-smoothstep(.10,1.20,max(head-fluidS,0.)))*shape;
   float whiteAlpha=occupied*whiteCap*.96;
   alpha=whiteAlpha+foamAlpha*(1.-whiteAlpha);
   rgb=(vec3(1.)*whiteAlpha+uFoam.rgb*foamAlpha*(1.-whiteAlpha))/max(alpha,.000001);
  }
  else if(uLayer<2.5){
   vec4 base=texture(uBase,vUV);
   base.rgb*=mix(uTint.rgb,uSkin.rgb,.22+.10*normal.x);
   base.rgb=mix(base.rgb,uSkin2.rgb*base.a,.09*surfaceRadial*surfaceRadial);
   finalColor=base*occupied*uColor;return;
  }else{
   // Surface reflection follows the moving inset edge; the old baked
   // reflection alone lies at the undeformed mesh boundary.
   float rim=exp(-pow((surfaceRadial-.91)/.065,2.));
   float lighting=.65+.35*clamp(-surfaceAcross,0.,1.);
   alpha=occupied*(texture(uBase,vUV).a*.35+rim*.17*lighting);
   rgb=vec3(.82,.94,1.);
  }
 }
 alpha*=map.a;finalColor=vec4(rgb*alpha,alpha)*uColor;
}`;

// Shared by every segment of a route. Transport advances a head only after
// complete emptying; interrupted drainage reverses the same thickness value.
export function createFluidCycle(config,total,origin=5,earlyRefill=false){
 const fillDuration=total/config.fillCellsPerSecond;
 const drainDuration=config.drainDuration??2;
 const holdDuration=config.holdDuration??1;
 const emptyDuration=config.emptyDuration??.3;
 const refillDuration=config.refillDuration??2;
 let state='filling',phaseTime=0,elapsed=0,cycle=0,recoveryFrom=.5;
 const level=()=>state==='empty'?0:state==='draining'?Math.max(0,1-phaseTime/drainDuration)
  :state==='recovering'?Math.min(1,recoveryFrom+phaseTime/refillDuration):1;
 const duration=()=>({filling:fillDuration,holding:holdDuration,draining:drainDuration*(earlyRefill?.5:1),
  recovering:(1-recoveryFrom)*refillDuration,empty:emptyDuration}[state]);
 const snapshot=()=>{
  const progress=Math.min(1,phaseTime/duration()),thickness=level(),hasHead=state==='filling';
  return {state,supply:['filling','holding','recovering'].includes(state),thickness,hasHead,
   occupancy:hasHead?progress:thickness>0?1:0,start:origin-1,end:hasHead?origin+total*progress:origin+total+1,
   total,cycle,progress,phaseTime,elapsed,fillDuration,drainDuration,holdDuration,emptyDuration,
   recoveryDuration:(1-recoveryFrom)*refillDuration,earlyRefill};
 };
 const advance=delta=>{
  let remaining=Math.max(0,Number(delta)||0);
  do{
   const step=Math.min(remaining,Math.max(0,duration()-phaseTime));
   phaseTime+=step;elapsed+=step;remaining-=step;
   if(phaseTime+1e-9<duration())break;
   if(state==='filling')state='holding';
   else if(state==='holding')state='draining';
   else if(state==='draining'){
    recoveryFrom=level();
    if(earlyRefill&&recoveryFrom>0){state='recovering';cycle++;}else state='empty';
   }else if(state==='recovering')state='holding';
   else{state='filling';cycle++;}
   phaseTime=0;
  }while(remaining>1e-9);
  return snapshot();
 };
 return {total,snapshot,advance,setEarlyRefill(value){earlyRefill=Boolean(value);return advance(0);},
  seek(time){state='filling';phaseTime=0;elapsed=0;cycle=0;recoveryFrom=.5;return advance(time);}};
}

export async function loadDynamic(PIXI,collection,signal){
 const items=new Map(),textures=new Map(),params=new Map(),bitmaps=[];
 const signature=item=>JSON.stringify(['sha256','width','height','colorSpace','alpha','filter','wrap'].map(key=>item[key]));
 const destroy=()=>{for(const t of textures.values())t.destroy(true);textures.clear();for(const b of bitmaps)b.close();bitmaps.length=0;};
 try{
  for(const delivery of collection.deliveries){const url=new URL(delivery.extension,location.href);const m=await fetch(url,{signal}).then(r=>r.json());params.set(delivery.id,m.parameters);
   if(m.materialContractVersion!==2)throw new Error('Expected material contract 2');
   for(const[key,item]of Object.entries(m.resources)){if(items.has(key)&&signature(items.get(key))!==signature(item))throw new Error('Conflicting resource '+key);if(!items.has(key))items.set(key,{...item,url:new URL(item.file,url).href});}}
  for(const[key,item]of items){const response=await fetch(item.url,{signal});if(!response.ok)throw new Error(response.status+' '+item.url);
   const bitmap=await createImageBitmap(await response.blob(),{premultiplyAlpha:'none',colorSpaceConversion:'none'});bitmaps.push(bitmap);
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   const source=new PIXI.ImageSource({resource:bitmap,alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:false,resolution:collection.textureProfile?.resolution ?? 1,
     scaleMode:item.filter==='nearest'?'nearest':'linear',addressMode:item.wrap==='repeat'?'repeat':'clamp-to-edge'});
   textures.set(key,new PIXI.Texture({source}));
  }
 }catch(e){destroy();throw e;}
 const sampler=key=>{const t=textures.get('dynamic/'+key);if(!t)throw new Error('Missing dynamic texture '+key);return t.source;};
 const pipeParams=params.get(collection.entries['pipe.straight']?.id)||{};
 const cycle={fillCellsPerSecond:pipeParams.fillCellsPerSecond??2,drainDuration:pipeParams.drainDuration??2,
  holdDuration:pipeParams.holdDuration??1,emptyDuration:pipeParams.emptyDuration??.3,refillDuration:pipeParams.refillDuration??2,edgeWidth:pipeParams.fillEdgeWidth??.012};
 const tint=value=>{const n=typeof value==='number'?value:Number.parseInt(String(value??'#ffffff').replace('#',''),16);return new Float32Array([((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255,1]);};
 return {textureCount:textures.size,cycle,destroy,createFluidCycle:(total,origin,early)=>createFluidCycle(cycle,total,origin,early),mesh(kind,seg,container,time,filled,layer='marks',options={}){
  const key=kind+'.'+seg.shape;const id=collection.entries[key].id;const p=params.get(id)||{};
  const base=options.texture?.source||sampler(key+'.mapping');
  const profile=options.profile||pipeParams.fluidProfiles?.item_liquid_water;
  const color=role=>tint(profile?.colors[role]?.hex||profile?.colors.skin?.hex||'#ffffff');
  const fillBounds=options.fillBounds||new Float32Array([-10000,10000,cycle.edgeWidth,1]);
  const geometry=new PIXI.MeshGeometry({positions:new Float32Array([-32,-32,32,-32,32,32,-32,32]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])});
  const shader=PIXI.Shader.from({gl:{vertex,fragment},resources:{
   uMap:sampler(key+'.mapping'),uGlyph:sampler(kind==='pipe'?'pipe.chevron':'conveyor.arrow'),
   uFlow:sampler(kind==='pipe'?'pipe.fluid-motion':'conveyor.highlight'),
   uPattern:sampler(kind==='pipe'?'pipe.pattern':'conveyor.arrow'),uFluidMap:sampler(key+(kind==='pipe'?'.fluid-mapping':'.mapping')),
   uBase:base,uSplash:sampler(kind==='pipe'?'pipe.splash-noise':'conveyor.highlight'),
   effect:{uFluidType:{value:profile?.phase==='gas'?1:0,type:'f32'},uSkin:{value:color('skin'),type:'vec4<f32>'},uSkin2:{value:color('skin2'),type:'vec4<f32>'},uFoam:{value:color('splash'),type:'vec4<f32>'},uAtlasHalfTexel:{value:.5/sampler(kind==='pipe'?'pipe.chevron':'conveyor.arrow').width,type:'f32'},uTime:{value:time,type:'f32'},uStart:{value:seg.start+5,type:'f32'},uKind:{value:kind==='pipe'?1:0,type:'f32'},uCorner:{value:seg.shape==='straight'?0:1,type:'f32'},uFilled:{value:filled?1:0,type:'f32'},uDirection:{value:p.waterDirection??0,type:'f32'},uLayer:{value:{marks:0,fluid:1,'fluid-body':2,'fluid-specular':3}[layer]??0,type:'f32'},uParams:{value:new Float32Array([p.arrowSpeed??1,p.flowSpeed??1.25,p.timeOffset??0,p.arrowSpace??1]),type:'vec4<f32>'},uPipe:{value:new Float32Array([p.staticDensity??.11,p.flowDensity??.18,p.flowOffset??0,p.flowSpeed??1.23]),type:'vec4<f32>'},uWidths:{value:new Float32Array([p.staticWidth??.922,p.flowWidth??.88,p.waterWaveSpeed??.8,p.flowSpace??.27]),type:'vec4<f32>'},uFillBounds:{value:fillBounds,type:'vec4<f32>'},uTint:{value:options.tint?tint(options.tint):color('body'),type:'vec4<f32>'}}
  }});
  const mesh=new PIXI.Mesh({geometry,shader});mesh.logisticsLayer=layer;container.addChild(mesh);return mesh;
 }};
}
