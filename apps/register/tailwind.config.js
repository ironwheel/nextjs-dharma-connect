/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "../../packages/sharedFrontend/src/**/*.{js,ts,jsx,tsx,mdx}"
    ],
    theme: {
        extend: {
            colors: {
                reg: {
                    page: 'var(--reg-bg-page)',
                    panel: 'var(--reg-bg-panel)',
                    card: 'var(--reg-bg-card)',
                    'card-muted': 'var(--reg-bg-card-muted)',
                    input: 'var(--reg-bg-input)',
                    'button': 'var(--reg-bg-button)',
                    'button-hover': 'var(--reg-bg-button-hover)',
                    'button-disabled': 'var(--reg-bg-button-disabled)',
                    border: 'var(--reg-border)',
                    'border-light': 'var(--reg-border-light)',
                    text: 'var(--reg-text)',
                    muted: 'var(--reg-text-muted)',
                    'text-disabled': 'var(--reg-text-disabled)',
                    accent: 'var(--reg-accent)',
                    'accent-hover': 'var(--reg-accent-hover)',
                    'accent-button': 'var(--reg-accent-button)',
                    'accent-button-hover': 'var(--reg-accent-button-hover)',
                    'accent-button-text': 'var(--reg-accent-button-text)',
                    error: 'var(--reg-error)',
                    'error-bg': 'var(--reg-error-bg)',
                    'focus-ring': 'var(--reg-focus-ring)',
                    placeholder: 'var(--reg-placeholder)',
                },
            },
            borderColor: {
                reg: {
                    DEFAULT: 'var(--reg-border)',
                    light: 'var(--reg-border-light)',
                    error: 'var(--reg-error)',
                },
            },
            placeholderColor: {
                reg: 'var(--reg-placeholder)',
            },
        },
    },
    plugins: [],
}
