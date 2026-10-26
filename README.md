# PS2 WEB

Play PlayStation 2 games in the browser, with nothing to install.

Pick a game from a shelf of box art, watch the disc go into a 3D PS2, and play on a CRT TV in a
living-room scene. Under the hood it runs the [Play!](https://github.com/jpd002/Play-) emulator compiled
to WebAssembly, with changes made in this project to make it run well in a browser.

## How to use

1. Open the site in a recent Chrome, Edge or Brave (Firefox works too).
2. Click **Adicionar jogo** and pick a disc image you dumped from your own PS2 game (`.iso`, `.bin`,
   `.cso`, `.chd`, `.isz`), or drag the file onto the page.
3. Pick the game on the shelf and press **Jogar**.

The game is read straight from your computer, a piece at a time. The file is never uploaded anywhere.
In Chrome and Edge the shelf remembers the file, so next time you only confirm access to it; in other
browsers you pick the file again after reopening the site.

No games or BIOS are included in or downloaded by this project. Optionally, in Settings you can give it
the BIOS you dumped from your own console, which only plays the original startup screen.

## Running it locally

```sh
python3 serve.py 8080
```

Open http://localhost:8080/. Disc images you put in the `games/` folder also show up on the shelf.
To publish the site, see [DEPLOY.md](DEPLOY.md); to rebuild the emulator, see [BUILD.md](BUILD.md).

## Related repositories

- [brayanspagnol/Play-](https://github.com/brayanspagnol/Play-): the emulator fork. `public/emu/` is built
  from branch `web-perf`, commit [`8edc38c9`](https://github.com/brayanspagnol/Play-/commit/8edc38c999e5919b087f99e4dfadd5de7e7ffb27).
- [brayanspagnol/Play--CodeGen](https://github.com/brayanspagnol/Play--CodeGen): its code generator

## License and credits

The site code is under the BSD 2-Clause license ([LICENSE](LICENSE)).
The emulator is [Play!](https://github.com/jpd002/Play-) by Jean-Philip Desjardins (jpd002), BSD 2-Clause
([public/emu/LICENSE-Play.txt](public/emu/LICENSE-Play.txt)); the 3D scene uses [three.js](https://threejs.org/) (MIT).
Every third-party component and asset is listed in [CREDITS.md](CREDITS.md).
