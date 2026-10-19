# Deploying to Cloudflare Pages

The site is static: everything it needs is in `public/`. There is no build step. The headers the
emulator needs (cross-origin isolation for its threads) are in `public/_headers`, which Cloudflare
Pages applies automatically; `public/404.html` makes missing files return a real 404.

Before anything: log in to Cloudflare in your browser (account at https://dash.cloudflare.com).

## Option A: connect the GitHub repository (recommended)

Only committed files are deployed, so local files such as games, a BIOS dump or the optional boot
video can never be uploaded by mistake. The repository can stay private.

1. Cloudflare dashboard > **Workers & Pages** > **Create** > **Pages** > **Connect to Git**.
2. Authorize the Cloudflare GitHub app for `brayanspagnol/ps2-web` and select that repository.
3. Settings:
   - Project name: `ps2-web` (the site will be at `https://ps2-web.pages.dev`)
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: leave empty
   - Build output directory: `public`
4. **Save and Deploy**. Every push to `main` deploys again; other branches get preview URLs.

## Option B: upload from your computer with Wrangler

Never upload the `public/` folder of your working copy directly: it may hold files that are not in git
(`public/assets/ps2-boot.*`, `public/emu-*/` test builds). Export a clean copy of the last commit instead:

```sh
npx wrangler login                     # opens the browser to log in to Cloudflare
rm -rf /tmp/ps2-web-deploy && mkdir /tmp/ps2-web-deploy
git archive HEAD public | tar -x -C /tmp/ps2-web-deploy
npx wrangler pages project create ps2-web --production-branch main   # first time only
npx wrangler pages deploy /tmp/ps2-web-deploy/public --project-name ps2-web --branch main
```

## Check the deployment

```sh
curl -sI https://ps2-web.pages.dev/ | grep -i cross-origin
# cross-origin-embedder-policy: require-corp
# cross-origin-opener-policy: same-origin
curl -sI https://ps2-web.pages.dev/emu/Play.wasm | grep -i content-type
# content-type: application/wasm
```

Then open the site, add one of your own disc images with **Adicionar jogo** and start it. In the
browser console, `crossOriginIsolated` must be `true`.

## Custom domain (optional)

Pages project > **Custom domains** > **Set up a custom domain**. The headers in `_headers` apply there too.
