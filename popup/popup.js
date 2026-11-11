/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Popup Logic (v1.1.0 with Per-Video Memory & Realtime Sliders)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const powerToggle = document.getElementById('powerToggle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const gainBadge = document.getElementById('gainBadge');
  const meterBar = document.getElementById('meterBar');
  const meterMarker = document.getElementById('meterMarker');

  // Video Card Elements
  const videoTitleText = document.getElementById('videoTitleText');
  const customVideoToggle = document.getElementById('customVideoToggle');
  const customSliderGroup = document.getElementById('customSliderGroup');
  const customGainSlider = document.getElementById('customGainSlider');
  const customGainVal = document.getElementById('customGainVal');
  const resetVideoBtn = document.getElementById('resetVideoBtn');

  // Global Controls
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
  let currentVideoId = null;
  let currentVideoTitle = '';
  let pollInterval = null;

  let globalConfig = {
    enabled: true,
    mode: 'auto',
    maxBoost: 3.0,
    targetLevel: 0.15,
    manualGain: 1.8,
    limiter: true
  };

  // 1. Identify active tab and connect
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    activeTabId = tab.id;

    const isYouTube = tab.url && (tab.url.includes('youtube.com') || tab.url.includes('music.youtube.com'));

    // Try communicating directly with content script
    pingAndConnect(tab.id, isYouTube);
  });

  function pingAndConnect(tabId, isYouTube) {
    chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        // Content script might not be injected yet (e.g. tab opened before extension installed)
        if (isYouTube && chrome.scripting) {
          statusText.textContent = 'Connexion au lecteur...';
          chrome.scripting.executeScript(
            {
              target: { tabId: tabId },
              files: ['content.js']
            },
            () => {
              // Retry ping after injection
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (res2) => {
                  if (res2) {
                    onConnected(res2);
                  } else {
                    markDisconnected('Actualisez la page YouTube (F5)');
                  }
                });
              }, 200);
            }
          );
        } else {
          markDisconnected('Ouvrez YouTube / YT Music');
        }
      } else {
        onConnected(response);
      }
    });
  }

  function markDisconnected(msg) {
    statusDot.className = 'dot';
    statusText.textContent = msg;
    gainBadge.textContent = 'Inactif';
    gainBadge.className = 'gain-badge';
    meterBar.style.width = '0%';
    videoTitleText.textContent = 'Aucune vidéo active';
  }

  function onConnected(metrics) {
    statusDot.className = 'dot connected';
    statusText.textContent = metrics.isPlaying ? 'Audio actif' : 'Lecteur prêt';

    // Load initial settings
    chrome.storage.sync.get(['ytBoosterConfig'], (result) => {
      if (result && result.ytBoosterConfig) {
        globalConfig = Object.assign(globalConfig, result.ytBoosterConfig);
      }
      renderGlobalConfigUI();
    });

    updateVideoCard(metrics);
    startPolling();
  }

  // 2. Render UI for Global settings
  function renderGlobalConfigUI() {
    powerToggle.checked = globalConfig.enabled;
    limiterCheck.checked = globalConfig.limiter;

    maxBoostSlider.value = globalConfig.maxBoost;
    maxBoostVal.textContent = `x${parseFloat(globalConfig.maxBoost).toFixed(1)}`;

    manualGainSlider.value = globalConfig.manualGain;
    manualGainVal.textContent = `x${parseFloat(globalConfig.manualGain).toFixed(1)}`;

    if (globalConfig.mode === 'auto') {
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

    const markerPct = Math.min(Math.max((globalConfig.targetLevel / 0.35) * 100, 10), 90);
    meterMarker.style.left = `${markerPct}%`;
  }

  // 3. Update Video Card UI
  function updateVideoCard(metrics) {
    if (metrics.videoId) {
      currentVideoId = metrics.videoId;
      currentVideoTitle = metrics.videoTitle || 'Vidéo en cours';
      videoTitleText.textContent = currentVideoTitle;
      videoTitleText.title = currentVideoTitle;

      if (metrics.hasCustomForThisVideo) {
        customVideoToggle.checked = true;
        customSliderGroup.classList.remove('hidden');
        customGainSlider.value = metrics.customGainForThisVideo;
        const dB = (20 * Math.log10(metrics.customGainForThisVideo)).toFixed(1);
        customGainVal.textContent = `x${parseFloat(metrics.customGainForThisVideo).toFixed(1)} (+${dB} dB)`;
      } else {
        customVideoToggle.checked = false;
        customSliderGroup.classList.add('hidden');
      }
    } else {
      videoTitleText.textContent = 'En attente de lecture...';
      customVideoToggle.checked = false;
      customSliderGroup.classList.add('hidden');
    }
  }

  // 4. Send Instant Config Update
  function sendConfigUpdate(newPartial) {
    globalConfig = Object.assign(globalConfig, newPartial);
    chrome.storage.sync.set({ ytBoosterConfig: globalConfig });

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'UPDATE_CONFIG',
        config: globalConfig
      });
    }
  }

  // 5. Send Per-Video Custom Update
  function sendCustomVideoUpdate(enabled, gain) {
    if (!activeTabId || !currentVideoId) return;

    chrome.tabs.sendMessage(activeTabId, {
      type: 'SET_CUSTOM_VIDEO',
      videoId: currentVideoId,
      title: currentVideoTitle,
      enabled: enabled,
      gain: gain
    });
  }

  // 6. Real-time Metric Polling
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(() => {
      if (!activeTabId) return;

      chrome.tabs.sendMessage(activeTabId, { type: 'GET_METRICS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          markDisconnected('Lecteur en pause / hors ligne');
          return;
        }

        statusDot.className = res.connected ? 'dot connected' : 'dot';
        statusText.textContent = res.connected
          ? (res.isPlaying ? 'Audio actif' : 'En pause')
          : 'Lecteur détecté';

        // Gain Badge
        const gainVal = res.currentGain || 1.0;
        const dB = 20 * Math.log10(gainVal);
        const dBStr = `${dB >= 0 ? '+' : ''}${dB.toFixed(1)} dB`;

        if (!res.enabled) {
          gainBadge.className = 'gain-badge';
          gainBadge.textContent = 'Désactivé';
          gainBadge.style.color = '#8e8e9a';
        } else if (res.hasCustomForThisVideo) {
          gainBadge.className = 'gain-badge custom';
          gainBadge.textContent = `⭐ x${gainVal.toFixed(1)} (${dBStr})`;
          gainBadge.style.color = '';
        } else if (gainVal > 1.05) {
          gainBadge.className = 'gain-badge boosted';
          gainBadge.textContent = `x${gainVal.toFixed(1)} (${dBStr})`;
          gainBadge.style.color = '';
        } else {
          gainBadge.className = 'gain-badge';
          gainBadge.textContent = `x1.0 (0 dB)`;
          gainBadge.style.color = '#00d284';
        }

        // Realtime VU-Meter
        if (res.enabled && res.isPlaying) {
          const rmsPct = Math.min((res.currentRMS / 0.35) * 100, 100);
          meterBar.style.width = `${rmsPct.toFixed(1)}%`;
        } else {
          meterBar.style.width = '0%';
        }

        // Update video title if track changed in playlist
        if (res.videoId && res.videoId !== currentVideoId) {
          updateVideoCard(res);
        }
      });
    }, 100);
  }

  // --- Event Listeners ---

  // Power switch
  powerToggle.addEventListener('change', (e) => {
    sendConfigUpdate({ enabled: e.target.checked });
  });

  // Per-video toggle
  customVideoToggle.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      customSliderGroup.classList.remove('hidden');
      const val = parseFloat(customGainSlider.value) || 2.2;
      const dB = (20 * Math.log10(val)).toFixed(1);
      customGainVal.textContent = `x${val.toFixed(1)} (+${dB} dB)`;
      sendCustomVideoUpdate(true, val);
    } else {
      customSliderGroup.classList.add('hidden');
      sendCustomVideoUpdate(false, 1.0);
    }
  });

  // Per-video slider (Instant real-time audio update on drag)
  customGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const dB = (20 * Math.log10(val)).toFixed(1);
    customGainVal.textContent = `x${val.toFixed(1)} (+${dB} dB)`;
    sendCustomVideoUpdate(true, val);
  });

  // Reset per-video button
  resetVideoBtn.addEventListener('click', () => {
    customVideoToggle.checked = false;
    customSliderGroup.classList.add('hidden');
    sendCustomVideoUpdate(false, 1.0);
  });

  // Global Tabs
  tabAuto.addEventListener('click', () => {
    tabAuto.classList.add('active');
    tabManual.classList.remove('active');
    panelAuto.classList.remove('hidden');
    panelManual.classList.add('hidden');
    sendConfigUpdate({ mode: 'auto' });
  });

  tabManual.addEventListener('click', () => {
    tabManual.classList.add('active');
    tabAuto.classList.remove('active');
    panelManual.classList.remove('hidden');
    panelAuto.classList.add('hidden');
    sendConfigUpdate({ mode: 'manual' });
  });

  // Global Boost Slider (Instant real-time update)
  maxBoostSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    maxBoostVal.textContent = `x${val.toFixed(1)}`;
    presetButtons.forEach((b) => b.classList.remove('active'));
    sendConfigUpdate({ maxBoost: val });
  });

  // Global Manual Gain Slider (Instant real-time update)
  manualGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    manualGainVal.textContent = `x${val.toFixed(1)}`;
    sendConfigUpdate({ manualGain: val });
  });

  // Limiter check
  limiterCheck.addEventListener('change', (e) => {
    sendConfigUpdate({ limiter: e.target.checked });
  });

  // Quick presets
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = parseFloat(btn.dataset.target);
      const maxB = parseFloat(btn.dataset.max);

      maxBoostSlider.value = maxB;
      maxBoostVal.textContent = `x${maxB.toFixed(1)}`;

      const markerPct = Math.min(Math.max((target / 0.35) * 100, 10), 90);
      meterMarker.style.left = `${markerPct}%`;

      sendConfigUpdate({
        targetLevel: target,
        maxBoost: maxB,
        mode: 'auto'
      });
    });
  });
});
