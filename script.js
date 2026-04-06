const canvas = document.getElementById('instrumentCanvas');
const ctx = canvas.getContext('2d');

const startAudioBtn = document.getElementById('startAudioBtn');
const stopInputBtn = document.getElementById('stopInputBtn');
const sourceModeEl = document.getElementById('sourceMode');
const audioFileEl = document.getElementById('audioFile');
const wetMixEl = document.getElementById('wetMix');
const dryMixEl = document.getElementById('dryMix');
const sourceGainEl = document.getElementById('sourceGain');
const pluckStrengthEl = document.getElementById('pluckStrength');
const snapFretsEl = document.getElementById('snapFrets');
const statusTextEl = document.getElementById('statusText');

const statString = document.getElementById('statString');
const statNote = document.getElementById('statNote');
const statFreq = document.getElementById('statFreq');
const statFret = document.getElementById('statFret');
const statSource = document.getElementById('statSource');
const statSignal = document.getElementById('statSignal');

const STRINGS = [
    { name: 'Low E', note: 'E2', openFreq: 82.4069, gauge: 1.0, brightness: 0.65, body: 0.95 },
    { name: 'A', note: 'A2', openFreq: 110.0, gauge: 0.9, brightness: 0.72, body: 0.88 },
    { name: 'D', note: 'D3', openFreq: 146.832, gauge: 0.78, brightness: 0.8, body: 0.8 },
    { name: 'G', note: 'G3', openFreq: 196.0, gauge: 0.65, brightness: 0.9, body: 0.72 },
    { name: 'B', note: 'B3', openFreq: 246.942, gauge: 0.53, brightness: 1.02, body: 0.63 },
    { name: 'High E', note: 'E4', openFreq: 329.628, gauge: 0.45, brightness: 1.12, body: 0.56 },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAX_FRETS = 24;
const SCALE_LENGTH = 1.0;

const state = {
    dpr: Math.max(1, window.devicePixelRatio || 1),
    width: 0,
    height: 0,
    pointer: null,
    activeStringIndex: 0,
    activeFreq: STRINGS[0].openFreq,
    activeFret: 0,
    outputLevel: 0,
    sourceMode: 'pluck',
    strings: STRINGS.map((s) => ({
        vibration: 0,
        vibrationVel: 0,
        glow: 0,
        lastFreq: s.openFreq,
    })),
};

const audio = {
    ctx: null,
    masterGain: null,
    dryGain: null,
    wetGain: null,
    sourceGain: null,
    sourceHighpass: null,
    sourceCompressor: null,
    resonatorInput: null,
    bodyGain: null,
    fundamental: null,
    harmonic2: null,
    harmonic3: null,
    harmonic4: null,
    harmonicGain1: null,
    harmonicGain2: null,
    harmonicGain3: null,
    harmonicGain4: null,
    bodyFilter: null,
    airFilter: null,
    feedbackDelay: null,
    feedbackGain: null,
    analyser: null,
    micStream: null,
    currentSourceNode: null,
    currentAudioElement: null,
    currentMediaElementSource: null,
    decodedFileBuffer: null,
    currentBufferSource: null,
    meterData: null,
    started: false,
};

function setStatus(message, isError = false) {
    statusTextEl.innerHTML = isError
        ? `<span class="error">${message}</span>`
        : message;
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / 440);
}

function formatNoteFromFreq(freq) {
    const midi = Math.round(freqToMidi(freq));
    const note = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
}

function formatSourceMode(mode) {
    if (mode === 'mic') return 'Microphone';
    if (mode === 'file') return 'File';
    return 'Pluck';
}

function getFretPositionX(fret, neckLeft, neckWidth) {
    const distance = SCALE_LENGTH - (SCALE_LENGTH / Math.pow(2, fret / 12));
    return neckLeft + distance * neckWidth;
}

function xToContinuousFret(x, neckLeft, neckWidth) {
    const dist = clamp((x - neckLeft) / neckWidth, 0, 0.9992);
    const n = 12 * Math.log2(1 / (1 - dist));
    return clamp(n, 0, MAX_FRETS);
}

function getFingeredFrequency(stringIndex, fretValue) {
    return STRINGS[stringIndex].openFreq * Math.pow(2, fretValue / 12);
}

