import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

// Below Tailwind's md breakpoint (768px): bottom tab bar, swipe gestures,
// and bottom sheets replace the icon rail / popovers used above it.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
