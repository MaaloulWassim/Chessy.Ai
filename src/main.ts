import { bestMove } from './ai';
import { Game, fileOf, rankOf, type Move, type PieceType } from './chess';

// Solid glyphs for both colours (tinted with CSS); U+FE0E forces text rather than emoji rendering.
const GLYPHS: Record<PieceType, string> = {
  k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎',
};
const NAMES: Record<PieceType, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

const boardEl = document.getElementById('board')!;
const statusEl = document.getElementById('status')!;
const movesEl = document.getElementById('moves')!;
const vsAiEl = document.getElementById('vs-ai') as HTMLInputElement;
const promotionEl = document.getElementById('promotion') as HTMLDialogElement;
const promotionChoicesEl = document.getElementById('promotion-choices')!;

let game = new Game();
let selected: number | null = null;
let targets: Move[] = [];
let flipped = false;
let aiThinking = false;

function render(): void {
  const status = game.status();
  const last = game.history.at(-1);
  const checkedKing = game.inCheck() ? game.kingSquare(game.turn) : -1;

  boardEl.replaceChildren();
  for (let i = 0; i < 64; i++) {
    const sq = flipped ? 63 - i : i;
    const piece = game.board[sq];
    const el = document.createElement('button');
    const isLight = (fileOf(sq) + rankOf(sq)) % 2 === 1;
    el.className = `square ${isLight ? 'light' : 'dark'}`;
    if (last && (sq === last.from || sq === last.to)) el.classList.add('last');
    if (sq === selected) el.classList.add('selected');
    if (sq === checkedKing) el.classList.add('check');
    const target = targets.find((m) => m.to === sq);
    if (target) el.classList.add('target', ...(target.captured ? ['capture'] : []));

    const file = 'abcdefgh'[fileOf(sq)];
    el.setAttribute('aria-label', `${file}${rankOf(sq) + 1}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : ''}`);
    if (piece) {
      const p = document.createElement('span');
      p.className = `piece ${piece.color}`;
      p.textContent = GLYPHS[piece.type];
      el.append(p);
    }
    if (i % 8 === 0) el.append(coord('rank', String(rankOf(sq) + 1)));
    if (i >= 56) el.append(coord('file', file));
    el.addEventListener('click', () => onSquareClick(sq));
    boardEl.append(el);
  }

  const side = game.turn === 'w' ? 'White' : 'Black';
  statusEl.textContent =
    status.kind === 'checkmate' ? `Checkmate — ${status.winner === 'w' ? 'White' : 'Black'} wins`
    : status.kind === 'stalemate' ? 'Stalemate — draw'
    : status.kind === 'draw' ? `Draw (${status.reason.replace('-', ' ')})`
    : aiThinking ? 'Computer is thinking…'
    : `${side} to move${status.check ? ' — check!' : ''}`;

  movesEl.replaceChildren();
  for (let i = 0; i < game.history.length; i += 2) {
    const li = document.createElement('li');
    for (const m of game.history.slice(i, i + 2)) {
      const span = document.createElement('span');
      span.textContent = m.san;
      li.append(span);
    }
    movesEl.append(li);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

function coord(kind: 'file' | 'rank', text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `coord ${kind}`;
  el.textContent = text;
  return el;
}

async function onSquareClick(sq: number): Promise<void> {
  if (aiThinking || game.status().kind !== 'playing') return;
  if (vsAiEl.checked && game.turn === 'b') return;

  const candidates = targets.filter((m) => m.to === sq);
  if (candidates.length) {
    const promotion = candidates[0].promotion ? await choosePromotion() : undefined;
    game.move(candidates[0].from, sq, promotion);
    selected = null;
    targets = [];
    render();
    maybeAiMove();
    return;
  }

  const piece = game.board[sq];
  if (piece && piece.color === game.turn && sq !== selected) {
    selected = sq;
    targets = game.movesFrom(sq);
  } else {
    selected = null;
    targets = [];
  }
  render();
}

function choosePromotion(): Promise<PieceType> {
  return new Promise((resolve) => {
    promotionChoicesEl.replaceChildren();
    for (const type of ['q', 'r', 'b', 'n'] as PieceType[]) {
      const btn = document.createElement('button');
      btn.innerHTML = `<span class="piece ${game.turn}">${GLYPHS[type]}</span>`;
      btn.setAttribute('aria-label', NAMES[type]);
      btn.addEventListener('click', () => {
        promotionEl.close();
        resolve(type);
      });
      promotionChoicesEl.append(btn);
    }
    // Closing with Escape defaults to a queen.
    promotionEl.addEventListener('cancel', () => resolve('q'), { once: true });
    promotionEl.showModal();
  });
}

function maybeAiMove(): void {
  if (!vsAiEl.checked || game.turn !== 'b' || game.status().kind !== 'playing') return;
  aiThinking = true;
  render();
  // Yield to the browser so the "thinking" status paints before the search blocks the thread.
  setTimeout(() => {
    const m = bestMove(game, 3);
    if (m) game.move(m.from, m.to, m.promotion);
    aiThinking = false;
    render();
  }, 50);
}

document.getElementById('new-game')!.addEventListener('click', () => {
  if (aiThinking) return;
  game = new Game();
  selected = null;
  targets = [];
  render();
});

document.getElementById('undo')!.addEventListener('click', () => {
  if (aiThinking) return;
  game.undo();
  // Against the computer, take back the full move so it's the human's turn again.
  if (vsAiEl.checked && game.turn === 'b') game.undo();
  selected = null;
  targets = [];
  render();
});

document.getElementById('flip')!.addEventListener('click', () => {
  flipped = !flipped;
  render();
});

vsAiEl.addEventListener('change', maybeAiMove);

render();
