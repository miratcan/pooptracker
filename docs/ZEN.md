# The Zen of PoopTracker

These principles are the constitution of PoopTracker. There is no roadmap: every feature request, pull request
and design decision is checked against this list. When something conflicts with it, the Zen wins, or the Zen is
changed on purpose, in its own commit.

## Experience

* **[ZEN-JUST-PLAY]:** PoopTracker is made for fun. It doesn't compete with DAWs or solve musicians' problems; it turns clips into music videos.
* **[ZEN-INTUITIVE]:** PoopTracker stays as simple as a tracker can be, close to BeepBox. Learning happens by playing, not by reading.
* **[ZEN-FT2]:** When in doubt, PoopTracker does what FastTracker 2 does. It deviates only where video demands it (pre-roll, Sxx, Ixx).
* **[ZEN-FLAT-SCREENS]:** PoopTracker has few screens and never nests them. Each screen owns its keys.
* **[ZEN-NO-CONFIRMATION]:** PoopTracker doesn't ask "are you sure?". Everything that changes a song can be undone.

## Video

* **[ZEN-ONE-VIDEO-ONE-INSTRUMENT]:** In PoopTracker an instrument is a video. Its settings travel inside the video's metadata.
* **[ZEN-NOT-A-VIDEO-EDITOR]:** PoopTracker doesn't edit video, it takes samples from it: a piece cut out on the workbench becomes an instrument, the way a sampler takes a slice of a recording. Audio normalization on load is the other exception; color, contrast and montage belong to a video editor.
* **[ZEN-IN-SYNC]:** In PoopTracker, audio and video read the same clock and the same position. They never drift apart.

## Data

* **[ZEN-PLAIN-TEXT]:** PoopTracker songs are plain text (`song.txt`, `patterns/*.txt`) stored next to their videos. Tools come and go, lines remain.
* **[ZEN-READABLE]:** PoopTracker files remain readable by both humans and machines.
* **[ZEN-EXPLICIT]:** PoopTracker files never guess. An ambiguous value is an error that says where it is; a missing optional field gets its default.

## Tools

* **[ZEN-STANDALONE]:** PoopTracker needs no build step, no framework and no dependencies. Serve the folder, open `index.html`, and it works.
* **[ZEN-OFFLINE]:** PoopTracker doesn't require an internet connection.

## Evolution

* **[ZEN-COURAGE]:** PoopTracker doesn't cling to the past. It doesn't carry the burden of backward compatibility. Breaking changes are acceptable when documented in the CHANGELOG; stability will grow with the user base.
* **[ZEN-NO-ROADMAP]:** PoopTracker has no roadmap. Requests are filtered through this Zen and built when users need them.

## Intelligence

* **[ZEN-AI-PARITY]:** PoopTracker treats AI as a full participant, not just a reader: whatever the UI can do to a song, MCP can do too.
