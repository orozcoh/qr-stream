import { useState } from 'react';
import zxingUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { QrStreamReceiver, QrStreamSender } from 'qr-stream/react';

type Tab = 'send' | 'receive';

export function App() {
  const [tab, setTab] = useState<Tab>('send');

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>qr-stream</h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: -8 }}>
        Airgapped JSON transfer. No network is used after install.
      </p>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'send'} onClick={() => setTab('send')}>
          Send
        </button>
        <button role="tab" aria-selected={tab === 'receive'} onClick={() => setTab('receive')}>
          Receive
        </button>
      </div>

      {tab === 'send' ? <QrStreamSender /> : <QrStreamReceiver wasmUrl={zxingUrl} />}
    </main>
  );
}
