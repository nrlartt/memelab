"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Dna, LogOut, Wallet } from "lucide-react";
import { shortAddress } from "@/lib/format";
import {
  dispatchWalletChanged,
  WALLET_STORAGE_KEY,
} from "@/lib/wallet";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const BSC_HEX = "0x38";
const BSC_PARAMS = {
  chainId: BSC_HEX,
  chainName: "BNB Smart Chain",
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorerUrls: ["https://bscscan.com"],
};

/**
 * Minimal EIP-1193 wallet connector.
 *
 * Deliberately dependency-free - no wagmi / RainbowKit / walletconnect.
 * We only need "did you sign in? what's your address?" so we can send the
 * user to /my-dna and show their wallet's decoded DNA. For anything heavier
 * (sigs, tx), bolt on wagmi later.
 */
export function ConnectWallet() {
  const [addr, setAddr] = React.useState<string | null>(null);
  const [hasProvider, setHasProvider] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setHasProvider(typeof window !== "undefined" && !!window.ethereum);
    const stored =
      typeof window !== "undefined"
        ? localStorage.getItem(WALLET_STORAGE_KEY)
        : null;
    if (stored) setAddr(stored);

    const eth = window.ethereum;
    if (!eth?.on) return;
    const handle = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts?.length) {
        localStorage.removeItem(WALLET_STORAGE_KEY);
        dispatchWalletChanged(null);
        setAddr(null);
      } else {
        const next = accounts[0].toLowerCase();
        localStorage.setItem(WALLET_STORAGE_KEY, next);
        dispatchWalletChanged(next);
        setAddr(next);
      }
    };
    eth.on("accountsChanged", handle);
    return () => eth.removeListener?.("accountsChanged", handle);
  }, []);

  async function connect() {
    const eth = window.ethereum;
    if (!eth) {
      window.open("https://metamask.io/download", "_blank");
      return;
    }
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts?.length) {
        const a = accounts[0].toLowerCase();
        localStorage.setItem(WALLET_STORAGE_KEY, a);
        dispatchWalletChanged(a);
        setAddr(a);
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_HEX }],
          });
        } catch (e: unknown) {
          const code = (e as { code?: number })?.code;
          if (code === 4902) {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [BSC_PARAMS],
            });
          }
        }
      }
    } catch (e) {
      console.warn("wallet connect rejected", e);
    }
  }

  function disconnect() {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    dispatchWalletChanged(null);
    setAddr(null);
    setOpen(false);
  }

  if (!addr) {
    return (
      <button
        onClick={connect}
        className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--color-helix-a)] to-[var(--color-helix-c)] px-4 py-1.5 text-xs font-semibold text-[var(--color-ink-950)] shadow-[0_8px_24px_-12px_rgba(122,227,216,0.6)] transition-transform hover:-translate-y-[1px]"
        title={hasProvider ? "Connect wallet" : "Install MetaMask"}
      >
        <Wallet className="h-3.5 w-3.5" />
        {hasProvider ? "Connect wallet" : "Install wallet"}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08]"
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-gradient-to-br from-[var(--color-helix-a)] to-[var(--color-helix-c)] text-[8px] font-bold text-[var(--color-ink-950)]">
          {addr.slice(2, 3).toUpperCase()}
        </span>
        <span className="font-mono">{shortAddress(addr, 4, 4)}</span>
        <ChevronDown className="h-3 w-3 opacity-60 transition-transform group-hover:translate-y-0.5" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-ink-950)]/95 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-white/5 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-400)]">
                Connected wallet
              </div>
              <div className="mt-1 font-mono text-xs text-white">
                {shortAddress(addr, 8, 8)}
              </div>
            </div>
            <Link
              href="/my-dna"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 text-xs text-white hover:bg-white/5"
            >
              <Dna className="h-3.5 w-3.5 text-[var(--color-helix-a)]" />
              My wallet DNA
            </Link>
            <a
              href={`https://bscscan.com/address/${addr}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--color-ink-200)] hover:bg-white/5 hover:text-white"
            >
              <Wallet className="h-3.5 w-3.5" />
              View on BscScan
            </a>
            <button
              onClick={disconnect}
              className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-left text-xs text-[var(--color-bad)] hover:bg-[var(--color-bad)]/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
