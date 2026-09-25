import { Game, type Move, type PieceType } from './chess';

const VALUES: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** Material + a small centralisation bonus, from the perspective of the side to move. */
function evaluate(game: Game): number {
  let score = 0;
  game.board.forEach((p, sq) => {
    if (!p) return;
    const f = sq % 8;
    const r = Math.floor(sq / 8);
    const centre = p.type === 'k' ? 0 : 6 - (Math.abs(3.5 - f) + Math.abs(3.5 - r));
    const v = VALUES[p.type] + centre * 3;
    score += p.color === game.turn ? v : -v;
  });
  return score;
}

function negamax(game: Game, depth: number, alpha: number, beta: number): number {
  const moves = game.legalMoves(false);
  if (moves.length === 0) return game.inCheck() ? -100000 - depth : 0;
  if (depth === 0) return evaluate(game);
  // Try captures first for better pruning.
  moves.sort((a, b) => (b.captured ? VALUES[b.captured.type] : 0) - (a.captured ? VALUES[a.captured.type] : 0));
  for (const m of moves) {
    game.move(m.from, m.to, m.promotion, false);
    const score = -negamax(game, depth - 1, -beta, -alpha);
    game.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Picks a move for the side to move using a shallow alpha-beta search. */
export function bestMove(game: Game, depth = 2): Move | null {
  const moves = game.legalMoves();
  let best: Move | null = null;
  let bestScore = -Infinity;
  // Shuffle so equal-scoring moves vary between games.
  for (const m of moves.sort(() => Math.random() - 0.5)) {
    game.move(m.from, m.to, m.promotion, false);
    const score = -negamax(game, depth - 1, -Infinity, -bestScore);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
