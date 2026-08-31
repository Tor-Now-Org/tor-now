import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint covers what the compiler cannot.
 *
 * TypeScript is already configured strictly — noUncheckedIndexedAccess,
 * exactOptionalPropertyTypes, verbatimModuleSyntax — so there is no value in
 * rules that restate type errors. What is left is the class of mistake that
 * type-checks perfectly well: a promise nobody awaited, a condition that is
 * always true, a `console.log` left behind in a service.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "e2e/.results/**",
      "supabase/functions/api/index.js",
      "apps/web/next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Two config files sit outside every tsconfig's include, by nature —
        // one configures the build, the other the test runner.
        projectService: {
          allowDefaultProject: ["playwright.config.ts", "apps/web/next.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped promise in a booking path loses a booking silently.
      "@typescript-eslint/no-floating-promises": "error",
      /**
       * `checksVoidReturn.attributes` is off because an async React handler —
       * `onClick={() => save()}` — is the idiomatic way to start work from a
       * click, and flagging it says nothing useful. Everywhere else a promise
       * used as a value is still an error.
       */
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",

      // The domain is written immutably; say so.
      "prefer-const": "error",
      "no-param-reassign": "error",

      // Unused code is either a mistake or a leftover. `_`-prefixed arguments
      // are the documented way to say "required by the signature, unused here".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `any` defeats the whole point of the strict settings above.
      "@typescript-eslint/no-explicit-any": "error",

      // TypeScript already reports an undefined identifier, and knows about
      // globals this rule does not.
      "no-undef": "off",

      /**
       * A repository port returns promises because one of its implementations
       * talks to a database. The in-memory one does not, and an implementation
       * that satisfies an async interface without awaiting anything is correct
       * rather than suspicious.
       */
      "@typescript-eslint/require-await": "off",

      // Template literals over string concatenation, and no bare `==`.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // The log adapters exist to write to the log, and the server prints one line
  // when it binds a port. Everywhere else, a console call is a leftover.
  {
    files: [
      "services/api/src/infrastructure/notifier/log-notifier.ts",
      "services/api/src/infrastructure/verification/senders.ts",
      "services/api/src/server.ts",
      "scripts/**",
      "**/scripts/**",
    ],
    rules: { "no-console": "off" },
  },

  // Tests assert against values the compiler cannot narrow, and reach into the
  // store on purpose.
  {
    files: ["**/*.test.ts", "e2e/**/*.ts", "**/testing/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-param-reassign": "off",
    },
  },

  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: { ...globals.node, fetch: "readonly", console: "readonly" },
    },
    ...tseslint.configs.disableTypeChecked,
  },
);
