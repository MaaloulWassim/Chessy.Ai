# Chessy.Ai

A small browser chess app written in TypeScript with no runtime dependencies.

- Full legal move generation: castling, en passant, promotion, check, checkmate, stalemate,
  fifty-move rule and insufficient material
- Moves recorded in standard algebraic notation
- Optional computer opponent (Black) using a shallow alpha-beta search
- Undo, flip board, new game

## Getting started

```sh
npm install
npm run dev      # start the dev server
npm test         # run the engine tests
npm run build    # typecheck and build to dist/
```

## Layout

- `src/chess.ts`: rules engine (`Game` class)
- `src/ai.ts`: computer opponent
- `src/main.ts`: DOM rendering and input handling
- `src/chess.test.ts`: tests, including a perft check against known node counts
