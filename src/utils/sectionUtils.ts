import type { Section } from "@/types/scenario";

/**
 * 問題セクションの表示タイトルを取得する
 * @param sections シナリオ内の全セクション
 * @param sectionIndex 対象セクションのインデックス
 * @returns 表示用タイトル
 */
export const getSectionDisplayTitle = (
  sections: Section[],
  sectionIndex: number,
): string => {
  const section = sections[sectionIndex];
  if (!section) {
    return "";
  }

  if (section.type === "demo") {
    return section.title;
  }

  // 問題セクションの場合、順序から連番を計算
  let questionNumber = 0;
  for (let i = 0; i <= sectionIndex; i++) {
    if (sections[i]?.type === "question") {
      questionNumber++;
    }
  }
  return `練習問題(${questionNumber})`;
};
