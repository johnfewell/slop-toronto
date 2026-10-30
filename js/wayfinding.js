(function () {
const {THREE,GEO,ROADS,CITY_BOUNDS,blockAt}=window.CITY;
const {attribute,uv,vec2,texture,positionGeometry}=window.CITY.TSL;
const FONT='Arial, sans-serif';

// Pool selection is independent of rendering/texture ownership and stable by ID.
function nearbyWayfinding(sites,position,limit=4) {
  if(!Number.isFinite(position?.x)||!Number.isFinite(position?.z)) return [];
  return sites.map((site)=>({site,d:Math.hypot(site.x-position.x,site.z-position.z)})).filter((r)=>r.d<40).sort((a,b)=>a.d-b.d||a.site.id.localeCompare(b.site.id)).slice(0,limit).map((r)=>r.site);
}

function buildWayfindingMaps(parent) {
  const totems=window.CITY.wayfindingStats?.sites||[];
  const sites=[...totems,...(window.CITY.infoPillarStats?.sites||[])];
  const group=new THREE.Group();group.name='WayfindingMaps';parent.add(group);
  if(!sites.length)return {update(){},group};
  const ground=(s)=>(blockAt(s.x,s.z)?CITY_BOUNDS.sidewalkHeight:0)+(window.CITY.cutAt?.(s.x,s.z)||0);
  const matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0);
  // Preserve the verified Roncesvalles front; cover that print everywhere else,
  // including distant signs. The nearby pool supplies site-specific maps.
  const positions=[],colours=[];
  const dark=new THREE.Color('#193a30'),mint=new THREE.Color('#bfdcaf');
  for(const side of [1,-1]) {
    const tri=(points,col)=>{
      if(side<0)points=points.slice().reverse();
      for(const [x,y]of points){positions.push(x,y,side*.106);colours.push(col.r,col.g,col.b);}
    };
    const rect=(a,b,col)=>{tri([[-.224,a],[.224,a],[.224,b]],col);tri([[-.224,a],[.224,b],[-.224,b]],col);};
    rect(.756,2.304,dark);rect(2.304,2.52,mint);
    tri([[-.224,2.52],[.224,2.52],[-.224,2.7]],mint);
  }
  const coverGeo=new THREE.BufferGeometry();coverGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));coverGeo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));coverGeo.computeVertexNormals();
  const photoFront=new Float32Array(totems.length);
  totems.forEach((s,i)=>{photoFront[i]=s.id==='IP-00839'?1:0;});
  coverGeo.setAttribute('photoFront',new THREE.InstancedBufferAttribute(photoFront,1));
  const coverMat=new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:.7});
  coverMat.maskNode=positionGeometry.z.greaterThan(0).and(attribute('photoFront','float').greaterThan(.5)).not();
  const cover=new THREE.InstancedMesh(coverGeo,coverMat,totems.length);cover.name='WayfindingBlankFaces';cover.userData.cullDistance=150;cover.userData.cullCell=60;
  totems.forEach((s,i)=>{pos.set(s.x,ground(s),s.z);quat.setFromAxisAngle(up,s.yaw);matrix.compose(pos,quat,scale);cover.setMatrixAt(i,matrix);});cover.instanceMatrix.needsUpdate=true;cover.computeBoundingSphere();group.add(cover);

  const low=window.CITY.QUALITY?.lean, W=low?128:256,H=low?448:896,COLS=4,ROWS=2,SLOTS=COLS*ROWS;
  const canvas=document.createElement('canvas');canvas.width=W*COLS;canvas.height=H*ROWS;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#193a30';ctx.fillRect(0,0,canvas.width,canvas.height);
  const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;
  const geo=new THREE.PlaneGeometry(.44,1.764);
  // Fixed instances/material/texture from startup: updating maps never adds a
  // new render object or changes the shader program while walking.
  const cell=new Float32Array(SLOTS*2);
  for(let i=0;i<SLOTS;i++){cell[2*i]=(i%COLS)/COLS;cell[2*i+1]=1-(Math.floor(i/COLS)+1)/ROWS;}
  geo.setAttribute('wayfindingCell',new THREE.InstancedBufferAttribute(cell,2));
  const mat=new THREE.MeshStandardNodeMaterial();mat.roughness=.7;
  mat.colorNode=texture(atlas,attribute('wayfindingCell','vec2').add(uv().mul(vec2(1/COLS,1/ROWS))));
  const maps=new THREE.InstancedMesh(geo,mat,SLOTS);maps.name='WayfindingNearbyMaps';maps.frustumCulled=false;
  maps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for(let i=0;i<SLOTS;i++)maps.setMatrixAt(i,matrix.makeTranslation(0,-1000,0));
  maps.instanceMatrix.needsUpdate=true;group.add(maps);
  const state={slots:SLOTS,textureWidth:canvas.width,textureHeight:canvas.height,active:[],photoFronts:totems.filter((s)=>s.id==='IP-00839').map((s)=>s.id),generatedFaces:[],updates:0};
  window.CITY.wayfindingMapStats=state;
  const bounds=(points)=>({x0:Math.min(...points.map((p)=>p[0])),x1:Math.max(...points.map((p)=>p[0])),z0:Math.min(...points.map((p)=>p[1])),z1:Math.max(...points.map((p)=>p[1]))});
  const areas=GEO.areas.filter(([type])=>type==='park'||type==='water').map(([type,,ring])=>{const ps=[];for(let i=0;i<ring.length;i+=2)ps.push([ring[i],ring[i+1]]);return {type,ps,...bounds(ps)};});
  const roads=ROADS.map((road)=>({road,...bounds(road.pts.map((p)=>[p.x,p.z]))}));

  function drawFace(site,back,slot) {
    const ox=(slot%COLS)*W,oy=Math.floor(slot/COLS)*H;
    ctx.save();ctx.translate(ox,oy);ctx.scale(W/256,H/896);
    ctx.fillStyle='#193a30';ctx.fillRect(0,0,256,896);
    ctx.fillStyle='#bfdcaf';ctx.fillRect(0,0,256,122);
    ctx.fillStyle='#16362d';ctx.font=`bold 18px ${FONT}`;
    const title=site.frontage.split(' ');let line='',y=32;
    for(const word of title){if(ctx.measureText(line+' '+word).width>230){ctx.fillText(line,12,y);line=word;y+=22;}else line+=(line?' ':'')+word;}
    ctx.fillText(line,12,y);
    ctx.font=`13px ${FONT}`;ctx.fillText('TORONTO  ·  WALKING MAP',12,106);
    ctx.fillStyle='#fff';ctx.font=`bold 18px ${FONT}`;ctx.fillText('Explore nearby',12,155);
    const yaw=site.yaw+(back?Math.PI:0),fx=Math.sin(yaw),fz=Math.cos(yaw),rx=Math.cos(yaw),rz=-Math.sin(yaw);
    function map(y,height,range) {
      const x=10,width=236,cx=x+width/2,cy=y+height/2,k=width/range;
      const point=(px,pz)=>[cx+((px-site.x)*rx+(pz-site.z)*rz)*k,cy+((px-site.x)*fx+(pz-site.z)*fz)*k];
      const radius=range*Math.hypot(1,height/width)/2+10;
      const overlaps=(b)=>b.x1>site.x-radius&&b.x0<site.x+radius&&b.z1>site.z-radius&&b.z0<site.z+radius;
      ctx.save();ctx.beginPath();ctx.rect(x,y,width,height);ctx.clip();ctx.fillStyle='#cbd0c5';ctx.fillRect(x,y,width,height);
      for(const area of areas){
        if(!overlaps(area))continue;
        ctx.beginPath();area.ps.forEach(([a,b],i)=>{const[p,q]=point(a,b);i?ctx.lineTo(p,q):ctx.moveTo(p,q);});ctx.closePath();ctx.fillStyle=area.type==='park'?'#bbd6a1':'#a7d5e7';ctx.fill();
      }
      const labels=new Set(),candidates=[];
      for(const item of roads) {
        if(!overlaps(item))continue;
        const {road}=item;
        ctx.beginPath();road.pts.forEach((p,i)=>{const[a,b]=point(p.x,p.z);i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.strokeStyle='#fff';ctx.lineWidth=road.rank>2?5:3;ctx.stroke();
        const ps=road.pts.map((p)=>point(p.x,p.z)).filter(([a,b])=>a>x+12&&a<x+width-12&&b>y+18&&b<y+height-12);
        if(road.name&&!labels.has(road.name)&&ps.length){const a=ps.reduce((v,p)=>v+p[0],0)/ps.length,b=ps.reduce((v,p)=>v+p[1],0)/ps.length;candidates.push({name:road.name,a,b,rank:road.rank||0});labels.add(road.name);}
      }
      const occupied=[];
      ctx.fillStyle='#14251b';ctx.font=`bold ${height>200?14:12}px ${FONT}`;
      for(const label of candidates.sort((a,b)=>b.rank-a.rank)) {
        const w=Math.min(170,ctx.measureText(label.name).width),a=Math.max(x+4,Math.min(x+width-w-4,label.a-w/2)),b=label.b;
        if(occupied.some((r)=>a<r.a+r.w+4&&a+w+4>r.a&&Math.abs(b-r.b)<18))continue;
        if(Math.hypot(a+w/2-cx,b-cy)<30)continue;
        ctx.fillText(label.name,a,b,w);occupied.push({a,b,w});if(occupied.length>=(height>200?14:6))break;
      }
      ctx.fillStyle='#bd2732';ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#171f1b';ctx.font=`bold 12px ${FONT}`;ctx.fillText('You are here',cx-32,cy+20);
      ctx.restore();
    }
    map(178,414,500);
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(12,605);ctx.lineTo(106.4,605);ctx.stroke();
    ctx.fillStyle='#fff';ctx.font=`12px ${FONT}`;ctx.fillText('0',12,625);ctx.fillText('100',52,625);ctx.fillText('200 m',96,625);
    ctx.font=`bold 15px ${FONT}`;ctx.fillText('Wider area',12,654);map(670,176,1800);
    ctx.fillStyle='#fff';ctx.font=`12px ${FONT}`;ctx.fillText('Toronto walking map',12,876);
    // North rotates with this heads-up map; do not print a fixed north arrow.
    ctx.fillStyle='#193a30';ctx.fillRect(170,852,86,44);ctx.fillStyle='#fff';ctx.fillText('N',202,870);
    const nx=-rz,nz=-fz;ctx.beginPath();ctx.moveTo(212,880);ctx.lineTo(212+nx*10,880+nz*10);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
  }
  let last='',timer=0;
  function update(position,dt=.016) {
    timer-=dt;if(timer>0)return;timer=.5;
    const nearby=nearbyWayfinding(sites,position),key=nearby.map((s)=>s.id).join('|');
    if(key===last)return;last=key;state.active=nearby.map((s)=>s.id);state.generatedFaces=[];state.updates++;
    for(let i=0;i<SLOTS;i++) {
      const site=nearby[Math.floor(i/2)],back=i%2;
      const info=site?.type==='Info Pillar';
      if(!site||(info&&back)||(site.id==='IP-00839'&&!back)){maps.setMatrixAt(i,matrix.makeTranslation(0,-1000,0));continue;}
      state.generatedFaces.push(`${site.id}:${back?'back':'front'}`);
      drawFace(site,back,i);
      const sign=back?-1:1;
      const offset=info ? .673 : .108;
      pos.set(site.x+Math.sin(site.yaw)*offset*sign,ground(site)+(info?1.632:1.638),site.z+Math.cos(site.yaw)*offset*sign);
      quat.setFromAxisAngle(up,site.yaw+(back?Math.PI:0));scale.set(info ? .4/.44 : 1,info ? 1.816/1.764 : 1,1);matrix.compose(pos,quat,scale);maps.setMatrixAt(i,matrix);scale.set(1,1,1);
    }
    maps.instanceMatrix.needsUpdate=true;atlas.needsUpdate=true;
  }
  return {group,update};
}
Object.assign(window.CITY,{nearbyWayfinding,buildWayfindingMaps});
})();
