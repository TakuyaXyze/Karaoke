// --- yin.ts: 軽量YINの最小実装（単一フレームからF0を推定） -----------

// YINのパラメータ型
export type YinConfig = {
    threshold: number;      // 無声/有声のしきい値（デフォルト0.1～0.2）
    probabilityThreshold: number; // 検出確度のしきい値
    sampleRate: number;     // サンプリングレート
    minFreq?: number;       // 最低検出周波数（例: 50Hz）
    maxFreq?: number;       // 最高検出周波数（例: 1200Hz）
};

// YINの結果
export type YinResult = {
    freqHz: number | null;  // 推定周波数（無声はnull）
    probability: number;    // 確度（0～1）
};

// 主処理：1フレームの時系列データから周波数を推定
export function yin(frame: Float32Array, cfg: YinConfig): YinResult {
    // 1: 最小/最大ラグを周波数から計算（=速度最適化）
    const sr = cfg.sampleRate;
    const minLag = Math.floor(sr / (cfg.maxFreq ?? 1200));
    const maxLag = Math.floor(sr / (cfg.minFreq ?? 50));
    const N = Math.min(frame.length, maxLag * 2);

    // 2: 差分関数 d(τ) と累積平均正規化差関数 d'(τ) を用意
    const diff = new Float32Array(maxLag + 1);
    const cmnd = new Float32Array(maxLag + 1);

    // 3: 自己相関に似た差分を計算（YINのコア）
    for (let tau = minLag; tau <= maxLag; tau++) {
        let sum = 0;
        for (let i = 0; i + tau < N; i++) {
            const d = frame[i] - frame[i + tau];
            sum += d * d;
        }
        diff[tau] = sum;
    }

    // 4: 累積平均で正規化（小さいほど周期性が強い）
    let runningSum = 0;
    cmnd[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
        runningSum += diff[tau];
        cmnd[tau] = diff[tau] * tau / runningSum;
    }

    // 5: しきい値以下となる最初のτを探索
    let tau = -1;
    const threshold = cfg.threshold ?? 0.1;
    for (let t = minLag; t <= maxLag; t++) {
        if (cmnd[t] < threshold) { tau = t; break; }
    }
    // 6: 見つからなければ無声
    if (tau === -1) return { freqHz: null, probability: 0 };

    // 7: パラボラ補間でτを連続値へ微調整（精度↑）
    let betterTau = tau;
    if (tau + 1 <= maxLag && tau - 1 >= minLag) {
        const s0 = cmnd[tau - 1];
        const s1 = cmnd[tau];
        const s2 = cmnd[tau + 1];
        // 頂点の位置（-b/2a）に相当
        const denom = (2 * s1 - s2 - s0);
        if (denom !== 0) {
            betterTau = tau + (s2 - s0) / (2 * denom);
        }
    }

    // 8: 周波数へ変換
    const freq = sr / betterTau;

    // 9: 検出確度（簡易に 1 - cmnd[τ] を採用）
    const probability = 1 - cmnd[tau];

    // 10: 確度が低すぎれば無声扱い
    if (probability < (cfg.probabilityThreshold ?? 0.1)) {
        return { freqHz: null, probability };
    }

    // 11: 結果
    return { freqHz: freq, probability };
}
