import coreWebVitals from 'eslint-config-next/core-web-vitals'

const config = [
  ...coreWebVitals,
  {
    ignores: ['.next/**', 'public/**', 'next-env.d.ts', 'coverage/**'],
  },
  {
    // BASELINE: rules that had errors when lint landed (React Compiler rules
    // from react-hooks v7). Downgraded to warn so only NEW kinds of errors
    // fail CI. Fix existing hits, then delete the rule from this block.
    // Counts at baseline: set-state-in-effect 23, refs 29, static-components 10.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
]

export default config
