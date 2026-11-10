import { Scene, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { createScene } from '../src/baseline.js';
import { BY_ID, CELL } from '../src/catalog.js';
import { City, riverCenter, riverWidth } from '../src/core.js';
import { World } from '../src/world.js';

const dt = 1 / 60;
const duration = 60;

function observe(id) {
  const baseline = createScene(id);
  const city = new City(baseline.city);
  const focus = new Vector3(...baseline.cameras.near.target);
  // Seed only this standalone replay. The browser still runs the normal simulation.
  let randomState = baseline.seed;
  const originalRandom = Math.random;
  Math.random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  try {
    const { traffic } = new World(new Scene(), city);
    const { cars, people } = traffic;
    // The lower body boxes in vehicle() exclude mirrors, lights and visual padding.
    const bodies = cars.map(car => new OBB(
      new Vector3(0, .65, 0), new Vector3(.64, .26, car.kind === 3 ? 1.9 : 1.2),
    ));
    const overlaps = [];
    const pedestrianSamples = { water: 0, buildingLot: 0, stepOverSpeed: 0 };
    for (let frame = 1; frame <= duration * 60; frame++) {
      const previous = people.walkers.map(({ x, z }) => [x, z]);
      const time = frame * dt;
      traffic.update(dt, time, focus);
      const boxes = cars.map(({ mesh }, index) => {
        mesh.updateMatrix();
        return bodies[index].clone().applyMatrix4(mesh.matrix);
      });
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) {
          if (!boxes[a].intersectsOBB(boxes[b])) continue;
          overlaps.push({ frame, time, cars: [a, b].map(index => {
            const { mesh, from, to } = cars[index];
            return { index, position: mesh.position.toArray(), from: [from.x, from.z], to: [to.x, to.z] };
          }) });
        }
      }
      people.walkers.forEach(({ x, z, speed }, index) => {
        const entity = city.at(Math.floor((x / CELL + .5) * 2) / 2, Math.floor((z / CELL + .5) * 2) / 2);
        if (BY_ID[entity?.type]?.floors) pedestrianSamples.buildingLot++;
        if (Math.abs(x - riverCenter(z, city.terrain)) < riverWidth(z, city.terrain) - .15 &&
            !['bridge', 'pier'].includes(entity?.type)) pedestrianSamples.water++;
        if (Math.hypot(x - previous[index][0], z - previous[index][1]) > speed * dt + 1e-6) {
          pedestrianSamples.stepOverSpeed++;
        }
      });
    }
    return { scene: id, sceneVersion: baseline.sceneVersion, seed: baseline.seed, dt, duration,
      vehicles: cars.length, pedestrians: people.walkers.length, overlaps, pedestrianSamples };
  } finally {
    Math.random = originalRandom;
  }
}

console.log(JSON.stringify(['T03', 'T05'].map(observe), null, 2));
