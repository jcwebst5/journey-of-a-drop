// ==================================================
// JOURNEY OF A DROP — Doodle Edition
// A raindrop's trip from the clouds down to a clean well.
// ==================================================

"use strict";

const TAU = Math.PI * 2;
const INK = "#24262e";

let W = 420;                    // logical play-field width (set from the screen in resize)
const GROUND_Y = 24000;         // world depth of the ground, in logical px
const START_ALT = 10000;        // feet shown at the top of the journey
const GRAVITY = 1500;
const MAX_FALL = 600;
const BOUNCE = -640;
const SUPER_BOUNCE = -920;
const STOMP_BOUNCE = -700;
const BASE_SPEED = 330;
const STEP = 1 / 120;           // physics sub-step
const FOOT = 20;                // drop centre to bottom of the drop

const reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;


// ==================================================
// HELPERS
// ==================================================

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[(Math.random() * list.length) | 0];
const sign = v => (v < 0 ? -1 : 1);

function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rgbCache = new Map();
function hexToRgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
        const n = parseInt(hex.slice(1), 16);
        v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        rgbCache.set(hex, v);
    }
    return v;
}

function mixHex(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function circleRect(cx, cy, r, left, top, right, bottom) {
    const dx = cx - clamp(cx, left, right);
    const dy = cy - clamp(cy, top, bottom);
    return dx * dx + dy * dy < r * r;
}

function formatNum(n) {
    return Math.round(n).toLocaleString("en-US");
}


function density() {
    return Math.max(1, W / 420);
}

function moveSpeed() {
    return BASE_SPEED * (1 + (density() - 1) * 0.35);
}


// ==================================================
// CANVAS + SIZING
// ==================================================

const shell = $("shell");
const canvas = $("game");
const ctx = canvas.getContext("2d");

let H = 760;
let scale = 1;
let dpr = 1;

function resize() {
    const cssW = window.innerWidth;
    const vh = document.body.clientHeight || window.innerHeight;
    const oldW = W;

    shell.style.width = cssW + "px";

    // The world is ~820 units tall on every screen and the width fills the rest,
    // so phones get a tall narrow field and desktops a wide one.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.max(vh / 820, 0.6);
    if (cssW / scale < 360) scale = cssW / 360;
    W = cssW / scale;
    H = vh / scale;

    buildSkyline();
    placeTargets();
    if (state !== "menu" && oldW !== W) {
        const k = W / oldW;
        player.x *= k;
        for (const c of clouds) c.x = clamp(c.x * k, c.w / 2 + 4, W - c.w / 2 - 4);
        for (const z of hazards) z.x *= k;
        for (const p of pickups) p.x *= k;
    }

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = vh + "px";

    sprites.clear();

    if (state === "menu") setupAttract();
}


// ==================================================
// SAVE DATA
// ==================================================

const SAVE_KEY = "journey-of-a-drop-doodle-v1";

const save = (() => {
    const data = {
        best: 0,
        missions: [],
        muted: false,
        runs: 0
    };
    try {
        const stored = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (stored && typeof stored === "object") Object.assign(data, stored);
    } catch (e) { /* storage unavailable: play without saving */ }
    return data;
})();

function persist() {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) { /* ignore */ }
}


// ==================================================
// SOUND (tiny synth, no audio files)
// ==================================================

const Sound = {
    ac: null,
    master: null,
    noiseBuffer: null,

    unlock() {
        if (this.ac) {
            if (this.ac.state === "suspended") this.ac.resume();
            return;
        }
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ac = new AC();
            this.master = this.ac.createGain();
            this.master.gain.value = 0.32;
            this.master.connect(this.ac.destination);
        } catch (e) {
            this.ac = null;
        }
    },

    tone(f1, f2, dur, type = "sine", vol = 0.4, delay = 0) {
        if (!this.ac || save.muted) return;
        const t = this.ac.currentTime + delay;
        const o = this.ac.createOscillator();
        const g = this.ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1, t);
        if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.03);
    },

    noise(dur, vol = 0.25, freq = 1200, delay = 0) {
        if (!this.ac || save.muted) return;
        if (!this.noiseBuffer) {
            const len = Math.floor(this.ac.sampleRate * 0.6);
            this.noiseBuffer = this.ac.createBuffer(1, len, this.ac.sampleRate);
            const d = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        const t = this.ac.currentTime + delay;
        const s = this.ac.createBufferSource();
        const f = this.ac.createBiquadFilter();
        const g = this.ac.createGain();
        s.buffer = this.noiseBuffer;
        f.type = "lowpass";
        f.frequency.value = freq;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f);
        f.connect(g);
        g.connect(this.master);
        s.start(t);
        s.stop(t + dur + 0.02);
    },

    play(name, n = 0) {
        switch (name) {
            case "bounce": {
                const f = 300 * Math.pow(1.04, Math.min(n, 14));
                this.tone(f, f * 2, 0.14, "sine", 0.45);
                this.tone(f * 2, f * 3, 0.07, "triangle", 0.12);
                break;
            }
            case "spring":
                this.tone(200, 1200, 0.38, "sine", 0.45);
                this.tone(400, 1600, 0.2, "triangle", 0.1, 0.05);
                break;
            case "drop": {
                const f = 880 * Math.pow(1.06, Math.min(n, 12));
                this.tone(f, f * 1.5, 0.08, "triangle", 0.3);
                this.tone(f * 1.5, f * 1.5, 0.09, "sine", 0.18, 0.05);
                break;
            }
            case "hurt":
                this.tone(220, 70, 0.28, "square", 0.14);
                this.noise(0.22, 0.22, 700);
                break;
            case "stomp":
                this.tone(700, 160, 0.16, "square", 0.12);
                this.noise(0.12, 0.2, 3200);
                this.tone(900, 1400, 0.12, "triangle", 0.2, 0.08);
                break;
            case "break":
                this.noise(0.28, 0.3, 1600);
                break;
            case "bonk":
                this.tone(140, 320, 0.11, "square", 0.16);
                break;
            case "tweet":
                this.tone(1800, 2600, 0.07, "sine", 0.18);
                this.tone(2000, 3000, 0.07, "sine", 0.15, 0.08);
                break;
            case "power":
                [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.12, "triangle", 0.25, i * 0.06));
                break;
            case "combo":
                [784, 988, 1175].forEach((f, i) => this.tone(f, f, 0.09, "square", 0.08, i * 0.05));
                break;
            case "zone":
                this.tone(523, 523, 0.12, "triangle", 0.25);
                this.tone(784, 784, 0.22, "triangle", 0.25, 0.12);
                break;
            case "win":
                [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.22, "triangle", 0.28, i * 0.09));
                this.tone(1047, 1047, 0.6, "sine", 0.2, 0.5);
                break;
            case "lose":
                [392, 330, 277, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.25, "triangle", 0.28, i * 0.14));
                break;
            case "mission":
                [880, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.12, "sine", 0.25, i * 0.07));
                break;
            case "click":
                this.tone(650, 900, 0.05, "triangle", 0.18);
                break;
            case "buy":
                [660, 990, 1320].forEach((f, i) => this.tone(f, f, 0.1, "triangle", 0.25, i * 0.05));
                break;
        }
    }
};


// ==================================================
// SPRITES (pre-rendered once per screen size)
// ==================================================

const sprites = new Map();

function sprite(key, bw, bh, ox, oy, draw) {
    let s = sprites.get(key);
    if (s) return s;

    const k = scale * dpr;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(bw * k));
    c.height = Math.max(1, Math.ceil(bh * k));

    const g = c.getContext("2d");
    g.setTransform(k, 0, 0, k, ox * k, oy * k);
    g.lineJoin = "round";
    g.lineCap = "round";
    draw(g);

    s = { c, bw, bh, ox, oy };
    sprites.set(key, s);
    return s;
}

function blit(g, s, x, y) {
    g.drawImage(s.c, x - s.ox, y - s.oy, s.bw, s.bh);
}


// ==================================================
// GAME DATA
// ==================================================

const ZONES = [
    { name: "Cloud Kingdom", tip: "Bounce on fluffy clouds. Birds are bouncy too!", floor: 7500, top: "#58c0f0", bottom: "#c8eeff" },
    { name: "Windy Heights", tip: "Gusts push you sideways. Dodge the dust clouds!", floor: 5000, top: "#4aaee6", bottom: "#bfe8ef" },
    { name: "Smog City", tip: "Dirty air drains purity. Stomp the smog monsters!", floor: 2500, top: "#7c96aa", bottom: "#cdb995" },
    { name: "Farmlands", tip: "Land on plastic bottles to recycle them.", floor: 600, top: "#62bbea", bottom: "#ffe6b5" },
    { name: "Final Approach", tip: "Find the clean well. Skip the pond and the drain!", floor: -Infinity, top: "#6fc8ef", bottom: "#d6f4de" }
];

const ZONE_BLEND = 450;

const CLOUD_STYLE = {
    clean:    { fill: "#ffffff", shade: "#cfe3f1" },
    moving:   { fill: "#effcf5", shade: "#b5e3c8" },
    fragile:  { fill: "#f8f2df", shade: "#d9cca3" },
    bouncy:   { fill: "#ffe6f2", shade: "#f2a6cc" },
    dust:     { fill: "#d4ae83", shade: "#a8805a" },
    soot:     { fill: "#5a5e67", shade: "#3a3d44" },
    smog:     { fill: "#9ea08a", shade: "#777a64" },
    chemical: { fill: "#b8de58", shade: "#82ab2c" }
};

const BAD = { dust: true, soot: true, smog: true, chemical: true };

const DAMAGE = { dust: 6, soot: 9, smog: 11, chemical: 16, monster: 12, puff: 7, bottle: 9 };

const LABEL = { dust: "dust", soot: "soot", smog: "smog", chemical: "chemicals", monster: "smog monster", puff: "smoke", bottle: "plastic" };

const CLOUD_WEIGHTS = [
    { clean: 58, moving: 8, fragile: 10, bouncy: 6, dust: 18 },
    { clean: 40, moving: 16, fragile: 12, bouncy: 6, dust: 14, soot: 12 },
    { clean: 30, moving: 12, fragile: 10, bouncy: 5, soot: 15, smog: 18, chemical: 10 },
    { clean: 30, moving: 14, fragile: 12, bouncy: 6, dust: 12, smog: 12, chemical: 14 },
    { clean: 60, moving: 10, fragile: 10, bouncy: 10, dust: 10 }
];

const HAZARD_ODDS = [
    { bird: 0.07 },
    { bird: 0.11, monster: 0.05 },
    { monster: 0.12, puff: 0.14 },
    { bottle: 0.13, monster: 0.07, puff: 0.05, bird: 0.04 },
    {}
];

const MISSIONS = [
    { id: "drops30", text: "Collect 30 droplets in one run", stat: "droplets", goal: 30 },
    { id: "bounce20", text: "Bounce on 20 clouds", stat: "bounces", goal: 20 },
    { id: "stomp3", text: "Stomp 3 smog monsters", stat: "stomps", goal: 3 },
    { id: "combo4", text: "Reach a x4 combo", stat: "maxMult", goal: 4 },
    { id: "well", text: "Land in the clean well", stat: "won", goal: 1 },
    { id: "pure80", text: "Reach the well with 80%+ purity", stat: "pureWin", goal: 1 },
    { id: "recycle2", text: "Recycle 2 plastic bottles", stat: "recycled", goal: 2 },
    { id: "bouncy3", text: "Spring off 3 pink bouncy clouds", stat: "bouncy", goal: 3 },
    { id: "shield1", text: "Grab a filter shield", stat: "shields", goal: 1 },
    { id: "birds2", text: "Bounce on 2 birds", stat: "birds", goal: 2 },
    { id: "score4k", text: "Score 4,000 points", stat: "score", goal: 4000 },
    { id: "nochem", text: "Reach the well without touching chemicals", stat: "cleanWin", goal: 1 }
];

