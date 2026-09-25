export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  color: Color;
  type: PieceType;
}

export interface Move {
  from: number;
  to: number;
  piece: Piece;
  captured?: Piece;
  promotion?: PieceType;
  enPassant?: boolean;
  castle?: 'k' | 'q';
  san: string;
}

export type GameStatus =
  | { kind: 'playing'; check: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'stalemate' }
  | { kind: 'draw'; reason: 'fifty-move' | 'insufficient-material' };

interface CastlingRights {
  wk: boolean;
  wq: boolean;
  bk: boolean;
  bq: boolean;
}

interface Snapshot {
  board: (Piece | null)[];
  turn: Color;
  castling: CastlingRights;
  epSquare: number | null;
  halfmoveClock: number;
}

// Squares are indexed 0..63 with 0 = a8 and 63 = h1 (row-major from White's view).
export const fileOf = (sq: number): number => sq % 8;
export const rankOf = (sq: number): number => 7 - Math.floor(sq / 8);
export const squareName = (sq: number): string => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export const squareAt = (file: number, rank: number): number => (7 - rank) * 8 + file;

export const opponent = (c: Color): Color => (c === 'w' ? 'b' : 'w');

const KNIGHT_STEPS: [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

function offset(sq: number, df: number, dr: number): number | null {
  const f = fileOf(sq) + df;
  const r = rankOf(sq) + dr;
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? squareAt(f, r) : null;
}

export class Game {
  board: (Piece | null)[] = new Array(64).fill(null);
  turn: Color = 'w';
  castling: CastlingRights = { wk: true, wq: true, bk: true, bq: true };
  epSquare: number | null = null;
  halfmoveClock = 0;
  history: Move[] = [];
  private snapshots: Snapshot[] = [];

  constructor() {
    for (let f = 0; f < 8; f++) {
      this.board[squareAt(f, 0)] = { color: 'w', type: BACK_RANK[f] };
      this.board[squareAt(f, 1)] = { color: 'w', type: 'p' };
      this.board[squareAt(f, 6)] = { color: 'b', type: 'p' };
      this.board[squareAt(f, 7)] = { color: 'b', type: BACK_RANK[f] };
    }
  }

  /** Builds a position from a piece-placement map, e.g. { e1: 'K', e8: 'k' }. Uppercase = White. */
  static fromPlacement(placement: Record<string, string>, turn: Color = 'w'): Game {
    const g = new Game();
    g.board.fill(null);
    g.castling = { wk: false, wq: false, bk: false, bq: false };
    for (const [name, ch] of Object.entries(placement)) {
      const sq = squareAt(name.charCodeAt(0) - 97, Number(name[1]) - 1);
      g.board[sq] = { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() as PieceType };
    }
    g.turn = turn;
    return g;
  }

  kingSquare(color: Color): number {
    return this.board.findIndex((p) => p?.type === 'k' && p.color === color);
  }

  isAttacked(sq: number, by: Color): boolean {
    // Pawns: a pawn of `by` attacks diagonally forward, so look diagonally backward from sq.
    const pawnDir = by === 'w' ? -1 : 1;
    for (const df of [-1, 1]) {
      const s = offset(sq, df, pawnDir);
      if (s !== null && this.board[s]?.color === by && this.board[s]?.type === 'p') return true;
    }
    for (const [df, dr] of KNIGHT_STEPS) {
      const s = offset(sq, df, dr);
      if (s !== null && this.board[s]?.color === by && this.board[s]?.type === 'n') return true;
    }
    for (const [df, dr] of KING_STEPS) {
      const s = offset(sq, df, dr);
      if (s !== null && this.board[s]?.color === by && this.board[s]?.type === 'k') return true;
    }
    const slide = (dirs: [number, number][], types: PieceType[]): boolean => {
      for (const [df, dr] of dirs) {
        let s = offset(sq, df, dr);
        while (s !== null) {
          const p = this.board[s];
          if (p) {
            if (p.color === by && types.includes(p.type)) return true;
            break;
          }
          s = offset(s, df, dr);
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, ['r', 'q']) || slide(BISHOP_DIRS, ['b', 'q']);
  }

  inCheck(color: Color = this.turn): boolean {
    return this.isAttacked(this.kingSquare(color), opponent(color));
  }

  private pseudoMoves(): Omit<Move, 'san'>[] {
    const moves: Omit<Move, 'san'>[] = [];
    const us = this.turn;
    const them = opponent(us);

    for (let from = 0; from < 64; from++) {
      const piece = this.board[from];
      if (!piece || piece.color !== us) continue;

      const add = (to: number, extra: Partial<Move> = {}) => {
        const captured = this.board[to] ?? undefined;
        moves.push({ from, to, piece, captured, ...extra });
      };

      switch (piece.type) {
        case 'p': {
          const dir = us === 'w' ? 1 : -1;
          const startRank = us === 'w' ? 1 : 6;
          const lastRank = us === 'w' ? 7 : 0;
          const pushOrPromote = (to: number, captured?: Piece) => {
            if (rankOf(to) === lastRank) {
              for (const promotion of ['q', 'r', 'b', 'n'] as PieceType[]) {
                moves.push({ from, to, piece, captured, promotion });
              }
            } else {
              moves.push({ from, to, piece, captured });
            }
          };
          const one = offset(from, 0, dir);
          if (one !== null && !this.board[one]) {
            pushOrPromote(one);
            const two = offset(from, 0, 2 * dir);
            if (rankOf(from) === startRank && two !== null && !this.board[two]) add(two);
          }
          for (const df of [-1, 1]) {
            const to = offset(from, df, dir);
            if (to === null) continue;
            const target = this.board[to];
            if (target && target.color === them) pushOrPromote(to, target);
            else if (to === this.epSquare) {
              moves.push({
                from, to, piece, enPassant: true,
                captured: { color: them, type: 'p' },
              });
            }
          }
          break;
        }
        case 'n':
        case 'k': {
          const steps = piece.type === 'n' ? KNIGHT_STEPS : KING_STEPS;
          for (const [df, dr] of steps) {
            const to = offset(from, df, dr);
            if (to !== null && this.board[to]?.color !== us) add(to);
          }
          if (piece.type === 'k') this.addCastling(from, moves);
          break;
        }
        default: {
          const dirs =
            piece.type === 'r' ? ROOK_DIRS : piece.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
          for (const [df, dr] of dirs) {
            let to = offset(from, df, dr);
            while (to !== null) {
              const target = this.board[to];
              if (target?.color === us) break;
              add(to);
              if (target) break;
              to = offset(to, df, dr);
            }
          }
        }
      }
    }
    return moves;
  }

  private addCastling(from: number, moves: Omit<Move, 'san'>[]): void {
    const us = this.turn;
    const them = opponent(us);
    const rank = us === 'w' ? 0 : 7;
    if (from !== squareAt(4, rank) || this.isAttacked(from, them)) return;
    const piece = this.board[from]!;
    const empty = (...files: number[]) => files.every((f) => !this.board[squareAt(f, rank)]);
    const safe = (...files: number[]) => files.every((f) => !this.isAttacked(squareAt(f, rank), them));
    const rookAt = (f: number) => {
      const p = this.board[squareAt(f, rank)];
      return p?.type === 'r' && p.color === us;
    };
    if (this.castling[`${us}k`] && rookAt(7) && empty(5, 6) && safe(5, 6)) {
      moves.push({ from, to: squareAt(6, rank), piece, castle: 'k' });
    }
    if (this.castling[`${us}q`] && rookAt(0) && empty(1, 2, 3) && safe(2, 3)) {
      moves.push({ from, to: squareAt(2, rank), piece, castle: 'q' });
    }
  }

  /** All legal moves for the side to move. Pass `withSan = false` to skip SAN generation (faster). */
  legalMoves(withSan = true): Move[] {
    const us = this.turn;
    const legal = this.pseudoMoves().filter((m) => {
      this.apply(m);
      const ok = !this.inCheck(us);
      this.undoInternal();
      return ok;
    });
    return legal.map((m) => ({ ...m, san: withSan ? this.toSan(m, legal) : '' }));
  }

  movesFrom(sq: number): Move[] {
    return this.legalMoves().filter((m) => m.from === sq);
  }

  /** Plays a move given by squares; returns the move played or null if illegal. */
  move(from: number, to: number, promotion: PieceType = 'q', withSan = true): Move | null {
    const m = this.legalMoves(withSan).find(
      (x) => x.from === from && x.to === to && (!x.promotion || x.promotion === promotion),
    );
    if (!m) return null;
    this.apply(m);
    this.history.push(m);
    return m;
  }

  undo(): Move | null {
    const m = this.history.pop();
    if (!m) return null;
    this.undoInternal();
    return m;
  }

  status(): GameStatus {
    const hasMoves = this.legalMoves(false).length > 0;
    const check = this.inCheck();
    if (!hasMoves) return check ? { kind: 'checkmate', winner: opponent(this.turn) } : { kind: 'stalemate' };
    if (this.halfmoveClock >= 100) return { kind: 'draw', reason: 'fifty-move' };
    if (this.insufficientMaterial()) return { kind: 'draw', reason: 'insufficient-material' };
    return { kind: 'playing', check };
  }

  private insufficientMaterial(): boolean {
    const pieces = this.board.filter((p): p is Piece => !!p && p.type !== 'k');
    if (pieces.length === 0) return true;
    return pieces.length === 1 && (pieces[0].type === 'n' || pieces[0].type === 'b');
  }

  private apply(m: Omit<Move, 'san'>): void {
    this.snapshots.push({
      board: this.board.slice(),
      turn: this.turn,
      castling: { ...this.castling },
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
    });

    const b = this.board;
    const us = m.piece.color;
    b[m.to] = m.promotion ? { color: us, type: m.promotion } : m.piece;
    b[m.from] = null;

    if (m.enPassant) b[squareAt(fileOf(m.to), rankOf(m.from))] = null;
    if (m.castle) {
      const rank = rankOf(m.from);
      const [rf, rt] = m.castle === 'k' ? [7, 5] : [0, 3];
      b[squareAt(rt, rank)] = b[squareAt(rf, rank)];
      b[squareAt(rf, rank)] = null;
    }

    // Castling rights are lost when the king or a rook moves, or a rook is captured on its home square.
    if (m.piece.type === 'k') {
      this.castling[`${us}k`] = false;
      this.castling[`${us}q`] = false;
    }
    const rookHomes: [number, keyof CastlingRights][] = [
      [squareAt(0, 0), 'wq'], [squareAt(7, 0), 'wk'], [squareAt(0, 7), 'bq'], [squareAt(7, 7), 'bk'],
    ];
    for (const [sq, right] of rookHomes) {
      if (m.from === sq || m.to === sq) this.castling[right] = false;
    }

    this.epSquare =
      m.piece.type === 'p' && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2
        ? squareAt(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) / 2)
        : null;
    this.halfmoveClock = m.piece.type === 'p' || m.captured ? 0 : this.halfmoveClock + 1;
    this.turn = opponent(us);
  }

  private undoInternal(): void {
    const s = this.snapshots.pop()!;
    this.board = s.board;
    this.turn = s.turn;
    this.castling = s.castling;
    this.epSquare = s.epSquare;
    this.halfmoveClock = s.halfmoveClock;
  }

  private toSan(m: Omit<Move, 'san'>, legal: Omit<Move, 'san'>[]): string {
    let san: string;
    if (m.castle) {
      san = m.castle === 'k' ? 'O-O' : 'O-O-O';
    } else if (m.piece.type === 'p') {
      san = m.captured ? 'abcdefgh'[fileOf(m.from)] + 'x' : '';
      san += squareName(m.to);
      if (m.promotion) san += '=' + m.promotion.toUpperCase();
    } else {
      san = m.piece.type.toUpperCase();
      const rivals = legal.filter(
        (x) => x.to === m.to && x.from !== m.from && x.piece.type === m.piece.type,
      );
      if (rivals.length) {
        const sameFile = rivals.some((x) => fileOf(x.from) === fileOf(m.from));
        const sameRank = rivals.some((x) => rankOf(x.from) === rankOf(m.from));
        const from = squareName(m.from);
        san += !sameFile ? from[0] : !sameRank ? from[1] : from;
      }
      if (m.captured) san += 'x';
      san += squareName(m.to);
    }

    this.apply(m);
    if (this.inCheck()) {
      san += this.pseudoMoves().some((x) => {
        this.apply(x);
        const ok = !this.inCheck(opponent(this.turn));
        this.undoInternal();
        return ok;
      })
        ? '+'
        : '#';
    }
    this.undoInternal();
    return san;
  }
}