function updateStats() {
    const stringData = STRINGS[state.activeStringIndex];
    statString.textContent = stringData.name;
    statNote.textContent = formatNoteFromFreq(state.activeFreq);
    statFreq.textContent = `${state.activeFreq.toFixed(2)} Hz`;
    statFret.textContent = state.activeFret.toFixed(2);
    statSource.textContent = formatSourceMode(state.sourceMode);

    const signalText = state.outputLevel > 0.2
        ? 'Strong'
        : state.outputLevel > 0.06
            ? 'Active'
            : state.outputLevel > 0.01
                ? 'Low'
                : 'Idle';
    statSignal.textContent = signalText;
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.max(1, window.devicePixelRatio || 1);
    state.width = Math.max(320, Math.floor(rect.width));
    state.height = Math.max(420, Math.floor(rect.height));
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

function getLayout() {
    const margin = Math.max(26, state.width * 0.045);
    const headWidth = state.width * 0.12;
    const bodyWidth = state.width * 0.14;
    const neckLeft = margin + headWidth;
    const neckRight = state.width - margin - bodyWidth;
    const neckTop = state.height * 0.18;
    const neckBottom = state.height * 0.82;
    const neckHeight = neckBottom - neckTop;
    const stringXs = { neckLeft, neckRight };

    const yPositions = STRINGS.map((_, i) => lerp(neckTop + 20, neckBottom - 20, i / (STRINGS.length - 1)));

    return {
        margin,
        neckLeft,
        neckRight,
        neckTop,
        neckBottom,
        neckHeight,
        neckWidth: neckRight - neckLeft,
        yPositions,
        headX: margin,
        headWidth,
        bodyX: neckRight,
        bodyWidth,
    };
}

function findNearestString(y, layout) {
    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < layout.yPositions.length; i++) {
        const d = Math.abs(y - layout.yPositions[i]);
        if (d < bestDist) {
            bestDist = d;
            bestIndex = i;
        }
    }
    return { index: bestIndex, distance: bestDist };
}

function ensureAudio() {
    if (audio.ctx) return audio.ctx;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        throw new Error('This browser does not support the Web Audio API.');
    }

    const ac = new AudioCtx();
    audio.ctx = ac;

    audio.masterGain = ac.createGain();
    audio.dryGain = ac.createGain();
    audio.wetGain = ac.createGain();
    audio.sourceGain = ac.createGain();
    audio.sourceHighpass = ac.createBiquadFilter();
    audio.sourceCompressor = ac.createDynamicsCompressor();
    audio.resonatorInput = ac.createGain();
    audio.bodyGain = ac.createGain();
    audio.fundamental = ac.createBiquadFilter();
    audio.harmonic2 = ac.createBiquadFilter();
    audio.harmonic3 = ac.createBiquadFilter();
    audio.harmonic4 = ac.createBiquadFilter();
    audio.harmonicGain1 = ac.createGain();
    audio.harmonicGain2 = ac.createGain();
    audio.harmonicGain3 = ac.createGain();
    audio.harmonicGain4 = ac.createGain();
    audio.bodyFilter = ac.createBiquadFilter();
    audio.airFilter = ac.createBiquadFilter();
    audio.feedbackDelay = ac.createDelay(0.12);
    audio.feedbackGain = ac.createGain();
    audio.analyser = ac.createAnalyser();
    audio.meterData = new Uint8Array(audio.analyser.fftSize);

    audio.masterGain.gain.value = 0.92;
    audio.dryGain.gain.value = parseFloat(dryMixEl.value);
    audio.wetGain.gain.value = parseFloat(wetMixEl.value);
    audio.sourceGain.gain.value = parseFloat(sourceGainEl.value);
    audio.sourceHighpass.type = 'highpass';
    audio.sourceHighpass.frequency.value = 45;
    audio.sourceHighpass.Q.value = 0.707;
    audio.sourceCompressor.threshold.value = -24;
    audio.sourceCompressor.knee.value = 18;
    audio.sourceCompressor.ratio.value = 3.5;
    audio.sourceCompressor.attack.value = 0.004;
    audio.sourceCompressor.release.value = 0.14;
    audio.resonatorInput.gain.value = 1.65;
    audio.bodyGain.gain.value = 0.95;

    audio.fundamental.type = 'bandpass';
    audio.harmonic2.type = 'bandpass';
    audio.harmonic3.type = 'bandpass';
    audio.harmonic4.type = 'bandpass';
    audio.bodyFilter.type = 'peaking';
    audio.airFilter.type = 'highshelf';

    audio.harmonicGain1.gain.value = 1.25;
    audio.harmonicGain2.gain.value = 0.75;
    audio.harmonicGain3.gain.value = 0.42;
    audio.harmonicGain4.gain.value = 0.2;

    audio.feedbackDelay.delayTime.value = 0.055;
    audio.feedbackGain.gain.value = 0.16;
    audio.bodyFilter.gain.value = 4.0;
    audio.airFilter.gain.value = 2.0;
    audio.analyser.fftSize = 1024;
    audio.analyser.smoothingTimeConstant = 0.82;

    audio.sourceGain.connect(audio.sourceHighpass);
    audio.sourceHighpass.connect(audio.sourceCompressor);
    audio.sourceCompressor.connect(audio.dryGain);
    audio.sourceCompressor.connect(audio.resonatorInput);

    audio.resonatorInput.connect(audio.fundamental);
    audio.resonatorInput.connect(audio.harmonic2);
    audio.resonatorInput.connect(audio.harmonic3);
    audio.resonatorInput.connect(audio.harmonic4);

    audio.fundamental.connect(audio.harmonicGain1);
    audio.harmonic2.connect(audio.harmonicGain2);
    audio.harmonic3.connect(audio.harmonicGain3);
    audio.harmonic4.connect(audio.harmonicGain4);

    audio.harmonicGain1.connect(audio.bodyGain);
    audio.harmonicGain2.connect(audio.bodyGain);
    audio.harmonicGain3.connect(audio.bodyGain);
    audio.harmonicGain4.connect(audio.bodyGain);

    audio.bodyGain.connect(audio.bodyFilter);
    audio.bodyFilter.connect(audio.airFilter);
    audio.airFilter.connect(audio.wetGain);
    audio.airFilter.connect(audio.feedbackDelay);
    audio.feedbackDelay.connect(audio.feedbackGain);
    audio.feedbackGain.connect(audio.resonatorInput);

    audio.wetGain.connect(audio.masterGain);
    audio.dryGain.connect(audio.masterGain);
    audio.masterGain.connect(audio.analyser);
    audio.masterGain.connect(ac.destination);

    updateResonator(state.activeStringIndex, state.activeFreq);
    audio.started = true;
    return ac;
}

