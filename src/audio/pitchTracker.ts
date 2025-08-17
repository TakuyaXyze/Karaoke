// --- pitchTracker.ts: マイク→YIN→スムージング→コールバック -----------

import { yin } from "./yin";
import type { YinConfig } from "./yin";
import { ema } from "../utils/smoothing";

export type PitchPoint = {
    tSec: number;      // 計測時刻（録音開始からの秒）
    freq: number | null; // 周波数（無声はnull）
    prob: number;      // 確度
};

export class PitchTracker {
    // 1: 内部保持
    private ac: AudioContext;   // AudioContext
    private analyser: AnalyserNode; // 波形取得用 AnalyserNode
    private src: MediaStreamAudioSourceNode;    // マイクソース
    private rafId: number | null = null;
    private startedAt = 0;  // 内部起点
    private lastEma: number | null = null;  // EMA 状態保持
    private onData: (p: PitchPoint) => void;
    private cfg: Partial<YinConfig>;
    private startOffset = 0;    // 再生オフセット（秒） — start時にセット

    // 2: 外部へ通知するコールバック
    constructor(
        ac: AudioContext,
        stream: MediaStream,
        onData: (p: PitchPoint) => void,
        cfg: Partial<YinConfig> = {}
    ) {
        this.onData = onData;
        this.cfg = cfg;
        // 3: ノード構築
        this.ac = ac;
        this.src = ac.createMediaStreamSource(stream);
        this.analyser = ac.createAnalyser();
        // 4: 解析窓サイズはYINの精度と遅延のトレードオフ（2048～4096が無難）
        this.analyser.fftSize = 2048;
        // 5: 直結（途中でHPFなど入れてもOK）
        this.src.connect(this.analyser);
    }

    start(startOffset = 0) {
        // startOffset を保持（秒）
        this.startOffset = startOffset;
        // startedAt を ac.currentTime - startOffset にセットすることで、
        // onData へ渡す tSec が「曲の再生時刻」と一致するようにする
        this.startedAt = this.ac.currentTime - this.startOffset;

        // 解析バッファを確保（analyser.fftSize と同じ長さ）
        const buf = new Float32Array(this.analyser.fftSize);

        // ループ関数
        const loop = () => {
            // 波形を取り出す（time domain）
            this.analyser.getFloatTimeDomainData(buf);

            // YIN に投げて F0 を得る
            const res = yin(buf, {
                threshold: this.cfg.threshold ?? 0.12,
                probabilityThreshold: this.cfg.probabilityThreshold ?? 0.1,
                sampleRate: this.ac.sampleRate,
                minFreq: this.cfg.minFreq ?? 50,
                maxFreq: this.cfg.maxFreq ?? 1200,
            });

            // EMA で平滑化（簡易）
            const smoothed = res.freqHz == null ? null : ema(this.lastEma, res.freqHz, 0.25);
            if (smoothed != null) this.lastEma = smoothed;

            // 現在の曲の時刻（再生開始からの経過 + startOffset）を計算
            const tSec = this.ac.currentTime - this.startedAt; // startedAt = ac.currentTime - startOffset → 初回は startOffset

            // コールバックにデータを渡す
            this.onData({
                tSec,
                freq: smoothed ?? res.freqHz,
                prob: res.probability,
            });

            // 次フレーム
            this.rafId = requestAnimationFrame(loop);
        };

        // ループ開始
        this.rafId = requestAnimationFrame(loop);
    }

    // 解析ループ停止
    stop() {
        if (this.rafId != null) cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
}
