import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className={
        'relative flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl border transition-all cursor-pointer ' +
        (isDark
          ? 'text-ink-faint hover:text-ink-muted bg-cosmos-800/40 hover:bg-cosmos-800/80 border-line/50'
          : 'text-cosmos-700 hover:text-cosmos-900 bg-cosmos-100 hover:bg-cosmos-200 border-cosmos-200')
      }
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      {isDark ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
};