function updateResonator(stringIndex, freq) {
    if (!audio.ctx) return;
    const t = audio.ctx.currentTime;
    const string = STRINGS[stringIndex];
    const brightness = string.brightness;
    const body = string.body;
    const gauge = string.gauge;

    const q1 = lerp(12, 22, 1 - (gauge - 0.45) / 0.55);
    const q2 = q1 * 0.82;
    const q3 = q1 * 0.68;
    const q4 = q1 * 0.55;

    audio.fundamental.frequency.setTargetAtTime(freq, t, 0.01);
    audio.harmonic2.frequency.setTargetAtTime(freq * 2, t, 0.01);
    audio.harmonic3.frequency.setTargetAtTime(freq * 3, t, 0.01);
    audio.harmonic4.frequency.setTargetAtTime(freq * 4, t, 0.01);

    audio.fundamental.Q.setTargetAtTime(q1, t, 0.01);
    audio.harmonic2.Q.setTargetAtTime(q2, t, 0.01);
    audio.harmonic3.Q.setTargetAtTime(q3, t, 0.01);
    audio.harmonic4.Q.setTargetAtTime(q4, t, 0.01);

    const brightnessNorm = clamp((brightness - 0.65) / 0.47, 0, 1);
    audio.harmonicGain1.gain.setTargetAtTime(1.35 * body, t, 0.01);
    audio.harmonicGain2.gain.setTargetAtTime(0.85 * lerp(0.82, 1.12, brightnessNorm), t, 0.01);
    audio.harmonicGain3.gain.setTargetAtTime(0.46 * lerp(0.75, 1.15, brightnessNorm), t, 0.01);
    audio.harmonicGain4.gain.setTargetAtTime(0.22 * lerp(0.65, 1.15, brightnessNorm), t, 0.01);

    audio.bodyFilter.frequency.setTargetAtTime(clamp(freq * 1.8, 110, 1200), t, 0.015);
    audio.bodyFilter.gain.setTargetAtTime(lerp(6.4, 2.6, brightnessNorm), t, 0.015);
    audio.airFilter.frequency.setTargetAtTime(clamp(freq * 8.5, 1200, 8400), t, 0.015);
    audio.airFilter.gain.setTargetAtTime(lerp(0.2, 4.8, brightnessNorm), t, 0.015);
    audio.feedbackDelay.delayTime.setTargetAtTime(clamp(1 / Math.max(freq, 50), 0.0025, 0.035), t, 0.02);
    audio.feedbackGain.gain.setTargetAtTime(lerp(0.19, 0.07, brightnessNorm), t, 0.02);
}

