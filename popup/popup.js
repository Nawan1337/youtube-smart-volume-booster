/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Popup Logic (v1.1.5 - Steppers -0.25/+0.25, Crans x1-x10, Silent Error Handling)
 */

document.addEventListener('DOMContentLoaded', () => {
  const powerToggle = document.getElementById('powerToggle');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const gainBadge = document.getElementById('gainBadge');
  const meterBar = document.getElementById('meterBar');
  const meterMarker = document.getElementById('meterMarker');

  const videoTitleText = document.getElementById('videoTitleText');
  const customVideoToggle = document.getElementById('customVideoToggle');
  const customSliderGroup = document.getElementById('customSliderGroup');
  const customGainSlider = document.getElementById('customGainSlider');
  const customGainVal = document.getElementById('customGainVal');
  const resetVideoBtn = document.getElementById('resetVideoBtn');

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
  const stepTickButtons = document.querySelectorAll('.step-tick');
  const stepperButtons = document.querySelectorAll('.stepper-btn');

  let targetTabId = null;
  let currentVideoId = null;
  let currentVideoTitle = '';
  let pollInterval = null;
  let consecutiveErrors = 0;

  let globalConfig = {
    enabled: true,
    mode: 'auto',
    maxBoost: 3.5,
    targetLevel: 0.15,
    manualGain: 2.0,
    limiter: true
  };

  // Find the real YouTube tab
  findYouTubeTab((tab) => {
    if (!tab) {
      markDisconnected('Ouvrez YouTube / YT Music');
      return;
    }
    targetTabId = tab.id;
    connectToTab(tab);
  });

  function findYouTubeTab(callback) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs[0] && isYouTubeUrl(tabs[0].url)) {
        return callback(tabs[0]);
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
        if (tabs2 && tabs2[0] && isYouTubeUrl(tabs2[0].url)) {
          return callback(tabs2[0]);
        }
        chrome.tabs.query({ url: ['*://*.youtube.com/*', '*://youtube.com/*', '*://music.youtube.com/*'] }, (ytTabs) => {
          if (ytTabs && ytTabs.length > 0) {
            const chosen = ytTabs.find(t => t.audible) || ytTabs.find(t => t.active) || ytTabs[0];
            return callback(chosen);
          }
          callback(null);
        });
      });
    });
  }

  function isYouTubeUrl(url) {
    if (!url) return false;
    return url.includes('youtube.com') || url.includes('music.youtube.com');
  }

  function connectToTab(tab) {
    if (!tab || !tab.id) {
      markDisconnected('Ouvrez YouTube / YT Music');
      return;
    }

    const tabId = tab.id;
    statusText.textContent = 'Connexion...';

    chrome.storage.sync.get(['ytBoosterConfig'], (result) => {
      if (result && result.ytBoosterConfig) {
        globalConfig = Object.assign(globalConfig, result.ytBoosterConfig);
      }
      renderGlobalConfigUI();
    });

    // Check that we only interact if on YouTube to avoid host permissions error
    if (!isYouTubeUrl(tab.url)) {
      markDisconnected('Ouvrez YouTube / YT Music');
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        // Content script might need to be injected dynamically
        if (chrome.scripting) {
          chrome.scripting.executeScript(
            { target: { tabId: tabId }, files: ['content.js'] },
            () => {
              if (chrome.runtime.lastError) {
                // Must read lastError to prevent "Unchecked runtime.lastError"
                markDisconnected('Actualisez YouTube (F5)');
                return;
              }
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (res2) => {
                  if (chrome.runtime.lastError || !res2) {
                    markDisconnected('Actualisez YouTube (F5)');
                  } else {
                    onConnected(res2);
                  }
                });
              }, 250);
            }
          );
        } else {
          markDisconnected('Actualisez YouTube (F5)');
        }
      } else {
        onConnected(res);
      }
    });
  }

  function markDisconnected(msg) {
    statusDot.className = 'dot';
    statusText.textContent = msg;
    gainBadge.textContent = 'Inactif';
    gainBadge.className = 'gain-badge';
    meterBar.style.width = '0%';
  }

  function onConnected(metrics) {
    consecutiveErrors = 0;
    statusDot.className = 'dot connected';
    statusText.textContent = metrics.isPlaying ? 'Audio actif' : 'Lecteur prêt';

    updateVideoCard(metrics);
    startPolling();
  }

  function formatGainLabel(val) {
    const num = parseFloat(val);
    const formatted = (num % 1 === 0) ? num.toFixed(1) : (num % 0.1 === 0 ? num.toFixed(1) : num.toFixed(2));
    const dB = 20 * Math.log10(num);
    const sign = dB >= 0 ? '+' : '';
    return `x${formatted} (${sign}${dB.toFixed(1)} dB)`;
  }

  function renderGlobalConfigUI() {
    powerToggle.checked = globalConfig.enabled;
    limiterCheck.checked = globalConfig.limiter;

    maxBoostSlider.value = globalConfig.maxBoost;
    maxBoostVal.textContent = formatGainLabel(globalConfig.maxBoost);

    manualGainSlider.value = globalConfig.manualGain;
    manualGainVal.textContent = formatGainLabel(globalConfig.manualGain);

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

  function updateVideoCard(metrics) {
    if (metrics.videoId) {
      currentVideoId = metrics.videoId;
      currentVideoTitle = metrics.videoTitle || 'Vidéo YouTube';
      videoTitleText.textContent = currentVideoTitle;
      videoTitleText.title = currentVideoTitle;

      if (metrics.hasCustomForThisVideo) {
        customVideoToggle.checked = true;
        customSliderGroup.classList.remove('hidden');
        customGainSlider.value = metrics.customGainForThisVideo;
        customGainVal.textContent = formatGainLabel(metrics.customGainForThisVideo);
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

  // Instant Dual-Sync (Storage + Message)
  function sendConfigUpdate(newPartial) {
    globalConfig = Object.assign(globalConfig, newPartial);
    chrome.storage.sync.set({ ytBoosterConfig: globalConfig });

    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        type: 'UPDATE_CONFIG',
        config: globalConfig
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  }

  function sendCustomVideoUpdate(enabled, gain) {
    if (!currentVideoId) return;

    chrome.storage.sync.get(['ytCustomVideos'], (res) => {
      let customVideos = (res && res.ytCustomVideos) ? res.ytCustomVideos : {};
      if (enabled) {
        customVideos[currentVideoId] = {
          gain: parseFloat(gain) || 2.0,
          title: currentVideoTitle || 'Vidéo YouTube',
          enabled: true,
          updatedAt: Date.now()
        };
      } else {
        delete customVideos[currentVideoId];
      }
      chrome.storage.sync.set({ ytCustomVideos: customVideos });
    });

    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        type: 'SET_CUSTOM_VIDEO',
        videoId: currentVideoId,
        title: currentVideoTitle,
        enabled: enabled,
        gain: gain
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(() => {
      if (!targetTabId) return;

      chrome.tabs.sendMessage(targetTabId, { type: 'GET_METRICS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          consecutiveErrors++;
          if (consecutiveErrors > 3) {
            markDisconnected('Lecteur en pause / en chargement');
          }
          return;
        }

        consecutiveErrors = 0;
        statusDot.className = res.connected ? 'dot connected' : 'dot';
        statusText.textContent = res.connected
          ? (res.isPlaying ? 'Audio actif' : 'En pause')
          : 'Lecteur détecté';

        const gainVal = res.currentGain || 1.0;
        const dBStr = formatGainLabel(gainVal);

        if (!res.enabled) {
          gainBadge.className = 'gain-badge';
          gainBadge.textContent = 'Désactivé';
          gainBadge.style.color = '#8e8e9a';
        } else if (res.hasCustomForThisVideo) {
          gainBadge.className = 'gain-badge custom';
          gainBadge.textContent = `⭐ ${dBStr}`;
          gainBadge.style.color = '';
        } else if (gainVal > 1.05) {
          gainBadge.className = 'gain-badge boosted';
          gainBadge.textContent = dBStr;
          gainBadge.style.color = '';
        } else {
          gainBadge.className = 'gain-badge';
          gainBadge.textContent = `x1.0 (0 dB)`;
          gainBadge.style.color = '#00d284';
        }

        if (res.enabled && res.isPlaying) {
          const rmsPct = Math.min((res.currentRMS / 0.35) * 100, 100);
          meterBar.style.width = `${rmsPct.toFixed(1)}%`;
        } else {
          meterBar.style.width = '0%';
        }

        if (res.videoId && res.videoId !== currentVideoId) {
          updateVideoCard(res);
        }
      });
    }, 100);
  }

  // --- User Actions ---
  powerToggle.addEventListener('change', (e) => {
    sendConfigUpdate({ enabled: e.target.checked });
  });

  customVideoToggle.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      customSliderGroup.classList.remove('hidden');
      const val = parseFloat(customGainSlider.value) || 2.25;
      customGainVal.textContent = formatGainLabel(val);
      sendCustomVideoUpdate(true, val);
    } else {
      customSliderGroup.classList.add('hidden');
      sendCustomVideoUpdate(false, 1.0);
    }
  });

  customGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    customGainVal.textContent = formatGainLabel(val);
    sendCustomVideoUpdate(true, val);
  });

  resetVideoBtn.addEventListener('click', () => {
    customVideoToggle.checked = false;
    customSliderGroup.classList.add('hidden');
    sendCustomVideoUpdate(false, 1.0);
  });

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

  maxBoostSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    maxBoostVal.textContent = formatGainLabel(val);
    presetButtons.forEach((b) => b.classList.remove('active'));
    sendConfigUpdate({ maxBoost: val });
  });

  manualGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    manualGainVal.textContent = formatGainLabel(val);
    sendConfigUpdate({ manualGain: val });
  });

  limiterCheck.addEventListener('change', (e) => {
    sendConfigUpdate({ limiter: e.target.checked });
  });

  // Clickable Crans (x1, x2, x4, x6, x8, x10)
  stepTickButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetInputId = btn.dataset.targetInput;
      const val = parseFloat(btn.dataset.val);
      const input = document.getElementById(targetInputId);
      if (!input) return;

      input.value = val;

      if (targetInputId === 'customGainSlider') {
        customGainVal.textContent = formatGainLabel(val);
        sendCustomVideoUpdate(true, val);
      } else if (targetInputId === 'maxBoostSlider') {
        maxBoostVal.textContent = formatGainLabel(val);
        presetButtons.forEach((b) => b.classList.remove('active'));
        sendConfigUpdate({ maxBoost: val });
      } else if (targetInputId === 'manualGainSlider') {
        manualGainVal.textContent = formatGainLabel(val);
        sendConfigUpdate({ manualGain: val });
      }
    });
  });

  // Stepper Buttons (-0.25 and +0.25)
  stepperButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetInputId = btn.dataset.targetInput;
      const step = parseFloat(btn.dataset.step) || 0.25;
      const input = document.getElementById(targetInputId);
      if (!input) return;

      let current = parseFloat(input.value) || 1.0;
      let nextVal = Math.round((current + step) * 100) / 100;
      const minVal = parseFloat(input.min) || 1.0;
      const maxVal = parseFloat(input.max) || 10.0;

      nextVal = Math.min(Math.max(nextVal, minVal), maxVal);
      input.value = nextVal;

      if (targetInputId === 'customGainSlider') {
        customGainVal.textContent = formatGainLabel(nextVal);
        sendCustomVideoUpdate(true, nextVal);
      } else if (targetInputId === 'maxBoostSlider') {
        maxBoostVal.textContent = formatGainLabel(nextVal);
        presetButtons.forEach((b) => b.classList.remove('active'));
        sendConfigUpdate({ maxBoost: nextVal });
      } else if (targetInputId === 'manualGainSlider') {
        manualGainVal.textContent = formatGainLabel(nextVal);
        sendConfigUpdate({ manualGain: nextVal });
      }
    });
  });

  // Presets
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = parseFloat(btn.dataset.target);
      const maxB = parseFloat(btn.dataset.max);
      maxBoostSlider.value = maxB;
      maxBoostVal.textContent = formatGainLabel(maxB);
      const markerPct = Math.min(Math.max((target / 0.35) * 100, 10), 90);
      meterMarker.style.left = `${markerPct}%`;
      sendConfigUpdate({ targetLevel: target, maxBoost: maxB, mode: 'auto' });
    });
  });
});
