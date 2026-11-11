import { useEffect, useRef, useState, type ReactNode } from 'react';
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createZXingDecoder } from '@orozcoh/qr-stream/browser/zxing';
import { QrStreamReceiver, QrStreamSender } from '@orozcoh/qr-stream/react';

// Stable identity: a new factory every render would restart the camera.
const zxingDecoder = () => createZXingDecoder({ wasmUrl: zxingUrl });

type Panel = 'send' | 'receive';

/**
 * Native `<dialog>`: focus trapping, Escape-to-close and a real backdrop come
 * with the platform, so there is no custom focus management to get wrong.
 */
function Modal({ onClose, children }: { onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="app-modal"
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog itself is a backdrop click.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="app-modal__body">{children}</div>
    </dialog>
  );
}

export function App() {
  const [panel, setPanel] = useState<Panel | null>(null);

  return (
    <main className="app">
      <div className="app__actions">
        <button type="button" className="app__button app__button--primary" onClick={() => setPanel('send')}>
          Send
        </button>
        <button type="button" className="app__button" onClick={() => setPanel('receive')}>
          Receive
        </button>
      </div>

      {/* Mounted only while open: unmounting the receiver also stops the camera. */}
      {panel === 'send' ? (
        <Modal onClose={() => setPanel(null)}>
          <QrStreamSender />
        </Modal>
      ) : null}

      {panel === 'receive' ? (
        <Modal onClose={() => setPanel(null)}>
          <QrStreamReceiver decoder={zxingDecoder} />
        </Modal>
      ) : null}
    </main>
  );
}
