/**
 * YouTube Smart Volume Booster & Auto-Leveler
 * Content Script (YouTube & YouTube Music)
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__yt_smart_booster_loaded) return;
  window.__yt_smart_booster_loaded = true;

  // Default configuration
  let config = {
    enabled: true,
    mode: 'auto', // 'auto' (AGC Leveler) or 'manual' (Fixed Gain)
    maxBoost: 3.0, // Max multiplier for auto mode (e.g., 3.0 = +9.5 dB)
    targetLevel: 0.15, // Target RMS level (~ -16.5 dBFS, typical standard YouTube volume)
    manualGain: 1.8, // Multiplier when in manual mode
    limiter: true // Brickwall safety limiter
  };

  // Audio nodes and context references
  let audioCtx = null;
  let sourceNode = null;
  let currentVideoEl = null;

  let masterGainNode = null;
  let agcGainNode = null;
  let compressorNode = null;
  let limiterNode = null;
  let analyserNode = null;

  // Real-time state
  let currentRMS = 0;
  let currentGainValue = 1.0;
  let isVideoPlaying = false;
  let agcLoopId = null;
  let pcmData = null;

  // Load saved configuration from Chrome storage
  function loadConfig(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['ytBoosterConfig'], (result) => {
        if (result && result.ytBoosterConfig) {
          config = Object.assign(config, result.ytBoosterConfig);
        }
        applyConfigToAudioGraph();
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  // Save current configuration
  function saveConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ ytBoosterConfig: config });
    }
  }

  // Ensure AudioContext is initialized and running
  function getOrCreateAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Initialize or update the Web Audio processing graph on the video element
  function setupAudioGraph(videoEl) {
    if (!videoEl) return false;

    // Check if this video element is already hooked
    if (videoEl.__smartBoosterHooked && sourceNode) {
      return true;
    }

    try {
      const ctx = getOrCreateAudioContext();

      // Create nodes
      sourceNode = ctx.createMediaElementSource(videoEl);
      videoEl.__smartBoosterHooked = true;
      currentVideoEl = videoEl;

      // Master gain node (for ON / OFF bypass or manual gain)
      masterGainNode = ctx.createGain();
      masterGainNode.gain.value = 1.0;

      // Dynamic AGC gain node (controlled in real-time)
      agcGainNode = ctx.createGain();
      agcGainNode.gain.value = 1.0;

      // Studio dynamic compressor: tames peaks, tightens dynamic range
      compressorNode = ctx.createDynamicsCompressor();
      compressorNode.threshold.setValueAtTime(-18, ctx.currentTime); // dB
      compressorNode.knee.setValueAtTime(12, ctx.currentTime);       // dB
      compressorNode.ratio.setValueAtTime(6, ctx.currentTime);       // 6:1 ratio
      compressorNode.attack.setValueAtTime(0.003, ctx.currentTime);  // 3ms attack
      compressorNode.release.setValueAtTime(0.25, ctx.currentTime);  // 250ms release

      // Brickwall safety limiter: prevents any clipping / ear blasting
      limiterNode = ctx.createDynamicsCompressor();
      limiterNode.threshold.setValueAtTime(-1.0, ctx.currentTime);   // -1 dB ceiling
      limiterNode.knee.setValueAtTime(0, ctx.currentTime);
      limiterNode.ratio.setValueAtTime(20, ctx.currentTime);         // 20:1 brickwall
      limiterNode.attack.setValueAtTime(0.001, ctx.currentTime);     // 1ms
      limiterNode.release.setValueAtTime(0.05, ctx.currentTime);     // 50ms

      // Analyser node: measures RMS and peak levels in real-time
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.3;
      pcmData = new Float32Array(analyserNode.fftSize);

      // Connect graph:
      // Video Source -> MasterGain -> AGCGain -> Compressor -> Limiter -> Analyser -> Output
      sourceNode.connect(masterGainNode);
      masterGainNode.connect(agcGainNode);
      agcGainNode.connect(compressorNode);
      compressorNode.connect(limiterNode);
      limiterNode.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      // Event listeners for play/pause/track switch
      const onPlay = () => {
        isVideoPlaying = true;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        startAgcLoop();
      };

      const onPause = () => {
        isVideoPlaying = false;
      };

      // Reset AGC gain when a new track/video begins
      const onTrackChange = () => {
        resetAgcGain();
      };

      videoEl.addEventListener('play', onPlay);
      videoEl.addEventListener('playing', onPlay);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('ended', onPause);
      videoEl.addEventListener('loadstart', onTrackChange);

      if (!videoEl.paused) {
        onPlay();
      }

      applyConfigToAudioGraph();
      console.log('[SmartBooster] Audio graph successfully attached to YouTube player.');
      return true;
    } catch (err) {
      console.warn('[SmartBooster] Error hooking audio source:', err);
      return false;
    }
  }

  // Reset AGC gain smoothly to 1.0 (neutral) on track transition
  function resetAgcGain() {
    if (!audioCtx || !agcGainNode) return;
    const now = audioCtx.currentTime;
    agcGainNode.gain.cancelScheduledValues(now);
    agcGainNode.gain.setTargetAtTime(1.0, now, 0.05);
    currentGainValue = 1.0;
  }

  // Update audio graph parameters whenever user settings change
  function applyConfigToAudioGraph() {
    if (!audioCtx || !masterGainNode || !agcGainNode || !limiterNode) return;

    const now = audioCtx.currentTime;

    if (!config.enabled) {
      // Bypass mode: direct neutral sound
      masterGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      agcGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      limiterNode.ratio.setTargetAtTime(1.0, now, 0.05);
      currentGainValue = 1.0;
      return;
    }

    // Safety limiter enabled / disabled
    limiterNode.ratio.setTargetAtTime(config.limiter ? 20.0 : 1.0, now, 0.05);

    if (config.mode === 'manual') {
      // Fixed manual gain
      masterGainNode.gain.setTargetAtTime(config.manualGain, now, 0.05);
      agcGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      currentGainValue = config.manualGain;
    } else {
      // Auto AGC Leveler mode
      masterGainNode.gain.setTargetAtTime(1.0, now, 0.05);
      // agcGainNode will be modulated dynamically by the AGC loop
    }
  }

  // Real-time AGC (Automatic Gain Control) processing loop
  function startAgcLoop() {
    if (agcLoopId) return;

    let smoothedRms = config.targetLevel;

    function loop() {
      if (!config.enabled || !analyserNode || !audioCtx) {
        agcLoopId = requestAnimationFrame(loop);
        return;
      }

      // Check if video is playing
      if (currentVideoEl && (currentVideoEl.paused || currentVideoEl.muted)) {
        currentRMS = 0;
        agcLoopId = requestAnimationFrame(loop);
        return;
      }

      // Get waveform samples
      analyserNode.getFloatTimeDomainData(pcmData);

      // Compute RMS (Root Mean Square) volume level
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
      }
      const rawRms = Math.sqrt(sum / pcmData.length);
      currentRMS = rawRms;

      // AGC computation (only active in auto mode)
      if (config.mode === 'auto' && agcGainNode) {
        // Noise gate / silence threshold (ignore pure silence/intro pause)
        if (rawRms > 0.008) {
          // Smooth the measured RMS (EMA)
          smoothedRms = smoothedRms * 0.92 + rawRms * 0.08;

          // Target ratio: how much boost is needed to reach target level?
          const desiredGain = config.targetLevel / Math.max(smoothedRms, 0.005);

          // Constrain between 1.0 (never reduce below standard) and maxBoost
          const targetGain = Math.min(Math.max(desiredGain, 1.0), config.maxBoost);

          const now = audioCtx.currentTime;
          if (targetGain < currentGainValue) {
            // Volume is increasing (or track became louder): fast attack (50ms) to prevent loud bursts!
            agcGainNode.gain.setTargetAtTime(targetGain, now, 0.05);
          } else {
            // Volume is too quiet: gently ramp up gain (600ms release) to avoid awkward pumping
            agcGainNode.gain.setTargetAtTime(targetGain, now, 0.6);
          }
          currentGainValue = targetGain;
        } else {
          // Very quiet or silence: gently decay gain back toward 1.0 so next sound starts cleanly
          const now = audioCtx.currentTime;
          agcGainNode.gain.setTargetAtTime(1.0, now, 1.0);
          currentGainValue = 1.0;
        }
      }

      agcLoopId = requestAnimationFrame(loop);
    }

    agcLoopId = requestAnimationFrame(loop);
  }

  // Observer & hook finder: detect video elements dynamically
  function scanAndHookVideo() {
    const video = document.querySelector('video');
    if (video && !video.__smartBoosterHooked) {
      setupAudioGraph(video);
    }
  }

  // Listen to YouTube SPA navigation events
  window.addEventListener('yt-navigate-finish', () => {
    resetAgcGain();
    scanAndHookVideo();
  });

  window.addEventListener('yt-page-data-updated', () => {
    scanAndHookVideo();
  });

  // User gesture listeners to unlock AudioContext if suspended
  const unlockAudioContext = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  document.addEventListener('click', unlockAudioContext, { passive: true });
  document.addEventListener('keydown', unlockAudioContext, { passive: true });

  // MutationObserver for YouTube's dynamic player insertions
  const observer = new MutationObserver(() => {
    scanAndHookVideo();
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // Listen for messages from the popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_METRICS') {
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
          isPlaying: isVideoPlaying
        });
      } else if (message.type === 'UPDATE_CONFIG') {
        config = Object.assign(config, message.config);
        saveConfig();
        applyConfigToAudioGraph();
        sendResponse({ success: true, config: config });
      }
      return true; // Keep message channel open for async response
    });
  }

  // Initial setup
  loadConfig(() => {
    scanAndHookVideo();
  });
})();
