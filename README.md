# PS2 na Sala

Jogos de PlayStation 2 rodando direto no navegador, no computador de quem joga, sem instalar nada.

Você escolhe o jogo numa estante com as capas, o disco entra num PS2 em 3D e o jogo aparece numa TV de
tubo com efeito CRT. Por baixo roda o emulador [Play!](https://github.com/jpd002/Play-) compilado para
WebAssembly, com uma série de otimizações feitas neste projeto para o navegador.

## O que tem

- **Launcher 3D** (three.js): estante de jogos com capas, modelo do PS2 fat com animação da bandeja e do
  disco, TV CRT com shader (curvatura, scanlines, máscara RGB, bloom) e modo tela cheia.
- **Biblioteca**: os jogos ficam numa pasta do servidor e são lidos aos poucos (HTTP Range), sem
  carregar a ISO inteira. O jogo é reconhecido pelo serial do disco e ganha a capa do catálogo.
- **Emulador** (fork do Play!, branch `web-perf`):
  - VU1 numa thread própria (como o MTVU do PCSX2) e chip gráfico com contexto WebGL próprio numa
    OffscreenCanvas, para usar mais de um núcleo e deixar a thread principal livre;
  - cache persistente do código compilado (o jogo abre liso da segunda vez em diante);
  - proteção de escrita em software para o código compilado (corrige jogos que carregam código novo por
    cima do antigo, como o GTA San Andreas);
  - geração de código do VU mais rápida (registradores em variáveis locais do WebAssembly);
  - áudio por AudioWorklet com time-stretching, sem cortes quando o jogo roda abaixo da velocidade cheia;
  - controle (Gamepad API com analógico), teclado e salvar/carregar estado (F5/F8).

## Situação atual

Ainda em desenvolvimento. Números num notebook com i5-13420H, no Brave:

| Jogo | Cena | Quadros por segundo |
|---|---|---|
| Final Fantasy X (NTSC) | menus / intro 3D | 60 / ~37-60 |
| GTA San Andreas (PAL) | aberturas | ~40-45 |
| GTA San Andreas (PAL) | andando pela cidade | ~28-32 (meta: 50) |

O gargalo hoje é a emulação da CPU principal do PS2 numa única thread. O plano, as medições e o que
falta estão em [ROADMAP.md](ROADMAP.md) e [OPTIMIZATION.md](OPTIMIZATION.md); as notas de cada frente de
trabalho ficam em [notes/](notes/).

## Como rodar

Requisitos: Python 3 e um navegador recente baseado em Chromium (Brave, Chrome, Edge). Firefox e Safari
ainda não foram testados.

```sh
git clone https://github.com/brayanspagnol/ps2-web.git
cd ps2-web
python3 serve.py 8080
```

Abra http://localhost:8080/ e coloque as cópias dos seus próprios discos (`.iso`, `.bin`, `.cso`, `.chd`,
`.isz` ou `.elf`) na pasta `games/`. Recarregue a página e eles aparecem na estante.

O `serve.py` envia os cabeçalhos COOP/COEP que o emulador precisa (SharedArrayBuffer para as threads).
Por isso o site só funciona em `localhost` ou em HTTPS. Para jogar de outro aparelho, use um túnel com
HTTPS (por exemplo `tailscale serve`); um endereço `http://` da rede local não funciona.

Controles no teclado: setas (direcional), Z (✕), X (◯), A (▢), S (△), Enter (Start), Backspace
(Select), 1/2 (L1/L2), 8/9 (R1/R2), F/T/G/H e J/I/K/L (analógicos). Controles USB/Bluetooth funcionam
pela Gamepad API.

## Estrutura

```
serve.py              servidor de desenvolvimento (estáticos + /games com HTTP Range)
public/index.html     o launcher
public/js/            cena 3D do console, TV CRT, biblioteca e a ponte com o emulador
public/emu/           build do emulador (Play.js + Play.wasm) usado pelo site
public/bench.html     página de medição de desempenho (save states, profiler, hashes de estado)
public/covers/        capas dos jogos do catálogo
games/                seus dumps (fora do git)
```

O código do emulador fica em repositórios separados:

- [brayanspagnol/Play-](https://github.com/brayanspagnol/Play-), branch `web-perf` (o que está publicado
  em `public/emu/`) e branches de trabalho (`ee-jit`, `vu-jit`, `mtvu`, `audio`, `site-gs`);
- [brayanspagnol/Play--CodeGen](https://github.com/brayanspagnol/Play--CodeGen), o gerador de código
  (submódulo `deps/CodeGen` do Play!).

Como compilar o emulador para WebAssembly: [BUILD.md](BUILD.md).

## Jogos e direitos autorais

Este projeto não inclui nem baixa jogos ou BIOS (o Play! não precisa de BIOS). Use apenas cópias dos
seus próprios discos. Não exponha a pasta `games/` na internet: servir as ISOs para outras pessoas é
distribuir os jogos.

As capas em `public/covers/` pertencem às respectivas editoras e estão aqui só para uso pessoal.

## Créditos

- [Play!](https://github.com/jpd002/Play-), de Jean-Philip Desjardins (licença BSD de 2 cláusulas,
  em `public/emu/LICENSE-Play.txt`)
- [three.js](https://threejs.org/) (licença MIT, em `public/vendor/LICENSE-three.txt`)
- Capas: [xlenore/ps2-covers](https://github.com/xlenore/ps2-covers)
