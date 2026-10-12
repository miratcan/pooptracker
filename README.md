# PoopTracker

A tracker, FastTracker 2 style, where the samples are videos. Every note plays a clip, and the song comes out as a
9:16 music video (think YTPMV).

> **This is an alpha (0.0.1).** Keep your expectations low: things will break, files from today may not open
> tomorrow, and it has only been tested in Chrome. It is made for fun, not to replace your DAW.

## Try it

```
python3 -m http.server 8765
```

Open http://localhost:8765/, press Space to hear the demo beat, then drop a short video on the page to make your
own instrument. **Keys** in the header lists the shortcuts.

## Help wanted

Found a bug, got stuck, wished something worked differently? Please open an issue: reports from people actually
making music with it are the most useful thing right now. Pull requests are welcome too; start with
[CONTRIBUTING.md](CONTRIBUTING.md).

## The Zen

There is no roadmap. Requests are weighed against [The Zen of PoopTracker](docs/ZEN.md), a short list of principles:
it's for fun first, it stays simple, it does what FT2 does unless video needs otherwise, it isn't a video editor,
its files are plain text and never guess, it needs no build and no internet, and an AI over MCP can do whatever you
can do.

## License

[WTFPL](LICENSE): do what the fuck you want to.
