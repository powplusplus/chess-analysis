// Comprehensive opening book. Each entry pairs a line of theory (SAN, exactly
// as chess.js emits it) with its opening name. Shallow entries name the family
// as soon as it is recognisable; deeper entries refine the name and extend how
// far Book detection reaches into known mainlines.
//
// A move counts as "book" while the game so far is still a prefix of one of
// these lines. openingName() returns the most specific named line reached so
// far, so the label refines move-by-move (e.g. King's Pawn Opening -> Ruy
// Lopez -> Ruy Lopez: Morphy Defense -> Ruy Lopez: Closed) and keeps the last
// known name once play leaves theory.

const ENTRIES = [
  /* ─── generic roots ─── */
  ['e4', "King's Pawn Opening"],
  ['e4 e5', 'Open Game'],
  ['e4 e5 Nf3', "King's Knight Opening"],
  ['e4 e5 Nf3 Nc6', "King's Knight Opening: Normal Variation"],
  ['e4 e6', 'French Defense'],
  ['e4 c5', 'Sicilian Defense'],
  ['e4 c6', 'Caro-Kann Defense'],
  ['e4 d5', 'Scandinavian Defense'],
  ['e4 d6', 'Pirc Defense'],
  ['e4 g6', 'Modern Defense'],
  ['e4 Nf6', 'Alekhine Defense'],
  ['e4 Nc6', 'Nimzowitsch Defense'],
  ['d4', "Queen's Pawn Opening"],
  ['d4 d5', "Closed Game"],
  ['d4 d5 c4', "Queen's Gambit"],
  ['d4 Nf6', 'Indian Defense'],
  ['d4 f5', 'Dutch Defense'],
  ['c4', 'English Opening'],
  ['Nf3', 'Zukertort Opening'],
  ['Nf3 d5 c4', 'Reti Opening'],
  ['g3', "Hungarian Opening"],
  ['b3', 'Nimzo-Larsen Attack'],
  ['f4', "Bird's Opening"],
  ['b4', 'Sokolsky Opening'],

  /* ============================ 1.e4 e5 ============================ */
  // --- Ruy Lopez ---
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'],
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy Lopez: Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', 'Ruy Lopez: Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7', 'Ruy Lopez: Closed, Chigorin'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7', 'Ruy Lopez: Closed, Breyer'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Bb7 d4 Re8 Nbd2 Bf8', 'Ruy Lopez: Closed, Zaitsev'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6', 'Ruy Lopez: Marshall Attack'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O a4 b4 d3 d6', 'Ruy Lopez: Anti-Marshall'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4', 'Ruy Lopez: Open'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6 c3 Be7', 'Ruy Lopez: Open, Main Line'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6', 'Ruy Lopez: Berlin Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8', 'Ruy Lopez: Berlin Defense, Endgame'],
  ['e4 e5 Nf3 Nc6 Bb5 Nf6 d3 Bc5 c3 O-O O-O d6 Nbd2 a6 Ba4 Ba7', 'Ruy Lopez: Berlin, Anti-Berlin'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Bxc6', 'Ruy Lopez: Exchange Variation'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1', 'Ruy Lopez: Exchange, Main Line'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 d6 c3 Bd7 d4 Nf6 O-O Be7', 'Ruy Lopez: Steinitz Defense Deferred'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bb7 Re1 Bc5 c3 d6', 'Ruy Lopez: Archangelsk Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Bc5 c3 O-O d4 Ba7', 'Ruy Lopez: Moeller Defense'],
  ['e4 e5 Nf3 Nc6 Bb5 Nge7 Nc3 g6 d4 exd4 Nxd4 Bg7', 'Ruy Lopez: Cozio Defense'],

  // --- Italian ---
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game: Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Bb3 a6 Nbd2 Ba7', 'Italian Game: Giuoco Pianissimo'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 c3 d6 O-O O-O Re1 a5 Nbd2', 'Italian Game: Giuoco Pianissimo'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5 exd5 Nxd5', 'Italian Game: Giuoco Piano, Main Line'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4', 'Italian Game: Evans Gambit'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O Nge7', 'Italian Game: Evans Gambit'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Bc5 d4 exd4 O-O d6', 'Italian Game: Evans Gambit'],
  ['e4 e5 Nf3 Nc6 Bc4 Be7 d4 exd4 Nxd4 Nf6 Nc3 O-O', 'Italian Game: Hungarian Defense'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game: Two Knights Defense'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5 Bd6', 'Two Knights Defense: Polerio, Bogoljubov'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nd4 c3 b5 Bf1 Nxd5', 'Two Knights Defense: Fritz Variation'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 Bc5 Nxf7 Bxf2+ Kxf2 Nxe4+', 'Two Knights Defense: Traxler Counterattack'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 d4 exd4 O-O Nxe4 Re1 d5 Bxd5 Qxd5 Nc3', 'Italian Game: Scotch Gambit'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O Re1 a6 Bb3 Ba7', 'Italian Game: Giuoco Pianissimo'],

  // --- Scotch ---
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Ba6', 'Scotch Game: Mieses Variation'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7 Bc4 Ne5 Be2 Qg6', 'Scotch Game: Classical Variation'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 Bd3 d5 exd5 cxd5 O-O Be7', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Bc4', 'Scotch Gambit'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Bc4 Bc5 c3 Nf6 e5 d5 Bb5 Ne4', 'Scotch Gambit'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Bc4 Nf6 e5 d5 Bb5 Ne4 Nxd4 Bc5', 'Scotch Gambit'],

  // --- Petrov ---
  ['e4 e5 Nf3 Nf6', 'Petrov Defense'],
  ['e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6 c4 Nb4', 'Petrov Defense: Classical Attack'],
  ['e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Nc6 O-O Be7 c4 Nb4 Be2 O-O', 'Petrov Defense: Classical Attack'],
  ['e4 e5 Nf3 Nf6 d4 exd4 e5 Ne4 Qxd4 d5 exd6 Nxd6', 'Petrov Defense: Steinitz Attack'],

  // --- Four Knights ---
  ['e4 e5 Nf3 Nc6 Nc3', 'Four Knights Game'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3 bxc3 Qe7 Re1 Nd8', 'Four Knights Game: Spanish Variation'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6 d4 exd4 Nxd4 Bb4 Nxc6 bxc6 Bd3 d5', 'Four Knights Game: Scotch Variation'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Nd4 Nxd4 exd4 e5 dxc3 exf6 Qxf6', 'Four Knights Game: Rubinstein Countergambit'],

  // --- Vienna ---
  ['e4 e5 Nc3', 'Vienna Game'],
  ['e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3 f5', 'Vienna Game: Vienna Gambit'],
  ['e4 e5 Nc3 Nf6 Bc4 Nxe4 Qh5 Nd6 Bb3 Nc6 Nb5 g6', 'Vienna Game: Frankenstein-Dracula'],
  ['e4 e5 Nc3 Nc6 Bc4 Nf6 d3 Bc5 f4 d6 Nf3 O-O', 'Vienna Game'],
  ['e4 e5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 f4 exf4', 'Vienna Game'],

  // --- King's Gambit ---
  ['e4 e5 f4', "King's Gambit"],
  ['e4 e5 f4 exf4', "King's Gambit Accepted"],
  ['e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6 Bc4 d5 exd5 Bd6', "King's Gambit Accepted: Kieseritzky"],
  ['e4 e5 f4 exf4 Nf3 d5 exd5 Nf6 Bb5+ c6 dxc6 Nxc6', "King's Gambit Accepted: Modern Defense"],
  ['e4 e5 f4 exf4 Bc4 Nf6 Nc3 c6 d4 d5', "King's Gambit Accepted: Bishop's Gambit"],
  ['e4 e5 f4 Bc5 Nf3 d6 Nc3 Nf6 Bc4 Nc6', "King's Gambit Declined: Classical"],
  ['e4 e5 f4 d5 exd5 exf4 Nf3 Nf6 Bc4 Nxd5', "King's Gambit Declined: Falkbeer"],

  // --- Philidor ---
  ['e4 e5 Nf3 d6', 'Philidor Defense'],
  ['e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O O-O c5 Nf3 Nc6', 'Philidor Defense: Hanham'],
  ['e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O', 'Philidor Defense: Hanham'],
  ['e4 e5 Nf3 d6 d4 exd4 Qxd4 Nc6 Bb5 Bd7 Bxc6 Bxc6 Nc3 Nf6', 'Philidor Defense'],

  // --- Others 1.e4 e5 ---
  ['e4 e5 Nf3 Nc6 c3', 'Ponziani Opening'],
  ['e4 e5 Nf3 Nc6 c3 Nf6 d4 exd4 e5 Nd5 Qxd4 d6 exd6 Bxd6', 'Ponziani Opening'],
  ['e4 e5 d4', 'Center Game'],
  ['e4 e5 d4 exd4 Qxd4 Nc6 Qe3 Nf6 Nc3 Bb4 Bd2 O-O O-O-O Re8', 'Center Game: Paulsen Attack'],
  ['e4 e5 Bc4', "Bishop's Opening"],
  ['e4 e5 Bc4 Nf6 d3 c6 Nf3 d5 Bb3 Bd6 Nc3 dxe4', "Bishop's Opening: Berlin"],
  ['e4 e5 Bc4 Bc5 Nf3 Nf6 d3 d6 c3 O-O O-O Nc6 Bb3', "Bishop's Opening"],
  ['e4 e5 Bc4 Nf6 Nf3 Nxe4 Nc3 Nxc3 dxc3 f6 Nh4 g6', "Bishop's Opening"],

  /* ============================ 1.e4 c5 Sicilian ============================ */
  ['e4 c5 Nf3', 'Sicilian Defense'],
  ['e4 c5 Nf3 d6', 'Sicilian Defense'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', 'Sicilian Defense: Open'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'Sicilian Defense: Najdorf Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O', 'Sicilian: Najdorf, English Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be7 Qd2 O-O O-O-O Nbd7', 'Sicilian: Najdorf, English Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7', 'Sicilian: Najdorf, Main Line'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2 e5 Nb3 Be7 O-O O-O Be3 Be6', 'Sicilian: Najdorf, Opocensky'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bc4 e6 Bb3 Be7 O-O O-O', 'Sicilian: Najdorf, Fischer-Sozin'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 f3 e5 Nb3 Be6', 'Sicilian: Najdorf, English Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 h3 e5 Nde2 Be7', 'Sicilian: Najdorf, Adams Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'Sicilian Defense: Dragon Variation'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6 Bc4 Bd7 O-O-O', 'Sicilian: Dragon, Yugoslav Attack'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be2 Bg7 O-O O-O Be3 Nc6 Nb3 Be6', 'Sicilian: Dragon, Classical'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6', 'Sicilian Defense: Classical'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5 e6 Qd2 a6 O-O-O Bd7', 'Sicilian: Richter-Rauzer'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 d6 Bg5 e6 Qd2 Be7 O-O-O O-O', 'Sicilian: Richter-Rauzer'],
  ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6 Be2 Be7 O-O O-O f4 Nc6', 'Sicilian Defense: Scheveningen'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nf6 Nc3 d6 g4 h6 Be2 Nc6', 'Sicilian: Scheveningen, Keres Attack'],
  ['e4 c5 Nf3 Nc6', 'Sicilian Defense: Old Sicilian'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5', 'Sicilian Defense: Sveshnikov'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Bg5 a6 Na3 b5 Nd5 Be7', 'Sicilian: Sveshnikov, Main Line'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6 Nd5 Nxd5 exd5 Nb8', 'Sicilian: Sveshnikov'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5', 'Sicilian Defense: Kalashnikov'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5 Nb5 d6 c4 Be7 N1c3 a6 Na3 Be6', 'Sicilian: Kalashnikov Variation'],
  ['e4 c5 Nf3 e6', 'Sicilian Defense: French Variation'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6 Qd2 Nf6 O-O-O Bb4', 'Sicilian Defense: Taimanov'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nb5 d6 c4 Nf6 N1c3 a6 Na3 Be7', 'Sicilian: Taimanov, Main Line'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6', 'Sicilian Defense: Kan Variation'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7 Qe2 d6 c4 g6', 'Sicilian: Kan, Maroczy Bind'],
  ['e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Nc3 Qc7 Be2 Nf6 O-O Bb4', 'Sicilian: Kan Variation'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', 'Sicilian Defense: Accelerated Dragon'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Bc4 O-O Bb3 d6 f3 Bd7', 'Sicilian: Accelerated Dragon'],
  ['e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 c4 Nf6 Nc3 d6 Be2 Nxd4 Qxd4 Bg7', 'Sicilian: Accelerated Dragon, Maroczy Bind'],
  ['e4 c5 c3', 'Sicilian Defense: Alapin Variation'],
  ['e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6 O-O cxd4 cxd4 Be7', 'Sicilian: Alapin, 2...d5'],
  ['e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4 Nb6 Bb5 dxe5', 'Sicilian: Alapin, 2...Nf6'],
  ['e4 c5 Nc3', 'Sicilian Defense: Closed'],
  ['e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e5 Qd2 Nge7', 'Sicilian Defense: Closed'],
  ['e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 f4 d6 Nf3 e6 O-O Nge7', 'Sicilian Defense: Closed'],
  ['e4 c5 Nc3 Nc6 f4 g6 Nf3 Bg7 Bc4 e6 f5 Nge7', 'Sicilian Defense: Grand Prix Attack'],
  ['e4 c5 Nf3 Nc6 Bb5', 'Sicilian Defense: Rossolimo'],
  ['e4 c5 Nf3 Nc6 Bb5 g6 O-O Bg7 Re1 e5 Bxc6 dxc6 d3 Qe7', 'Sicilian: Rossolimo, Fianchetto'],
  ['e4 c5 Nf3 Nc6 Bb5 e6 O-O Nge7 c3 a6 Ba4 b5', 'Sicilian: Rossolimo'],
  ['e4 c5 Nf3 d6 Bb5+', 'Sicilian Defense: Moscow Variation'],
  ['e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6 c3 Nf6 Re1 e6 d4 cxd4', 'Sicilian: Moscow Variation'],
  ['e4 c5 Nf3 d6 Bb5+ Nd7 O-O Nf6 Re1 a6 Bf1 b5', 'Sicilian: Moscow Variation'],
  ['e4 c5 d4', 'Sicilian Defense: Smith-Morra Gambit'],
  ['e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O Nf6', 'Sicilian: Smith-Morra Gambit Accepted'],
  ['e4 c5 Bc4 e6 Nc3 Nc6 Nf3 d6 O-O Nf6 d3 Be7', 'Sicilian Defense: Bowdler Attack'],

  /* ============================ 1.e4 e6 French ============================ */
  ['e4 e6 d4 d5', 'French Defense'],
  ['e4 e6 d4 d5 Nc3 Bb4', 'French Defense: Winawer Variation'],
  ['e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 Nbc6', 'French: Winawer, Main Line'],
  ['e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Qc7 Qg4 f5 exf6 Nxf6', 'French: Winawer, Poisoned Pawn'],
  ['e4 e6 d4 d5 Nc3 Nf6', 'French Defense: Classical'],
  ['e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5', 'French: Classical, Steinitz'],
  ['e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 cxd4 Nxd4', 'French: Steinitz Variation'],
  ['e4 e6 d4 d5 Nd2', 'French Defense: Tarrasch Variation'],
  ['e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ne2 cxd4 cxd4 f6', 'French: Tarrasch, Closed'],
  ['e4 e6 d4 d5 Nd2 c5 exd5 Qxd5 Ngf3 cxd4 Bc4 Qd6 O-O Nf6', 'French: Tarrasch, Open'],
  ['e4 e6 d4 d5 e5', 'French Defense: Advance Variation'],
  ['e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 Nh6 b4 cxd4 cxd4 Nf5', 'French: Advance, Main Line'],
  ['e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Bd7 Be2 Nge7 Na3 cxd4', 'French: Advance Variation'],
  ['e4 e6 d4 d5 exd5', 'French Defense: Exchange Variation'],
  ['e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O Bg5 Bg4', 'French: Exchange Variation'],
  ['e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Nf3 Ngf6 Nxf6+ Nxf6 Bd3 c5', 'French Defense: Rubinstein'],

  /* ============================ 1.e4 c6 Caro-Kann ============================ */
  ['e4 c6 d4 d5', 'Caro-Kann Defense'],
  ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5', 'Caro-Kann Defense: Classical'],
  ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3', 'Caro-Kann: Classical, Main Line'],
  ['e4 c6 d4 d5 e5', 'Caro-Kann Defense: Advance Variation'],
  ['e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7', 'Caro-Kann: Advance, Short Variation'],
  ['e4 c6 d4 d5 e5 Bf5 Nc3 e6 g4 Bg6 Nge2 c5', 'Caro-Kann: Advance, Bayonet'],
  ['e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7', 'Caro-Kann Defense: Exchange'],
  ['e4 c6 d4 d5 exd5 cxd5 c4', 'Caro-Kann: Panov-Botvinnik Attack'],
  ['e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7 cxd5 Nxd5', 'Caro-Kann: Panov Attack'],
  ['e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 Nc6 Bg5 e6 Nf3 Be7', 'Caro-Kann: Panov Attack'],
  ['e4 c6 Nf3 d5 Nc3 Bg4 h3 Bxf3 Qxf3 e6 d4 dxe4 Nxe4 Nf6', 'Caro-Kann Defense: Two Knights'],
  ['e4 c6 d4 d5 f3 e6 Nc3 Bb4 Bf4 dxe4 fxe4 e5', 'Caro-Kann Defense: Fantasy Variation'],

  /* ============================ 1.e4 others ============================ */
  ['e4 d5 exd5 Qxd5', 'Scandinavian Defense: Main Line'],
  ['e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5 Bd2 e6 Qe2 Bb4', 'Scandinavian: Classical'],
  ['e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 a6 g3 b5 Bg2 Bb7', 'Scandinavian: Gubinsky-Melts'],
  ['e4 d5 exd5 Nf6', 'Scandinavian Defense: Modern'],
  ['e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7 O-O O-O Nbd2', 'Scandinavian: Modern, Gipslis'],
  ['e4 d5 exd5 Nf6 Nf3 Nxd5 d4 g6 c4 Nb6 Nc3 Bg7', 'Scandinavian: Modern'],
  ['e4 Nf6 e5 Nd5', 'Alekhine Defense'],
  ['e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7 Ng5 e6 Qf3 Qe7', 'Alekhine Defense: Modern, Main Line'],
  ['e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 exd6 cxd6 Nc3 g6 Be3 Bg7', 'Alekhine Defense: Exchange'],
  ['e4 Nf6 e5 Nd5 Nc3 Nxc3 dxc3 d6 Nf3 Nc6', 'Alekhine Defense: Two Knights'],
  ['e4 d6 d4 Nf6 Nc3 g6', 'Pirc Defense'],
  ['e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6 a4 Nbd7', 'Pirc Defense: Classical'],
  ['e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O Bd3 Na6', 'Pirc Defense: Austrian Attack'],
  ['e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5', 'Pirc Defense: 150 Attack'],
  ['e4 g6 d4 Bg7 Nc3 d6 Nf3 Nf6 Be2 O-O O-O c6 a4 Nbd7', 'Modern Defense'],
  ['e4 g6 d4 Bg7 Nc3 c6 f4 d5 e5 h5', 'Modern Defense: Gurgenidze'],
  ['e4 Nc6 d4 d5 Nc3 dxe4 d5 Ne5 Qd4 Ng6 Nxe4 Nf6', 'Nimzowitsch Defense'],

  /* ============================ 1.d4 d5 ============================ */
  ['d4 d5 c4 e6', "Queen's Gambit Declined"],
  ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7', 'QGD: Tartakower Defense'],
  ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6 Bd3 dxc4 Bxc4 Nd5', 'QGD: Orthodox Defense'],
  ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 Ne4 Bxe7 Qxe7 cxd5 Nxc3', 'QGD: Lasker Defense'],
  ['d4 d5 c4 e6 Nc3 Nf6 cxd5', 'QGD: Exchange Variation'],
  ['d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 c6 Bd3 Nbd7 Qc2 O-O', 'QGD: Exchange Variation'],
  ['d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Bf5 Qf3 Bg6', 'QGD: Exchange Variation'],
  ['d4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 e3 c6 Nf3 Qa5 Nd2 Bb4 Qc2 O-O', 'QGD: Cambridge Springs'],
  ['d4 d5 c4 e6 Nc3 Nf6 Nf3 c5 cxd5 Nxd5 e3 Nc6 Bd3 Be7', 'QGD: Semi-Tarrasch'],
  ['d4 d5 c4 e6 Nc3 c5', "Tarrasch Defense"],
  ['d4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O', 'Tarrasch Defense: Main Line'],
  ['d4 d5 c4 c6', 'Slav Defense'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O', 'Slav Defense: Czech, Main Line'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 Ne5 Nbd7 Nxc4 Qc7', 'Slav Defense: Czech Variation'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6', 'Semi-Slav Defense'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 a6', 'Semi-Slav: Meran Variation'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 h6 Bxf6 Qxf6 e3 Nd7', 'Semi-Slav: Moscow Variation'],
  ['d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 dxc4 e4 b5 e5 h6', 'Semi-Slav: Botvinnik Variation'],
  ['d4 d5 c4 c6 cxd5 cxd5 Nc3 Nf6 Nf3 Nc6 Bf4 Bf5 e3 e6', 'Slav Defense: Exchange Variation'],
  ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
  ['d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 dxc5 Qxd1 Rxd1 Bxc5', 'QGA: Classical Defense'],
  ['d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6 a4 Nc6', 'QGA: Classical Defense'],
  ['d4 d5 c4 Nc6', 'Chigorin Defense'],
  ['d4 d5 c4 Nc6 Nc3 dxc4 Nf3 Nf6 e4 Bg4 Be3 e6', 'Chigorin Defense: Main Line'],
  ['d4 d5 c4 e5', 'Albin Countergambit'],
  ['d4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Bg4 Bg2 Qd7', 'Albin Countergambit: Main Line'],
  ['d4 d5 Bf4', 'London System'],
  ['d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Bd3 c5 c3 Nc6', 'London System'],
  ['d4 d5 Nf3 Nf6 e3 e6 Bd3 c5 c3 Nc6 Nbd2 Bd6 O-O O-O', 'Colle System'],
  ['d4 d5 Nc3 Nf6 Bg5 e6 e4 dxe4 Nxe4 Be7 Bxf6 Bxf6', 'Richter-Veresov Attack'],

  /* ============================ 1.d4 Nf6 ============================ */
  ['d4 Nf6 c4', 'Indian Defense'],
  ['d4 Nf6 c4 e6', 'Indian Defense'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defense'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6 a3 Bxc3 bxc3 dxc4', 'Nimzo-Indian: Rubinstein'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7 f3 h6', 'Nimzo-Indian: Classical'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 e3 c5 Bd3 Nc6 Nf3 Bxc3+ bxc3 d6', 'Nimzo-Indian: Rubinstein, Hübner'],
  ['d4 Nf6 c4 e6 Nc3 Bb4 a3 Bxc3+ bxc3 c5 e3 Nc6 Bd3 O-O', 'Nimzo-Indian: Sämisch'],
  ['d4 Nf6 c4 e6 Nf3 b6', "Queen's Indian Defense"],
  ['d4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O Nc3 Ne4 Qc2 Nxc3', "Queen's Indian: Fianchetto"],
  ['d4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+ Bd2 Be7 Bg2 c6', "Queen's Indian: Petrosian"],
  ['d4 Nf6 c4 e6 Nf3 Bb4+ Bd2 Qe7 g3 Nc6 Bg2 Bxd2+ Nbxd2 d6', 'Bogo-Indian Defense'],
  ['d4 Nf6 c4 e6 g3', 'Catalan Opening'],
  ['d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4 Qc2 a6 Qxc4 b5', 'Catalan Opening: Closed'],
  ['d4 Nf6 c4 e6 g3 d5 Bg2 dxc4 Nf3 a6 O-O Nc6 e3 Bd7', 'Catalan Opening: Open'],
  ['d4 Nf6 c4 g6', "King's Indian Defense"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6', "King's Indian Defense: Normal"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Nd2 a5', "King's Indian: Classical, Mar del Plata"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 d5 Nbd7 Bg5 h6 Bh4 g5', "King's Indian: Petrosian"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5 d5 Nh5 Qd2 f5', "King's Indian: Sämisch"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 Nf3 O-O g3 d6 Bg2 Nbd7 O-O e5 e4 c6', "King's Indian: Fianchetto"],
  ['d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4 O-O Nf3 c5 d5 e6', "King's Indian: Four Pawns Attack"],
  ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defense'],
  ['d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Bc4 c5 Ne2 Nc6 Be3 O-O', 'Grünfeld: Exchange, Classical'],
  ['d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Nf3 c5 Rb1 O-O Be2 Nc6', 'Grünfeld: Exchange, Modern'],
  ['d4 Nf6 c4 g6 Nc3 d5 Nf3 Bg7 Qb3 dxc4 Qxc4 O-O e4 a6 Be2 b5', 'Grünfeld: Russian Variation'],
  ['d4 Nf6 c4 g6 Nc3 d5 Bf4 Bg7 e3 O-O Rc1 c5 dxc5 Be6', 'Grünfeld: Brinckmann Attack'],
  ['d4 Nf6 c4 c5', 'Benoni Defense'],
  ['d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 e4 g6 Nf3 Bg7 Be2 O-O O-O Re8', 'Modern Benoni: Classical'],
  ['d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6 Nf3 g6 g3 Bg7 Bg2 O-O', 'Modern Benoni: Fianchetto'],
  ['d4 Nf6 c4 c5 d5 b5', 'Benko Gambit'],
  ['d4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 Bxa6 Nc3 d6 e4 Bxf1 Kxf1 g6', 'Benko Gambit Accepted'],
  ['d4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 g6 Nc3 Bxa6 g3 d6 Bg2 Bg7', 'Benko Gambit: Fianchetto'],
  ['d4 Nf6 Nf3 g6 c4 Bg7 Nc3 d5 Qb3 dxc4 Qxc4 O-O e4 Bg4 Be3 Nfd7', 'Grünfeld Defense: Russian'],
  ['d4 Nf6 Nf3 e6 c4 d5 Nc3 Be7 Bg5 O-O e3 h6 Bh4 b6', "Queen's Gambit Declined"],
  ['d4 Nf6 Bg5', 'Trompowsky Attack'],
  ['d4 Nf6 Bg5 Ne4 Bf4 d5 e3 c5 Bd3 Nc6 Nf3 Qb6', 'Trompowsky Attack'],
  ['d4 Nf6 Bg5 e6 e4 h6 Bxf6 Qxf6 Nf3 d6 Nc3 g6', 'Trompowsky Attack'],
  ['d4 Nf6 Nf3 e6 Bf4 c5 e3 Nc6 Nbd2 d5 c3 Bd6 Bg3 O-O', 'London System'],

  /* ============================ 1.d4 others ============================ */
  ['d4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6 Nc3 Nc6 d5 Ne5', 'Dutch Defense: Leningrad'],
  ['d4 f5 g3 Nf6 Bg2 e6 Nf3 d5 O-O Bd6 c4 c6 Nc3 O-O', 'Dutch Defense: Stonewall'],
  ['d4 e6 c4 f5 g3 Nf6 Bg2 Be7 Nf3 O-O O-O d6 Nc3 Qe8', 'Dutch Defense: Classical'],
  ['d4 d6 Nf3 Nf6 c4 g6 Nc3 Bg7 e4 O-O Be2 e5 O-O Nc6 d5 Ne7', "King's Indian Defense"],

  /* ============================ Flank ============================ */
  ['c4 c5', 'English Opening: Symmetrical'],
  ['c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7 O-O O-O d4 cxd4 Nxd4 Nxd4 Qxd4 d6', 'English: Symmetrical, Four Knights'],
  ['c4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nf6 O-O O-O d3 d6 a3 a5', 'English: Symmetrical'],
  ['c4 e5', 'English Opening: Reversed Sicilian'],
  ['c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6 O-O Be7 d3 O-O', 'English: Reversed Dragon'],
  ['c4 e5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nge7 O-O O-O d3 d6', 'English: Reversed Sicilian'],
  ['c4 e5 Nc3 Bb4 g3 Bxc3 dxc3 Qe7 Bg2 Nf6', "English: King's English"],
  ['c4 Nf6 Nc3 e6 Nf3 d5 d4 Be7 Bg5 O-O e3 h6 Bh4 b6', "English: Anglo-Indian"],
  ['c4 e6 Nc3 d5 d4 Nf6 Nf3 Be7 Bg5 O-O e3 h6 Bh4 b6', "Queen's Gambit Declined"],
  ['c4 Nf6 Nc3 g6 e4 d6 d4 Bg7 Nf3 O-O Be2 e5', "King's Indian Defense"],
  ['Nf3 d5 c4 e6 g3 Nf6 Bg2 Be7 O-O O-O b3 c5 Bb2 Nc6', 'Reti Opening'],
  ['Nf3 d5 c4 d4 b4 g6 Bb2 Bg7 e3 c5 exd4 cxd4', 'Reti Opening: Advance'],
  ['Nf3 Nf6 c4 e6 Nc3 d5 d4 Be7 Bg5 O-O e3 h6 Bh4 b6', "Queen's Gambit Declined"],
  ['Nf3 Nf6 g3 g6 Bg2 Bg7 O-O O-O d3 d6 e4 e5 Nc3 Nc6', "King's Indian Attack"],
  ['Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b5', "King's Indian Attack"],
  ['g3 d5 Bg2 Nf6 Nf3 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6', "King's Indian Attack"],
  ['f4 d5 Nf3 Nf6 e3 g6 b3 Bg7 Bb2 O-O Be2 c5', "Bird's Opening"],
  ['f4 d5 Nf3 g6 g3 Bg7 Bg2 Nf6 O-O O-O d3 c5', "Bird's Opening: Leningrad"],
  ['b3 e5 Bb2 Nc6 e3 Nf6 Bb5 Bd6 Nf3 Qe7 c4 e4', 'Nimzo-Larsen Attack'],
  ['b3 d5 Bb2 Nf6 Nf3 e6 e3 Be7 c4 O-O Nc3 c5', 'Nimzo-Larsen Attack'],
];

// A prefix set (every position along every line) for book detection, plus a
// name map keyed by the exact move sequence. MAX_BOOK_PLY tracks the deepest
// line so isBookMove can bail early.
const PREFIXES = new Set();
const NAME_BY_KEY = new Map();
let maxPly = 0;
for (const [line, name] of ENTRIES) {
  const moves = line.split(' ');
  if (moves.length > maxPly) maxPly = moves.length;
  NAME_BY_KEY.set(line, name);
  let key = '';
  for (const m of moves) {
    key = key ? key + ' ' + m : m;
    PREFIXES.add(key);
  }
}

export const MAX_BOOK_PLY = maxPly;

// sans: array of SAN strings played so far, including the move being tested.
// A move is book when the whole sequence so far is still a known theory prefix.
export function isBookMove(sans) {
  if (!sans.length || sans.length > MAX_BOOK_PLY) return false;
  return PREFIXES.has(sans.join(' '));
}

// Most specific opening name for the line so far. Walks back from the current
// position to the longest prefix that carries a name, so the label refines as
// theory is followed and persists (last known name) once the game leaves book.
export function openingName(sans) {
  const n = Math.min(sans.length, MAX_BOOK_PLY);
  for (let i = n; i >= 1; i--) {
    const name = NAME_BY_KEY.get(sans.slice(0, i).join(' '));
    if (name) return name;
  }
  return null;
}
