/* ==========================================================================
   EPC GAME — script.js
   A tiny interactive demo: switch electricity ON/OFF and watch the mood
   of the house (and its owner) change.

   Vanilla JavaScript only — no frameworks, no backend, no external APIs.
   --------------------------------------------------------------------------
   1. DOM references
   2. Game state
   3. Sound engine (Web Audio API - sounds are generated, no files needed)
   4. Rendering
   5. Effects (particles / flash / one-shot reactions)
   6. Happiness meter loop
   7. Events
   8. Init
   ========================================================================== */

(function () {
  "use strict";

  /* ======================= 1. DOM REFERENCES ======================= */
  const $ = (selector) => document.querySelector(selector);

  const body = document.body;

  const powerBtn = $("#powerBtn");
  const powerBtnIcon = $("#powerBtnIcon");
  const powerBtnLabel = $("#powerBtnLabel");

  const statusBadge = $("#statusBadge");
  const statusText = $("#statusText");
  const statusBolt = $("#statusBolt");

  const soundBtn = $("#soundBtn");
  const resetBtn = $("#resetBtn");

  const messageBar = $("#messageBar");
  const messageText = $("#message");
  const messageEmoji = $("#messageEmoji");

  const happinessValue = $("#happinessValue");
  const happinessMeter = $("#happinessMeter");
  const meterFill = $("#meterFill");
  const meterFace = $("#meterFace");
  const meterNote = $("#meterNote");

  const onCountEl = $("#onCount");
  const offCountEl = $("#offCount");
  const totalCountEl = $("#totalCount");
  const historyDots = $("#historyDots");

  const characterWrap = $("#characterWrap");
  const fxLayer = $("#fx");
  const flash = $("#flash");
  const tipText = $("#tipText");

  /* ======================= 2. GAME STATE ======================= */
  const state = {
    power: false,          // electricity ON? (game starts OFF)
    onCount: 0,           // how many times it was switched ON
    offCount: 0,          // how many times it was switched OFF
    total: 0,             // total number of switches
    happiness: 0,         // 0 -> 100
    sound: true,          // sound enabled?
    history: []           // last switches: true = ON, false = OFF
  };

  const MESSAGES = {
    on:  { text: "Electricity is ON! Everyone is Happy! 😊", emoji: "😊" },
    off: { text: "Electricity is OFF! Everyone is Unhappy! 😢", emoji: "😢" }
  };

  const TIPS = {
    on: [
      "With electricity the TV works, the fridge keeps food cold and the room is warm and bright.",
      "Lights let children study, shops stay open late, and hospitals keep patients safe.",
      "A working fan and a lit bulb make a home feel alive — that is real happiness."
    ],
    off: [
      "No electricity means no light, no TV, no fan and no fridge — the whole day feels heavy.",
      "Candles and lanterns cost money and give far less light than a single bulb.",
      "Power cuts slow down work, stop learning and make daily life much harder."
    ]
  };

  /* ======================= 3. SOUND ENGINE ======================= */
  /* Everything is synthesised with the Web Audio API, so the game works
     offline and does not need any audio files.                        */
  const Sound = (function () {
    let ctx = null;

    function ensure() {
      if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        ctx = new AudioCtx();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    /* One simple note. */
    function note(freq, when, duration, type, volume, dest) {
      const c = ensure();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || "triangle";
      osc.frequency.setValueAtTime(freq, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain);
      gain.connect(dest || c.destination);
      osc.start(when);
      osc.stop(when + duration + 0.05);
    }

    /* A short "thunk" of filtered noise (used when power goes off). */
    function thunk(when, volume) {
      const c = ensure();
      if (!c) return;
      const length = Math.floor(c.sampleRate * 0.22);
      const buffer = c.createBuffer(1, length, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const gain = c.createGain();
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      src.start(when);
    }

    return {
      /* Cheerful rising arpeggio + sparkles */
      on() {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime + 0.02;
        const melody = [523.25, 659.25, 783.99, 1046.5];      // C5 E5 G5 C6
        melody.forEach((f, i) => note(f, t + i * 0.085, 0.34, "triangle", 0.24));
        note(1318.5, t + 0.36, 0.26, "sine", 0.16);
        note(1567.98, t + 0.44, 0.3, "sine", 0.13);
      },

      /* Sad descending notes + a switch "thunk" */
      off() {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime + 0.02;
        const melody = [392.0, 349.23, 293.66, 233.08];       // G4 F4 D4 Bb3
        melody.forEach((f, i) => note(f, t + i * 0.13, 0.4, "sine", 0.22));
        thunk(t, 0.3);
      },

      /* Short UI click */
      click() {
        const c = ensure();
        if (!c) return;
        note(760, c.currentTime + 0.01, 0.07, "square", 0.09);
      },

      /* Soft blip for reset */
      reset() {
        const c = ensure();
        if (!c) return;
        const t = c.currentTime + 0.02;
        note(523.25, t, 0.2, "triangle", 0.16);
        note(392.0, t + 0.13, 0.28, "triangle", 0.14);
      }
    };
  })();

  /* ======================= 4. RENDERING ======================= */
  function render() {
    const on = state.power;

    /* --- body classes drive all the CSS states --- */
    body.classList.toggle("power-on", on);
    body.classList.toggle("power-off", !on);

    /* --- status badge --- */
    statusBadge.classList.toggle("is-on", on);
    statusBadge.classList.toggle("is-off", !on);
    statusText.textContent = on ? "ELECTRICITY ON" : "ELECTRICITY OFF";
    statusBolt.textContent = "⚡";
    statusBolt.style.filter = on ? "" : "grayscale(1) brightness(1.6)";

    /* --- main button --- */
    powerBtnLabel.textContent = on ? "Turn Electricity OFF" : "Turn Electricity ON";
    powerBtnIcon.textContent = on ? "🔌" : "⚡";
    powerBtn.setAttribute("aria-label", powerBtnLabel.textContent);

    /* --- message --- */
    const msg = on ? MESSAGES.on : MESSAGES.off;
    messageText.textContent = msg.text;
    messageEmoji.textContent = msg.emoji;

    /* --- counters --- */
    onCountEl.textContent = state.onCount;
    offCountEl.textContent = state.offCount;
    totalCountEl.textContent = state.total;

    /* --- tip --- */
    tipText.textContent = pickTip(on);

    /* --- meter note --- */
    meterNote.textContent = on
      ? "The lights are on — happiness is rising!"
      : "Switch the electricity ON to make him smile!";
  }

  function pickTip(on) {
    const list = TIPS[on ? "on" : "off"];
    return list[Math.floor(Math.random() * list.length)];
  }

  /* ======================= 5. EFFECTS ======================= */
  const ON_PARTICLES = ["✨", "🎉", "⚡", "💛", "🌟", "🎊"];
  const OFF_PARTICLES = ["💧", "😞", "🌧️", "💤", "🕯️"];

  function spawnParticles(emojis, count) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      p.style.left = (8 + Math.random() * 84) + "%";
      p.style.fontSize = (1.1 + Math.random() * 1.4) + "rem";
      p.style.animationDelay = (Math.random() * 0.35).toFixed(2) + "s";
      p.style.animationDuration = (1.5 + Math.random() * 0.8).toFixed(2) + "s";
      fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  function triggerFlash(kind) {
    flash.classList.remove("go-on", "go-off");
    /* force reflow so the animation can restart */
    void flash.offsetWidth;
    flash.classList.add(kind === "on" ? "go-on" : "go-off");
    setTimeout(() => flash.classList.remove("go-on", "go-off"), 750);
  }

  /* one-shot reaction on the character */
  function reactCharacter(on) {
    characterWrap.classList.remove("pop", "sulk");
    void characterWrap.offsetWidth;
    characterWrap.classList.add(on ? "pop" : "sulk");
    setTimeout(() => characterWrap.classList.remove("pop", "sulk"), 750);
  }

  /* bounce the message + meter face */
  function bump(element) {
    element.classList.remove("bump");
    void element.offsetWidth;
    element.classList.add("bump");
    setTimeout(() => element.classList.remove("bump"), 500);
  }

  /* history dots */
  function renderHistory() {
    historyDots.innerHTML = "";
    if (!state.history.length) {
      const empty = document.createElement("em");
      empty.className = "empty";
      empty.textContent = "no switches yet";
      historyDots.appendChild(empty);
      return;
    }
    state.history.forEach((isOn) => {
      const dot = document.createElement("span");
      dot.className = "dot " + (isOn ? "on" : "off");
      historyDots.appendChild(dot);
    });
  }

  /* ======================= 6. HAPPINESS METER ======================= */
  const FACES = [
    { max: 15, face: "😢", label: "Miserable" },
    { max: 35, face: "🙁", label: "Unhappy" },
    { max: 55, face: "😐", label: "Neutral" },
    { max: 75, face: "🙂", label: "Happy" },
    { max: 100, face: "😄", label: "Delighted" }
  ];

  function faceFor(value) {
    for (let i = 0; i < FACES.length; i++) {
      if (value <= FACES[i].max) return FACES[i];
    }
    return FACES[FACES.length - 1];
  }

  function renderMeter() {
    const value = Math.round(state.happiness);
    meterFill.style.width = value + "%";
    happinessValue.textContent = value + "%";
    happinessMeter.setAttribute("aria-valuenow", value);

    const info = faceFor(value);
    if (meterFace.textContent !== info.face) {
      meterFace.textContent = info.face;
    }
  }

  /* Smoothly move the happiness toward its target (100 when powered,
     0 when dark). A tiny extra kick is added on every switch.        */
  let lastFrame = 0;
  function meterLoop(time) {
    if (!lastFrame) lastFrame = time;
    const dt = Math.min((time - lastFrame) / 1000, 0.1);
    lastFrame = time;

    const target = state.power ? 100 : 0;
    const speed = state.power ? 22 : 26;      // units per second

    if (state.happiness < target) {
      state.happiness = Math.min(target, state.happiness + speed * dt);
    } else if (state.happiness > target) {
      state.happiness = Math.max(target, state.happiness - speed * dt);
    }
    renderMeter();
    requestAnimationFrame(meterLoop);
  }

  /* ======================= 7. EVENTS ======================= */
  function togglePower() {
    state.power = !state.power;
    state.total += 1;

    if (state.power) {
      state.onCount += 1;
      state.happiness = Math.min(100, state.happiness + 10);
      if (state.sound) Sound.on();
      triggerFlash("on");
      spawnParticles(ON_PARTICLES, 14);
    } else {
      state.offCount += 1;
      state.happiness = Math.max(0, state.happiness - 10);
      if (state.sound) Sound.off();
      triggerFlash("off");
      spawnParticles(OFF_PARTICLES, 9);
    }

    state.history.push(state.power);
    if (state.history.length > 12) state.history.shift();

    render();
    renderHistory();
    renderMeter();
    reactCharacter(state.power);
    bump(messageBar);
    bump(meterFace);
  }

  function resetGame() {
    state.power = false;
    state.onCount = 0;
    state.offCount = 0;
    state.total = 0;
    state.happiness = 0;
    state.history = [];

    render();
    renderHistory();
    renderMeter();
    reactCharacter(false);
    triggerFlash("off");

    messageText.textContent = "Game reset! Electricity is OFF. Press the button to light up the room. 💡";
    messageEmoji.textContent = "💡";
    bump(messageBar);

    if (state.sound) Sound.reset();
  }

  function toggleSound() {
    state.sound = !state.sound;
    soundBtn.classList.toggle("is-off", !state.sound);
    soundBtn.setAttribute("aria-pressed", String(state.sound));
    soundBtn.setAttribute("aria-label", state.sound ? "Mute sound" : "Unmute sound");
    if (state.sound) Sound.click();
  }

  powerBtn.addEventListener("click", togglePower);
  soundBtn.addEventListener("click", toggleSound);
  resetBtn.addEventListener("click", resetGame);

  /* keyboard: E or Space flips the switch */
  document.addEventListener("keydown", function (event) {
    if (event.repeat) return;
    const tag = (event.target && event.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.code === "Space" || event.key === "e" || event.key === "E") {
      event.preventDefault();
      togglePower();
    }
  });

  /* ======================= 8. INIT ======================= */
  render();
  renderHistory();
  renderMeter();
  requestAnimationFrame(meterLoop);

  /* friendly rotating tip */
  setInterval(function () {
    tipText.textContent = pickTip(state.power);
  }, 7000);
})();
