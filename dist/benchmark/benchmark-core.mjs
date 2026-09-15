export const CANVAS = 1080;
export const CELL = 128;
export const GAP = 1;

export function chooseClip(variant, requested) {
  if (requested) {
    const clip = variant.clips.find(x => x.name === requested);
    if (!clip) throw Error(`动画不存在：${requested}`);
    return clip;
  }
  return variant.clips.find(x => x.name === 'open_idle')
    ?? [...variant.clips].sort((a, b) => b.frameCount - a.frameCount)[0];
}

export function resolveDevices(catalog, config) {
  const rows = config.devices === 'all' ? catalog.devices.map(d => ({id:d.id, count:1})) : config.devices;
  if (!Array.isArray(rows) || !rows.length) throw Error('devices 必须为 all 或非空设备数组');
  let fills = 0;
  return rows.map(row => {
    const device = catalog.devices.find(d => d.id === row.id);
    if (!device) throw Error(`设备不存在：${row.id}`);
    const variant = device.variants.find(v => v.key === (row.variant ?? device.defaultVariant));
    if (!variant) throw Error(`模式不存在：${row.id}/${row.variant}`);
    const count = row.count ?? 1;
    if (count === 'fill') fills++;
    else if (!Number.isInteger(count) || count < 0 || count > 50000) throw Error('设备数量必须为 0–50000 或 fill');
    if (fills > 1) throw Error('只允许一种设备使用 fill');
    const rect = variant.spatial.footprintRectCells;
    if (![rect.width,rect.height].every(v => Number.isInteger(v) && v > 0)) throw Error(`占地数据无效：${row.id}`);
    return {device,variant,clip:chooseClip(variant,row.clip),count,width:rect.width,height:rect.height};
  });
}

export function packScene(rows, requestedGrid = 'auto') {
  if (requestedGrid === 'auto' && rows.some(r => r.count === 'fill')) throw Error('fill 需要明确的 gridCells');
  const attempt = n => {
    const blocked = new Uint8Array(n*n), placements=[];
    const mark=(x,y,w,h) => {
      for(let yy=Math.max(0,y-1);yy<Math.min(n,y+h+1);yy++)
        blocked.fill(1,yy*n+Math.max(0,x-1),yy*n+Math.min(n,x+w+1));
    };
    // Two mandatory, contiguous ten-cell routes; one empty row between them.
    const routes=[{kind:'conveyor',x:1,y:1,width:10,height:1},{kind:'pipe',x:1,y:3,width:10,height:1}];
    routes.forEach(r=>mark(r.x,r.y,r.width,r.height));
    const fits=(row,x,y) => {
      const f=row.variant.spatial.footprintRectCells, c=row.variant.spatial.canvasCells;
      if(x-f.left<0||y-f.top<0||x-f.left+c.width>n||y-f.top+c.height>n) return false;
      for(let yy=y;yy<y+row.height;yy++) for(let xx=x;xx<x+row.width;xx++) if(blocked[yy*n+xx]) return false;
      return true;
    };
    const ordered=[...rows].sort((a,b)=>(a.count==='fill')-(b.count==='fill')||b.height-a.height||b.width-a.width);
    for(const row of ordered) {
      let placed=0;
      for(let y=0;y<=n-row.height && (row.count==='fill'||placed<row.count);y++) {
        for(let x=0;x<=n-row.width && (row.count==='fill'||placed<row.count);x++) {
          if(!fits(row,x,y)) continue;
          placements.push({row,x,y,width:row.width,height:row.height}); mark(x,y,row.width,row.height); placed++;
          if(placements.length>50000) throw Error('设备总数超过 50000');
        }
      }
      if(row.count!=='fill'&&placed!==row.count) return null;
    }
    return {gridCells:n,placements,routes};
  };
  if(requestedGrid!=='auto') {
    if(!Number.isInteger(requestedGrid)||requestedGrid<12||requestedGrid>1024) throw Error('gridCells 必须为 12–1024 或 auto');
    const result=attempt(requestedGrid);
    if(!result) throw Error('网格放不下指定设备；请增加 gridCells');
    return result;
  }
  const area=rows.reduce((s,r)=>s+(r.width+1)*(r.height+1)*r.count,48);
  for(let n=Math.max(12,Math.ceil(Math.sqrt(area)));n<=1024;n++) {const result=attempt(n);if(result) return result;}
  throw Error('自动排布超过 1024×1024 格');
}

export function makeTimeline(frames) {
  let duration=0;
  const ends=frames.map(f=>duration+=Number(f.durationMs)>0?Number(f.durationMs):1000/30);
  return {ends,duration};
}
export function frameAt(timeline,elapsed) {
  const time=((elapsed%timeline.duration)+timeline.duration)%timeline.duration;
  let low=0, high=timeline.ends.length-1;
  while(low<high) {const mid=(low+high)>>1;if(time<timeline.ends[mid])high=mid;else low=mid+1;}
  return low;
}
export function randomGenerator(seed) {
  let a=seed>>>0;
  return () => {a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function distribution(values) {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
  const percentile=p=>{const x=(n-1)*p,l=Math.floor(x);return sorted[l]+(sorted[Math.min(l+1,n-1)]-sorted[l])*(x-l);};
  return {count:n,mean:sorted.reduce((a,b)=>a+b,0)/n,min:sorted[0],max:sorted[n-1],
    p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),p999:percentile(.999)};
}
export function summarizeFrames(values) {
  const d=distribution(values);
  if(!d)return null;
  const slow=[...values].sort((a,b)=>b-a);
  const low=fraction=>{const n=Math.max(1,Math.ceil(slow.length*fraction));return 1000/(slow.slice(0,n).reduce((a,b)=>a+b,0)/n);};
  return {frames:d.count,durationMs:values.reduce((a,b)=>a+b,0),averageFps:1000/d.mean,
    minInstantFps:1000/d.max,maxInstantFps:1000/d.min,onePercentLowFps:low(.01),pointOnePercentLowFps:low(.001),
    onePercentLowSamples:Math.ceil(d.count*.01),pointOnePercentLowSamples:Math.ceil(d.count*.001),frameTimeMs:d,
    over16_67ms:values.filter(x=>x>1000/60+.5).length,over33_33ms:values.filter(x=>x>1000/30+.5).length,
    over50ms:values.filter(x=>x>50).length,over100ms:values.filter(x=>x>100).length};
}
