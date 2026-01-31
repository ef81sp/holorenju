import oxlint from "eslint-plugin-oxlint";
// @ts-check
import eslintPluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

// oxlint-disable-next-line no-anonymous-default-export no-default-export
export default [
  // グローバル ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
      ".oxlint_cache",
      ".eslint_cache",
    ],
  },

  // Oxlintの重複ルール自動無効化
  ...oxlint.configs["flat/eslint"],
  ...oxlint.configs["flat/typescript"],

  // Vue SFC 設定（.vue ファイル）
  ...eslintPluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        vueFeatures: {
          filter: true,
          interpolationAsNonHTML: true,
          styleCSSVariableInjection: true,
        },
      },
      sourceType: "module",
    },
    rules: {
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
      "vue/html-closing-bracket-newline": "off",
    },
  },

  // scripts ディレクトリ用設定（CLI ツール）
  {
    files: ["scripts/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
    },
  },
];
