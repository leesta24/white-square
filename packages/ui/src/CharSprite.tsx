import { CHAR_COLS, CHAR_ROWS, CHAR_SHEET, CHAR_T, charForm } from "./characters.ts";

/** Renders an agent's pixel character form as a crisp DOM avatar. */
export function CharSprite({ sprite, size = 32 }: { sprite?: string; size?: number }) {
  const form = charForm(sprite);
  if (form.image) {
    return (
      <span
        title={form.label}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          imageRendering: "pixelated",
          backgroundImage: `url(${form.image})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          flex: "0 0 auto",
        }}
      />
    );
  }
  const tile = form.tile ?? 85;
  const col = tile % CHAR_COLS;
  const row = Math.floor(tile / CHAR_COLS);
  const scale = size / CHAR_T;
  return (
    <span
      title={form.label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        imageRendering: "pixelated",
        backgroundImage: `url(${CHAR_SHEET})`,
        backgroundPosition: `-${col * CHAR_T * scale}px -${row * CHAR_T * scale}px`,
        backgroundSize: `${CHAR_COLS * CHAR_T * scale}px ${CHAR_ROWS * CHAR_T * scale}px`,
        flex: "0 0 auto",
      }}
    />
  );
}
