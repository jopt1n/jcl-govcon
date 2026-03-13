"use client";

import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 h-10 px-5 text-sm transition-colors hover:bg-[var(--sidebar-hover)] text-[var(--sidebar-text)] hover:text-white w-full"
      aria-label="Toggle theme"
    >
      {dark ? (
        <Sun className="w-5 h-5 shrink-0" />
      ) : (
        <Moon className="w-5 h-5 shrink-0" />
      )}
      <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {dark ? "Light Mode" : "Dark Mode"}
      </span>
    </button>
  );
}
