// Shift view (Today / Tomorrow). Keep this file small and dependency-free — it
// has to run under the service-worker-backed offline mode too, so no globals
// beyond fetch, localStorage, IndexedDB (added in a later step), and plain DOM.

(function () {
  const VIEW = window.__SHIFT_VIEW__; // 'today' | 'tomorrow'
  const DATE = window.__SHIFT_DATE__; // 'YYYY-MM-DD'
  const INITIALS_KEY = 'hygd.initials';

  const PRIMARY_KIND = VIEW === 'tomorrow' ? 'setup' : 'checkin';
  const SECONDARY_KIND = VIEW === 'tomorrow' ? null : 'setup';

  // ── Identity (initials) ────────────────────────────────────────────────────
  function getInitials() {
    return (localStorage.getItem(INITIALS_KEY) || '').trim();
  }
  function setInitials(v) {
    localStorage.setItem(INITIALS_KEY, (v || '').trim().toUpperCase().slice(0, 4));
    renderIdentity();
  }
  function renderIdentity() {
    const el = document.getElementById('whoami');
    if (el) el.textContent = getInitials() || '— tap to set';
  }
  window.changeInitials = function () {
    const v = prompt('Your initials (up to 4 letters):', getInitials());
    if (v !== null) setInitials(v);
  };

  // ── Event rendering ────────────────────────────────────────────────────────
  // Tick model: a tick is { event_id, item_index, kind, initials, ticked_at }.
  // We lookup by (event, item, kind). item_index = -1 is the whole-event tick,
  // used when the checklist is empty.
  function tickFor(event, itemIndex, kind) {
    return (event.ticks || []).find(t =>
      t.item_index === itemIndex && t.kind === kind);
  }

  function renderEvent(ev) {
    const items = ev.setup_items || [];
    const hasItems = items.length > 0;
    const container = document.createElement('div');
    container.className = 'ev';
    container.dataset.eventId = ev.id;

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `
      <div>
        <span class="room">${escape(ev.room || '')}</span>
        <span class="time ms-2">${escape(ev.start_time || '')}–${escape(ev.end_time || '')}</span>
      </div>
      <div class="meta">#${escape(ev.event_number || '')}</div>
    `;
    container.appendChild(head);

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = ev.event_name || ev.service_type || '';
    container.appendChild(title);

    if (ev.mecs_contact || ev.onsite_contact) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = [
        ev.onsite_contact ? 'Onsite: ' + ev.onsite_contact : null,
        ev.mecs_contact ? 'MECS: ' + ev.mecs_contact : null,
      ].filter(Boolean).join(' · ');
      container.appendChild(meta);
    }

    const itemsEl = document.createElement('div');
    itemsEl.className = 'items';

    if (!hasItems) {
      // Whole-event tick row (-1) only — no checklist on this event.
      itemsEl.appendChild(renderItemRow(ev, -1, 'Whole event'));
    } else {
      items.forEach((it, idx) => {
        itemsEl.appendChild(renderItemRow(ev, idx, it.item || '', it.qty || ''));
      });
    }

    container.appendChild(itemsEl);
    maybeMarkAllDone(container, ev);
    return container;
  }

  function renderItemRow(ev, itemIndex, label, qty) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <span class="qty">${escape(qty || '')}</span>
      <span class="label">${escape(label)}</span>
    `;
    const btnPrimary = makeTickBtn(ev, itemIndex, PRIMARY_KIND);
    row.appendChild(btnPrimary);
    if (SECONDARY_KIND) {
      const btnSecondary = makeTickBtn(ev, itemIndex, SECONDARY_KIND);
      row.appendChild(btnSecondary);
    }
    return row;
  }

  function makeTickBtn(ev, itemIndex, kind) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tick-btn ' + (kind === 'checkin' ? 'checkin' : 'setup');
    btn.dataset.itemIndex = itemIndex;
    btn.dataset.kind = kind;
    paintBtn(btn, ev, itemIndex, kind);
    btn.addEventListener('click', () => onTickTap(btn, ev, itemIndex, kind));
    return btn;
  }

  function paintBtn(btn, ev, itemIndex, kind) {
    const t = tickFor(ev, itemIndex, kind);
    const label = kind === 'setup' ? 'Setup' : 'Check-in';
    if (t) {
      btn.classList.add('on');
      const when = fmtLocalHM(t.ticked_at);
      const pill = escape(t.initials || '•') + (when ? ' ' + when : '');
      btn.innerHTML = `${label} <span class="initials-pill">${pill}</span>`;
      btn.title = `${label} by ${t.initials || '—'} at ${when || t.ticked_at || ''}`;
    } else {
      btn.classList.remove('on');
      btn.textContent = label;
      btn.title = '';
    }
  }

  // Server stores ticked_at as UTC "YYYY-MM-DD HH:MM:SS". Show it in the
  // viewer's local time as HH:MM so the pill stays short.
  function fmtLocalHM(utcStr) {
    if (!utcStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(utcStr);
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5]));
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function onTickTap(btn, ev, itemIndex, kind) {
    let initials = getInitials();
    if (!initials) {
      const v = prompt('Your initials (up to 4 letters):', '');
      if (!v) return;
      setInitials(v);
      initials = getInitials();
      if (!initials) return;
    }
    const existing = tickFor(ev, itemIndex, kind);
    if (existing) {
      // Second tap = untick (only the original initials or no restriction? MVP: anyone).
      ev.ticks = (ev.ticks || []).filter(t =>
        !(t.item_index === itemIndex && t.kind === kind));
      paintBtn(btn, ev, itemIndex, kind);
      maybeMarkAllDone(btn.closest('.ev'), ev);
      enqueueClear(ev.id, itemIndex, kind);
    } else {
      const tick = {
        item_index: itemIndex, kind: kind,
        initials: initials, ticked_at: nowIso(),
      };
      ev.ticks = (ev.ticks || []).concat([tick]);
      paintBtn(btn, ev, itemIndex, kind);
      maybeMarkAllDone(btn.closest('.ev'), ev);
      enqueueSet(ev.id, itemIndex, kind, initials, tick.ticked_at);
    }
    updateBanner();
  }

  function nowIso() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }

  function maybeMarkAllDone(card, ev) {
    if (!card) return;
    const items = ev.setup_items || [];
    const n = items.length || 1;
    let done = 0;
    for (let i = (items.length ? 0 : -1); i < (items.length || 0); i++) {
      if (tickFor(ev, items.length ? i : -1, PRIMARY_KIND)) done++;
      if (!items.length) break;
    }
    card.classList.toggle('all-done', done === n);
  }

  // ── Missing-primary banner ─────────────────────────────────────────────────
  function updateBanner() {
    const banner = document.getElementById('banner');
    if (!banner) return;
    const kindLabel = PRIMARY_KIND === 'setup' ? 'setups' : 'check-ins';
    let missing = 0;
    state.events.forEach(ev => {
      const items = ev.setup_items || [];
      if (items.length) {
        for (let i = 0; i < items.length; i++) {
          if (!tickFor(ev, i, PRIMARY_KIND)) { missing++; break; }
        }
      } else {
        if (!tickFor(ev, -1, PRIMARY_KIND)) missing++;
      }
    });
    if (missing === 0 && state.events.length > 0) {
      banner.className = 'missing-banner ok';
      banner.textContent = `All ${kindLabel} done.`;
      banner.style.display = '';
    } else if (missing > 0) {
      banner.className = 'missing-banner';
      banner.textContent = `${missing} event${missing===1?'':'s'} still need ${kindLabel.replace(/s$/,'')}${missing===1?'':'s'}.`;
      banner.style.display = '';
    } else {
      banner.style.display = 'none';
    }
  }

  // ── Outbox (Phase 5 will replay on reconnect; for now a thin wrapper) ──────
  function enqueueSet(eventId, itemIndex, kind, initials, ticked_at) {
    const body = { item_index: itemIndex, kind, initials, ticked_at };
    outboxPush({ method: 'POST', url: `/api/events/${eventId}/tick`, body });
  }
  function enqueueClear(eventId, itemIndex, kind) {
    outboxPush({
      method: 'DELETE',
      url: `/api/events/${eventId}/tick?kind=${encodeURIComponent(kind)}&item_index=${itemIndex}`,
    });
  }

  function outboxPush(req) {
    state.outbox.push(req);
    saveOutbox();
    flushOutbox();
  }
  function saveOutbox() {
    try { localStorage.setItem('hygd.outbox', JSON.stringify(state.outbox)); } catch (_) {}
  }
  function loadOutbox() {
    try { return JSON.parse(localStorage.getItem('hygd.outbox') || '[]'); } catch (_) { return []; }
  }

  let flushing = false;
  async function flushOutbox() {
    if (flushing) return;
    flushing = true;
    try {
      while (state.outbox.length) {
        const req = state.outbox[0];
        try {
          const init = { method: req.method, headers: { 'Content-Type': 'application/json' } };
          if (req.body) init.body = JSON.stringify(req.body);
          const r = await fetch(req.url, init);
          if (!r.ok) throw new Error('http ' + r.status);
          state.outbox.shift();
          saveOutbox();
        } catch (e) {
          // Network out or server unreachable — stop, retry later.
          break;
        }
      }
    } finally {
      flushing = false;
      updateOfflineBar();
    }
  }

  function updateOfflineBar() {
    const bar = document.getElementById('offline-bar');
    if (!bar) return;
    const offline = !navigator.onLine;
    const pending = state.outbox.length;
    if (offline) {
      bar.className = 'offline offline-mode';
      bar.textContent = `Offline — ${pending} change${pending===1?'':'s'} will sync when reconnected.`;
    } else if (pending) {
      bar.className = 'offline pending';
      bar.textContent = `Syncing ${pending} change${pending===1?'':'s'}…`;
    } else {
      bar.className = 'offline hidden';
    }
  }

  window.addEventListener('online', () => { flushOutbox(); updateOfflineBar(); });
  window.addEventListener('offline', updateOfflineBar);

  // ── Boot ───────────────────────────────────────────────────────────────────
  const state = { events: [], outbox: loadOutbox() };

  function escape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nextDay(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function fetchDay() {
    return fetch(`/api/events?start=${DATE}&end=${nextDay(DATE)}`)
      .then(r => r.json())
      .then(raw => raw.map(fc => Object.assign(
        { id: parseInt(fc.id, 10) }, fc.extendedProps || {},
        { start_time: fc.start ? fc.start.slice(11, 16) : '',
          end_time:   fc.end   ? fc.end.slice(11, 16)   : '',
          service_type: fc.extendedProps && fc.extendedProps.service_type || '',
          setup_items:  fc.extendedProps && fc.extendedProps.setup_items || [],
          event_name: (fc.title || '').split(' – ')[0] || fc.title || '',
        }
      )));
  }

  async function loadDay() {
    state.events = await fetchDay();
    const host = document.getElementById('events');
    host.innerHTML = '';
    if (state.events.length === 0) {
      host.innerHTML = '<div class="missing-banner ok" style="margin:16px">Nothing to prep.</div>';
    } else {
      state.events.forEach(ev => host.appendChild(renderEvent(ev)));
    }
    updateBanner();
    flushOutbox();
  }

  // Poll every 20s so another tech's ticks appear here without a manual reload.
  // We re-paint only the tick buttons, not the whole card, so scroll position
  // and any half-typed initials prompt are preserved. The local outbox wins on
  // conflict: if a tick we just queued hasn't reached the server yet, we don't
  // let the stale server copy wipe it from the UI.
  async function pollAndMerge() {
    if (!navigator.onLine) return;
    let fresh;
    try { fresh = await fetchDay(); } catch (_) { return; }
    const byId = {};
    fresh.forEach(e => { byId[e.id] = e; });
    state.events.forEach(ev => {
      const f = byId[ev.id];
      if (!f) return;
      const pending = pendingTicksFor(ev.id);
      ev.ticks = mergeTicks(f.ticks || [], pending);
      repaintEventTicks(ev);
    });
    updateBanner();
  }

  // Pull ticks for one event from the outbox so pending POSTs don't get
  // overwritten by a server copy that hasn't seen them yet.
  function pendingTicksFor(eventId) {
    const out = { sets: [], clears: [] };
    const postPrefix = `/api/events/${eventId}/tick`;
    const delPrefix  = `/api/events/${eventId}/tick?`;
    state.outbox.forEach(req => {
      if (req.method === 'POST' && req.url === postPrefix && req.body) {
        out.sets.push(req.body);
      } else if (req.method === 'DELETE' && req.url.startsWith(delPrefix)) {
        const params = new URLSearchParams(req.url.split('?')[1] || '');
        out.clears.push({
          item_index: parseInt(params.get('item_index'), 10),
          kind:       params.get('kind'),
        });
      }
    });
    return out;
  }

  function mergeTicks(serverTicks, pending) {
    const result = serverTicks.slice();
    pending.clears.forEach(c => {
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].item_index === c.item_index && result[i].kind === c.kind) {
          result.splice(i, 1);
        }
      }
    });
    pending.sets.forEach(s => {
      const idx = result.findIndex(t => t.item_index === s.item_index && t.kind === s.kind);
      if (idx >= 0) result[idx] = s; else result.push(s);
    });
    return result;
  }

  function repaintEventTicks(ev) {
    const card = document.querySelector(`.ev[data-event-id="${ev.id}"]`);
    if (!card) return;
    const btns = card.querySelectorAll('.tick-btn');
    btns.forEach(btn => {
      const idx = parseInt(btn.dataset.itemIndex, 10);
      const kind = btn.dataset.kind;
      paintBtn(btn, ev, idx, kind);
    });
    maybeMarkAllDone(card, ev);
  }

  renderIdentity();
  updateOfflineBar();
  loadDay();
  setInterval(pollAndMerge, 20000);
  // Also refresh on tab focus — most "I just opened the app" cases.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollAndMerge();
  });
})();
