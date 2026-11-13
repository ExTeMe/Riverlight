import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock, SIMULATION_STEP } from '../src/simulation-clock.js';
import { City } from '../src/core.js';
import { advanceVessel, launchVessel, navigationRoutes, navigationTrack, routeAt } from '../src/navigation.js';

test('the same sailing route advances identically at 15, 30 and 144 render frames per second',()=>{
  const city=new City();
  const track=navigationTrack(city.worldBounds(),city.terrain);
  const routes=navigationRoutes(track,[]);
  function run(fps){
    const clock=new SimulationClock(),vessel=launchVessel(track,routes);
    for(let i=0;i<12*fps;i++){
      clock.advance(1/fps,step=>advanceVessel(vessel,track,routeAt(routes,vessel.distance),step));
    }
    assert.equal(clock.time,12);
    return vessel;
  }
  assert.deepEqual(run(15),run(30));
  assert.deepEqual(run(144),run(30));
});

test('pause keeps the partial step, resumes without a burst, and stalls have bounded catch-up',()=>{
  const clock=new SimulationClock(),steps=[];
  const step=(dt,time)=>steps.push([dt,time]);
  clock.advance(SIMULATION_STEP/2,step);
  clock.paused=true;
  clock.advance(90,step);
  assert.deepEqual(steps,[]);
  clock.paused=false;
  clock.advance(SIMULATION_STEP/2,step);
  assert.deepEqual(steps,[[SIMULATION_STEP,SIMULATION_STEP]]);
  clock.advance(90,step);
  assert.equal(clock.ticks,8);
  clock.reset();
  assert.equal(clock.time,0);
  clock.advance(SIMULATION_STEP/2,step);
  assert.equal(clock.ticks,0);
});
