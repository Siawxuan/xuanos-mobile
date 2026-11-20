const $ = id => document.getElementById(id);
const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const modules = {
  clock: { name: 'Clock', icon: 'clock', caption: 'Local time and date' },
  notifications: { name: 'Notification Center', panel: 'Notifications', icon: 'alert', caption: 'Sample messages' },
  spatial: { name: 'Spatial Workspace', icon: 'spatial', caption: 'Floating windows' },
  ai: { name: 'AI Core', icon: 'ai', caption: 'Integration pending' },
  settings: { name: 'Settings', icon: 'settings', caption: 'Motion and workspace' },
  status: { name: 'System Status', icon: 'status', caption: 'Browser diagnostics' }
};
const windowOrder = ['clock', 'notifications', 'status', 'ai'];
const arranged = { x: null, y: null, scale: 1 };
const sampleNotes = [
  { id: 'welcome', title: 'Welcome to Spatial Edition', text: 'Open the workspace to arrange your floating panels.' },
  { id: 'gesture', title: 'Workspace controls', text: 'Hold a panel title to drag it, or use two fingers on the title to resize.' }
];
const preferences = { motion: true, effects: 75, glass: 45, depth: 65, sensitivity: 55, mode: 'home' };
const sliders = { effects: 'Effects intensity', glass: 'Glass transparency', depth: 'Depth intensity', sensitivity: 'Motion sensitivity' };
const storageKey = 'xuanos-mobile-v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { /* Storage is optional. */ }
if (typeof saved.preferences?.motion === 'boolean') preferences.motion = saved.preferences.motion;
for (const key of Object.keys(sliders)) {
  if (Number.isFinite(saved.preferences?.[key])) preferences[key] = Math.max(0, Math.min(100, saved.preferences[key]));
}
if (saved.preferences?.mode === 'spatial') preferences.mode = 'spatial';
const noteStates = Object.fromEntries(sampleNotes.map(({ id }) => [id, saved.notes?.[id]]));
const panels = {};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const standalone = matchMedia('(display-mode: standalone)');
const stage = $('stage');
const main = document.querySelector('main');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
let route = null;
let returnRoute = preferences.mode;
let activePanel = null;
let expandedPanel = null;
let stageGeometry;
let topLayer = 0;
let introTimer;
let workerError = false;
let offlineReady = false;

function persist() {
  try {
    const positions = Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, panel.state]));
    localStorage.setItem(storageKey, JSON.stringify({ layoutVersion: 2, preferences, notes: noteStates, panels: positions }));
  } catch { /* Changes still apply for this session. */ }
}

function applyPreferences() {
  document.body.dataset.motion = preferences.motion ? 'on' : 'off';
  const style = document.documentElement.style;
  style.setProperty('--fx', preferences.effects / 100);
  style.setProperty('--blur', (preferences.effects * .18) + 'px');
  style.setProperty('--glass-alpha', 1 - preferences.glass * .0024);
  style.setProperty('--depth', preferences.depth / 100);
  style.setProperty('--orbit-distance', (preferences.sensitivity * .12) + 'px');
  stage.style.removeProperty('--parallax');
}

const fullClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const shortClock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
function updateTime() {
  const now = new Date();
  const parts = shortClock.formatToParts(now);
  $('home-clock').textContent = parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim();
  $('home-clock').dateTime = now.toISOString();
  $('home-period').textContent = parts.find(part => part.type === 'dayPeriod')?.value ?? '';
  $('home-date').textContent = shortDate.format(now);
  if (route === 'clock' || route === 'spatial') {
    const container = route === 'clock' ? $('detail-content') : panels.clock.content;
    const readout = container.querySelector('.readout');
    readout.textContent = fullClock.format(now);
    readout.dateTime = now.toISOString();
    container.querySelector('[data-date]').textContent = fullDate.format(now);
  }
}

function settingsMarkup() {
  return `<div class="settings-status"><span>Current mode<strong>${preferences.mode === 'spatial' ? 'Spatial Workspace' : 'Home'}</strong></span>
    <span>Display mode<strong data-display></strong></span><span>Offline shell<strong data-offline></strong></span></div>
    <div class="settings-form">
    <h2>Motion and glass</h2>
    <label><span>Animations</span><input id="motion" type="checkbox" ${preferences.motion ? 'checked' : ''}></label>
    ${Object.entries(sliders).map(([key, label]) => `<label><span>${label} <output id="${key}-value" for="${key}">${preferences[key]}%</output></span><input id="${key}" type="range" min="0" max="100" step="5" value="${preferences[key]}"></label>`).join('')}
    <h2>Workspace</h2>
    <div class="actions"><button class="quiet" data-route="home">Switch to Home</button><button class="quiet" data-route="spatial">Switch to Spatial</button></div>
    <div class="actions"><button class="quiet" data-action="reset">Reset Workspace</button><button class="quiet" data-action="replay">Replay Startup</button></div>
  </div>`;
}

