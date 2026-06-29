// Character "forms" an agent can take. Sprites come from Kenney's CC0
// "Tiny Dungeon" tilesheet (12 cols × 11 rows of 16px tiles).
export interface CharForm {
  id: string;
  label: string;
  tile?: number; // index into the tiny-dungeon packed sheet
  image?: string; // custom transparent sprite asset
}

export const CHAR_SHEET = "/assets/tiny-dungeon/tilemap_packed.png";
export const CHAR_T = 16;
export const CHAR_COLS = 12;
export const CHAR_ROWS = 11;

export const CHARACTERS: CharForm[] = [
  { id: "white", label: "White", image: "/assets/characters/white.png" },
  { id: "kun", label: "KUN", image: "/assets/characters/kun.png" },
  { id: "villager", label: "Villager", tile: 85 },
  { id: "elder", label: "Elder", tile: 87 },
  { id: "wizard", label: "Wizard", tile: 84 },
  { id: "knight", label: "Knight", tile: 96 },
  { id: "guard", label: "Guard", tile: 100 },
  { id: "princess", label: "Princess", tile: 99 },
  { id: "ranger", label: "Ranger", tile: 112 },
  { id: "ninja", label: "Ninja", tile: 110 },
  { id: "imp", label: "Imp", tile: 109 },
  { id: "slime", label: "Slime", tile: 108 },
  { id: "ghost", label: "Ghost", tile: 121 },
  { id: "bat", label: "Bat", tile: 120 },
  { id: "spider", label: "Spider", tile: 122 },
  { id: "beetle", label: "Beetle", tile: 123 },
];

export const DEFAULT_SPRITE = "white";

export function charForm(id?: string): CharForm {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}
