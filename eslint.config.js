// ESLint flat config. Lint our source only; third-party (public/lib) + node_modules excluded.
// Style is deliberately loose — we're not trying to enforce a bikeshed, just catch real bugs.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'vendor-install/**',
            '.setup-cache/**',
            'public/lib/**',
            'test-results/**',
            'tools/inspect-*.png',
            'tools/block-registry.json',
        ],
    },

    // Shared rules
    js.configs.recommended,

    // Default: Node globals everywhere (catches Node CJS files including eslint.config.js).
    {
        languageOptions: {
            globals: { ...globals.node },
            ecmaVersion: 2022,
        },
    },

    // Browser-side code — Entry loaded globally, jQuery as $.
    {
        files: ['public/js/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                Entry: 'readonly',
                $: 'readonly',
                jQuery: 'readonly',
                createjs: 'readonly',
                React: 'readonly',
                ReactDOM: 'readonly',
                exportEnt: 'writable',
                changeWorkspaceMode: 'writable',
            },
            sourceType: 'script',
        },
    },

    // Node ESM (tools/*.mjs, scripts/*.mjs) — inside page.evaluate() closures we
    // reference browser globals (Entry, window, KeyboardEvent, etc.); those
    // strings never execute in Node, but ESLint sees them so we allow them here.
    {
        files: ['tools/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                Entry: 'readonly',
            },
            sourceType: 'module',
            ecmaVersion: 2022,
        },
    },

    // Tests (node:test + playwright)
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,    // e2e spec evaluates in-page code
                Entry: 'readonly',
            },
            sourceType: 'commonjs',
            ecmaVersion: 2022,
        },
    },

    // Project-wide tweaks
    {
        rules: {
            // Unused args starting with _ are intentional.
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // We use console.log for user-facing tool output.
            'no-console': 'off',
            // Many single-line function declarations are fine.
            'no-empty': ['warn', { allowEmptyCatch: true }],
            // Prefer === but don't block legacy == style.
            'eqeqeq': ['warn', 'smart'],
        },
    },
];
