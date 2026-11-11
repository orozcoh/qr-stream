/**
 * The one thing the camera reader needs from a QR library.
 *
 * Kept as an interface so this package depends on no decoder: `@orozcoh/qr-stream/browser`
 * imports nothing, and whichever decoder you wire in is the only one that ends
 * up in your bundle. The core codec and the sender need no decoder at all.
 */
export interface FrameDecoder {
  /** Resolve the QR payload bytes for this frame, or null when nothing was readable. */
  decode(image: ImageData): Promise<Uint8Array | null>;
  /** Optional teardown when the camera stops. */
  dispose?(): void;
}
