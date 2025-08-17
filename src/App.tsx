// --- App.tsx: アプリ本体（マイク開始/停止、ピアノロール、ファイル抽出） ----

import { useEffect, useRef, useState } from "react";
import PianoRoll from "./components/PianoRoll";
//import type PianoRoll from "./components/PianoRoll";
import type { Note } from "./components/PianoRoll";
//import FileMelodyExtractor from "./components/FileMelodyExtractor";
import { getMicStream, createAudioContext } from "./audio/mic";
import { PitchTracker } from "./audio/pitchTracker";
import type { PitchPoint } from "./audio/pitchTracker";
import Generator from "./components/Generator.tsx";

const PARTS = ["soprano", "alto", "tenor", "bass"] as const;
type Part = typeof PARTS[number];

export default function App() {
  // 1: 状態（ノート群・ライブF0・表示時間窓）
  const [notes, setNotes] = useState<Note[]>([]);
  const [live, setLive] = useState<PitchPoint[]>([]);
  const [windowSec, setWindowSec] = useState<[number, number]>([0, 10]);
  const [noteDisplayMode, setNoteDisplayMode] = useState<'noteName' | 'solfege'>('noteName');
  const [selectedPart, setSelectedPart] = useState<Part>("soprano");
  const [isPlaying, setIsPlaying] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);

  const [playheadTime, setPlayheadTime] = useState<number | null>(null);

  // 2: オーディオ／トラッカー
  const acRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const pitchTrackerRef = useRef<PitchTracker | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // 再生管理（再生が始まった時点の ac.currentTime）
  const playStartAtRef = useRef<number | null>(null);
  const playOffsetRef = useRef<number>(0); // 再生開始オフセット（秒）

  // 3: 初回レンダ時に public/ の選択中パート用 JSON を読み込む（もしくは選択時に読み込む）
  useEffect(() => {
    // 選択パートが変わるたびに該当 JSON を fetch して notes を即時更新
    async function loadPart(part: Part) {
      try {
        // public/ のパス（Vite では public 配下が静的サーブされる）
        const url = `/${part}.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("譜面JSONの取得に失敗");
        const data = await res.json();
        // data は Note[] の配列である前提（id,start,duration,midi）
        setNotes(data);
        // 表示ウィンドウを譜面の先頭に合わせる
        const maxT = data.reduce((m: number, n: Note) => Math.max(m, n.start + n.duration), 10);
        setWindowSec([0, Math.max(10, Math.min(30, maxT))]);
      } catch (e) {
        console.error(e);
        setNotes([]);
      }
    }
    loadPart(selectedPart);
  }, [selectedPart]);

  // 4: 音源バッファをプリロード（選択音源のMP3を読み込む）
  useEffect(() => {
    let cancelled = false;
    async function preloadAudio(part: Part) {
      try {
        const ac = acRef.current ?? createAudioContext();
        acRef.current = ac;
        const resp = await fetch(`/${part}.mp3`);
        const arr = await resp.arrayBuffer();
        const buf = await ac.decodeAudioData(arr.slice(0));
        if (!cancelled) bufferRef.current = buf;
      } catch (e) {
        console.warn("音源プリロード失敗", e);
      }
    }
    preloadAudio(selectedPart);
    return () => { cancelled = true; };
  }, [selectedPart]);

  // 5: 再生開始（マイク解析と同期） - offsetSeconds を与えればその時点から再生＆解析開始
  async function startPractice(offsetSeconds = 0) {
    // AudioContext を用意（ユーザー操作の直後に呼ぶ前提）
    const ac = acRef.current ?? createAudioContext();
    acRef.current = ac;
    if (ac.state === "suspended") await ac.resume();

    // 5-1: バッファがなければ再読み込み（安全措置）
    if (!bufferRef.current) {
      const resp = await fetch(`/${selectedPart}.mp3`);
      const arr = await resp.arrayBuffer();
      bufferRef.current = await ac.decodeAudioData(arr.slice(0));
    }
    // 5-2: 既存の source があれば停止して破棄
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch (_) { }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    // 5-3: 新しい AudioBufferSourceNode を作成してバッファをセット
    const source = ac.createBufferSource();
    source.buffer = bufferRef.current!;
    // 5-4: 出力を既定の destination に接続
    source.connect(ac.destination);
    // 5-5: 再生開始時刻と offset の記録（playStartAt = ac.currentTime）
    playStartAtRef.current = ac.currentTime;
    playOffsetRef.current = offsetSeconds;

    // 重要：start(when, offset) の呼び出し
    // - when: 0 で即時（currentTime と少しズレるが十分）
    // - offset: 再生開始オフセット（秒）
    source.start(0, offsetSeconds);

    // 5-6: マイク取得（すでに取っていたら再利用）
    let stream = micStreamRef.current;
    if (!stream) {
      stream = await getMicStream();
      micStreamRef.current = stream;
    }

    // 5-7: PitchTracker を生成し startOffset を渡して start()（これで tSec は曲時刻と一致）
    pitchTrackerRef.current?.stop();
    pitchTrackerRef.current = new PitchTracker(ac, stream, (p) => {
      // ライブ点を貯める（30秒分だけ保持）
      setLive(prev => {
        const next = [...prev, p].filter(x => p.tSec - x.tSec <= 30);
        return next;
      });
      /*
      // 再生ヘッド同期用にウィンドウを自動スクロール（右端追従）
      const right = Math.max(10, p.tSec);
      setWindowSec([Math.max(0, right - 10), right]);*/
    }, { minFreq: 50, maxFreq: 1200, threshold: 0.12, probabilityThreshold: 0.1 });

    // start に offset を渡す（PitchTracker 内部で startedAt = ac.currentTime - offset）
    pitchTrackerRef.current.start(offsetSeconds);

    // 5-8: 参照保持
    sourceRef.current = source;
    setIsPlaying(true);

    // 5-9: 終了時に状態を戻す処理（source.onended）
    source.onended = () => {
      setIsPlaying(false);
      // tracker を止める（録音停止はトラッカー停止と同じ）
      pitchTrackerRef.current?.stop();
      pitchTrackerRef.current = null;
      sourceRef.current = null;
      playStartAtRef.current = null;
    };
  }

  // 6: 停止
  function stopPractice() {
    // source 停止
    try { sourceRef.current?.stop(); } catch (_) { }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    // tracker 停止
    pitchTrackerRef.current?.stop();
    pitchTrackerRef.current = null;
    setIsPlaying(false);
  }

  /*
  // 7: 現在の再生ヘッド時刻（曲時刻）を計算して返す（PianoRollに渡す）
  const playheadTime = useMemo(() => {
    if (!ac) return null;
    const ac = acRef.current;
    if (playStartAtRef.current == null) return null;
    // 再生中の経過 = ac.currentTime - playStartAt
    const elapsed = ac.currentTime - playStartAtRef.current;
    // 曲時刻 = elapsed + playOffset
    return elapsed + playOffsetRef.current;
  }, [isPlaying]); // isPlaying が変わると再評価（useMemo内でac.currentTimeはリアルタイムではないので注意）
  */
  // 7: 再生状態に応じて再生ヘッドの更新と自動スクロールを行う
  useEffect(() => {
    const ac = acRef.current;
    // isPlaying が true かつ AudioContext が存在する時だけループを開始
    if (isPlaying && ac) {
      const loop = () => {
        if (playStartAtRef.current != null) {
          const elapsed = ac.currentTime - playStartAtRef.current;
          const currentPlayheadTime = elapsed + playOffsetRef.current;
          setPlayheadTime(currentPlayheadTime);

          // 再生ヘッド同期用にウィンドウを自動スクロール（右端追従）
          const right = Math.max(10, currentPlayheadTime);
          setWindowSec([Math.max(0, right - 10), right]);
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      // isPlaying が false になったらループを止めて再生ヘッドを消す
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setPlayheadTime(null);
    }

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  // 8: UI内で使う小さなヘルパ（頭出しボタン）
  const headButtons = [
    { label: "A", time: 20 },
    { label: "B", time: 51 },
    { label: "C", time: 80 },
    { label: "D", time: 111.5 },
    { label: "E", time: 125 },
    { label: "あさだ", time: 145 },
    { label: "F", time: 155 },
    { label: "G", time: 181 },
    { label: "理屈抜きの", time: 211 },
    { label: "H", time: 225 },
    { label: "H'", time: 235 },
  ];

  // 9: レイアウト描画
  const size = { w: Math.min(900, window.innerWidth - 24), h: Math.min(360, Math.floor(window.innerHeight * 0.45)) };

  // 10: 単純なページ切替：Generatorページを表示するかどうか
  if (showGenerator) {
    return (
      <div style={{ padding: 12, color: "white", background: "#0b0b0b", minHeight: "100vh" }}>
        <button onClick={() => setShowGenerator(false)} style={{ marginBottom: 8 }}>← 戻る</button>
        <Generator />
      </div>
    );
  }

  return (
    <div style={{ color: "white", background: "#0b0b0b", height: "100vh", padding: 12, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: "8px 0 4px" }}>🎤 ご健闘をお祈りしています <span style={{ fontSize: 15 }}>引退した僕の分まで頑張ってください</span></h1>
      {/*
      <p style={{ opacity: 0.8, marginTop: 0 }}>
        スマホ対応・マイク解析・ピアノロール表示・ファイルからメロディ抽出（簡易）
      </p>
      */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          パート選択:
          <select value={selectedPart} onChange={(e) => setSelectedPart(e.target.value as Part)} style={{ marginLeft: 8 }} disabled={isPlaying}>
            {PARTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>
          音階表示:
          <select value={noteDisplayMode} onChange={(e) => setNoteDisplayMode(e.target.value as 'noteName' | 'solfege')} style={{ marginLeft: 8 }} disabled={isPlaying}>
            <option value="noteName">音名 (C4)</option>
            <option value="solfege">階名 (ドレミ)</option>
          </select>
        </label>
        {/* 各パートのクイック選択ボタン */}
        {/*
        {PARTS.map(p => (
          <button key={p} onClick={() => setSelectedPart(p)} style={{ padding: "6px 8px", borderRadius: 6 }}>
            {p}
          </button>
        ))}
        */}
        {/* 練習開始 / 停止 */}
        <button onClick={() => startPractice(0)} disabled={isPlaying} style={{ padding: "8px 12px", borderRadius: 8 }}>
          練習開始（先頭から）
        </button>
        <button onClick={() => stopPractice()} disabled={!isPlaying} style={{ padding: "8px 12px", borderRadius: 8 }}>
          停止
        </button>

        {/* 頭出しボタン群 */}
        {headButtons.map(h => (
          <button key={h.label} onClick={() => {
            // 再生開始済みなら停止してから開始する（安全）
            stopPractice();
            startPractice(h.time);
            // 表示ウィンドウも指定時間にリセット
            setWindowSec([Math.max(0, h.time - 2), h.time + 8]);
          }} style={{ padding: "6px 8px", borderRadius: 6 }} disabled={isPlaying}>
            {h.label}
          </button>
        ))}

        {/* 譜面作成ページへの遷移 */}
        {/*
        <button onClick={() => setShowGenerator(true)} style={{ marginLeft: 12, padding: "6px 8px" }} disabled={isPlaying}>
          譜面作成ページへ（音声→JSONを生成）
        </button>
        */}
      </div>

      <div style={{ marginTop: 12 }}>
        {/* PianoRoll に playheadTime を渡して縦線を描画。timeWindow は state に従う */}
        {/*
        <PianoRoll width={size.w} height={size.h} notes={notes} live={live} timeWindow={windowSec} playheadTime={playheadTime ?? null} onAddNote={(n) => setNotes(prev => [...prev, n])} noteDisplayMode={noteDisplayMode} />
        */}
        <PianoRoll width={size.w} height={size.h} notes={notes} live={live} timeWindow={windowSec} playheadTime={playheadTime} onAddNote={(n) => setNotes(prev => [...prev, n])} noteDisplayMode={noteDisplayMode} />
      </div>
      <p style={{ opacity: 0.8 }}>
        選択した音源の事前解析データを読み込みます。練習開始を押すとお手本音源の再生とあなたの声のマイク解析が同期して開始します。
      </p>
      <p style={{ opacity: 0.8 }}>
        仕様上、不要な音もバーに含まれています。無視してください。音程が間違っている場合は、僕に連絡ください。
      </p>
      <p style={{ opacity: 0.8 }}>
        追加機能の要望も、同様にご連絡ください。
      </p>
    </div >
  );
}
