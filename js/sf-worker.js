// Same-origin shell: Chrome blocks new Worker(cross-origin CDN URL).
// Main thread sets ?js=<stockfish.js> and #<wasmUrl> (SF reads hash[0] as .wasm).
const js = new URL(self.location.href).searchParams.get('js');
if (!js) throw new Error('sf-worker: missing ?js=');
importScripts(js);