function stopCurrentInput() {
    if (audio.currentBufferSource) {
        try { audio.currentBufferSource.stop(); } catch (_) { }
        try { audio.currentBufferSource.disconnect(); } catch (_) { }
        audio.currentBufferSource = null;
    }
    if (audio.currentSourceNode) {
        try { audio.currentSourceNode.disconnect(); } catch (_) { }
        audio.currentSourceNode = null;
    }
    if (audio.micStream) {
        audio.micStream.getTracks().forEach((track) => track.stop());
        audio.micStream = null;
    }
    if (audio.currentAudioElement) {
        audio.currentAudioElement.pause();
        audio.currentAudioElement.src = '';
        audio.currentAudioElement = null;
        audio.currentMediaElementSource = null;
    }
}

async function startSelectedInput() {
    state.sourceMode = sourceModeEl.value;
    statSource.textContent = formatSourceMode(state.sourceMode);

    if (!audio.ctx) ensureAudio();
    if (audio.ctx.state === 'suspended') {
        await audio.ctx.resume();
    }

    stopCurrentInput();

    if (audio.dryGain) {
        const dryTarget = state.sourceMode === 'pluck' ? 0.0 : parseFloat(dryMixEl.value);
        audio.dryGain.gain.setTargetAtTime(dryTarget, audio.ctx.currentTime, 0.01);
    }

    if (state.sourceMode === 'pluck') {
        dryMixEl.value = '0.00';
        if (audio.dryGain) audio.dryGain.gain.setTargetAtTime(0.0, audio.ctx.currentTime, 0.01);
        setStatus('Internal pluck mode active. Click or touch a string to excite it.');
        return;
    }

    if (state.sourceMode === 'mic') {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            });
            audio.micStream = stream;
            audio.currentSourceNode = audio.ctx.createMediaStreamSource(stream);
            audio.currentSourceNode.connect(audio.sourceGain);
            setStatus('Microphone input active. Your live signal is being colored by the selected string resonance.');
        } catch (err) {
            setStatus(`Microphone access failed: ${err.message || err}`, true);
        }
        return;
    }

    if (state.sourceMode === 'file') {
        const file = audioFileEl.files && audioFileEl.files[0];
        if (!file) {
            setStatus('Choose an audio file first, then start the input again.', true);
            return;
        }

        try {
            const bytes = await file.arrayBuffer();
            const decoded = await audio.ctx.decodeAudioData(bytes.slice(0));
            const srcNode = audio.ctx.createBufferSource();
            srcNode.buffer = decoded;
            srcNode.loop = true;
            srcNode.connect(audio.sourceGain);
            srcNode.start();
            audio.decodedFileBuffer = decoded;
            audio.currentBufferSource = srcNode;
            audio.currentSourceNode = srcNode;
            setStatus(`Playing ${file.name} through the selected string path. Drag across the strings to move the resonance.`);
        } catch (err) {
            setStatus(`Audio file playback failed: ${err.message || err}`, true);
        }
    }
}

function createNoiseBuffer(seconds = 0.07) {
    const ac = audio.ctx;
    const length = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
    return buffer;
}

function triggerPluck(stringIndex, freq, strength = 0.9) {
    if (!audio.ctx) return;
    updateResonator(stringIndex, freq);

    const ac = audio.ctx;
    const now = ac.currentTime;
    const burst = ac.createBufferSource();
    burst.buffer = createNoiseBuffer(0.055 + (1 / Math.max(freq, 70)) * 0.6);

    const burstGain = ac.createGain();
    const brightnessShelf = ac.createBiquadFilter();
    brightnessShelf.type = 'highshelf';
    brightnessShelf.frequency.value = clamp(freq * 3.5, 900, 6000);

    const string = STRINGS[stringIndex];
    brightnessShelf.gain.value = lerp(-5.5, 4.5, (string.brightness - 0.65) / 0.47);
    burstGain.gain.setValueAtTime(0.0001, now);
    burstGain.gain.exponentialRampToValueAtTime(clamp(strength, 0.04, 2.2), now + 0.006);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17 + (string.gauge * 0.06));

    burst.connect(brightnessShelf);
    brightnessShelf.connect(burstGain);
    burstGain.connect(audio.resonatorInput);

    burst.start(now);
    burst.stop(now + 0.28);
}

