"""Python-side client for MemeDNARegistry.sol on BNB Chain."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

import orjson
from eth_account import Account
from loguru import logger
from web3 import Web3

from ..bsc_web3 import connect_first_bsc_web3
from ..config import get_settings
from ..models import DnaFamily, FamilyMutation

REGISTRY_ABI: list[dict[str, Any]] = [
    {
        "inputs": [
            {"name": "id", "type": "bytes32"},
            {"name": "digest", "type": "bytes32"},
            {"name": "eventTitle", "type": "string"},
            {"name": "mutationsCount", "type": "uint32"},
            {"name": "confidenceBps", "type": "uint32"},
            {"name": "firstSeenAt", "type": "uint64"},
            {"name": "lastSeenAt", "type": "uint64"},
        ],
        "name": "registerFamily",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


@dataclass
class AnchorResult:
    tx_hash: str
    digest_hex: str


def _family_id_bytes32(family_id: str) -> bytes:
    return hashlib.sha256(family_id.encode("utf-8")).digest()


def compute_family_digest(family: DnaFamily, mutations: list[FamilyMutation]) -> bytes:
    payload = {
        "id": family.id,
        "event_title": family.event_title,
        "confidence": round(family.confidence_score, 4),
        "mutations": sorted(m.token_address for m in mutations),
        "first_seen_at": family.first_seen_at.isoformat() if family.first_seen_at else "",
        "last_seen_at": family.last_seen_at.isoformat() if family.last_seen_at else "",
    }
    blob = orjson.dumps(payload, option=orjson.OPT_SORT_KEYS)
    return hashlib.sha256(blob).digest()


class RegistryClient:
    def __init__(self) -> None:
        s = get_settings()
        self.settings = s
        self.enabled = s.has_registry
        if not self.enabled:
            self.w3 = None
            self.account = None
            self.contract = None
            return
        self.w3 = connect_first_bsc_web3(timeout=30.0)
        self.account = Account.from_key(s.memedna_deployer_private_key)
        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(s.memedna_registry_address), abi=REGISTRY_ABI
        )

    def anchor_family(
        self, family: DnaFamily, mutations: list[FamilyMutation]
    ) -> AnchorResult | None:
        if not self.enabled:
            logger.debug("Registry disabled; skipping on-chain anchor for {}", family.id)
            return None
        assert self.w3 is not None and self.contract is not None and self.account is not None

        digest = compute_family_digest(family, mutations)
        fam_id = _family_id_bytes32(family.id)
        tx = self.contract.functions.registerFamily(
            fam_id,
            digest,
            family.event_title[:200],
            min(len(mutations), 2**32 - 1),
            int(round(max(0.0, min(family.confidence_score, 1.0)) * 10_000)),
            int(family.first_seen_at.timestamp()) if family.first_seen_at else 0,
            int(family.last_seen_at.timestamp()) if family.last_seen_at else 0,
        ).build_transaction(
            {
                "from": self.account.address,
                "nonce": self.w3.eth.get_transaction_count(self.account.address),
                "gas": 400_000,
                "gasPrice": self.w3.eth.gas_price,
                "chainId": self.settings.bsc_chain_id,
            }
        )
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        logger.info("Anchored family {} on-chain, tx={}", family.id, tx_hash.hex())
        return AnchorResult(tx_hash=tx_hash.hex(), digest_hex="0x" + digest.hex())
