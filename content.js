/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Version 1.1.0 with Per-Video Memory & Real-time Live Controls
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__yt_smart_booster_loaded) {
    console.log('[SmartBooster] Already loaded in this tab.');
    return;
  }
  window.__yt_smart_booster_loaded = true;

  // Global settings
  let config = {
    enabled: true,
    mode: 'auto', // 'auto' or 'manual'
    maxBoost: 3.0,
    targetLevel: 0.15,
    manualGain: 1.8,
    limiter: true
  };

  // Per-video custom settings: { [videoId]: { gain: 2.2, title: '...', enabled: true } }
  let customVideos = {};

  // Audio nodes and context
  let audioCtx = null;
  let sourceNode = null;
  let currentMediaEl = null;

  let masterGainNode = null;
  let agcGainNode = null;
  let compressorNode = null;
  let limiterNode = null;
  let analyserNode = null;

  // Real-time metrics
  let currentRMS = 0;
  let currentGainValue = 1.0;
  let isMediaPlaying = false;
  let agcLoopId = null;
  let pcmData = null;
  let currentVideoId = null;
  let currentVideoTitle = '';

  // Extract current video ID and Title from YouTube / YouTube Music
  function detectCurrentVideo() {
    try {
      const url = new URL(window.location.href);
      let vId = url.searchParams.get('v');
      if (!vId && url.pathname.startsWith('/shorts/')) {
        vId = url.pathname.split('/shorts/')[1]?.split('?')[0];
      }

      // Title detection
      let title = '';
      const titleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, #above-the-fold #title h1 yt-formatted-string, ytmusic-player-bar .title, #content h1.title'
      );
      if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
        title = titleEl.textContent.trim();
      } else {
        title = document.title.replace(' - YouTube', '').replace(' - YouTube Music', '').trim();
      }

      if (vId) {
        currentVideoId = vId;
      }
      if (title && title !== 'YouTube' && title !== 'YouTube Music') {
        currentVideoTitle = title;
      }
    } catch (e) {
      // ignore
    }
    return { videoId: currentVideoId, title: currentVideoTitle };
  }

  // Load configuration and per-video settings
  function loadSettings(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['ytBoosterConfig', 'ytCustomVideos'], (result) => {
        if (result && result.ytBoosterConfig) {
          config = Object.assign(config, result.ytBoosterConfig);
        }
        if (result && result.ytCustomVideos) {
          customVideos = Object.assign(customVideos, result.ytCustomVideos);
        }
        applyGainImmediately();
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  // Save global config
  function saveConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ ytBoosterConfig: config });
    }
  }

  // Save custom video setting
  function saveCustomVideos() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ ytCustomVideos: customVideos });
    }
  }

  // Audio Context initialization
  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Attach Web Audio API to media element
  function setupAudioGraph(mediaEl) {
    if (!mediaEl) return false;
    if (mediaEl.__smartBoosterHooked && sourceNode) return true;

    try {
      const ctx = getAudioContext();

      sourceNode = ctx.createMediaElementSource(mediaEl);
      mediaEl.__smartBoosterHooked = true;
      currentMediaEl = mediaEl;

      // Master Gain Node
      masterGainNode = ctx.createGain();
      masterGainNode.gain.value = 1.0;

      // AGC Dynamic Gain Node
      agcGainNode = ctx.createGain();
      agcGainNode.gain.value = 1.0;

      // Dynamic Studio Compressor
      compressorNode = ctx.createDynamicsCompressor();
      compressorNode.threshold.setValueAtTime(-16, ctx.currentTime);
      compressorNode.knee.setValueAtTime(10, ctx.currentTime);
      compressorNode.ratio.setValueAtTime(6, ctx.currentTime);
      compressorNode.attack.setValueAtTime(0.003, ctx.currentTime);
      compressorNode.release.setValueAtTime(0.25, ctx.currentTime);

      // Brickwall Safety Limiter
      limiterNode = ctx.createDynamicsCompressor();
      limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime);
      limiterNode.knee.setValueAtTime(0, ctx.currentTime);
      limiterNode.ratio.setValueAtTime(20, ctx.currentTime);
      limiterNode.attack.setValueAtTime(0.001, ctx.currentTime);
      limiterNode.release.setValueAtTime(0.05, ctx.currentTime);

      // Analyser Node
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.25;
      pcmData = new Float32Array(analyserNode.fftSize);

      // Chain: Media -> MasterGain -> AGCGain -> Compressor -> Limiter -> Analyser -> Speakers
      sourceNode.connect(masterGainNode);
      masterGainNode.connect(agcGainNode);
      agcGainNode.connect(compressorNode);
      compressorNode.connect(limiterNode);
      limiterNode.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      // Media event listeners
      const onPlay = () => {
        isMediaPlaying = true;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        startAgcLoop();
      };

      const onPause = () => {
        isMediaPlaying = false;
      };

      const onTrackChange = () => {
        detectCurrentVideo();
        applyGainImmediately();
      };

      mediaEl.addEventListener('play', onPlay);
      mediaEl.addEventListener('playing', onPlay);
      mediaEl.addEventListener('pause', onPause);
      mediaEl.addEventListener('ended', onPause);
      mediaEl.addEventListener('loadstart', onTrackChange);

      if (!mediaEl.paused) {
        onPlay();
      }

      applyGainImmediately();
      startAgcLoop();
      console.log('[SmartBooster] Web Audio graph hooked successfully.');
      return true;
    } catch (err) {
      console.warn('[SmartBooster] Audio hook notice:', err);
      return false;
    }
  }

  // Determine if current video has custom setting
  function getCustomSettingForCurrentVideo() {
    detectCurrentVideo();
    if (currentVideoId && customVideos[currentVideoId] && customVideos[currentVideoId].enabled) {
      return customVideos[currentVideoId];
    }
    return null;
  }

  // Instant gain application (called in real-time when user drags a slider)
  function applyGainImmediately() {
    if (!audioCtx || !masterGainNode || !agcGainNode || !limiterNode) return;

    const now = audioCtx.currentTime;

    // Extension disabled completely
    if (!config.enabled) {
      masterGainNode.gain.cancelScheduledValues(now);
      masterGainNode.gain.setTargetAtTime(1.0, now, 0.02);
      agcGainNode.gain.cancelScheduledValues(now);
      agcGainNode.gain.setTargetAtTime(1.0, now, 0.02);
      limiterNode.ratio.setTargetAtTime(1.0, now, 0.02);
      currentGainValue = 1.0;
      return;
    }

    // Safety limiter
    limiterNode.ratio.setTargetAtTime(config.limiter ? 20.0 : 1.0, now, 0.02);

    const custom = getCustomSettingForCurrentVideo();
    if (custom) {
      // Per-video custom mode takes priority!
      const targetG = parseFloat(custom.gain) || 1.8;
      masterGainNode.gain.cancelScheduledValues(now);
      masterGainNode.gain.setTargetAtTime(targetG, now, 0.02);
      agcGainNode.gain.cancelScheduledValues(now);
      agcGainNode.gain.setTargetAtTime(1.0, now, 0.02);
      currentGainValue = targetG;
      return;
    }

    if (config.mode === 'manual') {
      // Manual fixed mode
      const manualG = parseFloat(config.manualGain) || 1.8;
      masterGainNode.gain.cancelScheduledValues(now);
      masterGainNode.gain.setTargetAtTime(manualG, now, 0.02);
      agcGainNode.gain.cancelScheduledValues(now);
      agcGainNode.gain.setTargetAtTime(1.0, now, 0.02);
      currentGainValue = manualG;
    } else {
      // Auto mode: masterGain is 1.0, agcGain is dynamic
      masterGainNode.gain.cancelScheduledValues(now);
      masterGainNode.gain.setTargetAtTime(1.0, now, 0.02);
    }
  }

  // Real-time AGC loop
  function startAgcLoop() {
    if (agcLoopId) return;

    let smoothedRms = config.targetLevel;

    function loop() {
      if (!config.enabled || !analyserNode || !audioCtx) {
        agcLoopId = requestAnimationFrame(loop);
        return;
      }

      // Check if media is playing
      if (currentMediaEl && (currentMediaEl.paused || currentMediaEl.muted)) {
        currentRMS = 0;
        agcLoopId = requestAnimationFrame(loop);
        return;
      }

      // Read audio data
      analyserNode.getFloatTimeDomainData(pcmData);

      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
      }
      const rawRms = Math.sqrt(sum / pcmData.length);
      currentRMS = rawRms;

      const custom = getCustomSettingForCurrentVideo();

      // Only run auto dynamic leveling if in AUTO mode and NOT in per-video custom mode
      if (config.mode === 'auto' && !custom && agcGainNode) {
        if (rawRms > 0.008) {
          smoothedRms = smoothedRms * 0.9 + rawRms * 0.1;
          const desiredGain = config.targetLevel / Math.max(smoothedRms, 0.005);
          const targetGain = Math.min(Math.max(desiredGain, 1.0), config.maxBoost);

          const now = audioCtx.currentTime;
          const currentVal = agcGainNode.gain.value;

          if (targetGain < currentVal) {
            // Loud sound detected: fast attack (50ms) to prevent blast
            agcGainNode.gain.setTargetAtTime(targetGain, now, 0.05);
          } else {
            // Quiet sound: smooth gentle release (400ms)
            agcGainNode.gain.setTargetAtTime(targetGain, now, 0.4);
          }
          currentGainValue = agcGainNode.gain.value;
        } else {
          // Silence or very low noise: decay toward 1.0
          const now = audioCtx.currentTime;
          agcGainNode.gain.setTargetAtTime(1.0, now, 0.8);
          currentGainValue = agcGainNode.gain.value;
        }
      }

      agcLoopId = requestAnimationFrame(loop);
    }

    agcLoopId = requestAnimationFrame(loop);
  }

  // Scan for <video> or <audio> in the page
  function scanAndHook() {
    const media = document.querySelector('video') || document.querySelector('audio');
    if (media && !media.__smartBoosterHooked) {
      setupAudioGraph(media);
    }
  }

  // Navigation and URL watchers
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      detectCurrentVideo();
      applyGainImmediately();
      scanAndHook();
    }
  }, 500);

  window.addEventListener('yt-navigate-finish', () => {
    detectCurrentVideo();
    applyGainImmediately();
    scanAndHook();
  });

  window.addEventListener('yt-page-data-updated', () => {
    detectCurrentVideo();
    scanAndHook();
  });

  // User gesture unlock for AudioContext
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  document.addEventListener('click', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio, { passive: true });

  // DOM MutationObserver
  const observer = new MutationObserver(() => {
    scanAndHook();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // Message Handler for Popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      detectCurrentVideo();

      if (message.type === 'GET_METRICS') {
        const custom = getCustomSettingForCurrentVideo();
        sendResponse({
          connected: !!sourceNode,
          enabled: config.enabled,
          mode: config.mode,
          currentRMS: currentRMS,
          currentGain: currentGainValue,
          maxBoost: config.maxBoost,
          targetLevel: config.targetLevel,
          manualGain: config.manualGain,
          limiter: config.limiter,
          isPlaying: isMediaPlaying,
          // Video info
          videoId: currentVideoId,
          videoTitle: currentVideoTitle,
          hasCustomForThisVideo: !!custom,
          customGainForThisVideo: custom ? custom.gain : 2.0
        });
      } else if (message.type === 'UPDATE_CONFIG') {
        config = Object.assign(config, message.config);
        saveConfig();
        applyGainImmediately();
        sendResponse({ success: true, config: config });
      } else if (message.type === 'SET_CUSTOM_VIDEO') {
        const { videoId, gain, enabled, title } = message;
        if (videoId) {
          if (enabled) {
            customVideos[videoId] = {
              gain: parseFloat(gain) || 2.0,
              title: title || currentVideoTitle || 'Vidéo YouTube',
              enabled: true,
              updatedAt: Date.now()
            };
          } else {
            delete customVideos[videoId];
          }
          saveCustomVideos();
          applyGainImmediately();
          sendResponse({ success: true, customVideos: customVideos });
        }
      } else if (message.type === 'PING') {
        sendResponse({ alive: true });
      }
      return true;
    });
  }

  // Init
  loadSettings(() => {
    detectCurrentVideo();
    scanAndHook();
  });
})();
