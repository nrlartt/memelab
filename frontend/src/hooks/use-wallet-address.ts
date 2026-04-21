"use client";

import { useEffect, useState } from "react";
import { getStoredWalletAddress, WALLET_STORAGE_KEY } from "@/lib/wallet";

/**
 * EIP-1193 address from the same storage as {@link ConnectWallet},
 * kept in sync via `storage` events and `memedna:wallet-changed`.
 */
export function useWalletAddress(): string | null {
  const [addr, setAddr] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setAddr(getStoredWalletAddress());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === WALLET_STORAGE_KEY || e.key === null) sync();
    };
    const onCustom = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("memedna:wallet-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("memedna:wallet-changed", onCustom);
    };
  }, []);

  return addr;
}
