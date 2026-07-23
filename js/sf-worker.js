// Loads Stockfish (GPLv3, compiled to JS by Niklas Fiekas) inside this worker.
// Main thread prefetches the script first so this importScripts hits cache.
self.importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');
