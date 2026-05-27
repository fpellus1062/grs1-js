import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ...js.configs.recommended,
    files: ["public/js/**/*.{js,mjs,cjs}"],
    ignores: ["node_modules/**", "public/dist/**"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        bootstrap: "readonly",
        Tabulator: "readonly",
        luxon: "readonly",
        XLSX: "readonly",
        DOMPurify: "readonly",
        echarts: "readonly",
        jspdf: "readonly",
        Intl: "readonly",
      },
    },
  },
  {
    ...js.configs.recommended,
    files: ["src/**/*.{js,mjs,cjs}", "scripts/**/*.{js,mjs,cjs}", "*.js"],
    ignores: ["node_modules/**", "public/dist/**"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        Intl: "readonly",
      },
    },
  },
];