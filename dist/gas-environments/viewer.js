// Minimal native WebGL consumer. Atlas RGB is grayscale sRGB, A is straight alpha.
const $=id=>document.getElementById(id);
const get=async path=>{const r=await fetch(path);if(!r.ok)throw Error(path+': HTTP '+r.status);return r.json();};
const toSrgb=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
const toLinear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const hex=rgb=>'#'+rgb.map(x=>Math.round(Math.min(1,toSrgb(x))*255).toString(16).padStart(2,'0')).join('');
try {
const manifest=await get('manifest.json');
const [mesh,palette]=await Promise.all([get(manifest.mesh),get(manifest.palette)]);
const canvas=$('view'), gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true});
if(!gl)throw Error('浏览器无法启用 WebGL');
const vertex='attribute vec2 aPosition;attribute vec2 aUV;uniform float uZoom;varying vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPosition.x*uZoom/10.,-aPosition.y*uZoom/10.,0.,1.);}';
const fragment='precision highp float;varying vec2 vUV;uniform sampler2D uPage0;uniform sampler2D uPage1;uniform vec4 uRect0;uniform vec4 uRect1;uniform vec2 uSize0;uniform vec2 uSize1;uniform float uMix;uniform vec3 uTint;'
+'vec3 decode(vec3 v){return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}'
+'vec3 encode(vec3 v){return mix(v*12.92,1.055*pow(max(v,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),v));}'
+'vec4 readFrame(sampler2D page,vec4 rect,vec2 size){vec2 uv=vec2(fract(vUV.x),clamp(vUV.y,0.,1.));vec4 c=texture2D(page,(rect.xy+uv*rect.zw)/size);return vec4(decode(c.rgb)*c.a,c.a);}'
+'void main(){vec4 c=mix(readFrame(uPage0,uRect0,uSize0),readFrame(uPage1,uRect1,uSize1),uMix);vec3 straight=c.a>0.00001?c.rgb/c.a:vec3(0.);gl_FragColor=vec4(encode(straight*uTint)*c.a,c.a);}';
function shader(type,source){let s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
for(const [name,data] of [['aPosition',mesh.positions],['aUV',mesh.uvs]]){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data.flat()),gl.STATIC_DRAW);const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);}
const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(mesh.indices),gl.STATIC_DRAW);
gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
const uniforms=Object.fromEntries(['uZoom','uPage0','uPage1','uRect0','uRect1','uSize0','uSize1','uMix','uTint'].map(k=>[k,gl.getUniformLocation(program,k)]));
let animation=null,textures=[],running=true,time=0,last=0,loadSequence=0,tint=palette.colors[0].tintLinear;
function choose(gas){tint=gas.tintLinear;$('tint').value=hex(tint);for(const b of $('gases').children)b.setAttribute('aria-pressed',String(b.dataset.gas===gas.id));}
for(const gas of palette.colors){const b=document.createElement('button');b.className='gas';b.dataset.gas=gas.id;const s=document.createElement('span');s.className='swatch';s.style.background=hex(gas.tintLinear);b.append(s,gas.label);b.onclick=()=>choose(gas);$('gases').append(b);}
choose(palette.colors[0]);
$('tint').oninput=()=>{const s=$('tint').value;tint=[1,3,5].map(i=>toLinear(parseInt(s.slice(i,i+2),16)/255));for(const b of $('gases').children)b.setAttribute('aria-pressed','false');};
for(const profile of manifest.profiles){const o=document.createElement('option');o.value=profile.size;o.textContent=profile.size+' 档';o.selected=profile.size===manifest.defaultSize;$('size').append(o);}
async function loadSize(){const sequence=++loadSequence;$('status').textContent='正在载入图集…';const profile=manifest.profiles.find(p=>p.size===Number($('size').value));const data=await get(profile.animation);const base=new URL(profile.animation,location.href);const images=await Promise.all(data.pages.map(p=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图集加载失败: '+p.file));im.src=new URL(p.file,base).href;})));if(sequence!==loadSequence)return;
for(const tx of textures)gl.deleteTexture(tx);
textures=images.map(im=>{if(im.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||im.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('设备支持的图集尺寸不足');const tx=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tx);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return tx;});animation=data;const stats=manifest.statistics[String(profile.size)];$('stats').textContent=mesh.positions.length+' 顶点 / '+mesh.indices.length/3+' 三角形 · 每帧 '+data.stripPixels.join(' × ')+' · '+data.frameCount+' 帧 / '+data.fps+' fps · 图集 '+(stats.webpBytes/1048576).toFixed(2)+' MiB · 显存 '+(stats.gpuRGBA8Bytes/1048576).toFixed(1)+' MiB（四种共用）';$('animation').href=profile.animation;$('atlas').src=images[0].src;$('status').textContent='已就绪 · 颜色实时切换';document.body.dataset.ready='true';}
$('size').onchange=()=>loadSize().catch(showError);
$('background').onchange=()=>{const v=$('background').value;$('stage').style.backgroundImage=v==='checker'?'':'none';$('stage').style.backgroundColor=v==='checker'?'':v;};
$('play').onclick=()=>{running=!running;$('play').textContent=running?'暂停':'播放';};
$('source').textContent='来源版本：'+manifest.sourceVersion+' · P_fxfac_vaporizer_scope_*_2501 · 素材类型：灰度 RGBA 动画图集 + 顶点 UV';
if(manifest.home)$('home').href=manifest.home;
if(manifest.downloads)for(const download of manifest.downloads){const a=document.createElement('a');a.href=download.url;a.textContent='下载 '+download.size+' 档完整素材包';a.style.marginRight='16px';$('downloads').append(a);}
function render(now){const dt=last?Math.min((now-last)/1000,.1):0;last=now;if(running)time+=dt*Number($('speed').value);const size=Math.min(1600,Math.round(canvas.clientWidth*devicePixelRatio));if(canvas.width!==size){canvas.width=size;canvas.height=size;gl.viewport(0,0,size,size);}gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);if(animation){const pos=(time%animation.durationSeconds)*animation.fps,first=Math.floor(pos)%animation.frameCount,second=(first+1)%animation.frameCount;for(const [unit,index] of [[0,first],[1,second]]){const frame=animation.frames[index],page=animation.pages[frame.page];gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[frame.page]);gl.uniform1i(uniforms['uPage'+unit],unit);gl.uniform4fv(uniforms['uRect'+unit],frame.rect);gl.uniform2f(uniforms['uSize'+unit],page.width,page.height);}gl.uniform1f(uniforms.uMix,pos-Math.floor(pos));gl.uniform1f(uniforms.uZoom,Number($('zoom').value));gl.uniform3fv(uniforms.uTint,tint);gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);$('clock').textContent=(time%animation.durationSeconds).toFixed(2)+' / '+animation.durationSeconds.toFixed(2)+' 秒';}requestAnimationFrame(render);}
await loadSize();requestAnimationFrame(render);
}catch(error){showError(error);}
function showError(error){$('status').textContent=error.message;$('status').classList.add('error');console.error(error);}