function notificationMarkup() {
  const notes = sampleNotes.filter(note => noteStates[note.id] !== 'dismissed');
  return '<p class="subtle">Sample data stored on this device.</p><div class="notes">' +
    (notes.length ? notes.map(note => {
      const read = noteStates[note.id] === 'read';
      return `<div class="note" ${read ? 'data-read' : ''}><strong>${note.title}</strong>
        <p>${note.text}</p><div class="actions">${read ? '<span class="subtle">Read</span>' :
        `<button class="quiet" data-note="${note.id}" data-note-action="read">Mark as read</button>`}
        <button class="quiet" data-note="${note.id}" data-note-action="dismissed">Dismiss</button></div></div>`;
    }).join('') : '<p>No notifications.</p>') + '</div>';
}

function moduleMarkup(id) {
  switch (id) {
    case 'clock': return '<time class="readout"></time><p class="subtle" data-date></p>';
    case 'notifications': return notificationMarkup();
    case 'ai': return '<div class="ai-image">' + icon('ai') + '</div><p class="subtle">Reserved for future AI integration.</p>';
    case 'settings': return settingsMarkup();
    case 'status':
      return '<dl class="status-list"><div><dt>Network hint</dt><dd data-network></dd></div>' +
        '<div><dt>Display mode</dt><dd data-display></dd></div><div><dt>Offline shell</dt><dd data-offline></dd></div></dl>';
  }
}

function updateStatus() {
  const online = navigator.onLine;
  $('network-badge').textContent = online ? 'Online' : 'Offline';
  $('network-badge').parentElement.classList.toggle('online', online);
  const offline = offlineReady ? 'Ready' : workerError ? 'Registration failed' :
    !('serviceWorker' in navigator) || location.protocol === 'file:' ? 'Unavailable here' : 'Preparing';
  for (const [field, value] of Object.entries({
    network: online ? 'Online' : 'Offline',
    display: standalone.matches || navigator.standalone ? 'Standalone' : 'Browser tab',
    offline
  })) {
    document.querySelectorAll('[data-' + field + ']').forEach(node => { node.textContent = value; });
  }
}

