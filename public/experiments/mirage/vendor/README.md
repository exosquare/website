# Cactus runtime 4.1.0 (browser)

Pinned from the Cactus Compute runtime repository on Hugging Face.

| File | Bytes | SHA-256 | Source |
| --- | --- | --- | --- |
| `cactus.js` | 62247 | `707341e44776ab0eb8dfc8f6a579ed5ac41e2ffc6419a18012f61619a6dfc70c` | https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.js |
| `cactus.wasm` | 1241811 | `6fb6cb41145cd51fd8af97644cd684fbdd434d4d3ce261881df58cbaef5b67f7` | https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.wasm |
| `cactus.h` | 1721 | `9be7eb25b1d89180495d04a0d2c27053f282dac85add50cacc48d73302819d9d` | https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.h |
| `LICENSE` | 11358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/LICENSE |

The same hashes are in `releases/4.1.0/manifest.json` (`source_commit` `89a1c50096bfb5b57031682d629cec95228385b9`). The repository revision that published these files is `4e822c9036be2eb0e47ef556df32a818bb1572ef`.

`cactus.js` and `cactus.wasm` are unmodified. `cactus.js` contains no hard-coded host. Its `fetch` and `XMLHttpRequest` calls are the Emscripten loader for a local `cactus.wasm`. The vision worker passes the wasm bytes in, and it refuses any URL whose origin is not this page before that file runs.

This wasm build does not reference `SharedArrayBuffer` or pthreads. It does not need cross-origin isolation headers.

The licence text shipped beside the binaries is Apache-2.0. A copy is also at `public/licenses/cactus-Apache-2.0.txt`.
