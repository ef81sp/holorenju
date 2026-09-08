/**
 * eval 重みパラメータ id の正準表（TS 側）。
 *
 * - legacy（id 0..8）: Zig `scores.zig` の `EvalParamId` と一致させる。
 * - prospect（id 100..133）: `prospect.zig` の CellCat 宣言順 17 カテゴリ × (WAIT, TURN)。
 *   id = PROSPECT_PARAM_ID_BASE + cat*2 + turn（main.zig のルーティングと一致）。
 *
 * **手動の双方向コメント同期は禁止。** ドリフトは**名前照合**で機械検出する:
 * wasm `getEvalParamName(id)` を id 空間で走査し、非空の名前集合と各 id が
 * この表と一致するかを `evalParams.wasm.test.ts` が検証する。
 *
 * 既定値の SSoT は Zig 側（scores.zig の *_DEFAULT / prospect.zig の
 * PROSPECT_SCORE_DEFAULT）。prospect の既定値は TS に複製しない（表示や記録が要る
 * 場面は wasm の `getEvalParam` から読む）。
 *
 * LINE_POTENTIAL_TABLE は素材数 1..4 のエントリを個別 id に割当
 * （[0]/[5] は sentinel=0 で対象外）。
 */

/** prospect id 空間のオフセット（main.zig の PROSPECT_PARAM_ID_BASE と一致）。 */
export const PROSPECT_PARAM_ID_BASE = 100;

/** 空点プロスペクトのカテゴリ名（prospect.zig `categoryNameSlice` の宣言順）。 */
export const PROSPECT_CATEGORIES = [
  "NONE",
  "WEAK",
  "SOLO_B2",
  "SOLO_F2",
  "DOUBLE_F2",
  "SOLO_B3",
  "B4_F2",
  "SOLO_F3",
  "F3_F2",
  "F3_B3",
  "SOLO_B4",
  "DOUBLE_THREE_BLACK_RISK",
  "DOUBLE_THREE_WHITE",
  "FOUR_THREE",
  "SOLO_F4",
  "DOUBLE_FOUR_WHITE",
  "WIN",
] as const;

/** prospect 特徴数（カテゴリ × WAIT/TURN）。extractProspectFeatures の要素数と一致。 */
export const PROSPECT_FEATURE_COUNT = PROSPECT_CATEGORIES.length * 2;

/** legacy 形系重み（scores.zig `EvalParamId`）。 */
export const LEGACY_PARAM_IDS = {
  OPEN_THREE: 0,
  THREE: 1,
  OPEN_TWO: 2,
  TWO: 3,
  CENTER_BONUS: 4,
  LINE_POTENTIAL_1: 5,
  LINE_POTENTIAL_2: 6,
  LINE_POTENTIAL_3: 7,
  LINE_POTENTIAL_4: 8,
} as const;

/** `PROSPECT_<CAT>_WAIT`（turn=0）/ `PROSPECT_<CAT>_TURN`（turn=1）を生成する。 */
function buildProspectParamIds(): Record<string, number> {
  const out: Record<string, number> = {};
  PROSPECT_CATEGORIES.forEach((cat, catIndex) => {
    out[`PROSPECT_${cat}_WAIT`] = PROSPECT_PARAM_ID_BASE + catIndex * 2;
    out[`PROSPECT_${cat}_TURN`] = PROSPECT_PARAM_ID_BASE + catIndex * 2 + 1;
  });
  return out;
}

type ProspectParamName =
  `PROSPECT_${(typeof PROSPECT_CATEGORIES)[number]}_${"WAIT" | "TURN"}`;

export const EVAL_PARAM_IDS: Readonly<
  Record<keyof typeof LEGACY_PARAM_IDS | ProspectParamName, number>
> = {
  ...LEGACY_PARAM_IDS,
  ...(buildProspectParamIds() as Record<ProspectParamName, number>),
};

/** legacy 各 id の既定値（scores.zig の *_DEFAULT と一致）。prospect は含めない。 */
export const EVAL_PARAM_DEFAULTS: Record<
  keyof typeof LEGACY_PARAM_IDS,
  number
> = {
  OPEN_THREE: 1000,
  THREE: 30,
  OPEN_TWO: 50,
  TWO: 10,
  CENTER_BONUS: 0,
  LINE_POTENTIAL_1: 3,
  LINE_POTENTIAL_2: 12,
  LINE_POTENTIAL_3: 40,
  LINE_POTENTIAL_4: 60,
};

const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;

/**
 * 重み値を i32 として検証する。wasm 側の setEvalParam は i32 なので、非整数は
 * 無音で丸まり、範囲外はラップして読み戻し検証が「古いビルド」と誤診断する。
 */
function parseI32(name: string, raw: string): number {
  const num = Number(raw.trim());
  if (raw.trim() === "" || Number.isNaN(num)) {
    throw new Error(`"${name}" の値が数値でない: "${raw}"`);
  }
  if (!Number.isInteger(num)) {
    throw new Error(`"${name}" の値は整数で指定（wasm は i32）: "${raw}"`);
  }
  if (num < I32_MIN || num > I32_MAX) {
    throw new Error(
      `"${name}" の値が i32 範囲外（${I32_MIN}..${I32_MAX}）: "${raw}"`,
    );
  }
  return num;
}

/**
 * "OPEN_TWO:25,OPEN_THREE:600" 形式を **名前キーの Record** にパースする。
 * キー名は EVAL_PARAM_IDS で検証（未知キー/非数値は例外）。
 * 名前→id 変換は setEvalParam を呼ぶ箇所（bridge worker 等）で行う。
 */
export function parseWeightOverrides(str: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of str.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const [k, v] = trimmed.split(":");
    if (!k || v === undefined) {
      continue;
    }
    const name = k.trim();
    if (!(name in EVAL_PARAM_IDS)) {
      throw new Error(
        `不明な eval 重みキー "${name}"。有効なキーは ${Object.keys(EVAL_PARAM_IDS).length} 個（legacy 9 + PROSPECT_<CAT>_WAIT/TURN 34）。一覧は --help を参照`,
      );
    }
    out[name] = parseI32(name, v);
  }
  return out;
}
