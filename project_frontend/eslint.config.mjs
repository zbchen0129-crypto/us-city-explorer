import vue from "eslint-plugin-vue";
import globals from "globals";
export default [
  ...vue.configs["flat/essential"],
  {
    files: ["src/**/*.{js,vue}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
