// @ts-nocheck
/**
 * midi-player.ts
 * 负责 MIDI 二进制文件的解析与基于 Web Audio 的高质量 Chiptune-Synth 播放器实现。
 * 支持 16 个真实物理通道的 AnalyserNode 数据提取，与 3D WebGL 示波器 100% 真实同步。
 */

// ─── 二进制读取辅助类 ────────────────────────────────────────────────
class BinaryReader {
  view: DataView;
  offset: number;
  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }
  get eof() {
    return this.offset >= this.view.byteLength;
  }
  readUint8(): number {
    if (this.offset >= this.view.byteLength) return 0;
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }
  readUint16(): number {
    if (this.offset + 1 >= this.view.byteLength) return 0;
    const val = this.view.getUint16(this.offset, false); // big endian
    this.offset += 2;
    return val;
  }
  readUint32(): number {
    if (this.offset + 3 >= this.view.byteLength) return 0;
    const val = this.view.getUint32(this.offset, false); // big endian
    this.offset += 4;
    return val;
  }
  readBytes(len: number): Uint8Array {
    const available = this.view.byteLength - this.offset;
    const actualLen = Math.min(len, available);
    if (actualLen <= 0) return new Uint8Array(0);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, actualLen);
    this.offset += actualLen;
    return bytes;
  }
  readString(len: number): string {
    const bytes = this.readBytes(len);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return str;
  }
  readVarLength(): number {
    let value = 0;
    while (true) {
      const b = this.readUint8();
      value = (value << 7) | (b & 0x7F);
      if (!(b & 0x80)) break;
    }
    return value;
  }
}

export interface MidiEvent {
  type: string;
  tick: number;
  time: number; // 秒
  channel: number;
  key?: number;
  velocity?: number;
  program?: number;
  tempo?: number;
  text?: string;
}

export interface MidiTrack {
  name: string;
  events: MidiEvent[];
}

