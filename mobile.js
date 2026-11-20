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
  { id: 'welcome', title: 'Welcome to Spatial Fusion', text: 'Open the workspace to arrange your floating windows.' },
  { id: 'gesture', title: 'Workspace controls', text: 'Hold a panel title to drag it, or use two fingers on the title to resize.' }
];
const visualDefaults = { motion: true, effects: 75, glass: 45, depth: 65, sensitivity: 55 };
const preferences = { ...visualDefaults, mode: 'home' };
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
let overview = typeof saved.overview === 'boolean' ? saved.overview : reducedMotion.matches;
let stageGeometry;
let introTimer;
let workerError = false;
let offlineReady = false;

function persist() {
  try {
    const positions = Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, panel.state]));
    localStorage.setItem(storageKey, JSON.stringify({ layoutVersion: 3, overview, focus: activePanel, preferences, notes: noteStates, panels: positions }));
  } catch { /* Changes still apply for this session. */ }
}

function applyPreferences() {
  document.body.dataset.motion = preferences.motion ? 'on' : 'off';
  const style = document.documentElement.style;
  style.setProperty('--fx', preferences.effects / 100);
  style.setProperty('--blur', (preferences.effects * .18) + 'px');
  style.setProperty('--glass-alpha', .99 - preferences.glass * .0025);
  style.setProperty('--depth', preferences.depth / 100);
  style.setProperty('--orbit-distance', (preferences.sensitivity * .12) + 'px');
  stage.style.removeProperty('--parallax');
  $('core-toggle').style.removeProperty('--pitch');
  $('core-toggle').style.removeProperty('--yaw');
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
    <section class="control-group"><div class="settings-preview"><h2>Motion and glass</h2><div data-core aria-hidden="true"></div></div>
    <label><span>Animations</span><input id="motion" type="checkbox" ${preferences.motion ? 'checked' : ''}></label>
    ${Object.entries(sliders).map(([key, label]) => `<label><span>${label}</span><input id="${key}" type="range" min="0" max="100" step="5" value="${preferences[key]}"><output id="${key}-value" for="${key}">${preferences[key]}%</output></label>`).join('')}
    <button class="quiet" data-action="defaults">Restore Visual Defaults</button></section>
    <section class="control-group"><h2>Workspace</h2>
    <div class="actions"><button class="quiet" data-route="home">Switch to Home</button><button class="quiet" data-route="spatial">Switch to Spatial</button></div>
    <div class="actions"><button class="quiet" data-action="reset">Reset Workspace</button><button class="quiet" data-action="replay">Replay Startup</button></div></section>
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
    case 'ai': return '<div class="ai-image">' + icon('ai') + '</div><p class="subtle">AI Core is reserved for a future integration.</p>';
    case 'settings': return settingsMarkup();
    case 'status':
      return '<dl class="status-list"><div><dt>Network hint</dt><dd data-network></dd></div>' +
        '<div><dt>Display mode</dt><dd data-display></dd></div><div><dt>Offline shell</dt><dd data-offline></dd></div></dl>' +
        '<p class="subtle diagnostics-note">CPU and memory usage, storage hardware, and network throughput are unavailable to this app.</p>';
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
  if (next !== 'home') toggleCore(false);
  $('shell').dataset.route = next;
  $('home').hidden = next !== 'home';
  $('spatial').hidden = next !== 'spatial';
  $('detail').hidden = next === 'home' || next === 'spatial';

  if (!$('detail').hidden) {
    $('detail-icon').innerHTML = '<span class="tile-icon">' + icon(modules[next].icon) + '</span>';
    $('detail-title').textContent = modules[next].name;
    $('detail-content').innerHTML = moduleMarkup(next);
    mountCores($('detail-content'));
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
  const custom = saved.layoutVersion >= 2 && Number.isFinite(state?.x) && Number.isFinite(state?.y);
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
    panel.launcher.classList.toggle('is-minimized', panel.state.collapsed);
    panel.launcher.setAttribute('aria-label', (panel.state.closed ? 'Reopen ' : panel.state.collapsed ? 'Restore ' : 'Focus ') + panel.label);
  });
}

function focusPanel(id) {
  if (expandedPanel && expandedPanel !== id) setExpanded(expandedPanel, false);
  activePanel = id;
  layoutPanels();
  updatePanelLabels();
}

function measurePanel(panel) {
  const { node, state } = panel;
  const { width, height, padding } = stageGeometry;
  const expanded = expandedPanel === panel.id;
  const wide = width - padding * 2;
  const tall = height - padding * 2;
  const baseWidth = Math.min(495, Math.round(wide * .87));
  const baseHeight = Math.min(335, Math.round(tall * (width < 540 && tall > 310 ? .68 : .81)));
  const maxScale = Math.min(1.5, Math.max(1, Math.max(wide / baseWidth, tall / baseHeight)));
  const scale = clamp(state.scale, .72, maxScale);
  const panelWidth = expanded ? Math.min(wide, 760) : Math.min(wide, Math.max(216, Math.round(baseWidth * scale)));
  const panelHeight = expanded ? tall : Math.min(tall, Math.max(126, Math.round(baseHeight * scale)));
  node.style.setProperty('--panel-width', panelWidth + 'px');
  node.style.setProperty('--panel-height', panelHeight + 'px');
  return {
    scale,
    maxScale,
    width: Math.max(0, wide - panelWidth),
    height: Math.max(0, tall - panelHeight)
  };
}

