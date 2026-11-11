/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Popup Logic (v1.1.1 - Bulletproof YouTube Tab Discovery & Dual Sync)
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

  let targetTabId = null;
  let currentVideoId = null;
  let currentVideoTitle = '';
  let pollInterval = null;
  let consecutiveErrors = 0;

  let globalConfig = {
    enabled: true,
    mode: 'auto',
    maxBoost: 3.0,
    targetLevel: 0.15,
    manualGain: 1.8,
    limiter: true
  };

  // Find the real YouTube tab (Active window, or any audible/active YouTube tab)
  findYouTubeTab((tab) => {
    if (!tab) {
      markDisconnected('Ouvrez YouTube / YT Music');
      return;
    }
    targetTabId = tab.id;
    connectToTab(tab.id);
  });

  function findYouTubeTab(callback) {
    // 1. Try active tab in last focused window
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs[0] && isYouTubeUrl(tabs[0].url)) {
        return callback(tabs[0]);
      }
      // 2. Try active tab in any current window
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
        if (tabs2 && tabs2[0] && isYouTubeUrl(tabs2[0].url)) {
          return callback(tabs2[0]);
        }
        // 3. Fallback: find any open YouTube tab (prioritize audible/playing tabs)
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

  function connectToTab(tabId) {
    statusText.textContent = 'Connexion...';

    // Load initial settings from storage
    chrome.storage.sync.get(['ytBoosterConfig'], (result) => {
      if (result && result.ytBoosterConfig) {
        globalConfig = Object.assign(globalConfig, result.ytBoosterConfig);
      }
      renderGlobalConfigUI();
    });

    // Ping content script
    chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        // Content script might need to be injected dynamically
        if (chrome.scripting) {
          chrome.scripting.executeScript(
            { target: { tabId: tabId }, files: ['content.js'] },
            () => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type: 'GET_METRICS' }, (res2) => {
                  if (res2) {
                    onConnected(res2);
                  } else {
                    markDisconnected('Actualisez YouTube (F5)');
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

    // Update storage directly
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

  // User Actions
  powerToggle.addEventListener('change', (e) => {
    sendConfigUpdate({ enabled: e.target.checked });
  });

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

  customGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    const dB = (20 * Math.log10(val)).toFixed(1);
    customGainVal.textContent = `x${val.toFixed(1)} (+${dB} dB)`;
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
    maxBoostVal.textContent = `x${val.toFixed(1)}`;
    presetButtons.forEach((b) => b.classList.remove('active'));
    sendConfigUpdate({ maxBoost: val });
  });

  manualGainSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    manualGainVal.textContent = `x${val.toFixed(1)}`;
    sendConfigUpdate({ manualGain: val });
  });

  limiterCheck.addEventListener('change', (e) => {
    sendConfigUpdate({ limiter: e.target.checked });
  });

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
      sendConfigUpdate({ targetLevel: target, maxBoost: maxB, mode: 'auto' });
    });
  });
});
