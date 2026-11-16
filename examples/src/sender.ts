import { createQrStreamWriter, isQrStreamError, type QrStreamWriter } from '@orozcoh/qr-stream';
import { renderQrStream, type RenderController } from '@orozcoh/qr-stream/browser';
import './styles.css';

const fileInput = document.querySelector<HTMLInputElement>('#file');
const canvas = document.querySelector<HTMLCanvasElement>('#qr');
const startButton = document.querySelector<HTMLButtonElement>('#start');
const stopButton = document.querySelector<HTMLButtonElement>('#stop');
const status = document.querySelector<HTMLParagraphElement>('#status');
const errorText = document.querySelector<HTMLPreElement>('#error');

if (!fileInput || !canvas || !startButton || !stopButton || !status || !errorText) {
  throw new Error('sender.html is missing an element');
}

const elements = { fileInput, canvas, startButton, stopButton, status, errorText };
let writer: QrStreamWriter | null = null;
let controller: RenderController | null = null;

function stop(): void {
  controller?.stop();
  controller = null;
  elements.stopButton.disabled = true;
}

function showError(cause: unknown): void {
  if (!cause) {
    elements.errorText.textContent = '';
    return;
  }
  elements.errorText.textContent = isQrStreamError(cause)
    ? `${cause.code}: ${cause.message} (recovery: ${cause.recovery})`
    : String(cause);
}

elements.fileInput.addEventListener('change', () => {
  void (async () => {
    stop();
    showError(null);
    writer = null;
    elements.startButton.disabled = true;

    const file = elements.fileInput.files?.[0];
    if (!file) return;

    elements.status.textContent = 'Preparing…';
    try {
      const created = await createQrStreamWriter(new Uint8Array(await file.arrayBuffer()), {
        filename: file.name,
        preset: 'balanced',
      });
      writer = created;
      elements.startButton.disabled = false;
      elements.status.textContent = `${created.plainBytes} bytes → ${created.wireBytes} on the wire · ${created.k} blocks · QR version ${created.version}`;
    } catch (cause) {
      elements.status.textContent = '';
      showError(cause);
    }
  })();
});

elements.startButton.addEventListener('click', () => {
  if (!writer) return;
  showError(null);
  controller?.stop();
  controller = renderQrStream({ writer, canvas: elements.canvas, size: 400 });
  controller.play();
  elements.stopButton.disabled = false;
});

elements.stopButton.addEventListener('click', stop);
window.addEventListener('pagehide', stop);