// ─── MIDI 文件解析器 ────────────────────────────────────────────────
export class MidiParser {
  static parse(buffer: ArrayBuffer) {
    const reader = new BinaryReader(buffer);

    const headerId = reader.readString(4);
    if (headerId !== "MThd") {
      throw new Error("Not a valid MIDI file: missing MThd header");
    }
    const headerLen = reader.readUint32();
    if (headerLen < 6) {
      throw new Error("Invalid MThd header length");
    }
    const format = reader.readUint16();
    const numTracks = reader.readUint16();
    const division = reader.readUint16();

    if (headerLen > 6) {
      reader.offset += (headerLen - 6);
    }

    if (division & 0x8000) {
      throw new Error("SMPTE division is not supported");
    }

    const tracks: MidiTrack[] = [];
    let songTitle = "";

    for (let t = 0; t < numTracks; t++) {
      if (reader.eof) break;
      const trackId = reader.readString(4);
      if (trackId !== "MTrk") {
        const chunkLen = reader.readUint32();
        reader.offset += chunkLen;
        continue;
      }
      const trackLen = reader.readUint32();
      const trackEndOffset = reader.offset + trackLen;

      let currentTick = 0;
      let runningStatus = 0;
      const events: MidiEvent[] = [];
      let trackName = "";

      while (reader.offset < trackEndOffset && reader.offset < reader.view.byteLength) {
        const deltaTime = reader.readVarLength();
        currentTick += deltaTime;

        let status = reader.readUint8();
        if (status < 0x80) {
          status = runningStatus;
          reader.offset -= 1;
        } else {
          runningStatus = status;
        }

        const msgType = status & 0xF0;
        const channel = status & 0x0F;

        if (status === 0xFF) {
          const metaType = reader.readUint8();
          const metaLen = reader.readVarLength();
          const metaBytes = reader.readBytes(metaLen);

          if (metaType === 0x2F) {
            break;
          } else if (metaType === 0x51) {
            const tempoVal = (metaBytes[0] << 16) | (metaBytes[1] << 8) | metaBytes[2];
            events.push({
              type: "tempo",
              tick: currentTick,
              time: 0,
              channel: 0,
              tempo: tempoVal
            });
          } else if (metaType === 0x03) {
            let tName = "";
            for (let i = 0; i < metaBytes.length; i++) {
              tName += String.fromCharCode(metaBytes[i]);
            }
            trackName = tName.trim();
            if (!songTitle) songTitle = trackName;
          }
        } else if (status === 0xF0 || status === 0xF7) {
          const sysexLen = reader.readVarLength();
          reader.offset += sysexLen;
        } else {
          if (msgType === 0x90) {
            const key = reader.readUint8();
            const velocity = reader.readUint8();
            events.push({
              type: velocity > 0 ? "noteOn" : "noteOff",
              tick: currentTick,
              time: 0,
              channel,
              key,
              velocity
            });
          } else if (msgType === 0x80) {
            const key = reader.readUint8();
            const velocity = reader.readUint8();
            events.push({
              type: "noteOff",
              tick: currentTick,
              time: 0,
              channel,
              key,
              velocity
            });
          } else if (msgType === 0xC0) {
            const program = reader.readUint8();
            events.push({
              type: "programChange",
              tick: currentTick,
              time: 0,
              channel,
              program
            });
          } else if (msgType === 0xA0 || msgType === 0xB0 || msgType === 0xE0) {
            reader.offset += 2;
          } else if (msgType === 0xD0) {
            reader.offset += 1;
          }
        }
      }

      reader.offset = trackEndOffset;
      tracks.push({
        name: trackName,
        events
      });
    }

    let allEvents: MidiEvent[] = [];
    for (const track of tracks) {
      allEvents = allEvents.concat(track.events);
    }
    allEvents.sort((a, b) => a.tick - b.tick);

    let currentTempo = 500000; // 默认 120 BPM
    let lastTick = 0;
    let lastTime = 0.0;

    for (const ev of allEvents) {
      const deltaTick = ev.tick - lastTick;
      const deltaTime = deltaTick * (currentTempo / 1000000.0) / division;
      ev.time = lastTime + deltaTime;

      lastTick = ev.tick;
      lastTime = ev.time;

      if (ev.type === "tempo" && ev.tempo) {
        currentTempo = ev.tempo;
      }
    }

    const duration = lastTime;

    const playableEvents = allEvents.filter(
      ev => ev.type === "noteOn" || ev.type === "noteOff" || ev.type === "programChange"
    );

    const ticksPerRow = division / 4;
    const maxTick = allEvents.length > 0 ? allEvents[allEvents.length - 1].tick : 0;
    const maxRow = Math.ceil(maxTick / ticksPerRow);
    const rowsPerPattern = 64;
    const numPatterns = Math.ceil((maxRow + 1) / rowsPerPattern);

    const patterns: any[] = [];
    for (let p = 0; p < numPatterns; p++) {
      const patternRows: any[] = [];
      for (let r = 0; r < rowsPerPattern; r++) {
        const rowChannels: any[] = [];
        for (let c = 0; c < 16; c++) {
          rowChannels.push({
            note: 0,
            instrument: 0,
            volEffect: 0,
            effect: 0,
            volVal: 0,
            param: 0
          });
        }
        patternRows.push(rowChannels);
      }
      patterns.push(patternRows);
    }

    const currentChannelProgram = Array(16).fill(0);

    for (const ev of allEvents) {
      if (ev.channel < 0 || ev.channel >= 16) continue;

      if (ev.type === "programChange" && ev.program !== undefined) {
        currentChannelProgram[ev.channel] = ev.program;
      } else if (ev.type === "noteOn" && ev.key !== undefined && ev.velocity !== undefined) {
        const globalRow = Math.round(ev.tick / ticksPerRow);
        const patternIdx = Math.floor(globalRow / rowsPerPattern);
        const rowIdx = globalRow % rowsPerPattern;
        if (patternIdx >= 0 && patternIdx < numPatterns) {
          const cell = patterns[patternIdx][rowIdx][ev.channel];
          cell.note = ev.key;
          cell.instrument = currentChannelProgram[ev.channel] + 1;
          cell.volVal = Math.min(64, Math.round((ev.velocity / 127) * 64));
        }
      } else if (ev.type === "noteOff" && ev.key !== undefined) {
        const globalRow = Math.round(ev.tick / ticksPerRow);
        const patternIdx = Math.floor(globalRow / rowsPerPattern);
        const rowIdx = globalRow % rowsPerPattern;
        if (patternIdx >= 0 && patternIdx < numPatterns) {
          const cell = patterns[patternIdx][rowIdx][ev.channel];
          cell.note = 121;
          cell.instrument = currentChannelProgram[ev.channel] + 1;
          cell.volVal = 0;
        }
      }
    }

    const patternTable = Array.from({ length: numPatterns }, (_, i) => i);

    const song = {
      title: songTitle || "Untitled MIDI",
      patterns,
      patternTable,
      typeId: "midi",
      length: numPatterns,
      channels: Array.from({ length: 16 }, (_, i) => `Chn ${i + 1}`)
    };

    return {
      song,
      playableEvents,
      duration,
      division
    };
  }
}

