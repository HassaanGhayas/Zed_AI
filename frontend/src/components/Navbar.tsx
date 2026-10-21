import React, { useEffect, useRef, useState } from 'react';
import { Key, Video, FileText, CheckCircle2, X, PieChart, LogIn, LogOut, Trash2, BookOpen, MoreHorizontal, Sun, Moon } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Logo } from './ui/Logo';
import { getStoredGeminiKey, setStoredGeminiKey, deleteMyCloudData } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { pauseSync, resumeSync, settlePushes } from '../lib/cloudSync';
import { ReviewModal } from './ReviewModal';

interface NavbarProps {
  hasActiveSession: boolean;
  onReset: () => void;
  onOpenNotes?: () => void;
  canViewNotes?: boolean;
  notesCount?: number;
  onOpenProgress?: () => void;
  needsReviewCount?: number;
  /** Lifted so the landing page's footer can trigger the same modal. */
  isKeyModalOpen: boolean;
  onOpenKeyModal: () => void;
  onCloseKeyModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  hasActiveSession,
  onReset,
  onOpenNotes,
  canViewNotes,
  notesCount = 0,
  onOpenProgress,
  needsReviewCount = 0,
  isKeyModalOpen,
  onOpenKeyModal,
  onCloseKeyModal,
}) => {
  const { enabled: authEnabled, user, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ ok: boolean; message: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const meta = (user?.user_metadata ?? {}) as { avatar_url?: string; picture?: string; full_name?: string; name?: string };
  const avatarUrl = meta.avatar_url || meta.picture;
  const displayName = meta.full_name || meta.name || user?.email || 'Account';

  const closeDeleteDialog = () => {
    if (deleting) return;
    setIsDeleteOpen(false);
    setDeleteResult(null);
  };

  const handleDeleteCloudData = async () => {
    setDeleting(true);
    setDeleteResult(null);
    try {
      // Stop uploads first, then let any in-flight push land before deleting,
      // so nothing re-creates cloud rows afterwards.
      pauseSync();
      await settlePushes();
      await deleteMyCloudData();
      setDeleteResult({ ok: true, message: 'Your cloud study data was deleted. Your Google account is not deleted, and progress saved on this device is untouched. Cloud sync stays paused until you sign out and back in.' });
    } catch (err) {
      resumeSync(); // nothing is confirmed deleted, so keep syncing

      setDeleteResult({ ok: false, message: err instanceof Error ? err.message : 'Could not delete cloud data.' });
    } finally {
      setDeleting(false);
    }
  };

  const [apiKeyInput, setApiKeyInput] = useState(
    getStoredGeminiKey()
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  // One-time onboarding nudge: without a key the app runs on built-in fallbacks,
  // which first-time users otherwise mistake for the real product.
  const [showKeyHint, setShowKeyHint] = useState(() => {
    try {
      return (
        !getStoredGeminiKey() &&
        localStorage.getItem('mindflow-key-hint-dismissed') !== '1'
      );
    } catch {
      return false;
    }
  });

  const dismissKeyHint = () => {
    setShowKeyHint(false);
    try {
      localStorage.setItem('mindflow-key-hint-dismissed', '1');
    } catch {
      // ignore
    }
  };

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      setStoredGeminiKey(apiKeyInput.trim());
      setShowKeyHint(false);
    } else {
      setStoredGeminiKey('');
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onCloseKeyModal();
    }, 900);
  };

  return (
    <>
      <header className="border-b border-line-soft bg-raised/90 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
              <Logo className="w-5 h-5 text-on-accent" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-base sm:text-lg text-ink truncate">Studify AI</span>
                <span className="hidden min-[480px]:inline-flex flex-shrink-0">
                  <Badge tone="accent">Active Recall</Badge>
                </span>
              </div>
              <p className="text-xs text-ink-faint hidden sm:block truncate">
                Socratic Video Tutor & Note Synthesizer
              </p>
            </div>
          </div>

          <nav aria-label="Main navigation" className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
            {/* Below sm, theme + API key live in the overflow/account menu so 5 controls fit at 320px. */}
            <div className="hidden sm:block"><ThemeToggle /></div>
            {onOpenProgress && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenProgress}
                aria-label="View learning dashboard & progress"
              >
                <PieChart className="w-4 h-4 text-ink-faint flex-shrink-0" />
                <span className="hidden sm:inline">Analytics</span>
                {needsReviewCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-warning" title="Has topics needing review" />
                )}
              </Button>
            )}

            {canViewNotes && onOpenNotes && (
              <Button
                variant="primary"
                size="sm"
                onClick={onOpenNotes}
                aria-label="View study notes"
              >
                <FileText className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline">Study Notes</span>
                {notesCount > 0 && (
                  <span className="inline-flex items-center px-1.5 rounded-full bg-on-accent/15 text-xs font-bold">
                    {notesCount}
                  </span>
                )}
              </Button>
            )}

            {hasActiveSession && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onReset}
                aria-label="Start new video session"
              >
                <Video className="w-4 h-4 text-ink-faint flex-shrink-0" />
                <span className="hidden sm:inline">New Video</span>
              </Button>
            )}

            {authEnabled && !authLoading && !user && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void signInWithGoogle()}
                aria-label="Sign in with Google"
              >
                <LogIn className="w-4 h-4 text-ink-faint flex-shrink-0" />
                <span className="hidden sm:inline">Sign in</span>
              </Button>
            )}

            <div className="hidden sm:block">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenKeyModal()}
                aria-label="Manage Gemini API Key"
              >
                <Key className="w-4 h-4 text-ink-faint flex-shrink-0" />
                <span className="hidden sm:inline">API Key</span>
              </Button>
            </div>

            {(
              <div className={`relative flex-shrink-0 ${authEnabled && user ? '' : 'sm:hidden'}`} ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label={authEnabled && user ? 'Account menu' : 'More options'}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center bg-sunken border border-line/60 hover:border-accent/50 text-sm font-semibold text-ink-muted cursor-pointer transition-colors"
                >
                  {!(authEnabled && user) ? (
                    <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
                  ) : avatarUrl ? (
                    <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  ) : (
                    <span aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>
                  )}
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label="Account"
                    className="absolute right-0 mt-2 w-60 bg-raised border border-line rounded-lg shadow-pop p-1.5 z-50"
                  >
                    <div className="sm:hidden border-b border-line-soft mb-1 pb-1">
                      <Button
                        role="menuitem"
                        type="button"
                        variant="ghost"
                        size="row"
                        onClick={() => { toggleTheme(); setMenuOpen(false); }}
                      >
                        {theme === 'dark' ? <Sun className="w-4 h-4 text-ink-faint" /> : <Moon className="w-4 h-4 text-ink-faint" />}
                        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                      </Button>
                      <Button
                        role="menuitem"
                        type="button"
                        variant="ghost"
                        size="row"
                        onClick={() => { setMenuOpen(false); onOpenKeyModal(); }}
                      >
                        <Key className="w-4 h-4 text-ink-faint" /> API Key
                      </Button>
                    </div>
                    {authEnabled && user && (<>
                    <div className="px-3 py-2 border-b border-line-soft mb-1">
                      <p className="text-xs font-semibold text-ink truncate">{displayName}</p>
                      {user.email && <p className="text-xs text-ink-faint truncate">{user.email}</p>}
                    </div>
                    <Button
                      role="menuitem"
                      type="button"
                      variant="ghost"
                      size="row"
                      onClick={() => { setMenuOpen(false); setIsReviewOpen(true); }}
                    >
                      <BookOpen className="w-4 h-4 text-ink-faint" /> Review weak spots
                    </Button>
                    <Button
                      role="menuitem"
                      type="button"
                      variant="ghost"
                      size="row"
                      onClick={() => { setMenuOpen(false); void signOut(); }}
                    >
                      <LogOut className="w-4 h-4 text-ink-faint" /> Sign out
                    </Button>
                    <Button
                      role="menuitem"
                      type="button"
                      variant="dangerText"
                      size="row"
                      onClick={() => { setMenuOpen(false); setDeleteResult(null); setIsDeleteOpen(true); }}
                    >
                      <Trash2 className="w-4 h-4" /> Delete my cloud data
                    </Button>
                    </>)}
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* One-time Gemini-key onboarding hint */}
      {showKeyHint && (
        <div className="bg-warning/10 border-b border-warning/25" role="region" aria-label="API key onboarding notice">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Key className="w-4 h-4 text-warning flex-shrink-0" />
            <p className="text-xs text-ink-muted flex-1 min-w-[160px]">
              No Gemini API key set — Studify AI is running on built-in fallbacks.
              Add a free key for full AI chaptering, answer evaluation & visual explanations.
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto sm:ml-0">
              <Button variant="secondary" size="sm" onClick={() => onOpenKeyModal()}>
                Add key
              </Button>
              <Button variant="ghost" size="icon" onClick={dismissKeyHint} aria-label="Dismiss API key hint">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {authEnabled && user && <ReviewModal isOpen={isReviewOpen} onClose={() => setIsReviewOpen(false)} />}

      {/* Delete cloud data confirmation */}
      <Modal
        isOpen={isDeleteOpen}
        onClose={closeDeleteDialog}
        titleId="delete-cloud-modal-title"
        className="max-w-md w-full p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-lg bg-danger/10 text-danger border border-danger/30">
            <Trash2 className="w-5 h-5" />
          </div>
          <h3 id="delete-cloud-modal-title" className="text-lg font-semibold text-ink">Delete my cloud data?</h3>
        </div>
        <p className="text-sm text-ink-muted mb-4 leading-relaxed">
          This permanently removes only your synced study data (sessions and answer history) from the cloud. Your Google account is not deleted and you stay signed in. Progress saved in this browser is not affected. This cannot be undone.
        </p>
        {deleteResult && (
          <p role="status" className={`text-sm mb-4 ${deleteResult.ok ? 'text-success' : 'text-danger'}`}>
            {deleteResult.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={closeDeleteDialog} disabled={deleting}>
            {deleteResult?.ok ? 'Close' : 'Cancel'}
          </Button>
          {!deleteResult?.ok && (
            <Button type="button" variant="danger" onClick={() => void handleDeleteCloudData()} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete permanently'}
            </Button>
          )}
        </div>
      </Modal>

      {/* API Key Modal */}
      <Modal
        isOpen={isKeyModalOpen}
        onClose={() => onCloseKeyModal()}
        titleId="api-key-modal-title"
        className="max-w-md w-full p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-lg bg-warning/10 text-warning border border-warning/25">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 id="api-key-modal-title" className="text-lg font-semibold text-ink">Google Gemini API Key</h3>
            <p className="text-xs text-ink-faint">Optional: overrides default backend key</p>
          </div>
        </div>

        <p className="text-sm text-ink-muted mb-4 leading-relaxed">
          You can provide your own Gemini API key for high-speed custom model inference, or leave blank to use the server default.
        </p>

        <label htmlFor="gemini-api-key-input" className="sr-only">
          Google Gemini API Key
        </label>
        <input
          id="gemini-api-key-input"
          type="password"
          autoComplete="off"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder="AIzaSy..."
          className="w-full px-4 py-3 bg-sunken border border-line rounded-md text-ink placeholder-ink-faint text-sm focus:outline-none focus:ring-2 focus:ring-accent mb-5"
        />

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => onCloseKeyModal()}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSaveKey}>
            {savedSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-on-accent" />
                <span>Saved!</span>
              </>
            ) : (
              <span>Save Key</span>
            )}
          </Button>
        </div>
      </Modal>
    </>
  );
};
