import { createContext, useContext, useEffect, useState } from 'react';

// Light/dark theme. Dark is the default (the app's original look); the `.light`
// class on <html> flips it. Persisted to localStorage and applied early by a
// small inline script in index.html to avoid a flash on load.
const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });

function readInitial() {
  try {
    return localStorage.getItem('cf_theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitial);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try {
      localStorage.setItem('cf_theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
