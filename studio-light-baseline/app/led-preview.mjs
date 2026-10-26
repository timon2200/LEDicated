import { BAR_IDS, rgbwToRgb } from './engine.mjs';
import { physicalLedPixels } from './mapping.mjs';

// Normalize against 255 so full show level reaches 1.0 (255 monitor RGB) with punchy gamma.
const display = pixel => {
  const [r, g, b] = rgbwToRgb(pixel);
  const nr = Math.min(1, Math.max(0, r / 255));
  const ng = Math.min(1, Math.max(0, g / 255));
  const nb = Math.min(1, Math.max(0, b / 255));
  return [Math.pow(nr, 1 / 1.8), Math.pow(ng, 1 / 1.8), Math.pow(nb, 1 / 1.8)];
};

export function createLedPreview(container, section) {
  container.replaceChildren();
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Svaka fizička LED dioda u rasporedu devet barova');

  const canvas = document.createElement('canvas');
  canvas.id = 'led-preview';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);

  const detail = document.createElement('div');
  detail.className = 'led-detail';
  detail.innerHTML = `
    <div class="led-detail-heading">
      <div class="led-detail-left">
        <strong id="selected-bar-name">C2</strong>
        <span id="selected-bar-count">72 fizičke LED · 12 grupa</span>
      </div>
      <div class="bar-selector-pills" role="toolbar" aria-label="Odabir bara za detaljni pregled"></div>
      <span id="preview-mode">CANVAS 2D · 576 LED</span>
    </div>
    <div class="detail-canvas-wrap">
      <canvas id="led-detail-canvas" height="52" aria-label="Pojedinačne LED diode odabranog bara"></canvas>
    </div>
    <div id="led-readout" class="led-readout" aria-live="polite">
      <span class="readout-chip" id="readout-chip"></span>
      <span id="readout-text">Pomakni pokazivač preko diode za točne RGBW vrijednosti.</span>
    </div>
  `;
  section.querySelector('.stage').after(detail);

  const detailCanvas = detail.querySelector('canvas');
  const readoutText = detail.querySelector('#readout-text');
  const readoutChip = detail.querySelector('#readout-chip');
  const pillBox = detail.querySelector('.bar-selector-pills');
  const mode = detail.querySelector('#preview-mode');

  let selected = 'C2', lastFrame = null, lastConfig = null, hoveredIndex = -1;
  const prevStageBytes = new Uint8Array(9 * 12 * 4);
  const prevDetailBytes = new Uint8Array(12 * 4);
  let lastStageKey = '';
  let lastDetailKey = '';

  function hasStageChanged(frame, key) {
    let changed = key !== lastStageKey;
    let ptr = 0;
    for (let b = 0; b < BAR_IDS.length; b++) {
      const barPixels = frame.bars[BAR_IDS[b]];
      for (let p = 0; p < 12; p++) {
        const px = barPixels?.[p];
        const r = px ? (px[0] & 0xff) : 0;
        const g = px ? (px[1] & 0xff) : 0;
        const bl = px ? (px[2] & 0xff) : 0;
        const w = px ? (px[3] & 0xff) : 0;
        if (
          prevStageBytes[ptr] !== r ||
          prevStageBytes[ptr + 1] !== g ||
          prevStageBytes[ptr + 2] !== bl ||
          prevStageBytes[ptr + 3] !== w
        ) {
          prevStageBytes[ptr] = r;
          prevStageBytes[ptr + 1] = g;
          prevStageBytes[ptr + 2] = bl;
          prevStageBytes[ptr + 3] = w;
          changed = true;
        }
        ptr += 4;
      }
    }
    lastStageKey = key;
    return changed;
  }

  function hasDetailChanged(barPixels, key) {
    let changed = key !== lastDetailKey;
    let ptr = 0;
    for (let p = 0; p < 12; p++) {
      const px = barPixels?.[p];
      const r = px ? (px[0] & 0xff) : 0;
      const g = px ? (px[1] & 0xff) : 0;
      const bl = px ? (px[2] & 0xff) : 0;
      const w = px ? (px[3] & 0xff) : 0;
      if (
        prevDetailBytes[ptr] !== r ||
        prevDetailBytes[ptr + 1] !== g ||
        prevDetailBytes[ptr + 2] !== bl ||
        prevDetailBytes[ptr + 3] !== w
      ) {
        prevDetailBytes[ptr] = r;
        prevDetailBytes[ptr + 1] = g;
        prevDetailBytes[ptr + 2] = bl;
        prevDetailBytes[ptr + 3] = w;
        changed = true;
      }
      ptr += 4;
    }
    lastDetailKey = key;
    return changed;
  }

  // Balanced 3 × 3 stage grid geometry matching physical 120 cm bar : 58 cm vertical gap ratio (1 : 0.483)
  const colCenterFrac = col => 0.22 + col * 0.28;
  const rowTopFrac = row => 0.065 + row * 0.32;
  const barHFrac = 0.215;

  function resetReadout() {
    readoutText.textContent = 'Pomakni pokazivač preko diode za točne RGBW vrijednosti.';
    readoutChip.style.background = '#000000';
    readoutChip.style.boxShadow = 'none';
  }

  function selectBar(id) {
    selected = id;
    updateSelection();
    resetReadout();
    if (lastFrame && lastConfig) {
      render(lastFrame, lastConfig, true);
      drawDetail(lastFrame, lastConfig, true);
    }
  }

  const updateSelection = () => {
    container.querySelectorAll('.preview-bar-label').forEach(label => label.classList.toggle('selected', label.dataset.bar === selected));
    detail.querySelectorAll('.bar-pill').forEach(pill => pill.classList.toggle('selected', pill.dataset.bar === selected));
  };

  const configure = config => {
    container.querySelectorAll('.bar-rail,.preview-bar-label').forEach(el => el.remove());
    pillBox.replaceChildren();

    for (const [index, id] of BAR_IDS.entries()) {
      if (id === 'C1') continue; // Top-center 120 cm slot is empty physical space
      const row = Math.floor(index / 3), col = index % 3;

      // Clickable rail hit area covering the full fixture
      const rail = document.createElement('div');
      rail.className = 'bar-rail';
      rail.dataset.bar = id;
      rail.style.left = `${colCenterFrac(col) * 100}%`;
      rail.style.top = `${rowTopFrac(row) * 100}%`;
      rail.style.height = `${barHFrac * 100}%`;
      rail.title = `${id}: klikni za odabir`;
      rail.onclick = () => selectBar(id);
      container.append(rail);

      // Dedicated hardware badge label sitting neatly above each fixture
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'preview-bar-label';
      label.textContent = id;
      label.dataset.bar = id;
      label.style.left = `${colCenterFrac(col) * 100}%`;
      label.style.top = `${(rowTopFrac(row) - 0.008) * 100}%`;
      label.title = `${id}: klikni za odabir`;
      label.onclick = () => selectBar(id);
      container.append(label);

      // Detail inspector pill
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'bar-pill';
      pill.textContent = id;
      pill.dataset.bar = id;
      pill.title = `Odaberi bar ${id}`;
      pill.onclick = () => selectBar(id);
      pillBox.append(pill);
    }
    updateSelection();
    if (lastFrame) render(lastFrame, config, true);
  };

  function drawDetail(frame, config, force = false) {
    const bar = config.bars.find(item => item.id === selected);
    if (!bar || !frame?.bars?.[selected]) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = detailCanvas.clientWidth || 300;
    const height = 52;
    const detailKey = `${selected}:${width}:${dpr}:${hoveredIndex}:${bar.pixels}:${bar.reverse ? 1 : 0}`;
    if (!force && !hasDetailChanged(frame.bars[selected], detailKey)) return;

    const pixels = physicalLedPixels(frame.bars[selected], bar);
    detail.querySelector('#selected-bar-name').textContent = selected;
    detail.querySelector('#selected-bar-count').textContent = `${pixels.length} fizičkih LED · ${bar.pixels} grupa`;

    if (detailCanvas.width !== Math.round(width * dpr) || detailCanvas.height !== Math.round(height * dpr)) {
      detailCanvas.width = Math.round(width * dpr);
      detailCanvas.height = Math.round(height * dpr);
    }
    const ctx = detailCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Deep black PCB track
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const groupCount = bar.pixels || 12;
    const groupWidth = width / groupCount;
    const hoveredGroup = hoveredIndex >= 0 ? Math.floor((hoveredIndex * groupCount) / pixels.length) : -1;

    // Draw the 12 addressable group blocks
    for (let g = 0; g < groupCount; g++) {
      const gx = g * groupWidth;
      const isHovered = g === hoveredGroup;

      if (isHovered) {
        ctx.fillStyle = 'rgba(243, 193, 124, 0.14)';
        ctx.fillRect(gx + 1, 2, groupWidth - 2, height - 4);
      }

      ctx.strokeStyle = isHovered ? '#f3c17c' : 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = isHovered ? 1.5 : 1;
      ctx.strokeRect(gx + 1, 2, groupWidth - 2, height - 4);

      // Subtle group number
      ctx.fillStyle = isHovered ? '#f3c17c' : '#33485c';
      ctx.font = '700 8.5px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(String(g + 1), gx + 4, 11);
    }

    // Draw 72 physical diodes
    const spacing = width / pixels.length;
    const radius = Math.max(2.0, Math.min(4.2, spacing * 0.38));
    const centerY = height / 2 + 3;

    pixels.forEach((pixel, i) => {
      const cx = (i + 0.5) * spacing;
      const [cr, cg, cb] = display(pixel);
      const r = Math.round(cr * 255), g = Math.round(cg * 255), b = Math.round(cb * 255);
      const bright = Math.max(r, g, b);
      const isHovered = i === hoveredIndex;

      if (bright < 2) {
        // Off: pitch black diode
        ctx.beginPath();
        ctx.arc(cx, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#06090e';
        ctx.fill();
        ctx.strokeStyle = isHovered ? '#f3c17c' : '#111822';
        ctx.lineWidth = isHovered ? 1.5 : 0.8;
        ctx.stroke();
      } else {
        // Fast soft outer glow halo (avoids 72 per-diode Gaussian blur allocations per frame)
        ctx.beginPath();
        ctx.arc(cx, centerY, radius * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.26)`;
        ctx.fill();

        // On: luminous diode emitter with rich color
        ctx.beginPath();
        ctx.arc(cx, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();

        // Hot center highlight
        if (bright > 110) {
          ctx.beginPath();
          ctx.arc(cx, centerY, radius * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${((bright - 110) / 145) * 0.85})`;
          ctx.fill();
        }

        if (isHovered) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    });
  }

  detailCanvas.addEventListener('pointermove', event => {
    const bar = lastConfig?.bars?.find(item => item.id === selected);
    if (!bar || !lastFrame?.bars?.[selected]) return;
    const pixels = physicalLedPixels(lastFrame.bars[selected], bar);
    const rect = detailCanvas.getBoundingClientRect();
    const index = Math.max(0, Math.min(pixels.length - 1, Math.floor(((event.clientX - rect.left) / rect.width) * pixels.length)));
    hoveredIndex = index;
    const group = Math.min(bar.pixels, Math.floor((index * bar.pixels) / pixels.length) + 1);
    const [r, g, b, w] = pixels[index];
    const [cr, cg, cb] = display(pixels[index]).map(v => Math.round(v * 255));

    readoutText.textContent = `${selected} · Grupa ${group}/${bar.pixels} · LED ${index + 1}/${pixels.length} · RGBW ${r}, ${g}, ${b}, ${w}`;
    readoutChip.style.background = `rgb(${cr},${cg},${cb})`;
    readoutChip.style.boxShadow = `0 0 8px rgb(${cr},${cg},${cb})`;

    drawDetail(lastFrame, lastConfig, true);
  });

  detailCanvas.addEventListener('pointerleave', () => {
    hoveredIndex = -1;
    resetReadout();
    if (lastFrame && lastConfig) drawDetail(lastFrame, lastConfig, true);
  });

  function render(frame, config, force = false) {
    if (!frame?.bars || !config?.bars) return;
    lastFrame = frame;
    lastConfig = config;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = container.clientWidth || 500;
    const height = container.clientHeight || 360;
    const stageKey = `${width}:${height}:${dpr}:${selected}:${config.profile || ''}`;
    if (!force && !hasStageChanged(frame, stageKey)) {
      drawDetail(frame, config, false);
      return;
    }

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Subtle architectural stage truss rig (CAD darkroom guides)
    ctx.save();
    ctx.strokeStyle = '#080d16';
    ctx.lineWidth = 1;
    for (let c = 0; c < 3; c++) {
      const cx = colCenterFrac(c) * width;
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx, height - 10);
      ctx.stroke();
    }
    for (let r = 0; r < 3; r++) {
      const ry = (rowTopFrac(r) + barHFrac / 2) * height;
      ctx.beginPath();
      ctx.moveTo(colCenterFrac(0) * width - 20, ry);
      ctx.lineTo(colCenterFrac(2) * width + 20, ry);
      ctx.stroke();
    }
    ctx.restore();

    // Prominent, well-proportioned bar sizing
    const barW = Math.max(22, Math.min(28, Math.round(width * 0.065)));
    const innerW = barW - 6;
    const cornerR = 7;

    // Render each of the 8 physical bars (C1 is empty 120 cm space at top-center)
    for (const [index, id] of BAR_IDS.entries()) {
      if (id === 'C1') continue;
      const bar = config.bars.find(item => item.id === id);
      if (!bar || !frame.bars[id]) continue;
      // Room stage view always renders top-to-bottom (pixel 0 = top); hardware reverse is only for physical DDP wiring
      const pixels = physicalLedPixels(frame.bars[id], { ...bar, reverse: false });
      const row = Math.floor(index / 3), col = index % 3;

      const barX = colCenterFrac(col) * width;
      const barTop = rowTopFrac(row) * height;
      const barH = barHFrac * height;
      const isSelected = id === selected;

      // Extract colors and overall brightness
      let sumR = 0, sumG = 0, sumB = 0, maxBright = 0;
      const rgbValues = pixels.map(p => {
        const [cr, cg, cb] = display(p);
        sumR += cr; sumG += cg; sumB += cb;
        const b = Math.max(cr, cg, cb);
        if (b > maxBright) maxBright = b;
        return [Math.round(cr * 255), Math.round(cg * 255), Math.round(cb * 255), b];
      });
      const avgR = sumR / pixels.length;
      const avgG = sumG / pixels.length;
      const avgB = sumB / pixels.length;

      // Vertical color gradient matching the exact diodes along the batten
      const glowGrad = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
      for (let s = 0; s <= 6; s++) {
        const pIdx = Math.min(pixels.length - 1, Math.floor((s / 6) * pixels.length));
        const [r, g, b] = rgbValues[pIdx];
        glowGrad.addColorStop(s / 6, `rgb(${r}, ${g}, ${b})`);
      }

      // 1. NEON GLOW (only when active, radiates outward from the bar into the dark stage without expensive per-frame Gaussian blur allocation)
      if (maxBright > 0.01) {
        const glowR = Math.round(avgR * 255);
        const glowG = Math.round(avgG * 255);
        const glowB = Math.round(avgB * 255);
        const intensity = Math.min(1.0, maxBright * 1.3);

        ctx.save();
        for (const [spread, alpha] of [[18, 0.10], [10, 0.22], [4, 0.48], [1.5, 0.78]]) {
          ctx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, ${(alpha * intensity).toFixed(3)})`;
          ctx.lineWidth = spread;
          ctx.beginPath();
          ctx.roundRect(barX - (barW / 2), barTop, barW, barH, cornerR + spread * 0.35);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. FIXTURE CHASSIS (Black aluminum casing with crisp edge)
      ctx.beginPath();
      ctx.roundRect(barX - (barW / 2), barTop, barW, barH, cornerR);
      ctx.fillStyle = '#020305';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#f3c17c' : (maxBright > 0.01 ? `rgba(${Math.round(avgR * 255)}, ${Math.round(avgG * 255)}, ${Math.round(avgB * 255)}, 0.4)` : '#141d28');
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Top and bottom hardware endcaps / mounting brackets
      const capH = 4;
      ctx.fillStyle = isSelected ? '#3a2713' : '#0a1018';
      ctx.fillRect(barX - (barW / 2) - 2, barTop - capH, barW + 4, capH);
      ctx.fillRect(barX - (barW / 2) - 2, barTop + barH, barW + 4, capH);
      ctx.strokeStyle = isSelected ? '#f3c17c' : '#182434';
      ctx.lineWidth = 1;
      ctx.strokeRect(barX - (barW / 2) - 2, barTop - capH, barW + 4, capH);
      ctx.strokeRect(barX - (barW / 2) - 2, barTop + barH, barW + 4, capH);

      // 3. DIFFUSER CHANNEL (Frosted tube body)
      const innerTop = barTop + 4;
      const innerH = barH - 8;

      if (maxBright < 0.01) {
        // OFF: Pure pitch-black #000 channel
        ctx.beginPath();
        ctx.roundRect(barX - innerW / 2, innerTop, innerW, innerH, cornerR - 3);
        ctx.fillStyle = '#000000';
        ctx.fill();
      } else {
        // ON: Luminous frosted tube body radiating color!
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(barX - innerW / 2, innerTop, innerW, innerH, cornerR - 3);
        ctx.fillStyle = glowGrad;
        ctx.globalAlpha = Math.min(0.92, 0.35 + maxBright * 0.58);
        ctx.fill();
        ctx.restore();
      }

      // Subtle hairline separators between the 12 addressable groups
      for (let g = 1; g < 12; g++) {
        const gy = innerTop + (g / 12) * innerH;
        ctx.strokeStyle = maxBright > 0.01 ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(barX - innerW / 2 + 1, gy);
        ctx.lineTo(barX + innerW / 2 - 1, gy);
        ctx.stroke();
      }

      // 4. 72 PHYSICAL DIODES (Crisp emitter cores)
      const diodeR = 2.4;
      for (let i = 0; i < pixels.length; i++) {
        const dy = innerTop + 3 + ((i + 0.5) / pixels.length) * (innerH - 6);
        const [r, g, b, bright] = rgbValues[i];

        if (bright < 0.01) {
          // Off: stealth black diode dot
          ctx.beginPath();
          ctx.arc(barX, dy, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = '#06090e';
          ctx.fill();
        } else {
          // On: luminous emitter dot
          ctx.beginPath();
          ctx.arc(barX, dy, diodeR, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fill();

          // Intense white-hot core
          if (bright > 0.25) {
            const hotA = Math.min(0.95, (bright - 0.25) / 0.75);
            ctx.beginPath();
            ctx.arc(barX, dy, diodeR * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${hotA})`;
            ctx.fill();
          }
        }
      }
    }

    drawDetail(frame, config);
    mode.textContent = `CANVAS 2D · 576 LED`;
  }

  return {
    configure,
    render,
    get mode() { return '2d'; }
  };
}
