"use client";

import "@fontsource/pangolin/400.css";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import {
  type Board,
  type BoardItem,
  CHALK_COLOURS,
  type ChalkColour,
  clearSheet,
  draw,
  MAX_POINTS,
  MAX_TEXT_LENGTH,
  newSheet,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  sheetLabel,
  turnSheet,
  undo,
} from "@/domain/board";

type Tool = "text" | "chalk" | "sponge";

/** How the chalk colours look on the slate. */
const CHALK: Record<ChalkColour, string> = { white: "#f4f1e8", yellow: "#f2d675", pink: "#f2a7c3", blue: "#9fd3f0" };
const SLATE = "#2f3432";
const CHALK_FONT = "Pangolin, cursive";

/** A point of the sheet under the pointer, in the sheet's own coordinates. */
function pointOf(event: PointerEvent<HTMLElement>, surface: HTMLElement): [number, number] {
  const box = surface.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * SHEET_WIDTH;
  const y = ((event.clientY - box.top) / box.height) * SHEET_HEIGHT;
  return [Math.round(Math.min(Math.max(x, 0), SHEET_WIDTH)), Math.round(Math.min(Math.max(y, 0), SHEET_HEIGHT))];
}

function path(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + (points.length === 1 ? " l0.1 0" : "");
}

/**
 * The chalkboard on the stage (#155): the teacher writes here, in the stage
 * window. Printed text in the chalk font is the main tool; chalk by hand and
 * the sponge draw lines; «Очистить» empties the sheet at once and «Вернуть»
 * or Ctrl+Z brings it back; «Новый лист» keeps the earlier sheets, paged with
 * ‹ and ›. Every change goes to the panel, which keeps the board with the
 * lesson's state, so a stage opened again shows it as it was.
 */
export function LessonBoard({ board, onChange }: { board: Board; onChange: (board: Board) => void }) {
  const [tool, setTool] = useState<Tool>("text");
  const [colour, setColour] = useState<ChalkColour>("white");
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null);
  const [line, setLine] = useState<[number, number][] | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef(board);
  useEffect(() => {
    latest.current = board;
  }, [board]);
  const sheet = board.sheets[board.current]!;

  // Ctrl+Z (or ⌘Z) undoes the last change of the sheet, unless she is typing a word.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        onChange(undo(latest.current));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);

  function commitText() {
    if (typing && typing.text.trim()) onChange(draw(board, { kind: "text", x: typing.x, y: typing.y, text: typing.text.trim(), colour }));
    setTyping(null);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!surface.current || event.target instanceof HTMLInputElement) return;
    const at = pointOf(event, surface.current);
    if (tool === "text") {
      // The click would take the focus from the field it opens.
      event.preventDefault();
      commitText();
      setTyping({ x: at[0], y: at[1], text: "" });
      return;
    }
    surface.current.setPointerCapture(event.pointerId);
    setLine([at]);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!line || !surface.current || line.length >= MAX_POINTS) return;
    const at = pointOf(event, surface.current);
    const last = line[line.length - 1]!;
    if (Math.abs(at[0] - last[0]) + Math.abs(at[1] - last[1]) >= 2) setLine([...line, at]);
  }

  function onPointerUp() {
    if (!line) return;
    const item: BoardItem = tool === "sponge" ? { kind: "sponge", points: line } : { kind: "stroke", points: line, colour };
    onChange(draw(board, item));
    setLine(null);
  }

  const button = (on: boolean) =>
    `rounded px-2 py-1 text-caption font-semibold ${on ? "bg-[#f4f1e8] text-[#2f3432]" : "bg-white/10 text-[#f4f1e8] hover:bg-white/20"}`;
  const pick = (next: Tool) => {
    commitText();
    setTool(next);
  };

  return (
    <section aria-label="Доска" className="flex w-72 shrink-0 flex-col gap-2 rounded-card border-8 border-[#5b4a3a] p-2" style={{ background: SLATE }}>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-pressed={tool === "text"} onClick={() => pick("text")} className={button(tool === "text")}>
          Текст
        </button>
        <button type="button" aria-pressed={tool === "chalk"} onClick={() => pick("chalk")} className={button(tool === "chalk")}>
          Мел
        </button>
        <button type="button" aria-pressed={tool === "sponge"} onClick={() => pick("sponge")} className={button(tool === "sponge")}>
          Губка
        </button>
        {(Object.keys(CHALK_COLOURS) as ChalkColour[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={CHALK_COLOURS[c]}
            aria-pressed={colour === c}
            onClick={() => setColour(c)}
            className={`h-6 w-6 rounded-full border-2 ${colour === c ? "border-white" : "border-transparent"}`}
            style={{ background: CHALK[c] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onChange(clearSheet(board))} className={button(false)}>
          Очистить
        </button>
        <button type="button" disabled={sheet.previous === null} onClick={() => onChange(undo(board))} className={`${button(false)} disabled:opacity-40`}>
          Вернуть
        </button>
        <button type="button" onClick={() => onChange(newSheet(board))} className={button(false)}>
          Новый лист
        </button>
      </div>

      <div
        ref={surface}
        role="application"
        aria-label="Лист доски"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`relative w-full touch-none overflow-hidden ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
        style={{ aspectRatio: `${SHEET_WIDTH} / ${SHEET_HEIGHT}`, maxHeight: "calc(100vh - 10rem)" }}
      >
        <svg aria-hidden="true" viewBox={`0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}`} className="absolute inset-0 h-full w-full">
          {[...sheet.items, ...(line ? [tool === "sponge" ? { kind: "sponge" as const, points: line } : { kind: "stroke" as const, points: line, colour }] : [])].map(
            (item, i) =>
              item.kind === "text" ? null : (
                <path
                  key={i}
                  d={path(item.points)}
                  fill="none"
                  stroke={item.kind === "sponge" ? SLATE : CHALK[item.colour]}
                  strokeWidth={item.kind === "sponge" ? 18 : 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={item.kind === "sponge" ? 1 : 0.9}
                />
              ),
          )}
        </svg>
        {sheet.items.map((item, i) =>
          item.kind === "text" ? (
            <span
              key={i}
              className="pointer-events-none absolute whitespace-pre text-[22px] leading-none"
              style={{ left: `${(item.x / SHEET_WIDTH) * 100}%`, top: `${(item.y / SHEET_HEIGHT) * 100}%`, color: CHALK[item.colour], fontFamily: CHALK_FONT }}
            >
              {item.text}
            </span>
          ) : null,
        )}
        {typing && (
          <input
            // biome-ignore lint/a11y/noAutofocus: the teacher has just clicked here to type
            autoFocus
            aria-label="Текст на доске"
            value={typing.text}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(e) => setTyping({ ...typing, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") setTyping(null);
            }}
            onBlur={commitText}
            className="absolute w-40 border-b border-white/50 bg-transparent text-[22px] leading-none outline-none"
            style={{ left: `${(typing.x / SHEET_WIDTH) * 100}%`, top: `${(typing.y / SHEET_HEIGHT) * 100}%`, color: CHALK[colour], fontFamily: CHALK_FONT }}
          />
        )}
      </div>

      <div className="flex items-center justify-center gap-2 text-caption text-[#f4f1e8]">
        <button type="button" aria-label="Предыдущий лист" onClick={() => onChange(turnSheet(board, -1))} className={button(false)}>
          ‹
        </button>
        <span>{sheetLabel(board)}</span>
        <button type="button" aria-label="Следующий лист" onClick={() => onChange(turnSheet(board, 1))} className={button(false)}>
          ›
        </button>
      </div>
    </section>
  );
}
