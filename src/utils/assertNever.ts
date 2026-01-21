/**
 * Union型のexhaustive checkを保証するヘルパー関数
 *
 * switch文でnever型を受け取ると、未処理のケースがある場合に
 * TypeScriptコンパイルエラーになる
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
