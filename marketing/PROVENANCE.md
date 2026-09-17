# Asset provenance

This package was prepared on 17 September 2026 and published with the team's
new KQL Quest branding. It retains earlier prototype footage rather than
claiming to show the whole current curriculum.

| Material | Source and treatment |
|---|---|
| Cinematic art | Supplied 2752x1536 key art. The provider watermark was locally inpainted in a separate copy at the owner's request; the original file was preserved. `cinematic-art-native.png` is that edited copy, not a new original render. The 5504x3072 print variant uses 2x Lanczos interpolation. |
| Cinematic footage | Five original generated clips from the trailer-v2 production. Complete frames were fitted into the new picture area to preserve character framing. No new high-resolution footage was generated. |
| Gameplay still | `gameplay-field-native.png`, 2560x1442, captured from local prototype revision `d91d0ec9044e8bd02ba1d278cea8751f978c1159`. Integer-scale pixel rendering and a lossless PNG capture; decorative CRT scanlines disabled for clarity. |
| Query and results details | `query-editor-native.png`, 1844x342, and `query-results-native.png`, 1844x602. Real query execution in the same prototype, captured as lossless PNGs. No fictional result values were painted over the interface. |
| Platforming excerpt | 150 lossless frames of keyboard-controlled prototype gameplay. The camera crop retains the character and floor. The raw sequence stays local. |
| Narration | Main and learner use `en-US-AndrewNeural`; deadpan uses `en-US-ChristopherNeural`. Native synthesis rates, zero pitch shift, silence trimming and gain adjustment. No waveform time stretching. |
| Soundtrack | Existing trailer-v2 mixed audio, lowered and ducked under narration. It is not a newly recorded live gameplay soundtrack. |
| Typography | Press Start 2P for the lockup; Consolas for body and terminal-style copy. SVGs embed the pixel font but some editors require it installed. Consolas is not supplied as a standalone font file. |
| QR and links | Owner-supplied GitHub Pages destination, displayed as Play KQL Quest. QR codes were locally scan-tested; the site is intentionally unpublished at this handoff. |

## Scope and rights

The current publication base is `5dd641c`, which contains three selectable cases
and nine difficulty question sets. The capture revision predates that work.
The trailer does not demonstrate the current case selector, difficulty selector
or all 45 questions. The root README describes the current implementation;
marketing copy stays generic about the wider chapter structure.

Source filenames and checksums are in [manifest.json](manifest.json). Downloaded
assets can be checked against those hashes. No local machine paths, raw speech
takes or production credentials are included in the package.

This handoff does not establish a new licence for the game, fonts or artwork.
The repository's existing licensing status still applies. The team should
confirm promotional rights for supplied/generated art and watermark removal
before distributing a campaign. No human voice performance is claimed.