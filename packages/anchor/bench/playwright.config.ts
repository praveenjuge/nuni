import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.bench\.ts$/,
  reporter: [["list"]],
  workers: 1,
  use: {
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
})