function navigate(next, moveFocus = true) {
  if (!Object.hasOwn(modules, next) && next !== 'home') next = preferences.mode;
  if (next === route) return;
  if (next === 'home' || next === 'spatial') {
    preferences.mode = next;
    returnRoute = next;
    persist();
  }
  route = next;
  $('shell').dataset.route = next;
  $('home').hidden = next !== 'home';
  $('spatial').hidden = next !== 'spatial';
  $('detail').hidden = next === 'home' || next === 'spatial';

  if (!$('detail').hidden) {
    $('detail-icon').innerHTML = '<span class="tile-icon">' + icon(modules[next].icon) + '</span>';
    $('detail-title').textContent = modules[next].name;
    $('detail-content').innerHTML = moduleMarkup(next);
  }
  document.querySelectorAll('.dock button').forEach(button => {
    if (button.dataset.route === next) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (next === 'spatial') layoutPanels();
  if (moveFocus) {
    main.scrollTop = 0;
    const target = next === 'home' ? document.querySelector('.dock [data-route="home"]') :
      next === 'spatial' ? $('spatial-title') : $('detail-title');
    target.focus({ preventScroll: true });
  }
  updateTime();
  updateStatus();
}

function openRoute(next) {
  const hash = '#' + next;
  if (!location.hash && route) history.replaceState(null, '', '#' + route);
  if (location.hash !== hash) history.pushState(null, '', hash);
  navigate(next);
}

function finishIntro() {
  if ($('boot').hidden) return;
  clearTimeout(introTimer);
  $('boot').hidden = true;
  $('shell').inert = false;
  delete document.body.dataset.booting;
  $('shell').classList.add('boot-complete');
  (route === 'settings' ? document.querySelector('[data-action="replay"]') :
    document.querySelector('.dock [data-route="' + preferences.mode + '"]')).focus({ preventScroll: true });
}

function startIntro() {
  if (!preferences.motion || reducedMotion.matches) {
    $('announcement').textContent = 'Startup animation is disabled by motion settings.';
    return;
  }
  $('announcement').textContent = '';
  $('shell').classList.remove('boot-complete');
  $('boot').hidden = false;
  $('shell').inert = true;
  document.body.dataset.booting = '';
  $('skip').focus({ preventScroll: true });
  introTimer = setTimeout(finishIntro, 3550);
}

function initialPanelState(id) {
  const state = saved.panels?.[id];
  const custom = saved.layoutVersion === 2 && Number.isFinite(state?.x) && Number.isFinite(state?.y);
  return {
    x: custom ? clamp(state.x, 0, 1) : null,
    y: custom ? clamp(state.y, 0, 1) : null,
    scale: custom && Number.isFinite(state.scale) ? clamp(state.scale, .72, 1.5) : 1,
    collapsed: state?.collapsed === true,
    closed: state?.closed === true
  };
}

function updatePanelLabels() {
  Object.entries(panels).forEach(([id, panel]) => {
    panel.node.toggleAttribute('data-focused', id === activePanel);
    panel.launcher.setAttribute('aria-pressed', String(id === activePanel));
    panel.launcher.classList.toggle('is-closed', panel.state.closed);
    panel.launcher.setAttribute('aria-label', (panel.state.closed ? 'Reopen ' : 'Focus ') + panel.label);
  });
}

function focusPanel(id) {
  if (expandedPanel && expandedPanel !== id) setExpanded(expandedPanel, false);
  if (activePanel === id) return;
  activePanel = id;
  panels[id].node.style.zIndex = ++topLayer;
  updatePanelLabels();
}

function measurePanel(panel) {
  const { node, state } = panel;
  const { width, height, padding, columnWidth, rowHeight } = stageGeometry;
  const expanded = expandedPanel === panel.id;
  const wide = width - padding * 2;
  const maxScale = Math.min(1.5, wide / columnWidth);
  const scale = clamp(state.scale, .72, maxScale);
  const panelWidth = expanded ? Math.min(wide, 660) : Math.min(wide, Math.max(208, Math.round(columnWidth * scale)));
  const panelHeight = expanded ? Math.min(420, Math.max(220, main.clientHeight * .78), height - padding * 2) :
    Math.min(height - padding * 2, Math.round(rowHeight * scale));
  node.style.setProperty('--panel-width', panelWidth + 'px');
  node.style.setProperty('--panel-height', panelHeight + 'px');
  return {
    scale,
    maxScale,
    width: Math.max(0, wide - panelWidth),
    height: Math.max(0, height - padding * 2 - node.offsetHeight)
  };
}

function placePanel(panel, bounds = measurePanel(panel)) {
  const { padding } = stageGeometry;
  const expanded = expandedPanel === panel.id;
  const left = expanded ? bounds.width / 2 : panel.state.x === null ? panel.slot.x : panel.state.x * bounds.width;
  const top = expanded || panel.state.y === null ? panel.slot.y : panel.state.y * bounds.height;
  panel.left = padding + clamp(left, 0, bounds.width);
  panel.top = padding + clamp(top, 0, bounds.height);
  panel.node.style.setProperty('--x', panel.left + 'px');
  panel.node.style.setProperty('--y', panel.top + 'px');
}

function layoutPanels() {
  if (route !== 'spatial') return;
  const visible = Object.values(panels).filter(panel => !panel.state.closed);
  const width = stage.clientWidth;
  const columns = width >= 540 ? 2 : 1;
  const padding = width >= 540 ? 20 : 12;
  const gap = 12;
  const compact = columns === 2 && main.clientHeight < 400;
  const rowHeight = columns === 2 ? (compact ? 152 : 188) : 156;
  const coreHeight = columns === 2 ? (compact ? 28 : 112) : 92;
  const cellWidth = Math.floor((width - padding * 2 - gap * (columns - 1)) / columns);
  const columnWidth = columns === 1 ? cellWidth - 28 : cellWidth;
  const rows = Math.ceil(visible.length / columns);
  const height = Math.max(expandedPanel ? 354 : 0, coreHeight + padding * 2 + rows * (rowHeight + gap) - (rows ? gap : 0));
  stage.style.setProperty('--stage-size', height + 'px');
  stage.toggleAttribute('data-compact', compact);
  stageGeometry = { width, height: stage.clientHeight, padding, columnWidth, rowHeight };
  visible.forEach((panel, index) => {
    panel.slot = {
      x: (index % columns) * (cellWidth + gap) + (cellWidth - columnWidth) / 2,
      y: coreHeight + Math.floor(index / columns) * (rowHeight + gap)
    };
    if (!panel.pointers.size) placePanel(panel);
  });
}

function setExpanded(id, expanded) {
  const panel = panels[id];
  if (expanded) {
    focusPanel(id);
    if (panel.state.collapsed) {
      panel.state.collapsed = false;
      updatePanel(panel);
      persist();
    }
  }
  expandedPanel = expanded ? id : null;
  panel.node.toggleAttribute('data-expanded', expanded);
  panel.resize.setAttribute('aria-pressed', String(expanded));
  panel.resize.setAttribute('aria-label', (expanded ? 'Restore ' : 'Expand ') + panel.label);
  panel.resize.title = panel.resize.getAttribute('aria-label');
  layoutPanels();
}

function updatePanel(panel) {
  const { state, node, content, toggle } = panel;
  node.hidden = state.closed;
  node.toggleAttribute('data-minimized', state.collapsed);
  content.hidden = state.collapsed;
  toggle.textContent = state.collapsed ? '+' : '−';
  toggle.setAttribute('aria-expanded', String(!state.collapsed));
  toggle.setAttribute('aria-label', (state.collapsed ? 'Restore minimized ' : 'Minimize ') + panel.label);
  toggle.title = toggle.getAttribute('aria-label');
  layoutPanels();
  updatePanelLabels();
}

function midpoint(points) {
  const [first, second = first] = points.values();
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    spread: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
  };
}

function beginGesture(panel) {
  const bounds = measurePanel(panel);
  panel.gesture = {
    ...midpoint(panel.pointers), bounds,
    left: panel.left - stageGeometry.padding,
    top: panel.top - stageGeometry.padding
  };
}

function connectGestures(panel) {
  const { title, pointers, id, state } = panel;
  title.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2 || expandedPanel === id) return;
    if (panel.frame) {
      cancelAnimationFrame(panel.frame);
      moveGesture(panel);
    }
    focusPanel(id);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    title.setPointerCapture(event.pointerId);
    beginGesture(panel);
  });

  title.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (panel.frame) return;
    panel.frame = requestAnimationFrame(() => moveGesture(panel));
  });

  function end(event) {
    if (!pointers.has(event.pointerId)) return;
    if (event.type === 'pointerup') pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (panel.frame) cancelAnimationFrame(panel.frame);
    if (panel.frame || event.type === 'pointerup') moveGesture(panel);
    pointers.delete(event.pointerId);
    if (pointers.size) beginGesture(panel);
    else {
      state.scale = clamp(state.scale, .72, 1.5);
      layoutPanels();
      persist();
    }
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) title.addEventListener(type, end);
}

