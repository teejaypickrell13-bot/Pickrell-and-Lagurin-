(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  // HUD elements
  const scoreEl = document.getElementById("scoreVal");
  const bestEl = document.getElementById("bestVal");
  const streakEl = document.getElementById("streakVal");
  const timeEl = document.getElementById("timeVal");
  const startOverlay = document.getElementById("startOverlay");
  const endOverlay = document.getElementById("endOverlay");
  const finalSummary = document.getElementById("finalSummary");
  const startBtn = document.getElementById("startBtn");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const restartBtn = document.getElementById("restartBtn");
  document.getElementById("year").textContent = new Date().getFullYear();

  // Physics & Court constants
  const W = canvas.width;
  const H = canvas.height;
  const FLOOR_Y = H - 56;
  const GRAVITY = 0.42;
  const BALL_RADIUS = 20;

  // Hoop configuration (right side)
  const hoop = {
    rimY: 205,
    rimLeftX: 725,
    rimRightX: 805,
    rimRadius: 4.5,
    boardX: 822,
    boardTopY: 115,
    boardBottomY: 230,
    boardWidth: 10
  };

  // Game state
  let bestScore = Number(localStorage.getItem("courtside_best") || 0);
  bestEl.textContent = bestScore;

  let state = {
    running: false,
    gameOver: false,
    score: 0,
    streak: 0,
    timeLeft: 60,
    lastTimestamp: 0,
    timerAccum: 0
  };

  // Ball state
  let ball = {
    x: 190,
    y: FLOOR_Y - BALL_RADIUS,
    vx: 0,
    vy: 0,
    angle: 0,
    vAngle: 0,
    inFlight: false,
    scoredThisShot: false,
    touchedRim: false,
    resetTimer: 0
  };

  // Aiming state
  let aim = {
    dragging: false,
    dragX: 0,
    dragY: 0,
    keyAngle: -0.82,
    keyPower: 0.65,
    chargingKey: false,
    keyDir: 1
  };

  // Floating callouts & net sway
  let popups = [];
  let netSway = 0;
  let netSwayVel = 0;

  // Web Audio API subtle sound effects (no external files required)
  let audioCtx = null;
  function playTone(freq, duration, type = "sine", gainVal = 0.08) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {
      // Audio blocked or unsupported
    }
  }

  function addPopup(text, x, y, color = "#ffd166") {
    popups.push({ text, x, y, vy: -1.4, alpha: 1, color });
  }

  function randomizeBallPosition() {
    const minX = 120;
    const maxX = 430;
    ball.x = minX + Math.random() * (maxX - minX);
    ball.y = FLOOR_Y - BALL_RADIUS;
    ball.vx = 0;
    ball.vy = 0;
    ball.vAngle = 0;
    ball.inFlight = false;
    ball.scoredThisShot = false;
    ball.touchedRim = false;
    ball.resetTimer = 0;
  }

  function startGame() {
    state.running = true;
    state.gameOver = false;
    state.score = 0;
    state.streak = 0;
    state.timeLeft = 60;
    state.timerAccum = 0;
    popups = [];
    updateHUD();
    randomizeBallPosition();
    startOverlay.classList.add("hidden");
    endOverlay.classList.add("hidden");
    playTone(520, 0.14, "triangle", 0.09);
  }

  function endGame() {
    state.running = false;
    state.gameOver = true;
    aim.dragging = false;
    aim.chargingKey = false;
    if (state.score > bestScore) {
      bestScore = state.score;
      localStorage.setItem("courtside_best", String(bestScore));
      bestEl.textContent = bestScore;
    }
    finalSummary.textContent = `Final Score: ${state.score} pts • Best: ${bestScore} pts`;
    endOverlay.classList.remove("hidden");
  }

  function updateHUD() {
    scoreEl.textContent = state.score;
    bestEl.textContent = bestScore;
    streakEl.textContent = `${state.streak}x`;
    timeEl.textContent = `${Math.max(0, Math.ceil(state.timeLeft))}s`;
    timeEl.classList.toggle("urgent", state.timeLeft <= 10 && state.running);
  }

  function getLaunchVelocity() {
    if (aim.dragging) {
      const dx = ball.x - aim.dragX;
      const dy = ball.y - aim.dragY;
      const maxPull = 175;
      const dist = Math.min(Math.hypot(dx, dy), maxPull);
      const power = dist / maxPull;
      const angle = Math.atan2(dy, dx);
      const speed = power * 23.5;
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        valid: dist > 14
      };
    }
    const speed = 7 + aim.keyPower * 16.5;
    return {
      vx: Math.cos(aim.keyAngle) * speed,
      vy: Math.sin(aim.keyAngle) * speed,
      valid: true
    };
  }

  function launchBall() {
    if (!state.running || ball.inFlight) return;
    const { vx, vy, valid } = getLaunchVelocity();
    if (!valid) return;
    ball.vx = vx;
    ball.vy = vy;
    ball.vAngle = vx * 0.025;
    ball.inFlight = true;
    ball.scoredThisShot = false;
    ball.touchedRim = false;
    playTone(240, 0.09, "sine", 0.06);
  }

  // Pointer aiming
  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.running || ball.inFlight) return;
    const pt = canvasCoords(e);
    const distToBall = Math.hypot(pt.x - ball.x, pt.y - ball.y);
    if (distToBall <= 95) {
      aim.dragging = true;
      aim.dragX = pt.x;
      aim.dragY = pt.y;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!aim.dragging) return;
    const pt = canvasCoords(e);
    aim.dragX = pt.x;
    aim.dragY = pt.y;
  });

  canvas.addEventListener("pointerup", () => {
    if (!aim.dragging) return;
    launchBall();
    aim.dragging = false;
  });

  // Keyboard aiming
  const keysDown = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    keysDown.add(e.code);
    if (e.code === "Space" && state.running && !ball.inFlight && !e.repeat) {
      aim.chargingKey = true;
    }
  });

  window.addEventListener("keyup", (e) => {
    keysDown.delete(e.code);
    if (e.code === "Space" && aim.chargingKey) {
      aim.chargingKey = false;
      launchBall();
    }
  });

  function collideCircle(cx, cy, cr, restitution = 0.72) {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_RADIUS + cr;
    if (dist < minDist && dist > 0.0001) {
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = cx + nx * minDist;
      ball.y = cy + ny * minDist;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= (1 + restitution) * vn * nx;
        ball.vy -= (1 + restitution) * vn * ny;
        ball.vAngle += (-vn * nx) * 0.015;
        ball.touchedRim = true;
        playTone(170, 0.08, "square", 0.05);
      }
    }
  }

  function updatePhysics(dt) {
    // Keyboard aim adjustments
    if (state.running && !ball.inFlight) {
      if (keysDown.has("ArrowLeft")) {
        aim.keyAngle = Math.max(-1.38, aim.keyAngle - 0.018);
      }
      if (keysDown.has("ArrowRight")) {
        aim.keyAngle = Math.min(-0.22, aim.keyAngle + 0.018);
      }
      if (aim.chargingKey) {
        aim.keyPower += aim.keyDir * 0.018;
        if (aim.keyPower >= 1) {
          aim.keyPower = 1;
          aim.keyDir = -1;
        } else if (aim.keyPower <= 0.15) {
          aim.keyPower = 0.15;
          aim.keyDir = 1;
        }
      }
    }

    // Net spring animation
    const springForce = -0.14 * netSway;
    netSwayVel = (netSwayVel + springForce) * 0.88;
    netSway += netSwayVel;

    if (ball.inFlight) {
      const prevY = ball.y;
      ball.vy += GRAVITY;
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.angle += ball.vAngle;

      // Side walls
      if (ball.x - BALL_RADIUS < 0) {
        ball.x = BALL_RADIUS;
        ball.vx = Math.abs(ball.vx) * 0.72;
      } else if (ball.x + BALL_RADIUS > W) {
        ball.x = W - BALL_RADIUS;
        ball.vx = -Math.abs(ball.vx) * 0.72;
      }

      // Backboard collision
      if (
        ball.x + BALL_RADIUS > hoop.boardX &&
        ball.x - BALL_RADIUS < hoop.boardX + hoop.boardWidth &&
        ball.y + BALL_RADIUS > hoop.boardTopY &&
        ball.y - BALL_RADIUS < hoop.boardBottomY
      ) {
        if (ball.vx > 0) {
          ball.x = hoop.boardX - BALL_RADIUS;
          ball.vx = -ball.vx * 0.78;
          ball.touchedRim = true;
          playTone(210, 0.07, "triangle", 0.06);
        }
      }

      // Front & back rim collisions
      collideCircle(hoop.rimLeftX, hoop.rimY, hoop.rimRadius, 0.72);
      collideCircle(hoop.rimRightX, hoop.rimY, hoop.rimRadius, 0.72);

      // Score check: moving downward through rim plane
      if (
        !ball.scoredThisShot &&
        ball.vy > 0 &&
        prevY <= hoop.rimY + 4 &&
        ball.y >= hoop.rimY - 2 &&
        ball.x > hoop.rimLeftX + 4 &&
        ball.x < hoop.rimRightX - 4
      ) {
        ball.scoredThisShot = true;
        netSwayVel += ball.vx * 0.35 + (ball.vy > 8 ? 4 : 2.2);

        if (state.running) {
          state.streak += 1;
          const isSwish = !ball.touchedRim;
          const pts = isSwish ? 3 : 2;
          state.score += pts;
          if (state.score > bestScore) {
            bestScore = state.score;
            localStorage.setItem("courtside_best", String(bestScore));
          }
          updateHUD();

          if (isSwish) {
            addPopup(`SWISH! +${pts}`, (hoop.rimLeftX + hoop.rimRightX) / 2, hoop.rimY - 24, "#ff9f1c");
            playTone(660, 0.14, "sine", 0.09);
            setTimeout(() => playTone(880, 0.16, "sine", 0.09), 80);
          } else {
            addPopup(`+${pts}`, (hoop.rimLeftX + hoop.rimRightX) / 2, hoop.rimY - 20, "#ffd166");
            playTone(587, 0.14, "triangle", 0.08);
          }
        }
      }

      // Floor bounce
      if (ball.y + BALL_RADIUS >= FLOOR_Y) {
        ball.y = FLOOR_Y - BALL_RADIUS;
        ball.vy = -ball.vy * 0.62;
        ball.vx *= 0.82;
        ball.vAngle = ball.vx * 0.025;

        if (Math.abs(ball.vy) < 1.6) {
          ball.vy = 0;
          ball.vx *= 0.88;
          ball.resetTimer += dt;
        }
      }

      // Reset ball for next shot
      if (ball.resetTimer > 0.65 || (ball.scoredThisShot && ball.y > hoop.rimY + 150 && ball.resetTimer > 0.35)) {
        if (state.running && !ball.scoredThisShot) {
          state.streak = 0;
          updateHUD();
        }
        randomizeBallPosition();
      }
    }

    // Update floating popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.y += p.vy;
      p.alpha -= 0.018;
      if (p.alpha <= 0) popups.splice(i, 1);
    }
  }

  function drawTrajectoryPreview() {
    if (!state.running || ball.inFlight) return;
    const { vx, vy, valid } = getLaunchVelocity();
    if (!valid) return;

    if (aim.dragging) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 209, 102, 0.75)";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(aim.dragX, aim.dragY);
      ctx.stroke();
      ctx.restore();
    }

    let simX = ball.x;
    let simY = ball.y;
    let simVx = vx;
    let simVy = vy;

    ctx.save();
    for (let step = 1; step <= 26; step++) {
      simVy += GRAVITY;
      simX += simVx;
      simY += simVy;
      if (simY + BALL_RADIUS > FLOOR_Y) break;
      if (step % 2 === 0) {
        const alpha = Math.max(0.12, 0.85 - step * 0.028);
        ctx.fillStyle = `rgba(255, 224, 130, ${alpha})`;
        ctx.beginPath();
        ctx.arc(simX, simY, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawCourtAndHoop() {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    skyGrad.addColorStop(0, "#101b36");
    skyGrad.addColorStop(1, "#19294d");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, FLOOR_Y);

    ctx.save();
    const spotGrad = ctx.createRadialGradient(760, 80, 10, 760, 160, 280);
    spotGrad.addColorStop(0, "rgba(255, 210, 130, 0.14)");
    spotGrad.addColorStop(1, "rgba(255, 210, 130, 0)");
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, W, FLOOR_Y);
    ctx.restore();

    const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
    floorGrad.addColorStop(0, "#b86b35");
    floorGrad.addColorStop(1, "#7c421b");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

    ctx.fillStyle = "#e69c5d";
    ctx.fillRect(0, FLOOR_Y, W, 6);
    ctx.strokeStyle = "rgba(255, 248, 235, 0.25)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y + 24);
    ctx.lineTo(W, FLOOR_Y + 24);
    ctx.stroke();

    ctx.fillStyle = "#334155";
    ctx.fillRect(855, hoop.boardTopY + 35, 18, FLOOR_Y - (hoop.boardTopY + 35));
    ctx.fillRect(hoop.boardX + hoop.boardWidth, hoop.boardTopY + 55, 45, 12);

    ctx.fillStyle = "rgba(240, 248, 255, 0.92)";
    ctx.fillRect(hoop.boardX, hoop.boardTopY, hoop.boardWidth, hoop.boardBottomY - hoop.boardTopY);
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(hoop.boardX - 14, hoop.rimY - 38, 14, 42);

    const netTopY = hoop.rimY + 2;
    const netBottomY = hoop.rimY + 56;
    const topW = hoop.rimRightX - hoop.rimLeftX;
    const botW = topW * 0.68;
    const centerX = (hoop.rimLeftX + hoop.rimRightX) / 2 + netSway;

    ctx.save();
    ctx.strokeStyle = "rgba(241, 245, 249, 0.78)";
    ctx.lineWidth = 2;
    const strands = 7;
    for (let i = 0; i <= strands; i++) {
      const t = i / strands;
      const xTop = hoop.rimLeftX + t * topW;
      const xBot = centerX - botW / 2 + t * botW;
      ctx.beginPath();
      ctx.moveTo(xTop, netTopY);
      ctx.quadraticCurveTo((xTop + xBot) / 2 + netSway * 0.5, (netTopY + netBottomY) / 2, xBot, netBottomY);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "#ff4d1a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hoop.rimLeftX, hoop.rimY);
    ctx.lineTo(hoop.rimRightX, hoop.rimY);
    ctx.stroke();

    ctx.fillStyle = "#ff7847";
    ctx.beginPath();
    ctx.arc(hoop.rimLeftX, hoop.rimY, hoop.rimRadius, 0, Math.PI * 2);
    ctx.arc(hoop.rimRightX, hoop.rimY, hoop.rimRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBall() {
    const heightAboveFloor = Math.max(0, FLOOR_Y - (ball.y + BALL_RADIUS));
    const shadowScale = Math.max(0.25, 1 - heightAboveFloor / 360);
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.38 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(ball.x, FLOOR_Y + 6, BALL_RADIUS * 1.15 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.angle);

    const grad = ctx.createRadialGradient(-6, -6, 3, 0, 0, BALL_RADIUS);
    grad.addColorStop(0, "#ff9944");
    grad.addColorStop(0.65, "#ea580c");
    grad.addColorStop(1, "#9a3412");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2b1205";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-BALL_RADIUS, 0);
    ctx.lineTo(BALL_RADIUS, 0);
    ctx.moveTo(0, -BALL_RADIUS);
    ctx.lineTo(0, BALL_RADIUS);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-BALL_RADIUS * 0.55, 0, BALL_RADIUS * 0.72, -0.9, 0.9);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(BALL_RADIUS * 0.55, 0, BALL_RADIUS * 0.72, Math.PI - 0.9, Math.PI + 0.9);
    ctx.stroke();

    ctx.restore();
  }

  function drawPopups() {
    ctx.save();
    ctx.font = "900 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = "#0b1020";
      ctx.fillText(p.text, p.x + 2, p.y + 2);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function loop(timestamp) {
    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const dt = Math.min(0.05, (timestamp - state.lastTimestamp) / 1000);
    state.lastTimestamp = timestamp;

    if (state.running) {
      state.timerAccum += dt;
      if (state.timerAccum >= 0.1) {
        state.timeLeft -= state.timerAccum;
        state.timerAccum = 0;
        updateHUD();
        if (state.timeLeft <= 0) {
          state.timeLeft = 0;
          updateHUD();
          endGame();
        }
      }
    }

    updatePhysics(dt);

    ctx.clearRect(0, 0, W, H);
    drawCourtAndHoop();
    drawTrajectoryPreview();
    drawBall();
    drawPopups();

    requestAnimationFrame(loop);
  }

  startBtn.addEventListener("click", startGame);
  playAgainBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);

  requestAnimationFrame(loop);
})();