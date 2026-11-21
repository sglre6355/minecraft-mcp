import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...cloudflare,
  rules: {
    ...cloudflare.rules,
    "typescript/require-await": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/restrict-template-expressions": [
      "error",
      {
        allowAny: false,
        allowBoolean: false,
        allowNever: false,
        allowNullish: false,
        allowNumber: true,
        allowRegExp: false,
      },
    ],
    "typescript/restrict-plus-operands": [
      "error",
      {
        allowAny: false,
        allowBoolean: false,
        allowNullish: false,
        allowNumberAndString: false,
        allowRegExp: false,
      },
    ],
    "typescript/no-base-to-string": "error",
    "import/no-cycle": "error",
  },
  overrides: [
    ...(cloudflare.overrides ?? []),
    {
      files: ["src/gateway/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/core/**"],
                message: "The gateway runs on the main thread and shares only data with the core.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/core/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/gateway/**"],
                message: "The core runs in a Worker and shares only data with the gateway.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/protocol/**", "src/config/**", "src/log.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/gateway/**", "**/core/**"],
                message: "Both threads load the shared layer, so it stays free of either.",
              },
            ],
          },
        ],
      },
    },
  ],
});
