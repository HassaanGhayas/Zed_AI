/**
 * Re-encode a MediaRecorder clip (webm/ogg) as 16 kHz mono WAV.
 * Gemini's audio whitelist is WAV/MP3/AIFF/AAC/OGG-Vorbis/FLAC — the
 * browser-native webm/opus containers are rejected, so we transcode
 * client-side via decodeAudioData (no server dependencies).
 */

export async function blobToWavBlob(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext unavailable');
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return encodeWavMono16k(decoded);
  } finally {
    void ctx.close();
  }
}

function encodeWavMono16k(buf: AudioBuffer): Blob {
  const targetRate = 16000;
  const src = buf.getChannelData(0);
  const ratio = buf.sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const samples = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    // Block-average downsampling (anti-aliasing good enough for speech)
    const start = Math.floor(i * ratio);
    const end = Math.min(src.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += src[j];
    samples[i] = end > start ? sum / (end - start) : 0;
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
