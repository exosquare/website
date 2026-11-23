# Pong authoring check

An operator runs this checker on a machine that has Node. It reports whether literal bytes match the pinned contestant validator. It does not play a game, suggest moves, or change a number.

The primary path is local. The operator runs this command on the raw file, or on an unchanged captured reply, and returns only the format, count, and bounds fields under `forAuthor`. Hashes stay with the operator. The raw bytes and their hash stay as captured. The command never edits or synthesizes a number.

Whether the website, or a grok.com session, can execute Node is unknown. No code-execution control is assumed there. Do not depend on either one running this checker, and do not send the file to a model from this command.

Requires Node >= 24. This package has no network calls and no installed dependencies. The validator file must be the bytes whose SHA-256 is `44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414`. If that hash does not match, the command stops.

## Direct check

```sh
node check-authoring.mjs candidate.json
node check-authoring.mjs < candidate.json
```

The bytes are passed through unchanged. Exit 0 means the pinned validator accepted those bytes. Exit 1 means it rejected them. Exit 2 means the command line or the validator file could not be used.

`forAuthor` contains the representation, accepted flag, byte length, scalar count, limits, and the first error. The limits are 16384 bytes, 435 scalars, magnitude 16, and at most 6 digits after the decimal point. The checker does not relax those limits and does not list later errors after the first failure.

## Six lists, recorded separately

```sh
node check-authoring.mjs --blocks blocks.json
```

This optional track expects the keys `W1`, `b1`, `W2`, `b2`, `W3`, and `b3`, with lengths 96, 16, 256, 16, 48, and 3. Each list is copied in the order given and concatenated in that key order. It is not transposed, padded, shortened, rounded, or rewritten. A duplicate key, a wrong length, or any other malformed structure is rejected and no concatenated file is produced.

When the lengths match, the concatenated text is checked with the same validator. `operator.unchangedBytesSha256` is the raw file. `operator.adaptedCanonicalSha256` is the concatenated text. Those are different tracks. Exit 0 means the concatenation passed. It does not mean the raw file was already a canonical document, and it does not replace the raw file.

## Proposed exchange bound

Pending review, and not enforced by this program: the initial submission plus at most two validation-only corrections, three checks in total. The returned notes are format, count, and bounds only. There is no gameplay feedback. Local repetition of the same bytes does not change them and does not contact a model.
