"use client";

import * as React from "react";

/**
 * AutoVenta tiene UN solo modo: el claro.
 *
 * El modo oscuro heredado de upstream (fondos oliva #161510 / #1d1c17) se veía
 * verdoso y se prendía solo cuando el sistema de quien usaba estaba en oscuro.
 * Decisión de producto (2026-11-23): queda solo el claro. No hay botón, atajo
 * ni preferencia guardada; `prefers-color-scheme` no se consulta.
 *
 * La forma del contexto se mantiene (`theme`, `resolvedTheme`, `setTheme`,
 * `toggle`) para que los consumidores no cambien: siempre devuelve "light" y
 * los setters no hacen nada. Los tokens `[data-theme="dark"]` de
 * `app/globals.css` quedan como código muerto inofensivo, para no divergir de
 * upstream en un archivo de 1.500 líneas.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Se conserva para que el script inicial pueda borrar una preferencia vieja.
export const STORAGE_KEY = "deskcomm-theme";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const nada = () => {};
const SOLO_CLARO: ThemeContextValue = {
  theme: "light",
  resolvedTheme: "light",
  setTheme: nada,
  toggle: nada,
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);
  return <ThemeContext.Provider value={SOLO_CLARO}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