function setActiveFinger(stringIndex, x, y, layout) {
    const rawFret = xToContinuousFret(x, layout.neckLeft, layout.neckWidth);
    const fret = snapFretsEl.checked ? Math.round(rawFret) : rawFret;
    const freq = getFingeredFrequency(stringIndex, fret);
    state.pointer = { stringIndex, x, y, fret, freq };
    state.activeStringIndex = stringIndex;
    state.activeFret = fret;
    state.activeFreq = freq;
    state.strings[stringIndex].lastFreq = freq;
    state.strings[stringIndex].vibration = Math.max(state.strings[stringIndex].vibration, 0.9);
    state.strings[stringIndex].glow = 1.0;
    updateResonator(stringIndex, freq);
    updateStats();
}

function handlePointerDown(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const layout = getLayout();

    if (x < layout.neckLeft - 20 || x > layout.neckRight + 20 || y < layout.neckTop - 25 || y > layout.neckBottom + 25) {
        return;
    }

    const nearest = findNearestString(y, layout);
    setActiveFinger(nearest.index, clamp(x, layout.neckLeft, layout.neckRight), y, layout);

    if (state.sourceMode === 'pluck') {
        const currentStrength = parseFloat(pluckStrengthEl.value);
        triggerPluck(nearest.index, state.activeFreq, currentStrength);
    }

    setStatus(`${STRINGS[nearest.index].name} selected at ${formatNoteFromFreq(state.activeFreq)} (${state.activeFreq.toFixed(2)} Hz). Drag horizontally to slide.`);
}

function handlePointerMove(clientX, clientY) {
    if (!state.pointer) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const layout = getLayout();
    const nearest = findNearestString(y, layout);
    const stringIndex = nearest.distance < 24 ? nearest.index : state.pointer.stringIndex;
    setActiveFinger(stringIndex, clamp(x, layout.neckLeft, layout.neckRight), y, layout);
    state.strings[stringIndex].vibration = Math.max(state.strings[stringIndex].vibration, 0.35);
}

function handlePointerUp() {
    state.pointer = null;
}

