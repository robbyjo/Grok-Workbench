import { bounded, list } from './io';
import type { Wire } from '../../shared/types';
export function readWav(bytes: Buffer) {
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Audio must be PCM WAV, or decoded by Workbench first.');
  let format: Wire | undefined, data: Buffer | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', at, at + 4),
      size = bytes.readUInt32LE(at + 4),
      start = at + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV chunk.');
    if (kind === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format.');
      format = {
        code: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        rate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (kind === 'data') data = bytes.subarray(start, start + size);
    at = start + size + (size % 2);
  }
  if (
    !format ||
    !data ||
    format.code !== 1 ||
    format.bits !== 16 ||
    ![1, 2].includes(format.channels) ||
    format.rate < 8000 ||
    format.rate > 192000 ||
    data.length % (2 * format.channels)
  )
    throw new Error('Supported WAV: 16-bit PCM, mono/stereo, 8–192 kHz.');
  return {
    code: format.code as number,
    channels: format.channels as number,
    rate: format.rate as number,
    bits: format.bits as number,
    data,
    frames: data.length / (2 * format.channels),
  };
}
export function wav(samples: Buffer, rate: number, channels: number) {
  const head = Buffer.alloc(44);
  head.write('RIFF');
  head.writeUInt32LE(36 + samples.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28);
  head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(samples.length, 40);
  return Buffer.concat([head, samples]);
}
export function editAudio(sources: Buffer[], input: Wire) {
  const tracks = list(sources, 20).map(readWav),
    first = tracks[0];
  if (tracks.some((t) => t.rate !== first.rate || t.channels !== first.channels))
    throw new Error('All segments must have the same sample rate and channel count.');
  const trims = input.trims ?? tracks.map(() => ({}));
  if (!Array.isArray(trims) || trims.length !== tracks.length)
    throw new Error('Supply one trim range per input.');
  const parts = tracks.map((t, i) => {
    const start = bounded(trims[i].start ?? 0, 0, t.frames / t.rate),
      end = bounded(trims[i].end ?? t.frames / t.rate, start, t.frames / t.rate);
    if (end <= start) throw new Error('Trim range must contain audio.');
    return t.data.subarray(
      Math.round(start * t.rate) * t.channels * 2,
      Math.min(t.frames, Math.round(end * t.rate)) * t.channels * 2,
    );
  });
  const samples = Buffer.concat(parts);
  if (!samples.length || samples.length > 40 * 1024 * 1024)
    throw new Error('Audio export supports up to 40 MiB of PCM samples.');
  let peak = 0;
  for (let i = 0; i < samples.length; i += 2)
    peak = Math.max(peak, Math.abs(samples.readInt16LE(i)));
  const target = input.normalize_db === undefined ? undefined : bounded(input.normalize_db, -24, 0),
    gain = target === undefined || peak === 0 ? 1 : (32767 * Math.pow(10, target / 20)) / peak;
  for (let i = 0; i < samples.length; i += 2)
    samples.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(samples.readInt16LE(i) * gain))),
      i,
    );
  const result = wav(samples, first.rate, first.channels);
  return {
    bytes: result,
    rate: first.rate,
    channels: first.channels,
    seconds: samples.length / (first.rate * first.channels * 2),
    gain,
    peakBefore: peak / 32768,
    peakAfter: (peak * gain) / 32768,
  };
}
export function audacityMacro(path: string, peak = -3) {
  if (/["\r\n]/.test(path)) throw new Error('Unsupported audio path for Audacity macro.');
  return `Import2:Filename="${path.replace(/\\/g, '/')}"\nSelectAll:\nNormalize:ApplyGain="1" PeakLevel="${bounded(peak, -24, 0)}" RemoveDcOffset="1" StereoIndependent="0"\n`;
}
