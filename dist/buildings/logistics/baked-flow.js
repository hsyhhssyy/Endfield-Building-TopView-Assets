// Continuous playback of baked spatial fields. One mesh for the whole route;
// no per-cell shaders or runtime procedural noise. Marks remain atlas Sprites.
export const vertex = `precision highp float;
in vec2 aPosition;in vec2 aUV;in float aStart;in float aShape;
out vec2 vUV;out float vStart;out float vShape;
uniform mat3 uProjectionMatrix;uniform mat3 uWorldTransformMatrix;uniform mat3 uTransformMatrix;
void main(){vUV=aUV;vStart=aStart;vShape=aShape;
vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.);gl_Position=vec4(p.xy,0.,1.);}`;

export const fragment = `precision highp float;
in vec2 vUV;in float vStart;in float vShape;out vec4 finalColor;
uniform sampler2D uData;uniform sampler2D uFog;uniform sampler2D uWater;
uniform float uTime;uniform float uThickness;uniform float uGas;
uniform float uSkinSpeed;
uniform float uMapSize;
uniform vec4 uBounds;uniform vec4 uBody;uniform vec4 uSkin;uniform vec4 uSkin2;uniform vec4 uFoam;uniform vec4 uColor;
vec4 tile(float row,vec2 uv){return texture(uData,(vec2(2.+vShape*132.,2.+row*132.)+uv*128.)/1024.);}
vec4 repeated(vec4 rect,vec2 uv){return texture(uData,(rect.xy+vec2(fract(uv.x),1.-fract(uv.y))*rect.zw)/1024.);}
vec4 over(vec4 top,vec4 bottom){return top+bottom*(1.-top.a);}
vec4 waterSurface(float s,float across){
 vec2 size=vec2(4096.,132.);float y=2.+clamp(across*.5+.5,0.,1.)*128.;
 vec4 a=texture(uWater,(vec2(2.+fract((s-uTime*.8)/128.)*4092.,y))/size);
 vec4 b=texture(uWater,(vec2(2.+fract((s-uTime*uSkinSpeed)/128.)*4092.,y))/size);
 return mix(a,b,.25);
}
vec3 wetColor(vec3 body,vec3 skin,vec3 skin2,float across,float radial,vec2 normal){
 float band=smoothstep(.05,.60,abs(across+normal.x*.13));
 vec3 center=(skin2*1.8+skin*.02+body*.005)*vec3(.70,1.,.90);
 vec3 color=mix(center,skin*.65*vec3(.93,.90,.94),band);
 return color*(1.+normal.y*.04);
}
void main(){
 if(uThickness<=0.){finalColor=vec4(0.);return;}
 // Encoded cylindrical U wraps at the top seam. Sample physical texel
 // centers at each delivery resolution; bilinear U interpolation tears it.
 vec2 mapUV=(floor(clamp(vUV,0.,.999999)*uMapSize)+.5)/uMapSize;
 vec4 fm=tile(0.,mapUV);if(fm.a<.5){finalColor=vec4(0.);return;}
 float s=vStart+(fm.g*255.*256.+fm.b*255.)/65535.;
 float across=(fract(fm.r+.5)-.5)*2.;
 float crossSection=sin(across*1.570796327),radial=abs(crossSection);
 // Preserve the two independently travelling weak waves from the draw page.
 float wave=.72*sin(6.283185307*(s*.65-uTime*.8))
           +.28*sin(6.283185307*(s*.65*2.17-uTime*.8*.63)+1.4);
 vec4 water=waterSurface(s,across);float side=across<0.?water.r:water.g;
 float radius=(uGas>.5?(.88+.018*wave):(.88+.06*(side*2.-1.)))*uThickness;
 float interior=uGas>.5?1.-smoothstep(radius-.16*uThickness,radius+.025,radial)
                       :1.-smoothstep(radius-.025,radius+.025,radial);
 interior*=smoothstep(0.,.07,uThickness);
 float shape=uBounds.w,head=uBounds.y,tail=uBounds.x,edge=max(uBounds.z*shape,.0001);
 vec4 base=tile(1.,vUV);base.rgb*=base.a;
 float turbulence=0.;
 if(uGas>.5){
  // 128 cells of distinct fog, continuously sampled by global path distance.
  vec2 field=vec2(fract((s-uTime*(.85/1.65))/128.),clamp(across*.5+.5,0.,1.));
  turbulence=texture(uFog,(vec2(2.)+field*vec2(4092.,128.))/vec2(4096.,132.)).r;
  edge=max(.18*shape,.0001);head-=shape*(.25*radial+.26*turbulence);tail+=shape*(.18*radial+.20*turbulence);
 }
 float occupied=interior*smoothstep(tail-edge,tail+edge,s)*(1.-smoothstep(head-edge,head+edge,s));
 if(uGas>.5){
  float bodyAlpha=base.a*occupied*(.20+.72*smoothstep(.18,.78,turbulence));
  vec3 color=mix(uBody.rgb*.72,uSkin.rgb,clamp(turbulence*1.2,0.,1.));
  float mist=occupied*smoothstep(.48,.78,turbulence)*.18;
  finalColor=over(vec4(uSkin.rgb*mist,mist),vec4(color*bodyAlpha,bodyAlpha))*uColor;return;
 }
 vec2 normal=repeated(vec4(2.,400.,256.,256.),vec2(fm.r*2.,s-uTime*.8)).rg*2.-1.;
 vec2 skinNormal=water.ba*2.-1.;
 float surfaceAcross=crossSection/max(radius,.1);
 vec3 waterColor=wetColor(uBody.rgb,uSkin.rgb,uSkin2.rgb,surfaceAcross,radial,skinNormal);
 base=vec4(waterColor*.98,.98)*occupied;
 float splash=repeated(vec4(400.,400.,512.,512.),vec2(fm.r*2.,s*2.-uTime*1.7)).r;
 float frontBand=exp(-pow((s-head+.065)/.14,2.))*shape;
 float tailBand=exp(-pow((s-tail-.04)/.1,2.))*shape;
 float shimmer=pow(abs(normal.x*.7+normal.y*.3),2.)*.10*occupied;
 float foam=shimmer+occupied*(frontBand*(.16+.30*splash)+tailBand*.09);
 float cap=occupied*(1.-smoothstep(.10,1.20,max(head-s,0.)))*shape*.96;
 vec4 highlight=vec4(vec3(cap)+uFoam.rgb*foam*(1.-cap),cap+foam*(1.-cap));
 float skinAcross=surfaceAcross+skinNormal.x*.035;
 float rim=exp(-pow((abs(skinAcross)-.96)/.055,2.));
 float specular=occupied*rim*(.095+.03*skinNormal.y);
 finalColor=over(vec4(vec3(.70,.94,1.)*specular,specular),over(highlight,base))*uColor;
}`;

