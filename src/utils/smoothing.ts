// --- smoothing.ts: ノイズ除去/平滑化の簡易実装 -------------------------

// 単純移動中央値フィルタ（外れ値の抑制に有効）
export function medianFilter(arr: number[], win: number): number[] {
    // 1: 窓幅が奇数でなければ+1して奇数に
    const w = win % 2 === 1 ? win : win + 1;
    // 2: 半窓サイズ
    const hw = Math.floor(w / 2);
    // 3: 結果配列
    const out: number[] = [];
    // 4: 各位置 i で窓を取り中央値を計算
    for (let i = 0; i < arr.length; i++) {
        const start = Math.max(0, i - hw);
        const end = Math.min(arr.length, i + hw + 1);
        const slice = arr.slice(start, end).filter((v) => Number.isFinite(v));
        if (slice.length === 0) { out.push(NaN); continue; }
        slice.sort((a, b) => a - b);
        out.push(slice[Math.floor(slice.length / 2)]);
    }
    // 5: 平滑化結果を返す
    return out;
}

// 指数移動平均（遅延を抑えつつ滑らかに）
export function ema(prev: number | null, next: number, alpha = 0.25): number {
    // 1: 初回はそのまま
    if (prev == null || !Number.isFinite(prev)) return next;
    // 2: EMA計算
    return prev * (1 - alpha) + next * alpha;
}
