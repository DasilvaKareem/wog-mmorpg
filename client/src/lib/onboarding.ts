export type OnboardingStartMode = "sign-in" | "create-character";

export const OPEN_ONBOARDING_EVENT = "wog:open-onboarding";

interface OpenOnboardingDetail {
  mode?: OnboardingStartMode;
}

export function openOnboarding(mode: OnboardingStartMode): void {
  window.dispatchEvent(
    new CustomEvent<OpenOnboardingDetail>(OPEN_ONBOARDING_EVENT, {
      detail: { mode },
    })
  );
}
