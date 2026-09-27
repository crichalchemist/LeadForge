/** @type {import('tailwindcss').Config} */
// Semantic names for DESIGN.md's roles. Each color resolves to a custom property in src/styles/tokens.css,
// so one class serves both themes. Radii are named for what they shape, so the old pages' rounded-md and
// rounded-lg keep their stock values until wave 2 replaces those pages.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        raised: 'var(--raised)',
        seam: 'var(--seam)',
        edge: 'var(--edge)',
        text: 'var(--text)',
        dim: 'var(--dim)',
        focus: 'var(--focus)',
        error: 'var(--error)',
        plate: 'var(--plate)',
        'plate-deep': 'var(--plate-deep)',
        'on-plate': 'var(--on-plate)',
        'service-plate': 'var(--service-plate)',
        'on-service-plate': 'var(--on-service-plate)',
        'line-outreach': 'var(--line-outreach)',
        'ink-outreach': 'var(--ink-outreach)',
        'line-grant': 'var(--line-grant)',
        'ink-grant': 'var(--ink-grant)',
        'line-service': 'var(--line-service)',
        'ink-service': 'var(--ink-service)',
      },
      fontFamily: {
        condensed: ['var(--font-condensed)'],
      },
      fontSize: {
        display: ['2rem', { lineHeight: '1.1', fontWeight: '600' }],
        headline: ['1.5rem', { lineHeight: '1.2', fontWeight: '600' }],
        title: ['1.125rem', { lineHeight: '1.3', letterSpacing: '0.02em', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.5' }],
        data: ['0.9375rem', { lineHeight: '1.4', fontWeight: '500' }],
        label: ['0.8125rem', { lineHeight: '1.2', letterSpacing: '0.06em', fontWeight: '500' }],
      },
      borderRadius: { plate: '4px', control: '6px', region: '10px' },
      screens: { rail: '900px', wide: '1200px' },
      transitionDuration: { state: '150ms', trace: '220ms' },
      transitionTimingFunction: { 'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)' },
      boxShadow: { overlay: 'var(--overlay-shadow)' },
    },
  },
  plugins: [],
}
