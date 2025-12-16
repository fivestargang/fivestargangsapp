import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import confetti from 'canvas-confetti';
import './style.css';
import './countdown.css';

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const timerDisplay = document.getElementById("timer");
const statusText = document.getElementById("status-text");
const eyeIndicator = document.getElementById("eye-level-indicator");
const dreamOverlay = document.querySelector(".dream-overlay");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownText = document.getElementById("countdown-text");

// Screens
const startScreen = document.getElementById("start-screen");
const gameScreen = document.getElementById("game-screen");
const resultScreen = document.getElementById("result-screen");
const resultTitle = document.getElementById("result-title");
const resultMessage = document.getElementById("result-message");
const badgeContainer = document.getElementById("badge-container");

let faceLandmarker;
let runningMode = "VIDEO";
let lastVideoTime = -1;
let results = undefined;
let gameActive = false;
let gameStartTime = 0;
let timeRemaining = 30;
let faultTime = 0; // ms spent outside zone
const FAULT_TOLERANCE = 2000; // 2 seconds leeway

// Constants for Eye Aspect Ratio (EAR)
// Using specific indices for MediaPipe Face Mesh
// Left Eye: [33, 160, 158, 133, 153, 144]
// Right Eye: [362, 385, 387, 263, 373, 380]
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

// Thresholds
const EAR_CLOSED = 0.18;
const EAR_HALF = 0.35; // Upper bound of half-open
// Target Zone: 0.15 < EAR < 0.35
// This might need tuning per user, but fixed thresholds are okay for a prototype.

async function createFaceLandmarker() {
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "GPU"
            },
            outputFaceBlendshapes: true,
            runningMode: runningMode,
            numFaces: 1
        });
        startBtn.textContent = "Start Zone-Out";
        startBtn.disabled = false;
    } catch (error) {
        console.error(error);
        startBtn.textContent = "Error Loading AI: " + error.message;
        // Fallback or retry logic could go here
    }
}

createFaceLandmarker();

// === Helper Functions ===

function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateEAR(landmarks, indices) {
    // indices: [p1, p2, p3, p4, p5, p6]
    // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
    const p1 = landmarks[indices[0]];
    const p2 = landmarks[indices[1]];
    const p3 = landmarks[indices[2]];
    const p4 = landmarks[indices[3]];
    const p5 = landmarks[indices[4]];
    const p6 = landmarks[indices[5]];

    const vertical1 = getDistance(p2, p6);
    const vertical2 = getDistance(p3, p5);
    const horizontal = getDistance(p1, p4);

    return (vertical1 + vertical2) / (2 * horizontal);
}

// === Cinematic Falling Chocolates ===
const rainContainer = document.getElementById('chocolate-rain');

function spawnCluster() {
    if (!rainContainer) return;

    // Decide cluster position (X axis)
    const clusterX = Math.random() * 90 + 5; // 5% to 95%
    const itemCount = 6 + Math.floor(Math.random() * 4); // 6-10 items (Increased density)

    for (let i = 0; i < itemCount; i++) {
        const el = document.createElement('div');

        // Determine layer (1=Front/Fast, 2=Mid/Normal, 3=Back/Slow)
        // Weighted random: mostly mid, some back, few front
        const r = Math.random();
        let layer = 2;
        if (r > 0.8) layer = 1;
        else if (r < 0.2) layer = 3; // Slightly more background items for depth

        el.className = `choco-item choco-layer-${layer}`;

        // Wider spread for larger clusters
        const offsetX = (Math.random() - 0.5) * 25; // +/- 12.5vw spread
        el.style.left = `${clusterX + offsetX}vw`;

        // Rotation vars
        const startRot = (Math.random() - 0.5) * 45 + 'deg';
        const endRot = (Math.random() - 0.5) * 90 + 'deg';
        el.style.setProperty('--rot-start', startRot);
        el.style.setProperty('--rot-end', endRot);

        // Speed based on layer
        const baseSpeed = layer === 1 ? 8 : (layer === 2 ? 12 : 18); // seconds
        const speed = baseSpeed + (Math.random() * 2);
        el.style.animation = `fallSmooth ${speed}s linear forwards`;

        // Stagger start time slightly more
        el.style.animationDelay = `${Math.random() * 3}s`;

        rainContainer.appendChild(el);

        // Cleanup
        setTimeout(() => {
            el.remove();
        }, (speed + 4) * 1000);
    }
}

// Spawn a new cluster every 2 seconds (More frequent)
function startRain() {
    spawnCluster();
    setTimeout(spawnCluster, 1000); // Quick second batch
    // Loop
    setInterval(spawnCluster, 2000);
}

startRain();

// === Game Logic ===

function startGame() {
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);

        // Switch screens
        startScreen.classList.remove("active");
        gameScreen.classList.add("active");

        // Start Countdown Sequence instead of immediate game
        startCountdown();
    });
}

