import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { start } from './store.ts'

start()
createRoot(document.getElementById('root')!).render(<App />)
