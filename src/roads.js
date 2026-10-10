import * as T from 'three';

// A connected corner is an annular road, with tangent joins at the tile edges.
export function createRoad(type,mask,{Builder,material}){
  const b=new Builder(),bridge=type==='bridge',path=type==='path',y=bridge?.45:.04;
  const asphalt=material('#677378','road'),paving=material('#c9c9bd','ground'),paint=material('#e8dfbc','road');
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]],connected=dirs.filter((_,i)=>mask&(1<<i));
  const corner=connected.length===2&&connected[0][0]!==-connected[1][0]&&connected[0][1]!==-connected[1][1];
  const strip=(sx,sz,inner,outer,height,m,start=0,end=Math.PI/2)=>{
    const p=[],n=24;
    for(let i=0;i<n;i++){
      const a=start+(end-start)*i/n,c=start+(end-start)*(i+1)/n;
      const v=(r,t)=>[sx*(2-r*Math.sin(t)),height,sz*(2-r*Math.cos(t))];
      const vs=[...v(inner,a),...v(outer,a),...v(outer,c),...v(inner,a),...v(outer,c),...v(inner,c)];
      // Keep upward winding on every mirrored corner.
      if(sx*sz<0)for(let j=0;j<vs.length;j+=9){const first=vs.slice(j,j+3);vs.splice(j,3,...vs.slice(j+6,j+9));vs.splice(j+6,3,...first);}
      p.push(...vs);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.computeVertexNormals();b.geo(g,m);
  };
  if(corner&&!bridge&&!path){
    const sx=connected.find(d=>d[0])[0],sz=connected.find(d=>d[1])[1];
    strip(sx,sz,.08,3.92,y+.04,paving);strip(sx,sz,.52,3.48,y+.065,asphalt);
    for(let i=0;i<3;i++)strip(sx,sz,1.97,2.03,y+.07,paint,.14+i*.46,.35+i*.46);
    const result=b.finish();result.userData.roadShape='arc';return result;
  }
  b.box(4,.14,4,0,y-.07,0,path?material('#cbc1a6','ground'):paving);
  if(!path){
    b.box(2.96,.02,2.96,0,y+.02,0,asphalt);
    connected.forEach(([dx,dz])=>b.box(dx?.55:2.96,.02,dz?.55:2.96,dx*1.73,y+.02,dz*1.73,asphalt));
    if(mask===3||mask===12||mask===0)b.box(mask===12?.055:1.25,.01,mask===12?1.25:.055,0,y+.035,0,paint);
    if(connected.length!==2)for(const [dx,dz] of connected)for(let i=0;i<5;i++)b.box(dx?.48:.22,.008,dz?.48:.22,dx?dx*1.72:-.9+i*.45,y+.036,dz?dz*1.72:-.9+i*.45,paint);
    if(bridge){const horizontal=mask!==12;for(const side of [-1,1]){
      b.box(horizontal?4:.12,.12,horizontal?.12:4,horizontal?0:side*1.8,y+1,horizontal?side*1.8:0,paving);
      for(const p of [-1.6,0,1.6])b.box(.09,.85,.09,horizontal?p:side*1.8,y+.5,horizontal?side*1.8:p,paving);
    }b.box(.6,1.9,.6,0,-.55,0,paving);}
  }
  return b.finish();
}
