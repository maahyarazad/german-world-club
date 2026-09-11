import About from './components/About.jsx'
import Contact from './components/Contact.jsx'
import Countdown from './components/Countdown.jsx'
import Hero from './components/Hero.jsx'
import Offering from './components/Offering.jsx'

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
        <Hero />
        <Offering />
        <Countdown />
        <About />
      </main>

      <footer>
        <Contact />
      </footer>
    </>
  )
}

export default App