function drawBackground(layout) {
    const g = ctx.createLinearGradient(0, 0, 0, state.height);
    g.addColorStop(0, '#191d16');
    g.addColorStop(1, '#10120f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, state.width, state.height);

    const ambient = ctx.createRadialGradient(state.width * 0.5, state.height * 0.1, 20, state.width * 0.5, state.height * 0.5, state.width * 0.7);
    ambient.addColorStop(0, 'rgba(145, 116, 71, 0.10)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, state.width, state.height);

    const neckGrad = ctx.createLinearGradient(layout.neckLeft, 0, layout.neckRight, 0);
    neckGrad.addColorStop(0, '#4a311d');
    neckGrad.addColorStop(0.42, '#755235');
    neckGrad.addColorStop(0.7, '#9e724b');
    neckGrad.addColorStop(1, '#715132');

    ctx.save();
    roundRect(ctx, layout.neckLeft - 12, layout.neckTop - 30, layout.neckWidth + 24, layout.neckHeight + 60, 18);
    ctx.fillStyle = neckGrad;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#3a2a1a';
    roundRect(ctx, layout.headX, layout.neckTop + 8, layout.headWidth + 34, layout.neckHeight - 16, 18);
    ctx.fill();

    ctx.fillStyle = '#d4b06f';
    ctx.fillRect(layout.neckLeft - 3, layout.neckTop - 2, 7, layout.neckHeight + 4);

    ctx.fillStyle = '#7a7f83';
    ctx.fillRect(layout.neckRight - 2, layout.neckTop - 1, 4, layout.neckHeight + 2);
}

function drawFrets(layout) {
    for (let fret = 1; fret <= MAX_FRETS; fret++) {
        const x = getFretPositionX(fret, layout.neckLeft, layout.neckWidth);
        const alpha = fret % 12 === 0 ? 0.38 : 0.2;
        ctx.strokeStyle = `rgba(210, 197, 160, ${alpha})`;
        ctx.lineWidth = fret % 12 === 0 ? 2.3 : 1.3;
        ctx.beginPath();
        ctx.moveTo(x, layout.neckTop - 18);
        ctx.lineTo(x, layout.neckBottom + 18);
        ctx.stroke();
    }

    const inlayFrets = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
    ctx.fillStyle = 'rgba(214, 190, 125, 0.24)';
    for (const fret of inlayFrets) {
        const x0 = getFretPositionX(fret - 1, layout.neckLeft, layout.neckWidth);
        const x1 = getFretPositionX(fret, layout.neckLeft, layout.neckWidth);
        const midX = (x0 + x1) * 0.5;
        if (fret === 12 || fret === 24) {
            ctx.beginPath();
            ctx.arc(midX, state.height * 0.38, 7, 0, Math.PI * 2);
            ctx.arc(midX, state.height * 0.62, 7, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(midX, state.height * 0.5, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawHardware(layout) {
    for (let i = 0; i < layout.yPositions.length; i++) {
        const y = layout.yPositions[i];
        ctx.fillStyle = 'rgba(192, 197, 201, 0.75)';
        ctx.beginPath();
        ctx.arc(layout.headX + 18, y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(188, 193, 198, 0.85)';
        ctx.fillRect(layout.neckRight - 4, y - 5, 16, 10);
    }
}

function drawStrings(layout, timeSec) {
    const levelGlow = clamp(state.outputLevel * 2.2, 0, 1);

    for (let i = 0; i < STRINGS.length; i++) {
        const y = layout.yPositions[i];
        const s = STRINGS[i];
        const runtime = state.strings[i];
        runtime.vibration *= 0.972;
        runtime.glow *= 0.955;

        const isActive = i === state.activeStringIndex;
        const amp = (runtime.vibration * 10 + levelGlow * 3.2) * (1.08 - i * 0.08);
        const phase = timeSec * (6 + i * 0.5);
        const lineWidth = 1.3 + s.gauge * 2.2;
        const strokeA = isActive ? 0.98 : 0.7;
        const glowA = isActive ? 0.48 : 0.16;

        ctx.save();
        ctx.shadowBlur = isActive ? 18 + runtime.glow * 12 : 0;
        ctx.shadowColor = `rgba(240, 220, 175, ${glowA + runtime.glow * 0.2})`;
        ctx.strokeStyle = `rgba(213, 221, 229, ${strokeA})`;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (let step = 0; step <= 92; step++) {
            const t = step / 92;
            const x = lerp(layout.headX + 20, layout.neckRight + 12, t);
            const localX = clamp((x - layout.neckLeft) / layout.neckWidth, 0, 1);
            const envelope = Math.sin(Math.PI * localX);
            const wave = Math.sin((localX * 24) - phase * 7.5 + i * 0.9);
            const fingerInfluence = state.pointer && state.pointer.stringIndex === i
                ? Math.max(0, 1 - Math.abs(x - state.pointer.x) / 220)
                : 0;
            const dy = wave * amp * envelope * (0.32 + fingerInfluence * 0.68);
            const py = y + dy;
            if (step === 0) ctx.moveTo(x, py);
            else ctx.lineTo(x, py);
        }
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = 'rgba(231, 223, 206, 0.9)';
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillText(s.note, layout.headX + 34, y - 10);
    }
}

function drawFinger(layout) {
    if (!state.pointer) return;
    const x = state.pointer.x;
    const y = layout.yPositions[state.pointer.stringIndex];

    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(230, 195, 112, 0.45)';
    ctx.fillStyle = 'rgba(222, 190, 110, 0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(95, 68, 38, 0.95)';
    ctx.stroke();
    ctx.restore();

    const bubbleW = 128;
    const bubbleH = 54;
    const bx = clamp(x + 16, 18, state.width - bubbleW - 18);
    const by = clamp(y - 68, 16, state.height - bubbleH - 16);

    ctx.save();
    roundRect(ctx, bx, by, bubbleW, bubbleH, 14);
    ctx.fillStyle = 'rgba(22, 23, 18, 0.86)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(214, 190, 125, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e9e2d1';
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    ctx.fillText(formatNoteFromFreq(state.activeFreq), bx + 12, by + 20);
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#b8ae96';
    ctx.fillText(`${state.activeFreq.toFixed(2)} Hz`, bx + 12, by + 39);
    ctx.restore();
}

function drawMeters(layout) {
    const x = state.width - 26;
    const y = 28;
    const h = 126;
    const w = 12;
    const level = clamp(state.outputLevel * 3.1, 0, 1);
    const fillH = h * level;

    ctx.save();
    roundRect(ctx, x - w, y, w, h, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, '#4f7d52');
    g.addColorStop(0.6, '#d7bb72');
    g.addColorStop(1, '#d77f6c');
    roundRect(ctx, x - w, y + h - fillH, w, fillH, 8);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.fillStyle = 'rgba(233, 226, 209, 0.7)';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText('OUT', x - 28, y + h + 18);
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

function updateAudioMeters() {
    if (!audio.analyser || !audio.meterData) {
        state.outputLevel = 0;
        return;
    }
    audio.analyser.getByteTimeDomainData(audio.meterData);
    let sum = 0;
    for (let i = 0; i < audio.meterData.length; i++) {
        const centered = (audio.meterData[i] - 128) / 128;
        sum += centered * centered;
    }
    const rms = Math.sqrt(sum / audio.meterData.length);
    state.outputLevel = lerp(state.outputLevel, rms, 0.22);
}

function render(timeMs) {
    const timeSec = timeMs * 0.001;
    resizeCanvas();
    updateAudioMeters();
    updateStats();

    const layout = getLayout();
    drawBackground(layout);
    drawFrets(layout);
    drawHardware(layout);
    drawStrings(layout, timeSec);
    drawFinger(layout);
    drawMeters(layout);
    requestAnimationFrame(render);
}

sourceModeEl.addEventListener('change', () => {
    state.sourceMode = sourceModeEl.value;
    statSource.textContent = formatSourceMode(state.sourceMode);
    audioFileEl.disabled = state.sourceMode !== 'file';
    if (state.sourceMode === 'pluck') {
        setStatus('Internal pluck mode selected. Click a string to excite it.');
    } else if (state.sourceMode === 'mic') {
        setStatus('Microphone mode selected. Press Start audio to request access.');
    } else {
        setStatus('File mode selected. Choose an audio file, then press Start audio.');
    }
});

wetMixEl.addEventListener('input', () => {
    if (audio.wetGain) {
        audio.wetGain.gain.setTargetAtTime(parseFloat(wetMixEl.value), audio.ctx.currentTime, 0.01);
    }
});

dryMixEl.addEventListener('input', () => {
    if (audio.dryGain) {
        audio.dryGain.gain.setTargetAtTime(parseFloat(dryMixEl.value), audio.ctx.currentTime, 0.01);
    }
});

sourceGainEl.addEventListener('input', () => {
    if (audio.sourceGain) {
        audio.sourceGain.gain.setTargetAtTime(parseFloat(sourceGainEl.value), audio.ctx.currentTime, 0.01);
    }
});

startAudioBtn.addEventListener('click', async () => {
    try {
        ensureAudio();
        if (audio.ctx.state === 'suspended') {
            await audio.ctx.resume();
        }
        await startSelectedInput();
    } catch (err) {
        setStatus(`Audio initialization failed: ${err.message || err}`, true);
    }
});

stopInputBtn.addEventListener('click', () => {
    stopCurrentInput();
    setStatus('External input stopped. Internal plucks still work if the audio context has been started.');
});

canvas.addEventListener('pointerdown', async (ev) => {
    try {
        ensureAudio();
        if (audio.ctx.state === 'suspended') await audio.ctx.resume();
    } catch (err) {
        setStatus(`Audio initialization failed: ${err.message || err}`, true);
        return;
    }

    canvas.setPointerCapture(ev.pointerId);
    handlePointerDown(ev.clientX, ev.clientY);
});

canvas.addEventListener('pointermove', (ev) => {
    if (state.pointer) {
        handlePointerMove(ev.clientX, ev.clientY);
    }
});

canvas.addEventListener('pointerup', (ev) => {
    try { canvas.releasePointerCapture(ev.pointerId); } catch (_) { }
    handlePointerUp();
});

canvas.addEventListener('pointercancel', (ev) => {
    try { canvas.releasePointerCapture(ev.pointerId); } catch (_) { }
    handlePointerUp();
});

window.addEventListener('resize', resizeCanvas);

sourceModeEl.dispatchEvent(new Event('change'));
updateStats();
requestAnimationFrame(render);