const FACTS = [
    "About 2.2 billion people still lack safely managed drinking water at home (WHO/UNICEF, 2023).",
    "Women and girls spend an estimated 200 million hours every day collecting water (UNICEF).",
    "Only about 3% of Earth's water is fresh, and most of that is frozen in glaciers and ice caps.",
    "Water vapour stays in the air for about 9 days on average before it falls as rain or snow.",
    "Groundwater supplies roughly half of the water people use at home around the world (UN, 2022).",
    "Burning coal and oil releases sulfur and nitrogen that can turn rain acidic.",
    "Scientists have found tiny microplastics in rainwater, even far from cities."
];

const TARGET_INFO = {
    well:  { label: "CLEAN WELL", w: 92 },
    pond:  { label: "MUDDY POND", w: 92 },
    drain: { label: "TOXIC DRAIN", w: 92 }
};


// ==================================================
// STATE
// ==================================================

let state = "menu";       // menu | play | pause | ending | over
let time = 0;
let camY = 0;
let shake = 0;
let wind = 0;
let zoneIdx = -1;
let genY = 0;
let badStreak = 0;
let endTimer = 0;
let endKind = "";
let dropStreak = 0;
let dropStreakT = 0;
let groundHintT = 0;

let clouds = [];
let hazards = [];
let pickups = [];
let particles = [];
let texts = [];
let targets = [];
let windLines = [];

let player = makePlayer();
let run = makeRun();

let skyline = [];

function buildSkyline() {
    const r = rng(42);
    skyline = [];
    let x = -10;
    while (x < W + 20) {
        const w = 34 + r() * 40;
        skyline.push({ x, w, h: 70 + r() * 120, chimney: r() < 0.4, windows: r() < 0.7 });
        x += w + 4;
    }
}

// Landing targets sit in the middle of the ground, however wide the screen is.
function placeTargets() {
    const span = Math.min(W - 40, 600);
    targets.forEach((t, i) => { t.x = W / 2 + (i - 1) * span * 0.33; });
}

function makePlayer() {
    return {
        x: W / 2, y: 0, vx: 0, vy: 0,
        sq: 0, sqv: 0, rot: 0, spin: 0, spinDir: 1,
        inv: 0, shield: 0, magnet: 0,
        mood: "happy", moodT: 0,
        blink: 0, blinkT: 2, look: 0,
        hidden: false, sink: 0
    };
}

function makeRun() {
    return {
        purity: 100, combo: 0, mult: 1, maxMult: 1,
        dist: 0, tricks: 0, dropPts: 0, bonus: 0, score: 0,
        droplets: 0, bounces: 0, stomps: 0, bouncy: 0, shields: 0,
        birds: 0, recycled: 0, chemHits: 0,
        won: 0, pureWin: 0, cleanWin: 0,
        done: new Set()
    };
}


// ==================================================
// INPUT
// ==================================================

const keys = { left: false, right: false };
const pointers = new Map();
let touchUsed = false;

function inputDir() {
    let l = keys.left;
    let r = keys.right;
    for (const side of pointers.values()) {
        if (side < 0) l = true;
        else r = true;
    }
    return (r ? 1 : 0) - (l ? 1 : 0);
}

window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") { keys.left = true; e.preventDefault(); }
    else if (k === "arrowright" || k === "d") { keys.right = true; e.preventDefault(); }
    else if (k === "p" || k === "escape") {
        if (state === "play") pauseGame();
        else if (state === "pause") resumeGame();
    } else if ((k === " " || k === "enter") && state === "menu" && document.activeElement === document.body) {
        e.preventDefault();
        startGame();
    }
});

window.addEventListener("keyup", e => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keys.left = false;
    else if (k === "arrowright" || k === "d") keys.right = false;
});

function pointerSide(e) {
    const r = canvas.getBoundingClientRect();
    return e.clientX - r.left < r.width / 2 ? -1 : 1;
}

canvas.addEventListener("pointerdown", e => {
    if (state !== "play") return;
    e.preventDefault();
    touchUsed = touchUsed || e.pointerType !== "mouse";
    pointers.set(e.pointerId, pointerSide(e));
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});

canvas.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pointerSide(e));
});

const releasePointer = e => pointers.delete(e.pointerId);
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);
canvas.addEventListener("contextmenu", e => e.preventDefault());

window.addEventListener("blur", () => {
    keys.left = keys.right = false;
    pointers.clear();
    if (state === "play") pauseGame();
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "play") pauseGame();
});


// ==================================================
// WORLD HELPERS
// ==================================================

function altAt(y) {
    return clamp(START_ALT * (1 - y / GROUND_Y), 0, START_ALT);
}

function zoneIndex(alt) {
    for (let i = 0; i < ZONES.length; i++) {
        if (alt > ZONES[i].floor) return i;
    }
    return ZONES.length - 1;
}

function zoneBlend(alt) {
    const i = zoneIndex(alt);
    const floor = ZONES[i].floor;
    if (i < ZONES.length - 1 && alt < floor + ZONE_BLEND) {
        return { i, j: i + 1, t: 1 - (alt - floor) / ZONE_BLEND };
    }
    return { i, j: i, t: 0 };
}

function zoneWeight(b, k) {
    let w = 0;
    if (b.i === k) w += 1 - b.t;
    if (b.j === k && b.j !== b.i) w += b.t;
    return w;
}

function weighted(table) {
    let total = 0;
    for (const k in table) total += table[k];
    let r = Math.random() * total;
    for (const k in table) {
        r -= table[k];
        if (r <= 0) return k;
    }
    return "clean";
}


// ==================================================
// SPAWNING
// ==================================================

function addCloud(type, y, avoid) {
    const depth = y / GROUND_Y;
    const sizes = BAD[type] ? [78, 96] : type === "bouncy" ? [78] : [78, 96, 116];
    const w = pick(sizes);
    let x = W / 2;

    for (let i = 0; i < 10; i++) {
        x = rand(w / 2 + 6, W - w / 2 - 6);
        if (!avoid || avoid.every(a => Math.abs(x - a) > w / 2 + 75)) break;
    }

    const c = {
        type, x, y, w,
        h: Math.round(w * 0.42),
        shape: Math.random() < 0.5 ? 0 : 1,
        vx: type === "moving" ? pick([-1, 1]) * rand(45, 85) * (1 + depth * 0.6) : 0,
        sq: 0, sqv: 0, spring: 0,
        hit: false, scored: false, broken: false, alpha: 1,
        phase: Math.random() * TAU
    };
    clouds.push(c);
    return c;
}

function addPickup(kind, x, y) {
    pickups.push({ kind, x: clamp(x, 18, W - 18), y, phase: Math.random() * TAU });
}

function addHazard(kind, y, avoidX) {
    let x = W / 2;
    for (let i = 0; i < 8; i++) {
        x = rand(30, W - 30);
        if (Math.abs(x - avoidX) > 90) break;
    }

    const z = { kind, x, y, phase: Math.random() * TAU, dieT: 0, cool: 0, hitT: 0 };

    if (kind === "bird") {
        z.vx = pick([-1, 1]) * rand(70, 120);
        z.r = 16;
    } else if (kind === "monster") {
        z.vx = pick([-1, 1]) * rand(25, 60);
        z.r = 21;
    } else if (kind === "puff") {
        z.vy = -rand(40, 70);
        z.r = rand(17, 22);
        z.active = false;
    } else if (kind === "bottle") {
        z.vy = -rand(15, 30);
        z.vx = rand(-20, 20);
        z.rot = rand(0, TAU);
        z.vr = rand(-1.5, 1.5);
        z.r = 16;
        z.active = false;
    }
    hazards.push(z);
}

function spawnRow(y) {
    const alt = altAt(y);
    const z = zoneIndex(alt);
    const depth = y / GROUND_Y;

    let type = weighted(CLOUD_WEIGHTS[z]);
    if (BAD[type] && badStreak >= 2) type = "clean";
    badStreak = BAD[type] ? badStreak + 1 : 0;

    const first = addCloud(type, y, null);

    // Wider screens get more clouds per row so the sky never looks empty
    const dens = density();
    const xs = [first.x];
    let extra = Math.random() < 0.26 + depth * 0.22 ? 1 : 0;
    extra += Math.floor((dens - 1) * rand(0.8, 1.4));
    for (let i = 0; i < extra; i++) {
        let next = weighted(CLOUD_WEIGHTS[z]);
        if (BAD[type] && BAD[next]) next = "clean";
        const c = addCloud(next, y + rand(-30, 30), xs);
        xs.push(c.x);
        if (!BAD[next] && Math.random() < 0.3) addPickup("drop", c.x + rand(-18, 18), c.y - c.h * 0.5 - 30);
    }

    if (!BAD[type] && Math.random() < 0.45) {
        addPickup("drop", first.x + rand(-18, 18), y - first.h * 0.5 - 30);
    }

    if (Math.random() < 0.06) {
        const x = rand(50, W - 50);
        for (let i = 0; i < 5; i++) {
            addPickup("drop", x + Math.sin(i * 0.9) * 26, y + 40 + i * 26);
        }
    }

    const roll = Math.random();
    if (y > 900) {
        if (roll < 0.028) addPickup("shield", rand(40, W - 40), y + rand(50, 80));
        else if (roll < 0.05) addPickup("magnet", rand(40, W - 40), y + rand(50, 80));
    }

    if (y < 500) return;

    const odds = HAZARD_ODDS[z];
    for (const kind in odds) {
        const chance = odds[kind] * (0.8 + depth * 0.5) * Math.max(1, dens * 0.8);
        const n = Math.floor(chance) + (Math.random() < chance % 1 ? 1 : 0);
        for (let i = 0; i < n; i++) addHazard(kind, y + rand(45, 75), first.x);
    }
}

function generateUntil(limit) {
    const stop = GROUND_Y - 420;
    while (genY < limit && genY < stop) {
        spawnRow(genY);
        const depth = genY / GROUND_Y;
        genY += 96 + depth * 44 + rand(0, 42);
    }
}


// ==================================================
// RUN LIFECYCLE
// ==================================================

function resetWorld() {
    clouds = [];
    hazards = [];
    pickups = [];
    particles = [];
    texts = [];
    windLines = [];
    shake = 0;
    wind = 0;
    badStreak = 0;
}

function startGame() {
    Sound.unlock();
    Sound.play("click");
    resetWorld();

    player = makePlayer();
    run = makeRun();
    time = 0;
    zoneIdx = -1;
    dropStreak = 0;
    groundHintT = 0;
    endKind = "";

    player.y = -20;
    player.vy = 60;
    camY = player.y - H * 0.4;

    const startCloud = addCloud("clean", 120, null);
    startCloud.x = W / 2;
    startCloud.w = 116;
    startCloud.h = Math.round(116 * 0.42);
    genY = 260;
    generateUntil(camY + H + 500);

    const kinds = ["well", "pond", "drain"].sort(() => Math.random() - 0.5);
    targets = kinds.map(kind => ({ kind, x: 0, w: TARGET_INFO[kind].w }));
    placeTargets();

    ensureMissions();

    showScreen(null);
    $("hud").hidden = false;
    $("subhud").hidden = false;
    hudCache.clear();

    pointers.clear();
    $("touch-hint").hidden = !(touchUsed || matchMedia("(pointer: coarse)").matches);
    if (!$("touch-hint").hidden) {
        const hint = $("touch-hint");
        hint.style.animation = "none";
        void hint.offsetWidth;
        hint.style.animation = "";
    }

    state = "play";
}

function pauseGame() {
    if (state !== "play") return;
    state = "pause";
    keys.left = keys.right = false;
    pointers.clear();
    showScreen("pause");
}