function moveGesture(panel) {
  panel.frame = 0;
  const { pointers, state, gesture } = panel;
  const point = midpoint(pointers);
  const dx = point.x - gesture.x;
  const dy = point.y - gesture.y;
  if (pointers.size === 1 && !gesture.moved && Math.hypot(dx, dy) < 4) return;
  gesture.moved = true;
  let bounds = gesture.bounds;
  if (pointers.size === 2) {
    state.scale = clamp(bounds.scale * point.spread / gesture.spread, .72, bounds.maxScale);
    bounds = measurePanel(panel);
  }
  state.x = bounds.width ? clamp((gesture.left + dx) / bounds.width, 0, 1) : .5;
  state.y = bounds.height ? clamp((gesture.top + dy) / bounds.height, 0, 1) : 0;
  placePanel(panel, bounds);
  if (preferences.motion && !reducedMotion.matches) {
    stage.style.setProperty('--parallax', (state.x - .5) * preferences.sensitivity * .5 + 'px');
  }
}

function createPanel(id) {
  const label = modules[id].panel || modules[id].name;
  const node = document.createElement('article');
  node.className = 'panel';
  node.setAttribute('aria-label', label);
  node.innerHTML = `<header class="panel-head"><button class="panel-title" type="button">${icon(modules[id].icon)}<span>${label}</span></button>
    <button class="panel-control panel-resize" type="button" aria-label="Expand ${label}" title="Expand ${label}" aria-pressed="false"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg></button>
    <button class="panel-control" type="button" aria-controls="panel-${id}"></button>
    <button class="panel-control" type="button" aria-label="Close ${label}" title="Close ${label}">×</button></header>
    <div class="panel-content" id="panel-${id}">${moduleMarkup(id)}</div>`;
  const [title, resize, toggle, close] = node.querySelectorAll('.panel-head button');
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'quiet';
  launcher.innerHTML = icon(modules[id].icon) + '<span>' + label + '</span>';
  const panel = { id, label, node, title, content: node.lastElementChild, resize, toggle, launcher, pointers: new Map(), state: initialPanelState(id) };
  panels[id] = panel;
  $('windows').append(node);
  $('panel-launcher').append(launcher);
  node.addEventListener('pointerdown', () => focusPanel(id));
  node.addEventListener('focusin', () => focusPanel(id));
  title.addEventListener('click', () => focusPanel(id));
  resize.addEventListener('click', () => {
    setExpanded(id, expandedPanel !== id);
    node.scrollIntoView({ block: 'nearest' });
  });
  toggle.addEventListener('click', () => {
    if (expandedPanel === id) setExpanded(id, false);
    panel.state.collapsed = !panel.state.collapsed;
    updatePanel(panel);
    persist();
  });
  close.addEventListener('click', () => {
    if (expandedPanel === id) setExpanded(id, false);
    panel.state.closed = true;
    if (activePanel === id) activePanel = null;
    updatePanel(panel);
    launcher.focus();
    persist();
  });
  launcher.addEventListener('click', () => {
    panel.state.closed = false;
    panel.state.collapsed = false;
    updatePanel(panel);
    focusPanel(id);
    title.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest' });
    persist();
  });
  updatePanel(panel);
  connectGestures(panel);
}

