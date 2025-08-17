// --- mic.ts: モバイル配慮のgetUserMediaユーティリティ ------------------

// マイク用MediaStreamを取得
export async function getMicStream(): Promise<MediaStream> {
    // 1: iOS/Androidの自動ゲイン/ノイズ抑制は解析を乱すので極力OFFを要求
    const constraints: MediaStreamConstraints = {
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000, // 端末次第で無視されるが希望値を出す
        },
        video: false,
    };
    // 2: 権限ダイアログが出る（ユーザー操作の直後に呼ぶ）
    return navigator.mediaDevices.getUserMedia(constraints);
}

// 安全にAudioContextを作る（Safariはユーザー操作後にresume要）
export function createAudioContext(): AudioContext {
    // 1: 既に存在するならそれを使うのもアリだが、ここでは新規作成
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    // 2: iOS Safariはsuspendedで始まることが多い→UIボタンでresume()を呼ぶ
    return ac;
}