function resumeGame() {
    if (state !== "pause") return;
    Sound.unlock();
    showScreen(null);
    state = "play";
}

function goToMenu() {
    state = "menu";
    $("hud").hidden = true;
    $("subhud").hidden = true;
    $("touch-hint").hidden = true;
    hideBanner();
    setupAttract();
    renderMenu();
    showScreen("menu");
}

function showScreen(id) {
    for (const s of ["menu", "pause", "over"]) $(s).hidden = s !== id;
    const btn = id && $(id).querySelector(".btn");
    if (btn) btn.focus({ preventScroll: true });
}


// ==================================================
// SCORING + FEEDBACK
// ==================================================

function addText(x, y, text, color = INK, size = 22) {
    if (texts.length > 40) texts.shift();
    texts.push({ x, y, text, color, size, life: 0.9, max: 0.9 });
}

function gain(part, base, x, y, label) {
    const pts = base * run.mult;
    run[part] += pts;
    addText(x, y, label ? `${label} +${pts}` : `+${pts}`, run.mult > 1 ? "#ff8a00" : INK, run.mult > 1 ? 22 : 20);
}

function addCombo() {
    run.combo++;
    const m = Math.min(5, 1 + Math.floor(run.combo / 4));
    if (m > run.mult) {
        run.mult = m;
        run.maxMult = Math.max(run.maxMult, m);
        addText(player.x, player.y - 46, `COMBO x${m}!`, "#ff8a00", 28);
        Sound.play("combo");
        burst(player.x, player.y, 10, { type: "star", color: ["#ffc93c", "#ff8a00"], min: 120, max: 260, size: [5, 8], g: 200 });
    }
}

function hurt(amount, source, x, y) {
    const p = player;
    if (p.inv > 0 || state !== "play") return false;

    run.purity = Math.max(0, run.purity - amount);
    p.inv = 0.9;
    p.mood = "ouch";
    p.moodT = 0.7;

    if (run.mult > 1) addText(p.x, p.y - 56, "combo lost", "#8a6a3a", 18);
    run.combo = 0;
    run.mult = 1;

    if (source === "chemical") run.chemHits++;

    shake = 8;
    Sound.play("hurt");
    addText(x, y - 10, `-${amount}% ${LABEL[source] || ""}`, "#8a5a2a", 21);

    const muck = source === "chemical" ? ["#9cc43a", "#6f8f22"] : ["#6b604a", "#8a7a5a", "#3a3d44"];
    burst(p.x, p.y, 14, { color: muck, min: 80, max: 230, size: [3, 6], g: 600 });

    const chip = $("purity-chip");
    chip.classList.remove("hurt");
    void chip.offsetWidth;
    chip.classList.add("hurt");
    return true;
}


// ==================================================
// PARTICLES
// ==================================================

function burst(x, y, n, o) {
    for (let i = 0; i < n; i++) {
        if (particles.length > 420) particles.shift();
        const a = o.angle != null ? o.angle + rand(-o.spread, o.spread) : rand(0, TAU);
        const sp = rand(o.min || 60, o.max || 200);
        const life = rand(0.45, 0.85) * (o.life || 1);
        particles.push({
            x: x + rand(-(o.jx || 0), o.jx || 0),
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life,
            max: life,
            size: rand(o.size[0], o.size[1]),
            color: Array.isArray(o.color) ? pick(o.color) : o.color,
            type: o.type || "dot",
            g: o.g != null ? o.g : 500,
            drag: o.drag || 0,
            rot: rand(0, TAU),
            vr: rand(-9, 9)
        });
    }
}

function puffs(x, y, n, color = "#ffffff") {
    burst(x, y, n, { type: "puff", color, min: 30, max: 90, size: [6, 11], g: -30, drag: 2, jx: 14 });
}

function updateFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life -= dt;
        if (q.life <= 0) {
            particles[i] = particles[particles.length - 1];
            particles.pop();
            continue;
        }
        q.vy += q.g * dt;
        if (q.drag) {
            q.vx *= 1 - q.drag * dt;
            q.vy *= 1 - q.drag * dt;
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.rot += q.vr * dt;
    }

    for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.life -= dt;
        t.y -= 46 * dt;
        if (t.life <= 0) texts.splice(i, 1);
    }

    shake = Math.max(0, shake - dt * 28);
}


// ==================================================
// UPDATE: PLAYING
// ==================================================

function update(h) {
    const p = player;
    time += h;

    const alt = altAt(p.y);
    const z = zoneIndex(alt);

    if (z !== zoneIdx) {
        if (zoneIdx !== -1) Sound.play("zone");
        zoneIdx = z;
        showBanner(ZONES[z]);
    }

    // Wind gusts in Windy Heights
    const targetWind = z === 1 ? Math.sin(time * 0.55) * 160 : 0;
    wind = lerp(wind, targetWind, Math.min(1, h * 1.5));

    // Steering (snappy like Doodle Jump, wraps around the edges)
    const dir = inputDir();
    const targetVx = dir * moveSpeed() + wind;
    p.vx += (targetVx - p.vx) * Math.min(1, h * (dir ? 14 : 6));
    p.x += p.vx * h;
    if (p.x < -22) p.x += W + 44;
    else if (p.x > W + 22) p.x -= W + 44;

    p.look = lerp(p.look, clamp(p.vx / moveSpeed(), -1, 1), Math.min(1, h * 10));
    p.rot = lerp(p.rot, (p.vx / moveSpeed()) * 0.22, Math.min(1, h * 10));

    // Falling
    const prevBottom = p.y + FOOT;
    p.vy = Math.min(p.vy + GRAVITY * h, MAX_FALL);
    p.y += p.vy * h;

    // Jelly squash spring
    p.sqv += (-170 * p.sq - 9 * p.sqv) * h;
    p.sq += p.sqv * h;
    if (p.spin > 0) p.spin = Math.max(0, p.spin - h * TAU * 1.5);

    p.inv -= h;
    p.shield -= h;
    p.magnet -= h;
    p.moodT -= h;
    if (p.moodT <= 0) p.mood = run.purity < 35 ? "sick" : "happy";
    p.blinkT -= h;
    if (p.blinkT <= 0) {
        p.blink = 0.13;
        p.blinkT = rand(2, 4.5);
    }
    p.blink -= h;

    // Smog City air slowly dirties the drop
    if (z === 2 && p.shield <= 0) run.purity = Math.max(0, run.purity - 0.5 * h);

    dropStreakT -= h;
    if (dropStreakT <= 0) dropStreak = 0;

    updateClouds(h, prevBottom);
    updateHazards(h);
    updatePickups(h);
    updateWind(h);

    generateUntil(camY + H + 500);
    cull();

    if (p.y + FOOT >= GROUND_Y) landOnGround();

    camY = Math.max(camY, p.y - H * 0.4);
    camY = Math.min(camY, GROUND_Y + 150 - H);

    run.dist = Math.max(run.dist, Math.floor(Math.max(0, p.y) / 8));
    run.score = run.dist + run.tricks + run.dropPts + run.bonus;

    if (run.purity <= 0 && state === "play") polluted();
}

function updateClouds(h, prevBottom) {
    const p = player;
    const bottom = p.y + FOOT;

    for (const c of clouds) {
        if (c.vx) {
            c.x += c.vx * h;
            if (c.x < c.w / 2 + 4) { c.x = c.w / 2 + 4; c.vx = Math.abs(c.vx); }
            else if (c.x > W - c.w / 2 - 4) { c.x = W - c.w / 2 - 4; c.vx = -Math.abs(c.vx); }
        }

        c.sqv += (-240 * c.sq - 11 * c.sqv) * h;
        c.sq += c.sqv * h;
        if (c.spring > 0) c.spring = Math.max(0, c.spring - h * 3);

        if (c.broken) {
            c.alpha -= h * 3;
            c.y += 140 * h;
            continue;
        }

        if (c.hit && c.alpha > 0.5) c.alpha -= h * 2;

        const left = c.x - c.w / 2;
        const right = c.x + c.w / 2;

        if (BAD[c.type]) {
            if (!c.hit && circleRect(p.x, p.y + 4, 14, left + 6, c.y - c.h * 0.45, right - 6, c.y + c.h * 0.42)) {
                c.hit = true;
                if (p.shield > 0) purify(c);
                else if (hurt(DAMAGE[c.type], c.type, c.x, c.y - c.h)) p.vy *= 0.45;
            }
            continue;
        }

        const top = c.y - c.h * 0.5;
        if (p.vy > 0 && prevBottom <= top + 3 && bottom >= top && p.x > left + 2 && p.x < right - 2) {
            p.y = top - FOOT;
            bounceOn(c, top);
        }
    }
}

function bounceOn(c, top) {
    const p = player;

    if (c.type === "bouncy") {
        p.vy = SUPER_BOUNCE;
        p.spin = TAU;
        p.spinDir = sign(p.vx || 1);
        c.spring = 1;
        run.bouncy++;
        Sound.play("spring");
        addText(c.x, top - 30, "BOING!", "#e0559a", 26);
    } else {
        p.vy = BOUNCE;
        Sound.play("bounce", run.combo);
    }

    p.sqv = -7;
    c.sqv = 6;
    run.bounces++;
    puffs(p.x, top + 2, 4);

    if (!c.scored) {
        c.scored = true;
        addCombo();
        gain("tricks", c.type === "bouncy" ? 25 : 10, c.x, top - 12);
    }

    if (c.type === "fragile") {
        c.broken = true;
        Sound.play("break");
        puffs(c.x, c.y, 10, "#f8f2df");
    }
}

function purify(c) {
    c.type = "clean";
    c.hit = false;
    c.alpha = 1;
    burst(c.x, c.y, 14, { type: "star", color: ["#ffffff", "#8fe3ff", "#ffc93c"], min: 80, max: 220, size: [4, 7], g: 100 });
    gain("tricks", 20, c.x, c.y - c.h, "PURIFIED");
    Sound.play("stomp");
}

function updateHazards(h) {
    const p = player;

    for (const z of hazards) {
        if (z.dying) {
            z.dieT -= h;
            if (z.dieT <= 0) z.gone = true;
            continue;
        }

        z.cool -= h;
        z.hitT -= h;

        if (z.kind === "bird") {
            z.x += z.vx * h;
            z.phase += h * 13;
            if (z.x < -30) z.x = W + 30;
            else if (z.x > W + 30) z.x = -30;
        } else if (z.kind === "monster") {
            z.x += z.vx * h;
            z.phase += h * 3;
            z.y += Math.sin(z.phase) * 14 * h;
            if (z.x < 28 || z.x > W - 28) z.vx = -z.vx;
            z.x = clamp(z.x, 28, W - 28);
        } else {
            if (!z.active && z.y < camY + H + 40) z.active = true;
            if (z.active) {
                z.y += z.vy * h;
                if (z.kind === "puff") {
                    z.phase += h * 2;
                    z.x += Math.sin(z.phase) * 22 * h;
                } else {
                    z.x += z.vx * h;
                    z.rot += z.vr * h;
                    if (z.x < -20) z.x = W + 20;
                    else if (z.x > W + 20) z.x = -20;
                }
            }
        }

        const dx = p.x - z.x;
        const dy = p.y + 2 - z.y;
        const reach = z.r + 15;
        if (dx * dx + dy * dy < reach * reach) hitHazard(z);
    }
}

