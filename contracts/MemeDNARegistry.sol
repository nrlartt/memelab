// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MemeDNARegistry
/// @notice Anchors DNA Family digests produced by MemeDNA on BNB Chain and allows
///         community validation votes. The off-chain pipeline is the source of
///         truth; this contract is a tamper-evident audit trail.
contract MemeDNARegistry {
    struct DnaFamily {
        bytes32 id;
        bytes32 digest;
        string  eventTitle;
        uint32  mutationsCount;
        uint32  confidenceBps; // confidence * 10000
        uint64  firstSeenAt;
        uint64  lastSeenAt;
        address registrar;
        uint64  registeredAt;
    }

    address public owner;
    mapping(address => bool) public registrars;
    mapping(bytes32 => DnaFamily) public families;
    mapping(bytes32 => mapping(address => int8)) public votes; // +1 agree, -1 dispute
    mapping(bytes32 => int256) public voteScore;

    event RegistrarUpdated(address indexed registrar, bool allowed);
    event FamilyRegistered(bytes32 indexed id, bytes32 digest, string eventTitle, uint32 mutationsCount);
    event FamilyUpdated(bytes32 indexed id, bytes32 digest, uint32 mutationsCount, uint32 confidenceBps);
    event FamilyVoted(bytes32 indexed id, address indexed voter, int8 value, int256 newScore);

    error NotOwner();
    error NotRegistrar();
    error InvalidVote();
    error UnknownFamily();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegistrar() {
        if (!registrars[msg.sender] && msg.sender != owner) revert NotRegistrar();
        _;
    }

    constructor() {
        owner = msg.sender;
        registrars[msg.sender] = true;
    }

    function setRegistrar(address who, bool allowed) external onlyOwner {
        registrars[who] = allowed;
        emit RegistrarUpdated(who, allowed);
    }

    function registerFamily(
        bytes32 id,
        bytes32 digest,
        string calldata eventTitle,
        uint32 mutationsCount,
        uint32 confidenceBps,
        uint64 firstSeenAt,
        uint64 lastSeenAt
    ) external onlyRegistrar {
        DnaFamily storage f = families[id];
        bool isNew = (f.registeredAt == 0);
        f.id = id;
        f.digest = digest;
        f.eventTitle = eventTitle;
        f.mutationsCount = mutationsCount;
        f.confidenceBps = confidenceBps;
        f.firstSeenAt = firstSeenAt;
        f.lastSeenAt = lastSeenAt;
        f.registrar = msg.sender;
        f.registeredAt = uint64(block.timestamp);

        if (isNew) {
            emit FamilyRegistered(id, digest, eventTitle, mutationsCount);
        } else {
            emit FamilyUpdated(id, digest, mutationsCount, confidenceBps);
        }
    }

    function voteOnFamily(bytes32 id, int8 value) external {
        if (value != int8(1) && value != int8(-1)) revert InvalidVote();
        if (families[id].registeredAt == 0) revert UnknownFamily();

        int8 prev = votes[id][msg.sender];
        if (prev == value) return;
        voteScore[id] -= int256(prev);
        votes[id][msg.sender] = value;
        voteScore[id] += int256(value);
        emit FamilyVoted(id, msg.sender, value, voteScore[id]);
    }

    function getFamily(bytes32 id) external view returns (DnaFamily memory) {
        DnaFamily memory f = families[id];
        if (f.registeredAt == 0) revert UnknownFamily();
        return f;
    }
}
