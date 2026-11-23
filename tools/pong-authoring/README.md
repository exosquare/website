# Pong authoring check 2.2

An operator runs this checker on a machine that has Node. It reports whether literal bytes match the pinned contestant validator. It does not play a game, suggest moves, or change a number.

The primary path is local. The operator runs this command on the raw file, or on an unchanged captured reply, and returns only the format, count, and bounds fields under `forAuthor`. Hashes stay with the operator. The raw bytes and their hash stay as captured. The command never edits or synthesizes a number.

Whether the website, or a grok.com session, can execute Node is unknown. No code-execution control is assumed there. Do not depend on either one running this checker, and do not send the file to a model from this command.

Requires Node >= 24. This package has no network calls and no installed dependencies. The validator file must be the bytes whose SHA-256 is `44bc8b0170ad400c927abfda67270b300e0381bbc2dfd2d4c8be3efcbc19f414`. If that hash does not match, the command stops.

## Primary input: six flat lists

```sh
node check-authoring.mjs lists.json
node check-authoring.mjs < lists.json
```

The file is one JSON object with exactly these keys, each once. Each value is one flat array of decimal tokens, not a matrix. Key order in the file may vary. Values inside each array stay in the order written.

- `W1`: 96 numbers
- `b1`: 16 numbers
- `W2`: 256 numbers
- `b2`: 16 numbers
- `W3`: 48 numbers
- `b3`: 3 numbers The checker copies those lists, in that order, into one flat list of 435 numbers. It does not transpose, pad, shorten, round, repeat, or invent a value. A duplicate key, a nested value, or a wrong length produces no concatenated file.

Two size checks use the same bound, `length > 16384`:

- The raw file is rejected before concatenation when its byte length is greater than 16384. Those bytes are not trimmed to fit.
- The concatenated document is encoded as UTF-8 and rejected when that byte length is greater than 16384.

A length of 16384 is within the bound. 16385 is not. The number grammar is unchanged: finite decimal tokens, no exponent, at most 6 digits after the decimal point, and magnitude at most 16. The first failure stops the report.

`operator.rawInputSha256` is the raw file. `operator.derivedOfficialArtifactSha256` is the concatenated canonical document. Exit 0 means that derived document passed the pinned validator. It does not mean the raw file was already canonical, and the raw file is not replaced.

## Row input

```sh
node check-authoring.mjs --rows rows.json --write-derived derived.json
```

`--rows` is explicit. The default remains the six flat lists above. `W1` is 6 rows of 16 numbers, `W2` is 16 rows of 16, and `W3` is 16 rows of 3. `b1`, `b2`, and `b3` stay flat lists of 16, 16, and 3. Rows are already in input-major order: row order is the input order, and the checker does not transpose them.

A wrong row count, row width, ragged row, mix of rows and numbers, deeper nesting, extra key, or duplicate key is rejected. The diagnostic names the block, the row, and the expected and actual width or count. It does not suggest a replacement number. No concatenated file is produced for those structure failures.

When the shape matches, the row texts are concatenated in `W1`, `b1`, `W2`, `b2`, `W3`, `b3` order and checked with the same validator. The same two `length > 16384` checks apply to the raw file and the derived UTF-8. `rawInputSha256` and `derivedOfficialArtifactSha256` stay distinct.

`--write-derived` writes that derived text only after acceptance. The write uses exclusive creation, so an existing path is left untouched. The bytes are the UTF-8 of the concatenated tokens, not a reserialization of the numbers. The command reads those bytes back, hashes them, and checks them with the pinned validator before it reports success.

```sh
node check-authoring.mjs lists.json --write-derived derived.json
```

That second command is the flat-list adapter. It also writes only after acceptance, and only if `derived.json` does not already exist.

## Flat document

```sh
node check-authoring.mjs --canonical candidate.json
```

Use this only for a finished `{"version":"pong-feedback-v1","weights":[...]}` document. Those bytes are hashed and checked unchanged. No row-broken flat format is accepted in its place.

Exit 1 means the selected check rejected the bytes. Exit 2 means the command line or the validator file could not be used. `forAuthor` carries the format, count, and bounds result. The checker does not list later errors after the first failure.

## Proposed exchange bound

Pending review, and not enforced by this program: the initial submission plus at most two validation-only corrections, three checks in total. The returned notes are format, count, and bounds only. There is no gameplay feedback. Local repetition of the same bytes does not change them and does not contact a model.