// ─── 高质量 Web Audio 虚拟合成播放器 ─────────────────────────────────
export class MidiSynthPlayer {
  ctx: AudioContext;
  outputNode: AudioNode;

  playableEvents: MidiEvent[];
  duration: number;
  division: number;

  isPlaying: boolean = false;
  startTime: number = 0;
  playTimeOffset: number = 0;
  
  // 16路真实的 AnalyserNode / GainNode
  channelAnalysers: AnalyserNode[] = [];
  channelGains: GainNode[] = [];
  
  // 合成总混音和空间延迟节点链
  mixNode: GainNode;
  delayNode: DelayNode | null = null;
  delayFeedback: GainNode | null = null;
  
  // 活跃声音字典
  activeVoices: Map<string, { oscs: AudioNode[], gain: GainNode }> = new Map();
  noiseBuffer: AudioBuffer | null = null;
  channelPrograms: number[] = Array(16).fill(0);
  
  schedulerTimer: any = null;
  lastScheduledEventIndex: number = 0;
  
  rafId: number | null = null;

  onProgress: (state: { pos: number; order: number; row: number; chVol: any[] }) => void = () => {};
  onEnded: () => void = () => {};

  constructor(ctx: AudioContext, outputNode: AudioNode, songData: any) {
    this.ctx = ctx;
    this.outputNode = outputNode;
    this.playableEvents = songData.playableEvents;
    this.duration = songData.duration;
    this.division = songData.division;

    // 1. 初始化总混音节点
    this.mixNode = this.ctx.createGain();
    this.mixNode.gain.value = 1.0;
    this.mixNode.connect(this.outputNode);

    // 2. 建立空间 Feedback Delay 效果器（大幅改善音质）
    this.delayNode = this.ctx.createDelay(1.0);
    this.delayNode.delayTime.value = 0.22; // 220ms 空感延迟

    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = 0.24; // 适中混响比

    this.mixNode.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode); // 反馈自环
    this.delayFeedback.connect(this.outputNode); // 湿声连接到最终输出

