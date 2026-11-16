# Performance

Reproducible benchmarks for the writer, fountain codec, renderer, reader, and
the ZXing WebAssembly decoder, with absolute budgets enforced in CI.

The point of this page is to publish real numbers and to make a regression
visible. It is not a claim that these numbers transfer unchanged to every
phone, browser, or CI runner — the caveats at the end matter.

## Running the benchmarks

```sh
pnpm bench           # run everything, write bench/results.json
pnpm bench:check     # run, then enforce bench/budgets.json (what CI runs)
pnpm bench:compare   # run, then diff against bench/baseline.json (20% guardrail)
pnpm bench:baseline  # run, then replace bench/baseline.json
```

Benchmarks run on Node through `tsx`; no build step is required because they
import `src/` directly. The scripts pass `--expose-gc` so the approximate
memory measurements get a forced collection on either side.

`bench/results.json` is generated and ignored by git. `bench/baseline.json` is
committed so a local run has something to compare against.

## Baseline

Recorded **2026-11-16** on:

| | |
| --- | --- |
| Machine | MacBook Air (Apple M1, 8 cores: 4 performance + 4 efficiency) |
| Memory | 8 GB |
| OS | macOS 26.5.2 (25F84) |
| Node | v25.6.1 |
| pnpm | 11.18.0 |
| Compiler | no build step (`tsx` on the TypeScript sources) |

CI enforces the same budgets on `ubuntu-latest` with Node 22. Time ceilings
are typically 3–7× these numbers (looser for sub-millisecond and startup
metrics), so the shared runner can be several times slower before a ceiling
trips. The deterministic `rgbaBufferKiB` entry guards the returned image size;
`paintAllocKiB` is a measured per-frame ArrayBuffer delta; `frameBytesKiB` is a
constructor-counted per-frame allocation total that catches a second buffer
even when V8 reclaims it; `symbolsToComplete` guards fountain overhead. Those
four are deliberately tighter than the wall-clock ceilings.

| Metric | Unit | Baseline (mean) | Budget |
| --- | --- | ---: | ---: |
| `writer.json.plain` | ms | 6.71 | ≤ 40 |
| `writer.random.plain` | ms | 21.1 | ≤ 90 |
| `writer.random.encodeRepair` | ms | 0.093 | ≤ 2 |
| `writer.json.encrypted` | ms | 77.8 | ≤ 250 |
| `writer.random.encrypted` | ms | 92.5 | ≤ 300 |
| `writer.random.plain.heap` | MiB | ~1.85 (approx) | ≤ 24 |
| `writer.random.encrypted.heap` | MiB | ~2.00 (approx) | ≤ 32 |
| `fountain.stream.decode` | ms | 967 | ≤ 4000 |
| `fountain.stream.assemble` | ms | 0.166 | ≤ 5 |
| `fountain.stream.symbolsToComplete` | packets | 1254 | ≤ 1600 |
| `render.v20.packetToMatrix` | ms | 12.7 | ≤ 60 |
| `render.v40.packetToMatrix` | ms | 40.9 | ≤ 180 |
| `render.v20.matrixToRGBA` | ms | 0.124 | ≤ 3 |
| `render.v40.matrixToRGBA` | ms | 0.469 | ≤ 8 |
| `render.v20.paintFrame` | ms | 13.1 | ≤ 60 |
| `render.v40.paintFrame` | ms | 40.2 | ≤ 180 |
| `render.v20.sustainedFps` | fps | 76.2 | ≥ 15 |
| `render.v40.sustainedFps` | fps | 24.9 | ≥ 6 |
| `render.v40.rgbaBufferKiB` | KiB | 133.69 | ≤ 140 |
| `render.v40.paintAllocKiB` | KiB | 133.69 | ≤ 150 |
| `render.v40.frameBytesKiB` | KiB | 133.69 | ≤ 180 |
| `reader.stream.add` | ms | 964 | ≤ 4000 |
| `reader.stream.reassemble` | ms | 1004 | ≤ 4200 |
| `reader.frame.add` | ms | 0.768 | ≤ 4 |
| `reader.zxing.startup` | ms | 8.98 | ≤ 500 |
| `reader.zxing.720p.v20` | ms | 5.49 | ≤ 40 |
| `reader.zxing.720p.v40` | ms | 7.01 | ≤ 50 |
| `reader.zxing.1080p.v40` | ms | 14.2 | ≤ 80 |

