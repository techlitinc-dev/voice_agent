"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Mounted once in the app layout. The layout passes `incomplete=true` ONLY for
 * brand-new workspaces (no checklist items done): any app page (except the wizard
 * itself and settings — KYC/branding live there) then bounces to /onboarding.
 * Workspaces that already started onboarding are nudged by the dashboard
 * checklist widget instead of a hard redirect.
 */
export function OnboardingResume({ incomplete }: { incomplete: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!incomplete) return;
    if (pathname.startsWith("/onboarding")) return;
    if (pathname.startsWith("/settings")) return;
    router.replace("/onboarding");
  }, [incomplete, pathname, router]);

  return null;
}
