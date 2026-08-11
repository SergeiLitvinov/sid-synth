export function createVisualization({ canvas, spectroscope, analyser, analyserFreq }) {
  const cvs = canvas.getContext('2d');
  const specCvs = spectroscope.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth > 800 ? 750 : window.innerWidth - 40;
    canvas.height = 180;
    spectroscope.width = canvas.width;
    spectroscope.height = 120;
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    requestAnimationFrame(draw);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    const w = canvas.width, h = canvas.height;

    cvs.fillStyle = '#000000';
    cvs.fillRect(0, 0, w, h);

    cvs.strokeStyle = '#4af74a';
    cvs.lineWidth = 2;
    cvs.beginPath();
    const sliceW = w / data.length;
    for (let i = 0; i < data.length; i++) {
      const y = (data[i] / 128.0) * h / 2;
      if (i === 0) cvs.moveTo(0, y);
      else cvs.lineTo(i * sliceW, y);
    }
    cvs.stroke();

    const freqData = new Uint8Array(analyserFreq.frequencyBinCount);
    analyserFreq.getByteFrequencyData(freqData);
    const sw = spectroscope.width, sh = spectroscope.height;
    specCvs.fillStyle = '#000000';
    specCvs.fillRect(0, 0, sw, sh);
    const barWidth = (sw / freqData.length) * 2;
    let barX = 0;
    for (let i = 0; i < freqData.length; i++) {
      const barHeight = (freqData[i] / 255.0) * sh;
      specCvs.fillStyle = `hsl(${((i / freqData.length) * 120 + 80)}, 70%, 50%)`;
      specCvs.fillRect(barX, sh - barHeight, barWidth, barHeight);
      barX += barWidth + 1;
    }
  }

  function start() {
    draw();
  }

  return { start };
}
