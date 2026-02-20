/**
 * キャラクター表示設定（CSS変数参照）
 *
 * CharacterDialog / CompactCharacterDialog で共有
 */

export const CHARACTER_CONFIG: Record<
  "fubuki" | "miko",
  {
    avatarBg: string;
    borderColor: string;
    nameColor: string;
    name: string;
  }
> = {
  fubuki: {
    avatarBg: "var(--color-fubuki-bg)",
    borderColor: "var(--color-fubuki-primary)",
    nameColor: "var(--color-fubuki-name)",
    name: "フブキ先生",
  },
  miko: {
    avatarBg: "var(--color-miko-bg)",
    borderColor: "var(--color-miko-primary)",
    nameColor: "var(--color-miko-name)",
    name: "みこ",
  },
};
