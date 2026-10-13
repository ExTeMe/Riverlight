import { City } from '../src/core.js';
import { createSaveStore, BACKUP_LIMIT } from '../src/storage.js';
import { SaveSession, parseCityFile } from '../src/save-session.js';
import { createBaseline, createLegacyBaseline } from '../src/baseline.js';

function check(value, message) { if (!value) throw new Error(message); }
function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), message);
}
async function rejected(operation, message) {
  let failed = false;
  try { await operation(); } catch { failed = true; }
  check(failed, message);
}

async function seed(factory, name, records) {
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cities', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('cities', 'readwrite');
      for (const record of records) tx.objectStore('cities').put(record);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function isolated(factory, records, run) {
  const name = `riverlight-check-${globalThis.crypto.randomUUID()}`;
  await seed(factory, name, records);
  let clock = 0, id = 0;
  const store = createSaveStore({ indexedDB: factory, name, now: () => ++clock,
    makeId: prefix => `${prefix}-${++id}` });
  try { await run(store, name); }
  finally {
    await store.close();
    // Every database here was created by this test invocation, never a player database.
    await new Promise((resolve, reject) => {
      const request = factory.deleteDatabase(name);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
  }
}

const current = () => new City(createBaseline().city);
const view = () => structuredClone(createBaseline().camera);
const rawRecord = (data, id = 'autosave') => ({ id, name: data.name, date: 0, data, camera: view() });

export const storageChecks = [
  {
    name: '数据库升级保留原始记录，列表只读取摘要',
    async run(factory) {
      const legacy = rawRecord(createLegacyBaseline().city);
      const malformed = { id: 'city-broken', name: '损坏记录', date: 0 };
      await isolated(factory, [legacy, malformed], async store => {
        equal(await store.load('autosave'), legacy, '升级改动了旧档原件');
        const list = await store.list();
        check(list.length === 2 && list.every(item => !('data' in item)), '列表加载了整城数据');
        check(list.find(item => item.id === malformed.id).entityCount === null, '损坏记录未安全显示');
      });
    },
  },
  {
    name: '旧档首次保存前原件不变，保存后仍有完整原始副本',
    async run(factory) {
      const original = rawRecord(createLegacyBaseline().city);
      await isolated(factory, [original], async store => {
        const session = new SaveSession(store), opened = await session.open();
        check(opened.city.terrain === 'legacy', '旧水系发生变化');
        equal(await store.load('autosave'), original, '加载迁移覆盖了原件');
        await session.persist(opened.city, opened.camera);
        const archived = (await store.list()).find(item => item.kind === 'original');
        check(archived, '未保存旧档原件');
        const raw = await store.load(archived.id);
        equal(raw.data, original.data, '原始城市被改写');
        equal(raw.camera, original.camera, '原始镜头被改写');
        await session.persist(opened.city, opened.camera);
        check((await store.list()).filter(item => item.kind === 'original').length === 1, '重复归档原件');
        equal(new City((await store.load('autosave')).data).snapshot(), opened.city.snapshot(), '迁移往返不一致');
      });
    },
  },
  {
    name: '损坏自动存档受到保护，恢复城市可保存并再次加载',
    async run(factory) {
      const original = rawRecord({ ...createBaseline().city, version: 99 });
      await isolated(factory, [original], async store => {
        const session = new SaveSession(store, { makeId: () => 'recovery-test' });
        const opened = await session.open();
        check(opened.error && session.protected, '没有进入恢复模式');
        const city = current(); await session.persist(city, view());
        equal(await store.load('autosave'), original, '恢复保存覆盖了损坏原件');
        equal(await session.originalRecord(), original, '原记录导出发生改写');
        const resumed = new SaveSession(store), recovered = await resumed.open();
        check(resumed.protected && resumed.target === 'recovery-test', '恢复存档未被续用');
        equal(recovered.city.snapshot(), city.snapshot(), '恢复城市未恢复');
        await resumed.replace(recovered.city, view(), new City(), view());
        equal(await store.load('autosave'), original, '切换城市覆盖了损坏原件');
      });
    },
  },
  {
    name: '读取暂时失败后恢复写入也不会覆盖原自动存档',
    async run(factory) {
      const original = rawRecord(current().snapshot());
      await isolated(factory, [original], async store => {
        const session = new SaveSession({ ...store, load: async () => { throw new Error('模拟读取失败'); } },
          { makeId: () => 'recovery-read-error' });
        const opened = await session.open();
        check(opened.error && session.protected, '未保护读取失败的原记录');
        await session.persist(opened.city, view());
        equal(await store.load('autosave'), original, '短暂读取失败后覆盖了原件');
      });
    },
  },
  {
    name: '切换事务中止时备份与新城市都回滚，随后可重试',
    async run(factory, ObjectStore) {
      const previous = current(), original = rawRecord(previous.snapshot());
      await isolated(factory, [original], async store => {
        const session = new SaveSession(store); const opened = await session.open();
        check(!session.protected, `有效城市未打开：${opened.error?.message}`);
        const parsed = parseCityFile(JSON.stringify(createLegacyBaseline()));
        const next = parsed.city;
        const put = ObjectStore.prototype.put;
        let intercepted = false, aborted = false;
        try {
          ObjectStore.prototype.put = function(value, ...args) {
            const request = put.call(this, value, ...args);
            if (this.name === 'cities' && value.id === 'autosave') {
              intercepted = true;
              request.onsuccess = () => { aborted = true; this.transaction.abort(); };
            }
            return request;
          };
          let failure;try{await session.replace(previous,view(),next,view(),parsed.original);}catch(error){failure=error;}
          check(intercepted&&aborted, `未触发事务中止：拦截=${intercepted}, 中止=${aborted}`);
          check(failure, '中止事务被报告成功');
        } finally { ObjectStore.prototype.put = put; }
        equal(await store.load('autosave'), original, '中止事务改写了原存档');
        check((await store.list()).length === 1, '中止事务留下了半完成备份');
        await session.replace(previous, view(), next, view(), parsed.original);
        equal((await store.load('autosave')).data, next.snapshot(), '重试失败');
        const backup = (await store.list()).find(item => item.kind === 'backup');
        equal((await store.load(backup.id)).data, previous.snapshot(), '切换前城市未备份');
        check((await store.list()).some(item => item.kind === 'original'), '重试导入未保留原件');
      });
    },
  },
  {
    name: '快速连续保存保留调用时快照和镜头，最后一次保存生效',
    async run(factory) {
      await isolated(factory, [], async store => {
        const session = new SaveSession(store), city = current(), camera = view();
        const first = city.snapshot(), firstSave = session.persist(city, camera, 'city-first');
        city.name = '最后一次'; camera.position[0] += 10;
        const second = city.snapshot(), secondSave = session.persist(city, camera);
        city.name = '尚未保存'; camera.position[0] += 10;
        await Promise.all([firstSave, secondSave]);
        equal((await store.load('city-first')).data, first, '排队存档读取了后续编辑');
        equal((await store.load('autosave')).data, second, '最后一次保存不是调用时快照');
        check((await store.load('autosave')).camera.position[0] === view().position[0] + 10, '镜头快照被改写');
      });
    },
  },
  {
    name: '滚动备份有上限，手动收藏和旧城原件不会被清理',
    async run(factory) {
      const legacy = rawRecord(createLegacyBaseline().city);
      const historical = rawRecord(createLegacyBaseline().city, 'backup-historical');
      await isolated(factory, [legacy, historical], async store => {
        const session = new SaveSession(store), opened = await session.open();
        await session.persist(opened.city, view());
        await session.persist(opened.city, view(), 'city-manual');
        let previous = opened.city;
        for (let i = 0; i < BACKUP_LIMIT + 3; i++) {
          const next = current(); next.name = `城市 ${i}`;
          await session.replace(previous, view(), next, view()); previous = next;
        }
        const list = await store.list();
        check(list.filter(item => item.kind === 'backup').length === BACKUP_LIMIT, '滚动备份超限');
        check(list.some(item => item.id === 'city-manual') && list.some(item => item.kind === 'original'), '清理删除了收藏或原件');
        equal(await store.load('backup-historical'), historical, '清理删除了历史备份');
      });
    },
  },
  {
    name: '旧格式文件导入同时保存完整原件，未知版本拒绝且不改当前城市',
    async run(factory) {
      const input = createLegacyBaseline(), previous = current();
      await isolated(factory, [rawRecord(previous.snapshot())], async store => {
        const session = new SaveSession(store), parsed = parseCityFile(JSON.stringify(input));
        await session.open();
        await session.replace(previous, view(), parsed.city, parsed.camera, parsed.original);
        const archived = (await store.list()).find(item => item.kind === 'original');
        check(archived, '导入文件未归档原件');
        const raw = await store.load(archived.id);
        equal(raw.data, input.city, '原始 v1 数据被迁移改写');
        equal(raw.input, input, '原始输入包装未保留');
        equal(raw.camera, input.camera, '原始镜头未保留');
        const reopened = parseCityFile(JSON.stringify(raw));
        equal(reopened.city.snapshot(), parsed.city.snapshot(), '导出原记录不能恢复');
        const before = await store.load('autosave');
        await rejected(() => parseCityFile(JSON.stringify({ ...input, city: { ...input.city, version: 99 } })), '接受了未来格式');
        await rejected(() => parseCityFile('null'), '接受了空数据');
        equal(await store.load('autosave'), before, '拒绝导入改写了当前城市');
      });
    },
  },
  {
    name: '隔离存档续用恢复布局、环境和镜头，默认基线仍从固定输入开始',
    async run(factory) {
      const saved = current(); saved.name = '已保存的隔离城市';
      saved.environment.season = 'winter'; saved.environment.hour = 22;
      const camera = { position: [150, 160, 170], target: [-10, 0, 20] };
      await isolated(factory, [], async store => {
        await store.write('autosave', saved, camera);
        const resumed = await new SaveSession(store).open(createBaseline(), { resume: true });
        equal(resumed.city.snapshot(), saved.snapshot(), '续用没有恢复城市或环境');
        equal(resumed.camera, camera, '续用没有恢复镜头');
        const fresh = await new SaveSession(store).open(createBaseline());
        equal(fresh.city.snapshot(), createBaseline().city, '固定基线误读了上次修改');
        equal((await store.load('autosave')).data, saved.snapshot(), '基线初始化改写隔离存档');
      });
    },
  },
  {
    name: '隔离基线入口不读取正常自动存档，固定布局与镜头可重复加载',
    async run(factory) {
      const normal = rawRecord(createLegacyBaseline().city);
      await isolated(factory, [normal], async store => {
        const session = new SaveSession(store), initial = createBaseline();
        const first = await session.open(initial), again = await session.open(createBaseline());
        equal(first.city.snapshot(), again.city.snapshot(), '基线城市不一致');
        equal(first.camera, again.camera, '基线镜头不一致');
        equal(await store.load('autosave'), normal, '基线初始化读取后覆盖正常原件');
        first.city.move(first.city.entities.values().next().value.id, -28, 3, 0);
        const reset = await session.open(createBaseline());
        equal(reset.city.snapshot(), initial.city, '基线重置受上次编辑影响');
      });
    },
  },
];
