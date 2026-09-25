import { describe, expect, it } from 'vitest';
import { Game, squareAt, type Color } from './chess';
import { bestMove } from './ai';

const sq = (name: string) => squareAt(name.charCodeAt(0) - 97, Number(name[1]) - 1);

function play(game: Game, ...moves: string[]) {
  for (const san of moves) {
    const m = game.legalMoves().find((x) => x.san === san);
    if (!m) throw new Error(`illegal move ${san}`);
    game.move(m.from, m.to, m.promotion);
  }
}

function perft(game: Game, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of game.legalMoves(false)) {
    game.move(m.from, m.to, m.promotion, false);
    n += perft(game, depth - 1);
    game.undo();
  }
  return n;
}

describe('Game', () => {
  it('has 20 opening moves and matches perft(3)', () => {
    const g = new Game();
    expect(g.legalMoves()).toHaveLength(20);
    expect(perft(g, 3)).toBe(8902);
  });

  it("detects fool's mate", () => {
    const g = new Game();
    play(g, 'f3', 'e5', 'g4', 'Qh4#');
    expect(g.status()).toEqual({ kind: 'checkmate', winner: 'b' as Color });
  });

  it('supports castling on both sides', () => {
    const g = Game.fromPlacement({ e1: 'K', a1: 'R', h1: 'R', e8: 'k' });
    g.castling.wk = g.castling.wq = true;
    const sans = g.legalMoves().map((m) => m.san);
    expect(sans).toContain('O-O');
    expect(sans).toContain('O-O-O');
    play(g, 'O-O');
    expect(g.board[sq('g1')]?.type).toBe('k');
    expect(g.board[sq('f1')]?.type).toBe('r');
  });

  it('forbids castling through check', () => {
    const g = Game.fromPlacement({ e1: 'K', h1: 'R', e8: 'k', f8: 'r' });
    g.castling.wk = true;
    expect(g.legalMoves().map((m) => m.san)).not.toContain('O-O');
  });

  it('handles en passant', () => {
    const g = new Game();
    play(g, 'e4', 'a6', 'e5', 'd5', 'exd6');
    expect(g.board[sq('d5')]).toBeNull();
    expect(g.board[sq('d6')]).toEqual({ color: 'w', type: 'p' });
  });

  it('promotes pawns', () => {
    const g = Game.fromPlacement({ a7: 'P', e1: 'K', h8: 'k' });
    g.move(sq('a7'), sq('a8'), 'n');
    expect(g.board[sq('a8')]).toEqual({ color: 'w', type: 'n' });
  });

  it('detects stalemate', () => {
    const g = Game.fromPlacement({ a8: 'k', b6: 'Q', c1: 'K' }, 'b');
    expect(g.status()).toEqual({ kind: 'stalemate' });
  });

  it('undoes moves', () => {
    const g = new Game();
    play(g, 'e4', 'e5');
    g.undo();
    g.undo();
    expect(g.board).toEqual(new Game().board);
    expect(g.turn).toBe('w');
  });

  it('disambiguates SAN', () => {
    const g = Game.fromPlacement({ a1: 'R', h1: 'R', e2: 'K', e8: 'k' });
    const sans = g.legalMoves().map((m) => m.san);
    expect(sans).toContain('Rad1');
    expect(sans).toContain('Rhd1');
  });

  it('AI finds mate in one', () => {
    const g = Game.fromPlacement({ g1: 'K', a7: 'R', b3: 'R', h8: 'k' });
    const m = bestMove(g);
    expect(m?.san.endsWith('#')).toBe(true);
  });
});
