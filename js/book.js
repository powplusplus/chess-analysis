// A small opening book. A move counts as "book" while the whole game so far
// is still a prefix of one of these lines. Deliberately compact: it covers the
// mainlines club players actually reach, not deep theory.

const LINES = [
  // 1.e4 e5
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O',
  'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5',
  'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 Bd3 d5 exd5 cxd5',
  'e4 e5 Nf3 Nc6 d4 exd4 Bc4 Bc5 c3 Nf6 e5 d5',
  'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6 Bg5 Bxc3',
  'e4 e5 Nf3 Nc6 c3 Nf6 d4 exd4 e5 Nd5 cxd4',
  'e4 e5 Nf3 d6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Be2 O-O',
  'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7 O-O Nc6',
  'e4 e5 Bc4 Nf6 d3 Bc5 Nf3 d6 c3 O-O O-O',
  'e4 e5 Bc4 Nf6 d3 Bc5 Nf3 Nc6 c3 d6 O-O',
  'e4 e5 Bc4 Nf6 Nf3 Nxe4 Nc3 Nxc3 dxc3 f6',
  'e4 e5 Bc4 Bc5 Nf3 Nf6 d3 d6 c3 O-O',
  'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7',
  'e4 e5 Nc3 Nc6 Bc4 Nf6 d3 Bc5 f4 d6',
  'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6',
  'e4 e5 d4 exd4 Qxd4 Nc6 Qe3 Nf6 Nc3 Bb4',
  // 1.e4 c5
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be7',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Bc4 O-O',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7',
  'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3',
  'e4 c5 c3 d5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6',
  'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6',
  'e4 c5 Bc4 e6 Nc3 Nc6 Nf3 d6 O-O',
  'e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6 c3 Nf6',
  // 1.e4 others
  'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7',
  'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7',
  'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6',
  'e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O',
  'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 Nh6',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6',
  'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4',
  'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7',
  'e4 c6 Nf3 d5 Nc3 Bg4 h3 Bxf3 Qxf3 e6',
  'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5',
  'e4 d5 exd5 Qxd5 Nc3 Qd6 d4 Nf6 Nf3 a6 g3 b5',
  'e4 d5 exd5 Nf6 d4 Nxd5 Nf3 g6 Be2 Bg7 O-O O-O',
  'e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7',
  'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6',
  'e4 g6 d4 Bg7 Nc3 d6 Nf3 Nf6 Be2 O-O O-O',
  'e4 Nc6 d4 d5 Nc3 dxe4 d5 Ne5 Qd4 Ng6',
  // 1.d4
  'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6',
  'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 Be7 e3 c6',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6',
  'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5',
  'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6',
  'd4 d5 c4 e5 dxe5 d4 Nf3 Nc6 g3 Bg4',
  'd4 d5 Nf3 Nf6 e3 e6 Bd3 c5 c3 Nc6 Nbd2 Bd6',
  'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Bd3 c5',
  'd4 d5 Nc3 Nf6 Bg5 e6 e4 dxe4 Nxe4',
  'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5',
  'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O',
  'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6',
  'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7',
  'd4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 Bxa6',
  'd4 Nf6 c4 e5 dxe5 Ng4 Nf3 Nc6 Bf4 Bb4+',
  'd4 Nf6 Nf3 e6 c4 d5 Nc3 Be7 Bg5 O-O e3 h6',
  'd4 Nf6 Nf3 g6 c4 Bg7 Nc3 d5 Qb3 dxc4 Qxc4 O-O',
  'd4 Nf6 Bg5 Ne4 Bf4 d5 e3 c5 Bd3 Nc6',
  'd4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6',
  'd4 e6 c4 f5 g3 Nf6 Bg2 Be7 Nf3 O-O',
  'd4 d6 Nf3 Nf6 c4 g6 Nc3 Bg7 e4 O-O',
  // flank
  'Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5',
  'Nf3 Nf6 c4 e6 Nc3 d5 d4 Be7 Bg5 O-O',
  'Nf3 Nf6 g3 g6 Bg2 Bg7 O-O O-O d3 d6 e4 e5',
  'c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6',
  'c4 Nf6 Nc3 e6 Nf3 d5 d4 Be7 Bf4 O-O',
  'c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7 O-O O-O',
  'c4 e6 Nc3 d5 d4 Nf6 Nf3 Be7 Bg5 O-O',
  'b3 e5 Bb2 Nc6 e3 Nf6 Bb5 Bd6',
  'g3 d5 Bg2 Nf6 Nf3 e6 O-O Be7 d3 O-O',
  'f4 d5 Nf3 Nf6 e3 g6 b3 Bg7 Bb2 O-O',
];

const TREE = new Map();
for (const line of LINES) {
  const moves = line.split(' ');
  let key = '';
  for (const m of moves) {
    key = key ? key + ' ' + m : m;
    TREE.set(key, true);
  }
}

export const MAX_BOOK_PLY = 16;

// sans: array of SAN strings played so far, including the move being tested.
export function isBookMove(sans) {
  if (sans.length > MAX_BOOK_PLY) return false;
  return TREE.has(sans.join(' '));
}
