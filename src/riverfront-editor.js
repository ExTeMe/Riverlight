import { normalAngle } from './parcel.js';
import { DEFAULT_PLATFORM } from './riverfront-platform.js';

const fields = {
  x: '缓坡底端 X', z: '缓坡底端 Z', width: '台面宽度（米）', depth: '台面进深（米）',
  angle: '朝向（度）', run: '缓坡长度（米）', rise: '台面升高（米）', rampWidth: '缓坡净宽（米）',
};
const snap = value => Math.round(value * 4) / 4;

export class RiverfrontEditor {
  constructor(app, form) {
    this.app = app;
    this.form = form;
    form.innerHTML = `
      <h3>滨水平台</h3><p class="parcel-instructions">点击调整缓坡底端，或从底端拖向台面调整朝向与坡长。底端应贴住一块小径的边缘。</p>
      <div class="parcel-scroll"><fieldset><legend>台面与缓坡</legend><div class="parcel-fields">
        ${Object.entries(fields).map(([key, label]) => `<label>${label}<input type="number" name="${key}" step="any" required></label>`).join('')}
      </div></fieldset></div>
      <p class="parcel-feedback" aria-live="polite"></p>
      <div class="parcel-actions"><button type="button" data-action="cancel-platform">取消</button><button type="submit" class="primary">应用平台</button></div>`;
    form.addEventListener('input', () => this.render());
    form.addEventListener('focusin', () => app.keys.clear());
    form.addEventListener('submit', event => { event.preventDefault(); this.apply(); });
  }
  get active() { return !this.form.hidden; }
  field(name) { return this.form.elements.namedItem(name); }
  open() {
    const record = this.app.city.platform?.record ?? DEFAULT_PLATFORM;
    for (const key of Object.keys(fields)) this.field(key).value = record[key];
    this.form.hidden = false;
    this.render();
  }
  close() { this.form.hidden = true; this.start = null; this.app.world.showStudyDraft([]); }
  rotate() {
    const angle = this.field('angle');
    angle.value = normalAngle((angle.valueAsNumber || 0) + 15);
    this.render();
  }
  draft() {
    return { id: DEFAULT_PLATFORM.id, ...Object.fromEntries(Object.keys(fields).map(key => [key, this.field(key).valueAsNumber])) };
  }
  draw(x, z, drag) {
    const [ox, oz] = drag ? this.start : [x, z];
    this.field('x').value = snap(ox);
    this.field('z').value = snap(oz);
    if (drag) {
      const dx = snap(x) - snap(ox), dz = snap(z) - snap(oz);
      if (Math.hypot(dx, dz) >= 2) {
        this.field('angle').value = normalAngle(Math.round(Math.atan2(dx, dz) * 180 / Math.PI));
        this.field('run').value = snap(Math.hypot(dx, dz));
      }
    }
    this.render();
  }
  render() {
    const plan = this.app.city.planPlatform(this.draft());
    const lines = plan.geometry?.surfaces.flatMap(({ points }) => points.flatMap(([x, y, z], i) => {
      const [u, v, w] = points[(i + 1) % points.length];
      return [x, y + .045, z, u, v + .045, w];
    })) ?? [];
    this.app.world.showStudyDraft(lines, !!plan.error);
    const feedback = this.form.querySelector('.parcel-feedback');
    feedback.classList.toggle('invalid', !!plan.error);
    this.form.querySelector('[type=submit]').disabled = !!plan.error;
    if (plan.error) { feedback.textContent = plan.error; return; }
    const [base, top] = plan.geometry.centerline;
    feedback.textContent = `接地 ${base[1].toFixed(2)} 米 · 台面 ${top[1].toFixed(2)} 米 · 坡度 ${(plan.record.rise / plan.record.run * 100).toFixed(1)}%`;
  }
  apply() {
    if (this.app.replacing || this.app.navigating) return;
    const result = this.app.city.editPlatform(this.draft());
    if (result.error) { this.app.ui.toast(result.error, true); return; }
    this.app.cancel();
    if (result.changed) this.app.changed();
  }
}
