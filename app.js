(() => {
  const tg = window.Telegram?.WebApp;
  // initData пустой, если страница открыта не из Telegram
  const inTelegram = Boolean(tg && tg.initData);
  // Адрес Cloudflare Worker из папки worker/
  const API_URL = "https://tg-tasks-gifts.zabatv.workers.dev";

  const $ = (id) => document.getElementById(id);

  const haptic = {
    tap: () => tg?.HapticFeedback?.impactOccurred("light"),
  };

  const formatNumber = (n) => n.toLocaleString("ru-RU");

  function fetchGiftsData() {
    return fetch(`${API_URL}/gifts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    });
  }

  // ---------- Галактика ----------
  const Galaxy = (() => {
    const canvas = $("galaxySky");
    const subEl = $("galaxySub");
    const statsEl = $("galaxyStats");
    const hintEl = $("galaxyHint");
    const statusEl = $("galaxyStatus");
    const ctx = canvas.getContext("2d");

    const R_MAX = 900, ARMS = 3, TWIST = 3.4, CORE_R = 150, OMEGA0 = 0.16, BULGE_FRACTION = 0.18;
    const RENDER_CAP = 6000;

    let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2), focal = 0;
    let stars = [], interactive = [];
    let startTime = 0;
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function gaussian() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    const TEMP_STOPS = [
      { t: 0, c: [255, 130, 100] },
      { t: 0.28, c: [255, 205, 140] },
      { t: 0.52, c: [255, 248, 235] },
      { t: 0.75, c: [210, 226, 255] },
      { t: 1, c: [150, 190, 255] },
    ];
    function tempColor(temp) {
      temp = clamp(temp, 0, 1);
      for (let i = 0; i < TEMP_STOPS.length - 1; i++) {
        const a = TEMP_STOPS[i], b = TEMP_STOPS[i + 1];
        if (temp >= a.t && temp <= b.t) {
          const f = (temp - a.t) / (b.t - a.t);
          const r = clamp(Math.round(a.c[0] + (b.c[0] - a.c[0]) * f) + Math.round(gaussian() * 6), 0, 255);
          const g = clamp(Math.round(a.c[1] + (b.c[1] - a.c[1]) * f) + Math.round(gaussian() * 6), 0, 255);
          const bch = clamp(Math.round(a.c[2] + (b.c[2] - a.c[2]) * f) + Math.round(gaussian() * 6), 0, 255);
          return `${r} ${g} ${bch}`;
        }
      }
      return "255 250 240";
    }
    function hexToRgbStr(hex) {
      if (!hex) return null;
      const n = parseInt(hex.replace("#", ""), 16);
      return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
    }
    function angularVelocity(r) {
      return OMEGA0 * (R_MAX * 0.12) / (r + R_MAX * 0.12);
    }

    function makeDiskStar(real) {
      const rNorm = Math.pow(Math.random(), 2.3);
      const arm = Math.floor(Math.random() * ARMS);
      const baseAngle = (arm / ARMS) * Math.PI * 2;
      const r = rNorm * R_MAX;
      const angle = baseAngle + rNorm * TWIST + gaussian() * 0.22;
      const armWidth = 40 + rNorm * 70;
      const rr = Math.max(6, r + gaussian() * armWidth * 0.5);
      const thickness = 55 * (1 - rNorm) + 6;
      const y = gaussian() * thickness * 0.4;

      let size, color, bright = false;
      if (real) {
        const starVal = real.stars || 1;
        size = clamp(0.9 + Math.log2(starVal + 1) * 0.42, 0.9, 3.4);
        color = tempColor(clamp(gaussian() * 0.24 + 0.55, 0, 1));
        bright = starVal >= 50;
      } else {
        size = rand(0.7, 1.5) + (1 - rNorm) * 1.6;
        color = tempColor(clamp(gaussian() * 0.24 + (rNorm < 0.18 ? 0.32 : 0.55), 0, 1));
      }

      return {
        rPlane: rr, angle0: angle, y, size, color, bright,
        spikeArms: Math.random() < 0.25 ? 3 : 2, spikeRot: rand(0, Math.PI / 2),
        phase: rand(0, Math.PI * 2), speed: rand(0.4, 1.5), twinkleAmp: rand(0.1, 0.34),
      };
    }

    function makeBulgeStar(real) {
      const rB = CORE_R * Math.pow(Math.random(), real ? 1.2 : 1.8);
      const thetaS = Math.random() * Math.PI * 2;
      const phiS = Math.acos(2 * Math.random() - 1);
      const by = rB * Math.cos(phiS) * 0.55;

      let size, color, bright = false, link = null;
      if (real) {
        size = rand(2.6, 4.2);
        color = hexToRgbStr(real.backdrop && real.backdrop.center) || tempColor(0.3);
        bright = true;
        link = `https://t.me/nft/${real.slug}`;
      } else {
        size = rand(1.1, 2.7);
        color = tempColor(clamp(gaussian() * 0.2 + 0.3, 0, 1));
      }

      return {
        rPlane: rB, angle0: thetaS, y: by, size, color, bright, link,
        spikeArms: Math.random() < 0.4 ? 3 : 2, spikeRot: rand(0, Math.PI / 2),
        phase: rand(0, Math.PI * 2), speed: rand(0.3, 1.1), twinkleAmp: rand(0.1, 0.34),
      };
    }

    function build(data) {
      const items = (data && data.items) || [];
      const uniqueItems = items.filter((i) => i.type === "unique");
      const regularItems = items.filter((i) => i.type === "regular");
      const total = Math.max(0, (data && data.total) || 0);
      const renderCount = Math.max(0, Math.min(total, RENDER_CAP) - uniqueItems.length);
      const nBulgeFiller = Math.round(renderCount * BULGE_FRACTION);
      const nDiskSlots = renderCount - nBulgeFiller;

      stars = [];
      interactive = [];

      for (let i = 0; i < nDiskSlots; i++) stars.push(makeDiskStar(i < regularItems.length ? regularItems[i] : null));
      for (let i = 0; i < nBulgeFiller; i++) stars.push(makeBulgeStar(null));
      for (let i = 0; i < uniqueItems.length; i++) stars.push(makeBulgeStar(uniqueItems[i]));

      stars.sort((a, b) => b.size - a.size);
      const extraBright = Math.round(stars.length * 0.015);
      for (let i = 0; i < extraBright; i++) stars[i].bright = true;

      for (const s of stars) if (s.link) interactive.push(s);

      subEl.textContent = uniqueItems.length
        ? `${uniqueItems.length} уникальных · ${formatNumber(total)} всего`
        : `${formatNumber(total)} подарков`;
      let statsText = `⭐ ${data.estimated ? "≈" : ""}${formatNumber(data.stars || 0)}`;
      if (total > RENDER_CAP) statsText += " · показана часть";
      statsEl.textContent = statsText;
      statusEl.textContent = "";
    }

    function showEmpty() {
      stars = []; interactive = [];
      subEl.textContent = "0 подарков";
      statsEl.textContent = "";
      statusEl.textContent = "Подарков пока нет — здесь появятся звёзды, когда тебе что-то подарят";
    }

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      focal = Math.min(W, H) * 0.9;
    }

    let theta = 0.5, phi = 0.3, dist = 1500;
    const MIN_DIST = 260, MAX_DIST = 2700;
    let velTheta = 0.0011;
    const AUTO_ROTATE = 0.0011;
    let dragging = false, lastX = 0, lastY = 0, downT = 0, moved = 0;

    function onDown(x, y) {
      dragging = true; lastX = x; lastY = y;
      downT = performance.now(); moved = 0;
      canvas.classList.add("dragging");
    }
    function onMove(x, y) {
      if (!dragging) return;
      const dx = x - lastX, dy = y - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      const dtheta = -dx * 0.0062, dphi = -dy * 0.0062;
      theta += dtheta;
      phi = clamp(phi + dphi, -1.45, 1.45);
      velTheta = dtheta;
      lastX = x; lastY = y;
    }
    function onUp(x, y) {
      dragging = false;
      canvas.classList.remove("dragging");
      if (moved < 6 && performance.now() - downT < 400) handleTap(x, y);
    }

    function handleTap(x, y) {
      let best = null, bestD = 26 * 26;
      for (const s of interactive) {
        if (!s._vis) continue;
        const dx = x - s._sx, dy = y - s._sy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = s; }
      }
      if (!best) return;
      haptic.tap();
      if (inTelegram) tg.openTelegramLink(best.link);
      else window.open(best.link, "_blank", "noopener");
    }

    canvas.addEventListener("pointerdown", (e) => onDown(e.clientX, e.clientY));
    window.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));
    window.addEventListener("pointerup", (e) => { if (dragging) onUp(e.clientX, e.clientY); });
    window.addEventListener("pointercancel", () => { dragging = false; canvas.classList.remove("dragging"); });

    canvas.addEventListener("wheel", (e) => {
      dist = clamp(dist + e.deltaY * dist * 0.0012, MIN_DIST, MAX_DIST);
    }, { passive: true });

    let lastPinchDist = null;
    canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const pd = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        if (lastPinchDist != null) dist = clamp(dist - (pd - lastPinchDist) * 2.2, MIN_DIST, MAX_DIST);
        lastPinchDist = pd;
      }
    }, { passive: true });
    canvas.addEventListener("touchend", (e) => { if (e.touches.length < 2) lastPinchDist = null; });

    function starColor(c, a) { return `rgb(${c} / ${a})`; }

    function project(x, y, z, cosT, sinT, cosP, sinP, cx, cy) {
      const rx1 = x * cosT - z * sinT;
      const rz1 = x * sinT + z * cosT;
      const ry = y * cosP - rz1 * sinP;
      const rz = y * sinP + rz1 * cosP;
      const finalZ = rz + dist;
      if (finalZ <= 1) return null;
      const scale = focal / finalZ;
      return { x: cx + rx1 * scale, y: cy - ry * scale, scale };
    }

    function drawSpike(sx, sy, size, alpha, color, arms, rot) {
      const len = size * 6.5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.fillStyle = starColor(color, alpha);
      ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
      ctx.fill();
      const mainW = Math.max(0.5, size * 0.26);
      for (let a = 0; a < arms; a++) {
        const ang = (a / arms) * Math.PI;
        const g = ctx.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
        g.addColorStop(0, starColor(color, alpha));
        g.addColorStop(1, starColor(color, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = mainW;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(ang) * len, -Math.sin(ang) * len);
        ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    function frame(now) {
      if (!startTime) startTime = now;
      const t = (now - startTime) / 1000;

      if (!dragging) {
        theta += velTheta;
        velTheta *= 0.94;
        if (!reduceMotion) velTheta += (AUTO_ROTATE - velTheta) * 0.01;
      }

      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      const cosP = Math.cos(phi), sinP = Math.sin(phi);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = "#000003";
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
      const spin = reduceMotion ? 0 : t;

      for (const s of stars) {
        const curAngle = s.angle0 + angularVelocity(s.rPlane) * spin;
        const x = s.rPlane * Math.cos(curAngle);
        const z = s.rPlane * Math.sin(curAngle);
        const p = project(x, s.y, z, cosT, sinT, cosP, sinP, cx, cy);
        if (s.link) s._vis = false;
        if (!p) continue;
        if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;

        const twinkle = reduceMotion ? 0 : Math.sin(t * s.speed + s.phase) * s.twinkleAmp;
        const size = s.size * p.scale * (1 + twinkle * 0.12);
        if (size < 0.15) continue;
        const alpha = clamp(0.72 + twinkle, 0.05, 1);

        if (s.link) { s._sx = p.x; s._sy = p.y; s._vis = true; }

        if (s.bright && size > 0.8) {
          drawSpike(p.x, p.y, size, alpha, s.color, s.spikeArms, s.spikeRot);
        } else {
          ctx.beginPath();
          ctx.fillStyle = starColor(s.color, alpha);
          ctx.arc(p.x, p.y, Math.max(0.35, size * 0.55), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      requestAnimationFrame(frame);
    }

    window.addEventListener("resize", resize);

    function init() {
      resize();
      requestAnimationFrame(frame);
      setTimeout(() => hintEl.classList.add("faded"), 5000);
    }

    function load() {
      if (!inTelegram) { statusEl.textContent = "Открой в Telegram, чтобы увидеть свою галактику"; return; }
      if (!API_URL) { statusEl.textContent = "Сервер подарков ещё не настроен"; return; }

      statusEl.textContent = "Считаю подарки…";
      fetchGiftsData()
        .then((data) => { if (!data.total) showEmpty(); else build(data); })
        .catch((e) => { statusEl.textContent = `Не удалось загрузить подарки: ${e.message}`; });
    }

    return { init, load };
  })();

  if (inTelegram) {
    tg.ready();
    tg.expand();
    tg.BackButton.hide();
    tg.MainButton.hide();
  }

  Galaxy.init();
  Galaxy.load();
})();
