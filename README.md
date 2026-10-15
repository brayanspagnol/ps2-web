# PS2 WEB

Play PlayStation 2 games in the browser, with nothing to install.

Pick a game from a shelf of box art, watch the disc go into a 3D PS2, and play on a CRT TV in a
living-room scene. Under the hood it runs the [Play!](https://github.com/jpd002/Play-) emulator compiled
to WebAssembly, with changes made in this project to make it run well in a browser.

## Running

```sh
python3 serve.py 8080
```

Open http://localhost:8080/ and put dumps of your own discs in the `games/` folder.

## Related repositories

- [brayanspagnol/Play-](https://github.com/brayanspagnol/Play-): the emulator (branch `web-perf`)
- [brayanspagnol/Play--CodeGen](https://github.com/brayanspagnol/Play--CodeGen): its code generator

## Credits

[Play!](https://github.com/jpd002/Play-) by Jean-Philip Desjardins (BSD 2-Clause) and
[three.js](https://threejs.org/) (MIT).
