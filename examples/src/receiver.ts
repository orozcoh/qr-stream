import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createQrStreamReader, isQrStreamError } from '@orozcoh/qr-stream';
import { readQrStream, type CameraController } from '@orozcoh/qr-stream/browser';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
import './styles.css';

const video = document.querySelector<HTMLVideoElement>('#video');
const startButton = document.querySelector<HTMLButtonElement>('#start');
const stopButton = document.querySelector<HTMLButtonElement>('#stop');
const progress = document.querySelector<HTMLParagraphElement>('#progress');
const resultText = document.querySelector<HTMLParagraphElement>('#result');
const errorText = document.querySelector<HTMLPreElement>('#error');

if (!video || !startButton || !stopButton || !progress || !resultText || !errorText) {
  throw new Error('receiver.html is missing an element');
}

const elements = { video, startButton, stopButton, progress, resultText, errorText };
const reader = createQrStreamReader();
let camera: CameraController | null = null;
let finishing = false;
let completed = false;
let downloadUrl: string | null = null;

function showError(cause: unknown): void {
  if (!cause) {
    elements.errorText.textContent = '';
    return;
  }
  elements.errorText.textContent = isQrStreamError(cause)
    ? `${cause.code}: ${cause.message} (recovery: ${cause.recovery})`
    : String(cause);
}

function stop(): void {
  camera?.stop();
  camera = null;
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
}

async function finish(): Promise<void> {
  finishing = true;
  try {
    const received = await reader.result();
    if (!received) return;
    stop();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    const blob = new Blob([received.data as BlobPart], { type: 'application/octet-stream' });
    downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = received.meta.filename;
    link.textContent = `Save ${received.meta.filename}`;
    elements.resultText.textContent = `${received.meta.filename} — SHA-256 verified. `;
    elements.resultText.append(link);
  } catch (cause) {
    showError(cause);
    stop();
  } finally {
    finishing = false;
  }
}

elements.startButton.addEventListener('click', () => {
  showError(null);
  reader.reset();
  completed = false;
  elements.resultText.textContent = '';
  elements.progress.textContent = '0 / 0 blocks';
  elements.startButton.disabled = true;
  elements.stopButton.disabled = false;

  void (async () => {
    try {
      // Imported through `?url`, so the wasm asset is emitted on this origin.
      const decode = await createZXingDecoder({ wasmUrl: zxingUrl });
      const controller = await readQrStream({ video: elements.video, decode });
      camera = controller;
      controller.onSymbol((bytes) => {
        reader.add(bytes);
        const { solved, k } = reader.progress();
        elements.progress.textContent = `${solved} / ${k} blocks`;
        if (k > 0 && solved === k && !finishing && !completed) {
          completed = true;
          void finish();
        }
      });
      controller.onError(showError);
    } catch (cause) {
      showError(cause);
      stop();
    }
  })();
});

elements.stopButton.addEventListener('click', () => {
  stop();
  reader.reset();
  completed = false;
  elements.progress.textContent = '0 / 0 blocks';
});

window.addEventListener('pagehide', () => {
  stop();
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
});
