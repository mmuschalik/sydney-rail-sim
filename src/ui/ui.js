// HUD: clock, time controls, network stats, selected-train panel, views, legend.
import { fmtTime } from '../sim/simulation.js';
import { fleet } from '../models/trains/index.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [[0, '❚❚'], [1, '1×'], [5, '5×'], [30, '30×'], [120, '2m/s'], [600, '10m/s']];
const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LINES = [['T1', 'F99D1C'], ['T2', '0098CD'], ['T3', 'F37021'], ['T4', '005AA3'], ['T5', 'C4258F'], ['T6', 'F6891F'], ['T7', '6F818E'],
  ['T8', '00954C'], ['T9', 'D11F2F'], ['M1', '168388'], ['BMT', 'F99D1C'], ['CCN', 'D11F2F'], ['SCO', '005AA3'], ['SHL', '00954C']];
const ASPECT = ['#ff3b30', '#ffc400', '#ffc400', '#30d158'];
const ASPECT_NAME = ['Stop', 'Caution', 'Medium', 'Clear'];

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    const sp = $('speed');
    for (const [v, label] of SPEEDS) {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.v = v;
      b.onclick = () => { ctx.setSpeed(v); this.refreshSpeed(); };
      sp.appendChild(b);
    }
    const now = document.createElement('button');
    now.textContent = 'Now'; now.title = 'Jump to the current time in Sydney';
    now.onclick = () => { ctx.jumpNow(); ctx.setSpeed(1); this.refreshSpeed(); };
    sp.appendChild(now);
    this.refreshSpeed();

    const vw = $('views');
    for (const [k, v] of Object.entries(ctx.views)) {
      const b = document.createElement('button');
      b.textContent = v.label;
      b.onclick = () => ctx.flyTo(v);
      vw.appendChild(b);
    }
    vw.appendChild(Object.assign(document.createElement('span'), { className: 'sep' }));
    const xr = document.createElement('button');
    xr.textContent = 'Show tunnels';
    xr.onclick = () => {
      ctx.state.xray = ctx.state.xray ? null : true;
      xr.classList.toggle('on', !!ctx.state.xray);
    };
    vw.appendChild(xr);
    const rnd = document.createElement('button');
    rnd.textContent = 'Random train';
    rnd.onclick = () => {
      const c = ctx.sim.active.filter((t) => t.state === 'run');
      if (c.length) ctx.select(c[Math.floor(Math.random() * c.length)], 'follow');
    };
    vw.appendChild(rnd);

    $('legend').innerHTML = LINES.map(([l, c]) => `<span class="badge" style="background:#${c}">${l}</span>`).join('');
    $('panel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'close') ctx.select(null);
      else ctx.select(ctx.state.selected, act);
    });
  }

  refreshSpeed() {
    const s = this.ctx.sim.paused ? 0 : this.ctx.sim.speed;
    for (const b of $('speed').querySelectorAll('button[data-v]')) b.classList.toggle('on', +b.dataset.v === s);
  }

  update() {
    const { sim, net, state } = this.ctx;
    $('clock').textContent = fmtTime(sim.time);
    const ds = sim.date;
    const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8) + (sim.time >= 86400 ? 1 : 0)));
    $('date').textContent = `${DOW[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${d.toLocaleString('en-AU', { month: 'short', timeZone: 'UTC' })} · ${sim.speed === 1 ? 'real time' : sim.speed + '× speed'}`;
    let running = 0, ontime = 0, n = 0, metro = 0;
    for (const t of sim.active) {
      if (t.state === 'pending') continue;
      n++;
      if (t.state === 'run') running++;
      if (t.trip.rt === 'M1') metro++;
      if (t.currentDelay(sim.time) < 180) ontime++;
    }
    const reds = net.signals.filter((s) => s.type === 'main' && !s.synthetic && s.aspect === 0).length;
    $('stats').innerHTML = `
      <div class="stat"><b>${n}</b><span>trains in service</span></div>
      <div class="stat"><b>${running}</b><span>moving</span></div>
      <div class="stat"><b>${metro}</b><span>metro</span></div>
      <div class="stat"><b>${n ? Math.round((100 * ontime) / n) : 100}%</b><span>on time</span></div>
      <div class="stat"><b>${reds}</b><span>signals at stop</span></div>`;
    this.panel();
  }

  panel() {
    const { sim, net, state } = this.ctx;
    const tr = state.selected;
    const el = $('panel');
    if (!tr) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const t = tr.trip;
    const spec = fleet(tr.fleetCode);
    const stName = (sid) => net.stations[net.stops[sid]?.st]?.n || '—';
    const plat = (sid) => (net.stops[sid]?.pc ? 'p' + net.stops[sid].pc : '');
    const pat = tr.pattern;
    const delay = Math.round(tr.currentDelay(sim.time));
    const speed = Math.round(tr.v * 3.6);
    const limit = Math.round(tr.trainLimit(tr.s) * 3.6);
    const sig = tr.signal;
    let next = '—', eta = '';
    if (tr.state === 'run' && tr.targetIdx >= 0) {
      const k = tr.targetIdx;
      next = pat.stops[k][0] ? `${stName(pat.stops[k][0])} ${plat(pat.stops[k][0])}` : 'leaves area';
      eta = fmtTime(tr.times(k)[0]).slice(0, 5);
    } else if (tr.state === 'dwell') {
      next = `At ${stName(pat.stops[tr.stopIdx][0])} ${plat(pat.stops[tr.stopIdx][0])}`;
      eta = 'dep ' + fmtTime(tr.times(tr.stopIdx)[1]).slice(0, 5);
    }
    const stops = [];
    for (let k = 0; k < pat.stops.length; k++) {
      const [sid] = pat.stops[k];
      if (!sid) continue;
      const [arr, dep, f] = tr.times(k);
      if (!f && k !== 0 && k !== pat.stops.length - 1) continue;
      const cls = k < (tr.state === 'dwell' ? tr.stopIdx : tr.targetIdx) ? 'past' : (k === (tr.state === 'dwell' ? tr.stopIdx : tr.targetIdx) ? 'next' : '');
      stops.push(`<div class="stop ${cls}"><span class="dot"></span><span>${stName(sid)} <small style="color:#8a9bb0">${plat(sid)}</small></span><span>${fmtTime(k === 0 ? dep : arr).slice(0, 5)}</span></div>`);
    }
    const dcls = delay > 120 ? 'late' : 'ontime';
    el.innerHTML = `
      <span class="close" data-act="close">✕</span>
      <div class="p-head"><span class="badge" style="background:#${t.c}">${t.rt}</span>${t.h}</div>
      <div class="p-sub">Run ${tr.run} · ${spec.name} (${t.f} set) · ${tr.cars} cars · ${spec.operator || ''}</div>
      <div class="panel-btns">
        <button data-act="follow" class="${state.mode === 'follow' ? 'on' : ''}">Follow</button>
        <button data-act="cab" class="${state.mode === 'cab' ? 'on' : ''}">Driver's view</button>
        <button data-act="free" class="${state.mode === 'free' ? 'on' : ''}">Free camera</button>
      </div>
      <div class="kv">
        <div><span>Speed</span><b>${speed} km/h</b></div>
        <div><span>Line speed</span><b>${limit} km/h</b></div>
        <div><span>Next</span><b>${next}</b></div>
        <div><span>Scheduled</span><b>${eta}</b></div>
        <div><span>Status</span><b class="${dcls}">${delay > 60 ? '+' + Math.round(delay / 60) + ' min late' : 'On time'}</b></div>
        <div><span>Signal ahead</span><b>${sig ? `<span class="sig" style="background:${ASPECT[sig.aspect]}"></span>${ASPECT_NAME[sig.aspect]} ${Math.round(sig.dist)} m` : '—'}</b></div>
      </div>
      <div class="stops">${stops.join('')}</div>`;
  }
}
