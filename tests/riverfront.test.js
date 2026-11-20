import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { encodeSnapshot } from '../src/autosave.js';
import { createBaseline, createLegacyBaseline, createScene } from '../src/baseline.js';
import { CITY_VERSION, RIVERFRONT_VERSION } from '../src/city-format.js';
import { City } from '../src/core.js';
import { DEFAULT_PLATFORM } from '../src/riverfront-platform.js';
import { frontageSuggestion, riverfrontEvidence, RIVERFRONT_STUDY_ID, STUDY_FRONTAGES } from '../src/riverfront-study.js';
import { parseCityFile, SaveSession } from '../src/save-session.js';
import { createSaveStore } from '../src/storage.js';
import { buildWalkNetwork } from '../src/walk-network.js';

const options = { allowRiverfront: true };
const fixture = () => createScene(RIVERFRONT_STUDY_ID);
const study = () => new City(fixture().city, options);
const proof = city => riverfrontEvidence(city, buildWalkNetwork(city));

function addFrontage(city) {
  for (const { type, ...parcel } of STUDY_FRONTAGES) {
    const angle = frontageSuggestion(city, parcel).angle;
    assert.equal(angle, 0);
    assert.ok(city.editParcel({ ...parcel, angle }, { type, color: 0, angle: 0, offsetX: 0, offsetZ: 0 }).changed);
  }
  assert.ok(city.paint('path', Array.from({ length: 11 }, (_, i) => [i - 18, -1])));
}

test('both west-bank build orders produce the same route through the real crossing and ramp', () => {
  const streetFirst = study(), platformFirst = study();
  addFrontage(streetFirst);
  assert.ok(proof(streetFirst).entries.every(entry => entry.route && !entry.platformRoute));
  assert.ok(platformFirst.editPlatform(DEFAULT_PLATFORM).changed);
  assert.ok(proof(platformFirst).platform.quayRoute.length);
  assert.ok(proof(platformFirst).entries.every(entry => !entry.built));
  assert.ok(streetFirst.editPlatform(DEFAULT_PLATFORM).changed);
  addFrontage(platformFirst);
  const city = streetFirst, graph = buildWalkNetwork(city), built = riverfrontEvidence(city, graph);
  assert.deepEqual(built, proof(platformFirst));
  assert.equal(city.roadNetwork.laneGraph.edges.size, platformFirst.roadNetwork.laneGraph.edges.size);
  const [base, top, deck] = built.platform.centerline;
  assert.deepEqual(base, [-28, .19, 6]);
  assert.equal(top[1], .61);
  const nodeId = point => point.map(value => value.toFixed(3)).join(',');
  assert.equal(graph.nodes.get(nodeId(base)).edges.get(nodeId(top)), 'ramp');
  assert.equal(graph.nodes.get(nodeId(top)).edges.get(nodeId(deck)), 'platform');
  for (const { platformRoute } of built.entries) {
    assert.deepEqual(platformRoute.slice(-3), [base, top, deck]);
    const north = platformRoute.findIndex(point => nodeId(point) === nodeId(built.crossing[0]));
    assert.deepEqual(platformRoute[north + 1], built.crossing[1]);
  }
  const originalBridge = city.roadNetwork.bridges.crossings, originalQuay = city.waterfront;
  assert.ok(city.removePlatform());
  assert.deepEqual(city.roadNetwork.bridges.crossings, originalBridge);
  assert.deepEqual(city.waterfront, originalQuay);
  assert.ok(proof(city).entries.every(entry => entry.route && !entry.platformRoute));
  assert.ok(city.undo());
  assert.deepEqual(proof(city), built);
  assert.ok(city.redo());
  assert.equal(city.snapshot().version, CITY_VERSION);
  assert.ok(city.undo());
  const market = city.parcelOwner(city.parcels.get('west-market'));
  assert.ok(city.remove(market.id));
  assert.ok(proof(city).entries[0].platformRoute);
  assert.equal(proof(city).entries[1].built, false);
  assert.ok(city.undo());
  assert.deepEqual(proof(city), built);
  assert.ok(city.remove(city.at(-8, 1).id));
  const noCrossing = proof(city);
  assert.equal(noCrossing.crossing, null);
  assert.ok(noCrossing.entries.every(entry => entry.point && !entry.route));
  assert.ok(noCrossing.platform.quayRoute.length);
  assert.ok(city.undo());
  assert.deepEqual(proof(city), built);
});

