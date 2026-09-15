import { createContext, useContext, useState, type ReactNode } from "react";

// Lightweight UI-only state that doesn't belong in the data-heavy app-context.
// Currently just the mobile navigation drawer (the sidebar becomes an off-canvas
// drawer on small screens).
interface UIState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  toggleMobileNav: () => void;
}

const UICtx = createContext<UIState | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <UICtx.Provider
      value={{
        mobileNavOpen,
        setMobileNavOpen,
        toggleMobileNav: () => setMobileNavOpen((v) => !v),
      }}
    >
      {children}
    </UICtx.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}