Every number is the mean of a timed sample set except the memory entries (one
approximate sample), the derived `fps` and `frame.add` entries, the
single-sample `KiB` measurements, and the deterministic packet count. `p50`/`p99` and the relative margin of error are in `bench/results.json`.

## What the numbers mean

### Sender

Preparing a 1 MiB payload is a one-time cost. Plain text-like data costs about
6 ms; incompressible data costs about 21 ms because the gzip attempt, SHA-256,
and the block split all run over the full MiB. Encryption adds roughly 70 ms,
almost entirely PBKDF2 at the library's fixed 600,000 iterations. That is a
deliberate key-stretching cost, not an implementation accident: lowering it
would change the security posture of every encrypted transfer, so it is not a
benchmark target to "optimize away."

The expensive half of frame generation is a repair symbol, which XORs a
pseudorandom subset of the source blocks. At the `fast` preset that is about
0.09 ms per repair symbol on this machine; systematic symbols are a memcpy.

### Renderer

`packetToMatrix` dominates a painted frame, not `matrixToRGBA`:

- v20: about 12.7 ms matrix encoding + 0.12 ms RGBA expansion, about 13 ms per painted frame.
- v40: about 40.9 ms matrix encoding + 0.47 ms RGBA expansion, about 40 ms per painted frame.

That is about 20% of the v20 frame interval at the `fast` preset (15 fps,
66.7 ms) and about 24% of the v40 interval at `extreme` (6 fps, 166.7 ms).
There is no per-frame allocation problem to fix, and this is now measured
three ways rather than recomputed from the QR version:

- `rgbaBufferKiB` reads `matrixToRGBA(matrix, 1).data.byteLength` from a real
  call: 133.69 KiB.
- `paintAllocKiB` retains each painted frame's buffer and reads
  `process.memoryUsage().arrayBuffers` across 16 frames: 133.69 KiB/frame, one
  buffer per frame. V8 can reclaim a short-lived second buffer between frames,
  so this delta is a lower bound on a discarded allocation; its ceiling is
  150 KiB.
- `frameBytesKiB` swaps `Uint8ClampedArray` for a counting subclass during the
  synchronous paint and counts every allocated byte regardless of collection:
  133.69 KiB/frame. A second 133.69 KiB buffer would read 267.38 and trip the
  180 KiB ceiling; an injected discarded buffer was verified to do exactly
  that during review.

The GC handles 133.69 KiB per frame comfortably at 6 fps. The remaining cost is
`qrcode-generator` choosing among its eight masks; it is not a per-frame
allocation we can reuse away.

The `paintFrame` probe runs the real `renderQrStream` loop against a stub
canvas, so it covers matrix construction, RGBA expansion, the `ImageData`
wrapper, and the `drawImage` call. It does **not** include the browser's raster
or compositing work; real paint cost is higher, and that is why the budget is
an upper bound rather than a promise.

### Receiver

Every accepted frame costs about 0.77 ms in the core reader (CRC, plausibility
checks, and fountain peeling/elimination), which is about 1.2% of the 66.7 ms
frame interval at 15 fps. Even the pathological full-stream figure is modest:
a lossy 1 MiB transfer needs 1254 accepted packets and about 0.97 s of CPU
spread over roughly 100 seconds of scanning.

ZXing on a synthetic 720p frame costs 5.5–7.0 ms; at 1080p it is 14.2 ms. A
6 fps `extreme` transfer allows 166.7 ms per frame, so camera decode is not the
bottleneck on this machine. The wasm startup measured here (5–9 ms across runs) excludes
the network fetch a browser performs on first load.

### Bundle size

Bundle size is not part of this harness; `pnpm check:size` already gates gzip
size per entry point in CI.

## Method

### Harness

