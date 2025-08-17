// --- music.ts: 音高/時間まわりのユーティリティ -------------------------

// A4(=440Hz)を基準にHz→MIDIノート番号へ変換
export function hzToMidi(hz: number): number | null {
    // 1: 0や負値は無音扱い（変換できないのでnull）
    if (!hz || hz <= 0) return null;
    // 2: MIDI = 69 + 12 * log2(f/440)
    const midi = 69 + 12 * Math.log2(hz / 440);
    // 3: 実数で返す（四捨五入は描画側で行う）
    return midi;
}

// MIDI→Hz（逆変換）
export function midiToHz(midi: number): number {
    // 1: 440 * 2^((midi-69)/12)
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// MIDI→鍵盤名（C4=60など）
export function midiToNoteName(midi: number): string {
    // 1: 12平均律の音名配列（#はシャープ）
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    // 2: 0～127の範囲外は一旦補正
    const m = Math.round(midi);
    // 3: オクターブは C を基準に -1 から始まる慣習（MIDI 60 = C4）
    const octave = Math.floor(m / 12) - 1;
    // 4: 音名は 12 で剰余
    const name = names[(m % 12 + 12) % 12];
    // 5: "A4" のように返す
    return `${name}${octave}`;
}

// MIDI→ドレミ階名（オクターブなし）
export function midiToSolfeggio(midi: number): string {
    // 1: 日本で一般的なドレミ表記（#はシャープ）
    const names = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
    // 2: 0～127の範囲外は一旦補正
    const m = Math.round(midi);
    // 3: 音名は 12 で剰余
    return names[(m % 12 + 12) % 12];
}

// 秒→ミリ秒（描画やUIで使いやすく）
export const sec = (s: number) => s * 1000;

// ミリ秒→秒
export const ms = (msec: number) => msec / 1000;