test('terrace validation rejects water, protected waterline, lost grade and overlaps in both edit directions', () => {
  const city = study(), initial = city.snapshot();
  for (const [patch, message] of [
    [{ x: 0, z: 10 }, /水域/], [{ x: -13, z: 6, width: 8, depth: 4 }, /沿岸通路/],
    [{ x: -33, z: 8 }, /全宽贴合/], [{ rise: 1.4 }, /8%/], [{ angle: 15 }, /重叠/],
  ]) {
    assert.match(city.editPlatform({ ...DEFAULT_PLATFORM, ...patch }).error, message);
    assert.deepEqual(city.snapshot(), initial);
  }
  const tree = city.place('tree', -6, 4);
  assert.ok(tree);
  assert.match(city.planPlatform(DEFAULT_PLATFORM).error, /重叠/);
  assert.ok(city.remove(tree.id));
  assert.ok(city.editPlatform(DEFAULT_PLATFORM).changed);
  const built = city.snapshot();
  assert.equal(city.place('tree', -6, 4), false);
  assert.match(city.planParcelEdit({ id: 'blocked', x: -26, z: 16, width: 6, depth: 4, angle: 0 }).error, /占用平台/);
  assert.equal(city.remove(city.at(-7, 1).id), false);
  assert.match(city.editError, /接着缓坡/);
  assert.deepEqual(city.snapshot(), built);
  const proposal = { ...DEFAULT_PLATFORM, x: -27.5, run: 6.75 };
  assert.ok(city.editPlatform(proposal).changed);
  assert.deepEqual(city.snapshot().riverfrontPlatform, proposal);
  assert.ok(city.undo());
  assert.deepEqual(city.snapshot(), built);
});

test('experimental format survives encoding, import, indexed storage and protected recovery without changing v9 saves', async () => {
  const scene = fixture(), city = study();
  addFrontage(city);
  assert.ok(city.editPlatform(DEFAULT_PLATFORM).changed);
  const snapshot = city.snapshot();
  assert.equal(snapshot.version, RIVERFRONT_VERSION);
  assert.throws(() => city.snapshot(CITY_VERSION), /无法导出/);
  assert.throws(() => new City(snapshot), /不受支持/);
  const serialized = JSON.stringify({ city: snapshot, camera: scene.camera });
  assert.throws(() => parseCityFile(serialized), /不受支持/);
  assert.deepEqual(proof(parseCityFile(serialized, options).city), proof(city));
  const parts = await encodeSnapshot(city, () => true, { batchSize: 2, sliceBudget: 0, yieldTurn: async () => {} });
  assert.deepEqual(JSON.parse(await new Blob(parts).text()), snapshot);

  const bad = { ...snapshot, riverfrontPlatform: { ...DEFAULT_PLATFORM, x: -33, z: 8 } };
  assert.throws(() => city.restore(bad), /全宽贴合/);
  assert.throws(() => city.restore({ ...snapshot, version: 9 }), /平台记录/);
  assert.throws(() => city.restore({ ...snapshot, version: 11 }), /不受支持/);
  assert.deepEqual(city.snapshot(), snapshot);

  const indexedDB = new IDBFactory();
  const ordinary = createSaveStore({ indexedDB });
  const store = createSaveStore({ indexedDB, name: 'riverfront-test', ...options });
  try {
    const normal = new City(createScene('T04').city).snapshot();
    for (const fixture of [createLegacyBaseline(), createBaseline(), { city: normal }]) {
      const loaded = parseCityFile(JSON.stringify(fixture), options).city.snapshot();
      assert.equal(loaded.version, CITY_VERSION);
      assert.equal(Object.hasOwn(loaded, 'riverfrontPlatform'), false);
      assert.deepEqual(loaded, parseCityFile(JSON.stringify(fixture)).city.snapshot());
    }
    await ordinary.write('autosave', normal, scene.camera);
    const session = new SaveSession(store, options);
    await session.persistEncoded(parts, scene.camera, async (id, chunks, camera) =>
      store.write(id, JSON.parse(await new Blob(chunks).text()), camera));
    const loaded = await new SaveSession(store, options).open(scene, { resume: true });
    assert.deepEqual(loaded.city.snapshot(), snapshot);
    await session.replace(city, scene.camera, study(), scene.camera);
    const backup = (await store.list()).find(record => record.kind === 'backup');
    assert.deepEqual((await store.load(backup.id)).data, snapshot);
    await store.write('autosave', bad, scene.camera);
    const recovery = new SaveSession(store, options), reopened = await recovery.open(scene, { resume: true });
    assert.ok(reopened.error);
    await recovery.persist(reopened.city, scene.camera);
    assert.deepEqual((await recovery.originalRecord()).data, bad);
    assert.deepEqual((await store.load('autosave')).data, bad);
    assert.deepEqual((await ordinary.load('autosave')).data, normal);
  } finally {
    await Promise.all([ordinary.close(), store.close()]);
  }
});
