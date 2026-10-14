'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const canvas=$('#scene'), ctx=canvas.getContext('2d'), stage=$('#stage');
const state={view:'oblique',background:'grass',grid:true,zoom:1,pan:[0,0],selected:null};
const images={},sideNames={north:'北',east:'东',south:'南',west:'西'};
let manifest,layout,assets,scale=1,origin=[0,0],width=0,height=0;
function image(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('无法加载 '+url));im.src=url;});}
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(url+' ('+r.status+')');return r.json();}
function selectButtons(selector,value,attribute){$$(selector).forEach(b=>b.setAttribute('aria-pressed',b.dataset[attribute]===value?'true':'false'));}
function roundedRect(x,y,w,h,fill){ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);}
function background(){
 if(state.background==='grass'){
  ctx.fillStyle='#889275';ctx.fillRect(0,0,width,height);
  const tile=state.view==='top'?16*scale:205*state.zoom;
  ctx.save();ctx.translate(width/2+state.pan[0],height/2+state.pan[1]);ctx.scale(tile/images.grass.width,tile/images.grass.height);
  ctx.fillStyle=ctx.createPattern(images.grass,'repeat');ctx.fillRect(-(width+Math.abs(state.pan[0])*2)*images.grass.width/tile,-(height+Math.abs(state.pan[1])*2)*images.grass.height/tile,(width+Math.abs(state.pan[0])*2)*2*images.grass.width/tile,(height+Math.abs(state.pan[1])*2)*2*images.grass.height/tile);ctx.restore();
 }else if(state.background==='white'){ctx.fillStyle='#fafbf7';ctx.fillRect(0,0,width,height);}
 else{ctx.fillStyle='#f3f4ef';ctx.fillRect(0,0,width,height);const n=22;ctx.fillStyle='#dce0d6';for(let y=0;y<height;y+=n)for(let x=0;x<width;x+=n)if((Math.floor(x/n)+Math.floor(y/n))%2===0)ctx.fillRect(x,y,n,n);}
}
function world(x,z){return [origin[0]+x*scale,origin[1]-z*scale];}
function line(points,color,dash=[]){ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash(dash);ctx.beginPath();points.forEach(([x,z],i)=>{const p=world(x,z);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.stroke();ctx.setLineDash([]);}
function label(text,x,z){const p=world(x,z);ctx.font='12px Segoe UI, Microsoft YaHei, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const tw=ctx.measureText(text).width;ctx.fillStyle='#182819de';ctx.fillRect(p[0]-tw/2-8,p[1]-10,tw+16,20);ctx.fillStyle='#f1f4e5';ctx.fillText(text,...p);}
function draw(){
 if(!layout)return;
 const rect=stage.getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(window.devicePixelRatio||1,2);
 if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
 scale=Math.min((width-80)/50,(height-66)/50)*state.zoom;origin=[width/2-23*scale+state.pan[0],height/2+23*scale+state.pan[1]];
 background();
 if(state.view==='oblique'){
   const im=images.overview,f=Math.min((width-26)/im.width,(height-20)/im.height)*state.zoom;
   ctx.drawImage(im,(width-im.width*f)/2+state.pan[0],(height-im.height*f)/2+state.pan[1],im.width*f,im.height*f);
 }else{
  if(state.grid){
   ctx.lineWidth=.55;ctx.strokeStyle=state.background==='grass'?'#17301635':'#69765b32';ctx.beginPath();
   for(let n=0;n<=46;n++){let p=world(n,0),q=world(n,46);ctx.moveTo(...p);ctx.lineTo(...q);p=world(0,n);q=world(46,n);ctx.moveTo(...p);ctx.lineTo(...q);}ctx.stroke();
   layout.placements.filter(p=>p.blocking).forEach(p=>{const xy=world(p.gridX,p.gridZ+p.depth);roundedRect(xy[0],xy[1],p.width*scale,p.depth*scale,'#cce6a34d');});
   layout.gates.forEach(p=>{const xy=world(p.gridX,p.gridZ+p.depth);roundedRect(xy[0],xy[1],p.width*scale,p.depth*scale,'#e8c47845');});
  }
  layout.placements.forEach(p=>{
    const a=assets.sprites.find(a=>a.id===p.sprite),im=images[p.sprite],xy=world(...p.renderCenterGridXZ),f=scale/assets.pixelsPerCell;
    ctx.save();ctx.translate(...xy);ctx.rotate(p.yawDegrees*Math.PI/180);ctx.scale(1,-1);ctx.drawImage(im,-a.pivotPixels.x*f,-a.pivotPixels.y*f,im.width*f,im.height*f);ctx.restore();
  });
  layout.gates.forEach(g=>line(g.centerlineEndpoints,'#a17830',[4,4]));
  if(state.selected){const p=state.selected,xy=world(p.gridX,p.gridZ+p.depth);ctx.lineWidth=2;ctx.strokeStyle='#c87c32';ctx.strokeRect(xy[0]-2,xy[1]-2,p.width*scale+4,p.depth*scale+4);label(p.id,...p.renderCenterGridXZ);}
  if(state.grid){label('北 · 45 米',23,48);label('南入口 · 10 格',20.5,-2);label('西入口',-2,10.5);label('44 × 44 格净空',23,23);label('东',48,23);}
 }
 $('#view-label').textContent=state.view==='top'?'北 ↑ · 整数格顶视 · 1 格 = 1 米':'45° 正交预览';
 $('#grid').disabled=state.view!=='top';$('#zoom-value').value=Math.round(state.zoom*100)+'%';
 canvas.dataset.ready='true';canvas.dataset.view=state.view;canvas.dataset.background=state.background;
}
function setPiece(id){const post=id==='post';$('#piece-image').src='previews/'+id+'-detail.webp';$('#piece-image').alt=post?'独立立柱细节':id.replace('rail','')+'格栏杆细节';$('#piece-type').textContent=post?'立柱 · 1 × 1 附属层':'栏杆 · 1 × N';$('#piece-count').textContent=({rail5:'30 段',rail2:'2 段',rail3:'2 段',post:'4 根'})[id];selectButtons('[data-piece]',id,'piece');}
function select(p){state.selected=p;setPiece(p.sprite);$('#selection').textContent=p.id+' · ('+p.gridX+', '+p.gridZ+') · '+p.yawDegrees+'°';$$('#placements tr').forEach(row=>row.classList.toggle('selected',row.dataset.id===p.id));draw();}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
$$('button[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;state.pan=[0,0];state.zoom=1;selectButtons('button[data-view]',state.view,'view');draw();}));
$$('button[data-background]').forEach(b=>b.addEventListener('click',()=>{state.background=b.dataset.background;selectButtons('button[data-background]',state.background,'background');draw();}));
$$('[data-piece]').forEach(b=>b.addEventListener('click',()=>setPiece(b.dataset.piece)));
$('#grid').addEventListener('change',e=>{state.grid=e.target.checked;draw();});
function zoom(n){state.zoom=Math.max(.6,Math.min(5,n));draw();}
$('#zoom-in').addEventListener('click',()=>zoom(state.zoom*1.25));$('#zoom-out').addEventListener('click',()=>zoom(state.zoom/1.25));$('#reset').addEventListener('click',()=>{state.pan=[0,0];state.zoom=1;draw();});
$('#export').addEventListener('click',()=>canvas.toBlob(b=>{if(b)download(b,'wuling-farmland-'+state.view+'-'+state.background+'.png');}));
$('#csv-download').addEventListener('click',()=>{if(!layout)return;const cols=['id','type','lengthCells','gridX','gridZ','width','depth','yawDegrees','renderCenterX','renderCenterZ','blocking','sourceEntityId'];const rows=layout.placements.map(p=>[...cols.slice(0,8).map(k=>p[k]),...p.renderCenterGridXZ,p.blocking,p.sourceEntityId].join(','));download(new Blob(['\ufeff'+cols.join(',')+'\r\n'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),'wuling-farmland-placements.csv');});
let pointer;
canvas.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.moved ||= Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>5;state.pan[0]+=dx;state.pan[1]+=dy;pointer.x=e.clientX;pointer.y=e.clientY;draw();});
canvas.addEventListener('pointerup',e=>{if(pointer&&!pointer.moved&&state.view==='top'&&layout){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-origin[0])/scale,z=(origin[1]-e.clientY+r.top)/scale;let p=layout.placements.filter(p=>x>=p.gridX&&x<p.gridX+p.width&&z>=p.gridZ&&z<p.gridZ+p.depth).at(-1);if(!p){p=[...layout.placements].sort((a,b)=>Math.hypot(x-a.renderCenterGridXZ[0],z-a.renderCenterGridXZ[1])-Math.hypot(x-b.renderCenterGridXZ[0],z-b.renderCenterGridXZ[1]))[0];if(Math.hypot(x-p.renderCenterGridXZ[0],z-p.renderCenterGridXZ[1])>1.5)p=null;}if(p)select(p);}pointer=null;});
canvas.addEventListener('pointercancel',()=>{pointer=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(state.zoom*(e.deltaY<0?1.1:1/1.1));},{passive:false});
canvas.addEventListener('keydown',e=>{if(e.key==='+'||e.key==='=')zoom(state.zoom*1.25);if(e.key==='-')zoom(state.zoom/1.25);if(e.key==='0'){$('#reset').click();}});
new ResizeObserver(draw).observe(stage);
(async()=>{try{
 manifest=await json('manifest.json');layout=await json('layout.json');assets=await json(manifest.profiles[0].assets);
 await Promise.all([...assets.sprites.map(async a=>{images[a.id]=await image(a.file);}),image('backgrounds/grass-base.webp').then(i=>images.grass=i),image('previews/overview-oblique.webp').then(i=>images.overview=i)]);
 $('#placements').innerHTML=layout.placements.map(p=>'<tr tabindex="0" data-id="'+p.id+'"><td>'+p.id+'</td><td>'+(p.type==='rail'?'栏杆 '+p.lengthCells+' 格':'立柱')+'</td><td>'+sideNames[p.side]+'</td><td>('+p.gridX+', '+p.gridZ+')</td><td>'+p.width+' × '+p.depth+'</td><td>'+p.yawDegrees+'°</td><td>('+p.renderCenterGridXZ.join(', ')+')</td></tr>').join('');
 $$('#placements tr').forEach(row=>{const p=layout.placements.find(p=>p.id===row.dataset.id);row.addEventListener('click',()=>{state.view='top';selectButtons('button[data-view]','top','view');select(p);});row.addEventListener('keydown',e=>{if(e.key==='Enter')row.click();});});
 for(const pack of manifest.downloads||[]){const a=$('[data-pack="'+pack.key+'"]');if(a){a.href=pack.url;a.hidden=false;}}
 if(manifest.downloads?.length)$('#download-status').hidden=true;
 $('#loading').hidden=true;draw();window.wulingViewer={state,layout,assets,draw};
 }catch(e){$('#loading').hidden=true;$('#error').hidden=false;$('#error').textContent='素材加载失败：'+e.message;console.error(e);}
})();
