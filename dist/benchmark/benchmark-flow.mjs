// The route uses the delivery's precomputed spatial fields and shader.
// Geometry retains the original 64-pixel route coordinate system, regardless
// of image resolution; the caller maps it to the 128-pixel scene grid.
export function createFlowRoute(PIXI, manifest, sources, segments, parent, profile) {
  if(manifest.textureProfile?.id!=='offline-grid-v1'||![64,128].includes(manifest.textureProfile.pixelsPerCell))throw Error('Baked grid-size flow assets required');
  const positions=[],uvs=[],starts=[],shapes=[],indices=[];
  for(const segment of segments){
    const offset=positions.length/2,cos=Math.cos(segment.rotation),sin=Math.sin(segment.rotation);
    for(const [x,y] of [[-32,-32],[32,-32],[32,32],[-32,32]]){
      positions.push(44+segment.x*64+x*cos-y*sin,44+segment.y*64+x*sin+y*cos);
      starts.push(segment.start+5);shapes.push(['straight','left','right'].indexOf(segment.shape));
    }
    uvs.push(0,0,1,0,1,1,0,1);indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const attribute=(data,format)=>({buffer:new Float32Array(data),format});
  const geometry=new PIXI.Geometry({attributes:{
    aPosition:attribute(positions,'float32x2'),aUV:attribute(uvs,'float32x2'),
    aStart:attribute(starts,'float32'),aShape:attribute(shapes,'float32'),
  },indexBuffer:new Uint32Array(indices)});
  const color=role=>{
    const n=parseInt((profile.colors[role]?.hex||profile.colors.skin.hex).replace('#',''),16);
    return new Float32Array([(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1]);
  };
  const {vertex,fragment}=manifest.fluidPlayback.referenceShader;
  const shader=PIXI.Shader.from({gl:{vertex,fragment},resources:{
    uData:sources.get('fluid-data'),uFog:sources.get('gas-field'),
    flow:{uTime:{value:0,type:'f32'},uThickness:{value:1,type:'f32'},uGas:{value:profile.phase==='gas'?1:0,type:'f32'},
      uBounds:{value:new Float32Array([4,5,.012,1]),type:'vec4<f32>'},
      uBody:{value:color('body'),type:'vec4<f32>'},uSkin:{value:color('skin'),type:'vec4<f32>'},
      uSkin2:{value:color('skin2'),type:'vec4<f32>'},uFoam:{value:color('splash'),type:'vec4<f32>'}}
  }});
  const mesh=new PIXI.Mesh({geometry,shader});mesh.logisticsLayer='fluid-body';
  mesh.flowRoute=true;parent.addChild(mesh);return mesh;
}
