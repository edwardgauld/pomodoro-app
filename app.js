/* ============================================
   Pomodoro Timer — App Logic
   ============================================ */

(function () {
  'use strict';

  // ---- Constants ----

  const PHASE = { WORK: 'work', SHORT_BREAK: 'shortBreak', LONG_BREAK: 'longBreak' };
  const PHASE_LABELS = { work: 'Focus', shortBreak: 'Break', longBreak: 'Long Break' };
  const POMODOROS_BEFORE_LONG_BREAK = 4;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 90; // matches SVG circle r=90
  const DEFAULT_SETTINGS = { workDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, longBreakEnabled: true };
  const STORAGE_KEY = 'pomodoro-settings';

  // ---- State ----

  const state = {
    phase: PHASE.WORK,
    running: false,
    endTime: null,        // timestamp when timer reaches zero
    timeRemaining: 0,     // seconds
    completedPomodoros: 0, // 0-3, resets after long break
    settings: { ...DEFAULT_SETTINGS },
  };

  // ---- DOM Refs ----

  const $ = (sel) => document.querySelector(sel);
  const el = {
    app: $('.app'),
    phaseLabel: $('#phaseLabel'),
    timerDisplay: $('#timerDisplay'),
    ringProgress: $('#ringProgress'),
    sessionDots: $('#sessionDots'),
    startPauseBtn: $('#startPauseBtn'),
    resetBtn: $('#resetBtn'),
    skipBtn: $('#skipBtn'),
    settingsBtn: $('#settingsBtn'),
    settingsOverlay: $('#settingsOverlay'),
    settingsPanel: $('#settingsPanel'),
    settingsClose: $('#settingsClose'),
    iconPlay: $('.icon-play'),
    iconPause: $('.icon-pause'),
    workDuration: $('#workDuration'),
    shortBreakDuration: $('#shortBreakDuration'),
    longBreakDuration: $('#longBreakDuration'),
    longBreakToggle: $('#longBreakToggle'),
    longBreakSetting: $('#longBreakSetting'),
  };

  // ---- Timer Intervals ----

  let tickInterval = null;
  let rafId = null;

  // ---- Init ----

  function init() {
    loadSettings();
    setPhase(PHASE.WORK);
    bindEvents();
    registerServiceWorker();
  }

  // ---- Settings Persistence ----

  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(state.settings, parsed);
      }
    } catch (_) { /* use defaults */ }
    syncSettingsUI();
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (_) { /* silently fail */ }
  }

  function syncSettingsUI() {
    el.workDuration.value = state.settings.workDuration;
    el.shortBreakDuration.value = state.settings.shortBreakDuration;
    el.longBreakDuration.value = state.settings.longBreakDuration;
    syncLongBreakToggle();
  }

  function syncLongBreakToggle() {
    const enabled = state.settings.longBreakEnabled;
    el.longBreakToggle.setAttribute('aria-checked', String(enabled));
    el.longBreakSetting.classList.toggle('disabled', !enabled);
    // Show/hide session dots based on long break
    el.sessionDots.style.display = enabled ? 'flex' : 'none';
  }

  // ---- Phase Management ----

  function setPhase(phase) {
    state.phase = phase;
    state.timeRemaining = getPhaseDuration(phase);
    state.endTime = null;

    el.phaseLabel.textContent = PHASE_LABELS[phase];
    updateAccentColor(phase);
    updateTimerDisplay();
    updateRing();
    updateDots();
    updateTitle();
  }

  function getPhaseDuration(phase) {
    switch (phase) {
      case PHASE.WORK: return state.settings.workDuration * 60;
      case PHASE.SHORT_BREAK: return state.settings.shortBreakDuration * 60;
      case PHASE.LONG_BREAK: return state.settings.longBreakDuration * 60;
    }
  }

  function nextPhase() {
    if (state.phase === PHASE.WORK) {
      state.completedPomodoros++;
      if (state.settings.longBreakEnabled && state.completedPomodoros >= POMODOROS_BEFORE_LONG_BREAK) {
        state.completedPomodoros = 0;
        return PHASE.LONG_BREAK;
      }
      if (state.completedPomodoros >= POMODOROS_BEFORE_LONG_BREAK) {
        state.completedPomodoros = 0;
      }
      return PHASE.SHORT_BREAK;
    }
    return PHASE.WORK;
  }

  function updateAccentColor(phase) {
    const root = document.documentElement;
    switch (phase) {
      case PHASE.WORK:
        root.style.setProperty('--accent', 'var(--accent-work)');
        root.style.setProperty('--accent-glow', 'var(--accent-work-glow)');
        break;
      case PHASE.SHORT_BREAK:
        root.style.setProperty('--accent', 'var(--accent-break)');
        root.style.setProperty('--accent-glow', 'var(--accent-break-glow)');
        break;
      case PHASE.LONG_BREAK:
        root.style.setProperty('--accent', 'var(--accent-long)');
        root.style.setProperty('--accent-glow', 'var(--accent-long-glow)');
        break;
    }
  }

  // ---- Timer Engine ----

  function startTimer() {
    if (state.running) return;
    state.running = true;
    state.endTime = Date.now() + state.timeRemaining * 1000;
    el.app.classList.add('running');
    updatePlayPauseIcon();

    // Request notification permission on first interaction
    requestNotificationPermission();

    tickInterval = setInterval(tick, 250);
    scheduleRaf();
  }

  function pauseTimer() {
    if (!state.running) return;
    state.running = false;
    // Freeze timeRemaining at current value
    state.timeRemaining = Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
    state.endTime = null;
    el.app.classList.remove('running');
    updatePlayPauseIcon();

    clearInterval(tickInterval);
    tickInterval = null;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  function resetTimer() {
    pauseTimer();
    setPhase(state.phase);
  }

  function skipPhase() {
    pauseTimer();
    const next = nextPhase();
    setPhase(next);
  }

  function tick() {
    if (!state.running) return;

    const remaining = Math.max(0, (state.endTime - Date.now()) / 1000);
    state.timeRemaining = Math.ceil(remaining);

    if (remaining <= 0) {
      // Phase complete
      pauseTimer();
      state.timeRemaining = 0;
      updateTimerDisplay();
      updateRing();
      updateTitle();
      onPhaseComplete();
    }
  }

  function scheduleRaf() {
    rafId = requestAnimationFrame(() => {
      if (!state.running) return;
      updateTimerDisplay();
      updateRing();
      updateTitle();
      scheduleRaf();
    });
  }

  function onPhaseComplete() {
    playNotificationSound();
    sendNotification();
    // Auto-advance after a short delay
    setTimeout(() => {
      const next = nextPhase();
      setPhase(next);
    }, 800);
  }

  // ---- UI Updates ----

  function updateTimerDisplay() {
    const mins = Math.floor(state.timeRemaining / 60);
    const secs = state.timeRemaining % 60;
    el.timerDisplay.textContent =
      String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function updateRing() {
    const total = getPhaseDuration(state.phase);
    const progress = total > 0 ? state.timeRemaining / total : 1;
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    el.ringProgress.style.strokeDashoffset = offset;
  }

  function updateDots() {
    const dots = el.sessionDots.querySelectorAll('.dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('filled', i < state.completedPomodoros);
    });
  }

  function updatePlayPauseIcon() {
    el.iconPlay.style.display = state.running ? 'none' : 'block';
    el.iconPause.style.display = state.running ? 'block' : 'none';
    el.startPauseBtn.setAttribute('aria-label', state.running ? 'Pause' : 'Start');
  }

  function updateTitle() {
    const mins = Math.floor(state.timeRemaining / 60);
    const secs = state.timeRemaining % 60;
    const time = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    document.title = time + ' — ' + PHASE_LABELS[state.phase];
  }

  // ---- Notifications ----

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function sendNotification() {
    if ('Notification' in window && Notification.permission === 'granted') {
      const next = state.phase === PHASE.WORK ? 'Time to focus!' : 'Break time!';
      try {
        new Notification('Pomodoro', { body: next, icon: 'icons/icon-192.png' });
      } catch (_) { /* iOS PWA may not support this */ }
    }
  }

  // ---- Audio ----

  let audioCtx = null;

  function playNotificationSound() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      // Two-tone chime
      playTone(audioCtx, 660, 0, 0.15);
      playTone(audioCtx, 880, 0.18, 0.15);
      playTone(audioCtx, 660, 0.4, 0.2);
    } catch (_) { /* audio not available */ }
  }

  function playTone(ctx, freq, startOffset, duration) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + startOffset);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startOffset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + duration);
  }

  // ---- Visibility Change (iOS background handling) ----

  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && state.running) {
      // Recalculate on return to foreground
      tick();
      updateTimerDisplay();
      updateRing();
    }
  }

  // ---- Settings Panel ----

  function openSettings() {
    el.settingsOverlay.classList.add('open');
  }

  function closeSettings() {
    el.settingsOverlay.classList.remove('open');
  }

  function clampDuration(val) {
    return Math.min(90, Math.max(1, Math.round(val) || 1));
  }

  function handleStepper(e) {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;

    const target = btn.dataset.target;
    const dir = parseInt(btn.dataset.dir, 10);

    state.settings[target] = clampDuration(state.settings[target] + dir);
    saveSettings();
    syncSettingsUI();
    refreshTimerIfIdle();
  }

  function handleDurationInput(e) {
    const input = e.target;
    const key = input.id; // workDuration, shortBreakDuration, longBreakDuration
    if (!state.settings.hasOwnProperty(key)) return;

    state.settings[key] = clampDuration(parseInt(input.value, 10));
    saveSettings();
    refreshTimerIfIdle();
  }

  function handleDurationBlur(e) {
    // Ensure displayed value matches clamped state on blur
    const input = e.target;
    const key = input.id;
    if (state.settings.hasOwnProperty(key)) {
      input.value = state.settings[key];
    }
  }

  function handleLongBreakToggle() {
    state.settings.longBreakEnabled = !state.settings.longBreakEnabled;
    saveSettings();
    syncLongBreakToggle();
  }

  function refreshTimerIfIdle() {
    if (!state.running && state.endTime === null) {
      state.timeRemaining = getPhaseDuration(state.phase);
      updateTimerDisplay();
      updateRing();
    }
  }

  // ---- Event Binding ----

  function bindEvents() {
    el.startPauseBtn.addEventListener('click', () => {
      state.running ? pauseTimer() : startTimer();
    });
    el.resetBtn.addEventListener('click', resetTimer);
    el.skipBtn.addEventListener('click', skipPhase);

    el.settingsBtn.addEventListener('click', openSettings);
    el.settingsClose.addEventListener('click', closeSettings);
    el.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === el.settingsOverlay) closeSettings();
    });

    el.settingsPanel.addEventListener('click', handleStepper);

    // Duration inputs — typing support
    [el.workDuration, el.shortBreakDuration, el.longBreakDuration].forEach((input) => {
      input.addEventListener('input', handleDurationInput);
      input.addEventListener('blur', handleDurationBlur);
    });

    // Long break toggle
    el.longBreakToggle.addEventListener('click', handleLongBreakToggle);

    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // ---- Service Worker ----

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ---- Boot ----

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
