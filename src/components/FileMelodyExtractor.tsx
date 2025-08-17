// --- FileMelodyExtractor.tsx: 音声ファイルからメロディ抽出(YIN, 簡易版) --

import React, { useState } from "react";
import { yin } from "../audio/yin";
import { medianFilter } from "../utils/smoothing";
import type { Note } from "./PianoRoll";

type Props = {
    onNotes: (notes: Note[]) => void; // 生成したノートを親へ渡す
};

// フレーム長・ホップなど（精度と速度のバランス）
const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

export default function FileMelodyExtractor({ onNotes }: Props) {
    const [busy, setBusy] = useState(false);

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            // 1: ArrayBufferへ読み込み
            const arr = await file.arrayBuffer();
            // 2: OfflineAudioContextでデコード（サンプリングレートは任せる）
            const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audio = await ac.decodeAudioData(arr.slice(0));

            // 3: モノラル化（片chを取る簡易版）
            const ch0 = audio.getChannelData(0);
            const sr = audio.sampleRate;

            // 4: 窓をスライドしながらYINでF0列を作る
            const f0: (number | null)[] = [];
            for (let i = 0; i + FRAME_SIZE < ch0.length; i += HOP_SIZE) {
                const frame = ch0.subarray(i, i + FRAME_SIZE);
                const res = yin(frame, {
                    threshold: 0.12,
                    probabilityThreshold: 0.1,
                    sampleRate: sr,
                    minFreq: 50,
                    maxFreq: 1200,
                });
                f0.push(res.freqHz);
            }

            // 5: ざっくり中央値フィルタで外れ値を除去
            const f0Arr = f0.map(v => (v ?? NaN));
            const f0Med = medianFilter(f0Arr, 7);

            // 6: セグメンテーション（隣接フレームで音高が同じ半音に収まる間は結合）
            const notes: Note[] = [];
            const frameDur = HOP_SIZE / sr;
            let curStart = 0;
            let curMidi: number | null = null;

            function hzToMidiNumber(hz: number | null): number | null {
                if (hz == null || !Number.isFinite(hz)) return null;
                return 69 + 12 * Math.log2(hz / 440);
            }

            for (let i = 0; i < f0Med.length; i++) {
                const m = hzToMidiNumber(f0Med[i]);
                const q = m == null ? null : Math.round(m); // 半音へ量子化（超簡易）
                if (q == null) {
                    // 無声に入ったら現在ノートを閉じる
                    if (curMidi != null) {
                        const dur = (i * frameDur) - curStart;
                        if (dur >= 0.08) {
                            notes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
                        }
                        curMidi = null;
                    }
                    continue;
                }
                if (curMidi == null) {
                    // 新規ノート開始
                    curMidi = q;
                    curStart = i * frameDur;
                } else if (Math.abs(q - curMidi) > 0) {
                    // 音高が変わったらノートを閉じて新規開始
                    const dur = (i * frameDur) - curStart;
                    if (dur >= 0.08) {
                        notes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
                    }
                    curMidi = q;
                    curStart = i * frameDur;
                }
            }
            // 末尾を閉じる
            if (curMidi != null) {
                const dur = (f0Med.length * frameDur) - curStart;
                if (dur >= 0.08) {
                    notes.push({ id: crypto.randomUUID(), start: curStart, duration: dur, midi: curMidi });
                }
            }

            // 7: 親へ渡す
            onNotes(notes);
        } finally {
            setBusy(false);
        }
    }

    return (
        <label style={{ display: "inline-block", padding: 8, border: "1px solid #444", borderRadius: 8, cursor: "pointer" }}>
            {busy ? "抽出中..." : "音声ファイルを選択 (MP3/WAV)"}
            <input type="file" accept="audio/*" style={{ display: "none" }} onChange={handleFile} />
        </label>
    );
}