function startCountdown() {
    gameActive = false; // Ensure game is not active yet
    countdownOverlay.classList.remove("hidden");
    let count = 3;
    countdownText.innerText = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownText.innerText = count;
            // Retrigger animation
            countdownText.style.animation = 'none';
            countdownText.offsetHeight; /* trigger reflow */
            countdownText.style.animation = null;
        } else if (count === 0) {
            countdownText.innerText = "Do Nothing!";
        } else {
            clearInterval(interval);
            countdownOverlay.classList.add("hidden");
            initializeGameLogic();
        }
    }, 1000);
}

function initializeGameLogic() {
    // Reset Game State
    gameActive = true;
    gameStartTime = Date.now();
    timeRemaining = 30;
    faultTime = 0;
    timerDisplay.innerText = timeRemaining;

    // Start Timer
    const timerInterval = setInterval(() => {
        if (!gameActive) {
            clearInterval(timerInterval);
            return;
        }
        timeRemaining--;
        timerDisplay.innerText = timeRemaining;

        if (timeRemaining <= 0) {
            endGame(true);
        }
    }, 1000);

    // KICKSTART THE AI LOOP
    predictWebcam();
}

function endGame(won, reason = "") {
    gameActive = false;
    gameScreen.classList.remove("active");
    resultScreen.classList.add("active");

    if (won) {
        card.classList.add("winner");
        resultTitle.innerText = "⭐ YOU DID IT! ⭐";
        // Text colors handled by CSS .winner class now
        resultTitle.style.color = "";

        resultMessage.innerText = "You have mastered the art of doing nothing.";
        badgeContainer.classList.remove("hidden");

        // Celebration!
        const duration = 3000;
        const end = Date.now() + duration;

        (function frame() {
            // launch a few confetti from the left edge
            confetti({
                particleCount: 5,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: ['#ffd700', '#ffffff', '#6b2c91']
            });
            // and launch a few from the right edge
            confetti({
                particleCount: 5,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: ['#ffd700', '#ffffff', '#6b2c91']
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());

    } else {
        card.classList.remove("winner");
        resultTitle.innerText = "Oh no!";
        resultTitle.style.color = "#ff4d4d";
        resultMessage.innerText = reason;
        badgeContainer.classList.add("hidden");
    }
}

async function predictWebcam() {
    if (!gameActive) return;

    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = faceLandmarker.detectForVideo(video, startTimeMs);
    }

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        const leftEAR = calculateEAR(landmarks, LEFT_EYE);
        const rightEAR = calculateEAR(landmarks, RIGHT_EYE);
        const avgEAR = (leftEAR + rightEAR) / 2;

        // Normalize EAR for display (0 to 0.6 approx range)
        // 0 is closed, 0.6 is wide open
        // We want the indicator to be at bottom if closed, top if open.
        // Display height is 0-100%
        const displayPct = Math.min(Math.max((avgEAR / 0.5) * 100, 0), 100);
        eyeIndicator.style.bottom = `${displayPct}%`;

        // Logic
        // Zone: 0.18 - 0.35 (Half open)
        // Too Sleepy: < 0.18
        // Too Alert: > 0.35

        let status = "ok";
        if (avgEAR < EAR_CLOSED) status = "sleepy";
        else if (avgEAR > EAR_HALF) status = "alert";

        // Update UI and Faults
        if (status === "ok") {
            statusText.innerText = "In the Zone...";
            statusText.style.color = "#ffd700"; // Gold
            statusText.style.background = "rgba(255, 215, 0, 0.2)";
            faultTime = Math.max(0, faultTime - 16); // Recover slowly
            dreamOverlay.style.animationDuration = "4s"; // Calm breathing
        } else {
            faultTime += 30; // Accumulate fault (approx 30ms per frame)
            dreamOverlay.style.animationDuration = "0.5s"; // Panic breathing

            if (status === "sleepy") {
                statusText.innerText = "WAKE UP!";
                statusText.style.color = "#ff4d4d";
                statusText.style.background = "rgba(255, 0, 0, 0.2)";
            } else {
                statusText.innerText = "TOO ALERT!";
                statusText.style.color = "#ff4d4d";
                statusText.style.background = "rgba(255, 0, 0, 0.2)";
            }
        }

        if (faultTime > FAULT_TOLERANCE) {
            if (status === "sleepy") endGame(false, "You fell asleep! Eyes closed too long.");
            else endGame(false, "You're too awake! Relax your eyes.");
        }
    }

    window.requestAnimationFrame(predictWebcam);
}

// 3D Tilt Effect
const card = document.getElementById("result-card");
const cardContainer = document.querySelector(".card-container");

if (card && cardContainer) {
    cardContainer.addEventListener("mousemove", (e) => {
        const rect = cardContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Calculate rotation (-15deg to 15deg)
        const xRot = -((y - rect.height / 2) / (rect.height / 2)) * 10;
        const yRot = ((x - rect.width / 2) / (rect.width / 2)) * 10;

        card.style.transform = `rotateX(${xRot}deg) rotateY(${yRot}deg)`;
    });

    cardContainer.addEventListener("mouseleave", () => {
        card.style.transform = "rotateX(0deg) rotateY(0deg)";
    });
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", () => {
    resultScreen.classList.remove("active");
    startScreen.classList.add("active");

    // Reset visual states
    card.classList.remove("winner");
    card.style.transform = "rotateX(0deg) rotateY(0deg)";
});
