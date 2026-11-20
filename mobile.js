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
const defaults = {
  clock: { x: .05, y: .10 },
  notifications: { x: .95, y: .23 },
  status: { x: .07, y: .76 },
  ai: { x: .93, y: .91 }
};
const sampleNotes = [
  { id: 'welcome', title: 'Welcome to Spatial Edition', text: 'Open the workspace to arrange your floating panels.' },
  { id: 'gesture', title: 'Workspace controls', text: 'Hold a panel title to drag it, or use two fingers on the title to resize.' }
];
const preferences = { motion: true, effects: 80, mode: 'home' };
const storageKey = 'xuanos-mobile-v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { /* Storage is optional. */ }
if (typeof saved.preferences?.motion === 'boolean') preferences.motion = saved.preferences.motion;
if (Number.isFinite(saved.preferences?.effects)) preferences.effects = Math.max(0, Math.min(100, saved.preferences.effects));
if (saved.preferences?.mode === 'spatial') preferences.mode = 'spatial';
const noteStates = Object.fromEntries(sampleNotes.map(({ id }) => [id, saved.notes?.[id]]));
const panels = {};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const standalone = matchMedia('(display-mode: standalone)');
const stage = $('stage');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
let route = null;
let returnRoute = preferences.mode;
let activePanel = null;
let topLayer = 0;
let introTimer;
let workerError = false;
let offlineReady = false;

function persist() {
  try {
    const positions = Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, panel.state]));
    localStorage.setItem(storageKey, JSON.stringify({ preferences, notes: noteStates, panels: positions }));
  } catch { /* Changes still apply for this session. */ }
}