function hitHazard(z) {
    const p = player;
    const fromAbove = p.vy > 40 && p.y + 10 < z.y - z.r * 0.1;

    if (z.kind === "bird") {
        if (z.cool > 0) return;
        z.cool = 0.4;
        z.hitT = 0.35;
        if (fromAbove) {
            p.vy = BOUNCE * 1.05;
            p.sqv = -7;
            run.birds++;
            addCombo();
            gain("tricks", 15, z.x, z.y - 26, "TWEET");
            Sound.play("tweet");
        } else {
            p.vx = sign(dx0(z)) * 480;
            p.vy = Math.min(p.vy, -120);
            addText(z.x, z.y - 24, "BONK!", INK, 24);
            Sound.play("bonk");
        }
        burst(z.x, z.y, 6, { type: "feather", color: ["#ff9a76", "#ffd1bf"], min: 40, max: 140, size: [4, 6], g: 120, drag: 2 });
        return;
    }

    if (z.kind === "monster") {
        if (fromAbove || p.shield > 0) {
            z.dieT = 0.5;
            z.dying = true;
            p.vy = STOMP_BOUNCE;
            p.sqv = -8;
            run.stomps++;
            addCombo();
            gain("tricks", 50, z.x, z.y - 30, "CLEANED");
            Sound.play("stomp");
            shake = 4;
            burst(z.x, z.y, 16, { type: "star", color: ["#ffffff", "#8fe3ff", "#ffc93c"], min: 90, max: 260, size: [4, 8], g: 150 });
            puffs(z.x, z.y, 6, "#a9a2b5");
        } else if (z.cool <= 0) {
            z.cool = 1;
            if (hurt(DAMAGE.monster, "monster", z.x, z.y - 24)) p.vx = sign(dx0(z)) * 360;
        }
        return;
    }

    if (z.kind === "puff") {
        z.dieT = 0.35;
            z.dying = true;
        if (p.shield > 0) gain("tricks", 10, z.x, z.y - 20);
        else hurt(DAMAGE.puff, "puff", z.x, z.y - 20);
        puffs(z.x, z.y, 7, "#b4b1aa");
        return;
    }

    if (z.kind === "bottle") {
        if (fromAbove || p.shield > 0) {
            z.dieT = 0.45;
            z.dying = true;
            p.vy = BOUNCE * 0.9;
            p.sqv = -7;
            run.recycled++;
            addCombo();
            gain("tricks", 30, z.x, z.y - 26, "RECYCLED");
            Sound.play("stomp");
            burst(z.x, z.y, 12, { type: "star", color: ["#5cc36b", "#8fe3ff"], min: 80, max: 220, size: [4, 7], g: 150 });
        } else if (z.cool <= 0) {
            z.cool = 1;
            hurt(DAMAGE.bottle, "bottle", z.x, z.y - 20);
        }
    }
}

function dx0(z) {
    return player.x - z.x || 1;
}

function updatePickups(h) {
    const p = player;

    for (const k of pickups) {
        if (k.got) continue;
        k.phase += h * 4;

        const dx = p.x - k.x;
        const dy = p.y - k.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;

        if (k.kind === "drop" && p.magnet > 0 && d < 180) {
            k.x += (dx / d) * 460 * h;
            k.y += (dy / d) * 460 * h;
        }

        if (d < 27) collect(k);
    }
}

function collect(k) {
    const p = player;
    k.got = true;

    if (k.kind === "drop") {
        run.droplets++;
        run.purity = Math.min(100, run.purity + 3);
        dropStreak++;
        dropStreakT = 1.2;
        gain("dropPts", 5, k.x, k.y - 12);
        Sound.play("drop", dropStreak);
        burst(k.x, k.y, 7, { color: ["#8fe3ff", "#4cc3f5", "#ffffff"], min: 50, max: 150, size: [2, 4], g: 300 });
    } else if (k.kind === "shield") {
        p.shield = 7;
        run.shields++;
        addText(k.x, k.y - 20, "FILTER SHIELD!", "#1f7fc4", 26);
        Sound.play("power");
        burst(k.x, k.y, 16, { type: "ring", color: "#4cc3f5", min: 10, max: 30, size: [8, 14], g: 0 });
    } else {
        p.magnet = 8;
        addText(k.x, k.y - 20, "DROP MAGNET!", "#e8574b", 26);
        Sound.play("power");
        burst(k.x, k.y, 12, { type: "star", color: ["#e8574b", "#ffc93c"], min: 80, max: 200, size: [4, 7], g: 100 });
    }
}

function updateWind(h) {
    if (Math.abs(wind) > 25 && windLines.length < 14 && Math.random() < h * 18) {
        windLines.push({ x: wind > 0 ? -60 : W + 60, y: rand(80, H - 40), len: rand(30, 80), life: 1.6 });
    }
    for (let i = windLines.length - 1; i >= 0; i--) {
        const l = windLines[i];
        l.x += wind * 3.2 * h;
        l.life -= h;
        if (l.life <= 0 || l.x < -120 || l.x > W + 120) windLines.splice(i, 1);
    }
}

function cull() {
    const limit = camY - 260;
    clouds = clouds.filter(c => c.y > limit && c.alpha > 0);
    hazards = hazards.filter(z => z.y > limit && !z.gone);
    pickups = pickups.filter(k => k.y > limit && !k.got);
}


// ==================================================
// THE GROUND + ENDINGS
// ==================================================

function landOnGround() {
    const p = player;

    for (const t of targets) {
        if (Math.abs(p.x - t.x) < t.w / 2 - 2) {
            finish(t);
            return;
        }
    }

    p.y = GROUND_Y - FOOT;
    p.vy = BOUNCE * 0.85;
    p.sqv = -7;
    Sound.play("bounce", 0);
    burst(p.x, GROUND_Y, 8, { color: ["#5cc36b", "#8ad27a"], min: 60, max: 160, size: [2, 4], g: 500, angle: -Math.PI / 2, spread: 1 });

    if (time - groundHintT > 1.5) {
        groundHintT = time;
        addText(p.x, GROUND_Y - 60, "find the clean well!", "#1f7fc4", 22);
    }
}

function finish(target) {
    const p = player;
    state = "ending";
    endTimer = 1.7;
    endKind = target.kind;
    p.vx = 0;
    p.vy = 0;
    p.y = GROUND_Y - 6;
    p.sink = 1;

    if (target.kind === "well") {
        run.won = 1;
        if (run.purity >= 80) run.pureWin = 1;
        if (run.chemHits === 0) run.cleanWin = 1;
        run.bonus = 500 + Math.round(run.purity) * 15;
        p.mood = "win";
        Sound.play("win");
        burst(target.x, GROUND_Y, 30, { color: ["#8fe3ff", "#4cc3f5", "#ffffff"], min: 150, max: 420, size: [3, 7], g: 700, angle: -Math.PI / 2, spread: 0.9 });
        burst(target.x, GROUND_Y - 30, 18, { type: "star", color: ["#ffc93c", "#ffffff"], min: 100, max: 300, size: [5, 9], g: 120 });
        addText(target.x, GROUND_Y - 70, "CLEAN WATER!", "#1f7fc4", 34);
    } else {
        p.mood = "sick";
        Sound.play("lose");
        const mud = target.kind === "pond" ? ["#9c8456", "#6b5a3a"] : ["#9cc43a", "#6f8f22"];
        burst(target.x, GROUND_Y, 26, { color: mud, min: 120, max: 340, size: [3, 7], g: 700, angle: -Math.PI / 2, spread: 0.9 });
        addText(target.x, GROUND_Y - 70, target.kind === "pond" ? "SPLAT! MUD!" : "EWW, TOXIC!", "#8a5a2a", 30);
    }
    run.score = run.dist + run.tricks + run.dropPts + run.bonus;
}

function polluted() {
    const p = player;
    state = "ending";
    endTimer = 1.6;
    endKind = "polluted";
    p.sink = 0;
    p.mood = "sick";
    p.vx = 0;
    p.vy = 0;
    Sound.play("lose");
    puffs(p.x, p.y, 16, "#8a8577");
    burst(p.x, p.y, 20, { color: ["#6b604a", "#3a3d44"], min: 60, max: 220, size: [3, 6], g: 300 });
    addText(p.x, p.y - 50, "TOO POLLUTED!", "#8a5a2a", 30);
}

function updateEnding(dt) {
    time += dt;
    const p = player;
    endTimer -= dt;

    if (endKind === "polluted") {
        p.sink = Math.min(1, p.sink + dt * 0.8);
        p.vy += 200 * dt;
        p.y += p.vy * dt;
    } else {
        p.y += 28 * dt;
        p.sink = Math.max(0, p.sink - dt * 0.9);
    }

    p.sqv += (-170 * p.sq - 9 * p.sqv) * dt;
    p.sq += p.sqv * dt;

    for (const c of clouds) {
        c.sqv += (-240 * c.sq - 11 * c.sqv) * dt;
        c.sq += c.sqv * dt;
    }

    if (endTimer <= 0) showGameOver();
}

function showGameOver() {
    state = "over";
    $("hud").hidden = true;
    $("subhud").hidden = true;
    $("touch-hint").hidden = true;
    hideBanner();
    clearTimeout(toastTimer);
    $("toast").classList.remove("show");

    const won = endKind === "well";
    const score = Math.round(run.score);
    const isBest = score > save.best;
    const missionResults = finishMissions();

    save.runs++;
    if (isBest) save.best = score;
    persist();

    const copy = {
        well: ["Safe water reached", "Clean landing!", "Your drop made it into the clean well, ready for someone to drink."],
        pond: ["Unsafe water", "Splashed in mud", "Your drop landed in a muddy pond. Next time, steer for the clean well."],
        drain: ["Unsafe water", "Down the drain", "Your drop fell into a toxic drain. Look for the well with the yellow jerrycan."],
        polluted: ["Purity hit 0%", "Too polluted", "Your drop soaked up too much pollution. Grab droplets and dodge dirty clouds to stay pure."]
    }[endKind];

    $("over-kicker").textContent = copy[0];
    $("over-title").textContent = copy[1];
    $("over-desc").textContent = copy[2];
    $("o-score").textContent = formatNum(score);
    $("o-purity").textContent = Math.round(run.purity) + "%";
    $("o-drops").textContent = run.droplets;
    $("o-best").textContent = formatNum(save.best);
    $("new-best").hidden = !isBest || score === 0;
    const overBrand = $("over-brand");
    if (overBrand) overBrand.hidden = !won;

    const rows = [
        ["Distance fallen", run.dist],
        ["Bounces and tricks", run.tricks],
        ["Droplets", run.dropPts]
    ];
    if (won) rows.push(["Clean well bonus", run.bonus]);
    $("o-breakdown").innerHTML = rows
        .map(([label, v]) => `<li><span>${label}</span><b>${formatNum(v)}</b></li>`)
        .join("");

    $("o-missions").innerHTML = missionResults.length
        ? `<h3>Missions</h3><ul>${missionResults.map(m =>
            `<li class="${m.done ? "done" : ""}"><span>${m.text}</span><em>${m.done ? "done" : m.progress}</em></li>`
        ).join("")}</ul>`
        : "";

    $("o-fact").textContent = FACTS[save.runs % FACTS.length];

    if (isBest && score > 0) {
        for (let i = 0; i < 70; i++) {
            burst(rand(0, W), camY - 10, 1, { type: "confetti", color: ["#ffc93c", "#4cc3f5", "#e8574b", "#5cc36b", "#e0559a"], min: 40, max: 120, size: [5, 9], g: 160, angle: Math.PI / 2, spread: 0.6, life: 4 });
        }
    }

    updateBestLabel();
    showScreen("over");
}


// ==================================================
// MISSIONS
// ==================================================

function ensureMissions() {
    save.missions = save.missions.filter(id => MISSIONS.some(m => m.id === id));
    while (save.missions.length < 3) {
        const options = MISSIONS.filter(m => !save.missions.includes(m.id));
        save.missions.push(pick(options).id);
    }
    persist();
}

function missionById(id) {
    return MISSIONS.find(m => m.id === id);
}

function checkMissionsLive() {
    for (const id of save.missions) {
        if (run.done.has(id)) continue;
        const m = missionById(id);
        if (m && run[m.stat] >= m.goal) {
            run.done.add(id);
            showToast(`Mission done: ${m.text}`);
            Sound.play("mission");
        }
    }
}

