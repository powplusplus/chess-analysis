// Loads Stockfish (GPLv3, compiled to JS by Niklas Fiekas) inside this worker.
// The engine installs its own onmessage handler and speaks UCI over postMessage.
self.importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');
