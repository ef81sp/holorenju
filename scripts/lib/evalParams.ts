/**
 * eval 重みパラメータ id の正準表（TS 側）。
 *
 * 数値は Zig `scores.zig` の `EvalParamId` と一致させる。
 * **手動の双方向コメント同期は禁止。** ドリフトは
 * 「resetEvalParams() 後に全 id の getEvalParam が*それぞれ固有の*既定値に
 * 一致するか」で機械検出する（scores.zig のテスト＋verify-eval-injection）。
 *
 * LINE_POTENTIAL_TABLE は素材数 1..4 のエントリを個別 id に割当
 * （[0]/[5] は sentinel=0 で対象外）。
 */
export const EVAL_PARAM_IDS = {
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

export type EvalParamName = keyof typeof EVAL_PARAM_IDS;

/** 各 id の既定値（ドリフト検出用。全 id で相異なる）。scores.zig の *_DEFAULT と一致。 */
export const EVAL_PARAM_DEFAULTS: Record<EvalParamName, number> = {
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

/** "OPEN_TWO:25,OPEN_THREE:600" 形式をパースし [id, value][] に。未知キーは例外。 */
export function parseWeightOverrides(str: string): [number, number][] {
  const out: [number, number][] = [];
  for (const pair of str.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const [k, v] = trimmed.split(":");
    if (!k || v === undefined) {
      continue;
    }
    const id = (EVAL_PARAM_IDS as Record<string, number>)[k.trim()];
    if (id === undefined) {
      throw new Error(
        `不明な eval 重みキー "${k.trim()}"。有効: ${Object.keys(EVAL_PARAM_IDS).join(", ")}`,
      );
    }
    const num = Number(v.trim());
    if (Number.isNaN(num)) {
      throw new Error(`"${k.trim()}" の値が数値でない: "${v}"`);
    }
    out.push([id, num]);
  }
  return out;
}