function finishMissions() {
    checkMissionsLive();
    const results = [];
    const keep = [];

    for (const id of save.missions) {
        const m = missionById(id);
        if (!m) continue;
        const done = run.done.has(id);
        const value = Math.min(m.goal, Math.floor(run[m.stat] || 0));
        results.push({ text: m.text, done, progress: `${formatNum(value)}/${formatNum(m.goal)}` });
        if (!done) keep.push(id);
    }

    save.missions = keep;
    ensureMissions();
    return results;
}


// ==================================================
// MENU ATTRACT SCENE
// ==================================================

function setupAttract() {
    resetWorld();
    player = makePlayer();
    run = makeRun();
    camY = 0;
    const wide = W > 900;
    const c = addCloud("clean", wide ? H * 0.66 : H - 70, null);
    c.x = wide ? Math.max(170, W / 2 - 430) : W / 2;
    c.w = 116;
    c.h = Math.round(116 * 0.42);
    c.vx = 0;
    player.y = c.y - 190;
}

function updateAttract(dt) {
    time += dt;
    const p = player;
    const c = clouds[0];
    if (!c) return;

    const prevBottom = p.y + FOOT;
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
    p.y += p.vy * dt;
    p.x = c.x + Math.sin(time * 0.9) * 26;
    p.look = Math.cos(time * 0.9);
    p.rot = Math.cos(time * 0.9) * 0.12;
    p.sqv += (-170 * p.sq - 9 * p.sqv) * dt;
    p.sq += p.sqv * dt;
    p.blinkT -= dt;
    if (p.blinkT <= 0) { p.blink = 0.13; p.blinkT = rand(2, 4); }
    p.blink -= dt;

    c.sqv += (-240 * c.sq - 11 * c.sqv) * dt;
    c.sq += c.sqv * dt;

    const top = c.y - c.h * 0.5;
    if (p.vy > 0 && prevBottom <= top + 3 && p.y + FOOT >= top) {
        p.y = top - FOOT;
        p.vy = BOUNCE * 1.05;
        p.sqv = -7;
        c.sqv = 6;
        puffs(p.x, top + 2, 3);
    }
}


// ==================================================
// DRAWING: SHAPES
// ==================================================

function teardropPath(g, s) {
    g.beginPath();
    g.moveTo(0, -26 * s);
    g.bezierCurveTo(6 * s, -16 * s, 17 * s, -6 * s, 17 * s, 7 * s);
    g.arc(0, 7 * s, 17 * s, 0, Math.PI, false);
    g.bezierCurveTo(-17 * s, -6 * s, -6 * s, -16 * s, 0, -26 * s);
    g.closePath();
}

function cloudLobes(w, h, shape) {
    const r = rng(w * 31 + shape * 977 + 7);
    const lobes = [];
    const n = Math.max(3, Math.round(w / 27));
    const br = h * 0.36;

    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        lobes.push({ x: -w / 2 + br + t * (w - br * 2), y: h * 0.1, r: br * (0.95 + r() * 0.1) });
    }

    const m = n - 1;
    for (let i = 0; i < m; i++) {
        const t = (i + 0.5) / m;
        const mid = 1 - Math.abs(t - 0.5) * 1.4;
        lobes.push({
            x: -w / 2 + br * 1.1 + t * (w - br * 2.2) + (r() - 0.5) * 6,
            y: -h * 0.1 - mid * h * 0.08,
            r: h * (0.3 + mid * 0.16) * (0.88 + r() * 0.24)
        });
    }
    return lobes;
}

function cloudSprite(type, w, h, shape) {
    return sprite(`cloud|${type}|${w}|${shape}`, w + 16, h * 1.3 + 16, w / 2 + 8, h * 0.72 + 8, g => {
        const st = CLOUD_STYLE[type];
        const L = cloudLobes(w, h, shape);
        const r = rng(w + shape * 13 + type.length * 101);

        g.fillStyle = INK;
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y, l.r + 3, 0, TAU); g.fill(); }
        g.fillStyle = st.shade;
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y, l.r, 0, TAU); g.fill(); }
        g.fillStyle = st.fill;
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y - 3, l.r - 1.5, 0, TAU); g.fill(); }

        g.fillStyle = "rgba(255,255,255,0.65)";
        g.beginPath();
        g.ellipse(-w * 0.2, -h * 0.3, w * 0.07, h * 0.09, -0.6, 0, TAU);
        g.fill();

        g.strokeStyle = INK;
        if (type === "fragile") {
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(w * 0.36, -h * 0.3);
            g.lineTo(w * 0.3, -h * 0.08);
            g.lineTo(w * 0.38, h * 0.08);
            g.lineTo(w * 0.32, h * 0.3);
            g.moveTo(-w * 0.34, -h * 0.18);
            g.lineTo(-w * 0.4, h * 0.04);
            g.lineTo(-w * 0.33, h * 0.24);
            g.stroke();
        } else if (type === "chemical") {
            g.lineWidth = 1.6;
            for (let i = 0; i < 4; i++) {
                const bx = (r() - 0.5) * w * 0.7;
                const by = (r() - 0.5) * h * 0.5;
                g.fillStyle = "#e4f7a0";
                g.beginPath(); g.arc(bx, by, 2.5 + r() * 2.5, 0, TAU); g.fill(); g.stroke();
            }
            g.fillStyle = st.shade;
            g.lineWidth = 2;
            g.save();
            g.translate(w * 0.18, h * 0.55);
            teardropPath(g, 0.22);
            g.fill(); g.stroke();
            g.restore();
        } else if (type === "soot" || type === "dust") {
            g.fillStyle = type === "soot" ? "#2b2d33" : "#8f6a45";
            for (let i = 0; i < 9; i++) {
                g.beginPath();
                g.arc((r() - 0.5) * w * 0.75, (r() - 0.4) * h * 0.5, 1 + r() * 1.4, 0, TAU);
                g.fill();
            }
        } else if (type === "smog") {
            g.lineWidth = 1.8;
            g.strokeStyle = "rgba(36,38,46,0.45)";
            for (let i = 0; i < 2; i++) {
                g.beginPath();
                g.arc((i ? 0.22 : -0.22) * w, -h * 0.05, 5, 0.2, Math.PI * 1.6);
                g.stroke();
            }
        }
    });
}

function monsterSprite() {
    return sprite("monster", 72, 72, 36, 36, g => {
        const n = 10;
        const R = 20;
        const layer = (color, pad, dy) => {
            g.fillStyle = color;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU;
                g.beginPath();
                g.arc(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72 + dy, R * 0.42 + pad, 0, TAU);
                g.fill();
            }
            g.beginPath();
            g.arc(0, dy, R * 0.82 + pad, 0, TAU);
            g.fill();
        };
        layer(INK, 3, 0);
        layer("#4f4859", 0, 0);
        layer("#6e6680", -1.8, -2.5);
    });
}

function puffSprite() {
    return sprite("puff", 64, 52, 32, 26, g => {
        const L = [{ x: -10, y: 4, r: 11 }, { x: 10, y: 4, r: 11 }, { x: 0, y: -5, r: 13 }];
        g.fillStyle = INK;
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y, l.r + 2.5, 0, TAU); g.fill(); }
        g.fillStyle = "#8f8c85";
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y, l.r, 0, TAU); g.fill(); }
        g.fillStyle = "#b8b5ad";
        for (const l of L) { g.beginPath(); g.arc(l.x, l.y - 2.5, l.r - 1.5, 0, TAU); g.fill(); }
    });
}

function bottleSprite() {
    return sprite("bottle", 40, 64, 20, 32, g => {
        g.strokeStyle = INK;
        g.lineWidth = 2.5;
        g.fillStyle = "rgba(175,225,245,0.95)";
        g.beginPath();
        g.moveTo(-5, -15);
        g.lineTo(-4, -20);
        g.lineTo(4, -20);
        g.lineTo(5, -15);
        g.closePath();
        g.fill(); g.stroke();
        roundRect(g, -9, -15, 18, 33, 6);
        g.fill(); g.stroke();
        g.fillStyle = "#3d7bd9";
        roundRect(g, -5.5, -26, 11, 7, 2);
        g.fill(); g.stroke();
        g.fillStyle = "#ffffff";
        g.lineWidth = 1.6;
        g.fillRect(-9, -3, 18, 9);
        g.strokeRect(-9, -3, 18, 9);
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-5, -11);
        g.lineTo(-5, -6);
        g.moveTo(-5, 9);
        g.lineTo(-5, 14);
        g.stroke();
    });
}

function pickupSprite(kind) {
    return sprite("pk|" + kind, 44, 48, 22, 24, g => {
        g.strokeStyle = INK;
        if (kind === "drop") {
            g.lineWidth = 2.4;
            teardropPath(g, 0.5);
            g.fillStyle = "#5cc8f5";
            g.fill();
            g.stroke();
            g.fillStyle = "rgba(255,255,255,0.85)";
            g.beginPath();
            g.ellipse(-3, 1, 2, 4, 0.3, 0, TAU);
            g.fill();
        } else if (kind === "shield") {
            g.lineWidth = 2.5;
            g.fillStyle = "rgba(160,230,255,0.75)";
            g.beginPath(); g.arc(0, 0, 16, 0, TAU); g.fill(); g.stroke();
            g.fillStyle = "#ffffff";
            g.beginPath();
            g.moveTo(0, -10);
            g.lineTo(9, -6);
            g.quadraticCurveTo(9, 6, 0, 11);
            g.quadraticCurveTo(-9, 6, -9, -6);
            g.closePath();
            g.fill(); g.stroke();
            g.save();
            g.translate(0, 1.5);
            teardropPath(g, 0.22);
            g.fillStyle = "#4cc3f5";
            g.lineWidth = 1.5;
            g.fill(); g.stroke();
            g.restore();
            g.fillStyle = "rgba(255,255,255,0.9)";
            g.beginPath(); g.ellipse(-8, -8, 3, 5, 0.7, 0, TAU); g.fill();
        } else {
            g.lineCap = "butt";
            const u = () => {
                g.beginPath();
                g.moveTo(-8, -10);
                g.lineTo(-8, 1);
                g.arc(0, 1, 8, Math.PI, 0, true);
                g.lineTo(8, -10);
            };
            g.lineWidth = 12; g.strokeStyle = INK; u(); g.stroke();
            g.lineWidth = 7; g.strokeStyle = "#e8574b"; u(); g.stroke();
            g.strokeStyle = "#e6e9ee";
            g.beginPath();
            g.moveTo(-8, -10); g.lineTo(-8, -5);
            g.moveTo(8, -10); g.lineTo(8, -5);
            g.stroke();
            g.lineWidth = 1.5;
            g.strokeStyle = INK;
            g.beginPath();
            g.moveTo(-14, -10); g.lineTo(-2, -10);
            g.moveTo(2, -10); g.lineTo(14, -10);
            g.stroke();
        }
    });
}


// ==================================================
// DRAWING: THE DROP
// ==================================================

