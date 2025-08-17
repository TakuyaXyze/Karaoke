// --- PianoRoll.tsx: ピアノロール風の音程バー描画 + ライブF0オーバーレイ ---

import { useEffect, useRef } from "react";
import { midiToNoteName, hzToMidi, midiToSolfeggio } from "../utils/music";

// ノートデータ型（手動入力/抽出の両方で使う）
export type Note = {
    id: string;         // 一意ID（編集のため）
    start: number;      // 開始時刻[秒]
    duration: number;   // 長さ[秒]
    midi: number;       // 音高（MIDI実数可、表示は丸め）
};

// ライブピッチの点列（tSec, freq）を受け取り折れ線で描画
export type LivePoint = { tSec: number; freq: number | null };

type Props = {
    width: number;                 // Canvas幅[px]
    height: number;                // Canvas高[px]
    notes: Note[];                 // ノート矩形
    live: LivePoint[];             // ライブF0
    timeWindow: [number, number];  // 表示範囲（開始, 終了）秒
    playheadTime?: number | null;     // 再生ヘッド時刻（曲時刻）
    onAddNote?: (n: Note) => void; // タップ/クリックで新規ノート追加
    noteDisplayMode: 'noteName' | 'solfege';
};

export default function PianoRoll(props: Props) {
    // 1: Canvas参照
    const ref = useRef<HTMLCanvasElement | null>(null);

    // 2: 尺度（時間→X, 音高→Y）を定義
    const minMidi = 30;  // C3
    const maxMidi = 120;  // C6

    // 3: 再描画
    useEffect(() => {
        const cvs = ref.current;
        if (!cvs) return;
        const ctx = cvs.getContext("2d");
        if (!ctx) return;

        // 4: DPI対策（Retinaでもくっきり描く）
        const dpr = window.devicePixelRatio || 1;
        const W = props.width, H = props.height;
        cvs.width = Math.floor(W * dpr);
        cvs.height = Math.floor(H * dpr);
        cvs.style.width = `${W}px`;
        cvs.style.height = `${H}px`;
        ctx.scale(dpr, dpr);

        // 5: 背景
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, W, H);

        // 6: スケール関数
        const [t0, t1] = props.timeWindow;
        const tToX = (t: number) => ((t - t0) / (t1 - t0)) * W;
        const midiToY = (m: number) => {
            const p = (m - minMidi) / (maxMidi - minMidi);
            return H - p * H; // 上を高音に
        };

        // 7: ピッチグリッド（半音ごと）
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1;
        for (let m = minMidi; m <= maxMidi; m++) {
            const y = Math.floor(midiToY(m)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();

            // 8: オクターブ線は少し明るく
            if (m % 12 === 0) {
                ctx.strokeStyle = "#333";
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
                ctx.strokeStyle = "#222";
            }
        }

        // 9: ノート矩形を描く
        for (const n of props.notes) {
            // ノートが表示領域外の場合は描画スキップ
            if (n.start + n.duration < t0 || n.start > t1) continue;
            const x = tToX(n.start);
            const w = Math.max(1, tToX(n.start + n.duration) - x);
            const y = midiToY(n.midi);
            const h = Math.max(6, (H / (maxMidi - minMidi)) * 0.9); // 目視しやすく固定厚
            ctx.fillStyle = "#4cc3ff";
            ctx.fillRect(x, y - h / 2, w, h);

            // 10: ラベル（音名）
            ctx.fillStyle = "white";
            ctx.font = "10px sans-serif";
            const label = props.noteDisplayMode === 'solfege'
                ? midiToSolfeggio(n.midi)   // ドレミ表示の場合
                : midiToNoteName(n.midi);   // 音名表示の場合
            ctx.fillText(label, x + 2, y - h / 2 - 2);
        }

        // 11: ライブF0オーバーレイ（折れ線）
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ff7a90";
        ctx.beginPath();
        let started = false;
        for (const p of props.live) {
            if (p.tSec < t0 || p.tSec > t1) { started = false; continue; }; // 表示窓の外は描かない
            if (p.freq == null) { started = false; continue; }
            const m = hzToMidi(p.freq);
            if (m == null) { started = false; continue; }
            const x = tToX(p.tSec);
            const y = midiToY(m);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else { ctx.lineTo(x, y); }
        }
        ctx.stroke();

        // 再生ヘッド（playheadTime が与えられていれば縦線を描画）
        if (props.playheadTime != null) {
            const ph = props.playheadTime;
            // ヘッドが表示窓内であれば描画
            if (ph >= t0 && ph <= t1) {
                const x = tToX(ph);
                ctx.strokeStyle = "#ffea00";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, H);
                ctx.stroke();
                // ヘッド先端に小さな三角を描いて視覚強調
                ctx.fillStyle = "#ffea00";
                ctx.beginPath();
                ctx.moveTo(x + 6, 8);
                ctx.lineTo(x + 2, 0);
                ctx.lineTo(x - 2, 8);
                ctx.fill();
            }
        }

    }, [props.width, props.height, props.notes, props.live, props.timeWindow, props.playheadTime, props.noteDisplayMode]);

    // 13: タッチ/ペン/マウスに一発対応
    return (
        <canvas
            ref={ref}
            width={props.width}
            height={props.height}
            //onPointerDown={handlePointer}
            style={{ touchAction: "none", background: "#111", borderRadius: 8 }}
        />
    );
}
