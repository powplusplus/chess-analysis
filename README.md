# Game Review - chess analysis in the browser

A Chess.com-style game review: enter a username, pick a recent game, and get a
move-by-move report with Brilliant / Great / Best / Excellent / Good / Book /
Inaccuracy / Mistake / Miss / Blunder badges, per-side accuracy, an estimated
game rating, an evaluation timeline and a move list.

Ongoing games show up too. Entering a username lists any games the player is
**currently** playing under "Ongoing games"; open one and it follows the game
live - new moves are pulled from Chess.com every few seconds and only the new
plies are analysed, so the board, eval bar, timeline and report stay in sync as
the game is played. When the game ends the view swaps in the final, archived
report. Chess.com's public API only exposes ongoing Daily/correspondence games,
so real-time blitz/rapid appear once they land in the archive.

Stockfish 18 runs locally in Web Workers - no server for engine analysis.
Mode picks the build: Fast (asm), Balanced (Lite ~7MB), Deep (full ~110MB).
Coach Overview uses Gemma 4 31B (thinking) via the Google Generative Language API.

## Run it locally

ES modules and Web Workers need a real server (not `file://`). Prefer
`serve.py` so COOP/COEP headers enable multi-thread Stockfish:

    python3 serve.py
    # then open http://localhost:8000

Plain `python3 -m http.server 8000` still works (single-thread fallback).

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
| `js/engine.js` | Stockfish 18 UCI wrapper + worker pool (asm / lite / full by mode) |
| `js/classify.js` | win% model, accuracy, and the classification rules |
| `js/book.js` | small opening book for the Book badge |
| `js/chesscom.js` | public Chess.com API client (archives + ongoing games) |
| `js/icons.js` | the badge artwork (inline SVG) |
| `js/app.js` | board, eval bar, timeline, move list, report panel, coach wiring |
| `js/coach.js` | Coach Overview prompts + Gemma client (batch + streaming) |
| `js/tts.js` | Gemini neural TTS client for the coach voice |
| `api/coach.js` | Vercel proxy for Gemma (uses `GOOGLE_API_KEY`) |
| `api/coach-stream.js` | streaming Gemma proxy — text arrives token-by-token so speech starts while the note is still being written |
| `api/tts.js` / `api/tts-stream.js` | Vercel proxies for Gemini TTS (batch / streaming) |

### Classification rules

Every position gets a MultiPV-2 search. A move's cost is the drop in win
percentage compared with the engine's best move:

* **Best** - matches the engine's first choice
* **Excellent** < 2% lost · **Good** < 5% · **Inaccuracy** < 10% · **Mistake** < 20% · **Blunder** ≥ 20%
* **Miss** - you were winning (≥75%) and dropped to level or worse
* **Great** - engine best that either swings outcome hard (losing→equal or
  equal→winning, win% bands 35/65, ≥12% swing; also vs prior same-colour
  position) or is a harsh only-move (MultiPV gap ≥30%, 2nd-best <28%, not
  already winning)
* **Brilliant** - engine best that sacs a piece (≥3 non-pawn, immediate or
  still down after 2 PV plies), holds/improves eval, leaves you ≥42% win,
  and wasn't already clearly better (<150 cp)
* **Book** - the game is still following a known opening line (a comprehensive
  book of theory, ~280 named lines up to 22 plies deep, covers the mainlines)

The move panel also names the opening as you step through it - the label refines
move-by-move (King's Pawn Opening → Ruy Lopez → Ruy Lopez: Morphy Defense → Ruy
Lopez: Closed) and keeps the last known name once play leaves theory.

Accuracy per move is `103.1668·e^(-0.04354·drop) − 3.1669`; the game figure blends
the arithmetic and harmonic means. Estimated rating is fitted so ~76% accuracy
lands near 900 and ~90% near 1750.

Sidebar mode (persisted in `localStorage`):

* **Fast** - Stockfish 18 asm.js, depth 10 (~10MB, weakest / broadest compat)
* **Balanced** - Stockfish 18 Lite WASM, depth 12 (~7MB)
* **Deep** - Stockfish 18 full WASM, depth 16 (~110MB NNUE)

With cross-origin isolation (Vercel / `serve.py`), Balanced and Deep use the
multi-thread builds and a pool of engines (positions in parallel). Without it,
single-thread builds still pool across positions. Engine stays warm between games.

## Credits

Stockfish is GPLv3; this app loads Nathan Rugg's Stockfish.js 18 builds from
unpkg (proxied as `/sf` when isolated) and does not redistribute them. Move generation is chess.js (BSD). Board
colours match Chess.com's green theme. Piece artwork under `pieces/neo/` is
Chess.com's default Neo set, cached locally for offline use. Layout and analysis
code here are original - this is not affiliated with Chess.com.
