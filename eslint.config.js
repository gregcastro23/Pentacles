export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-alchm/**",
      "src/module_bindings/**",
      "unity/**",
      "backups/**"
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        process: "readonly",
        import: "readonly",
        BigInt: "readonly",
        Number: "readonly",
        String: "readonly",
        Math: "readonly",
        Error: "readonly",
        Date: "readonly",
        AbortController: "readonly",
        atob: "readonly",
        btoa: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        getComputedStyle: "readonly",
        ResizeObserver: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        location: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        MutationObserver: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "warn",
      "no-const-assign": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": "warn"
    }
  }
];
