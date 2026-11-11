# qr-stream wire format

Version 1. Every multi-byte field is **big-endian**. Every frame is the **same
size**: the payload is zero-padded to `blockSize`, so the QR version never
changes mid-stream. A QR that changes size forces the receiving camera to
re-hunt scale and position on every frame, which costs more throughput than a
denser code ever buys back.

## Packet header — 16 bytes

| Offset | Size | Field | Type | Meaning |
|---|---|---|---|---|
| 0 | 2 | `magic` | ASCII | `QS`. Lets the reader reject foreign QR codes instantly. |
| 2 | 1 | `version` | u8 | Wire format version. Currently `1`. |
| 3 | 1 | `flags` | bits | bit0 `gzip`, bit1 `encrypted`. bits 2–7 reserved, must be 0. |
| 4 | 4 | `sessionId` | u32 | Random per transfer. The reader locks to the first one it sees. |
| 8 | 2 | `symbolIdx` | u16 | `< K` → source block, sent raw. `>= K` → repair symbol. |
| 10 | 2 | `K` | u16 | Source block count. Constant for the session. |
| 12 | 2 | `blockSize` | u16 | Bytes per block: `qrCapacity(version) − 20`. Constant for the session. |
| 14 | 2 | `payloadLen` | u16 | Always equals `blockSize`. Source blocks are zero-padded, so every frame is the same size and every symbol is XOR-compatible. |
| 16 | `blockSize` | `payload` | bytes | Block data, zero-padded to `blockSize`. |
| 16+N | 4 | `crc32` | u32 | IEEE 802.3 over bytes `0 … 16+N−1`. |

`symbolIdx` is sent as `n % 65535`, so an unbounded stream still fits the field.
By the time it wraps, the transfer has long since completed; a wrapped symbol is
simply a duplicate the reader ignores.

A frame is rejected unless the magic matches, the total length is exactly
`HEADER_SIZE + payloadLen + 4`, `payloadLen <= blockSize`, and the CRC matches.
A rejected frame is an **erasure**, which the fountain code absorbs.

## Metadata block

Carried **inside block 0**, not as a repeated beacon frame — so it costs zero
extra frames, and because block 0 is emitted first in every loop the reader has
the filename after one or two symbols.

| Size | Field | Meaning |
|---|---|---|
| u8 | `metaVersion` | `1`. |
| u8 + n | `filename` | Length-prefixed UTF-8, truncated to 64 bytes on a code-point boundary. |
| u32 | `plainLen` | Original file size. |
| u32 | `wireLen` | Compressed size, before encryption. |
| 32 | `sha256` | SHA-256 of the **original** bytes. The final correctness gate. |
| u16 + n | `salt` | PBKDF2 salt, 16 bytes. Length 0 when not encrypted. |
| u16 + n | `nonce` | AES-GCM nonce, 12 bytes. Length 0 when not encrypted. |
| u32 | `iterations` | PBKDF2 iterations (`600000`). Stored so old streams stay readable. |

The assembled payload is:

```
varint(metaLen) ‖ meta ‖ wireBytes
```

where `wireBytes` is the compressed bytes, or the ciphertext (`wireLen + 16`
bytes, the extra 16 being the GCM tag).

## Pipeline

```
JSON bytes (≤ 250 KiB)
  → gzip                     only when it shrinks the payload
  → AES-256-GCM              only when a passphrase is given
  → meta + wireBytes
  → K blocks of blockSize    zero-padded
  → systematic LT symbols    0..K−1 raw, K.. are XOR combinations
  → packet                   header ‖ payload ‖ crc32
  → QR byte mode, fixed version, ECC L
```

Decoding inverts it: CRC gate → drop bad frames → fountain → decrypt → gunzip
→ SHA-256 → hand to the caller.

Compress **before** encrypting. Ciphertext is incompressible; the other order
throws away the entire compression win.

## Capacities and presets

Byte-mode capacity at ECC L, by QR version:

| Version | 20 | 25 | 30 | 35 | 40 |
|---|---|---|---|---|---|
| Capacity | 858 | 1273 | 1732 | 2303 | 2953 |
| Block size | 838 | 1253 | 1712 | 2283 | 2933 |

| Preset | Version | Bytes/frame | Default fps | Frames for 250 KiB |
|---|---|---|---|---|
| `fast` | 20 | 838 | 15 | ~306 |
| `balanced` | 25 | 1253 | 12 | ~205 |
| `dense` | 30 | 1712 | 10 | ~150 |
| `extreme` | 40 | 2933 | 6 | ~88 |

ECC is always **L**. Every frame carries a CRC-32, so a misread frame is simply
dropped and becomes an erasure the fountain code already absorbs. Raising ECC
buys that tolerance a second time at 20–40% of the capacity.

## Fountain symbols

Symbols `< K` are systematic: a verbatim copy of one block. Symbols `>= K` are
repairs, covering a pseudorandom subset derived from
`splitmix32(sessionId ^ symbolIdx)` — nothing about the XOR set travels over the
wire, so both ends must run identical integer arithmetic. Degrees are uniform
over `1..K`; see the design document for why that was chosen by measurement.

Reliability target: reconstruction from **1.75 × K** received symbols under 30%
random erasure and 30% contiguous erasure, with at most 1 failure in 1000
trials.

## Encryption

```
key = PBKDF2-SHA256(passphrase.normalize('NFKC').trim(), salt, 600000) → AES-256-GCM
```

The whole compressed payload is encrypted once, never per block: a repair
symbol is the XOR of several ciphertext blocks, so per-block nonces would make
fountain decoding depend on decryption and deadlock. A GCM authentication
failure is reported as a wrong key, distinct from corruption.