- [tinybench](https://github.com/tinylibs/tinybench) runs warmup and then a time
  budget per task. Slow tasks (a full 1 MiB decode) use a smaller iteration
  floor so a benchmark run stays around two minutes.
- Fixtures are deterministic. Incompressible bytes come from the project's
  `splitmix32` PRNG, and the compressible payload is repeated JSON truncated to
  exactly 1 MiB. Every run therefore compresses and encodes the same bytes.
- The writer benchmarks measure `createQrStreamWriter`, i.e. gzip, SHA-256,
  key derivation, encryption, and the block split. Packet generation is
  measured separately as `writer.random.encodeRepair`.
- The fountain/reader fixture is lossy on purpose: every fourth systematic
  frame is dropped and repair symbols fill the gaps until the decoder closes.
  Feeding all *k* systematic symbols would measure the trivial copy path and
  hide the peeling/Gaussian-elimination cost that dominates a real camera
  transfer.
- The renderer uses the same fake canvas shape as `tests/render.test.ts`: a
  no-op 2D context, a stub `ImageData`, a stub `requestAnimationFrame`, and a
  parent width of 512 CSS px. The measured region is the synchronous paint.
- ZXing's browser loader cannot fetch its wasm URL in Node, so the benchmark
  reads `zxing_reader.wasm` from disk and passes it as `wasmBinary` through
  `prepareZXingModule`. The same `readBarcodes` function the browser decoder
  uses is then measured.

### Memory

Memory entries combine `process.memoryUsage().heapUsed` and `arrayBuffers`
before and after one full operation, with a forced GC on each side when
`--expose-gc` is available. The writer object is kept alive during the
measurement, and the reported number is the smallest of several rounds; later
rounds sometimes include transient compression buffers that V8 has not
reclaimed yet.

This is an approximation, not a heap profile. It is useful for catching a
runaway allocation or a leak, which is why the ceilings are at least an order
of magnitude above the baseline.

### Budgets versus the 20% guardrail

- **CI** enforces absolute ceilings in `bench/budgets.json`. A shared
  `ubuntu-latest` runner can easily be 2× slower than this M1, so a same-machine
  percentage would be flaky.
- **Local** `pnpm bench:compare` reports the delta against
  `bench/baseline.json` and exits non-zero when a time metric is more than 20%
  slower. Memory and derived metrics are printed as information only; they are
  too noisy to police at 20%.
- When an intentional change moves a number, update the baseline with
  `pnpm bench:baseline` and explain the change in the commit. Only raise a
  ceiling when the new cost is understood — a ceiling that drifts upward every
  release stops being a gate.

## Caveats

- **Node is not a browser.** The JavaScript hot paths are the same V8 code, but
  Node has no canvas rasterisation, compositing, GPU upload, camera capture, or
  `getImageData` copy. The camera path (including `getImageData` at up to
  1280 px wide and the real decoder wiring) is covered by the Playwright camera
  spec, not by these numbers.
- **Crypto implementations differ.** Node uses OpenSSL for Web Crypto; browsers
  use their own implementations. The PBKDF2/AES-GCM split between plain and
  encrypted prepares should be similar in direction, not identical in
  milliseconds.
- **Memory is approximate.** See above. Large negative or unexpectedly small
  deltas mean V8 reclaimed a transient before the second reading, not that the
  writer stopped allocating. The render allocation probe avoids that by
  retaining each painted frame's buffer for the duration of a round; without
  `--expose-gc` it is marked approximate in `bench/results.json`.
- **Hardware variance.** These are one Apple M1 laptop's numbers. CI budgets
  intentionally leave a 3–7× margin; a desktop x86 runner may be faster or
  slower than this machine at any individual metric.
- **React progress updates are not benchmarked.** `useQrStreamReader` calls
  `setProgress` for every accepted frame, which re-renders the reader subtree at
  camera rate. It was not a measured budget miss, and a jsdom harness would not
  represent real browser rendering. If profiling ever shows it, the follow-up
  is to throttle the progress state to animation-frame rate or compare values
  before calling `setProgress`; do that against a measurement, not a guess.
- **ZXing startup excludes the network.** The 5–9 ms is wasm compilation from a
  local binary. On a cold browser load the fetch and compile are additional and
  depend on hosting and cache headers.
