# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Renju (五目並べ/Gomoku) learning game featuring:

- **Demo mode**: Characters (VTubers Fubuki & Miko) explain Renju strategies through dialogue
- **Question mode**: Players practice moves with immediate feedback
- **Scenario editor**: Built-in editor for creating learning scenarios

## Commands

```bash
pnpm check-fix     # Type-check + format + lint (use this, not individual commands)
pnpm dev           # Dev server (usually already running)
pnpm build         # Production build
```

### Git

- Don't use `git -C`. Do `pwd` if needed.

## Planning

- Do TDD
- Ask anything because your boss is fool so his instructions have overlooks.
- Use `/review-plan` skill before aproove.

## Architecture

### State Management (Pinia stores in `src/stores/`)

- **appStore**: Navigation state (scenes: menu → difficulty → scenarioList → scenarioPlay/editor)
- **gameStore**: Game logic, turn management, win detection (delegates board state to boardStore)
- **boardStore**: Board state, stones, marks, lines with animation callbacks
- **dialogStore**: Character dialogue display state
- **progressStore**: Learning progress tracking
- **preferencesStore**: User settings (text size, etc.)

### Core Game Logic (`src/logic/`)

- **renjuRules.ts**: Renju rules including forbidden moves (double-three, double-four, overline) for black stones
- **boardParser.ts**: Parse board state from string notation
- **scenarioParser.ts**: Parse scenario JSON files

### Component Structure

- **ScenarioPlayer** (`src/components/scenarios/ScenarioPlayer/`): Main gameplay component with composables for navigation, keyboard input, question solving, cutin display
- **RenjuBoard** (`src/components/game/RenjuBoard/`): Vue Konva-based board with composables for layout, interaction, animation
- **Editor** (`src/editor/`): Full scenario editing suite with File System Access API integration

### Type System (`src/types/`)

- **scenario.ts**: Core types - Scenario, DemoSection, QuestionSection, BoardAction, SuccessCondition
- **game.ts**: BoardState (15x15 grid), Position, StoneColor
- **character.ts**: CharacterType, EmotionId
- **text.ts**: TextNode for rich text with ruby annotations

## Development Guidelines

### Planning

- Do SSoT, DRY, SOLID, t-wada TDD
- commit by phase

### package manager / scripts

- Use `pnpm` for package management
- Don't use `npx`. Run scripts via `pnpm <script>`.
- Write a README document near any component or module with non-trivial logic.
- **Don't use `rm` command directly** - it triggers confirmation prompts. Use `git clean` or ask the user.

### Vue/TypeScript

- Use `<script setup lang="ts">` with generic-style defineProps
- Use `<dialog>` element for modals (see existing components)
- When referencing component methods via refs, use optional chaining (`ref?.method()`)
- Keep SFCs under ~400 lines; extract composables or split components
- When handling union types, don't use if-else chains; use type guards or switch statements
- When develop some scripts, use `node --expperimental-strip-types`, not `ts-node` or `tsx`

### CSS

- **Fixed 960×540 viewport**: Use CSS variables from `style.css` (e.g., `--size-16`, `--size-24`)
- **Never use rem/px** for layout - use `--size-*` variables with clamp()
- Colors: Use `:root` variables (e.g., `--color-fubuki-primary`, `--color-text-primary`)
- Font weights: normal=300, bold=500
- Scoped styles don't inherit across component boundaries; put utilities in `style.css`
- Never set `display` directly on `<dialog>` or popover elements

### Icons

- Use **Material Symbols Outlined** (weight 400) for all UI icons (Apache-2.0)
- SVG files in `src/assets/icons/` with `fill="currentColor"`
- Import as component: `import InfoIcon from "@/assets/icons/info.svg?component"`
- Use in template: `<InfoIcon />`
- Source: https://github.com/google/material-design-icons/tree/master/symbols/web
- To add new icons, use the `/download-icon` skill

### Konva

- Use Vue Konva components (`v-stage`, `v-layer`, `v-circle`, etc.)
- Board rendering uses composables for layout calculations and animations

### Testing

- Playwright MCP available for E2E testing
- Browser viewport: 960×540 (fixed)
- Minimize screenshots during testing (context limit)
- Use `pnpm test:browser:headless` for headless browser tests (useful for agents/CI)

### Before Committing

- Run `pnpm check-fix` to ensure type-checking, formatting, and linting pass
- Do `/review` your edits with subagents

## Task Planning

- Check `docs/` for implementation plans and TODOs
- Generalize learnings to AGENTS.md

## Renju Knowledge

- Renju is played on a 15x15 grid
- Black plays first, with forbidden moves (double-three, double-four, overline)
- Winning condition: first to align five stones horizontally, vertically, or diagonally
- Coordinate notation: origin at bottom-left, e.g., 15A, 1O
- Game record example:
  - H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11
