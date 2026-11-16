import { useCameraReader } from '@orozcoh/qr-stream/react';

const decoder = async () => ({ decode: async () => null });

export function Camera() {
  const { videoRef, start, stop, ready, error } = useCameraReader({ createDecoder: decoder });

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" onClick={() => void start()}>
        Start
      </button>
      <button type="button" onClick={stop}>
        Stop
      </button>
      {ready ? null : <p>{error?.message}</p>}
    </div>
  );
}
