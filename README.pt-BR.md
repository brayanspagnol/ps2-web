# PS2 WEB

[![Licença: BSD-2-Clause](https://img.shields.io/badge/license-BSD--2--Clause-green)](LICENSE)
![Plataforma: Web](https://img.shields.io/badge/platform-Web-blue)
![Linguagem: JavaScript](https://img.shields.io/badge/language-JavaScript-F7DF1E)

[Read in English](README.md)

Jogue PlayStation 2 no navegador, sem instalar nada.

Escolha um jogo em uma estante de capas, veja o disco entrar em um PS2 em 3D e jogue em uma TV de tubo em uma
cena de sala de estar. Por baixo roda o emulador [Play!](https://github.com/jpd002/Play-) compilado para
WebAssembly, com mudanças feitas neste projeto para rodar bem no navegador.

## Como usar

1. Abra o site em um Chrome, Edge ou Brave recente (o Firefox também funciona).
2. Clique em **Adicionar jogo** e escolha uma imagem de disco extraída do seu próprio jogo de PS2 (`.iso`, `.bin`,
   `.cso`, `.chd`, `.isz`), ou arraste o arquivo para a página.
3. Escolha o jogo na estante e aperte **Jogar**.

O jogo é lido direto do seu computador, um pedaço por vez. O arquivo nunca é enviado para lugar nenhum.
No Chrome e no Edge a estante lembra do arquivo, então da próxima vez você só confirma o acesso a ele; nos outros
navegadores, você escolhe o arquivo de novo depois de reabrir o site.

Nenhum jogo ou BIOS vem incluído ou é baixado por este projeto. Se quiser, em Configurações você pode indicar
a BIOS extraída do seu próprio console, que só serve para tocar a tela de abertura original.

## Rodando localmente

```sh
python3 serve.py 8080
```

Abra http://localhost:8080/. Imagens de disco que você colocar na pasta `games/` também aparecem na estante.
Para publicar o site, veja [DEPLOY.md](DEPLOY.md); para recompilar o emulador, veja [BUILD.md](BUILD.md).

## Repositórios relacionados

- [brayanspagnol/Play-](https://github.com/brayanspagnol/Play-): o fork do emulador. `public/emu/` é compilado
  a partir do branch `web-perf`, commit [`f35c5ea5`](https://github.com/brayanspagnol/Play-/commit/f35c5ea5a5cf95df6f61a2f5b8deb9f4bbfd3ea5).
- [brayanspagnol/Play--CodeGen](https://github.com/brayanspagnol/Play--CodeGen): o gerador de código dele

## Licença e créditos

O código do site está sob a licença BSD 2-Clause ([LICENSE](LICENSE)).
O emulador é o [Play!](https://github.com/jpd002/Play-) de Jean-Philip Desjardins (jpd002), BSD 2-Clause
([public/emu/LICENSE-Play.txt](public/emu/LICENSE-Play.txt)); a cena 3D usa [three.js](https://threejs.org/) (MIT).
Todos os componentes e recursos de terceiros estão listados em [CREDITS.md](CREDITS.md).