function placePanel(panel, bounds = measurePanel(panel)) {
  const { padding } = stageGeometry;
  const expanded = expandedPanel === panel.id;
  const left = bounds.width * (expanded ? .5 : panel.state.x ?? .5);
  const top = bounds.height * (expanded ? .5 : panel.state.y ?? (stageGeometry.width < 540 ? .84 : .55));
  panel.left = padding + clamp(left, 0, bounds.width);
  panel.top = padding + clamp(top, 0, bounds.height);
  panel.node.style.setProperty('--x', panel.left + 'px');
  panel.node.style.setProperty('--y', panel.top + 'px');
}

function layoutPanels() {
  if (route !== 'spatial') return;
  const visible = Object.values(panels).filter(panel => !panel.state.closed);
  const front = visible.find(panel => panel.id === activePanel && !panel.state.collapsed) ??
    visible.find(panel => !panel.state.collapsed);
  activePanel = front?.id ?? null;
  const rear = visible.filter(panel => panel !== front);
  stage.toggleAttribute('data-overview', overview);
  $('stage-empty').hidden = overview ? visible.length !== 0 : Boolean(front);
  $('stage-empty').firstElementChild.textContent = visible.length ? 'All windows are minimized.' : 'No windows are open.';
  const height = clamp(main.clientHeight - stage.offsetTop - 14, 238, 650);
  stage.style.setProperty('--stage-size', height + 'px');
  const width = stage.clientWidth;
  const padding = width > 600 ? 18 : 10;
  const rail = rear.length ? 61 : 0;
  stageGeometry = { width, height: stage.clientHeight - rail, padding };
  const slotWidth = Math.min(164, Math.floor((width - padding * 2 - Math.max(0, rear.length - 1) * 6) / Math.max(1, rear.length)));
  const groupWidth = slotWidth * rear.length + Math.max(0, rear.length - 1) * 6;
  rear.forEach((panel, index) => {
    const offset = index - (rear.length - 1) / 2;
    panel.node.dataset.plane = offset === 0 ? 'middle' : 'far';
    panel.node.style.setProperty('--lean', (-offset * 7) + 'deg');
    panel.node.style.setProperty('--panel-width', slotWidth + 'px');
    panel.node.style.setProperty('--x', (Math.round((width - groupWidth) / 2) + index * (slotWidth + 6)) + 'px');
    panel.node.style.setProperty('--y', (stage.clientHeight - (offset === 0 ? 53 : 58)) + 'px');
  });
  if (front) {
    front.node.dataset.plane = 'near';
    if (!overview && !front.pointers.size) placePanel(front);
  }
  for (const panel of visible) {
    const preview = panel !== front && !overview;
    panel.chrome.hidden = preview;
    panel.content.hidden = preview || panel.state.collapsed;
    panel.title.setAttribute('aria-label', preview ? (panel.state.collapsed ? 'Restore ' : 'Focus ') + panel.label : panel.label);
  }
  updatePanelLabels();
}

function useOverview(enabled) {
  overview = enabled;
  $('overview-toggle').setAttribute('aria-pressed', String(overview));
  $('overview-toggle').textContent = overview ? '3D Scene' : 'Overview';
  $('scene-help').textContent = overview ? 'Select an app to restore its window.' : 'Drag or pinch the focused window’s title bar.';
  layoutPanels();
}

