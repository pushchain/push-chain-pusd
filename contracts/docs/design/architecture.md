# Architecture

## Contract Overview

The protocol is two contracts deployed behind UUPS proxies:

```
┌──────────────────────────────┐       ┌──────────────────────────────────┐
│  PUSD (ERC-20 proxy)         │       │  PUSDManager (proxy)             │
│                              │       │                                  │
│  ERC20Upgradeable            │◄──────│  holds MINTER_ROLE + BURNER_ROLE │
│  AccessControlUpgradeable    │       │  on PUSD                         │
│  UUPSUpgradeable             │       │                                  │
│                              │       │  AccessControlUpgradeable        │
│  decimals: 6                 │       │  UUPSUpgradeable                 │
│  name: "Push USD"            │       │  SafeERC20                       │
│  symbol: "PUSD"              │       │                                  │
└──────────────────────────────┘       └──────────────────────────────────┘
```

## PUSD.sol

A thin, permission-gated ERC-20. It has no knowledge of collateral, fees, or redemption logic.

### Roles

| Role constant | Hex keccak | Capability |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | OZ default | Grant / revoke all other roles |
| `MINTER_ROLE` | `keccak256("MINTER_ROLE")` | Call `mint()` |
| `BURNER_ROLE` | `keccak256("BURNER_ROLE")` | Call `burn()` |
| `UPGRADER_ROLE` | `keccak256("UPGRADER_ROLE")` | Authorise UUPS upgrade |

`initialize(admin)` grants `DEFAULT_ADMIN_ROLE` and `UPGRADER_ROLE` to `admin`. `MINTER_ROLE` and `BURNER_ROLE` must be granted separately (done by the deployment script when it grants them to `PUSDManager`).

### Key functions

| Function | Access | Description |
|---|---|---|
| `mint(address to, uint256 amount)` | `MINTER_ROLE` | Mints `amount` PUSD to `to` |
| `burn(address from, uint256 amount)` | `BURNER_ROLE` | Burns `amount` PUSD from `from` |
| `decimals()` | public view | Returns `6` |
| `_authorizeUpgrade(address)` | `UPGRADER_ROLE` | UUPS upgrade guard |

## PUSDManager.sol

Holds all stablecoin reserves and orchestrates mint/burn calls on PUSD.

### Roles

| Role constant | Capability |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant / revoke all other roles |
| `ADMIN_ROLE` | Token management, fee config, rebalance, sweep |
| `UPGRADER_ROLE` | Authorise UUPS upgrade |

### Storage layout (key fields)

```solidity
PUSD public pusd;                                     // reference to PUSD token
uint256 private _status;                              // reentrancy guard

mapping(address => TokenInfo) public supportedTokens; // token config
mapping(uint256 => address)   public tokenList;       // ordered token addresses
mapping(address => uint256)   private tokenIndex;     // reverse lookup
uint256 public tokenCount;

address public treasuryReserve;
uint256 public baseFee;           // bps, max 100 (1%)
uint256 public preferredFeeMin;   // bps
uint256 public preferredFeeMax;   // bps, max 200 (2%)

mapping(address => uint256) public accruedFees;       // redemption fees pending sweep
mapping(address => uint256) public accruedHaircut;    // deposit haircuts pending sweep
mapping(address => uint256) public sweptFees;         // historical totals
mapping(address => uint256) public sweptHaircut;
```

### TokenInfo struct

```solidity
struct TokenInfo {
    bool exists;
    TokenStatus status;          // REMOVED | ENABLED | REDEEM_ONLY | EMERGENCY_REDEEM
    uint8 decimals;
    uint16 surplusHaircutBps;   // 0..4000, applied on deposit
    string name;
    string chainNamespace;       // e.g. "eip155:1" to identify originating chain
}
```

### Decimal normalisation

PUSD has 6 decimals. All internal accounting converts token amounts to PUSD units:

```
tokenDecimals == 6  →  no change
tokenDecimals  > 6  →  divide by 10^(tokenDecimals - 6)   (truncates)
tokenDecimals  < 6  →  multiply by 10^(6 - tokenDecimals)
```

`_convertFromPUSD` is the exact inverse used when sending tokens back to users.

### Preferred fee formula

When a user redeems into a specific token, a `preferredFee` is added on top of `baseFee`. The preferred fee decreases linearly as the token's share of total pool liquidity increases:

```
liquidityPct ≥ 50%  →  preferredFeeMin
liquidityPct ≤ 10%  →  preferredFeeMax
10% < pct < 50%     →  linear interpolation
```

This incentivises redemption into well-funded assets and discourages draining thin positions.
