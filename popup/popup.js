/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const powerToggle = document.getElementById('powerToggle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const gainBadge = document.getElementById('gainBadge');
  const meterBar = document.getElementById('meterBar');
  const meterMarker = document.getElementById('meterMarker');

  const tabAuto = document.getElementById('tabAuto');
  const tabManual = document.getElementById('tabManual');
  const panelAuto = document.getElementById('panelAuto');
  const panelManual = document.getElementById('panelManual');

  const maxBoostSlider = document.getElementById('maxBoostSlider');
  const maxBoostVal = document.getElementById('maxBoostVal');

  const manualGainSlider = document.getElementById('manualGainSlider');
  const manualGainVal = document.getElementById('manualGainVal');

  const limiterCheck = document.getElementById('limiterCheck');
  const presetButtons = document.querySelectorAll('.preset-btn');

  let activeTabId = null;
  let pollInterval = null;
  let currentConfig = {
    enabled: true,
    mode: 'auto',
    maxBoost: 3.0,
    targetLevel: 0.15,
    manualGain: 1.8,
    limiter: true
  };

  // Find active YouTube tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    const isYouTube = tab.url && (tab.url.includes('youtube.com') || tab.url.includes('music.youtube.com'));

    if (isYouTube) {
      activeTabId = tab.id;
      initControls();
      startPolling();
    } else {
      statusDot.className = 'dot';
      statusText.textContent = 'Ouvrez YouTube / YT Music';
      gainBadge.textContent = 'Inactif';
      meterBar.style.width = '0%';
    }
  });

  // Initialize controls state from storage
  function initControls() {
    chrome.storage.sync.get(['ytBoosterConfig'], (result) => {
      if (result && result.ytBoosterConfig) {
        currentConfig = Object.assign(currentConfig, result.ytBoosterConfig);
      }
      renderConfigUI();
    });
  }

  // Render UI according to config
  function renderConfigUI() {
    powerToggle.checked = currentConfig.enabled;
    limiterCheck.checked = currentConfig.limiter;

    maxBoostSlider.value = currentConfig.maxBoost;
    maxBoostVal.textContent = `x${parseFloat(currentConfig.maxBoost).toFixed(1)}`;

    manualGainSlider.value = currentConfig.manualGain;
    manualGainVal.textContent = `x${parseFloat(currentConfig.manualGain).toFixed(1)}`;

    // Tab mode
    if (currentConfig.mode === 'auto') {
      tabAuto.classList.add('active');
      tabManual.classList.remove('active');
      panelAuto.classList.remove('hidden');
      panelManual.classList.add('hidden');
    } else {
      tabManual.classList.add('active');
      tabAuto.classList.remove('active');
      panelManual.classList.remove('hidden');
      panelAuto.classList.add('hidden');
    }

    // Marker position based on targetLevel
    // 0.15 translates to ~45% width on the bar
    const markerPct = Math.min(Math.max((currentConfig.targetLevel / 0.35) * 100, 10), 90);
    meterMarker.style.left = `${markerPct}%`;
  }

  // Send config update to content script and save in storage
  function updateConfig(newPartial) {
    currentConfig = Object.assign(currentConfig, newPartial);
    chrome.storage.sync.set({ ytBoosterConfig: currentConfig });

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'UPDATE_CONFIG',
        config: currentConfig
      }, () => {
        if (chrome.runtime.lastError) {
          // Tab may be refreshing
        }
      });
    }
  }

  // Start polling metrics from YouTube content script
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(() => {
      if (!activeTabId) return;

      chrome.tabs.sendMessage(activeTabId, { type: 'GET_METRICS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          statusDot.className = 'dot';
          statusText.textContent = 'En attente de la vidéo';
          gainBadge.textContent = 'x1.0';
          gainBadge.className = 'gain-badge';
          meterBar.style.width = '0%';
          return;
        }

        // Status indicator
        statusDot.className = res.connected ? 'dot connected' : 'dot';
        statusText.textContent = res.connected
          ? (res.isPlaying ? 'Audio actif' : 'En pause')
          : 'Lecteur détecté';

        // Gain Badge
        const gainVal = res.currentGain || 1.0;
        const dB = 20 * Math.log10(gainVal);
        gainBadge.textContent = `x${gainVal.toFixed(1)} (${dB >= 0 ? '+' : ''}${dB.toFixed(1)} dB)`;

        if (!res.enabled) {
          gainBadge.className = 'gain-badge';
          gainBadge.textContent = 'Désactivé';
          gainBadge.style.color = '#8e8e9a';
        } else if (gainVal > 1.05) {
          gainBadge.className = 'gain-badge boosted';
          gainBadge.style.color = '';
        } else {
          gainBadge.className = 'gain-badge';
          gainBadge.style.color = '#00d284';
        }

        // VU-Meter animation
        if (res.enabled && res.isPlaying) {
          const rmsPct = Math.min((res.currentRMS / 0.35) * 100, 100);
          meterBar.style.width = `${rmsPct.toFixed(1)}%`;
        } else {
          meterBar.style.width = '0%';
        }
      });
    }, 120);
  }

  // Event Listeners
  powerToggle.addEventListener('change', (e) => {
    updateConfig({ enabled: e.target.checked });
  });

  tabAuto.addEventListener('click', () => {
    tabAuto.classList.add('active');
    tabManual.classList.remove('active');
    panelAuto.classList.remove('hidden');
    panelManual.classList.add('hidden');
    updateConfig({ mode: 'auto' });
  });

  tabManual.addEventListener('click', () => {
    tabManual.classList.add('active');
    tabAuto.classList.remove('active');
    panelManual.classList.remove('hidden');
    panelAuto.classList.add('hidden');
    updateConfig({ mode: 'manual' });
  });

  maxBoostSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    maxBoostVal.textContent = `x${val.toFixed(1)}`;
    presetButtons.forEach(btn => btn.classList.remove('active'));
    updateConfig({ maxBoost: val });
  });

  manualGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    manualGainVal.textContent = `x${val.toFixed(1)}`;
    updateConfig({ manualGain: val });
  });

  limiterCheck.addEventListener('change', (e) => {
    updateConfig({ limiter: e.target.checked });
  });

  // Presets
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = parseFloat(btn.dataset.target);
      const maxB = parseFloat(btn.dataset.max);

      maxBoostSlider.value = maxB;
      maxBoostVal.textContent = `x${maxB.toFixed(1)}`;

      const markerPct = Math.min(Math.max((target / 0.35) * 100, 10), 90);
      meterMarker.style.left = `${markerPct}%`;

      updateConfig({
        targetLevel: target,
        maxBoost: maxB,
        mode: 'auto'
      });
    });
  });
});