function applyPreferences() {
  document.body.dataset.motion = preferences.motion ? 'on' : 'off';
  document.documentElement.style.setProperty('--fx', preferences.effects / 100);
  document.documentElement.style.setProperty('--blur', (preferences.effects * .15) + 'px');
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
  return `<div class="settings-form">
    <label><span>Animations</span><input id="motion" type="checkbox" ${preferences.motion ? 'checked' : ''}></label>
    <label><span>Effects intensity <output id="effects-value" for="effects">${preferences.effects}%</output></span><input id="effects" type="range" min="0" max="100" step="5" value="${preferences.effects}"></label>
    <div class="actions"><button class="quiet" data-route="home">Switch to Home</button><button class="quiet" data-route="spatial">Switch to Spatial</button></div>
    <div class="actions"><button class="quiet" data-action="reset">Reset panel positions</button><button class="quiet" data-action="replay">Replay startup</button></div>
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
    window.scrollTo(0, 0);
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
  (route === 'settings' ? document.querySelector('[data-action="replay"]') :
    document.querySelector('.dock [data-route="' + preferences.mode + '"]')).focus({ preventScroll: true });
}

function startIntro() {
  if (!preferences.motion || reducedMotion.matches) {
    $('announcement').textContent = 'Startup animation is disabled by motion settings.';
    return;
  }
  $('announcement').textContent = '';
  $('boot').hidden = false;
  $('shell').inert = true;
  document.body.dataset.booting = '';
  $('skip').focus({ preventScroll: true });
  introTimer = setTimeout(finishIntro, 3550);
}

function initialPanelState(id) {
  const state = saved.panels?.[id];
  return {
    x: Number.isFinite(state?.x) ? clamp(state.x, 0, 1) : defaults[id].x,
    y: Number.isFinite(state?.y) ? clamp(state.y, 0, 1) : defaults[id].y,
    scale: Number.isFinite(state?.scale) ? clamp(state.scale, .88, 1.4) : 1,
    collapsed: state?.collapsed === true,
    closed: state?.closed === true
  };
}

function updatePanelLabels() {
  Object.entries(panels).forEach(([id, panel]) => {
    panel.node.toggleAttribute('data-focused', id === activePanel);
    panel.launcher.setAttribute('aria-pressed', String(id === activePanel));
    panel.launcher.textContent = (panel.state.closed ? '+ ' : '') + panel.label;
    panel.launcher.setAttribute('aria-label', (panel.state.closed ? 'Reopen ' : 'Focus ') + panel.label);
  });
}

function focusPanel(id) {
  if (activePanel === id) return;
  activePanel = id;
  panels[id].node.style.zIndex = ++topLayer;
  updatePanelLabels();
}

function measurePanel(panel) {
  const { node, state } = panel;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const maxScale = Math.min(1.4, (width - 10) / node.offsetWidth);
  const scale = clamp(state.scale, Math.min(.88, maxScale), maxScale);
  node.style.setProperty('--s', scale);
  return {
    scale,
    maxScale,
    width: Math.max(0, width - Math.ceil(node.offsetWidth * scale)),
    height: Math.max(0, height - Math.ceil(node.offsetHeight * scale))
  };
}

function placePanel(panel, bounds = measurePanel(panel)) {
  panel.node.style.setProperty('--x', (panel.state.x * bounds.width) + 'px');
  panel.node.style.setProperty('--y', (panel.state.y * bounds.height) + 'px');
}

function layoutPanels() {
  if (route !== 'spatial') return;
  stage.style.setProperty('--stage-height', stage.clientHeight + 'px');
  Object.values(panels).forEach(panel => {
    if (!panel.state.closed && !panel.pointers.size) placePanel(panel);
  });
}

function updatePanel(panel) {
  const { state, node, content, toggle } = panel;
  node.hidden = state.closed;
  content.hidden = state.collapsed;
  toggle.textContent = state.collapsed ? '+' : '−';
  toggle.setAttribute('aria-expanded', String(!state.collapsed));
  toggle.setAttribute('aria-label', (state.collapsed ? 'Expand ' : 'Collapse ') + panel.label);
  if (!state.closed && route === 'spatial') placePanel(panel);
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
    left: panel.state.x * bounds.width,
    top: panel.state.y * bounds.height
  };
}

function connectGestures(panel) {
  const { title, pointers, id, state } = panel;
  title.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
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
      state.scale = clamp(state.scale, .88, 1.4);
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
  let bounds = gesture.bounds;
  if (pointers.size === 2) {
    state.scale = clamp(bounds.scale * point.spread / gesture.spread, .88, bounds.maxScale);
    bounds = measurePanel(panel);
  }
  if (bounds.width) state.x = clamp((gesture.left + point.x - gesture.x) / bounds.width, 0, 1);
  if (bounds.height) state.y = clamp((gesture.top + point.y - gesture.y) / bounds.height, 0, 1);
  placePanel(panel, bounds);
  if (preferences.motion && !reducedMotion.matches) {
    stage.style.setProperty('--parallax', (state.x - .5) * preferences.effects * .25 + 'px');
  }
}

function createPanel(id) {
  const label = modules[id].panel || modules[id].name;
  const node = document.createElement('article');
  node.className = 'panel';
  node.setAttribute('aria-label', label);
  node.innerHTML = `<header class="panel-head"><button class="panel-title" type="button">${label}</button>
    <button class="panel-control" type="button" aria-controls="panel-${id}"></button>
    <button class="panel-control" type="button" aria-label="Close ${label}">×</button></header>
    <div class="panel-content" id="panel-${id}">${moduleMarkup(id)}</div>`;
  const [title, toggle, close] = node.querySelectorAll('.panel-head button');
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'quiet';
  const panel = { id, label, node, title, content: node.lastElementChild, toggle, launcher, pointers: new Map(), state: initialPanelState(id) };
  panels[id] = panel;
  $('windows').append(node);
  $('panel-launcher').append(launcher);
  node.addEventListener('pointerdown', () => focusPanel(id));
  node.addEventListener('focusin', () => focusPanel(id));
  title.addEventListener('click', () => focusPanel(id));
  toggle.addEventListener('click', () => {
    panel.state.collapsed = !panel.state.collapsed;
    updatePanel(panel);
    persist();
  });
  close.addEventListener('click', () => {
    panel.state.closed = true;
    if (activePanel === id) activePanel = null;
    updatePanel(panel);
    launcher.focus();
    persist();
  });
  launcher.addEventListener('click', () => {
    panel.state.closed = false;
    updatePanel(panel);
    focusPanel(id);
    title.focus({ preventScroll: true });
    persist();
  });
  updatePanel(panel);
  connectGestures(panel);
}

$('applications').innerHTML = Object.entries(modules).map(([id, app]) =>
  `<button type="button" class="tile glass" data-route="${id}"><span class="tile-icon">${icon(app.icon)}</span>
    <span><strong>${app.name}</strong><small>${app.caption}</small></span></button>`
).join('');
Object.keys(defaults).forEach(createPanel);
applyPreferences();
navigate(location.hash.slice(1) || preferences.mode, false);
if ('ResizeObserver' in window) new ResizeObserver(layoutPanels).observe(stage);
else window.addEventListener('resize', layoutPanels);
setInterval(updateTime, 1000);
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
  if (button.dataset.action === 'reset') {
    Object.entries(panels).forEach(([id, panel]) => {
      Object.assign(panel.state, defaults[id], { scale: 1, collapsed: false, closed: false });
      updatePanel(panel);
    });
    stage.style.removeProperty('--parallax');
    persist();
    $('announcement').textContent = 'Spatial panels reset.';
    button.textContent = 'Panel positions reset';
  }
  if (button.dataset.action === 'replay') startIntro();
});
document.addEventListener('input', event => {
  if (event.target.id === 'motion') {
    preferences.motion = event.target.checked;
    if (!preferences.motion) stage.style.removeProperty('--parallax');
  } else if (event.target.id === 'effects') {
    preferences.effects = Number(event.target.value);
    $('effects-value').textContent = preferences.effects + '%';
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
