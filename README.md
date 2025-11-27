# RPS Arena - ERC-8001 Rock Paper Scissors

A fully on-chain Rock Paper Scissors game built using the **ERC-8001 Agent Coordination Framework**. This implementation demonstrates commit-reveal cryptographic patterns for fair, trustless gameplay on Ethereum.

## Table of Contents

- [Features](#features)
- [How the Game Works](#how-the-game-works)
- [Game Lifecycle](#game-lifecycle)
- [How the Game Ends](#how-the-game-ends)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Testing Locally](#testing-locally)
- [Contract API](#contract-api)
- [Debug Panel](#debug-panel)
- [ERC-8001 Mapping](#erc-8001-mapping)

---

## Features

- **ERC-8001 Compliant**: Full implementation of the Agent Coordination Framework
- **Commit-Reveal Pattern**: Cryptographically fair - neither player can cheat
- **EIP-712 Signatures**: Wallet-native signing for better UX
- **Retro Arcade UI**: CRT-style aesthetic with neon accents
- **Debug Panel**: Full visibility into game state, hashes, and transactions

---

## How the Game Works

### The Problem with On-Chain RPS

In a naive implementation, if Player 1 submits their move first, Player 2 can see it on-chain and always win. We solve this with **commit-reveal**:

1. **Commit Phase**: Players submit a hash of their move (not the move itself)
2. **Reveal Phase**: After both commit, players reveal their actual moves
3. **Verification**: Contract verifies each reveal matches the original commitment

### The Cryptographic Commitment

```
commitment = keccak256(abi.encodePacked(move, salt))
```

- `move`: 1 (Rock), 2 (Paper), or 3 (Scissors)
- `salt`: 32 random bytes (ensures commitment can't be brute-forced)

Since keccak256 is a one-way hash, seeing the commitment reveals nothing about the move.

---

## Game Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GAME STATE MACHINE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────┐    propose    ┌──────────┐                               │
│   │   None   │ ────────────► │ Proposed │                               │
│   └──────────┘               └────┬─────┘                               │
│                                   │                                     │
│                         both accept (commit moves)                      │
│                                   │                                     │
│                                   ▼                                     │
│                           ┌──────────────┐                              │
│                           │ BothCommitted │◄─── 1 hour reveal window    │
│                           └──────┬───────┘     starts here              │
│                                  │                                      │
│                          first player reveals                           │
│                                  │                                      │
│                                  ▼                                      │
│                            ┌──────────┐                                 │
│                            │ Revealed │                                 │
│                            └────┬─────┘                                 │
│                                 │                                       │
│                         second player reveals                           │
│                                 │                                       │
│                                 ▼                                       │
│   ┌───────────┐         ┌───────────┐         ┌───────────┐            │
│   │ Cancelled │◄────────│ Completed │────────►│  Winner   │            │
│   └───────────┘         └───────────┘         │  Paid!    │            │
│        ▲                                      └───────────┘            │
│        │                                                                │
│   (timeout/forfeit)                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Detailed Flow

| Step | Action | Who | What Happens |
|------|--------|-----|--------------|
| 1 | **Propose** | Player 1 | Creates game, signs intent, sends wager |
| 2 | **Accept** | Player 1 | Commits move (hash stored in `conditionsHash`) |
| 3 | **Accept** | Player 2 | Commits move, sends matching wager |
| 4 | **Reveal** | Either | Submits (move, salt), contract verifies |
| 5 | **Reveal** | Other | Submits (move, salt), triggers auto-execution |
| 6 | **Execute** | Contract | Determines winner, transfers pot |

---

## How the Game Ends

### 🏆 Normal Completion (Happy Path)

When both players reveal their moves, the contract automatically:

1. **Verifies** each reveal matches the original commitment
2. **Determines winner** using standard RPS rules:
   - Rock beats Scissors
   - Scissors beats Paper  
   - Paper beats Rock
3. **Transfers funds**:
   - **Winner**: Receives entire pot (2x wager)
   - **Draw**: Both players refunded their wager

```solidity
// Winner determination
if (p1 == p2) return Result.Draw;
if ((p1 == Rock && p2 == Scissors) || 
    (p1 == Paper && p2 == Rock) || 
    (p1 == Scissors && p2 == Paper)) {
    return Result.Player1Wins;
}
return Result.Player2Wins;
```

### ⏱️ Timeout Scenarios

| Scenario | Trigger | Outcome |
|----------|---------|---------|
| Opponent never commits | Player 1 calls `cancelCoordination` | Player 1 refunded |
| Game expires before both commit | Anyone calls `cancelCoordination` | Player 1 refunded |
| Only Player 1 reveals | Reveal deadline passes | Player 1 wins by forfeit (gets 2x wager) |
| Only Player 2 reveals | Reveal deadline passes | Player 2 wins by forfeit (gets 2x wager) |
| Neither player reveals | Reveal deadline passes | Both players refunded |

### Timing Parameters

- **Game Expiry**: Set by proposer (typically 1 hour)
- **Reveal Window**: 1 hour after both players commit (`REVEAL_WINDOW = 1 hours`)

---

## Project Structure

```
rps-erc8001/
├── contracts/
│   ├── src/
│   │   └── RockPaperScissorsERC8001.sol   # Main contract (581 lines)
│   ├── test/
│   │   └── RockPaperScissorsERC8001.t.sol # Comprehensive tests
│   ├── script/
│   │   └── Deploy.s.sol                    # Deployment scripts
│   └── foundry.toml                        # Foundry config
├── frontend/
│   ├── index.html                          # Retro arcade UI
│   ├── styles.css                          # CRT/neon aesthetic
│   └── app.js                              # Full game logic + debug
├── Makefile                                # Build commands
├── .env.example                            # Environment template
└── README.md                               # This file
```

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- MetaMask or compatible wallet
- Python 3 (for serving frontend)

### 1. Install & Build

```bash
cd contracts
forge install
forge build
forge test -vvv
```

### 2. Start Local Blockchain

```bash
# Terminal 1: Start Anvil (local Ethereum node)
cd contracts
anvil
```

This gives you 10 test accounts with 10,000 ETH each. Note the private keys!

### 3. Deploy Contract

```bash
# Terminal 2: Deploy
cd contracts
forge script script/Deploy.s.sol:DeployLocal \
    --rpc-url http://127.0.0.1:8545 \
    --broadcast
```

**Copy the deployed contract address** from the output:
```
RockPaperScissorsERC8001 deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

### 4. Configure Frontend

Edit `frontend/app.js` and update:
```javascript
const CONFIG = {
    CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3', // <-- Your address
    // ...
};
```

### 5. Serve Frontend

```bash
# Terminal 3
cd frontend
python3 -m http.server 8080
```

### 6. Play!

1. Open http://localhost:8080
2. Connect MetaMask (Network: Localhost 8545)
3. Import Anvil test accounts

---

## Testing Locally

### Two-Player Testing Setup

You need two browser profiles or browsers with different MetaMask accounts.

**Anvil Test Accounts (first two):**
```
Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

### Test Flow

1. **Player 1** (Account 0):
   - Click "NEW GAME"
   - Enter Player 2's address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
   - Set wager: 0.01 ETH
   - Select move (e.g., Rock)
   - Click CREATE
   - **Copy the Game ID from debug panel**

2. **Player 2** (Account 1 in different browser):
   - Click "JOIN GAME"
   - Paste the Game ID
   - Click LOAD
   - Select move (e.g., Paper)
   - Click ACCEPT

3. **Both Players**:
   - Click "REVEAL MOVE" when it appears
   - Winner is determined automatically!

---

## Contract API

### Write Functions

| Function | Description | Payment |
|----------|-------------|---------|
| `proposeCoordination(intent, sig)` | Create new game | Wager amount |
| `acceptCoordination(acceptance)` | Commit your move | Player 2: Wager amount |
| `revealMove(hash, move, salt)` | Reveal committed move | None |
| `cancelCoordination(hash)` | Cancel/claim forfeit | None |

### Read Functions

| Function | Returns |
|----------|---------|
| `getGame(intentHash)` | Full game state (11 fields) |
| `getCoordinationStatus(intentHash)` | Status enum (0-5) |
| `getPlayerGames(address)` | Array of game hashes |
| `agentNonces(address)` | Current nonce for player |

### Events

| Event | When |
|-------|------|
| `CoordinationProposed` | Game created |
| `CoordinationAccepted` | Move committed |
| `MoveRevealed` | Move revealed |
| `CoordinationExecuted` | Game completed |
| `CoordinationCancelled` | Game cancelled |

---

## Debug Panel

The frontend includes a debug panel (bottom-right) showing:

### Wallet Info
- Connected address
- Chain ID  
- Current nonce

### Contract Info
- Contract address
- EIP-712 domain separator

### Current Game
- **Intent Hash** (Game ID) - click to copy!
- Your commitment hash
- Your salt (keep secret until reveal!)
- Your move
- Whether you're Player 1

### On-Chain State
- Both player addresses
- Wager amount
- Game status
- Commitment status for each player
- Revealed moves
- Result
- Expiry timestamps

### Event Log
- Real-time transaction logging

**Pro Tip**: Click any hash/address in the debug panel to copy it!

---

## ERC-8001 Mapping

| ERC-8001 Concept | RPS Implementation |
|------------------|-------------------|
| `AgentIntent` | Game challenge with wager |
| `payloadHash` | Not used (0x0) |
| `expiry` | Game expiration time |
| `nonce` | Monotonic counter per player |
| `agentId` | Game proposer (Player 1) |
| `coordinationType` | `keccak256("RPS_GAME_V1")` |
| `coordinationValue` | Wager in wei |
| `participants` | [player1, player2] sorted ascending |
| `AcceptanceAttestation` | Move commitment |
| `conditionsHash` | `keccak256(move, salt)` |

---

## Gas Costs

| Operation | Estimated Gas |
|-----------|---------------|
| Propose + Commit (P1) | ~180,000 |
| Accept + Commit (P2) | ~120,000 |
| Reveal (first) | ~50,000 |
| Reveal (second) + Execute | ~80,000 |
| Cancel | ~40,000 |

---

## Testnet Deployment

### Sepolia

```bash
export PRIVATE_KEY=your_private_key
export SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
export ETHERSCAN_API_KEY=your_key

forge script script/Deploy.s.sol:DeployRPS \
    --rpc-url $SEPOLIA_RPC_URL \
    --broadcast \
    --verify
```

### Base Sepolia

```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export BASESCAN_API_KEY=your_key

forge script script/Deploy.s.sol:DeployRPS \
    --rpc-url $BASE_SEPOLIA_RPC_URL \
    --broadcast \
    --verify
```

---

## Security Considerations

1. **Replay Protection**: EIP-712 domain binding + monotonic nonces
2. **Commitment Binding**: keccak256 is irreversible  
3. **Salt Entropy**: 32 random bytes prevents brute-force
4. **Timeout Handling**: Clear forfeit rules prevent griefing
5. **Signature Malleability**: Low-s enforcement for ECDSA

---

## Troubleshooting

### "Invalid signature" error
- Ensure you're signing with the correct account
- Check that chain ID matches

### "Invalid nonce" error
- Nonces must be strictly increasing
- Check current nonce in debug panel

### Game stuck in "Proposed"
- Opponent needs to accept and commit
- Or cancel after expiry

### Can't reveal
- Both players must commit first (status = BothCommitted)
- Check reveal deadline hasn't passed

---

## License

MIT

---

## Contributing

PRs welcome! Please ensure tests pass:

```bash
cd contracts
forge test
forge fmt
```