function drawDropBody(g, o) {
    const t = 1 - clamp(o.purity, 0, 100) / 100;
    let light = mixHex("#9be7ff", "#cdbd8f", t);
    let dark = mixHex("#2aa7e8", "#7d6d48", t);

    const grad = g.createLinearGradient(-12, -26, 10, 24);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);

    g.lineJoin = "round";
    g.lineCap = "round";

    teardropPath(g, 1);
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.stroke();

    // Shine
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath(); g.ellipse(-9, -3, 3.4, 7, 0.35, 0, TAU); g.fill();
    g.beginPath(); g.arc(-5, -13, 1.8, 0, TAU); g.fill();

    // Cheeks
    if (o.mood !== "sick") {
        g.fillStyle = "rgba(255,120,150,0.45)";
        g.beginPath(); g.arc(-11, 11, 2.8, 0, TAU); g.fill();
        g.beginPath(); g.arc(11, 11, 2.8, 0, TAU); g.fill();
    } else {
        g.fillStyle = "rgba(140,170,60,0.5)";
        g.beginPath(); g.arc(-11, 11, 3.2, 0, TAU); g.fill();
        g.beginPath(); g.arc(11, 11, 3.2, 0, TAU); g.fill();
    }

    const lx = o.look * 2.4;
    const ex = 6.6;
    const ey = 3;

    g.strokeStyle = INK;
    g.fillStyle = INK;

    if (o.mood === "ouch") {
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(-ex - 3, ey - 3); g.lineTo(-ex + 2, ey); g.lineTo(-ex - 3, ey + 3);
        g.moveTo(ex + 3, ey - 3); g.lineTo(ex - 2, ey); g.lineTo(ex + 3, ey + 3);
        g.stroke();
    } else if (o.blink > 0 || o.mood === "win") {
        g.lineWidth = 2.4;
        g.beginPath();
        g.arc(-ex + lx * 0.4, ey + 1, 3.6, Math.PI * 1.15, Math.PI * 1.85);
        g.moveTo(ex + 3.6 + lx * 0.4, ey + 1);
        g.arc(ex + lx * 0.4, ey + 1, 3.6, Math.PI * 1.85, Math.PI * 1.15, true);
        g.stroke();
    } else {
        g.lineWidth = 2;
        g.fillStyle = "#ffffff";
        for (const s of [-1, 1]) {
            g.beginPath();
            g.ellipse(s * ex + lx * 0.4, ey, 4.6, o.mood === "sick" ? 3.6 : 5.6, 0, 0, TAU);
            g.fill();
            g.stroke();
        }
        g.fillStyle = INK;
        for (const s of [-1, 1]) {
            g.beginPath();
            g.arc(s * ex + lx, ey + 1.2, 2.4, 0, TAU);
            g.fill();
        }
        if (o.mood === "sick") {
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(-ex - 5 + lx * 0.4, ey - 2.5); g.lineTo(-ex + 5 + lx * 0.4, ey - 2.5);
            g.moveTo(ex - 5 + lx * 0.4, ey - 2.5); g.lineTo(ex + 5 + lx * 0.4, ey - 2.5);
            g.stroke();
        }
    }

    // Mouth
    const mx = lx * 0.35;
    g.lineWidth = 2.3;
    if (o.mood === "win") {
        g.fillStyle = "#b8324a";
        g.beginPath();
        g.moveTo(mx - 6, 10);
        g.quadraticCurveTo(mx, 21, mx + 6, 10);
        g.closePath();
        g.fill(); g.stroke();
    } else if (o.mood === "ouch") {
        g.fillStyle = "#b8324a";
        g.beginPath(); g.ellipse(mx, 13, 3, 3.6, 0, 0, TAU); g.fill(); g.stroke();
    } else if (o.mood === "sick") {
        g.beginPath();
        g.moveTo(mx - 6, 14);
        g.quadraticCurveTo(mx - 3, 11, mx, 14);
        g.quadraticCurveTo(mx + 3, 17, mx + 6, 14);
        g.stroke();
    } else {
        g.beginPath();
        g.arc(mx, 10, 4.6, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
    }

}

function drawPlayer() {
    const p = player;
    if (p.hidden) return;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Power-up auras
    if (p.magnet > 0) {
        const fade = p.magnet < 2 && Math.floor(p.magnet * 8) % 2 === 0 ? 0.3 : 1;
        ctx.globalAlpha = 0.35 * fade;
        ctx.strokeStyle = "#e8574b";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 7]);
        ctx.lineDashOffset = -time * 30;
        ctx.beginPath(); ctx.arc(0, 2, 46 + Math.sin(time * 6) * 3, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
    }

    if (state === "play" && p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0) ctx.globalAlpha = 0.45;

    const stretch = clamp(p.vy / 2600, -0.08, 0.14);
    const sx = 1 + p.sq * 0.5 - stretch * 0.6;
    const sy = 1 - p.sq * 0.5 + stretch;
    const sink = p.sink || 0;

    ctx.translate(0, 4);
    ctx.rotate(p.rot + (p.spin > 0 ? (TAU - p.spin) * p.spinDir : 0));
    ctx.translate(0, 16);
    if (state === "ending" || state === "over") {
        if (endKind === "polluted") ctx.scale(1 + sink * 0.25, 1 - sink * 0.45);
        else ctx.scale(sink, sink);
    }
    ctx.scale(sx, sy);
    ctx.translate(0, -16);

    drawDropBody(ctx, {
        purity: run.purity,
        mood: p.mood,
        look: p.look,
        blink: p.blink,
        time
    });

    ctx.restore();

    if (p.shield > 0) {
        const fade = p.shield < 2 && Math.floor(p.shield * 8) % 2 === 0 ? 0.35 : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.fillStyle = "rgba(150,225,255,0.28)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 2, 30 + Math.sin(time * 8) * 1.5, 33 - Math.sin(time * 8) * 1.5, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath(); ctx.ellipse(p.x - 15, p.y - 14, 4, 8, 0.7, 0, TAU); ctx.fill();
        ctx.restore();
    }
}


// ==================================================
// DRAWING: WORLD OBJECTS
// ==================================================

function drawCloud(c) {
    const s = cloudSprite(c.type, c.w, c.h, c.shape);
    const base = c.h * 0.45;

    ctx.save();
    ctx.globalAlpha = clamp(c.alpha, 0, 1);
    ctx.translate(c.x, c.y + base);
    ctx.scale(1 + c.sq * 0.08, 1 - c.sq * 0.12);
    ctx.translate(0, -base);

    if (c.vx) {
        ctx.strokeStyle = "rgba(36,38,46,0.35)";
        ctx.lineWidth = 2.2;
        const back = -sign(c.vx) * (c.w / 2 + 6);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
            const yy = -c.h * 0.25 + i * c.h * 0.22;
            ctx.moveTo(back, yy);
            ctx.lineTo(back - sign(c.vx) * (10 + (i % 2) * 6), yy);
        }
        ctx.stroke();
    }

    blit(ctx, s, 0, 0);

    if (c.type === "bouncy") drawSpring(c);
    drawCloudFace(c);

    ctx.restore();
}

function drawSpring(c) {
    const top = -c.h * 0.5;
    const ext = 10 + c.spring * 12;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-6, top + 2);
    for (let i = 1; i <= 4; i++) ctx.lineTo(i % 2 ? 6 : -6, top + 2 - (ext * i) / 4);
    ctx.stroke();
    ctx.fillStyle = "#c9ced6";
    roundRect(ctx, -9, top - ext - 3, 18, 5, 2);
    ctx.fill();
    ctx.stroke();
}