export function createFlowRoute(PIXI, manifest, sources, segments, parent, profile) {
  const positions = [], uvs = [], starts = [], shapes = [], indices = [];
  for (const segment of segments) {
    const offset = positions.length / 2, cos = Math.cos(segment.rotation), sin = Math.sin(segment.rotation);
    for (const [x, y] of [[-32,-32],[32,-32],[32,32],[-32,32]]) {
      positions.push(44+segment.x*64+x*cos-y*sin,44+segment.y*64+x*sin+y*cos);
      starts.push(segment.start + 5);shapes.push(['straight','left','right'].indexOf(segment.shape));
    }
    uvs.push(0,0,1,0,1,1,0,1);indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const attribute = (data, format) => ({buffer: new Float32Array(data), format});
  const geometry = new PIXI.Geometry({attributes: {
    aPosition: attribute(positions, 'float32x2'), aUV: attribute(uvs, 'float32x2'),
    aStart: attribute(starts, 'float32'), aShape: attribute(shapes, 'float32'),
  }, indexBuffer: new Uint32Array(indices)});
  const color = role => {
    const n = parseInt((profile.colors[role]?.hex || profile.colors.skin.hex).replace('#',''),16);
    return new Float32Array([(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1]);
  };
  const shader = PIXI.Shader.from({gl:{vertex,fragment},resources:{
    uData:sources.get('fluid-data'),uFog:sources.get('gas-field'),uWater:sources.get('water-field'),
    flow:{uTime:{value:0,type:'f32'},uThickness:{value:1,type:'f32'},uGas:{value:profile.phase==='gas'?1:0,type:'f32'},
      uSkinSpeed:{value:manifest.parametersByResourceId[manifest.entries['pipe.straight'].id].waterSkinSpeed??.7,type:'f32'},
      uMapSize:{value:manifest.pages['fluid-data'].width/8,type:'f32'},
      uBounds:{value:new Float32Array([4,5,.012,1]),type:'vec4<f32>'},
      uBody:{value:color('body'),type:'vec4<f32>'},uSkin:{value:color('skin'),type:'vec4<f32>'},
      uSkin2:{value:color('skin2'),type:'vec4<f32>'},uFoam:{value:color('splash'),type:'vec4<f32>'}}
  }});
  const mesh = new PIXI.Mesh({geometry,shader});mesh.logisticsLayer='fluid-body';
  mesh.flowRoute = true;parent.addChild(mesh);
  return mesh;
}
