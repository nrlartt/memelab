/** Shared with `ConnectWallet`: same localStorage key everywhere. */
export const WALLET_STORAGE_KEY = "memedna.wallet";

export function getStoredWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WALLET_STORAGE_KEY);
}

export function dispatchWalletChanged(address: string | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("memedna:wallet-changed", { detail: { address } }),
  );
}
