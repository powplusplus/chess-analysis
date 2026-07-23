# Game Review - chess analysis in the browser

A Chess.com-style game review: enter a username, pick a recent game, and get a
move-by-move report with Brilliant / Great / Best / Excellent / Good / Book /
Inaccuracy / Mistake / Miss / Blunder badges, per-side accuracy, an estimated
game rating, an evaluation timeline and a move list.

Stockfish runs locally in Web Workers - no server for engine analysis.
Coach Overview uses Gemma 4 31B (thinking) via the Google Generative Language API.

## Run it locally

ES modules and Web Workers need a real server (not `file://`):

    python3 -m http.server 8000
    # then open http://localhost:8000

For Coach Overview on a static server, copy the example config and paste your key:

    cp js/coach-config.example.js js/coach-config.js
    # edit GOOGLE_API_KEY inside

Or run `vercel dev` with `GOOGLE_API_KEY` in `.env` so `/api/coach` proxies the call.
## Deploy to Vercel

Option A - CLI (fastest):

    npm i -g vercel
    vercel --prod          # accept defaults; it's a static site, no build step

Option B - dashboard: vercel.com → Add New → Project → drag this folder in.

The project name decides the URL. `chess.vercel.app` and `gamereview.vercel.app`
are global names and are very likely taken; Vercel will fall back to
`<name>-<team>.vercel.app`. Try the names in this order and take the first that
sticks: chess, gamereview, chessanalysis, analysechess.

## How it works

| File | Job |
|---|---|
| `js/sf-worker.js` | one line: loads Stockfish (GPLv3 asm.js build) into a worker |
| `js/engine.js` | UCI wrapper + a 3-worker pool so positions are crunched in parallel |
| `js/classify.js` | win% model, accuracy, and the classification rules |
| `js/book.js` | small opening book for the Book badge |
| `js/chesscom.js` | public Chess.com API client |
| `js/icons.js` | the badge artwork (inline SVG) |
| `js/app.js` | board, eval bar, timeline, move list, report panel, coach wiring |
| `js/coach.js` | Coach Overview prompts + Gemma client |
| `api/coach.js` | Vercel proxy for Gemma (uses `GOOGLE_API_KEY`) |

### Classification rules

Every position gets a MultiPV-2 search. A move's cost is the drop in win
percentage compared with the engine's best move:

* **Best** - matches the engine's first choice
* **Excellent** < 2% lost · **Good** < 5% · **Inaccuracy** < 10% · **Mistake** < 20% · **Blunder** ≥ 20%
* **Miss** - you were winning (≥75%) and dropped to level or worse
* **Great** - near-best move that either swings the outcome (losing→equal or
  equal→winning, win% bands 40/60; also vs prior same-colour position) or is a
  strict only-move (MultiPV gap ≥20% and second-best still losing)
* **Brilliant** - the engine's best move that sacs a piece (≥3 material, no
  pawn gambits), holds the position, and wasn't already winning (<200 cp)
* **Book** - the game is still following a known opening line

Accuracy per move is `103.1668·e^(-0.04354·drop) − 3.1669`; the game figure blends
the arithmetic and harmonic means. Estimated rating is fitted so ~76% accuracy
lands near 900 and ~90% near 1750.

Depth is adjustable in the sidebar: Fast (10), Balanced (13), Deep (16).

## Credits

Stockfish is GPLv3; this app loads the JS build by Niklas Fiekas from jsDelivr
and does not redistribute it. Move generation is chess.js (BSD). Board colours
match Chess.com's green theme. Piece artwork under `pieces/neo/` is Chess.com's
default Neo set, cached locally for offline use. Layout and analysis code here
are original - this is not affiliated with Chess.com.
