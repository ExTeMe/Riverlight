import { test, expect } from '@playwright/test';
import { createScene } from '../../src/baseline.js';
import { City } from '../../src/core.js';
import { sampleLane } from '../../src/vehicle-routes.js';

test.use({viewport:{width:1280,height:800},deviceScaleFactor:.65});

for(const [scene,view] of [['T02','线形'],['T03','近景'],['T04','近景']]){
  test(`${scene} automatic traffic drives along the visible road`,async({page},info)=>{
    test.setTimeout(90000);
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // Advance a controlled clock in real rendered frames, regardless of GPU speed.
    await page.addInitScript(()=>{
      const request=window.requestAnimationFrame.bind(window);
      let now;
      window.requestAnimationFrame=callback=>request(frame=>{
        now=now===undefined?frame:now+240;
        callback(now);
      });
    });
    await page.goto(`/?scene=${scene}`);
    await expect(page.locator('#loading')).toHaveCount(0,{timeout:60000});
    await page.getByRole('button',{name:view,exact:true}).click();
    if(scene==='T04')await page.getByRole('button',{name:'白天',exact:true}).click();
    const read=()=>page.evaluate(()=>window.riverlight.getVehicles());
    const network=new City(createScene(scene).city).roadNetwork;
    const {laneGraph,segments,bridges}=network;
    const initial=await read();
    const inView=car=>car.visible&&(scene==='T02'?segments.get(car.roadId).geometry:
      scene==='T03'?['left','right','straight'].includes(car.kind):
      bridges.grades.has(car.roadId)&&car.point[1]>1);
    if(scene==='T03'){
      let waiting;
      await expect.poll(async()=>{
        waiting=(await read()).active.find(car=>car.visible&&car.waitingAt);
        return !!waiting;
      },{timeout:35000,intervals:[70,100,150]}).toBe(true);
      expect(waiting.speed).toBe(0);
      const junction=segments.get(waiting.waitingAt);
      const [x,,z]=waiting.point,[cx,,cz]=junction.center;
      const clearance=Math.max(Math.abs(x-cx),Math.abs(z-cz))-(waiting.type==='bus'?1.98:1.28);
      expect(clearance).toBeCloseTo(junction.junction.crossings[0].stopDistance+.1,5);
      await page.screenshot({path:info.outputPath('T03-stop-line.png')});
    }
    await expect.poll(async()=>(await read()).active.some(inView),{timeout:40000,intervals:[70,100,150]}).toBe(true);
    const moving=(await read()).active;
    for(const car of moving){
      const edge=laneGraph.edges.get(car.edge);
      expect(edge.vehicles).toContain(car.type);
      expect(car.point).toEqual(sampleLane(edge,car.distance).point);
    }
    await page.screenshot({path:info.outputPath(`${scene}-vehicle-routes.png`)});
    await expect.poll(async()=>{
      const status=await read();
      return status.arrived>initial.arrived&&status.active.some(car=>!initial.active.some(a=>a.id===car.id));
    },{timeout:45000}).toBe(true);
    expect(errors).toEqual([]);
  });
}
