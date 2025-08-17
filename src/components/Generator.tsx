// src/components/Generator.tsx
// Generator - 音声ファイル（public配下）をブラウザでYIN解析し、Note[] JSON を生成してダウンロードする簡易ツール

import { useState } from "react";
import { yin } from "../audio/yin";
import { medianFilter } from "../utils/smoothing";
import type { Note } from "./PianoRoll";

const PARTS = ["soprano", "alto", "tenor", "bass"] as const;
type Part = typeof PARTS[number];

export default function Generator() {
    const [part, setPart] = useState<Part>("soprano");
    const [busy, setBusy] = useState(false);
    const [notes, setNotes] = useState<Note[]>([]);

    // 解析処理（public/{part}.mp3 を fetch → decode → スライド窓YIN → Note[] 生成）
    async function analyzePart() {
        setBusy(true);
        try {
            const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
            const resp = await fetch(`/${part}.mp3`);
            const arr = await resp.arrayBuffer();
            const audio = await ac.decodeAudioData(arr.slice(0));
            const ch0 = audio.getChannelData(0);
            const sr = audio.sampleRate;

            // パラメータ（FRAME/HOP）
            const FRAME_SIZE = 2048;
            const HOP = 512;
            const f0: (number | null)[] = [];
            for (let i = 0; i + FRAME_SIZE < ch0.length; i += HOP) {
                const frame = ch0.subarray(i, i + FRAME_SIZE);
                const r = yin(frame, { threshold: 0.12, probabilityThreshold: 0.1, sampleRate: sr, minFreq: 50, maxFreq: 1200 });
                f0.push(r.freqHz);
            }

            // 中央値フィルタで外れ値除去
            const f0Arr = f0.map(v => v ?? NaN);
            const f0Med = medianFilter(f0Arr, 7);

            // セグメント化（簡易、半音量子化）
            const outNotes: Note[] = [];
            const frameDur = HOP / sr;
            let curStart = -1;
            let curMidi: number | null = null;
            for (let i = 0; i < f0Med.length; i++) {
                const hz = Number.isFinite(f0Med[i]) ? f0Med[i] : null;
                const midi = hz == null ? null : (69 + 12 * Math.log2(hz / 440));
                const q = midi == null ? null : Math.round(midi);
                if (q == null) {
                    if (curMidi != null) {
                        const dur = i * frameDur - curStart;
                        if (dur >= 0.08) outNotes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
                        curMidi = null;
                        curStart = -1;
                    }
                } else {
                    if (curMidi == null) {
                        curMidi = q;
                        curStart = i * frameDur;
                    } else if (Math.abs(q - curMidi) > 0) {
                        const dur = i * frameDur - curStart;
                        if (dur >= 0.08) outNotes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
                        curMidi = q;
                        curStart = i * frameDur;
                    }
                }
            }
            if (curMidi != null) {
                const dur = f0Med.length * frameDur - curStart;
                if (dur >= 0.08) outNotes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
            }

            // 結果を state に格納
            setNotes(outNotes);

        } catch (e) {
            console.error(e);
            alert("解析エラー");
        } finally {
            setBusy(false);
        }
    }

    // 生成した notes を JSON としてダウンロードする（ブラウザ内で）
    function downloadJSON() {
        const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${part}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert(`ダウンロード完了: ${part}.json\nダウンロード後、プロジェクトの public/ フォルダに置いてください（サーバに反映されます）。`);
    }

    return (
        <div>
            <h2>譜面生成ツール（音声→JSON）</h2>
            {/*}
            <p>public フォルダにある MP3 をブラウザで解析し、Note[] の JSON を生成してダウンロードします。ダウンロードした JSON をプロジェクトの <code>public/</code> に置いてください。</p>
            */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <label>解析する音源:
                    <select value={part} onChange={(e) => setPart(e.target.value as Part)} style={{ marginLeft: 8 }}>
                        {PARTS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </label>
                <button onClick={analyzePart} disabled={busy}>解析開始</button>
                <button onClick={downloadJSON} disabled={notes.length === 0}>JSONをダウンロード</button>
            </div>
            {/*
            <div>
                <h3>解析結果サンプル（最初の20ノート）</h3>
                <pre style={{ maxHeight: 300, overflow: "auto", background: "#111", color: "white", padding: 8 }}>
                    {JSON.stringify(notes.slice(0, 20), null, 2)}
                </pre>
            </div>
            */}
        </div>
    );
}
