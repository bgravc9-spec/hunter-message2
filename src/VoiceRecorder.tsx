import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Send, X } from 'lucide-react';

export type VoicePayload = { dataUri: string; duration: number };

type Props = {
  disabled?: boolean;
  onSend: (payload: VoicePayload) => Promise<void>;
  onError: (message: string) => void;
};

const MAX_SECONDS = 20;
// Firestore stores Base64 inline. 85 KB raw audio ~113 KB Base64.
const MAX_RAW_BYTES = 85_000;
const MAX_DATA_URI_CHARS = 125_000;

function secondsText(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

function safeMime(mimeType: string): string | null {
  const t = mimeType.toLowerCase().split(';')[0].trim();
  return ['audio/webm', 'audio/ogg', 'audio/mp4'].includes(t) ? t : null;
}

function readBlob(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Ses kaydı okunamadı.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('Ses dosyasının biçimi desteklenmiyor.'));
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.readAsDataURL(blob);
  });
}

export default function VoiceRecorder({ disabled = false, onSend, onError }: Props) {
  const [phase, setPhase] = useState<'idle'|'recording'|'preview'|'sending'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const elapsedRef = useRef(0);
  const dataRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef('');
  const mountedRef = useRef(true);
  const discardRef = useRef(false);

  function releaseTracks() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }
  function releaseTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }
  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    dataRef.current = null;
    if (mountedRef.current) setAudioUrl('');
  }
  function stopRecording(discard = false) {
    discardRef.current = discard;
    releaseTimer();
    elapsedRef.current = Math.min(MAX_SECONDS, Math.max(0, (Date.now() - startedRef.current) / 1000));
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
    else releaseTracks();
    if (discard && mountedRef.current) {
      clearPreview();
      setPhase('idle');
      setSeconds(0);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      releaseTimer();
      const r = recorderRef.current;
      if (r) {
        r.onstop = null;
        r.ondataavailable = null;
        if (r.state !== 'inactive') r.stop();
      }
      releaseTracks();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function start() {
    if (disabled || phase !== 'idle') return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const message = 'Bu tarayıcıda mikrofon kaydı desteklenmiyor. Android uygulamasını veya HTTPS üzerinden Chrome kullan.';
      setError(message); onError(message); return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const type = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg']
        .find(t => MediaRecorder.isTypeSupported(t));
      const options: MediaRecorderOptions = { audioBitsPerSecond: 24000 };
      if (type) options.mimeType = type;
      const recorder = new MediaRecorder(stream, options);
      if (!safeMime(recorder.mimeType)) throw new Error('Cihazın ses kayıt biçimi desteklenmiyor.');
      recorderRef.current = recorder;
      discardRef.current = false;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        releaseTimer(); releaseTracks();
        if (mountedRef.current) { setError('Ses kaydı başarısız oldu.'); setPhase('idle'); }
      };
      recorder.onstop = () => {
        releaseTimer(); releaseTracks();
        if (!mountedRef.current || discardRef.current) return;
        const duration = Math.max(1, Math.ceil(elapsedRef.current));
        const mime = safeMime(recorder.mimeType);
        const blob = new Blob(chunks, { type: mime || recorder.mimeType });
        if (!mime || !blob.size || blob.size > MAX_RAW_BYTES) {
          setError('Ses kaydı çok büyük veya boş. Daha kısa bir kayıt dene.');
          setPhase('idle');
          return;
        }
        clearPreview();
        dataRef.current = blob;
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setAudioUrl(url);
        setSeconds(duration);
        setPhase('preview');
      };
      startedRef.current = Date.now();
      elapsedRef.current = 0;
      setSeconds(0);
      setPhase('recording');
      recorder.start(250);
      timerRef.current = setInterval(() => {
        const elapsed = Math.min(MAX_SECONDS, (Date.now() - startedRef.current) / 1000);
        elapsedRef.current = elapsed;
        if (mountedRef.current) setSeconds(Math.floor(elapsed));
        if (elapsed >= MAX_SECONDS && recorder.state !== 'inactive') stopRecording();
      }, 250);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      releaseTracks(); releaseTimer();
      const message = e instanceof Error && e.name === 'NotAllowedError'
        ? 'Mikrofon izni verilmedi. Telefon ayarlarından HUNTER MESSAGE için mikrofon iznini aç.'
        : e instanceof Error ? e.message : 'Mikrofon başlatılamadı.';
      setError(message); onError(message);
      if (mountedRef.current) setPhase('idle');
    }
  }

  async function send() {
    const blob = dataRef.current;
    if (!blob || phase !== 'preview' || disabled) return;
    const mime = safeMime(blob.type);
    if (!mime) { setError('Desteklenmeyen ses biçimi.'); return; }
    setPhase('sending'); setError('');
    try {
      const uri = await readBlob(blob, mime);
      if (uri.length > MAX_DATA_URI_CHARS) throw new Error('Ses dosyası sınırı aştı. Daha kısa bir kayıt dene.');
      await onSend({ dataUri: uri, duration: Math.max(1, Math.min(MAX_SECONDS, Math.ceil(seconds))) });
      clearPreview(); setPhase('idle'); setSeconds(0);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Ses gönderilemedi.';
      setError(message); onError(message);
      setPhase('preview'); // Keep recording so user can retry.
    }
  }

  return <div className="hm-voice-recorder">
    <button type="button" className="compose-icon" disabled={disabled || phase !== 'idle'}
      aria-label="Ses kaydet" title="Ses kaydı başlat" onClick={() => void start()}>
      <Mic size={21}/>
    </button>
    {phase !== 'idle' && <div className="hm-voice-float" role="region" aria-label="Ses kaydı">
      <div className="hm-voice-status">
        <span className={phase === 'recording' ? 'hm-record-dot' : 'hm-record-done'} />
        <strong>{phase === 'recording' ? 'Kaydediliyor' : phase === 'sending' ? 'Gönderiliyor' : 'Sesli mesaj hazır'}</strong>
        <span className="hm-voice-duration">{secondsText(seconds)} / 0:20</span>
      </div>
      {phase === 'recording' ? <div className="hm-voice-buttons">
        <button type="button" onClick={() => stopRecording(true)}><X size={17}/> İptal</button>
        <button type="button" className="hm-voice-main" onClick={() => stopRecording(false)}><Square size={15}/> Durdur</button>
      </div> : <>
        {audioUrl && <audio className="hm-voice-preview" src={audioUrl} controls preload="metadata" aria-label="Kaydettiğin sesi dinle"/>}
        <div className="hm-voice-buttons">
          <button type="button" disabled={phase === 'sending'} onClick={() => { clearPreview(); setPhase('idle'); setSeconds(0); }}><Trash2 size={17}/> Sil</button>
          <button type="button" className="hm-voice-main" disabled={phase === 'sending' || disabled} onClick={() => void send()}><Send size={16}/> Gönder</button>
        </div>
      </>}
      {error && <div className="hm-voice-error">{error}</div>}
    </div>}
    {phase === 'idle' && error && <span className="hm-voice-error-mini" role="alert" title={error}>!</span>}
  </div>;
}