function setExpanded(id, expanded) {
  const panel = panels[id];
  if (expanded) {
    if (panel.state.collapsed) {
      panel.state.collapsed = false;
      updatePanel(panel);
      persist();
    }
    focusPanel(id);
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
    if (event.button !== 0 || pointers.size >= 2 || expandedPanel === id || activePanel !== id || overview) return;
    if (panel.frame) {
      cancelAnimationFrame(panel.frame);
      moveGesture(panel);
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    panel.node.setAttribute('data-gesturing', '');
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
      panel.node.removeAttribute('data-gesturing');
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
  const labelMarkup = id === 'notifications' ?
    '<span class="full-label">Notifications</span><span class="short-label">Alerts</span>' : '<span>' + label + '</span>';
  const node = document.createElement('article');
  node.className = 'panel';
  node.setAttribute('aria-label', label);
  node.innerHTML = `<header class="panel-head"><button class="panel-title" type="button">${icon(modules[id].icon)}${labelMarkup}</button>
    <div class="panel-chrome"><button class="panel-control panel-resize" type="button" aria-label="Expand ${label}" title="Expand ${label}" aria-pressed="false">${icon('expand')}</button>
    <button class="panel-control" type="button" aria-controls="panel-${id}"></button>
    <button class="panel-control" type="button" aria-label="Close ${label}" title="Close ${label}">×</button></div></header>
    <div class="panel-content" id="panel-${id}">${moduleMarkup(id)}</div>`;
  const [title, resize, toggle, close] = node.querySelectorAll('.panel-head button');
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'quiet';
  launcher.innerHTML = icon(modules[id].icon) + labelMarkup;
  const panel = { id, label, node, title, content: node.lastElementChild, chrome: node.querySelector('.panel-chrome'),
    resize, toggle, launcher, pointers: new Map(), state: initialPanelState(id) };
  panels[id] = panel;
  $('windows').append(node);
  $('panel-launcher').append(launcher);
  title.addEventListener('click', () => {
    if (activePanel !== id || panel.state.collapsed) openPanel(id);
  });
  resize.addEventListener('click', () => {
    setExpanded(id, expandedPanel !== id);
    node.scrollIntoView({ block: 'nearest' });
  });
  toggle.addEventListener('click', () => {
    if (panel.state.collapsed) {
      openPanel(id);
      return;
    }
    if (expandedPanel === id) setExpanded(id, false);
    panel.state.collapsed = true;
    updatePanel(panel);
    if (!overview) launcher.focus({ preventScroll: true });
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
  launcher.addEventListener('click', () => openPanel(id));
  updatePanel(panel);
  connectGestures(panel);
}

function openPanel(id) {
  const panel = panels[id];
  panel.state.closed = false;
  panel.state.collapsed = false;
  updatePanel(panel);
  focusPanel(id);
  panel.title.focus({ preventScroll: true });
  if (overview) panel.node.scrollIntoView({ block: 'nearest' });
  persist();
}

function mountCores(root) {
  const template = $('core-template');
  root.querySelectorAll('[data-core]').forEach(node => node.append(template.content.cloneNode(true)));
}

function toggleCore(open, restoreFocus = false) {
  const trigger = $('core-toggle');
  $('core-launcher').hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) $('quick-applications').firstElementChild.focus();
  else if (restoreFocus) trigger.focus();
}

function connectCore() {
  const trigger = $('core-toggle');
  let frame;
  let rect;
  let point;
  function move(event) {
    if (!preferences.motion || reducedMotion.matches || (event.pointerType === 'touch' && !event.buttons)) return;
    rect ??= trigger.getBoundingClientRect();
    point = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const intensity = preferences.sensitivity * .34;
      trigger.style.setProperty('--pitch', clamp(.5 - (point.y - rect.top) / rect.height, -.5, .5) * intensity + 'deg');
      trigger.style.setProperty('--yaw', clamp((point.x - rect.left) / rect.width - .5, -.5, .5) * intensity + 'deg');
    });
  }
  function resetPose() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    rect = null;
    trigger.style.removeProperty('--pitch');
    trigger.style.removeProperty('--yaw');
  }
  trigger.addEventListener('pointerdown', move);
  trigger.addEventListener('pointermove', move);
  for (const event of ['pointerleave', 'pointerup', 'pointercancel']) trigger.addEventListener(event, resetPose);
  trigger.addEventListener('click', () => toggleCore($('core-launcher').hidden, true));
  $('core-close').addEventListener('click', () => toggleCore(false, true));
}

const launcherMarkup = Object.entries(modules).map(([id, app]) =>
  `<button type="button" class="tile" data-route="${id}"><span class="tile-icon">${icon(app.icon)}</span><strong>${app.name}</strong></button>`
).join('');
$('applications').innerHTML = launcherMarkup;
$('quick-applications').innerHTML = launcherMarkup;
mountCores(document);
connectCore();
windowOrder.forEach(createPanel);
if (Object.hasOwn(panels, saved.focus)) activePanel = saved.focus;
useOverview(overview);
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
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('core-launcher').hidden) toggleCore(false, true);
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1) || returnRoute));
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
window.addEventListener('pageshow', updateTime);
standalone.addEventListener?.('change', updateStatus);
reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) finishIntro(); });
$('skip').addEventListener('click', finishIntro);
$('back').addEventListener('click', () => openRoute(returnRoute));
$('overview-toggle').addEventListener('click', () => {
  useOverview(!overview);
  persist();
});
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
    if (reset) focusPanel('clock');
    const menu = $('workspace-menu');
    if (menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
    stage.style.removeProperty('--parallax');
    persist();
    $('announcement').textContent = reset ? 'Workspace reset.' : 'Windows arranged.';
  }
  if (button.dataset.action === 'cycle') {
    const index = windowOrder.indexOf(activePanel);
    for (let step = 1; step <= windowOrder.length; step++) {
      const id = windowOrder[(index + step) % windowOrder.length];
      if (!panels[id].state.closed) { openPanel(id); break; }
    }
  }
  if (button.dataset.action === 'defaults') {
    Object.assign(preferences, visualDefaults);
    $('motion').checked = preferences.motion;
    for (const key of Object.keys(sliders)) {
      $(key).value = preferences[key];
      $(key + '-value').textContent = preferences[key] + '%';
    }
    applyPreferences();
    persist();
    $('announcement').textContent = 'Visual defaults restored.';
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
