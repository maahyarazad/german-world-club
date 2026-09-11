import VisuallyHidden from './components/VisuallyHidden.jsx'

function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-cream focus:px-4 focus:py-2 focus:font-medium focus:text-brand-ink"
      >
        Skip to content
      </a>

      <main id="main">
        <VisuallyHidden as="h1">Experts Circle</VisuallyHidden>
      </main>

      <footer />
    </>
  )
}

export default App
