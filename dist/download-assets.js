(() => {
  const script=document.currentScript, root=new URL(script.dataset.siteRoot,location.href);
  const params=new URLSearchParams(location.search);
  const inBuilding=location.pathname.includes('/buildings/');
  let size=inBuilding?Number(script.dataset.size):params.get('size')==='64'?64:128;
  const select=document.getElementById('site-size');select.value=size;
  function updateCards(){for(const a of document.querySelectorAll('main li a')){
    const url=new URL(a.href);const id=url.pathname.split('/buildings/')[1];
    if(id)a.href=new URL((size===64?'64/':'')+'buildings/'+id,root);
  }}updateCards();
  select.onchange=()=>{size=Number(select.value);if(inBuilding){
    const id=location.pathname.split('/buildings/')[1];
    const url=new URL((size===64?'64/':'')+'buildings/'+id,root);url.search=location.search;url.hash=location.hash;location.assign(url);
  }else{const url=new URL(location.href);url.searchParams.set('size',size);history.replaceState(null,'',url);updateCards();}};
  const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}
  const crc32=data=>{let c=0xffffffff;for(const b of data)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  const enc=new TextEncoder();
  function header(length){const data=new Uint8Array(length);return {data,view:new DataView(data.buffer)};}
  async function pack(size){
    const status=document.getElementById('download-status');
    const buttons=[...document.querySelectorAll('[data-download-size]')];buttons.forEach(b=>b.disabled=true);
    try{
      const response=await fetch(new URL('downloads/'+size+'.json',root));if(!response.ok)throw Error('下载清单不可用');
      const recipe=await response.json(),parts=[],directory=[];let offset=0,count=0;
      if(recipe.totalBytes>0xffffffff)throw Error('素材超过单个 ZIP32 容量');
      const metadata=enc.encode(JSON.stringify({pixelsPerCell:size,textureProfile:recipe.textureProfile},null,2));
      const files=[{path:'texture-profile.json',data:metadata},...recipe.files];
      for(const file of files){
        status.textContent=`正在打包 ${size}px：${++count}/${files.length} · ${file.path}`;
        let data=file.data;
        if(!data){const r=await fetch(new URL(file.url,root));if(!r.ok)throw Error(`${r.status}: ${file.url}`);data=new Uint8Array(await r.arrayBuffer());
          if(data.length!==file.bytes)throw Error('文件长度校验失败：'+file.path);
          if(crypto.subtle){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('文件校验失败，请刷新后重试：'+file.path);}
        }
        const name=enc.encode(file.path),crc=crc32(data),local=header(30+name.length),v=local.view;
        v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);
        v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.data.set(name,30);
        const central=header(46+name.length),c=central.view;
        c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
        c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.data.set(name,46);
        parts.push(local.data,data);directory.push(central.data);offset+=local.data.length+data.length;
      }
      const end=header(22),v=end.view;v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);
      v.setUint32(12,directory.reduce((s,d)=>s+d.length,0),true);v.setUint32(16,offset,true);
      const blob=new Blob([...parts,...directory,end.data],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=recipe.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent=`${size}px 素材包已生成（${(blob.size/1048576).toFixed(1)} MiB）`;
    }catch(e){status.textContent='下载失败：'+e.message;}
    finally{buttons.forEach(b=>b.disabled=false);}
  }
  document.querySelectorAll('[data-download-size]').forEach(button=>button.onclick=()=>pack(Number(button.dataset.downloadSize)));
})();
