import { config } from '@fohte/eslint-config'

// The only place throw/try-catch and unhandled neverthrow Results are
// allowed: bridges to external SDKs/frameworks (Octokit, sharp, the AWS SDK,
// fetch, Hono) and process bootstrap that must fail fast.
const INTEROP_BOUNDARY_FILES = [
  'src/adapters/**/*.ts',
  'src/auth/octo-sts.ts',
  'src/app.ts',
  'src/config.ts',
  'src/bootstrap.ts',
  'src/index.ts',
  'test/e2e/**/*.ts',
]

export default config(
  {
    typescript: { typeChecked: true },
    errorHandling: { interopBoundaryFiles: INTEROP_BOUNDARY_FILES },
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*', '../*'],
              message:
                'Please use absolute imports instead of relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // Octokit / S3 / fetch / mdast extension responses are typed as `unknown`; adapters narrow at the boundary.
    files: ['src/adapters/**/*.ts', 'src/domain/mdx-transformer.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
  {
    // E2E fixtures and the fake-GitHub harness narrow Octokit-shaped `unknown`
    // payloads and share a tiny per-folder module graph.
    files: ['test/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      'no-restricted-imports': 'off',
    },
  },
)