function drawCloudFace(c) {
    const ex = Math.min(13, c.w * 0.12);
    const y = -c.h * 0.08;

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 2.2;

    if (BAD[c.type]) {
        const wob = Math.sin(time * 5 + c.phase) * 1.2;
        ctx.beginPath();
        ctx.moveTo(-ex - 5, y - 6 + wob); ctx.lineTo(-ex + 4, y - 3);
        ctx.moveTo(ex + 5, y - 6 + wob); ctx.lineTo(ex - 4, y - 3);
        ctx.stroke();
        ctx.fillStyle = c.type === "soot" ? "#ffd84a" : INK;
        ctx.beginPath(); ctx.arc(-ex, y + 1, 2.4, 0, TAU); ctx.arc(ex, y + 1, 2.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = c.type === "soot" ? "#ffd84a" : INK;
        ctx.beginPath(); ctx.arc(0, y + 11, 5, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
        return;
    }

    const blink = (time * 0.7 + c.phase) % 4 < 0.12;

    if (c.sq > 0.25) {
        ctx.beginPath(); ctx.arc(-ex, y, 2.6, 0, TAU); ctx.arc(ex, y, 2.6, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, y + 7, 3, 3.5, 0, 0, TAU); ctx.stroke();
    } else {
        if (blink) {
            ctx.beginPath();
            ctx.moveTo(-ex - 2.5, y); ctx.lineTo(-ex + 2.5, y);
            ctx.moveTo(ex - 2.5, y); ctx.lineTo(ex + 2.5, y);
            ctx.stroke();
        } else {
            ctx.beginPath(); ctx.arc(-ex, y, 2.3, 0, TAU); ctx.arc(ex, y, 2.3, 0, TAU); ctx.fill();
        }
        ctx.beginPath();
        if (c.type === "fragile") {
            ctx.moveTo(-5, y + 7);
            ctx.quadraticCurveTo(-2.5, y + 4, 0, y + 7);
            ctx.quadraticCurveTo(2.5, y + 10, 5, y + 7);
        } else {
            ctx.arc(0, y + 3, 4.2, Math.PI * 0.15, Math.PI * 0.85);
        }
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,120,150,0.35)";
    ctx.beginPath(); ctx.arc(-ex - 6, y + 5, 2.8, 0, TAU); ctx.arc(ex + 6, y + 5, 2.8, 0, TAU); ctx.fill();
}

function drawPickup(k) {
    const bob = Math.sin(k.phase) * 4;
    if (k.kind !== "drop") {
        ctx.strokeStyle = k.kind === "shield" ? "rgba(76,195,245,0.6)" : "rgba(232,87,75,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(k.x, k.y + bob, 22 + Math.sin(k.phase * 1.5) * 3, 0, TAU);
        ctx.stroke();
    }
    blit(ctx, pickupSprite(k.kind), k.x, k.y + bob);
    if (k.kind === "drop" && Math.sin(k.phase * 0.7) > 0.92) {
        drawStar(ctx, k.x + 8, k.y + bob - 10, 4, "#ffffff");
    }
}

function drawStar(g, x, y, r, color) {
    g.fillStyle = color;
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2;
        const rr = i % 2 ? r * 0.38 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
}

function drawHazard(z) {
    const dying = !!z.dying;
    const d = dying ? Math.max(0, z.dieT) : 0;

    ctx.save();
    ctx.translate(z.x, z.y);

    if (z.kind === "bird") {
        drawBird(z);
    } else if (z.kind === "monster") {
        if (dying) {
            ctx.globalAlpha = d / 0.5;
            ctx.scale(1 + (0.5 - d) * 1.4, Math.max(0.1, d / 0.5));
        } else {
            const wob = Math.sin(z.phase * 2) * 0.05;
            ctx.scale(1 + wob, 1 - wob);
        }
        blit(ctx, monsterSprite(), 0, 0);
        drawMonsterFace(z, dying);
    } else if (z.kind === "puff") {
        if (dying) {
            ctx.globalAlpha = d / 0.35;
            ctx.scale(1 + (0.35 - d) * 2, 1 + (0.35 - d) * 2);
        }
        const s = z.r / 18;
        ctx.scale(s, s);
        blit(ctx, puffSprite(), 0, 0);
        ctx.strokeStyle = INK;
        ctx.fillStyle = INK;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(-5, -2, 1.8, 0, TAU); ctx.arc(5, -2, 1.8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(4, 5); ctx.stroke();
    } else if (z.kind === "bottle") {
        if (dying) {
            ctx.globalAlpha = d / 0.45;
            ctx.scale(d / 0.45, d / 0.45);
            ctx.rotate((0.45 - d) * 10);
        }
        ctx.rotate(z.rot);
        blit(ctx, bottleSprite(), 0, 0);
    }

    ctx.restore();
}

function drawMonsterFace(z, dying) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    if (dying) {
        ctx.beginPath();
        for (const s of [-1, 1]) {
            ctx.moveTo(s * 7 - 3, -6); ctx.lineTo(s * 7 + 3, 0);
            ctx.moveTo(s * 7 + 3, -6); ctx.lineTo(s * 7 - 3, 0);
        }
        ctx.stroke();
        return;
    }
    const look = clamp((player.x - z.x) / 80, -1, 1) * 1.6;
    ctx.fillStyle = "#ffd84a";
    for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(s * 7, -3, 5, 5.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(-7 + look, -2, 2.2, 0, TAU); ctx.arc(7 + look, -2, 2.2, 0, TAU); ctx.fill();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-13, -11); ctx.lineTo(-3, -7);
    ctx.moveTo(13, -11); ctx.lineTo(3, -7);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-8, 6);
    for (let i = 0; i <= 4; i++) ctx.lineTo(-8 + i * 4, i % 2 ? 10 : 6);
    ctx.quadraticCurveTo(0, 15, -8, 6);
    ctx.fill();
    ctx.stroke();
}

function drawBird(z) {
    const dir = sign(z.vx);
    const flap = Math.sin(z.phase);
    ctx.scale(dir, 1);
    if (z.hitT > 0) ctx.scale(1.15, 0.85);

    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;

    ctx.fillStyle = "#ff8a63";
    ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-22, -7); ctx.lineTo(-20, 3); ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#ff9a76";
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 11, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffd9c9";
    ctx.beginPath(); ctx.ellipse(3, 4, 8, 5, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = "#ffc93c";
    ctx.beginPath(); ctx.moveTo(13, -3); ctx.lineTo(21, 0); ctx.lineTo(13, 3); ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(7, -4, 3.8, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(8, -4, 1.8, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(-3, -3);
    ctx.rotate(-flap * 0.9);
    ctx.fillStyle = "#ff7f5a";
    ctx.beginPath(); ctx.ellipse(-2, -6, 6, 10, -0.4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
}

function drawGround() {
    const top = GROUND_Y;
    if (top - camY > H + 40) return;

    // Hills behind the targets
    ctx.fillStyle = "#a8dc8c";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-10, top);
    ctx.quadraticCurveTo(W * 0.2, top - 90, W * 0.45, top - 20);
    ctx.quadraticCurveTo(W * 0.7, top - 110, W + 10, top - 30);
    ctx.lineTo(W + 10, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Grass and soil
    ctx.fillStyle = "#c79a68";
    ctx.fillRect(-10, top + 18, W + 20, 400);
    ctx.fillStyle = "#6cc66e";
    ctx.beginPath();
    ctx.moveTo(-10, top + 22);
    for (let x = -10; x <= W + 10; x += 14) ctx.lineTo(x, top + 22 + ((x / 14) % 2 ? 4 : 0));
    ctx.lineTo(W + 10, top);
    ctx.lineTo(-10, top);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, top);
    ctx.lineTo(W + 10, top);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 8; x < W; x += 37) {
        ctx.moveTo(x, top); ctx.lineTo(x - 3, top - 8);
        ctx.moveTo(x + 4, top); ctx.lineTo(x + 6, top - 9);
    }
    ctx.stroke();

    for (const t of targets) drawTarget(t);
}

function drawTarget(t) {
    const top = GROUND_Y;
    const hw = t.w / 2;

    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;

    if (t.kind === "well") {
        ctx.fillStyle = "#b9b5ad";
        ctx.fillRect(t.x - hw, top - 18, t.w, 40);
        ctx.strokeRect(t.x - hw, top - 18, t.w, 40);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let row = 0; row < 3; row++) {
            const yy = top - 18 + row * 13;
            ctx.moveTo(t.x - hw, yy); ctx.lineTo(t.x + hw, yy);
            for (let x = t.x - hw + (row % 2 ? 10 : 20); x < t.x + hw; x += 20) {
                ctx.moveTo(x, yy); ctx.lineTo(x, yy + 13);
            }
        }
        ctx.stroke();
        ctx.lineWidth = 2.5;
        ctx.fillStyle = "#4cc3f5";
        ctx.beginPath(); ctx.ellipse(t.x, top - 18, hw - 6, 8, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(t.x - 8, top - 19, 10 + Math.sin(time * 3) * 3, 2.5, 0, 0, TAU);
        ctx.stroke();

        // Yellow jerrycan beside the well
        const jx = t.x + hw - 8;
        const jy = top - 34;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.2;
        ctx.fillStyle = "#ffc93c";
        roundRect(ctx, jx - 8, jy - 6, 16, 18, 3);
        ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(jx - 4, jy - 6); ctx.lineTo(jx - 2, jy - 11); ctx.lineTo(jx + 4, jy - 11); ctx.lineTo(jx + 5, jy - 6); ctx.stroke();

        if (Math.sin(time * 4) > 0.3) drawStar(ctx, t.x - hw + 6, top - 40 + Math.sin(time * 2) * 4, 6, "#ffc93c");
        if (Math.sin(time * 4 + 2) > 0.3) drawStar(ctx, t.x + hw - 2, top - 58, 5, "#ffffff");
    } else if (t.kind === "pond") {
        ctx.fillStyle = "#8c7246";
        ctx.beginPath(); ctx.ellipse(t.x, top + 4, hw, 14, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#a88a58";
        for (let i = 0; i < 3; i++) {
            const bx = t.x - 20 + i * 20;
            const r = 3 + ((time * 1.5 + i) % 1) * 3;
            ctx.beginPath(); ctx.arc(bx, top + 2, r, 0, TAU); ctx.fill(); ctx.stroke();
        }
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(t.x - hw + 4, top); ctx.lineTo(t.x - hw + 1, top - 22);
        ctx.moveTo(t.x - hw + 10, top); ctx.lineTo(t.x - hw + 12, top - 18);
        ctx.stroke();
    } else {
        ctx.fillStyle = "#86a83a";
        ctx.beginPath(); ctx.ellipse(t.x, top + 4, hw, 14, 0, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#8a8f98";
        roundRect(ctx, t.x + hw - 26, top - 30, 30, 14, 3);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#b8de58";
        const drip = (time * 1.4) % 1;
        ctx.save();
        ctx.translate(t.x + hw - 20, top - 14 + drip * 16);
        teardropPath(ctx, 0.2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#d4f07a";
        ctx.beginPath(); ctx.arc(t.x - 10, top + 2, 3.5, 0, TAU); ctx.arc(t.x + 8, top + 6, 2.5, 0, TAU); ctx.fill();
    }

    // Sign post
    const sx = t.x - hw + 14;
    const sy = top - 62;
    const good = t.kind === "well";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.fillStyle = "#c79a68";
    ctx.fillRect(sx - 2, sy + 10, 4, 34);
    ctx.strokeRect(sx - 2, sy + 10, 4, 34);
    ctx.font = '600 14px "Fredoka", "Nunito", "Trebuchet MS", sans-serif';
    const label = TARGET_INFO[t.kind].label;
    const tw = ctx.measureText(label).width + 14;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(good ? -0.05 : 0.06);
    ctx.fillStyle = good ? "#ffffff" : "#f4e1c8";
    roundRect(ctx, -tw / 2, -10, tw, 22, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = good ? "#1f7fc4" : "#8a5a2a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 1);
    ctx.restore();

    ctx.restore();
}


// ==================================================
// DRAWING: BACKDROP
// ==================================================

function bgCloudSprite() {
    return sprite("bgcloud", 220, 90, 110, 55, g => {
        g.fillStyle = "#ffffff";
        for (const [x, y, r] of [[-62, 12, 26], [-28, -4, 36], [14, -14, 42], [56, 4, 32], [80, 18, 22], [0, 18, 30]]) {
            g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        }
        g.fillRect(-88, 18, 190, 16);
    });
}

function drawSky(b) {
    const zi = ZONES[b.i];
    const zj = ZONES[b.j];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, b.t > 0 ? mixHex(zi.top, zj.top, b.t) : zi.top);
    grad.addColorStop(1, b.t > 0 ? mixHex(zi.bottom, zj.bottom, b.t) : zi.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Soft far-away clouds on three parallax layers
    const s = bgCloudSprite();
    const city = zoneWeight(b, 2);
    const n = Math.ceil(W / 230) + 3;
    for (let i = 0; i < n; i++) {
        const layer = i % 3;
        const sc = 0.55 + layer * 0.3;
        const spanX = W + 260;
        const spanY = H + 220;
        const x = ((i * 271.3 + time * (6 + layer * 5)) % spanX + spanX) % spanX - 130;
        const y = ((i * 193.7 - camY * (0.1 + layer * 0.07)) % spanY + spanY) % spanY - 110;
        ctx.globalAlpha = (0.22 + layer * 0.14) * (1 - city * 0.5);
        ctx.drawImage(s.c, x - s.ox * sc, y - s.oy * sc, s.bw * sc, s.bh * sc);
    }
    ctx.globalAlpha = 1;
}

function drawBackdrop(b) {
    const sky = zoneWeight(b, 0) + zoneWeight(b, 1);
    const city = zoneWeight(b, 2);
    const farm = zoneWeight(b, 3) + zoneWeight(b, 4);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Sun
    ctx.globalAlpha = 0.85 - city * 0.45;
    const sx = W - 64;
    const sy = 120;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + time * 0.25;
        ctx.moveTo(sx + Math.cos(a) * 30, sy + Math.sin(a) * 30);
        ctx.lineTo(sx + Math.cos(a) * 40, sy + Math.sin(a) * 40);
    }
    ctx.stroke();
    ctx.fillStyle = city > 0.5 ? "#e8c77a" : "#ffd75e";
    ctx.beginPath(); ctx.arc(sx, sy, 23, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(sx - 7, sy - 3, 2.2, 0, TAU); ctx.arc(sx + 7, sy - 3, 2.2, 0, TAU); ctx.fill();
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (city > 0.5) { ctx.moveTo(sx - 6, sy + 9); ctx.lineTo(sx + 6, sy + 9); }
    else ctx.arc(sx, sy + 4, 6, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Distant birds
    if (sky > 0.01) {
        ctx.globalAlpha = sky * 0.5;
        ctx.strokeStyle = "rgba(36,38,46,0.45)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3 + Math.floor(W / 500); i++) {
            const bx = (i * 170 + time * 22) % (W + 60) - 30;
            const by = 190 + i * 38 + Math.sin(time * 2 + i) * 5;
            const f = Math.sin(time * 8 + i) * 3;
            ctx.moveTo(bx - 7, by - f); ctx.quadraticCurveTo(bx - 3, by - 4, bx, by);
            ctx.quadraticCurveTo(bx + 3, by - 4, bx + 7, by - f);
        }
        ctx.stroke();
    }

    // Smoggy city skyline
    if (city > 0.01) {
        ctx.globalAlpha = city * 0.55;
        ctx.fillStyle = "#cfc6b5";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        for (const bld of skyline) {
            const top = H - bld.h;
            ctx.fillRect(bld.x, top, bld.w, bld.h);
            ctx.strokeRect(bld.x, top, bld.w, bld.h + 4);
            if (bld.windows) {
                ctx.fillStyle = "#f3e9c6";
                for (let wy = top + 10; wy < H - 14; wy += 18) {
                    for (let wx = bld.x + 6; wx < bld.x + bld.w - 10; wx += 13) ctx.fillRect(wx, wy, 6, 8);
                }
                ctx.fillStyle = "#cfc6b5";
            }
            if (bld.chimney) {
                const cx = bld.x + bld.w * 0.6;
                ctx.fillRect(cx, top - 30, 10, 30);
                ctx.strokeRect(cx, top - 30, 10, 30);
                for (let i = 0; i < 3; i++) {
                    const k = (time * 0.4 + i / 3) % 1;
                    ctx.beginPath();
                    ctx.arc(cx + 5 + k * 18, top - 36 - k * 70, 6 + k * 10, 0, TAU);
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = city * 0.12;
        ctx.fillStyle = "#8a7a50";
        ctx.fillRect(0, 0, W, H);
    }

    // Farmland hills, barn and windmill
    if (farm > 0.01) {
        ctx.globalAlpha = farm * 0.5;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.fillStyle = "#cfe8b0";
        ctx.beginPath();
        ctx.moveTo(-10, H);
        ctx.quadraticCurveTo(W * 0.25, H - 150, W * 0.55, H - 70);
        ctx.quadraticCurveTo(W * 0.8, H - 140, W + 10, H - 60);
        ctx.lineTo(W + 10, H);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const bx = W * 0.2;
        const by = H - 112;
        ctx.fillStyle = "#e8a08a";
        ctx.fillRect(bx, by, 40, 28);
        ctx.strokeRect(bx, by, 40, 28);
        ctx.beginPath(); ctx.moveTo(bx - 4, by); ctx.lineTo(bx + 20, by - 18); ctx.lineTo(bx + 44, by); ctx.closePath(); ctx.fill(); ctx.stroke();

        const mx = W * 0.78;
        const my = H - 150;
        ctx.beginPath(); ctx.moveTo(mx - 6, my + 50); ctx.lineTo(mx, my); ctx.lineTo(mx + 6, my + 50); ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const a = time * 1.2 + (i * TAU) / 4;
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(a) * 26, my + Math.sin(a) * 26);
        }
        ctx.stroke();
    }

    ctx.restore();

    // Wind streaks
    if (windLines.length) {
        ctx.strokeStyle = "rgba(36,38,46,0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const l of windLines) {
            ctx.moveTo(l.x, l.y);
            ctx.quadraticCurveTo(l.x + l.len * 0.5, l.y - 4, l.x + l.len, l.y);
        }
        ctx.stroke();
    }
}


// ==================================================
// DRAWING: PARTICLES, TEXT, OVERLAYS
// ==================================================

function drawParticles() {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;

    for (const q of particles) {
        const a = q.life / q.max;
        ctx.globalAlpha = Math.min(1, a * 1.6);

        if (q.type === "puff") {
            const r = q.size * (1 + (1 - a) * 0.8);
            ctx.fillStyle = q.color;
            ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.fill(); ctx.stroke();
        } else if (q.type === "star") {
            drawStar(ctx, q.x, q.y, q.size, q.color);
        } else if (q.type === "ring") {
            ctx.strokeStyle = q.color;
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(q.x, q.y, q.size + (1 - a) * 30, 0, TAU); ctx.stroke();
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
        } else if (q.type === "confetti" || q.type === "feather") {
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(q.rot);
            ctx.fillStyle = q.color;
            if (q.type === "feather") {
                ctx.beginPath(); ctx.ellipse(0, 0, q.size, q.size * 0.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
            } else {
                ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
            }
            ctx.restore();
        } else {
            ctx.fillStyle = q.color;
            ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.fill();
            if (q.size > 3.5) ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

function drawTexts() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    for (const t of texts) {
        const a = t.life / t.max;
        const pop = a > 0.8 ? 1 + (a - 0.8) * 2.5 : 1;
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.font = `700 ${Math.round(t.size * pop * 0.9)}px "Fredoka", "Nunito", "Trebuchet MS", sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
}

function drawOverlays() {
    const p = player;

    // Murky edges when purity is low
    if ((state === "play" || state === "ending") && run.purity < 35) {
        const k = (1 - run.purity / 35) * (0.55 + Math.sin(time * 6) * 0.15);
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, "rgba(110,90,50,0)");
        g.addColorStop(1, `rgba(110,90,50,${0.5 * k})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    if (state !== "play") return;

    // Arrow when the drop is above the screen
    if (p.y < camY - 10) {
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p.x, 70);
        ctx.lineTo(p.x - 10, 86);
        ctx.lineTo(p.x + 10, 86);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Pointer to the clean well during the final approach
    const groundScreen = GROUND_Y - camY;
    if (altAt(p.y) < 900 && groundScreen > H - 30) {
        const well = targets.find(t => t.kind === "well");
        if (!well) return;
        const bob = Math.sin(time * 6) * 4;
        const y = H - 38 + bob;
        ctx.save();
        ctx.translate(well.x, y);
        ctx.fillStyle = "#ffc93c";
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-8, -14); ctx.lineTo(8, -14); ctx.lineTo(8, 0); ctx.lineTo(16, 0); ctx.lineTo(0, 16); ctx.lineTo(-16, 0); ctx.lineTo(-8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = '600 16px "Fredoka", "Nunito", "Trebuchet MS", sans-serif';
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText("clean well", 0, -26);
        ctx.fillStyle = "#1f7fc4";
        ctx.fillText("clean well", 0, -26);
        ctx.restore();
    }
}


// ==================================================
// RENDER
// ==================================================

function render() {
    const k = scale * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const alt = state === "menu" ? START_ALT : altAt(camY + H * 0.4);
    const b = zoneBlend(alt);

    drawSky(b);
    drawBackdrop(b);

    ctx.save();
    let sx = 0;
    let sy = 0;
    if (shake > 0 && !reduceMotion) {
        sx = (Math.random() - 0.5) * shake;
        sy = (Math.random() - 0.5) * shake;
    }
    ctx.translate(sx, sy - camY);

    const viewTop = camY - 80;
    const viewBottom = camY + H + 80;

    drawGround();
    for (const c of clouds) if (c.y > viewTop && c.y < viewBottom) drawCloud(c);
    for (const k2 of pickups) if (!k2.got && k2.y > viewTop && k2.y < viewBottom) drawPickup(k2);
    for (const z of hazards) if (z.y > viewTop && z.y < viewBottom) drawHazard(z);
    if (state !== "over" || endKind === "well") drawPlayer();
    drawParticles();
    drawTexts();

    ctx.restore();

    drawOverlays();
}


// ==================================================
// HUD + MESSAGES
// ==================================================

const hudCache = new Map();

function setText(id, value) {
    if (hudCache.get(id) !== value) {
        hudCache.set(id, value);
        $(id).textContent = value;
    }
}

function hudTick() {
    if (state !== "play" && state !== "ending") return;

    setText("score", formatNum(run.score));
    setText("alt", formatNum(altAt(player.y)));
    setText("drops", String(run.droplets));

    const pur = Math.round(run.purity);
    if (hudCache.get("pur") !== pur) {
        hudCache.set("pur", pur);
        $("purity-num").textContent = pur + "%";
        $("purity-fill").style.transform = `scaleX(${pur / 100})`;
        const chip = $("purity-chip");
        chip.classList.toggle("mid", pur <= 65 && pur > 35);
        chip.classList.toggle("low", pur <= 35);
    }

    const combo = $("combo");
    if (hudCache.get("mult") !== run.mult) {
        hudCache.set("mult", run.mult);
        combo.hidden = run.mult <= 1;
        combo.textContent = `x${run.mult} combo`;
        if (!combo.hidden) {
            combo.style.animation = "none";
            void combo.offsetWidth;
            combo.style.animation = "";
        }
    }

    powerChip("power-shield", player.shield);
    powerChip("power-magnet", player.magnet);

    if (state === "play") checkMissionsLive();
}

function powerChip(id, t) {
    const on = t > 0 && state === "play";
    const el = $(id);
    if (el.hidden === on) el.hidden = !on;
    if (on) {
        const v = Math.ceil(t) + "s";
        if (hudCache.get(id) !== v) {
            hudCache.set(id, v);
            el.querySelector("b").textContent = v;
        }
    }
}

let bannerTimer = 0;
function showBanner(zone) {
    $("banner-name").textContent = zone.name;
    $("banner-tip").textContent = zone.tip;
    const el = $("banner");
    el.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, 2600);
}

function hideBanner() {
    clearTimeout(bannerTimer);
    $("banner").classList.remove("show");
}

let toastTimer = 0;
function showToast(text) {
    if (state === "over") return;
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}


// ==================================================
// MENU + SOUND TOGGLE
// ==================================================

function updateBestLabel() {
    $("best").textContent = formatNum(save.best);
}

function renderMenu() {
    ensureMissions();
    updateBestLabel();
    $("mission-list").innerHTML = save.missions
        .map(id => missionById(id))
        .filter(Boolean)
        .map(m => `<li><span>${m.text}</span></li>`)
        .join("");
    syncMute();
}

function syncMute() {
    for (const id of ["mute-btn", "mute-btn2"]) {
        const b = $(id);
        b.textContent = save.muted ? "Sound off" : "Sound on";
        b.setAttribute("aria-pressed", String(save.muted));
    }
}

function previewCanvas(cssW, cssH) {
    const c = document.createElement("canvas");
    const r = Math.min(window.devicePixelRatio || 1, 2);
    c.width = cssW * r;
    c.height = cssH * r;
    const g = c.getContext("2d");
    g.scale(r, r);
    return { c, g };
}

function buildLegend() {
    const items = [
        ["clean cloud: bounce", g => { const s = cloudSprite("clean", 78, 33, 0); g.save(); g.translate(26, 22); g.scale(0.55, 0.55); g.drawImage(s.c, -s.ox, -s.oy, s.bw, s.bh); g.restore(); }],
        ["dirty cloud: avoid", g => { const s = cloudSprite("smog", 78, 33, 1); g.save(); g.translate(26, 22); g.scale(0.55, 0.55); g.drawImage(s.c, -s.ox, -s.oy, s.bw, s.bh); g.restore(); }],
        ["monster: stomp it", g => { const s = monsterSprite(); g.save(); g.translate(26, 20); g.scale(0.7, 0.7); g.drawImage(s.c, -s.ox, -s.oy, s.bw, s.bh); g.restore(); }],
        ["droplet: +purity", g => { const s = pickupSprite("drop"); g.save(); g.translate(26, 20); g.scale(0.9, 0.9); g.drawImage(s.c, -s.ox, -s.oy, s.bw, s.bh); g.restore(); }],
        ["shield: no damage", g => { const s = pickupSprite("shield"); g.save(); g.translate(26, 20); g.scale(0.8, 0.8); g.drawImage(s.c, -s.ox, -s.oy, s.bw, s.bh); g.restore(); }]
    ];
    const list = $("legend");
    list.innerHTML = "";
    for (const [label, draw] of items) {
        const li = document.createElement("li");
        const { c, g } = previewCanvas(52, 40);
        draw(g);
        li.appendChild(c);
        li.appendChild(document.createTextNode(label));
        list.appendChild(li);
    }
}

function toggleMute() {
    Sound.unlock();
    save.muted = !save.muted;
    persist();
    syncMute();
    Sound.play("click");
}

$("play-btn").addEventListener("click", startGame);
$("again-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);
$("resume-btn").addEventListener("click", resumeGame);
$("pause-btn").addEventListener("click", pauseGame);
$("quit-btn").addEventListener("click", goToMenu);
$("over-menu").addEventListener("click", goToMenu);
$("mute-btn").addEventListener("click", toggleMute);
$("mute-btn2").addEventListener("click", toggleMute);


// ==================================================
// MAIN LOOP
// ==================================================

let lastFrame = 0;

function frame(ts) {
    requestAnimationFrame(frame);

    let dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    lastFrame = ts;
    dt = Math.min(dt, 0.05);

    if (dt > 0) {
        if (state === "play") {
            const n = Math.ceil(dt / STEP);
            const h = dt / n;
            for (let i = 0; i < n && state === "play"; i++) update(h);
        } else if (state === "menu") {
            updateAttract(dt);
        } else if (state === "ending") {
            updateEnding(dt);
        }
        if (state !== "pause") updateFx(dt);
    }

    render();
    hudTick();
}

window.addEventListener("resize", resize);

resize();
setupAttract();
renderMenu();
buildLegend();
requestAnimationFrame(frame);

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        sprites.clear();
        buildLegend();
    });
}