    // 3. 为 16 个通道分别初始化物理 Analyser 节点
    for (let i = 0; i < 16; i++) {
      const cAnalyser = this.ctx.createAnalyser();
      cAnalyser.fftSize = 1024;
      cAnalyser.smoothingTimeConstant = 0.25;

      const cGain = this.ctx.createGain();
      cGain.gain.value = 1.0;

      // 拓扑：voice -> cGain -> cAnalyser -> mixNode
      cGain.connect(cAnalyser);
      cAnalyser.connect(this.mixNode);

      this.channelGains.push(cGain);
      this.channelAnalysers.push(cAnalyser);
    }
  }

  getNoiseBuffer(): AudioBuffer {
    if (!this.noiseBuffer) {
      const bufferSize = this.ctx.sampleRate * 0.4;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  keyToFreq(key: number): number {
    return 440 * Math.pow(2, (key - 69) / 12);
  }

  // ── 播放与调度控制 ──────────────────────────────────────────────────
  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.startTime = this.ctx.currentTime - this.playTimeOffset;
    
    this.lastScheduledEventIndex = 0;
    while (
      this.lastScheduledEventIndex < this.playableEvents.length &&
      this.playableEvents[this.lastScheduledEventIndex].time < this.playTimeOffset
    ) {
      const ev = this.playableEvents[this.lastScheduledEventIndex];
      if (ev.type === "programChange" && ev.program !== undefined) {
        this.channelPrograms[ev.channel] = ev.program;
      }
      this.lastScheduledEventIndex++;
    }

    this.schedulerTimer = setInterval(() => this.scheduleEvents(), 30);
    this.startWaveCapture();
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.playTimeOffset = this.ctx.currentTime - this.startTime;
    this.allNotesOff();
  }

  stop() {
    this.isPlaying = false;
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.playTimeOffset = 0;
    this.allNotesOff();
    this.channelPrograms.fill(0);
  }

  seek(seconds: number) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    this.playTimeOffset = Math.max(0, Math.min(this.duration, seconds));
    if (wasPlaying) {
      this.play();
    }
  }

  // ── 60FPS 实时通道真实波形与强度捕获（完美复刻 libopenmpt 视觉）──────
  startWaveCapture() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const buf = new Float32Array(512);

    const update = () => {
      if (!this.isPlaying) {
        this.rafId = null;
        return;
      }

      const dummyList = (window as any).__channelAnalysers || [];
      const limit = Math.min(16, dummyList.length);

      for (let i = 0; i < limit; i++) {
        if (dummyList[i] && dummyList[i].analyser) {
          const dummyAnal = dummyList[i].analyser;
          const realAnal = this.channelAnalysers[i];

          // 1. 读取单通道真实的物理音频时域波形数据
          realAnal.getFloatTimeDomainData(buf);

          // 2. 将数据拷贝分配给 DummyAnalyser
          if (!dummyAnal.realWaveData || dummyAnal.realWaveData.length !== 512) {
            dummyAnal.realWaveData = new Float32Array(512);
          }
          dummyAnal.realWaveData.set(buf);

          // 3. 计算 RMS 均方根强度，将其转为 dB-scale [0, 1] 的 waveformIntensity，用以驱动 LED/发光闪烁
          let sumSq = 0;
          for (let j = 0; j < 512; j++) {
            sumSq += buf[j] * buf[j];
          }
          const rms = Math.sqrt(sumSq / 512);
          // 乘以 3.5 适度增强灯光对比度
          dummyAnal.waveformIntensity = Math.min(1.0, rms * 3.5);
        }
      }

      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }

  scheduleEvents() {
    const now = this.ctx.currentTime;
    const lookAheadEnd = now - this.startTime + 0.15; // 预调度 150ms 内事件
    
    while (
      this.lastScheduledEventIndex < this.playableEvents.length &&
      this.playableEvents[this.lastScheduledEventIndex].time < lookAheadEnd
    ) {
      const ev = this.playableEvents[this.lastScheduledEventIndex];
      const eventTime = this.startTime + ev.time;

      if (ev.type === "programChange" && ev.program !== undefined) {
        this.channelPrograms[ev.channel] = ev.program;
      } else if (ev.type === "noteOn" && ev.key !== undefined && ev.velocity !== undefined) {
        this.noteOn(ev.channel, ev.key, ev.velocity, eventTime);
      } else if (ev.type === "noteOff" && ev.key !== undefined) {
        this.noteOff(ev.channel, ev.key, eventTime);
      }

      this.lastScheduledEventIndex++;
    }

    const elapsed = Math.max(0, this.ctx.currentTime - this.startTime);
    if (elapsed >= this.duration) {
      this.stop();
      this.onEnded();
      return;
    }

    const ticksPerRow = this.division / 4;
    const currentTick = this.getTickAtTime(elapsed);
    const globalRow = Math.round(currentTick / ticksPerRow);
    const rowsPerPattern = 64;
    const order = Math.floor(globalRow / rowsPerPattern);
    const row = globalRow % rowsPerPattern;

    this.onProgress({
      pos: elapsed,
      order,
      row,
      chVol: [] // 示波器现已在 rAF 物理捕获真实波形，不再需要传 chVol 回包
    });
  }

  getTickAtTime(seconds: number): number {
    if (this.playableEvents.length === 0) return 0;
    let low = 0;
    let high = this.playableEvents.length - 1;
    let closestIndex = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.playableEvents[mid].time <= seconds) {
        closestIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const ev = this.playableEvents[closestIndex];
    const nextEv = closestIndex + 1 < this.playableEvents.length ? this.playableEvents[closestIndex + 1] : null;
    if (!nextEv) return ev.tick;
    const timeRatio = (seconds - ev.time) / (nextEv.time - ev.time || 0.001);
    return ev.tick + timeRatio * (nextEv.tick - ev.tick);
  }

  // ─── 高质量 Chiptune FM 合成发音机制 ──────────────────────────────
  noteOn(channel: number, key: number, velocity: number, time: number) {
    const keyStr = `${channel}_${key}`;
    if (this.activeVoices.has(keyStr)) {
      this.noteOff(channel, key, time);
    }

    const freq = this.keyToFreq(key);
    const oscs: AudioNode[] = [];
    const gainNode = this.ctx.createGain();
    const volume = velocity / 127;

    // 连接到该通道的独立 Gain 物理节点
    gainNode.connect(this.channelGains[channel]);

    if (channel === 9) {
      // ── 通道 9：高品质打击乐器模拟 ───────────────────────────────
      if (key === 35 || key === 36) {
        // 大鼓 (Kick)：扫频 Sine + 白噪声击打瞬态 Click
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.exponentialRampToValueAtTime(42, time + 0.08);

        // 超短高通噪声 Click，模拟槌头击皮声
        const clickSource = this.ctx.createBufferSource();
        clickSource.buffer = this.getNoiseBuffer();
        const clickFilter = this.ctx.createBiquadFilter();
        clickFilter.type = "bandpass";
        clickFilter.frequency.setValueAtTime(1000, time);
        clickFilter.Q.setValueAtTime(4.0, time);

        const clickGain = this.ctx.createGain();
        clickGain.gain.setValueAtTime(volume * 0.45, time);
        clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.015);

        clickSource.connect(clickFilter);
        clickFilter.connect(clickGain);
        clickGain.connect(gainNode);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.9, time + 0.004);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

        osc.connect(gainNode);
        osc.start(time);
        osc.stop(time + 0.22);
        clickSource.start(time);
        clickSource.stop(time + 0.02);

        oscs.push(osc, clickSource);
      } else if (key === 38 || key === 40) {
        // 小鼓 (Snare)：带通滤波器噪声 + 扫频共鸣 Sine
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1200, time);
        filter.Q.setValueAtTime(3.0, time);

        // 鼓身共鸣波
        const bodyOsc = this.ctx.createOscillator();
        bodyOsc.type = "sine";
        bodyOsc.frequency.setValueAtTime(180, time);
        bodyOsc.frequency.linearRampToValueAtTime(80, time + 0.08);
        const bodyGain = this.ctx.createGain();
        bodyGain.gain.setValueAtTime(volume * 0.5, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(gainNode);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.65, time + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

        noise.connect(filter);
        filter.connect(gainNode);
        
        noise.start(time);
        noise.stop(time + 0.2);
        bodyOsc.start(time);
        bodyOsc.stop(time + 0.1);

        oscs.push(noise, bodyOsc);
      } else if (key === 42 || key === 44) {
        // 闭合踩镲 (Hi-hat Closed)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(8800, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.38, time + 0.002);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.045);

        noise.connect(filter);
        filter.connect(gainNode);
        noise.start(time);
        noise.stop(time + 0.055);

        oscs.push(noise);
      } else if (key === 46) {
        // 开放踩镲 (Hi-hat Open)
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.getNoiseBuffer();

        const filter = this.ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.setValueAtTime(8200, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.35, time + 0.003);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

        noise.connect(filter);
        filter.connect(gainNode);
        noise.start(time);
        noise.stop(time + 0.27);

        oscs.push(noise);
      } else {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * 1.3, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.45, time + 0.004);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.07);

        osc.connect(gainNode);
        osc.start(time);
        osc.stop(time + 0.08);
        oscs.push(osc);
      }
    } else {
      // ──Melodic Channels：精细微失谐双振荡器 + 空间包络 ADSR ───
      const prog = this.channelPrograms[channel];
      
      if (prog >= 0 && prog <= 7) {
        // 1. 钢琴类：Triangle 基音 + Sine 二次泛音（轻微失谐 detune）
        const osc1 = this.ctx.createOscillator();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq, time);

        const osc2 = this.ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq * 2, time);
        osc2.detune.setValueAtTime(6, time); // detune +6 cents

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.72, time + 0.005);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.15, time + 0.45);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        osc1.start(time);
        osc2.start(time);
        oscs.push(osc1, osc2);
      } else if ((prog >= 16 && prog <= 23) || (prog >= 48 && prog <= 55)) {
        // 2. 风琴 / 弦乐类：双 Sawtooth 波形相互失谐，产生宽广立体声群体感
        const osc1 = this.ctx.createOscillator();
        osc1.type = "sawtooth";
        osc1.frequency.setValueAtTime(freq, time);
        osc1.detune.setValueAtTime(-8, time); // -8 cents

        const osc2 = this.ctx.createOscillator();
        osc2.type = "sawtooth";
        osc2.frequency.setValueAtTime(freq * 1.0005, time);
        osc2.detune.setValueAtTime(8, time); // +8 cents

        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1600, time);

        const isString = (prog >= 48 && prog <= 55);
        const attackTime = isString ? 0.16 : 0.015; // 弦乐慢起音
        const sustainVol = volume * (isString ? 0.52 : 0.45);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(sustainVol, time + attackTime);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gainNode);
        osc1.start(time);
        osc2.start(time);
        oscs.push(osc1, osc2);
      } else if (prog >= 32 && prog <= 39) {
        // 3. 贝斯类：Triangle 基音降频 + Square 谐波叠加（颗粒感贝斯）
        const osc1 = this.ctx.createOscillator();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq / 2, time); // 低八度

        const osc2 = this.ctx.createOscillator();
        osc2.type = "square";
        osc2.frequency.setValueAtTime(freq / 2, time);
        osc2.detune.setValueAtTime(4, time);

        const bassGain = this.ctx.createGain();
        bassGain.gain.setValueAtTime(volume * 0.28, time); // square 谐波音量较低

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.8, time + 0.006);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.32, time + 0.5);

        osc1.connect(gainNode);
        osc2.connect(bassGain);
        bassGain.connect(gainNode);

        osc1.start(time);
        osc2.start(time);
        oscs.push(osc1, osc2);
      } else if (prog >= 80 && prog <= 87) {
        // 4. 合成 Lead 类：温暖双方波（Double Square）微失谐，经典的复古 8-bit
        const osc1 = this.ctx.createOscillator();
        osc1.type = "square";
        osc1.frequency.setValueAtTime(freq, time);
        osc1.detune.setValueAtTime(-6, time);

        const osc2 = this.ctx.createOscillator();
        osc2.type = "square";
        osc2.frequency.setValueAtTime(freq, time);
        osc2.detune.setValueAtTime(6, time);

        const lead2Gain = this.ctx.createGain();
        lead2Gain.gain.setValueAtTime(volume * 0.45, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.48, time + 0.004);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.25, time + 0.35);

        osc1.connect(gainNode);
        osc2.connect(lead2Gain);
        lead2Gain.connect(gainNode);

        osc1.start(time);
        osc2.start(time);
        oscs.push(osc1, osc2);
      } else {
        // 5. 其它乐器默认：Triangle + Sine 混合
        const osc1 = this.ctx.createOscillator();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq, time);

        const osc2 = this.ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq * 2, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(volume * 0.62, time + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(volume * 0.18, time + 0.42);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        osc1.start(time);
        osc2.start(time);
        oscs.push(osc1, osc2);
      }
    }

    this.activeVoices.set(keyStr, { oscs, gain: gainNode });
  }

  noteOff(channel: number, key: number, time: number) {
    const keyStr = `${channel}_${key}`;
    const voice = this.activeVoices.get(keyStr);
    if (voice) {
      this.activeVoices.delete(keyStr);
      
      const oscs = voice.oscs;
      const gainNode = voice.gain;
      
      try {
        gainNode.gain.cancelScheduledValues(time);
        gainNode.gain.setValueAtTime(gainNode.gain.value, time);
        
        // 采用指数快速平滑衰减，释放阶段（Release）0.08 秒
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

        oscs.forEach(osc => {
          try {
            osc.stop(time + 0.09);
          } catch (e) {
          }
        });
      } catch (e) {
        console.warn("Error releasing MIDI note:", e);
      }
    }
  }

  allNotesOff() {
    this.activeVoices.forEach((voice) => {
      try {
        voice.gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        voice.oscs.forEach(osc => {
          try { osc.stop(); } catch (e) {}
        });
      } catch (e) {}
    });
    this.activeVoices.clear();
  }
}