$('applications').innerHTML = Object.entries(modules).map(([id, app]) =>
  `<button type="button" class="tile glass" data-route="${id}"><span class="tile-icon">${icon(app.icon)}</span>
    <span><strong>${app.name}</strong><small>${app.caption}</small></span></button>`
).join('');
windowOrder.forEach(createPanel);
applyPreferences();
navigate(location.hash.slice(1) || preferences.mode, false);
if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(layoutPanels);
  resizeObserver.observe(stage);
  resizeObserver.observe(main);
} else window.addEventListener('resize', layoutPanels);
let clockTimer;
function syncClock() {
  clearInterval(clockTimer);
  if (!document.hidden) {
    updateTime();
    clockTimer = setInterval(updateTime, 1000);
  }
}
syncClock();
document.addEventListener('visibilitychange', () => {
  document.body.toggleAttribute('data-page-hidden', document.hidden);
  syncClock();
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1) || returnRoute));
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
window.addEventListener('pageshow', updateTime);
standalone.addEventListener?.('change', updateStatus);
reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) finishIntro(); });
$('skip').addEventListener('click', finishIntro);
$('back').addEventListener('click', () => openRoute(returnRoute));
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.route) openRoute(button.dataset.route);
  if (button.dataset.note) {
    noteStates[button.dataset.note] = button.dataset.noteAction;
    persist();
    const content = route === 'spatial' ? panels.notifications.content : $('detail-content');
    const scroll = content.scrollTop;
    const markup = notificationMarkup();
    panels.notifications.content.innerHTML = markup;
    if (route === 'notifications') content.innerHTML = markup;
    layoutPanels();
    content.scrollTop = scroll;
    const next = content.querySelector('button');
    if (next) next.focus({ preventScroll: true });
    else (route === 'spatial' ? panels.notifications.title : $('detail-title')).focus({ preventScroll: true });
    $('announcement').textContent = button.dataset.noteAction === 'read' ? 'Notification marked as read.' : 'Notification dismissed.';
  }
  if (['arrange', 'reset'].includes(button.dataset.action)) {
    const reset = button.dataset.action === 'reset';
    if (expandedPanel) setExpanded(expandedPanel, false);
    Object.values(panels).forEach(panel => {
      Object.assign(panel.state, arranged);
      if (reset) Object.assign(panel.state, { collapsed: false, closed: false });
      updatePanel(panel);
    });
    stage.style.removeProperty('--parallax');
    persist();
    $('announcement').textContent = reset ? 'Workspace reset.' : 'Windows arranged.';
  }
  if (button.dataset.action === 'replay') startIntro();
});
document.addEventListener('input', event => {
  if (event.target.id === 'motion') {
    preferences.motion = event.target.checked;
    if (!preferences.motion) stage.style.removeProperty('--parallax');
  } else if (Object.hasOwn(sliders, event.target.id)) {
    const key = event.target.id;
    preferences[key] = Number(event.target.value);
    $(key + '-value').textContent = preferences[key] + '%';
  } else return;
  applyPreferences();
  persist();
});

if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    offlineReady = true;
    updateStatus();
  }).catch(() => {
    workerError = true;
    updateStatus();
  });
}
if (preferences.motion && !reducedMotion.matches) startIntro();
