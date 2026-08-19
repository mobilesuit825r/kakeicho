import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages ではリポジトリ名がURLのパスに入るため、
// base をリポジトリ名に合わせて変更してください。
// 例: https://ユーザー名.github.io/kakeicho/ の場合 -> base: "/kakeicho/"
export default defineConfig({
  plugins: [react()],
  base: "/kakeicho/",
});
